import hashlib
import html
import json
import os
import re
import ssl
import sys
import time
import uuid
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlparse
from urllib.request import Request, urlopen


PLUGIN_ID = "babepediaGallery"
BASE_URL = "https://www.babepedia.com"
ALLOWED_BABEPEDIA_HOSTS = {
    "babepedia.com",
    "www.babepedia.com",
}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/138.0.0.0 Safari/537.36"
)
PLUGIN_DIR = Path(__file__).resolve().parent
CACHE_DIR = PLUGIN_DIR / "assets" / "cache"
STATE_DIR = PLUGIN_DIR / "state" / "imports"
HISTORY_FILE = PLUGIN_DIR / "state" / "import-history.json"
RUNTIME_FILE = PLUGIN_DIR / "state" / "runtime.json"
VENDOR_DIR = PLUGIN_DIR / "state" / "vendor"


def log(message):
    print("[Babepedia] " + str(message), file=sys.stderr, flush=True)


def write_json_atomic(path, payload, retries=12, retry_delay=0.035):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")

    try:
        temp.write_text(content, encoding="utf-8")
        last_error = None

        for attempt in range(retries):
            try:
                os.replace(str(temp), str(path))
                return
            except PermissionError as error:
                last_error = error
            except OSError as error:
                if getattr(error, "winerror", None) not in (5, 32):
                    raise
                last_error = error

            if attempt < retries - 1:
                time.sleep(retry_delay * (attempt + 1))

        if last_error:
            raise last_error

        raise OSError("Could not replace JSON cache file.")
    finally:
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass


def write_cache(request_id, payload):
    write_json_atomic(CACHE_DIR / (request_id + ".json"), payload)


def write_progress(request_id, phase, message, current=None, total=None, detail=None):
    if not request_id:
        return

    payload = {
        "phase": phase,
        "message": message,
        "updated_at": time.time(),
    }

    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total
    if detail:
        payload["detail"] = detail

    try:
        write_json_atomic(
            CACHE_DIR / (request_id + ".progress.json"),
            payload,
            retries=8,
            retry_delay=0.025,
        )
    except OSError as error:
        log("Skipped one progress update because the cache file was locked: " + str(error))


def clear_cache_files():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    removed = 0

    for path in CACHE_DIR.iterdir():
        if not path.is_file():
            continue
        try:
            path.unlink()
            removed += 1
        except OSError:
            pass

    return removed


def ensure_cache_for_stash_process():
    current_parent_pid = os.getppid()
    previous_parent_pid = None

    if RUNTIME_FILE.exists():
        try:
            runtime = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
            previous_parent_pid = runtime.get("parent_pid")
        except Exception:
            previous_parent_pid = None

    if str(previous_parent_pid) == str(current_parent_pid):
        return False

    write_json_atomic(RUNTIME_FILE, {
        "parent_pid": current_parent_pid,
        "seen_at": time.time(),
    })
    removed = clear_cache_files()
    log("New Stash process detected; cleared " + str(removed) + " cached file(s)")
    return True


def cleanup_old_files(directory, max_age_seconds):
    directory = Path(directory)

    if not directory.exists():
        return

    cutoff = time.time() - float(max_age_seconds)

    for path in directory.iterdir():
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def short_stable_hash(value, length=8):
    return hashlib.sha1(str(value or "").encode("utf-8")).hexdigest()[:length]


def sanitize_component(value, max_length=80):
    original = str(value or "").strip()
    cleaned = re.sub(r"[\\/:*?\"<>|]+", "_", original)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    changed = cleaned != original

    if not cleaned:
        cleaned = "Unknown"
        changed = True

    reserved = {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    }

    base_name = cleaned.split(".", 1)[0].upper()
    if base_name in reserved:
        cleaned = "_" + cleaned
        changed = True

    if len(cleaned) > max_length:
        changed = True

    suffix = ""
    if changed:
        suffix = "~" + short_stable_hash(original or cleaned)

    keep = max(1, max_length - len(suffix))
    cleaned = cleaned[:keep].rstrip(" .")

    if not cleaned:
        cleaned = "Unknown"

    result = cleaned + suffix
    return result[:max_length].rstrip(" .")


def safe_filename(filename, source_url, max_length=120):
    filename = str(filename or "image.jpg").strip()
    stem = Path(filename).stem or "image"
    suffix = Path(filename).suffix or ".jpg"

    if len(suffix) > 12:
        suffix = suffix[:12]

    stem_limit = max(16, max_length - len(suffix))
    safe_stem = sanitize_component(stem, max_length=stem_limit)
    result = safe_stem + suffix

    if len(result) <= max_length:
        return result

    hash_suffix = "~" + short_stable_hash(source_url or filename)
    keep = max(8, max_length - len(suffix) - len(hash_suffix))
    return safe_stem[:keep].rstrip(" .") + hash_suffix + suffix


def safe_destination_path(folder_path, filename, source_url, max_path_length=245):
    folder_path = Path(folder_path)
    safe_name = safe_filename(filename, source_url)
    destination = folder_path / safe_name

    if len(str(destination)) <= max_path_length:
        return destination

    suffix = destination.suffix
    stem = destination.stem
    hash_suffix = "~" + short_stable_hash(source_url)
    keep = max(8, max_path_length - len(str(folder_path)) - len(suffix) - len(hash_suffix) - 2)
    trimmed = stem[:keep].rstrip(" .") + hash_suffix + suffix
    return folder_path / trimmed


def is_within_path(child_path, parent_path):
    try:
        child = Path(child_path).resolve()
        parent = Path(parent_path).resolve()
        child.relative_to(parent)
        return True
    except Exception:
        return False


def validate_babepedia_url(url):
    parsed = urlparse(str(url or "").strip())
    host = str(parsed.netloc or "").split("@")[-1].casefold()

    if parsed.scheme not in ("http", "https") or host not in ALLOWED_BABEPEDIA_HOSTS:
        raise RuntimeError("Babepedia redirected to an unexpected host: " + str(url))

    return url


def boolean_setting(settings, key, default=False):
    value = (settings or {}).get(key)
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return text in ("1", "true", "yes", "on")


class Stash:
    def __init__(self, server_connection):
        if not server_connection:
            raise ValueError("Missing Stash server_connection")

        self.server_connection = dict(server_connection)
        scheme = str(self._connection_value("Scheme", "http") or "http").strip().lower()
        host = str(
            self._connection_value("Host", "")
            or self._connection_value("Domain", "localhost")
            or "localhost"
        ).strip()

        if host == "0.0.0.0":
            host = "127.0.0.1"

        try:
            port = int(self._connection_value("Port", 9999))
        except (TypeError, ValueError):
            port = 9999

        raw_host = str(host).strip()
        url_host = raw_host

        if raw_host.startswith("[") and raw_host.endswith("]"):
            raw_host = raw_host[1:-1]

        if ":" in raw_host and raw_host.count(":") == 1:
            host_part, maybe_port = raw_host.rsplit(":", 1)
            if host_part and maybe_port.isdigit():
                raw_host = host_part

        if ":" in raw_host:
            url_host = "[" + raw_host + "]"
        else:
            url_host = raw_host

        self.graphql_url = scheme + "://" + url_host + ":" + str(port) + "/graphql"
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Babepedia-Importer/0.1.0",
        }

        api_key = self._connection_value("ApiKey")
        if api_key:
            self.headers["ApiKey"] = str(api_key)

        session_cookie = self._connection_value("SessionCookie")
        session_value = ""

        if isinstance(session_cookie, dict):
            session_value = str(self._connection_value("Value", "", session_cookie) or "").strip()
        elif session_cookie:
            session_value = str(session_cookie).strip()

        if session_value and not api_key:
            self.headers["Cookie"] = "session=" + session_value

    def _connection_value(self, key, default=None, source=None):
        wanted = str(key or "").casefold()
        items = (source or self.server_connection or {}).items()

        for current_key, value in items:
            if str(current_key or "").casefold() == wanted:
                return value

        return default

    def query(self, query_text, variables=None):
        payload = json.dumps({
            "query": query_text,
            "variables": variables or {},
        }).encode("utf-8")
        request = Request(self.graphql_url, data=payload, headers=self.headers, method="POST")

        try:
            with urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8", errors="replace")
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace") if getattr(error, "fp", None) else ""
            raise RuntimeError("Stash GraphQL request failed with HTTP " + str(error.code) + ": " + body[:500])
        except URLError as error:
            raise RuntimeError("Stash GraphQL request failed: " + str(error.reason))

        try:
            result = json.loads(body)
        except json.JSONDecodeError as error:
            raise RuntimeError("Stash GraphQL response was not valid JSON: " + str(error))

        if result.get("errors"):
            messages = []
            for item in result.get("errors") or []:
                if isinstance(item, dict):
                    message = str(item.get("message") or "").strip()
                    if message:
                        messages.append(message)
            raise RuntimeError("Stash GraphQL error: " + " | ".join(messages or ["Unknown GraphQL error"]))

        data = result.get("data")
        if not isinstance(data, dict):
            raise RuntimeError("Stash GraphQL response did not contain data.")
        return data

    def get_plugin_environment(self):
        query_text = """
        query BabepediaPluginEnvironment($plugin_ids: [ID!]) {
            configuration {
                general {
                    stashes {
                        path
                        excludeImage
                    }
                }
                plugins(include: $plugin_ids)
            }
        }
        """
        data = self.query(query_text, {"plugin_ids": [PLUGIN_ID]})
        configuration = data.get("configuration") or {}
        general = configuration.get("general") or {}
        plugins = configuration.get("plugins") or {}
        settings = {}

        if isinstance(plugins, dict):
            candidate = plugins.get(PLUGIN_ID)
            if isinstance(candidate, dict):
                settings = candidate

        return {
            "settings": settings,
            "stashes": general.get("stashes") or [],
        }

    def performer_selection(self):
        return """
            id
            name
            urls
            alias_list
            gender
            birthdate
            ethnicity
            country
            eye_color
            height_cm
            measurements
            fake_tits
            career_length
            tattoos
            piercings
            details
            death_date
            hair_color
            weight
        """

    def find_performer_by_id(self, performer_id):
        query_text = """
        query BabepediaFindPerformerByID($id: ID!) {
            findPerformer(id: $id) {
                id
                name
                urls
                alias_list
                gender
                birthdate
                ethnicity
                country
                eye_color
                height_cm
                measurements
                fake_tits
                career_length
                tattoos
                piercings
                details
                death_date
                hair_color
                weight
            }
        }
        """
        data = self.query(query_text, {"id": performer_id})
        return data.get("findPerformer")

    def gallery_selection(self):
        return """
            id
            title
            urls
            organized
            performers { id }
        """

    def find_gallery_by_url(self, url, performer_id=None):
        query_text = """
        query BabepediaFindGalleryByURL($filter: FindFilterType, $gallery_filter: GalleryFilterType) {
            findGalleries(filter: $filter, gallery_filter: $gallery_filter) {
                galleries {
                    id
                    title
                    urls
                    organized
                    performers { id }
                }
            }
        }
        """
        wanted_performer = str(performer_id or "").strip()
        page = 1
        per_page = 100
        while True:
            data = self.query(query_text, {
                "filter": {
                    "per_page": per_page,
                    "page": page,
                },
                "gallery_filter": {
                    "url": {
                        "value": url,
                        "modifier": "EQUALS",
                    }
                },
            })
            galleries = data.get("findGalleries", {}).get("galleries", [])
            if not galleries:
                break

            for gallery in galleries:
                if url not in (gallery.get("urls") or []):
                    continue
                if wanted_performer:
                    performer_ids = {
                        str(item.get("id") or "").strip()
                        for item in (gallery.get("performers") or [])
                        if str(item.get("id") or "").strip()
                    }
                    if wanted_performer not in performer_ids:
                        continue
                return gallery

            if len(galleries) < per_page:
                break
            page += 1

        return None

    def create_gallery(self, title, url, performer_ids, organized=None):
        query_text = """
        mutation BabepediaGalleryCreate($input: GalleryCreateInput!) {
            galleryCreate(input: $input) {
                id
                title
                urls
                organized
                performers { id }
            }
        }
        """
        gallery_input = {
            "title": title,
            "urls": [url],
            "performer_ids": list(dict.fromkeys(performer_ids or [])),
        }

        if organized is not None:
            gallery_input["organized"] = bool(organized)

        data = self.query(query_text, {"input": gallery_input})
        return data["galleryCreate"]

    def update_gallery_metadata(self, gallery, title, url, performer_ids, organized=None):
        query_text = """
        mutation BabepediaGalleryUpdate($input: GalleryUpdateInput!) {
            galleryUpdate(input: $input) {
                id
                title
                urls
                organized
                performers { id }
            }
        }
        """
        existing_urls = list(gallery.get("urls") or [])
        existing_performers = [item.get("id") for item in (gallery.get("performers") or []) if item.get("id")]
        urls = list(existing_urls)

        if url and url not in urls:
            urls.append(url)

        gallery_input = {
            "id": gallery["id"],
            "urls": urls,
            "performer_ids": list(dict.fromkeys(existing_performers + list(performer_ids or []))),
        }

        if title:
            gallery_input["title"] = title

        if organized is not None:
            gallery_input["organized"] = bool(organized)

        data = self.query(query_text, {"input": gallery_input})
        return data["galleryUpdate"]

    def image_selection(self):
        return """
            id
            title
            urls
            organized
            performers { id }
            galleries { id }
            visual_files {
                ... on ImageFile {
                    id
                    path
                }
            }
        """

    def find_image_by_url(self, url):
        query_text = """
        query BabepediaFindImageByURL($filter: FindFilterType, $image_filter: ImageFilterType) {
            findImages(filter: $filter, image_filter: $image_filter) {
                images {
                    id
                    title
                    urls
                    organized
                    performers { id }
                    galleries { id }
                    visual_files {
                        ... on ImageFile {
                            id
                            path
                        }
                    }
                }
            }
        }
        """
        data = self.query(query_text, {
            "filter": {"per_page": 20},
            "image_filter": {
                "url": {
                    "value": url,
                    "modifier": "EQUALS",
                }
            },
        })
        images = data.get("findImages", {}).get("images", [])

        for image in images:
            if url in (image.get("urls") or []):
                return image

        return None

    def find_image_by_path(self, path):
        query_text = """
        query BabepediaFindImageByPath($filter: FindFilterType, $image_filter: ImageFilterType) {
            findImages(filter: $filter, image_filter: $image_filter) {
                images {
                    id
                    title
                    urls
                    organized
                    performers { id }
                    galleries { id }
                    visual_files {
                        ... on ImageFile {
                            id
                            path
                        }
                    }
                }
            }
        }
        """
        data = self.query(query_text, {
            "filter": {"per_page": 20},
            "image_filter": {
                "path": {
                    "value": path,
                    "modifier": "EQUALS",
                }
            },
        })
        images = data.get("findImages", {}).get("images", [])
        wanted = str(path or "").casefold()

        for image in images:
            for visual_file in image.get("visual_files") or []:
                if str(visual_file.get("path") or "").casefold() == wanted:
                    return image

        return None

    def find_image_by_id(self, image_id):
        query_text = """
        query BabepediaFindImageByID($id: ID!) {
            findImage(id: $id) {
                id
                title
                urls
                organized
                performers { id }
                galleries { id }
                visual_files {
                    ... on ImageFile {
                        id
                        path
                    }
                }
            }
        }
        """
        data = self.query(query_text, {"id": image_id})
        return data.get("findImage")

    def update_image_metadata(self, image, source_url, performer_ids, organized=None, gallery_id=None):
        query_text = """
        mutation BabepediaImageUpdate($input: ImageUpdateInput!) {
            imageUpdate(input: $input) {
                id
                urls
                organized
                performers { id name }
                galleries { id }
                visual_files {
                    ... on ImageFile {
                        id
                        path
                    }
                }
            }
        }
        """
        existing_urls = list(image.get("urls") or [])
        existing_performers = [item.get("id") for item in (image.get("performers") or []) if item.get("id")]
        existing_galleries = [item.get("id") for item in (image.get("galleries") or []) if item.get("id")]
        urls = list(existing_urls)
        galleries = list(existing_galleries)

        if source_url and source_url not in urls:
            urls.append(source_url)
        if gallery_id and gallery_id not in galleries:
            galleries.append(gallery_id)

        image_input = {
            "id": image["id"],
            "urls": urls,
            "performer_ids": list(dict.fromkeys(existing_performers + list(performer_ids or []))),
            "gallery_ids": galleries,
        }

        if organized is not None:
            image_input["organized"] = bool(organized)

        data = self.query(query_text, {"input": image_input})
        return data["imageUpdate"]

    def update_performer_metadata(self, performer, payload):
        existing_aliases = list(performer.get("alias_list") or [])
        existing_urls = list(performer.get("urls") or [])
        performer_name = str(performer.get("name") or "").strip().casefold()

        aliases = list(existing_aliases)
        alias_keys = {str(value or "").strip().casefold() for value in aliases if str(value or "").strip()}
        for alias in payload.get("aliases") or []:
            cleaned = str(alias or "").strip()
            if not cleaned:
                continue
            key = cleaned.casefold()
            if key == performer_name or key in alias_keys:
                continue
            aliases.append(cleaned)
            alias_keys.add(key)

        urls = list(existing_urls)
        for url in payload.get("urls") or []:
            cleaned = str(url or "").strip()
            if cleaned and cleaned not in urls:
                urls.append(cleaned)

        update_input = {"id": performer["id"]}

        if aliases != existing_aliases:
            update_input["alias_list"] = aliases
        if urls != existing_urls:
            update_input["urls"] = urls

        for field in (
            "birthdate",
            "ethnicity",
            "country",
            "eye_color",
            "height_cm",
            "measurements",
            "fake_tits",
            "career_length",
            "tattoos",
            "piercings",
            "details",
            "death_date",
            "hair_color",
            "weight",
        ):
            current_value = performer.get(field)
            wanted_value = payload.get(field)
            if wanted_value in (None, "", []):
                continue
            if current_value in (None, "", []):
                update_input[field] = wanted_value

        if len(update_input) == 1:
            return performer, False

        query_text = """
        mutation BabepediaPerformerUpdate($input: PerformerUpdateInput!) {
            performerUpdate(input: $input) {
                id
                name
                urls
                alias_list
                gender
                birthdate
                ethnicity
                country
                eye_color
                height_cm
                measurements
                fake_tits
                career_length
                tattoos
                piercings
                details
                death_date
                hair_color
                weight
            }
        }
        """
        data = self.query(query_text, {"input": update_input})
        return data["performerUpdate"], True

    def start_scan(self, paths):
        query_text = """
        mutation BabepediaMetadataScan($input: ScanMetadataInput!) {
            metadataScan(input: $input)
        }
        """
        data = self.query(query_text, {
            "input": {
                "paths": list(dict.fromkeys(paths or [])),
            }
        })
        return data["metadataScan"]


class BabepediaSearchResultParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        attrs = dict(attrs)
        classes = str(attrs.get("class") or "").split()
        href = str(attrs.get("href") or "").strip()
        if "img" not in classes or not href:
            return
        self.links.append(href)


class BabepediaClient:
    def __init__(self):
        self.ssl_context = ssl.create_default_context()
        self._scraper = None

    def _default_headers(self, referer=None, accept=None):
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": accept or "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        if referer:
            headers["Referer"] = referer
        return headers

    def _cloudflare_blocked(self, status_code, body):
        if status_code not in (403, 503):
            return False
        text = str(body or "")[:4096].lower()
        return any(marker in text for marker in (
            "cloudflare",
            "cf-ray",
            "cf-chl",
            "challenge-platform",
            "just a moment",
            "attention required",
        ))

    def _ensure_cloudscraper(self):
        if self._scraper is not None:
            return self._scraper

        if str(VENDOR_DIR) not in sys.path:
            sys.path.insert(0, str(VENDOR_DIR))

        try:
            import cloudscraper  # type: ignore
        except ImportError:
            raise RuntimeError(
                "Babepedia is returning a Cloudflare challenge. Install the "
                "'cloudscraper' Python package in the Stash plugin environment "
                "to enable Babepedia fallback scraping."
            )

        self._scraper = cloudscraper.create_scraper()
        return self._scraper

    def _request_with_urllib(self, method, url, headers=None, data=None):
        request = Request(url, headers=headers or {}, data=data, method=method)
        with urlopen(request, context=self.ssl_context, timeout=60) as response:
            body = response.read()
            final_url = response.geturl()
            status_code = getattr(response, "status", 200)
            response_headers = dict(response.info().items())
        return status_code, final_url, response_headers, body

    def _request_with_cloudscraper(self, method, url, headers=None, data=None):
        scraper = self._ensure_cloudscraper()
        response = scraper.request(method, url, headers=headers or {}, data=data, timeout=60)
        return response.status_code, response.url, dict(response.headers), response.content

    def request(self, method, url, headers=None, data=None, allow_cloudscraper=True):
        validate_babepedia_url(url)
        headers = dict(headers or {})

        try:
            status_code, final_url, response_headers, body = self._request_with_urllib(method, url, headers=headers, data=data)
            if self._cloudflare_blocked(status_code, body.decode("utf-8", errors="replace")) and allow_cloudscraper:
                status_code, final_url, response_headers, body = self._request_with_cloudscraper(method, url, headers=headers, data=data)
        except HTTPError as error:
            body = error.read()
            body_text = body.decode("utf-8", errors="replace")
            if allow_cloudscraper and self._cloudflare_blocked(error.code, body_text):
                status_code, final_url, response_headers, body = self._request_with_cloudscraper(method, url, headers=headers, data=data)
            else:
                raise RuntimeError("Babepedia request failed with HTTP " + str(error.code) + ": " + body_text[:500])
        except URLError as error:
            raise RuntimeError("Babepedia request failed: " + str(error.reason))

        if status_code >= 400:
            raise RuntimeError("Babepedia request failed with HTTP " + str(status_code))

        validate_babepedia_url(final_url)

        return {
            "status_code": status_code,
            "url": final_url,
            "headers": response_headers,
            "body": body,
        }

    def get_text(self, url, referer=None, accept=None):
        response = self.request("GET", url, headers=self._default_headers(referer=referer, accept=accept))
        return response["body"].decode("utf-8", errors="replace"), response["url"]

    def get_json(self, url, params=None, referer=None):
        params = params or {}
        query_string = urlencode(params)
        request_url = url + (("&" if "?" in url else "?") + query_string if query_string else "")
        response = self.request(
            "GET",
            request_url,
            headers=self._default_headers(
                referer=referer,
                accept="application/json, text/javascript, */*; q=0.01",
            ),
        )
        try:
            payload = json.loads(response["body"].decode("utf-8", errors="replace"))
        except json.JSONDecodeError as error:
            raise RuntimeError("Babepedia JSON response was invalid: " + str(error))
        return payload, response["url"]

    def download(self, url, destination, referer):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)

        if destination.exists() and destination.stat().st_size > 0:
            return {
                "path": str(destination),
                "downloaded": False,
                "size": destination.stat().st_size,
            }

        temp_path = destination.with_name(destination.name + ".part")
        headers = self._default_headers(
            referer=referer,
            accept="image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        )

        try:
            if self._scraper is not None:
                response = self._ensure_cloudscraper().get(url, headers=headers, timeout=60, stream=True)
                body_text = ""
                try:
                    body_text = response.text[:4096]
                except Exception:
                    body_text = ""
                if self._cloudflare_blocked(response.status_code, body_text):
                    raise RuntimeError("Babepedia image request was blocked by Cloudflare")
                response.raise_for_status()
                with open(temp_path, "wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        if chunk:
                            output.write(chunk)
            else:
                request = Request(url, headers=headers, method="GET")
                with urlopen(request, context=self.ssl_context, timeout=60) as response:
                    with open(temp_path, "wb") as output:
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            output.write(chunk)

            if not temp_path.exists() or temp_path.stat().st_size == 0:
                raise RuntimeError("Downloaded file is empty")

            os.replace(str(temp_path), str(destination))
            return {
                "path": str(destination),
                "downloaded": True,
                "size": destination.stat().st_size,
            }
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if self._cloudflare_blocked(error.code, body):
                self._ensure_cloudscraper()
                return self.download(url, destination, referer)
            raise RuntimeError("Babepedia image download failed with HTTP " + str(error.code))
        except Exception:
            try:
                if temp_path.exists():
                    temp_path.unlink()
            except OSError:
                pass
            raise

    def search_performers(self, query):
        search_name = str(query or "").replace("-", " ").strip()
        payload, _ = self.get_json(BASE_URL + "/ajax-search.php", params={"term": search_name}, referer=BASE_URL + "/")
        results = []
        seen = set()

        for item in payload or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("label") or "").strip()
            slug = str(item.get("value") or "").strip()
            if not name or not slug:
                continue
            url = validate_babepedia_url(
                BASE_URL + "/babe/" + quote(slug.replace(" ", "_"), safe="_()-'")
            )
            if url in seen:
                continue
            seen.add(url)
            results.append({
                "name": name,
                "url": url,
            })

        return results

    def load_performer(self, url):
        validate_babepedia_url(url)
        html_text, final_url = self.get_text(url, referer=BASE_URL + "/")
        performer = parse_babepedia_performer(html_text, final_url)
        performer["url"] = final_url
        return performer


def strip_tags(value):
    text = re.sub(r"<br\s*/?>", "\n", str(value or ""), flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\r", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def extract_first_group(pattern, text, default=""):
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return default
    return match.group(1)


def extract_labeled_span_html(text, label):
    pattern = (
        r"<span[^>]*>\s*" + re.escape(label) + r":?\s*</span>"
        r"\s*<span[^>]*>(.*?)</span>"
    )
    return extract_first_group(pattern, text)


def parse_birthdate(value):
    value = strip_tags(value)
    if not value:
        return None
    year_match = re.fullmatch(r"\d{4}", value)
    if year_match:
        return value
    cleaned = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", value)
    try:
        return datetime.strptime(cleaned, "%d of %B %Y").date().isoformat()
    except ValueError:
        return None


def parse_death_date(value):
    value = strip_tags(value)
    if not value:
        return None
    cleaned = re.sub(r"\w+\s+(\d+)(?:st|nd|rd|th)\s+of\s+(\w+)\s+(\d+).*", r"\1 \2 \3", value)
    try:
        return datetime.strptime(cleaned, "%d %B %Y").date().isoformat()
    except ValueError:
        return None


def parse_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def sanitize_fake_tits(value):
    mapping = {
        "fake/enhanced": "Fake",
        "real/natural": "Natural",
        "fake": "Fake",
        "enhanced": "Fake",
        "augmented": "Fake",
        "natural": "Natural",
        "real": "Natural",
    }
    cleaned = str(value or "").strip().lower()
    return mapping.get(cleaned)


def parse_babepedia_performer(html_text, page_url):
    name = strip_tags(extract_first_group(r"<h1[^>]*id=[\"']babename[\"'][^>]*>(.*?)</h1>", html_text))
    if not name:
        raise RuntimeError("Could not find Babepedia performer name.")

    alias_text = strip_tags(extract_first_group(r"<h2[^>]*id=[\"']aka[\"'][^>]*>(.*?)</h2>", html_text))
    aliases = []
    if alias_text:
        aliases = [item.strip() for item in alias_text.split(" - ") if item.strip()]

    birthdate = parse_birthdate(extract_labeled_span_html(html_text, "Born"))
    death_date = parse_death_date(extract_labeled_span_html(html_text, "Died"))
    career_length = strip_tags(extract_labeled_span_html(html_text, "Years active")) or None
    ethnicity = strip_tags(extract_labeled_span_html(html_text, "Ethnicity")) or None
    eye_color = strip_tags(extract_labeled_span_html(html_text, "Eye color")) or None
    hair_color = strip_tags(extract_labeled_span_html(html_text, "Hair color")) or None
    measurements = strip_tags(extract_labeled_span_html(html_text, "Measurements")) or None
    cup_size = strip_tags(extract_labeled_span_html(html_text, "Bra/cup size")) or None
    tattoos = strip_tags(extract_labeled_span_html(html_text, "Tattoos")) or None
    piercings = strip_tags(extract_labeled_span_html(html_text, "Piercings")) or None
    breast_type = strip_tags(extract_labeled_span_html(html_text, "Boobs")) or None
    details = strip_tags(extract_first_group(r"<p[^>]*id=[\"']biotext[\"'][^>]*>(.*?)</p>", html_text)) or None

    if tattoos == "None":
        tattoos = None
    if piercings == "None":
        piercings = None

    height_text = strip_tags(extract_labeled_span_html(html_text, "Height"))
    weight_text = strip_tags(extract_labeled_span_html(html_text, "Weight"))
    height_cm = None
    weight = None

    height_match = re.search(r"(\d+)\s*cm", height_text or "", flags=re.IGNORECASE)
    if height_match:
        height_cm = parse_int(height_match.group(1))

    weight_match = re.search(r"(\d+)\s*kg", weight_text or "", flags=re.IGNORECASE)
    if weight_match:
        weight = parse_int(weight_match.group(1))

    if measurements and cup_size:
        measurement_match = re.search(r"(\d+)(?:–|-)(\d+)(?:–|-)(\d+)", measurements)
        if measurement_match:
            measurements = cup_size + "-" + measurement_match.group(2) + "-" + measurement_match.group(3)

    nationality_html = extract_labeled_span_html(html_text, "Nationality")
    country = None
    nationality_text = strip_tags(nationality_html)
    if nationality_text:
        country = re.split(r"\s*/\s*|\s*,\s*|\s+-\s+", nationality_text, maxsplit=1)[0].strip() or None

    social_urls = []
    social_block = extract_first_group(r"<div[^>]*id=[\"']socialicons[\"'][^>]*>(.*?)</div>", html_text)
    for href in re.findall(r"<a[^>]+href=[\"']([^\"']+)[\"']", social_block or "", flags=re.IGNORECASE):
        cleaned = str(href or "").strip()
        if not cleaned:
            continue
        if cleaned.startswith("https://www.babepedia.com/onlyfans/"):
            cleaned = cleaned.replace("https://www.babepedia.com/onlyfans/", "https://onlyfans.com/", 1)
        elif cleaned.startswith("/onlyfans/"):
            cleaned = BASE_URL + cleaned
            cleaned = cleaned.replace("https://www.babepedia.com/onlyfans/", "https://onlyfans.com/", 1)
        elif cleaned.startswith("/"):
            cleaned = urljoin(BASE_URL, cleaned)
        social_urls.append(cleaned)

    image_parser = BabepediaSearchResultParser()
    image_parser.feed(html_text)
    image_urls = []
    seen_urls = set()
    for href in image_parser.links:
        absolute = urljoin(page_url, href)
        if absolute in seen_urls:
            continue
        seen_urls.add(absolute)
        image_urls.append({
            "url": absolute,
            "thumbnail": absolute,
        })

    performer_urls = [page_url]
    for social_url in social_urls:
        if social_url not in performer_urls:
            performer_urls.append(social_url)

    return {
        "name": name,
        "aliases": aliases,
        "birthdate": birthdate,
        "death_date": death_date,
        "career_length": career_length or None,
        "ethnicity": ethnicity or None,
        "country": country,
        "eye_color": eye_color or None,
        "hair_color": "Brunette" if str(hair_color or "").strip().lower() == "brown" else (hair_color or None),
        "height_cm": height_cm,
        "weight": weight,
        "measurements": measurements or None,
        "fake_tits": sanitize_fake_tits(breast_type),
        "tattoos": tattoos,
        "piercings": piercings,
        "details": details,
        "urls": performer_urls,
        "images": image_urls,
        "image_count": len(image_urls),
    }


def load_import_history():
    if not HISTORY_FILE.exists():
        return {}
    try:
        payload = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def save_import_history(history):
    write_json_atomic(HISTORY_FILE, history or {})


def history_entry_for_source(history, source_url):
    item = (history or {}).get(source_url)
    if not isinstance(item, dict):
        return None
    path = str(item.get("path") or "").strip()
    if not path or not os.path.isfile(path):
        return None
    return item


def existing_path_from_image(image):
    if not isinstance(image, dict):
        return None
    for visual_file in image.get("visual_files") or []:
        path = str(visual_file.get("path") or "").strip()
        if path and os.path.isfile(path):
            return path
    return None


def get_environment(stash):
    environment = stash.get_plugin_environment()
    settings = environment.get("settings") or {}
    output_path = str(settings.get("outputPath") or "").strip()
    image_library_paths = []

    for item in environment.get("stashes") or []:
        if item.get("excludeImage"):
            continue
        path = str(item.get("path") or "").strip()
        if path:
            image_library_paths.append(path)

    output_valid = False
    if output_path:
        for library_path in image_library_paths:
            if is_within_path(output_path, library_path):
                output_valid = True
                break

    return {
        "output_path": output_path,
        "image_library_paths": image_library_paths,
        "output_valid": output_valid,
        "organized": boolean_setting(settings, "organized", False),
        "sync_performer_metadata": boolean_setting(settings, "syncPerformerMetadata", True),
    }


def require_output_path(environment):
    output_path = environment.get("output_path") or ""
    if not output_path:
        raise RuntimeError(
            "Babepedia Gallery Importer download folder is empty. "
            "Set it first in Settings > Plugins > Babepedia Gallery Importer."
        )
    if not environment.get("output_valid"):
        library_text = ", ".join(environment.get("image_library_paths") or [])
        raise RuntimeError(
            "The Babepedia download folder must be inside a Stash library path that scans images. "
            "Current image library paths: " + library_text
        )
    return Path(output_path)


def normalize_selection(selection):
    normalized = []
    seen = set()

    for item in selection or []:
        if isinstance(item, dict):
            source_url = str(item.get("url") or "").strip()
        else:
            source_url = str(item or "").strip()
        if not source_url or source_url in seen:
            continue
        seen.add(source_url)
        normalized.append(source_url)

    return normalized


def parse_json_arg(args, key, default):
    raw = args.get(key)
    if raw in (None, ""):
        return default
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return default


def search_performer(client, query, request_id=None):
    write_progress(request_id, "search", "Searching Babepedia", detail=query)
    results = client.search_performers(query)
    return {
        "status": "ok",
        "mode": "search_performer",
        "query": query,
        "results": results,
    }


def load_performer(client, stash, url, performer_id=None, request_id=None):
    write_progress(request_id, "load", "Loading Babepedia performer", detail=url)
    performer = client.load_performer(url)
    target = None

    if performer_id:
        target = stash.find_performer_by_id(performer_id)

    return {
        "status": "ok",
        "mode": "load_performer",
        "performer": performer,
        "target_performer": {
            "id": target.get("id"),
            "name": target.get("name"),
        } if target else None,
    }


def preflight_import(stash, performer_id, selection, request_id=None):
    environment = get_environment(stash)
    require_output_path(environment)
    target = stash.find_performer_by_id(performer_id)
    if not target:
        raise RuntimeError("The active Stash performer could not be found.")

    selected_urls = normalize_selection(selection)
    if not selected_urls:
        raise RuntimeError("No Babepedia images are selected.")

    history = load_import_history()
    existing_count = 0
    reusable_file_count = 0
    new_count = 0

    for index, source_url in enumerate(selected_urls, start=1):
        validate_babepedia_url(source_url)
        write_progress(request_id, "preflight", "Checking selected images", current=index, total=len(selected_urls), detail=source_url)
        image = stash.find_image_by_url(source_url)
        if image:
            existing_count += 1
            continue
        history_entry = history_entry_for_source(history, source_url)
        if history_entry:
            reusable_file_count += 1
            continue
        new_count += 1

    return {
        "status": "ok",
        "mode": "preflight_import",
        "selection_count": len(selected_urls),
        "existing_count": existing_count,
        "reusable_file_count": reusable_file_count,
        "new_count": new_count,
        "target_performer": {
            "id": target.get("id"),
            "name": target.get("name"),
        },
    }


def prepare_import(client, stash, performer_id, performer_url, selection, request_id=None):
    environment = get_environment(stash)
    output_root = require_output_path(environment)
    target = stash.find_performer_by_id(performer_id)
    if not target:
        raise RuntimeError("The active Stash performer could not be found.")

    performer = client.load_performer(performer_url)
    selected_urls = normalize_selection(selection)
    if not selected_urls:
        raise RuntimeError("No Babepedia images are selected.")

    image_lookup = {item.get("url"): item for item in performer.get("images") or [] if item.get("url")}
    missing_from_page = [url for url in selected_urls if url not in image_lookup]
    if missing_from_page:
        raise RuntimeError("Some selected images are no longer present on the Babepedia page.")

    performer_folder = output_root / sanitize_component(target.get("name") or performer.get("name"), max_length=80)
    history = load_import_history()
    entries = []
    scan_paths = []
    downloaded = 0
    reused = 0
    failed = []

    for index, source_url in enumerate(selected_urls, start=1):
        validate_babepedia_url(source_url)
        write_progress(request_id, "download", "Preparing selected image", current=index, total=len(selected_urls), detail=source_url)
        existing_image = stash.find_image_by_url(source_url)
        if existing_image:
            reused += 1
            entries.append({
                "source_url": source_url,
                "path": existing_path_from_image(existing_image),
                "existing_image_id": existing_image.get("id"),
            })
            continue

        history_entry = history_entry_for_source(history, source_url)
        if history_entry:
            reused += 1
            history_path = str(history_entry.get("path") or "").strip()
            entry = {
                "source_url": source_url,
                "path": history_path,
                "existing_image_id": None,
            }
            entries.append(entry)
            if history_path and not stash.find_image_by_path(history_path):
                scan_paths.append(history_path)
            continue

        filename = Path(urlparse(source_url).path).name.strip() or ("image-" + str(index) + ".jpg")
        destination = safe_destination_path(performer_folder, filename, source_url)

        try:
            result = client.download(source_url, destination, referer=performer.get("url"))
            if result.get("downloaded"):
                downloaded += 1
            else:
                reused += 1
            path = str(result.get("path") or destination)
            entries.append({
                "source_url": source_url,
                "path": path,
                "existing_image_id": None,
            })
            if path and not stash.find_image_by_path(path):
                scan_paths.append(path)
        except Exception as error:
            failed.append({
                "url": source_url,
                "error": str(error),
            })
            log("Image download failed and was skipped: " + source_url + " · " + str(error))

    import_id = uuid.uuid4().hex
    manifest = {
        "import_id": import_id,
        "created_at": time.time(),
        "performer_id": performer_id,
        "performer_url": performer.get("url"),
        "metadata": {
            key: performer.get(key)
            for key in (
                "name",
                "aliases",
                "birthdate",
                "death_date",
                "career_length",
                "ethnicity",
                "country",
                "eye_color",
                "hair_color",
                "height_cm",
                "weight",
                "measurements",
                "fake_tits",
                "tattoos",
                "piercings",
                "details",
                "urls",
            )
        },
        "entries": entries,
        "organized": bool(environment.get("organized")),
        "sync_performer_metadata": bool(environment.get("sync_performer_metadata")),
    }
    write_json_atomic(STATE_DIR / (import_id + ".json"), manifest)

    scan_job_id = None
    unique_scan_paths = list(dict.fromkeys([path for path in scan_paths if path]))
    if unique_scan_paths:
        write_progress(request_id, "scan", "Starting the Stash scan", current=len(unique_scan_paths), total=len(unique_scan_paths), detail="New Babepedia files are ready for indexing")
        scan_job_id = stash.start_scan(unique_scan_paths)
    else:
        write_progress(request_id, "reuse", "Reusing existing Stash images", detail="No new files need to be scanned")

    return {
        "status": "ok",
        "mode": "prepare_import",
        "import_id": import_id,
        "scan_job_id": scan_job_id,
        "requested": len(selected_urls),
        "downloaded": downloaded,
        "reused": reused,
        "failed_count": len(failed),
        "failed": failed,
    }


def finalize_import(stash, import_id, request_id=None):
    manifest_path = STATE_DIR / (import_id + ".json")
    if not manifest_path.exists():
        raise RuntimeError("Babepedia import state was not found: " + import_id)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    target = stash.find_performer_by_id(manifest.get("performer_id"))
    if not target:
        raise RuntimeError("The active Stash performer could not be found during finalize.")

    updated_count = 0
    missing = []
    history = load_import_history()
    gallery_id = None
    gallery_title = None

    performer_url = str(manifest.get("performer_url") or "").strip()
    if performer_url:
        write_progress(request_id, "gallery", "Preparing Stash gallery", detail=performer_url)
        gallery_title = str(target.get("name") or "Babepedia").strip() + " · Babepedia"
        existing_gallery = stash.find_gallery_by_url(performer_url, performer_id=target.get("id"))
        if existing_gallery:
            updated_gallery = stash.update_gallery_metadata(
                gallery=existing_gallery,
                title=gallery_title,
                url=performer_url,
                performer_ids=[target.get("id")],
                organized=manifest.get("organized"),
            )
        else:
            updated_gallery = stash.create_gallery(
                title=gallery_title,
                url=performer_url,
                performer_ids=[target.get("id")],
                organized=manifest.get("organized"),
            )
        gallery_id = updated_gallery.get("id")
        gallery_title = updated_gallery.get("title") or gallery_title

    entries = manifest.get("entries") or []
    for index, entry in enumerate(entries, start=1):
        write_progress(request_id, "finalize", "Applying Stash metadata", current=index, total=len(entries), detail=entry.get("source_url"))
        image = None
        existing_image_id = entry.get("existing_image_id")
        path = entry.get("path")
        source_url = entry.get("source_url")

        if existing_image_id:
            image = stash.find_image_by_id(existing_image_id)
        if not image and path:
            image = stash.find_image_by_path(path)
        if not image and source_url:
            image = stash.find_image_by_url(source_url)

        if not image:
            missing.append({
                "path": path,
                "source_url": source_url,
            })
            continue

        updated_image = stash.update_image_metadata(
            image=image,
            source_url=source_url,
            performer_ids=[target.get("id")],
            organized=manifest.get("organized"),
            gallery_id=gallery_id,
        )
        updated_count += 1

        if source_url:
            current_path = existing_path_from_image(updated_image) or path
            history[source_url] = {
                "id": updated_image.get("id"),
                "path": current_path,
                "updated_at": time.time(),
            }

    performer_updated = False
    if manifest.get("sync_performer_metadata"):
        _, performer_updated = stash.update_performer_metadata(target, manifest.get("metadata") or {})

    save_import_history(history)

    try:
        manifest_path.unlink()
    except OSError:
        pass

    return {
        "status": "ok",
        "mode": "finalize_import",
        "updated_count": updated_count,
        "missing_count": len(missing),
        "missing": missing,
        "performer_updated": performer_updated,
        "gallery_id": gallery_id,
        "gallery_title": gallery_title,
    }


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "No Stash plugin input was received."}))
        return

    data = json.loads(raw)
    args = data.get("args") or {}
    server_connection = data.get("server_connection")
    mode = str(args.get("mode") or "").strip()

    ensure_cache_for_stash_process()
    cleanup_old_files(CACHE_DIR, 3600)
    cleanup_old_files(STATE_DIR, 86400)

    if mode == "clear_cache":
        removed = clear_cache_files()
        print(json.dumps({
            "output": {
                "message": "Babepedia cache cleared. " + str(removed) + " cached file(s) removed.",
            }
        }))
        return

    if mode == "ui_status":
        print(json.dumps({
            "output": {
                "message": "Open a performer page and use the Babepedia tab to browse and import images.",
            }
        }))
        return

    if not mode:
        print(json.dumps({
            "output": {
                "message": "Open a performer page and use the Babepedia tab to browse and import images.",
            }
        }))
        return

    request_id = str(args.get("request_id") or "").strip()
    if not request_id:
        raise ValueError("No request_id was provided.")
    if not server_connection:
        raise ValueError("No server_connection was received from Stash.")

    write_cache(request_id, {
        "status": "pending",
    })
    write_progress(request_id, "queued", "Waiting for Babepedia task")

    client = BabepediaClient()
    global stash
    stash = Stash(server_connection)

    try:
        if mode == "search_performer":
            query = str(args.get("query") or "").strip()
            if not query:
                raise ValueError("Enter a Babepedia performer to search.")
            payload = search_performer(client, query, request_id=request_id)
        elif mode == "load_performer":
            url = str(args.get("url") or "").strip()
            performer_id = str(args.get("performer_id") or "").strip()
            if not url:
                raise ValueError("No Babepedia performer URL was provided.")
            payload = load_performer(client, stash, url, performer_id=performer_id or None, request_id=request_id)
        elif mode == "preflight_import":
            performer_id = str(args.get("performer_id") or "").strip()
            selection = parse_json_arg(args, "selection_json", [])
            if not performer_id:
                raise ValueError("No target performer was provided.")
            payload = preflight_import(stash, performer_id, selection, request_id=request_id)
        elif mode == "prepare_import":
            performer_id = str(args.get("performer_id") or "").strip()
            performer_url = str(args.get("performer_url") or "").strip()
            selection = parse_json_arg(args, "selection_json", [])
            if not performer_id:
                raise ValueError("No target performer was provided.")
            if not performer_url:
                raise ValueError("No Babepedia performer URL was provided.")
            payload = prepare_import(client, stash, performer_id, performer_url, selection, request_id=request_id)
        elif mode == "finalize_import":
            import_id = str(args.get("import_id") or "").strip()
            if not import_id:
                raise ValueError("No import_id was provided.")
            payload = finalize_import(stash, import_id, request_id=request_id)
        else:
            raise ValueError("Unknown Babepedia mode: " + repr(mode))

        write_cache(request_id, payload)
        print(json.dumps({"output": {"request_id": request_id}}))
    except Exception as error:
        log(str(error))
        write_cache(request_id, {
            "status": "error",
            "error": str(error),
        })
        print(json.dumps({"output": {"request_id": request_id}}))


if __name__ == "__main__":
    main()
