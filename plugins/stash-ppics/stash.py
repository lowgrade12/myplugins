from difflib import SequenceMatcher
import json
import re
import socket
from urllib.error import HTTPError
from urllib.error import URLError
from urllib.request import Request
from urllib.request import urlopen


PLUGIN_ID = "stash-ppics"


def _connection_value(
    connection,
    key,
    default=None
):
    wanted = str(
        key or ""
    ).casefold()

    for current_key, value in (
        connection or {}
    ).items():
        if str(
            current_key or ""
        ).casefold() == wanted:
            return value

    return default


class Stash:
    def __init__(
        self,
        server_connection
    ):
        if not server_connection:
            raise ValueError(
                "Missing Stash server_connection"
            )

        self.server_connection = dict(
            server_connection
        )

        scheme = str(
            _connection_value(
                self.server_connection,
                "Scheme",
                "http"
            )
            or "http"
        ).strip().lower()

        host = str(
            _connection_value(
                self.server_connection,
                "Host",
                ""
            )
            or _connection_value(
                self.server_connection,
                "Domain",
                "localhost"
            )
            or "localhost"
        ).strip()

        if host == "0.0.0.0":
            host = "127.0.0.1"

        port = _connection_value(
            self.server_connection,
            "Port",
            9999
        )

        try:
            port = int(
                port
            )
        except (
            TypeError,
            ValueError
        ):
            port = 9999

        if scheme not in (
            "http",
            "https"
        ):
            raise ValueError(
                "Unsupported Stash connection scheme: "
                + scheme
            )

        url_host = host

        if (
            ":" in host
            and not host.startswith("[")
            and not host.endswith("]")
        ):
            url_host = (
                "["
                + host
                + "]"
            )

        self.graphql_url = (
            scheme
            + "://"
            + url_host
            + ":"
            + str(port)
            + "/graphql"
        )

        self.headers = {
            "Accept":
                "application/json",
            "Content-Type":
                "application/json",
            "User-Agent":
                "PornPics-Importer/1.0.1"
        }

        api_key = _connection_value(
            self.server_connection,
            "ApiKey"
        )

        if api_key:
            self.headers["ApiKey"] = str(
                api_key
            )

        session_cookie = _connection_value(
            self.server_connection,
            "SessionCookie"
        )

        session_value = ""

        if isinstance(
            session_cookie,
            dict
        ):
            session_value = str(
                _connection_value(
                    session_cookie,
                    "Value",
                    ""
                )
                or ""
            ).strip()

        elif session_cookie:
            session_value = str(
                session_cookie
            ).strip()

        if (
            session_value
            and not api_key
        ):
            self.headers[
                "Cookie"
            ] = (
                "session="
                + session_value
            )

    def _friendly_http_error(
        self,
        error,
        body=""
    ):
        code = getattr(
            error,
            "code",
            None
        )

        reason = str(
            getattr(
                error,
                "reason",
                ""
            )
            or ""
        ).strip()

        if code in (
            401,
            403
        ):
            return RuntimeError(
                "Stash rejected the plugin GraphQL request "
                + "with HTTP "
                + str(code)
                + ". Check Stash authentication or API access."
            )

        message = (
            "Stash GraphQL request failed"
        )

        if code:
            message += (
                " with HTTP "
                + str(code)
            )

        if reason:
            message += (
                " "
                + reason
            )

        body = str(
            body or ""
        ).strip()

        if body:
            message += (
                ": "
                + body[:500]
            )

        return RuntimeError(
            message
        )

    def query(
        self,
        query,
        variables=None
    ):
        payload = json.dumps(
            {
                "query":
                    str(query or ""),
                "variables":
                    variables or {}
            },
            ensure_ascii=False
        ).encode(
            "utf-8"
        )

        request = Request(
            self.graphql_url,
            data=payload,
            headers=self.headers,
            method="POST"
        )

        try:
            with urlopen(
                request,
                timeout=120
            ) as response:
                raw = response.read()

        except HTTPError as error:
            body = ""

            try:
                body = error.read().decode(
                    "utf-8",
                    errors="replace"
                )
            except Exception:
                body = ""

            raise self._friendly_http_error(
                error,
                body
            ) from error

        except (
            URLError,
            socket.timeout,
            TimeoutError
        ) as error:
            reason = str(
                getattr(
                    error,
                    "reason",
                    error
                )
            ).strip()

            message = (
                "Could not reach the Stash GraphQL endpoint at "
                + self.graphql_url
            )

            if reason:
                message += (
                    ": "
                    + reason
                )

            raise RuntimeError(
                message
            ) from error

        try:
            result = json.loads(
                raw.decode(
                    "utf-8"
                )
            )

        except Exception as error:
            raise RuntimeError(
                "Stash returned an invalid GraphQL response."
            ) from error

        if not isinstance(
            result,
            dict
        ):
            raise RuntimeError(
                "Stash returned an invalid GraphQL response."
            )

        errors = result.get(
            "errors"
        )

        if errors:
            messages = []

            for item in errors:
                if isinstance(
                    item,
                    dict
                ):
                    message = str(
                        item.get(
                            "message"
                        )
                        or ""
                    ).strip()

                    if message:
                        messages.append(
                            message
                        )

            if not messages:
                messages.append(
                    "Unknown GraphQL error"
                )

            raise RuntimeError(
                "Stash GraphQL error: "
                + " | ".join(
                    messages
                )
            )

        data = result.get(
            "data"
        )

        if not isinstance(
            data,
            dict
        ):
            raise RuntimeError(
                "Stash GraphQL response did not contain data."
            )

        return data

    def get_plugin_environment(self):
        query = """
        query PPicsPluginEnvironment(
            $plugin_ids: [ID!]
        ) {
            configuration {
                general {
                    createGalleriesFromFolders
                    stashes {
                        path
                        excludeImage
                    }
                }
                plugins(
                    include: $plugin_ids
                )
            }
        }
        """

        data = self.query(
            query,
            {
                "plugin_ids": [
                    PLUGIN_ID
                ]
            }
        )

        configuration = (
            data.get(
                "configuration"
            )
            or {}
        )

        general = (
            configuration.get(
                "general"
            )
            or {}
        )

        plugins = (
            configuration.get(
                "plugins"
            )
            or {}
        )

        settings = {}

        if isinstance(
            plugins,
            dict
        ):
            candidate = plugins.get(
                PLUGIN_ID
            )

            if isinstance(
                candidate,
                dict
            ):
                settings = candidate

        return {
            "settings":
                settings,
            "stashes":
                general.get(
                    "stashes"
                )
                or [],
            "create_galleries_from_folders":
                bool(
                    general.get(
                        "createGalleriesFromFolders"
                    )
                )
        }

    def find_performer(self, name):
        query = """
        query PPicsFindPerformers($filter: FindFilterType) {
            findPerformers(filter: $filter) {
                performers {
                    id
                    name
                    gender
                    image_path
                    alias_list
                }
            }
        }
        """

        data = self.query(query, {
            "filter": {
                "q": name,
                "per_page": 100
            }
        })

        performers = data.get("findPerformers", {}).get("performers", [])
        wanted = str(name or "").strip().casefold()

        for performer in performers:
            if performer.get("name", "").strip().casefold() == wanted:
                return performer

            for alias in performer.get("alias_list") or []:
                if str(alias or "").strip().casefold() == wanted:
                    return performer

        return None

    def create_performer(self, name):
        query = """
        mutation PPicsPerformerCreate($input: PerformerCreateInput!) {
            performerCreate(input: $input) {
                id
                name
                gender
                image_path
                alias_list
            }
        }
        """

        data = self.query(query, {
            "input": {
                "name": name
            }
        })

        return data["performerCreate"]

    def find_performer_by_id(self, performer_id):
        query = """
        query PPicsFindPerformerByID($id: ID!) {
            findPerformer(id: $id) {
                id
                name
                gender
                image_path
                alias_list
            }
        }
        """

        data = self.query(query, {
            "id": performer_id
        })

        return data.get("findPerformer")

    def update_performer_aliases(self, performer_id, aliases):
        query = """
        mutation PPicsPerformerUpdate($input: PerformerUpdateInput!) {
            performerUpdate(input: $input) {
                id
                name
                gender
                image_path
                alias_list
            }
        }
        """

        data = self.query(query, {
            "input": {
                "id": performer_id,
                "alias_list": list(dict.fromkeys(aliases or []))
            }
        })

        return data["performerUpdate"]

    def add_performer_alias(self, performer_id, alias):
        performer = self.find_performer_by_id(
            performer_id
        )

        if not performer:
            return None

        aliases = list(
            performer.get("alias_list") or []
        )
        wanted = str(alias or "").strip()

        if not wanted:
            return performer

        name_key = str(
            performer.get("name") or ""
        ).strip().casefold()

        alias_keys = {
            str(value or "").strip().casefold()
            for value in aliases
        }

        if wanted.casefold() == name_key:
            return performer

        if wanted.casefold() not in alias_keys:
            aliases.append(wanted)

            performer = self.update_performer_aliases(
                performer_id,
                aliases
            )

        return performer

    def find_studio(self, name):
        query = """
        query PPicsFindStudios($filter: FindFilterType) {
            findStudios(filter: $filter) {
                studios {
                    id
                    name
                    aliases
                    image_path
                }
            }
        }
        """

        data = self.query(query, {
            "filter": {
                "q": name,
                "per_page": 100
            }
        })

        studios = data.get("findStudios", {}).get("studios", [])
        wanted = str(name or "").strip().casefold()

        for studio in studios:
            if studio.get("name", "").strip().casefold() == wanted:
                return studio

            for alias in studio.get("aliases") or []:
                if str(alias or "").strip().casefold() == wanted:
                    return studio

        return None

    def create_studio(self, name):
        query = """
        mutation PPicsStudioCreate($input: StudioCreateInput!) {
            studioCreate(input: $input) {
                id
                name
                aliases
                image_path
            }
        }
        """

        data = self.query(query, {
            "input": {
                "name": name
            }
        })

        return data["studioCreate"]

    def find_studio_by_id(self, studio_id):
        query = """
        query PPicsFindStudioByID($id: ID!) {
            findStudio(id: $id) {
                id
                name
                aliases
                image_path
            }
        }
        """

        data = self.query(query, {
            "id": studio_id
        })

        return data.get("findStudio")

    def update_studio_aliases(self, studio_id, aliases):
        query = """
        mutation PPicsStudioUpdate($input: StudioUpdateInput!) {
            studioUpdate(input: $input) {
                id
                name
                aliases
                image_path
            }
        }
        """

        data = self.query(query, {
            "input": {
                "id": studio_id,
                "aliases": list(dict.fromkeys(aliases or []))
            }
        })

        return data["studioUpdate"]

    def add_studio_alias(self, studio_id, alias):
        studio = self.find_studio_by_id(
            studio_id
        )

        if not studio:
            return None

        aliases = list(
            studio.get("aliases") or []
        )
        wanted = str(alias or "").strip()

        if not wanted:
            return studio

        name_key = str(
            studio.get("name") or ""
        ).strip().casefold()

        alias_keys = {
            str(value or "").strip().casefold()
            for value in aliases
        }

        if wanted.casefold() == name_key:
            return studio

        if wanted.casefold() not in alias_keys:
            aliases.append(wanted)

            studio = self.update_studio_aliases(
                studio_id,
                aliases
            )

        return studio

    def find_tag(self, name):
        query = """
        query PPicsFindTags($filter: FindFilterType) {
            findTags(filter: $filter) {
                tags {
                    id
                    name
                    aliases
                }
            }
        }
        """

        data = self.query(query, {
            "filter": {
                "q": name,
                "per_page": 100
            }
        })

        tags = data.get("findTags", {}).get("tags", [])
        wanted = str(name or "").strip().casefold()

        for tag in tags:
            if tag.get("name", "").strip().casefold() == wanted:
                return tag

            for alias in tag.get("aliases") or []:
                if str(alias or "").strip().casefold() == wanted:
                    return tag

        return None

    def find_tag_by_id(self, tag_id):
        query = """
        query PPicsFindTagByID($id: ID!) {
            findTag(id: $id) {
                id
                name
                aliases
            }
        }
        """

        data = self.query(query, {
            "id": tag_id
        })

        return data.get("findTag")

    def create_tag(self, name):
        query = """
        mutation PPicsTagCreate($input: TagCreateInput!) {
            tagCreate(input: $input) {
                id
                name
                aliases
            }
        }
        """

        data = self.query(query, {
            "input": {
                "name": name
            }
        })

        return data["tagCreate"]

    def update_tag(self, tag_id, name=None, aliases=None):
        query = """
        mutation PPicsTagUpdate($input: TagUpdateInput!) {
            tagUpdate(input: $input) {
                id
                name
                aliases
            }
        }
        """

        tag_input = {
            "id": tag_id
        }

        if name:
            tag_input["name"] = name

        if aliases is not None:
            tag_input["aliases"] = list(dict.fromkeys(aliases))

        data = self.query(query, {
            "input": tag_input
        })

        return data["tagUpdate"]

    def add_tag_alias(self, tag_id, alias):
        tag = self.find_tag_by_id(tag_id)

        if not tag:
            return None

        aliases = list(tag.get("aliases") or [])
        wanted = str(alias or "").strip()

        if not wanted:
            return tag

        existing = {
            str(value or "").strip().casefold()
            for value in aliases
        }

        if wanted.casefold() == str(tag.get("name") or "").strip().casefold():
            return tag

        if wanted.casefold() not in existing:
            aliases.append(wanted)
            tag = self.update_tag(
                tag_id=tag_id,
                aliases=aliases
            )

        return tag

    def migrate_legacy_importer_tag(self):
        current = self.find_tag("PornPics Importer")

        if current:
            return current

        legacy = self.find_tag("PPics")

        if not legacy:
            return None

        aliases = list(legacy.get("aliases") or [])

        if "PPics".casefold() not in {
            str(value or "").casefold()
            for value in aliases
        }:
            aliases.append("PPics")

        return self.update_tag(
            tag_id=legacy["id"],
            name="PornPics Importer",
            aliases=aliases
        )

    def _gallery_fields(self):
        return """
            id
            title
            urls
            date
            organized
            studio {
                id
                name
            }
            performers {
                id
                name
            }
            tags {
                id
                name
            }
            scenes {
                id
                title
            }
            cover {
                id
            }
            folder {
                id
                path
            }
        """

    def find_gallery_by_url(self, url):
        query = """
        query PPicsFindGallery(
            $filter: FindFilterType,
            $gallery_filter: GalleryFilterType
        ) {
            findGalleries(
                filter: $filter,
                gallery_filter: $gallery_filter
            ) {
                galleries {
                    id
                    title
                    urls
                    date
                    organized
                    studio { id name }
                    performers { id name }
                    tags { id name }
                    scenes { id title }
                    cover { id }
                    folder { id path }
                }
            }
        }
        """

        data = self.query(query, {
            "filter": {
                "per_page": 20
            },
            "gallery_filter": {
                "url": {
                    "value": url,
                    "modifier": "EQUALS"
                }
            }
        })

        galleries = data.get("findGalleries", {}).get("galleries", [])

        for gallery in galleries:
            if url in (gallery.get("urls") or []):
                return gallery

        return None

    def find_gallery_by_id(self, gallery_id):
        query = """
        query PPicsFindGalleryByID($id: ID!) {
            findGallery(id: $id) {
                id
                title
                urls
                date
                organized
                studio { id name }
                performers { id name }
                tags { id name }
                scenes { id title }
                cover { id }
                folder { id path }
            }
        }
        """

        data = self.query(query, {
            "id": gallery_id
        })

        return data.get("findGallery")

    def create_gallery(
        self,
        title,
        url,
        performer_ids,
        studio_id=None,
        tag_ids=None,
        date=None,
        scene_ids=None,
        organized=None
    ):
        query = """
        mutation PPicsGalleryCreate($input: GalleryCreateInput!) {
            galleryCreate(input: $input) {
                id
                title
                urls
                date
                organized
                studio { id name }
                performers { id name }
                tags { id name }
                scenes { id title }
                cover { id }
                folder { id path }
            }
        }
        """

        gallery_input = {
            "title": title,
            "urls": [url],
            "performer_ids": list(dict.fromkeys(performer_ids or [])),
            "tag_ids": list(dict.fromkeys(tag_ids or [])),
            "scene_ids": list(dict.fromkeys(scene_ids or []))
        }

        if studio_id:
            gallery_input["studio_id"] = studio_id

        if date:
            gallery_input["date"] = date

        if organized is not None:
            gallery_input["organized"] = bool(organized)

        data = self.query(query, {
            "input": gallery_input
        })

        return data["galleryCreate"]

    def update_gallery_metadata(
        self,
        gallery,
        title,
        url,
        performer_ids,
        studio_id=None,
        tag_ids=None,
        date=None,
        scene_ids=None,
        organized=None
    ):
        query = """
        mutation PPicsGalleryUpdate($input: GalleryUpdateInput!) {
            galleryUpdate(input: $input) {
                id
                title
                urls
                date
                organized
                studio { id name }
                performers { id name }
                tags { id name }
                scenes { id title }
                cover { id }
                folder { id path }
            }
        }
        """

        existing_urls = gallery.get("urls") or []
        existing_performers = [
            item["id"]
            for item in (gallery.get("performers") or [])
            if item.get("id")
        ]
        existing_tags = [
            item["id"]
            for item in (gallery.get("tags") or [])
            if item.get("id")
        ]
        existing_scenes = [
            item["id"]
            for item in (gallery.get("scenes") or [])
            if item.get("id")
        ]

        merged_urls = list(dict.fromkeys(existing_urls + [url]))
        merged_performers = list(dict.fromkeys(
            existing_performers + list(performer_ids or [])
        ))
        merged_tags = list(dict.fromkeys(
            existing_tags + list(tag_ids or [])
        ))
        merged_scenes = list(dict.fromkeys(
            existing_scenes + list(scene_ids or [])
        ))

        gallery_input = {
            "id": gallery["id"],
            "urls": merged_urls,
            "performer_ids": merged_performers,
            "tag_ids": merged_tags,
            "scene_ids": merged_scenes
        }

        if title:
            gallery_input["title"] = title

        existing_studio = gallery.get("studio")

        if existing_studio and existing_studio.get("id"):
            gallery_input["studio_id"] = existing_studio["id"]
        elif studio_id:
            gallery_input["studio_id"] = studio_id

        if gallery.get("date"):
            gallery_input["date"] = gallery["date"]
        elif date:
            gallery_input["date"] = date

        if organized is not None:
            gallery_input["organized"] = bool(organized)

        data = self.query(query, {
            "input": gallery_input
        })

        return data["galleryUpdate"]

    def set_gallery_cover(self, gallery_id, image_id):
        query = """
        mutation PPicsGallerySetCover($input: GallerySetCoverInput!) {
            setGalleryCover(input: $input)
        }
        """

        data = self.query(query, {
            "input": {
                "gallery_id": gallery_id,
                "cover_image_id": image_id
            }
        })

        return bool(data.get("setGalleryCover"))

    def destroy_gallery(self, gallery_id):
        query = """
        mutation PPicsGalleryDestroy($input: GalleryDestroyInput!) {
            galleryDestroy(input: $input)
        }
        """

        data = self.query(query, {
            "input": {
                "ids": [gallery_id],
                "delete_file": False,
                "delete_generated": False,
                "destroy_file_entry": False
            }
        })

        return bool(data.get("galleryDestroy"))

    def _image_selection(self):
        return """
            id
            title
            urls
            organized
            studio { id }
            performers { id }
            tags { id }
            galleries {
                id
                title
                urls
                folder { id path }
            }
            visual_files {
                ... on ImageFile {
                    id
                    path
                }
            }
        """

    def find_image_by_url(self, url):
        query = """
        query PPicsFindImageByURL(
            $filter: FindFilterType,
            $image_filter: ImageFilterType
        ) {
            findImages(
                filter: $filter,
                image_filter: $image_filter
            ) {
                images {
                    id
                    title
                    urls
                    organized
                    studio { id }
                    performers { id }
                    tags { id }
                    galleries {
                        id
                        title
                        urls
                        folder { id path }
                    }
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

        data = self.query(query, {
            "filter": {
                "per_page": 20
            },
            "image_filter": {
                "url": {
                    "value": url,
                    "modifier": "EQUALS"
                }
            }
        })

        images = data.get("findImages", {}).get("images", [])

        for image in images:
            if url in (image.get("urls") or []):
                return image

        return None

    def find_image_by_path(self, path):
        query = """
        query PPicsFindImageByPath(
            $filter: FindFilterType,
            $image_filter: ImageFilterType
        ) {
            findImages(
                filter: $filter,
                image_filter: $image_filter
            ) {
                images {
                    id
                    title
                    urls
                    organized
                    studio { id }
                    performers { id }
                    tags { id }
                    galleries {
                        id
                        title
                        urls
                        folder { id path }
                    }
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

        data = self.query(query, {
            "filter": {
                "per_page": 20
            },
            "image_filter": {
                "path": {
                    "value": path,
                    "modifier": "EQUALS"
                }
            }
        })

        images = data.get("findImages", {}).get("images", [])
        wanted = str(path).casefold()

        for image in images:
            for visual_file in image.get("visual_files") or []:
                if str(visual_file.get("path") or "").casefold() == wanted:
                    return image

        return None

    def find_image_by_id(self, image_id):
        query = """
        query PPicsFindImageByID($id: ID!) {
            findImage(id: $id) {
                id
                title
                urls
                organized
                studio { id }
                performers { id }
                tags { id }
                galleries {
                    id
                    title
                    urls
                    folder { id path }
                }
                visual_files {
                    ... on ImageFile {
                        id
                        path
                    }
                }
            }
        }
        """

        data = self.query(query, {
            "id": image_id
        })

        return data.get("findImage")

    def update_image_metadata(
        self,
        image,
        source_url,
        performer_ids,
        studio_id=None,
        tag_ids=None,
        gallery_id=None,
        organized=None
    ):
        query = """
        mutation PPicsImageUpdate($input: ImageUpdateInput!) {
            imageUpdate(input: $input) {
                id
                title
                urls
                organized
                studio { id name }
                performers { id name }
                tags { id name }
                galleries { id title }
            }
        }
        """

        existing_urls = image.get("urls") or []
        existing_performers = [
            item["id"]
            for item in (image.get("performers") or [])
            if item.get("id")
        ]
        existing_tags = [
            item["id"]
            for item in (image.get("tags") or [])
            if item.get("id")
        ]
        existing_galleries = [
            item["id"]
            for item in (image.get("galleries") or [])
            if item.get("id")
        ]

        urls = list(existing_urls)

        if source_url and source_url not in urls:
            urls.append(source_url)

        performers = list(dict.fromkeys(
            existing_performers + list(performer_ids or [])
        ))
        tags = list(dict.fromkeys(
            existing_tags + list(tag_ids or [])
        ))
        galleries = list(existing_galleries)

        if gallery_id and gallery_id not in galleries:
            galleries.append(gallery_id)

        image_input = {
            "id": image["id"],
            "urls": urls,
            "performer_ids": performers,
            "tag_ids": tags,
            "gallery_ids": galleries
        }

        existing_studio = image.get("studio")

        if existing_studio and existing_studio.get("id"):
            image_input["studio_id"] = existing_studio["id"]
        elif studio_id:
            image_input["studio_id"] = studio_id

        if organized is not None:
            image_input["organized"] = bool(organized)

        data = self.query(query, {
            "input": image_input
        })

        return data["imageUpdate"]

    def _normalize_title(self, value):
        value = str(value or "").casefold()
        value = re.sub(r"[^a-z0-9]+", " ", value)
        return " ".join(value.split())

    def find_scene_candidates(
        self,
        title,
        performer_names=None,
        studio_name=None,
        limit=8
    ):
        query = """
        query PPicsFindSceneCandidates(
            $filter: FindFilterType,
            $scene_filter: SceneFilterType
        ) {
            findScenes(
                filter: $filter,
                scene_filter: $scene_filter
            ) {
                scenes {
                    id
                    title
                    date
                    organized
                    urls
                    paths {
                        screenshot
                    }
                    studio {
                        id
                        name
                    }
                    performers {
                        id
                        name
                        gender
                    }
                }
            }
        }
        """

        def fetch_rows(find_filter, scene_filter=None):
            data = self.query(query, {
                "filter": find_filter,
                "scene_filter": scene_filter
            })

            return data.get("findScenes", {}).get("scenes", [])

        rows = []
        seen_ids = set()

        def add_rows(items):
            for item in items or []:
                item_id = str(item.get("id") or "")

                if not item_id or item_id in seen_ids:
                    continue

                seen_ids.add(item_id)
                rows.append(item)

        # First search by the PornPics scene title. This is usually the most
        # precise match when the local video scene has scraped metadata.
        add_rows(fetch_rows({
            "q": title,
            "per_page": 30
        }))

        # Also search by matching Stash performers. This catches local video
        # scenes whose title differs from the PornPics gallery title.
        performer_ids = []

        for name in performer_names or []:
            performer = self.find_performer(name)

            if not performer:
                continue

            performer_id = performer.get("id")

            if performer_id and performer_id not in performer_ids:
                performer_ids.append(performer_id)

        if performer_ids and len(rows) < 40:
            try:
                add_rows(fetch_rows(
                    {
                        "per_page": 50
                    },
                    {
                        "performers": {
                            "value": performer_ids,
                            "modifier": "INCLUDES"
                        }
                    }
                ))
            except Exception:
                # The title search is still useful if a custom/older Stash
                # build handles performer filters differently.
                pass

        wanted_title = self._normalize_title(title)
        wanted_studio = str(studio_name or "").strip().casefold()
        wanted_performers = {
            str(value or "").strip().casefold()
            for value in (performer_names or [])
            if str(value or "").strip()
        }

        candidates = []

        for scene in rows:
            scene_title = self._normalize_title(scene.get("title"))
            title_score = SequenceMatcher(
                None,
                wanted_title,
                scene_title
            ).ratio()

            score = title_score

            studio = scene.get("studio") or {}
            scene_studio = str(studio.get("name") or "").strip().casefold()

            if wanted_studio and scene_studio == wanted_studio:
                score += 0.12

            scene_performers = {
                str(item.get("name") or "").strip().casefold()
                for item in (scene.get("performers") or [])
                if str(item.get("name") or "").strip()
            }

            if wanted_performers:
                overlap = len(
                    wanted_performers.intersection(scene_performers)
                ) / float(len(wanted_performers))
                score += min(0.18, overlap * 0.18)

            candidate = dict(scene)
            candidate["match_score"] = round(score, 4)
            candidate["title_score"] = round(title_score, 4)
            candidates.append(candidate)

        candidates.sort(
            key=lambda item: (
                item.get("match_score") or 0,
                item.get("title_score") or 0
            ),
            reverse=True
        )

        return candidates[:limit]

    def start_scan(self, paths):
        query = """
        mutation PPicsMetadataScan($input: ScanMetadataInput!) {
            metadataScan(input: $input)
        }
        """

        data = self.query(query, {
            "input": {
                "paths": list(dict.fromkeys(paths or []))
            }
        })

        return data["metadataScan"]
