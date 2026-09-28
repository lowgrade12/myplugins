import json
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PPICS_SCRIPT = REPO_ROOT / "plugins" / "stash-ppics" / "ppics.py"
SERVER_CONNECTION = {
    "Scheme": "http",
    "Host": "localhost",
    "Port": 9999,
    "SessionCookie": {
        "Name": "",
        "Value": "",
    },
}


class PornPicsTaskFallbackTest(unittest.TestCase):
    def run_ppics(self, args):
        payload = {
            "args": args,
            "server_connection": SERVER_CONNECTION,
        }
        return subprocess.run(
            ["python", str(PPICS_SCRIPT)],
            cwd=REPO_ROOT,
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_ui_message(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(
            output["output"]["message"],
            "Open a performer page and use the PornPics tab, or use the PornPics link in the main navigation.",
        )

    def test_empty_mode_returns_ui_status_message(self):
        result = self.run_ppics({})
        self.assert_ui_message(result)

    def test_ui_status_mode_returns_ui_status_message(self):
        result = self.run_ppics({
            "mode": "ui_status",
        })
        self.assert_ui_message(result)


if __name__ == "__main__":
    unittest.main()
