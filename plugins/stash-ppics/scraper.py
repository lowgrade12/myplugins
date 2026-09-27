from urllib.request import Request, urlopen
from urllib.parse import quote, urlencode, urljoin, urlparse
from html.parser import HTMLParser

import hashlib
import json
import math
import os
import random
import re
import ssl
import time


BASE_URL = "https://www.pornpics.com"
SEARCH_INDEX_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


class PageLabelParser(HTMLParser):
    def __init__(self):
        super().__init__(
            convert_charrefs=True
        )

        self.h1_depth = 0
        self.title_depth = 0
        self.h1_parts = []
        self.title_parts = []
        self.og_title = ""

    def handle_starttag(
        self,
        tag,
        attrs
    ):
        attrs = dict(attrs)

        if tag == "h1":
            self.h1_depth += 1

        if tag == "title":
            self.title_depth += 1

        if tag == "meta":
            property_name = str(
                attrs.get("property") or ""
            ).strip().lower()

            name = str(
                attrs.get("name") or ""
            ).strip().lower()

            if (
                property_name == "og:title"
                or name == "og:title"
            ):
                self.og_title = str(
                    attrs.get("content") or ""
                ).strip()

    def handle_data(self, data):
        if self.h1_depth > 0:
            self.h1_parts.append(
                data
            )

        if self.title_depth > 0:
            self.title_parts.append(
                data
            )

    def handle_endtag(self, tag):
        if (
            tag == "h1"
            and self.h1_depth > 0
        ):
            self.h1_depth -= 1

        if (
            tag == "title"
            and self.title_depth > 0
        ):
            self.title_depth -= 1

    def label(self):
        h1 = " ".join(
            " ".join(
                self.h1_parts
            ).split()
        ).strip()

        if h1:
            return h1

        if self.og_title:
            return " ".join(
                self.og_title.split()
            ).strip()

        title = " ".join(
            " ".join(
                self.title_parts
            ).split()
        ).strip()

        title = re.sub(
            r"\s*[-|]\s*PornPics.*$",
            "",
            title,
            flags=re.IGNORECASE
        ).strip()

        return title


class GalleryListParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)

        self.scenes = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if tag == "a":
            href = attrs.get("href", "")
            gid = attrs.get("data-gid")

            if (
                "rel-link" in classes
                and "/galleries/" in href
                and gid
            ):
                self.current = {
                    "id": gid,
                    "title": attrs.get("title"),
                    "url": urljoin(BASE_URL, href),
                    "thumbnail": None,
                }

        elif tag == "img" and self.current is not None:
            thumb = (
                attrs.get("data-src")
                or attrs.get("src")
            )

            if thumb and "1px.png" not in thumb:
                self.current["thumbnail"] = thumb

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.scenes.append(self.current)
            self.current = None


class ContextListParser(HTMLParser):
    def __init__(
        self,
        context_type
    ):
        super().__init__(
            convert_charrefs=True
        )

        self.context_type = str(
            context_type or ""
        ).strip().lower()

        self.items = []
        self.current = None
        self.parts = []

    def _accepted_path(self, href):
        path = urlparse(
            urljoin(
                BASE_URL,
                href
            )
        ).path

        if self.context_type == "performer":
            return (
                path.startswith(
                    "/pornstars/"
                )
                and path not in (
                    "/pornstars/",
                    "/pornstars/list/"
                )
                and "/list/" not in path
            )

        if self.context_type == "studio":
            return (
                path.startswith(
                    "/channels/"
                )
                and path not in (
                    "/channels/",
                    "/channels/list/"
                )
                and "/list/" not in path
            )

        if self.context_type == "tag":
            return (
                path.startswith(
                    "/tags/"
                )
                and path not in (
                    "/tags/",
                    "/tags/list/"
                )
            )

        return False

    def handle_starttag(
        self,
        tag,
        attrs
    ):
        if tag != "a":
            return

        attrs = dict(attrs)
        href = str(
            attrs.get("href") or ""
        ).strip()

        if not self._accepted_path(
            href
        ):
            return

        self.current = {
            "url": urljoin(
                BASE_URL,
                href
            )
        }

        self.parts = []

    def handle_data(self, data):
        if self.current is not None:
            self.parts.append(
                data
            )

    def handle_endtag(self, tag):
        if (
            tag != "a"
            or self.current is None
        ):
            return

        text = " ".join(
            " ".join(
                self.parts
            ).split()
        ).strip()

        count = None

        match = re.search(
            r"\(([0-9,]+)\)\s*$",
            text
        )

        if match:
            try:
                count = int(
                    match.group(1).replace(
                        ",",
                        ""
                    )
                )
            except ValueError:
                count = None

            text = re.sub(
                r"\s*\([0-9,]+\)\s*$",
                "",
                text
            ).strip()

        if text:
            self.items.append({
                "type": self.context_type,
                "value": text,
                "label": text,
                "url": self.current["url"],
                "thumbnail": None,
                "scene_count_hint": count,
                "preview_count": None
            })

        self.current = None
        self.parts = []


class GalleryParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)

        self.data = {
            "title": None,
            "studio": None,
            "date": None,
            "performers": [],
            "images": [],
            "tags": [],
        }

        self.in_h1 = False
        self.h1_parts = []

        self.gallery_info_depth = 0
        self.in_info = False

        self.reading_label = False
        self.label_parts = []
        self.section = None

        self.capture_kind = None
        self.capture_parts = []

        self.current_image = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()

        if tag == "h1":
            self.in_h1 = True
            self.h1_parts = []

        if tag == "div":
            if self.gallery_info_depth > 0:
                self.gallery_info_depth += 1
            elif "gallery-info" in classes:
                self.gallery_info_depth = 1

            self.in_info = self.gallery_info_depth > 0

        if (
            self.in_info
            and tag == "span"
            and "gallery-info__title" in classes
        ):
            self.reading_label = True
            self.label_parts = []

        if tag == "a":
            href = attrs.get("href", "")

            if (
                "rel-link" in classes
                and "cdni.pornpics.com/1280/" in href
            ):
                self.current_image = {
                    "index": len(self.data["images"]) + 1,
                    "url": href,
                    "thumbnail": None,
                }

            elif (
                self.in_info
                and href.startswith("/channels/")
                and href != "/channels/"
            ):
                self.capture_kind = "studio"
                self.capture_parts = []

            elif (
                self.in_info
                and href.startswith("/pornstars/")
                and href != "/pornstars/"
            ):
                self.capture_kind = "performer"
                self.capture_parts = []

            elif (
                self.in_info
                and self.section in ("categories", "tags")
                and href
            ):
                self.capture_kind = "tag"
                self.capture_parts = []

        if tag == "img" and self.current_image is not None:
            thumb = (
                attrs.get("data-src")
                or attrs.get("src")
            )

            if thumb and "1px.png" not in thumb:
                self.current_image["thumbnail"] = thumb

    def handle_data(self, data):
        text = data.strip()

        if not text:
            return

        if self.in_h1:
            self.h1_parts.append(text)

        if self.reading_label:
            self.label_parts.append(text)

        if self.capture_kind:
            self.capture_parts.append(text)

    def handle_endtag(self, tag):
        if tag == "h1" and self.in_h1:
            title = " ".join(self.h1_parts).strip()

            if title:
                self.data["title"] = title

            self.in_h1 = False
            self.h1_parts = []

        if tag == "span" and self.reading_label:
            label = (
                " ".join(self.label_parts)
                .replace("\xa0", " ")
                .strip()
                .rstrip(":")
                .lower()
            )

            if label == "channel":
                self.section = "channel"
            elif label == "models":
                self.section = "models"
            elif label == "categories":
                self.section = "categories"
            elif label == "tags list":
                self.section = "tags"
            elif label == "stats":
                self.section = "stats"
            else:
                self.section = None

            self.reading_label = False
            self.label_parts = []

        if tag == "a":
            if self.current_image is not None:
                self.data["images"].append(
                    self.current_image
                )
                self.current_image = None

            elif self.capture_kind:
                text = " ".join(
                    self.capture_parts
                ).strip()

                if text:
                    if self.capture_kind == "studio":
                        self.data["studio"] = text

                    elif self.capture_kind == "performer":
                        if text not in self.data["performers"]:
                            self.data["performers"].append(
                                text
                            )

                    elif self.capture_kind == "tag":
                        if text not in self.data["tags"]:
                            self.data["tags"].append(
                                text
                            )

                self.capture_kind = None
                self.capture_parts = []

        if tag == "div" and self.gallery_info_depth > 0:
            self.gallery_info_depth -= 1
            self.in_info = self.gallery_info_depth > 0

            if self.gallery_info_depth == 0:
                self.section = None


class PPics:
    BASE = BASE_URL

    def __init__(self):
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/138.0.0.0 Safari/537.36"
            ),
            "Accept": (
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,*/*;q=0.8"
            ),
        }

        self.ssl_context = (
            ssl._create_unverified_context()
        )

    def fetch_page(
        self,
        url,
        headers=None
    ):
        request_headers = dict(
            self.headers
        )

        if headers:
            request_headers.update(
                headers
            )

        req = Request(
            url,
            headers=request_headers
        )

        with urlopen(
            req,
            context=self.ssl_context,
            timeout=30
        ) as response:
            html = response.read().decode(
                "utf-8",
                errors="ignore"
            )

            final_url = str(
                response.geturl()
                or url
            )

        return html, final_url

    def fetch(
        self,
        url,
        headers=None
    ):
        html, final_url = self.fetch_page(
            url,
            headers=headers
        )

        return html

    def is_age_verification_page(
        self,
        html,
        final_url=""
    ):
        text = str(
            html or ""
        ).casefold()

        url_text = str(
            final_url or ""
        ).casefold()

        strong_markers = (
            "age verification",
            "verify your age",
            "age assurance",
            "age estimation",
            "age-verification",
            "age_verification",
            "age verification required",
            "prove your age",
            "confirm your age",
            "agechecked",
            "agecheck.com",
            "yoti",
            "veriff"
        )

        for marker in strong_markers:
            if marker in text:
                return True

        redirect_markers = (
            "age-verification",
            "age_verification",
            "verify-age",
            "verify_age",
            "age-check",
            "agecheck"
        )

        for marker in redirect_markers:
            if marker in url_text:
                return True

        return False

    def fetch_json(self, url, params, referer):
        query = urlencode(params)

        separator = "&" if "?" in url else "?"

        request_url = (
            url
            + separator
            + query
        )

        text = self.fetch(
            request_url,
            headers={
                "Accept": (
                    "application/json, "
                    "text/javascript, */*; q=0.01"
                ),
                "Referer": referer,
                "X-Requested-With": "XMLHttpRequest",
            }
        )

        return json.loads(text)

    def performer_url(self, name):
        slug = quote(
            name
            .strip()
            .lower()
            .replace(" ", "-"),
            safe="-"
        )

        return (
            self.BASE
            + "/pornstars/"
            + slug
            + "/"
        )

    def slugify(self, value):
        value = str(value or "").strip().lower()
        value = re.sub(r"\s+", "-", value)
        return quote(value, safe="-")

    def studio_url(self, name):
        return (
            self.BASE
            + "/channels/"
            + self.slugify(name)
            + "/"
        )

    def tag_urls(self, name):
        slug = self.slugify(name)

        return [
            self.BASE + "/tags/" + slug + "/",
            self.BASE + "/" + slug + "/"
        ]

    def context_url(self, context_type, value):
        context_type = str(
            context_type or "performer"
        ).strip().lower()

        if context_type == "studio":
            return self.studio_url(value)

        if context_type == "tag":
            return self.tag_urls(value)[0]

        return self.performer_url(value)

    def _search_index_path(self):
        return os.path.join(
            os.path.dirname(__file__),
            "assets",
            "cache",
            "search-index-v2.json"
        )

    def _context_index_sources(self):
        return [
            (
                "performer",
                self.BASE + "/pornstars/list/"
            ),
            (
                "studio",
                self.BASE + "/channels/list/"
            ),
            (
                "tag",
                self.BASE + "/tags/"
            )
        ]

    def _write_search_index_cache(
        self,
        payload
    ):
        path = self._search_index_path()

        os.makedirs(
            os.path.dirname(path),
            exist_ok=True
        )

        temp = (
            path
            + "."
            + str(os.getpid())
            + "."
            + str(
                int(
                    time.time() * 1000
                )
            )
            + ".tmp"
        )

        try:
            with open(
                temp,
                "w",
                encoding="utf-8"
            ) as handle:
                json.dump(
                    payload,
                    handle,
                    ensure_ascii=False
                )

            os.replace(
                temp,
                path
            )
        except OSError:
            try:
                if os.path.exists(temp):
                    os.unlink(temp)
            except OSError:
                pass

    def _load_search_index_cache(self):
        path = self._search_index_path()

        if not os.path.isfile(path):
            return None

        try:
            with open(
                path,
                "r",
                encoding="utf-8"
            ) as handle:
                data = json.load(
                    handle
                )
        except Exception:
            return None

        if not isinstance(
            data,
            dict
        ):
            return None

        if not isinstance(
            data.get("items"),
            list
        ):
            return None

        return data

    def build_context_index(self):
        cached = self._load_search_index_cache()
        now = time.time()

        if cached:
            try:
                created_at = float(
                    cached.get("created_at") or 0
                )
            except (TypeError, ValueError):
                created_at = 0

            age = max(
                0,
                now - created_at
            )

            if (
                created_at > 0
                and age < SEARCH_INDEX_MAX_AGE_SECONDS
                and cached.get("items")
            ):
                return cached

        items = []
        seen = set()

        try:
            for (
                context_type,
                url
            ) in self._context_index_sources():
                html = self.fetch(
                    url
                )

                parser = ContextListParser(
                    context_type
                )

                parser.feed(
                    html or ""
                )

                for item in parser.items:
                    key = (
                        item.get("type"),
                        str(
                            item.get("url") or ""
                        ).casefold()
                    )

                    if key in seen:
                        continue

                    seen.add(key)
                    items.append(
                        item
                    )

        except Exception:
            if cached and cached.get("items"):
                return cached

            raise

        if not items:
            if cached and cached.get("items"):
                return cached

            raise RuntimeError(
                "PornPics returned an empty performer, studio and tag index."
            )

        payload = {
            "version": 2,
            "created_at": now,
            "expires_at": (
                now
                + SEARCH_INDEX_MAX_AGE_SECONDS
            ),
            "items": items
        }

        self._write_search_index_cache(
            payload
        )

        return payload

    def _normalized_search_text(
        self,
        value
    ):
        value = str(
            value or ""
        ).casefold()

        value = re.sub(
            r"[^a-z0-9]+",
            " ",
            value
        )

        return " ".join(
            value.split()
        )

    def _context_match_score(
        self,
        label,
        query
    ):
        label_norm = self._normalized_search_text(
            label
        )

        query_norm = self._normalized_search_text(
            query
        )

        if not query_norm:
            return None

        if label_norm == query_norm:
            return 0

        if label_norm.startswith(
            query_norm
        ):
            return (
                100
                + len(label_norm)
                - len(query_norm)
            )

        words = label_norm.split()

        for index, word in enumerate(words):
            if word.startswith(
                query_norm
            ):
                return (
                    200
                    + index * 10
                    + len(label_norm)
                )

        if query_norm in label_norm:
            return (
                300
                + label_norm.index(
                    query_norm
                )
                + len(label_norm)
            )

        query_words = query_norm.split()

        if (
            len(query_words) > 1
            and all(
                word in label_norm
                for word in query_words
            )
        ):
            return (
                400
                + len(label_norm)
            )

        return None

    def search_context_index(
        self,
        query,
        context_type="all"
    ):
        query = str(
            query or ""
        ).strip()

        context_type = str(
            context_type or "all"
        ).strip().lower()

        if len(query) < 2:
            return []

        index = self.build_context_index()
        items = index.get(
            "items"
        ) or []

        if context_type == "all":
            allowed = {
                "performer",
                "studio",
                "tag"
            }

            limits = {
                "performer": 8,
                "studio": 8,
                "tag": 10
            }
        else:
            allowed = {
                context_type
            }

            limits = {
                context_type: 18
            }

        ranked = []

        for item in items:
            item_type = item.get(
                "type"
            )

            if item_type not in allowed:
                continue

            score = self._context_match_score(
                item.get("label"),
                query
            )

            if score is None:
                continue

            count = item.get(
                "scene_count_hint"
            )

            if not isinstance(
                count,
                int
            ):
                count = 0

            ranked.append(
                (
                    item_type,
                    score,
                    -count,
                    str(
                        item.get("label") or ""
                    ).casefold(),
                    item
                )
            )

        ranked.sort(
            key=lambda row: (
                row[1],
                row[2],
                row[3]
            )
        )

        result = []
        per_type = {}

        for row in ranked:
            item_type = row[0]
            limit = limits.get(
                item_type,
                8
            )

            count = per_type.get(
                item_type,
                0
            )

            if count >= limit:
                continue

            result.append(
                dict(
                    row[4]
                )
            )

            per_type[item_type] = (
                count + 1
            )

        return result

    def keyword_context_result(
        self,
        query
    ):
        query = str(
            query or ""
        ).strip()

        if len(query) < 2:
            return None

        try:
            scenes = self._search_scene_batch(
                query,
                0,
                self.BASE + "/"
            )
        except Exception:
            return None

        if not scenes:
            return None

        return {
            "type": "keyword",
            "value": query,
            "label": query,
            "url": "",
            "thumbnail": scenes[0].get(
                "thumbnail"
            ),
            "scene_count_hint": None,
            "preview_count": len(scenes)
        }

    def _url_input_candidate(
        self,
        value
    ):
        value = str(
            value or ""
        ).strip()

        lowered = value.lower()

        return (
            "://" in value
            or lowered.startswith(
                "pornpics.com/"
            )
            or lowered.startswith(
                "www.pornpics.com/"
            )
        )

    def _normalize_pornpics_url(
        self,
        value
    ):
        value = str(
            value or ""
        ).strip()

        if not self._url_input_candidate(
            value
        ):
            return None

        lowered = value.lower()

        if (
            lowered.startswith(
                "pornpics.com/"
            )
            or lowered.startswith(
                "www.pornpics.com/"
            )
        ):
            value = (
                "https://"
                + value
            )

        parsed = urlparse(
            value
        )

        host = str(
            parsed.hostname or ""
        ).strip().lower().rstrip(".")

        if host not in (
            "pornpics.com",
            "www.pornpics.com"
        ):
            raise ValueError(
                "That URL is not a PornPics URL."
            )

        if parsed.scheme.lower() not in (
            "http",
            "https"
        ):
            raise ValueError(
                "PornPics URLs must use HTTP or HTTPS."
            )

        path = str(
            parsed.path or "/"
        )

        path = re.sub(
            r"/+",
            "/",
            path
        )

        if not path.startswith("/"):
            path = "/" + path

        normalized = (
            self.BASE
            + path
        )

        if parsed.query:
            normalized += (
                "?"
                + parsed.query
            )

        return normalized

    def _direct_url_slug_label(
        self,
        url
    ):
        path = urlparse(
            url
        ).path

        parts = [
            part
            for part in path.split("/")
            if part
        ]

        if not parts:
            return "PornPics"

        value = parts[-1]

        value = re.sub(
            r"[-_]+",
            " ",
            value
        )

        value = " ".join(
            value.split()
        ).strip()

        if not value:
            return "PornPics"

        return value.title()

    def _page_label(
        self,
        html,
        url
    ):
        parser = PageLabelParser()

        try:
            parser.feed(
                html or ""
            )
        except Exception:
            pass

        label = parser.label()

        if label:
            return label

        return self._direct_url_slug_label(
            url
        )

    def resolve_pornpics_url(
        self,
        value
    ):
        url = self._normalize_pornpics_url(
            value
        )

        if not url:
            return None

        path = urlparse(
            url
        ).path

        if "/galleries/" in path:
            details = self.get_images(
                url
            )

            if (
                not details
                or not (
                    details.get("images")
                    or []
                )
            ):
                raise ValueError(
                    "That PornPics gallery URL could not be loaded."
                )

            scene_id = (
                "url-"
                + hashlib.sha1(
                    url.encode(
                        "utf-8"
                    )
                ).hexdigest()[:16]
            )

            thumbnail = None
            images = details.get(
                "images"
            ) or []

            if images:
                thumbnail = (
                    images[0].get(
                        "thumbnail"
                    )
                    or images[0].get(
                        "url"
                    )
                )

            return {
                "kind": "scene",
                "scene": {
                    "id": scene_id,
                    "title": (
                        details.get("title")
                        or "PornPics scene"
                    ),
                    "url": url,
                    "thumbnail": thumbnail
                }
            }

        try:
            html = self.fetch(
                url
            )
        except Exception as error:
            raise ValueError(
                "That PornPics URL could not be loaded: "
                + str(error)
            )

        scenes = self.parse_scene_list_html(
            html or ""
        )

        if not scenes:
            raise ValueError(
                "That PornPics URL does not contain a supported gallery listing."
            )

        label = self._page_label(
            html,
            url
        )

        context_type = "url"

        if re.match(
            r"^/pornstars/[^/]+/?$",
            path
        ):
            context_type = "performer"

        elif re.match(
            r"^/channels/[^/]+/?$",
            path
        ):
            context_type = "studio"

        elif re.match(
            r"^/tags/[^/]+/?$",
            path
        ):
            context_type = "tag"

        return {
            "kind": "context",
            "context": {
                "type": context_type,
                "value": label,
                "label": label,
                "url": url
            }
        }

    def resolve_context(self, context_type, value):
        context_type = str(
            context_type or ""
        ).strip().lower()
        value = str(value or "").strip()

        if context_type not in (
            "performer",
            "studio",
            "tag"
        ):
            return None

        if not value:
            return None

        urls = [
            self.context_url(
                context_type,
                value
            )
        ]

        if context_type == "tag":
            urls = self.tag_urls(value)

        for url in urls:
            try:
                html = self.fetch(url)
            except Exception:
                continue

            scenes = self.parse_scene_list_html(
                html or ""
            )

            if not scenes:
                continue

            total_count = (
                self._extract_gallery_count(
                    html
                )
                or None
            )

            thumbnail = scenes[0].get(
                "thumbnail"
            )

            return {
                "type": context_type,
                "value": value,
                "label": value,
                "url": url,
                "thumbnail": thumbnail,
                "scene_count_hint": total_count,
                "preview_count": len(scenes)
            }

        return None

    def resolve_contexts(
        self,
        query,
        context_type="all"
    ):
        query = str(
            query or ""
        ).strip()

        context_type = str(
            context_type or "all"
        ).strip().lower()

        if not query:
            return []

        result = self.search_context_index(
            query,
            context_type
        )

        if context_type == "all":
            keyword = self.keyword_context_result(
                query
            )

            if keyword:
                result.insert(
                    0,
                    keyword
                )

        return result


    def performer(self, name):
        url = self.performer_url(name)

        try:
            return self.fetch(url)
        except Exception as error:
            print("PPics: " + str(error))
            return None

    def parse_scene_list_html(self, html):
        parser = GalleryListParser()
        parser.feed(html)
        return parser.scenes

    def scene_from_json(self, item):
        if not isinstance(item, dict):
            return None

        gallery_url = (
            item.get("g_url")
            or item.get("url")
            or item.get("gallery_url")
            or ""
        )

        gallery_url = urljoin(
            self.BASE,
            str(gallery_url)
        )

        if "/galleries/" not in gallery_url:
            return None

        gallery_id = (
            item.get("gid")
            or item.get("g_id")
            or item.get("gallery_id")
            or item.get("id")
        )

        if not gallery_id:
            match = re.search(
                r"-(\d+)/?$",
                urlparse(gallery_url).path
            )

            if match:
                gallery_id = match.group(1)

        title = (
            item.get("title")
            or item.get("g_title")
            or item.get("name")
            or item.get("alt")
            or item.get("description")
        )

        if not title:
            slug = (
                urlparse(gallery_url)
                .path
                .rstrip("/")
                .split("/")[-1]
            )

            slug = re.sub(
                r"-\d+$",
                "",
                slug
            )

            title = slug.replace("-", " ").strip()

        thumbnail = (
            item.get("t_url_460")
            or item.get("t_url")
            or item.get("thumbnail")
            or item.get("thumb")
            or item.get("image")
        )

        if thumbnail:
            thumbnail = urljoin(
                self.BASE,
                str(thumbnail)
            )

        return {
            "id": str(gallery_id or gallery_url),
            "title": str(title or ""),
            "url": gallery_url,
            "thumbnail": thumbnail,
        }

    def _search_scene_batch(self, name, offset, referer):
        search_url = self.BASE + "/search/srch.php"

        batch = self.fetch_json(
            search_url,
            {
                "q": name,
                "lang": "en",
                "offset": int(offset),
                "limit": 20,
            },
            referer
        )

        if not isinstance(batch, list):
            return []

        scenes = []
        seen_urls = set()

        for item in batch:
            scene = self.scene_from_json(item)

            if not scene:
                continue

            scene_url = scene.get("url")

            if not scene_url:
                continue

            if scene_url in seen_urls:
                continue

            seen_urls.add(scene_url)
            scenes.append(scene)

        return scenes

    def _stable_random(self, seed, scope):
        raw = (
            str(seed)
            + "|"
            + str(scope)
        ).encode("utf-8")

        digest = hashlib.sha256(raw).digest()
        number = int.from_bytes(
            digest[:8],
            "big"
        )

        return random.Random(number)

    def _stable_shuffle(self, items, seed, scope):
        result = list(items)

        rng = self._stable_random(
            seed,
            scope
        )

        rng.shuffle(result)

        return result

    def _extract_gallery_count(self, html):
        if not html:
            return None

        patterns = [
            r"([\d][\d,\.\s]*)\s+galleries\b",
            r"\bgalleries\s*[:\-]\s*([\d][\d,\.\s]*)",
            r"\bgallery[_\-\s]*count\b[^0-9]{0,20}([\d][\d,\.\s]*)",
            r"\btotal[_\-\s]*galleries\b[^0-9]{0,20}([\d][\d,\.\s]*)",
        ]

        candidates = []

        for pattern in patterns:
            for match in re.findall(
                pattern,
                html,
                flags=re.IGNORECASE
            ):
                digits = re.sub(
                    r"[^0-9]",
                    "",
                    str(match)
                )

                if not digits:
                    continue

                try:
                    value = int(digits)
                except ValueError:
                    continue

                if value > 0:
                    candidates.append(value)

        if not candidates:
            return None

        return max(candidates)

    def _sequential_scene_page(
        self,
        name,
        page,
        per_page,
        seed,
        referer,
        first_scenes=None
    ):
        if first_scenes is None:
            first_html = self.performer(name)
            first_scenes = self.parse_scene_list_html(
                first_html or ""
            )

        start_index = (page - 1) * per_page
        wanted_count = per_page + 1
        collected = []

        if start_index < 20:
            collected.extend(first_scenes)

        if start_index >= 20:
            offset = 20 + (
                ((start_index - 20) // 10) * 10
            )
            local_start = (
                start_index - offset
            )
        else:
            offset = 20
            local_start = start_index

        while len(collected) < local_start + wanted_count:
            try:
                batch = self._search_scene_batch(
                    name,
                    offset,
                    referer
                )
            except Exception as error:
                print(
                    "PPics pagination error: "
                    + str(error)
                )
                break

            if not batch:
                break

            # PornPics starts JSON pagination at offset 20.
            # Subsequent requests advance by 10. Taking the first
            # 10 results from each response avoids overlap between
            # adjacent offset windows.
            collected.extend(
                batch[:10]
            )

            if len(batch) < 10:
                break

            offset += 10

            if offset > 10000:
                break

        page_items = collected[
            local_start:
            local_start + per_page
        ]

        has_next = (
            len(collected)
            > local_start + per_page
        )

        if (
            not has_next
            and len(page_items) == per_page
        ):
            has_next = True

        page_items = self._stable_shuffle(
            page_items,
            seed,
            "visible-page-" + str(page)
        )

        return {
            "scenes": page_items,
            "page": page,
            "per_page": per_page,
            "total_count": None,
            "total_pages": None,
            "has_previous": page > 1,
            "has_next": has_next,
            "randomized_source_pages": False,
        }

    def get_scenes_page(
        self,
        name,
        page=1,
        per_page=20,
        seed="",
        total_count=None
    ):
        try:
            page = int(page)
        except (TypeError, ValueError):
            page = 1

        try:
            per_page = int(per_page)
        except (TypeError, ValueError):
            per_page = 20

        if page < 1:
            page = 1

        if per_page < 1:
            per_page = 20

        if not seed:
            seed = "ppics"

        referer = self.performer_url(name)

        try:
            known_total = int(
                total_count
            )
        except (TypeError, ValueError):
            known_total = 0

        first_scenes = None

        if known_total <= 0:
            performer_html = self.performer(name)

            first_scenes = self.parse_scene_list_html(
                performer_html or ""
            )

            known_total = (
                self._extract_gallery_count(
                    performer_html
                )
                or 0
            )

        if known_total <= 0:
            return self._sequential_scene_page(
                name=name,
                page=page,
                per_page=per_page,
                seed=seed,
                referer=referer,
                first_scenes=first_scenes
            )

        total_pages = int(
            math.ceil(
                known_total
                / float(per_page)
            )
        )

        if total_pages < 1:
            total_pages = 1

        if page > total_pages:
            page = total_pages

        chunk_size = 10

        chunk_count = int(
            math.ceil(
                known_total
                / float(chunk_size)
            )
        )

        chunk_order = list(
            range(chunk_count)
        )

        chunk_order = self._stable_shuffle(
            chunk_order,
            seed,
            "source-chunks-" + name.casefold()
        )

        logical_start = (
            page - 1
        ) * per_page

        logical_end = min(
            logical_start + per_page,
            known_total
        )

        result = []
        logical_position = 0

        for chunk_index in chunk_order:
            source_start = (
                chunk_index
                * chunk_size
            )

            remaining = (
                known_total
                - source_start
            )

            expected_size = min(
                chunk_size,
                max(0, remaining)
            )

            if expected_size <= 0:
                continue

            chunk_start = logical_position
            chunk_end = (
                logical_position
                + expected_size
            )

            logical_position = chunk_end

            if chunk_end <= logical_start:
                continue

            if chunk_start >= logical_end:
                break

            local_start = max(
                0,
                logical_start - chunk_start
            )

            local_end = min(
                expected_size,
                logical_end - chunk_start
            )

            if chunk_index < 2:
                if first_scenes is None:
                    performer_html = self.performer(name)

                    first_scenes = self.parse_scene_list_html(
                        performer_html or ""
                    )

                batch = first_scenes[
                    chunk_index * 10:
                    (chunk_index + 1) * 10
                ]
            else:
                # PornPics JSON pagination does not use offset 0
                # for performer/search result pages. The first 20
                # galleries come from the HTML page. JSON continues
                # at offset 20 and then advances by 10.
                source_offset = (
                    20
                    + (
                        chunk_index - 2
                    ) * 10
                )

                try:
                    batch = self._search_scene_batch(
                        name,
                        source_offset,
                        referer
                    )
                except Exception as error:
                    print(
                        "PPics pagination error: "
                        + str(error)
                    )
                    batch = []

                batch = batch[:10]

            result.extend(
                batch[
                    local_start:
                    local_end
                ]
            )

            if len(result) >= per_page:
                break

        result = self._stable_shuffle(
            result,
            seed,
            "visible-page-" + str(page)
        )

        return {
            "scenes": result[:per_page],
            "page": page,
            "per_page": per_page,
            "total_count": known_total,
            "total_pages": total_pages,
            "has_previous": page > 1,
            "has_next": page < total_pages,
            "randomized_source_pages": True,
        }

    def _generic_search_page(
        self,
        query,
        page,
        per_page,
        seed,
        referer
    ):
        try:
            page = int(page)
        except (TypeError, ValueError):
            page = 1

        try:
            per_page = int(per_page)
        except (TypeError, ValueError):
            per_page = 20

        if page < 1:
            page = 1

        if per_page < 1:
            per_page = 20

        start_index = (
            page - 1
        ) * per_page

        first_offset = (
            start_index // 10
        ) * 10

        local_start = (
            start_index - first_offset
        )

        wanted = (
            local_start
            + per_page
            + 1
        )

        collected = []
        seen = set()
        offset = first_offset

        while len(collected) < wanted:
            try:
                batch = self._search_scene_batch(
                    query,
                    offset,
                    referer
                )
            except Exception as error:
                print(
                    "PPics pagination error: "
                    + str(error)
                )
                break

            if not batch:
                break

            usable = batch[:10]

            for scene in usable:
                scene_url = scene.get("url")

                if not scene_url:
                    continue

                if scene_url in seen:
                    continue

                seen.add(scene_url)
                collected.append(scene)

            if len(batch) < 10:
                break

            offset += 10

            if offset > 10000:
                break

        page_items = collected[
            local_start:
            local_start + per_page
        ]

        has_next = (
            len(collected)
            > local_start + per_page
        )

        if (
            not has_next
            and len(page_items) == per_page
        ):
            has_next = True

        page_items = self._stable_shuffle(
            page_items,
            seed,
            "generic-search-page-"
            + str(page)
            + "-"
            + str(query).casefold()
        )

        return {
            "scenes": page_items,
            "page": page,
            "per_page": per_page,
            "total_count": None,
            "total_pages": None,
            "has_previous": page > 1,
            "has_next": has_next,
            "randomized_source_pages": False
        }

    def _direct_context_batch(
        self,
        url,
        offset
    ):
        batch = self.fetch_json(
            url,
            {
                "offset": int(offset),
                "limit": 20
            },
            url
        )

        if not isinstance(batch, list):
            return []

        result = []
        seen = set()

        for item in batch:
            scene = self.scene_from_json(
                item
            )

            if not scene:
                continue

            scene_url = scene.get("url")

            if not scene_url:
                continue

            if scene_url in seen:
                continue

            seen.add(scene_url)
            result.append(scene)

        return result

    def _direct_context_page(
        self,
        url,
        page,
        per_page,
        seed
    ):
        try:
            page = int(page)
        except (TypeError, ValueError):
            page = 1

        try:
            per_page = int(per_page)
        except (TypeError, ValueError):
            per_page = 20

        if page < 1:
            page = 1

        if per_page < 1:
            per_page = 20

        first_html = self.fetch(url)
        first_scenes = self.parse_scene_list_html(
            first_html or ""
        )

        start_index = (
            page - 1
        ) * per_page

        wanted_count = per_page + 1
        collected = []

        if start_index < 20:
            collected.extend(
                first_scenes
            )

        if start_index >= 20:
            offset = 20 + (
                (
                    start_index - 20
                ) // 10
            ) * 10

            local_start = (
                start_index - offset
            )
        else:
            offset = 20
            local_start = start_index

        seen = {
            scene.get("url")
            for scene in collected
            if scene.get("url")
        }

        while (
            len(collected)
            < local_start + wanted_count
        ):
            try:
                batch = self._direct_context_batch(
                    url,
                    offset
                )
            except Exception as error:
                print(
                    "PPics direct pagination error: "
                    + str(error)
                )
                break

            if not batch:
                break

            for scene in batch[:10]:
                scene_url = scene.get("url")

                if not scene_url:
                    continue

                if scene_url in seen:
                    continue

                seen.add(scene_url)
                collected.append(scene)

            if len(batch) < 10:
                break

            offset += 10

            if offset > 10000:
                break

        page_items = collected[
            local_start:
            local_start + per_page
        ]

        has_next = (
            len(collected)
            > local_start + per_page
        )

        if (
            not has_next
            and len(page_items) == per_page
        ):
            has_next = True

        page_items = self._stable_shuffle(
            page_items,
            seed,
            "direct-context-page-"
            + str(page)
            + "-"
            + url
        )

        total_count = (
            self._extract_gallery_count(
                first_html
            )
            or None
        )

        total_pages = None

        if total_count:
            total_pages = int(
                math.ceil(
                    total_count
                    / float(per_page)
                )
            )

        return {
            "scenes": page_items,
            "page": page,
            "per_page": per_page,
            "total_count": total_count,
            "total_pages": total_pages,
            "has_previous": page > 1,
            "has_next": (
                page < total_pages
                if total_pages
                else has_next
            ),
            "randomized_source_pages": False
        }

    def get_context_scenes_page(
        self,
        context_type,
        value,
        page=1,
        per_page=20,
        seed="",
        total_count=None,
        context_url=None
    ):
        context_type = str(
            context_type or "performer"
        ).strip().lower()

        value = str(
            value or ""
        ).strip()

        if context_type == "performer":
            return self.get_scenes_page(
                name=value,
                page=page,
                per_page=per_page,
                seed=seed,
                total_count=total_count
            )

        if context_type == "studio":
            referer = (
                context_url
                or self.studio_url(value)
            )

            return self._generic_search_page(
                query=value,
                page=page,
                per_page=per_page,
                seed=seed,
                referer=referer
            )

        if context_type == "keyword":
            return self._generic_search_page(
                query=value,
                page=page,
                per_page=per_page,
                seed=seed,
                referer=self.BASE + "/"
            )

        if context_type == "tag":
            url = context_url

            if not url:
                resolved = self.resolve_context(
                    "tag",
                    value
                )

                if not resolved:
                    return {
                        "scenes": [],
                        "page": 1,
                        "per_page": per_page,
                        "total_count": None,
                        "total_pages": None,
                        "has_previous": False,
                        "has_next": False,
                        "randomized_source_pages": False
                    }

                url = resolved.get("url")

            return self._direct_context_page(
                url=url,
                page=page,
                per_page=per_page,
                seed=seed
            )

        if context_type == "url":
            if not context_url:
                raise ValueError(
                    "No PornPics page URL was provided."
                )

            return self._direct_context_page(
                url=context_url,
                page=page,
                per_page=per_page,
                seed=seed
            )

        raise ValueError(
            "Unsupported PornPics browse context: "
            + context_type
        )

    def get_scenes(self, name, limit=20):
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = 20

        if limit <= 0:
            limit = 20

        performer_url = self.performer_url(name)

        html = self.performer(name)

        if not html:
            return []

        scenes = self.parse_scene_list_html(
            html
        )

        seen_urls = {
            scene.get("url")
            for scene in scenes
            if scene.get("url")
        }

        if len(scenes) >= limit:
            return scenes[:limit]

        search_url = (
            self.BASE
            + "/search/srch.php"
        )

        offset = 0
        api_limit = 20
        api_step = 10

        while len(scenes) < limit:
            try:
                batch = self.fetch_json(
                    search_url,
                    {
                        "q": name,
                        "lang": "en",
                        "offset": offset,
                        "limit": api_limit,
                    },
                    performer_url
                )
            except Exception as error:
                print(
                    "PPics pagination error: "
                    + str(error)
                )
                break

            if not isinstance(batch, list):
                break

            if not batch:
                break

            added = 0

            for item in batch:
                scene = self.scene_from_json(
                    item
                )

                if not scene:
                    continue

                scene_url = scene.get("url")

                if scene_url in seen_urls:
                    continue

                seen_urls.add(scene_url)
                scenes.append(scene)
                added += 1

                if len(scenes) >= limit:
                    break

            if len(scenes) >= limit:
                break

            if len(batch) < api_step:
                break

            offset += api_step

            # Be a little polite to PPics while loading extra pages.
            time.sleep(0.35)

            # Safety stop in case PPics changes its pagination behaviour.
            if offset > 5000:
                break

            # If an API page contains only duplicates, continue because the
            # first two API pages can overlap with the initial HTML page.
            if added == 0 and offset > 100:
                # After a reasonable overlap window, repeated duplicate-only
                # pages likely mean pagination has stopped working.
                break

        return scenes[:limit]

    def parse_gallery_html(self, html):
        parser = GalleryParser()
        parser.feed(html)
        return parser.data

    def get_images(self, scene_url):
        print(
            "Opening gallery: "
            + scene_url
        )

        try:
            html, final_url = self.fetch_page(
                scene_url
            )
        except Exception as error:
            print(
                "PPics gallery error: "
                + str(error)
            )
            return None

        if self.is_age_verification_page(
            html,
            final_url
        ):
            return {
                "title":
                    self._direct_url_slug_label(
                        scene_url
                    ),
                "studio":
                    None,
                "date":
                    None,
                "performers":
                    [],
                "images":
                    [],
                "tags":
                    [],
                "age_verification_required":
                    True,
                "age_verification_url":
                    final_url
            }

        result = self.parse_gallery_html(
            html
        )

        result[
            "age_verification_required"
        ] = False

        return result


if __name__ == "__main__":
    pp = PPics()

    local_file = os.path.join(
        os.path.dirname(__file__),
        "gallery.html"
    )

    if not os.path.exists(local_file):
        print(
            "gallery.html not found next to scraper.py"
        )
        raise SystemExit(1)

    with open(
        local_file,
        "r",
        encoding="utf-8"
    ) as file_handle:
        html = file_handle.read()

    data = pp.parse_gallery_html(
        html
    )

    print(
        "=== LOCAL gallery.html test ==="
    )
    print("Title:", data["title"])
    print("Studio:", data["studio"])
    print(
        "Performers:",
        data["performers"]
    )
    print(
        "Tags:",
        len(data["tags"])
    )
    print(
        "Images:",
        len(data["images"])
    )

    if data["images"]:
        print("First image:")
        print(
            json.dumps(
                data["images"][0],
                indent=2
            )
        )
