from operator import itemgetter
from stashapi.stashapp import StashInterface
from stashapi import log
import glob
import pathlib
import re


MOVE_FILE_MUTATION = """
mutation MoveFiles($input: MoveFilesInput!) {
    moveFiles(input: $input)
}
"""


def get_parent_studio_chain(stash, scene):
    current_studio = scene.get("studio", {})
    parent_chain = [current_studio.get("name", "")]

    while current_studio.get("parent_studio"):
        current_studio = stash.find_studio(current_studio.get("parent_studio"))

        parent_chain.append(current_studio.get("name"))

    return "/".join(reversed(parent_chain))

def key_getter(key):
    return lambda _, data: data.get(key, "")

FILE_VARIABLES = {
    "audio_codec": key_getter("audio_codec"),
    "ext": lambda _, file: file.get("basename", "").split(".")[-1],
    "format": key_getter("format"),
    "height": key_getter("height"),
    "index": key_getter("index"),
    "video_codec": key_getter("video_codec"),
    "width": key_getter("width"),
}

SCENE_VARIABLES = {
    "scene_id": key_getter("id"),
    "title": key_getter("title"),
    "date": key_getter("date"),
    "director": key_getter("director"),
    "month": lambda _, scene: scene.get("date", "").split("-")[1] if scene.get("date") else "",
    "parent_studio_chain": get_parent_studio_chain,
    "studio_code": key_getter("code"),
    "studio_name": lambda _, scene: scene.get("studio", {}).get("name", ""),
    "year": lambda _, scene: scene.get("date", "").split("-")[0] if scene.get("date") else "",
}

def find_variables(format_template) -> list[str]:
    variables = []

    for variable in FILE_VARIABLES.keys():
        if f"${variable}$" in format_template:
            variables.append(variable)

    for variable in SCENE_VARIABLES.keys():
        if f"${variable}$" in format_template:
            variables.append(variable)

    return variables


def clean_optional_from_format(formatted_string: str) -> str:
    # Erase entire optional section if there is an unused variable
    formatted_string = re.sub(r"\{.*\$\w+\$.*\}", "", formatted_string)

    # Remove any remaining curly braces
    formatted_string = formatted_string.replace("{", "").replace("}", "")

    return formatted_string


def apply_format(format_template: str, stash: StashInterface, scene_data, file_data, sanitize_path_separators: bool = False)-> str:
    """Apply variable substitution to a format template.
    
    Args:
        format_template: The template string with $variable$ placeholders
        stash: StashInterface instance
        scene_data: Scene data dictionary
        file_data: File data dictionary
        sanitize_path_separators: If True, removes "/" and "\\" from variable values
            to prevent accidental folder creation. Note: This does NOT sanitize
            the $parent_studio_chain$ variable, which intentionally uses "/" for
            folder hierarchy.
    """
    variables = find_variables(format_template)

    formatted_template = format_template

    for variable in variables:
        if variable in FILE_VARIABLES:
            value = FILE_VARIABLES[variable](stash, file_data)
        elif variable in SCENE_VARIABLES:
            value = SCENE_VARIABLES[variable](stash, scene_data)

        if not value:
            continue

        value_str = str(value)
        
        # Sanitize path separators from variable values (except parent_studio_chain
        # which intentionally uses "/" for folder hierarchy)
        if sanitize_path_separators and variable != "parent_studio_chain":
            value_str = re.sub(r"[/\\]", "", value_str)
        
        formatted_template = formatted_template.replace(f"${variable}$", value_str)

    formatted_template = clean_optional_from_format(formatted_template)

    return formatted_template


class StashFile:
    def __init__(self, stash: StashInterface, config, scene_data, file_data):
        self.stash = stash
        self.config = config
        self.scene_data = scene_data
        self.file_data = file_data
        self.duplicate_index = 0

    def get_old_file_path(self) -> pathlib.Path:
        path = pathlib.Path(self.file_data["path"])

        return path.absolute()

    def _clean_path_component(self, part: str, remove_unsafe: bool, remove_extra_spaces: bool) -> str:
        """Clean a single path component by removing unsafe characters and/or extra spaces."""
        cleaned = part
        if remove_unsafe:
            cleaned = re.sub(r"\s*[|]\s*", "  ", cleaned)
            cleaned = re.sub(r"[<>:\"/\\?*]", "", cleaned)
        if remove_extra_spaces:
            cleaned = re.sub(r"\s+", " ", cleaned)
        # Replace three or more consecutive dots with a single dot
        cleaned = re.sub(r"\.{3,}", ".", cleaned)
        return cleaned

    def _clean_directory_path(self, directory_path: str, remove_unsafe: bool, remove_extra_spaces: bool) -> pathlib.Path:
        """Clean a directory path by processing each component while preserving the root/anchor."""
        path_obj = pathlib.Path(directory_path)
        cleaned_parts = []
        for part in path_obj.parts:
            # Preserve root/anchor (e.g., "/" or "C:\")
            if part == path_obj.anchor:
                cleaned_parts.append(part)
            else:
                cleaned_parts.append(self._clean_path_component(part, remove_unsafe, remove_extra_spaces))
        return pathlib.Path(*cleaned_parts) if cleaned_parts else path_obj

    def get_new_file_folder(self) -> pathlib.Path:
        if self.config.default_directory_path_format:
            directory_path = apply_format(self.config.default_directory_path_format, self.stash, self.scene_data, self.file_data, sanitize_path_separators=True)
            
            # Apply the same character filtering as file names, but preserve path separators
            remove_unsafe = not self.config.allow_unsafe_characters
            remove_extra_spaces = self.config.remove_extra_spaces_from_file_name
            directory_path = self._clean_directory_path(directory_path, remove_unsafe, remove_extra_spaces)
            
            directory_path = directory_path.absolute()
        else:
            path = pathlib.Path(self.file_data["path"])
            directory_path = path.parent.absolute()

        return directory_path
    
    def get_new_file_base_stem(self) -> str:
        """Get the file stem (name without extension) without duplicate suffix.
        
        This is used for directory naming when rename_directory is enabled,
        so the directory name doesn't include duplicate suffixes like (1).
        """
        if not self.config.default_file_name_format:
            basename = self.file_data["basename"]
            return basename.rsplit(".", 1)[0] if "." in basename else basename

        file_data = {**self.file_data, "index": 0}  # Always use index 0 for base stem
        file_name = apply_format(self.config.default_file_name_format, self.stash, self.scene_data, file_data)

        # Get base name without extension
        base_name = file_name.rsplit(".", 1)[0]

        if not self.config.allow_unsafe_characters:
            base_name = re.sub(r"\s*[|]\s*", "  ", base_name)
            base_name = re.sub(r"[<>:\"/\\?*]", "", base_name)

        if self.config.remove_extra_spaces_from_file_name:
            base_name = re.sub(r"\s+", " ", base_name)

        # Replace three or more consecutive dots with a single dot
        base_name = re.sub(r"\.{3,}", ".", base_name)

        return base_name

    def get_new_file_name(self) -> str:
        if not self.config.default_file_name_format:
            return self.file_data["basename"]

        file_data = {**self.file_data, "index": self.duplicate_index}
        file_name = apply_format(self.config.default_file_name_format, self.stash, self.scene_data, file_data)

        if self.duplicate_index:
            duplicate_suffix = apply_format(self.config.duplicate_file_suffix, self.stash, self.scene_data, file_data)
            base_name = file_name.rsplit(".", 1)[0]
            extension = file_name.rsplit(".", 1)[1]

            file_name = f"{base_name}{duplicate_suffix}.{extension}"

        if not self.config.allow_unsafe_characters:
            file_name = re.sub(r"\s*[|]\s*", "  ", file_name)
            file_name = re.sub(r"[<>:\"/\\?*]", "", file_name)

        if self.config.remove_extra_spaces_from_file_name:
            file_name = re.sub(r"\s+", " ", file_name)

        # Replace three or more consecutive dots with a single dot
        file_name = re.sub(r"\.{3,}", ".", file_name)

        return file_name

    def _holds_only_this_scene(self, folder: pathlib.Path) -> bool:
        """True if *folder* is missing, empty, or contains only this scene's
        file and its related files (same stem, other extensions)."""
        if not folder.exists():
            return True
        old_path = self.get_old_file_path()
        prefix = old_path.stem + "."
        try:
            entries = list(folder.iterdir())
        except OSError as error:
            log.warning(f"Could not list {folder}: {error}")
            return False
        for entry in entries:
            if entry == old_path:
                continue
            if entry.is_file() and entry.name.startswith(prefix):
                continue
            return False
        return True

    def get_target_folder(self) -> pathlib.Path:
        """Folder the file will end up in.

        With "Rename directory" on, the destination folder is renamed to match
        the file name - but only when that folder belongs to this scene alone.
        A shared folder (a studio folder, a downloads folder, a folder with
        other scenes or subfolders) is never renamed. The rename is done by
        moving the file into the new folder through Stash's moveFiles, so
        Stash's database stays in sync instead of pointing at a folder that
        was renamed behind its back.
        """
        base_folder = self.get_new_file_folder()
        if not self.config.rename_directory:
            return base_folder

        # With a directory template the template decides folder names (put
        # $title$ in it for per-scene folders). Renaming the template's last
        # folder would turn e.g. a "$studio_name$" folder into a scene title.
        if self.config.default_directory_path_format:
            log.debug("Directory path format is set; not renaming directories.")
            return base_folder

        renamed_folder = base_folder.parent / self.get_new_file_base_stem()
        if renamed_folder == base_folder:
            return base_folder

        if renamed_folder.exists():
            log.warning(f"Directory already exists at {renamed_folder}, skipping directory rename")
            return base_folder

        if not self._holds_only_this_scene(base_folder):
            log.info(
                f"Not renaming directory {base_folder}: it contains other files or folders "
                "besides this scene's files."
            )
            return base_folder

        return renamed_folder

    def get_new_file_path(self) -> pathlib.Path:
        return self.get_target_folder() / self.get_new_file_name()

    def rename_related_files(self, old_path: pathlib.Path, new_path: pathlib.Path, dry_run: bool):
        if not self.config.rename_related_files:
            return

        old_directory = old_path.parent
        new_directory = new_path.parent
        escaped_stem = glob.escape(old_path.stem)
        related_files = [
            path
            for path in old_directory.glob(f"{escaped_stem}.*")
            if path != old_path
        ]

        if not related_files:
            return

        for related_file in related_files:
            target_path = new_directory / f"{new_path.stem}{related_file.suffix}"

            if related_file == target_path:
                continue

            if target_path.exists():
                log.warning(f"Related file already exists at {target_path}, skipping rename for {related_file}")
                continue

            log.info(f"Renaming related file from {related_file} to {target_path}")

            if dry_run:
                continue

            target_path.parent.mkdir(parents=True, exist_ok=True)

            try:
                related_file.rename(target_path)
            except OSError as error:
                log.error(f"Failed to rename related file from {related_file} to {target_path}: {error}")

    def remove_renamed_source_directory(self, old_path: pathlib.Path, new_path: pathlib.Path, dry_run: bool):
        """After a directory rename, remove the old folder once it is empty.

        The file itself was moved into the renamed folder by Stash
        (see get_target_folder); this only cleans up the now-empty original.
        """
        if not self.config.rename_directory:
            return

        old_directory = old_path.parent
        if old_directory == new_path.parent or old_directory != self.get_new_file_folder():
            return

        if old_directory.resolve() in self.config.protected_directories:
            log.info(f"Skipping protected directory: {old_directory}")
            return

        try:
            if any(old_directory.iterdir()):
                return
        except OSError:
            return

        log.info(f"Removing renamed-from directory {old_directory}")
        if dry_run:
            return

        try:
            old_directory.rmdir()
        except OSError as error:
            log.error(f"Failed to remove directory {old_directory}: {error}")

    def delete_empty_directory(self, old_path: pathlib.Path, new_path: pathlib.Path, dry_run: bool):
        """Delete empty directories left behind after renaming.
        
        Walks up from the immediate parent directory of the old file path,
        deleting each empty directory until a non-empty directory or the
        filesystem root is reached.
        """
        if not self.config.delete_empty_directory:
            return

        old_directory = old_path.parent
        new_directory = new_path.parent

        # Skip if the file was renamed within the same directory
        if old_directory == new_directory:
            log.debug("File was renamed within the same directory, skipping empty directory check.")
            return

        current_directory = old_directory
        protected_dirs = self.config.protected_directories

        while True:
            # Stop at the filesystem root
            if current_directory == current_directory.parent:
                break

            # Stop if this directory is protected
            if current_directory.resolve() in protected_dirs:
                log.info(f"Skipping protected directory: {current_directory}")
                break

            if not current_directory.exists():
                log.debug(f"Directory {current_directory} does not exist, nothing to delete.")
                break

            # Check if the directory is empty
            try:
                directory_contents = list(current_directory.iterdir())
            except OSError as error:
                log.error(f"Failed to list contents of directory {current_directory}: {error}")
                break

            if directory_contents:
                log.debug(f"Directory {current_directory} is not empty, not deleting.")
                break

            log.info(f"Deleting empty directory: {current_directory}")

            if dry_run:
                log.info("Dry run enabled, not actually deleting the directory.")
                current_directory = current_directory.parent
                continue

            try:
                current_directory.rmdir()
                log.info(f"Empty directory deleted successfully: {current_directory}")
            except OSError as error:
                log.error(f"Failed to delete empty directory {current_directory}: {error}")
                break

            current_directory = current_directory.parent

    def rename_file(self):
        old_path = self.get_old_file_path()
        new_path = self.get_new_file_path()

        if not old_path.exists():
            log.warning(f"File for scene does not exist on disk: {old_path}")
            return

        if old_path == new_path:
            log.info("File paths are the same, no renaming needed.")
            return

        log.debug(f"Checking if a file exists at {new_path}")
        while new_path.exists():
            self.duplicate_index += 1
            log.warning(f"File already exists at {new_path}, adding duplicate suffix: {self.duplicate_index}")
            new_path = self.get_new_file_path()

            if old_path == new_path:
                log.info("File paths are the same after adding duplicate suffix, no renaming needed.")
                return

        log.info(f"Renaming file from {old_path} to {new_path}")
        if self.config.dry_run:
            log.info("Dry run enabled, not actually renaming the file.")
            self.rename_related_files(old_path, new_path, dry_run=True)
            self.delete_empty_directory(old_path, new_path, dry_run=True)
            return

        moved_file = self.stash.call_GQL(
            MOVE_FILE_MUTATION,
            {"input": {
                    "ids": [self.file_data["id"]],
                    "destination_folder": str(new_path.parent),
                    "destination_basename": new_path.name,
                }
            }
        )

        log.info(f"File renamed successfully: {moved_file}")
        self.rename_related_files(old_path, new_path, dry_run=False)
        self.remove_renamed_source_directory(old_path, new_path, dry_run=False)
        self.delete_empty_directory(old_path, new_path, dry_run=False)
