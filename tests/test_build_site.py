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


if __name__ == "__main__":
    unittest.main()
