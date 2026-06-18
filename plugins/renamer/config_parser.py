import pathlib


class Config:
    DEFAULT_CONFIG = {
        "defaultDirectoryPathFormat": "",
        "defaultFileNameFormat": "",
        "dryRun": False,
        "renameUnorganized": False,
        "renameRelatedFiles": True,
        "removeExtraSpacesFromFileName": False,
        "duplicateFileSuffix": " ($index$)",
        "renameDirectory": True,
        "directoryFilter": "",
        "deleteEmptyDirectory": False,
        "protectedDirectories": "",
    }

    def __init__(self, config):
        self.config = config

    def __getattr__(self, name):
        config_name = self.__to_camel_case(name)

        if config_name == "protectedDirectories":
            return self._get_protected_directories()

        stash_config = self.config.get(config_name)

        if stash_config is not None:
            return stash_config

        return Config.DEFAULT_CONFIG.get(config_name)

    def _get_protected_directories(self):
        """Return a set of resolved Path objects for all protected directories."""
        raw = self.config.get("protectedDirectories") or Config.DEFAULT_CONFIG["protectedDirectories"]
        if not raw:
            return set()
        return {pathlib.Path(p.strip()).resolve() for p in raw.split(",") if p.strip()}

    @staticmethod
    def __to_camel_case(snake_str):
        pascal_case = "".join(x.capitalize() for x in snake_str.lower().split("_"))
        return pascal_case[0].lower() + pascal_case[1:]
