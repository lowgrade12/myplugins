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
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir) / "repo"
            plugin_dir = workspace / "plugins" / "stash-ppics"
            workspace.mkdir()
            shutil.copy2(BUILD_SCRIPT, workspace / "build_site.sh")
            shutil.copytree(REPO_ROOT / "plugins" / "stash-ppics", plugin_dir)

            subprocess.run(["git", "init"], cwd=workspace, check=True, capture_output=True)
            subprocess.run(
                ["git", "config", "user.email", "test@example.com"],
                cwd=workspace,
                check=True,
                capture_output=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test User"],
                cwd=workspace,
                check=True,
                capture_output=True,
            )
            subprocess.run(["git", "add", "."], cwd=workspace, check=True, capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "fixture"],
                cwd=workspace,
                check=True,
                capture_output=True,
            )

            (plugin_dir / "__pycache__").mkdir(exist_ok=True)
            (plugin_dir / "__pycache__" / "junk.pyc").write_bytes(b"junk")
            (plugin_dir / "assets" / "cache").mkdir(parents=True, exist_ok=True)
            (plugin_dir / "assets" / "cache" / "junk.txt").write_text("junk", encoding="utf-8")
            (plugin_dir / "state").mkdir(exist_ok=True)
            (plugin_dir / "state" / "runtime.json").write_text("{}", encoding="utf-8")

            output_dir = Path(tmpdir) / "site"
            result = subprocess.run(
                [str(workspace / "build_site.sh"), str(output_dir)],
                cwd=workspace,
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


if __name__ == "__main__":
    unittest.main()
