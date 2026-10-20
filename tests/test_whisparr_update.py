import importlib.util
import io
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

# stashapi is only on the Stash server; the operations under test take
# their HTTP calls from the module's helpers, patched here.
stashapi = types.ModuleType("stashapi")
stashapp = types.ModuleType("stashapi.stashapp")
stashapp.StashInterface = lambda _conn: object()
stash_log = types.ModuleType("stashapi.log")
for level in ("info", "debug", "error", "warning"):
    setattr(stash_log, level, lambda *_a, **_k: None)
stashapi.stashapp = stashapp
stashapi.log = stash_log
sys.modules.setdefault("stashapi", stashapi)
sys.modules.setdefault("stashapi.stashapp", stashapp)
sys.modules.setdefault("stashapi.log", stash_log)

PLUGIN_PATH = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "whisparrUpdate"
    / "whisparrUpdate.py"
)
SPEC = importlib.util.spec_from_file_location("whisparr_update", PLUGIN_PATH)
wu = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wu)

URL = "http://whisparr"
KEY = "key"


class FakeWhisparr:
    def __init__(self, movies=None):
        self.movies = {m["foreignId"]: m for m in (movies or [])}
        self.calls = []

    def get(self, url, _key):
        self.calls.append(("GET", url, None))
        if "/movie?stashId=" in url:
            sid = url.split("stashId=")[1]
            return 200, [self.movies[sid]] if sid in self.movies else []
        if url.endswith("/qualityprofile"):
            return 200, [{"id": 3}]
        if url.endswith("/rootfolder"):
            return 200, [{"path": "/data/media"}]
        return 404, "not found"

    def post(self, url, body, _key):
        self.calls.append(("POST", url, body))
        if url.endswith("/movie"):
            movie = {"id": 99, "foreignId": body["foreignId"], "monitored": True, "hasFile": False}
            self.movies[body["foreignId"]] = movie
            return 201, movie
        return 201, {}

    def put(self, url, body, _key):
        self.calls.append(("PUT", url, body))
        return 202, body

    def patches(self):
        return (
            patch.object(wu, "http_get_json", side_effect=self.get),
            patch.object(wu, "http_post_json", side_effect=self.post),
            patch.object(wu, "http_put_json", side_effect=self.put),
        )


def run(fake, fn, args):
    p1, p2, p3 = fake.patches()
    with p1, p2, p3:
        return fn(URL, KEY, args)


class StatusTest(unittest.TestCase):
    def test_status_reports_each_scene_or_none(self):
        fake = FakeWhisparr([
            {"id": 1, "foreignId": "a", "monitored": False, "hasFile": True},
            {"id": 2, "foreignId": "b", "monitored": True, "hasFile": False},
        ])
        out = run(fake, wu.op_status, {"stash_ids": ["a", "b", "c", "a"]})
        self.assertEqual(out, {
            "a": {"id": 1, "monitored": False, "hasFile": True},
            "b": {"id": 2, "monitored": True, "hasFile": False},
            "c": None,
        })
        # one lookup per distinct id, never a full movie list
        self.assertEqual(len(fake.calls), 3)

    def test_status_caps_the_number_of_lookups(self):
        fake = FakeWhisparr()
        ids = [f"id{i}" for i in range(80)]
        out = run(fake, wu.op_status, {"stash_ids": ids})
        self.assertEqual(len(out), wu.STATUS_MAX_IDS)


class AddTest(unittest.TestCase):
    def test_add_new_scene_monitored_with_search(self):
        fake = FakeWhisparr()
        out = run(fake, wu.op_add, {"stash_id": "new", "title": "A scene"})
        self.assertEqual(out["added"], True)
        self.assertEqual(out["monitored"], True)
        post = [c for c in fake.calls if c[0] == "POST"][0]
        self.assertEqual(post[2]["foreignId"], "new")
        self.assertEqual(post[2]["monitored"], True)
        self.assertEqual(post[2]["addOptions"]["searchForMovie"], True)
        self.assertEqual(post[2]["qualityProfileId"], 3)

    def test_add_existing_unmonitored_scene_monitors_and_searches(self):
        fake = FakeWhisparr([{"id": 7, "foreignId": "x", "monitored": False, "hasFile": False}])
        out = run(fake, wu.op_add, {"stash_id": "x"})
        self.assertEqual(out, {"id": 7, "monitored": True, "hasFile": False, "added": False})
        puts = [c for c in fake.calls if c[0] == "PUT"]
        self.assertEqual(puts[0][2]["monitored"], True)
        search = [c for c in fake.calls if c[0] == "POST"][0]
        self.assertEqual(search[2], {"name": "MoviesSearch", "movieIds": [7]})
        self.assertFalse(any(c[1].endswith("/movie") and c[0] == "POST" for c in fake.calls))

    def test_add_existing_downloaded_scene_does_not_search(self):
        fake = FakeWhisparr([{"id": 8, "foreignId": "y", "monitored": True, "hasFile": True}])
        run(fake, wu.op_add, {"stash_id": "y"})
        self.assertEqual([c[0] for c in fake.calls], ["GET"])

    def test_add_requires_a_stash_id(self):
        with self.assertRaises(ValueError):
            run(FakeWhisparr(), wu.op_add, {})


class OperationOutputTest(unittest.TestCase):
    def test_output_is_stash_plugin_output_json(self):
        fake = FakeWhisparr()
        stdout = io.StringIO()
        settings = {"WHISPARR_URL": URL + "/", "WHISPARR_API_KEY": KEY}
        p1, p2, p3 = fake.patches()
        with p1, p2, p3, \
             patch.object(wu, "StashInterface", lambda _conn: object()), \
             patch.object(wu, "load_plugin_settings", return_value=settings), \
             patch.object(wu.sys, "stdout", stdout):
            wu.run_operation({"server_connection": {}}, {"mode": "status", "stash_ids": ["z"]})
        self.assertEqual(json.loads(stdout.getvalue()), {"output": {"ok": True, "result": {"z": None}}})

    def test_missing_settings_are_an_error_not_a_crash(self):
        stdout = io.StringIO()
        with patch.object(wu, "StashInterface", lambda _conn: object()), \
             patch.object(wu, "load_plugin_settings", return_value={}), \
             patch.object(wu.sys, "stdout", stdout):
            wu.run_operation({"server_connection": {}}, {"mode": "add", "stash_id": "q"})
        out = json.loads(stdout.getvalue())["output"]
        self.assertFalse(out["ok"])
        self.assertIn("Whisparr URL", out["error"])


if __name__ == "__main__":
    unittest.main()
