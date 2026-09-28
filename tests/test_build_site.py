import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = REPO_ROOT / "build_site.sh"


class BuildSiteTest(unittest.TestCase):
    def test_stash_ppics_zip_omits_package_manifest_file(self):
        generated_paths = [
            REPO_ROOT / "plugins" / "stash-ppics" / "__pycache__",
            REPO_ROOT / "plugins" / "stash-ppics" / "assets",
            REPO_ROOT / "plugins" / "stash-ppics" / "state",
        ]
        (generated_paths[0]).mkdir(exist_ok=True)
        (generated_paths[0] / "junk.pyc").write_bytes(b"junk")
        (generated_paths[1] / "cache").mkdir(parents=True, exist_ok=True)
        (generated_paths[1] / "cache" / "junk.txt").write_text("junk", encoding="utf-8")
        (generated_paths[2]).mkdir(exist_ok=True)
        (generated_paths[2] / "runtime.json").write_text("{}", encoding="utf-8")

        with tempfile.TemporaryDirectory() as tmpdir:
            try:
                output_dir = Path(tmpdir) / "site"
                result = subprocess.run(
                    [str(BUILD_SCRIPT), str(output_dir)],
                    cwd=REPO_ROOT,
                    text=True,
                    capture_output=True,
                    check=False,
                )

                self.assertEqual(result.returncode, 0, result.stderr)

                with zipfile.ZipFile(output_dir / "stash-ppics.zip") as archive:
                    names = archive.namelist()

                self.assertIn("stash-ppics.yml", names)
                self.assertNotIn("manifest", names)
                self.assertNotIn("__pycache__/junk.pyc", names)
                self.assertNotIn("assets/cache/junk.txt", names)
                self.assertNotIn("state/runtime.json", names)
            finally:
                for path in generated_paths:
                    shutil.rmtree(path, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
