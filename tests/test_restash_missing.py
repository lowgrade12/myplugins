import io
import json
import re
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[1]
RESTASH_DIR = REPO_ROOT / "plugins" / "restash"
sys.path.insert(0, str(RESTASH_DIR))

try:   # real stashapp-tools if installed, else a no-op stand-in
    import stashapi.log  # noqa: F401
    import stashapi.stashapp  # noqa: F401
except ImportError:
    _log = types.ModuleType("stashapi.log")
    for _name in ("info", "debug", "warning", "error", "progress"):
        setattr(_log, _name, lambda *a, **k: None)
    _stashapp = types.ModuleType("stashapi.stashapp")
    _stashapp.StashInterface = object
    _pkg = types.ModuleType("stashapi")
    _pkg.log, _pkg.stashapp = _log, _stashapp
    sys.modules.update({"stashapi": _pkg, "stashapi.log": _log,
                        "stashapi.stashapp": _stashapp})

import config  # noqa: E402
import missing  # noqa: E402
import state  # noqa: E402

ENDPOINT = "https://stashdb.org/graphql"


def sdb_scene(i, performers=("sp-love",), studio="sst-1", tags=("Tag A",)):
    return {
        "id": f"sdb-{i}", "title": f"Scene {i}", "release_date": "2024-01-02",
        "duration": 1800,
        "images": [{"url": f"https://img/{i}.jpg", "width": 640, "height": 360}],
        "studio": {"id": studio, "name": f"Studio {studio}", "parent": None},
        "performers": [{"performer": {"id": p, "name": p}} for p in performers],
        "tags": [{"id": t, "name": t} for t in tags],
        "urls": [{"url": f"https://store/{i}", "site": {"name": "ManyVids",
                  "category": {"name": "Content distribution platforms"}}}],
    }


class FakeStash:
    """Answers the Stash queries missing.py sends."""

    def __init__(self, owned_by_performer=(), owned_elsewhere=(), linked=True):
        self.owned_by_performer = set(owned_by_performer)
        self.owned_elsewhere = set(owned_elsewhere)
        self.linked = linked
        self.local_performers = {"sp-love": "10", "sp-meh": "11"}
        self.local_studios = {"sst-1": "50"}
        self.calls = []

    def call_GQL(self, q, v=None):
        v = v or {}
        self.calls.append(q)
        if "stashBoxes" in q:
            return {"configuration": {"general": {"stashBoxes": [
                {"endpoint": ENDPOINT, "api_key": "k"}]}}}
        if "RestashPerformer" in q:
            ids = [{"endpoint": ENDPOINT, "stash_id": "sp-main"}] if self.linked else []
            return {"findPerformer": {"id": v["id"], "stash_ids": ids}}
        if "RestashTheirs" in q:
            return {"findScenes": {"scenes": [
                {"stash_ids": [{"endpoint": ENDPOINT, "stash_id": s}]}
                for s in self.owned_by_performer]}}
        if "findTags" in q:
            return {"findTags": {"tags": [{"id": "t1", "name": "Tag A", "aliases": []}]}}
        if "RestashLocal" in q:
            out = {}
            for alias, var in re.findall(r"(a\d+): \w+\([^$]*\$e, stash_id: \$(i\d+)", q):
                sid = v[var]
                if "findScenes" in q:
                    out[alias] = {"scenes": [{"id": "x"}] if sid in self.owned_elsewhere else []}
                elif "findPerformers" in q:
                    pid = self.local_performers.get(sid)
                    out[alias] = {"performers": [{"id": pid}] if pid else []}
                else:
                    sid_local = self.local_studios.get(sid)
                    out[alias] = {"studios": [{"id": sid_local}] if sid_local else []}
            return out
        raise AssertionError(f"unexpected query: {q[:80]}")


def fake_stashdb(pages):
    """stashdb_query stand-in serving `pages` (lists of scenes) by page number."""
    total = sum(len(p) for p in pages)
    asked = []

    def query(_box, _q, variables):
        page = variables["input"]["page"]
        asked.append(page)
        rows = pages[page - 1] if page <= len(pages) else []
        return {"queryScenes": {"count": total, "scenes": rows}}
    return query, asked


def write_state(path, settings, liked_performer="10"):
    state.save_state(
        path, settings=settings,
        affinities={"performers": {liked_performer: 0.9, "11": -0.6},
                    "tags": {"t1": 0.2}, "studios": {"50": 0.1}},
        context={"tag_counts": {"t1": 10}, "dur_median": 1800.0, "dur_scale": 600.0},
        raw_quantiles=[i / 100 - 0.5 for i in range(101)],
        written_at="2026-10-22T00:00:00Z")


class MissingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state_path = str(Path(self.tmp.name) / "restash_state.json")
        self.settings = config.Settings()
        self.p_state = mock.patch.object(state, "default_state_path", return_value=self.state_path)
        self.p_state.start()

    def tearDown(self):
        self.p_state.stop()
        self.tmp.cleanup()

    def run_missing(self, stash, pages, limit=24):
        q, asked = fake_stashdb(pages)
        with mock.patch.object(missing, "stashdb_query", side_effect=q):
            return missing.missing_for_performer(stash, self.settings, "1", limit), asked

    def test_owned_scenes_are_left_out_by_performer_and_by_alias(self):
        page = [sdb_scene(i) for i in range(5)]
        stash = FakeStash(owned_by_performer={"sdb-0"}, owned_elsewhere={"sdb-1"})
        r, _ = self.run_missing(stash, [page])
        self.assertEqual(sorted(s["id"] for s in r["scenes"]), ["sdb-2", "sdb-3", "sdb-4"])
        self.assertEqual(r["missing"], 3)
        # the scene owned under this performer is not alias-checked
        local = [q for q in stash.calls if "RestashLocal" in q and "findScenes" in q][0]
        self.assertNotIn("$i4", local)

    def test_pages_until_enough_are_missing(self):
        owned = {f"sdb-{i}" for i in range(100)}
        pages = [[sdb_scene(i) for i in range(100)], [sdb_scene(i) for i in range(100, 200)]]
        r, asked = self.run_missing(FakeStash(owned_by_performer=owned), pages, limit=24)
        self.assertEqual(asked, [1, 2])
        self.assertEqual(r["looked_at"], 200)
        self.assertEqual(len(r["scenes"]), 24)

    def test_stops_at_the_page_cap(self):
        pages = [[sdb_scene(p * 100 + i) for i in range(100)] for p in range(8)]
        owned = {f"sdb-{i}" for i in range(800)}
        _, asked = self.run_missing(FakeStash(owned_by_performer=owned), pages)
        self.assertEqual(asked, list(range(1, missing.MAX_PAGES + 1)))

    def test_scenes_with_a_liked_performer_rank_first(self):
        write_state(self.state_path, self.settings)
        page = [sdb_scene(0, performers=("sp-meh",)), sdb_scene(1, performers=("sp-love",)),
                sdb_scene(2, performers=("sp-unknown",))]
        r, _ = self.run_missing(FakeStash(), [page])
        self.assertTrue(r["scored"])
        self.assertEqual([s["id"] for s in r["scenes"]], ["sdb-1", "sdb-2", "sdb-0"])
        scores = [s["score"] for s in r["scenes"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0 <= s <= 100 for s in scores))

    def test_without_a_taste_model_the_list_keeps_stashdb_order(self):
        page = [sdb_scene(i) for i in range(4)]
        r, _ = self.run_missing(FakeStash(), [page])
        self.assertFalse(r["scored"])
        self.assertEqual([s["id"] for s in r["scenes"]], [f"sdb-{i}" for i in range(4)])
        self.assertTrue(all(s["score"] is None for s in r["scenes"]))

    def test_card_carries_store_image_and_site(self):
        r, _ = self.run_missing(FakeStash(), [[sdb_scene(7)]])
        c = r["scenes"][0]
        self.assertEqual(c["store"], {"url": "https://store/7", "site": "ManyVids"})
        self.assertEqual(c["image"], "https://img/7.jpg")
        self.assertEqual(r["site"], "https://stashdb.org")

    def test_a_performer_not_linked_to_stashdb_has_nothing(self):
        r, asked = self.run_missing(FakeStash(linked=False), [[sdb_scene(1)]])
        self.assertEqual(r, {"linked": False, "total": 0, "missing": 0, "scenes": []})
        self.assertEqual(asked, [])

    def test_operation_output_is_plugin_output_json(self):
        q, _ = fake_stashdb([[sdb_scene(1)]])
        out = io.StringIO()
        with mock.patch.object(missing, "stashdb_query", side_effect=q), \
             mock.patch.object(sys, "stdout", out):
            missing.run_op(FakeStash(), self.settings, {"mode": "missing", "performer_id": "1"})
        body = json.loads(out.getvalue())
        self.assertTrue(body["output"]["ok"])
        self.assertEqual(body["output"]["result"]["scenes"][0]["id"], "sdb-1")

    def test_a_missing_stashdb_key_is_an_answer_not_a_crash(self):
        stash = FakeStash()
        stash.call_GQL = lambda q, v=None: {"configuration": {"general": {"stashBoxes": []}}}
        out = io.StringIO()
        with mock.patch.object(sys, "stdout", out):
            missing.run_op(stash, self.settings, {"mode": "missing", "performer_id": "1"})
        body = json.loads(out.getvalue())["output"]
        self.assertFalse(body["ok"])
        self.assertIn("StashDB", body["error"])


if __name__ == "__main__":
    unittest.main()
