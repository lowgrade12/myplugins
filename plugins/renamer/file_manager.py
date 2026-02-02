from operator import itemgetter
from stashapi.stashapp import StashInterface
from stashapi import log
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


def apply_format(format_template: str, stash: StashInterface, scene_data, file_data)-> str:
    variables = find_variables(format_template)

    formatted_template = format_template

    for variable in variables:
        if variable in FILE_VARIABLES:
            value = FILE_VARIABLES[variable](stash, file_data)
        elif variable in SCENE_VARIABLES:
            value = SCENE_VARIABLES[variable](stash, scene_data)

        if not value:
            continue

        formatted_template = formatted_template.replace(f"${variable}$", str(value))

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
            cleaned = re.sub(r"[<>:\"/\\|?*]", "", cleaned)
        if remove_extra_spaces:
            cleaned = re.sub(r"\s+", " ", cleaned)
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
            directory_path = apply_format(self.config.default_directory_path_format, self.stash, self.scene_data, self.file_data)
            
            # Apply the same character filtering as file names, but preserve path separators
            remove_unsafe = not self.config.allow_unsafe_characters
            remove_extra_spaces = self.config.remove_extra_spaces_from_file_name
            directory_path = self._clean_directory_path(directory_path, remove_unsafe, remove_extra_spaces)
            
            directory_path = directory_path.absolute()
        else:
            path = pathlib.Path(self.file_data["path"])
            directory_path = path.parent.absolute()

        return directory_path
    
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
            file_name = re.sub(r"[<>:\"/\\|?*]", "", file_name)

        if self.config.remove_extra_spaces_from_file_name:
            file_name = re.sub(r"\s+", " ", file_name)

        return file_name

    def get_new_file_path(self) -> pathlib.Path:
        return self.get_new_file_folder() / self.get_new_file_name()

    def rename_related_files(self, old_path: pathlib.Path, new_path: pathlib.Path, dry_run: bool):
        if not self.config.rename_related_files:
            return

        old_directory = old_path.parent
        new_directory = new_path.parent
        related_files = [
            path
            for path in old_directory.glob(f"{old_path.stem}.*")
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

    def rename_directory(self, old_path: pathlib.Path, new_path: pathlib.Path, dry_run: bool):
        """Rename the parent directory to match the new file name.
        
        Note: This renames the parent directory of the file to match the file's
        stem (filename without extension). For example, if a file is renamed to
        "MyScene.mp4", the parent directory will be renamed to "MyScene".
        """
        if not self.config.rename_directory:
            return

        # Use the new path's parent as the current directory since the file has been moved
        old_directory = new_path.parent
        new_directory_name = new_path.stem  # Use the file stem (without extension) as directory name
        
        # Get the parent of the current directory
        parent_of_old_directory = old_directory.parent
        new_directory_path = parent_of_old_directory / new_directory_name

        if old_directory == new_directory_path:
            log.info("Directory paths are the same, no directory renaming needed.")
            return

        if new_directory_path.exists():
            log.warning(f"Directory already exists at {new_directory_path}, skipping directory rename")
            return

        log.info(f"Renaming directory from {old_directory} to {new_directory_path}")

        if dry_run:
            log.info("Dry run enabled, not actually renaming the directory.")
            return

        try:
            old_directory.rename(new_directory_path)
            log.info(f"Directory renamed successfully from {old_directory} to {new_directory_path}")
        except OSError as error:
            log.error(f"Failed to rename directory from {old_directory} to {new_directory_path}: {error}")

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
            self.rename_directory(old_path, new_path, dry_run=True)
            return

        moved_file = self.stash.call_GQL(
            MOVE_FILE_MUTATION,
            {"input": {
                    "ids": [self.file_data["id"]],
                    "destination_folder": str(self.get_new_file_folder()),
                    "destination_basename": self.get_new_file_name(),
                }
            }
        )

        log.info(f"File renamed successfully: {moved_file}")
        self.rename_related_files(old_path, new_path, dry_run=False)
        self.rename_directory(old_path, new_path, dry_run=False)
