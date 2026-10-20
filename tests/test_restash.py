import json
import random
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
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

import algorithm  # noqa: E402
import config  # noqa: E402
import models  # noqa: E402
import ratings_backup  # noqa: E402
import restash  # noqa: E402
import state  # noqa: E402
import stash_io  # noqa: E402
import writer  # noqa: E402


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class FakeStash:
    """In-memory Stash answering the GraphQL calls Restash makes."""

    def __init__(self, n_scenes=60, n_performers=10, seed=7):
        rng = random.Random(seed)
        now = datetime.now(timezone.utc)
        self.performers = {
            str(i): {"id": str(i), "name": f"P{i}", "favorite": i == 1,
                     "rating100": None, "o_counter": 0, "scene_count": 0,
                     "created_at": _iso(now - timedelta(days=400)), "tags": [],
                     "custom_fields": {}}
            for i in range(1, n_performers + 1)}
        self.scenes = {}
        for i in range(1, n_scenes + 1):
            self.add_scene(str(i), rng, now, watched=rng.random() < 0.4)
        self.plugins = {"restash": True, "other_a": True, "other_b": True,
                        "already_off": False}
        self.exclude_tag_id = None
        self.calls = []

    def add_performer(self, pid, favorite=False, tag_ids=()):
        self.performers[pid] = {
            "id": pid, "name": f"P{pid}", "favorite": favorite, "rating100": None,
            "o_counter": 0, "scene_count": 0,
            "created_at": _iso(datetime.now(timezone.utc)),
            "tags": [{"id": t} for t in tag_ids], "custom_fields": {}}
        return self.performers[pid]

    def add_scene(self, sid, rng, now, watched=False):
        plays = ([_iso(now - timedelta(days=rng.randint(1, 300)))
                  for _ in range(rng.randint(1, 4))] if watched else [])
        os_ = plays[:1] if watched and rng.random() < 0.5 else []
        self.scenes[sid] = {
            "id": sid, "title": f"S{sid}", "organized": False, "rating100": None,
            "date": None, "created_at": _iso(now - timedelta(days=rng.randint(1, 500))),
            "resume_time": 0.0, "play_duration": 1500.0 * len(plays),
            "play_count": len(plays), "o_counter": len(os_),
            "last_played_at": max(plays) if plays else None,
            "play_history": plays, "o_history": os_,
            "files": [{"duration": 1800.0, "height": 1080}],
            "tags": [{"id": str(rng.randint(1, 8))}],
            "performers": [{"id": str(rng.randint(1, len(self.performers)))}],
            "studio": {"id": str(rng.randint(1, 3))}, "scene_markers": [],
            "custom_fields": {}}
        return self.scenes[sid]

    def mutations(self):
        return [c for c in self.calls if c[0].lstrip().startswith("mutation(")]

    def call_GQL(self, query, variables=None):
        variables = variables or {}
        self.calls.append((query, variables))
        if "__type" in query:
            name = "custom_fields" if "SceneUpdateInput" in query else "remove"
            return {"__type": {"inputFields": [{"name": name}]}}
        if "configuration" in query:
            return {"configuration": {"plugins": {}}}
        if "setPluginsEnabled" in query:
            self.plugins.update(variables["enabledMap"])
            return {"setPluginsEnabled": True}
        if "plugins" in query:
            return {"plugins": [{"id": k, "enabled": v} for k, v in self.plugins.items()]}
        if "findTags" in query:
            q = variables["filter"]["q"]
            tags = [{"id": self.exclude_tag_id, "name": q}] if self.exclude_tag_id else []
            return {"findTags": {"tags": tags}}
        if "findScene(" in query:
            return {"findScene": self.scenes.get(variables["id"])}
        if "findPerformer(" in query:
            return {"findPerformer": self.performers.get(variables["id"])}
        if "findScenes" in query or "findPerformers" in query:
            root, sub, store = (("findScenes", "scenes", self.scenes)
                                if "findScenes" in query
                                else ("findPerformers", "performers", self.performers))
            f = variables["filter"]
            items = sorted(store.values(), key=lambda x: int(x["id"]))
            perf_filter = (variables.get("scene_filter") or {}).get("performers")
            if perf_filter:
                wanted = set(perf_filter["value"])
                items = [x for x in items
                         if wanted & {p["id"] for p in x["performers"]}]
            start = (f["page"] - 1) * f["per_page"]
            return {root: {sub: items[start:start + f["per_page"]]}}
        if query.lstrip().startswith("mutation("):
            store = self.scenes if "sceneUpdate" in query else self.performers
            out = {}
            for k, inp in variables.items():
                ent = store[inp["id"]]
                cf = inp.get("custom_fields") or {}
                ent["custom_fields"].update(cf.get("partial") or {})
                for key in cf.get("remove") or []:
                    ent["custom_fields"].pop(key, None)
                if "rating100" in inp:
                    ent["rating100"] = inp["rating100"]
                out["u" + k[1:]] = {"id": inp["id"]}
            return out
        raise AssertionError(f"unexpected query: {query[:80]}")


class TempPathsMixin:
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self.state_path = str(tmp / "restash_state.json")
        self.disabled_path = tmp / ".restash_disabled_plugins.json"
        patches = [
            mock.patch.object(state, "default_state_path", lambda: self.state_path),
            mock.patch.object(restash, "_disabled_plugins_path", lambda: self.disabled_path),
            mock.patch.object(ratings_backup, "default_backup_path",
                              lambda: str(tmp / "restash_ratings_backup.json")),
            mock.patch.object(restash, "PLUGIN_ID", "restash"),
            mock.patch.object(restash, "_dry_run_report_path",
                              lambda: tmp / "restash_dry_run.txt"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self._tmp.cleanup)

    def run_task(self, stash, mode):
        with mock.patch.object(stash_io, "connect", lambda conn: stash):
            return restash.run({"args": {"mode": mode}, "server_connection": {}})

    def run_hook(self, stash, scene_id, hook_type="Scene.Create.Post"):
        with mock.patch.object(stash_io, "connect", lambda conn: stash):
            return restash.run({"server_connection": {},
                                "args": {"hookContext": {"type": hook_type,
                                                         "id": scene_id}}})


class WriteHysteresisTest(unittest.TestCase):
    def partial(self, score, wildcard=False):
        comps = {"base": 0.1}
        if wildcard:
            comps["wildcard"] = 1.0
        return {"restash_score": score, "restash_components": json.dumps(comps)}

    def test_threshold(self):
        self.assertTrue(writer.needs_write({}, self.partial(50), 3))
        self.assertFalse(writer.needs_write({"restash_score": "50"}, self.partial(50), 3))
        self.assertFalse(writer.needs_write({"restash_score": 50}, self.partial(52), 3))
        self.assertTrue(writer.needs_write({"restash_score": 50}, self.partial(53), 3))
        self.assertTrue(writer.needs_write({"restash_score": 50}, self.partial(51), 1))

    def test_wildcard_changes_always_write(self):
        old_wild = {"restash_score": 90, **{k: v for k, v in
                    self.partial(90, wildcard=True).items() if k != "restash_score"}}
        self.assertTrue(writer.needs_write(old_wild, self.partial(89), 3))
        self.assertTrue(writer.needs_write({"restash_score": 88},
                                           self.partial(89, wildcard=True), 3))

    def test_mirror_follows_stored_score(self):
        cfg = config.Settings(mirror_to_rating100=True)
        score = algorithm.models.SceneScore("1", 0.1, 52, 0.52, 0, False, {})
        stash = mock.Mock()
        stats = writer.write_scores(stash, "scene", {"1": score},
                                    {"1": {"restash_score": 50}}, cfg, "now",
                                    current_ratings={"1": 50})
        self.assertEqual(stats["would_write"], 0)
        stats = writer.write_scores(stash, "scene", {"1": score},
                                    {"1": {"restash_score": 50}}, cfg, "now",
                                    current_ratings={"1": 77})
        self.assertEqual(stats["would_write"], 1)


class JitterAndQuantileTest(unittest.TestCase):
    def test_jitter_seed_holds_within_period(self):
        cfg = config.Settings(jitter_period_days=7)
        day0 = datetime(2026, 1, 1, tzinfo=timezone.utc)   # epoch day 20454 = 7 * 2922
        seeds = [algorithm.jitter_seed(day0 + timedelta(days=d, hours=13), "x", cfg)
                 for d in range(8)]
        self.assertEqual(len(set(seeds[:7])), 1)
        self.assertNotEqual(seeds[6], seeds[7])
        daily = config.Settings(jitter_period_days=1)
        self.assertEqual(algorithm.jitter_seed(day0, "2026-01-01", daily), "2026-01-01")

    def test_percentile_from_quantiles(self):
        values = [float(i) for i in range(1000)]
        q = algorithm.raw_quantiles(values)
        self.assertEqual(len(q), 1001)
        self.assertAlmostEqual(algorithm.percentile_from_quantiles(500.0, q), 0.5, delta=0.01)
        self.assertEqual(algorithm.percentile_from_quantiles(-5.0, q), 0.0)
        self.assertEqual(algorithm.percentile_from_quantiles(5000.0, q), 1.0)


def _scene_score(sid, pct, n_events=0):
    return models.SceneScore(id=sid, raw=pct, restash_score=algorithm.to_restash_score(pct),
                             percentile=pct, n_events=n_events, wildcard=False,
                             components={})


def _library_scores(n):
    return {str(i): _scene_score(str(i), i / (n - 1)) for i in range(n)}


class WildcardPlacementTest(unittest.TestCase):
    def test_fixed_count_lands_just_under_top_rank_at_scale(self):
        cfg = config.Settings()
        scores = _library_scores(144_500)
        real_desc = sorted((s.restash_score for s in scores.values()), reverse=True)
        algorithm._apply_wildcards(scores, cfg, "2026-10-19")
        wild = [s for s in scores.values() if s.wildcard]
        self.assertEqual(len(wild), cfg.wildcard_count)
        floor = real_desc[cfg.wildcard_top_rank + cfg.wildcard_count]
        for s in wild:
            self.assertTrue(cfg.wildcard_pool_low <= s.percentile <= cfg.wildcard_pool_high)
            self.assertGreaterEqual(s.restash_score, floor)
        # the old 85-95 band sat thousands of ranks down at this size
        self.assertGreater(sum(1 for v in real_desc if v > 95), 5000)
        self.assertTrue(all(s.restash_score > 95 for s in wild))

    def test_small_library_places_by_rank(self):
        cfg = config.Settings(wildcard_count=5, wildcard_top_rank=10)
        scores = _library_scores(1000)
        algorithm._apply_wildcards(scores, cfg, "2026-10-19")
        real = sorted((s.restash_score for s in scores.values() if not s.wildcard),
                      reverse=True)
        wild = sorted((s.restash_score for s in scores.values() if s.wildcard),
                      reverse=True)
        self.assertEqual(wild, sorted(real[9:14], reverse=True))

    def test_count_zero_disables_and_pool_caps(self):
        scores = _library_scores(100)
        algorithm._apply_wildcards(scores, config.Settings(wildcard_count=0), "d")
        self.assertFalse(any(s.wildcard for s in scores.values()))
        algorithm._apply_wildcards(scores, config.Settings(wildcard_count=1000), "d")
        pool = sum(1 for s in scores.values() if 0.40 <= s.percentile <= 0.70)
        self.assertEqual(sum(1 for s in scores.values() if s.wildcard), pool)

    def test_plugin_settings_map(self):
        cfg = config.Settings.from_plugin_settings({"wildcardCount": 7,
                                                    "wildcardTopRank": "30"})
        self.assertEqual((cfg.wildcard_count, cfg.wildcard_top_rank), (7, 30))


class PerformerTermsTest(unittest.TestCase):
    NOW = datetime(2026, 10, 19, tzinfo=timezone.utc)

    def _scene(self, sid, pid, played_days_ago=None):
        plays = ([self.NOW - timedelta(days=played_days_ago)]
                 if played_days_ago is not None else [])
        return models.SceneData(
            id=sid, title=sid, play_history=plays, o_history=[],
            play_count=len(plays), o_counter=0, play_duration=1800.0 * len(plays),
            resume_time=None, last_played_at=plays[0] if plays else None,
            file_duration=1800.0, height=1080, marker_count=0, organized=False,
            date=None, created_at=self.NOW - timedelta(days=400), rating100=None,
            tag_ids=[], performer_ids=[pid], studio_id=None, custom_fields={},
            has_file=True)

    def _perf(self, pid):
        return models.PerformerData(id=pid, name=pid, favorite=False, rating100=None,
                                    o_counter=0, scene_count=0, tag_ids=[],
                                    created_at=self.NOW - timedelta(days=400),
                                    custom_fields={})

    def _score(self, scenes, scene_scores, cfg):
        perfs = [self._perf(p) for p in sorted({s.performer_ids[0] for s in scenes})]
        aff = {"performers": {}, "tags": {}, "studios": {}}
        return algorithm.score_performers(perfs, scenes, scene_scores, aff, cfg, self.NOW)

    def test_fresh_term_is_normalized_by_rediscovery_bonus(self):
        scenes = [self._scene("a", "p1", played_days_ago=1000),
                  self._scene("b", "p2", played_days_ago=1)]
        scores = {"a": _scene_score("a", 0.5, 1), "b": _scene_score("b", 0.5, 1)}
        for bonus in (0.25, 0.40, 1.0):
            out = self._score(scenes, scores, config.Settings(rediscovery_bonus=bonus))
            self.assertAlmostEqual(out["p1"].components["fresh"], 1.0)
            self.assertAlmostEqual(out["p2"].components["fresh"], 0.0)

    def test_wildcard_override_does_not_inflate_performer(self):
        cfg = config.Settings()
        scenes = [self._scene(f"s{i}", f"p{i % 4}") for i in range(40)]
        scores = {s.id: _scene_score(s.id, i / 39) for i, s in enumerate(scenes)}
        before = self._score(scenes, scores, cfg)
        for sid in ("s20", "s21", "s22"):          # mid-pack scenes of p0..p2
            scores[sid].restash_score, scores[sid].wildcard = 99, True
        after = self._score(scenes, scores, cfg)
        for pid in before:
            self.assertEqual(before[pid].raw, after[pid].raw)
            self.assertEqual(before[pid].restash_score, after[pid].restash_score)


class RefreshTest(TempPathsMixin, unittest.TestCase):
    def test_refresh_without_cache_runs_full_and_writes_cache(self):
        stash = FakeStash()
        self.assertEqual(self.run_task(stash, "refresh"), 0)
        st = state.load_state(self.state_path)
        self.assertTrue(state.is_valid(st, config.Settings())[0])
        self.assertEqual(len(st["raw_quantiles"]), 1001)
        self.assertTrue(all("restash_score" in s["custom_fields"]
                            for s in stash.scenes.values()))

    def test_refresh_counts_new_watch_data_and_new_scenes(self):
        stash = FakeStash()
        self.run_task(stash, "full")
        cached_aff = state.load_state(self.state_path)["affinities"]
        # an unwatched scene gets heavy, old-enough-to-be-past-cooldown engagement
        target = next(s for s in stash.scenes.values() if not s["play_history"])
        before = int(target["custom_fields"]["restash_score"])
        when = _iso(datetime.now(timezone.utc) - timedelta(days=200))
        target.update(play_history=[when] * 6, o_history=[when] * 6, play_count=6,
                      o_counter=6, play_duration=6 * 1800.0, last_played_at=when)
        stash.add_scene("999", random.Random(1), datetime.now(timezone.utc))

        self.assertEqual(self.run_task(stash, "refresh"), 0)
        self.assertGreater(int(target["custom_fields"]["restash_score"]), before)
        self.assertIn("restash_score", stash.scenes["999"]["custom_fields"])
        self.assertEqual(state.load_state(self.state_path)["affinities"], cached_aff)

    def test_second_run_same_day_writes_nothing(self):
        stash = FakeStash()
        self.run_task(stash, "full")
        stash.calls.clear()
        self.run_task(stash, "refresh")
        self.assertEqual(stash.mutations(), [])


class HookTest(TempPathsMixin, unittest.TestCase):
    def full_library_reads(self, stash):
        return [q for q, v in stash.calls
                if ("findScenes" in q and "scene_filter" not in v)
                or "findPerformers" in q]

    def test_scene_hook_scores_scene_then_its_performers(self):
        stash = FakeStash()
        self.run_task(stash, "full")
        scene = stash.add_scene("500", random.Random(3), datetime.now(timezone.utc))
        pid = scene["performers"][0]["id"]
        stash.performers[pid]["custom_fields"].clear()   # force a performer write
        stash.calls.clear()

        self.assertEqual(self.run_hook(stash, "500"), 0)
        score = int(stash.scenes["500"]["custom_fields"]["restash_score"])
        self.assertTrue(1 <= score <= 100)
        self.assertIn("restash_score", stash.performers[pid]["custom_fields"])
        self.assertEqual(self.full_library_reads(stash), [])
        written = [[v["id"] for v in m[1].values()] for m in stash.mutations()]
        self.assertEqual(written, [["500"], [pid]])

    def test_scene_hook_scores_performer_created_by_the_same_scrape(self):
        stash = FakeStash()
        self.run_task(stash, "full")
        stash.add_performer("77")
        scene = stash.add_scene("500", random.Random(3), datetime.now(timezone.utc))
        scene["performers"] = [{"id": "77"}]

        self.assertEqual(self.run_hook(stash, "500"), 0)
        cf = stash.performers["77"]["custom_fields"]
        self.assertEqual(json.loads(cf["restash_components"])["n_scene_vals"], 1)

    def test_performer_hook_scores_new_performer_without_scenes(self):
        stash = FakeStash()
        self.run_task(stash, "full")
        stash.add_performer("77")
        stash.add_performer("78", favorite=True)
        stash.calls.clear()

        self.assertEqual(self.run_hook(stash, "77", "Performer.Create.Post"), 0)
        self.assertEqual(self.run_hook(stash, "78", "Performer.Create.Post"), 0)
        plain = int(stash.performers["77"]["custom_fields"]["restash_score"])
        fav = int(stash.performers["78"]["custom_fields"]["restash_score"])
        self.assertTrue(1 <= plain <= 100)
        self.assertGreaterEqual(fav, 75)          # favorite_percentile_floor
        self.assertEqual(self.full_library_reads(stash), [])
        self.assertEqual(len(stash.mutations()), 2)

    def test_performer_hook_matches_full_run_score(self):
        # quantile placement converges on the exact ranking as the library grows;
        # 40 performers keeps the small-N rank-method difference within a few points
        stash = FakeStash(n_scenes=400, n_performers=40, seed=40)
        self.run_task(stash, "full")
        for pid, perf in stash.performers.items():
            full = int(perf["custom_fields"]["restash_score"])
            perf["custom_fields"].clear()
            self.run_hook(stash, pid, "Performer.Create.Post")
            hook = int(perf["custom_fields"]["restash_score"])
            self.assertLessEqual(abs(hook - full), 3, f"performer {pid}")

    def test_performer_hook_skips_excluded_and_old_cache(self):
        stash = FakeStash()
        self.run_task(stash, "full")
        stash.exclude_tag_id = "99"
        stash.add_performer("77", tag_ids=["99"])
        self.run_hook(stash, "77", "Performer.Create.Post")
        self.assertEqual(stash.performers["77"]["custom_fields"], {})

        stash.exclude_tag_id = None
        st = state.load_state(self.state_path)
        st.pop("perf_quantiles")                 # cache written before 0.7.0
        Path(self.state_path).write_text(json.dumps(st))
        stash.calls.clear()
        self.assertEqual(self.run_hook(stash, "77", "Performer.Create.Post"), 0)
        self.assertEqual(stash.mutations(), [])

    def test_hook_without_cache_skips(self):
        stash = FakeStash()
        self.assertEqual(self.run_hook(stash, "1"), 0)
        self.assertEqual(stash.mutations(), [])
        self.assertNotIn("restash_score", stash.scenes["1"]["custom_fields"])

    def test_hook_ignores_other_events(self):
        stash = FakeStash()
        self.assertEqual(self.run_hook(stash, "1", "Tag.Create.Post"), 0)
        self.assertEqual(stash.calls, [])


class DisablePluginsTest(TempPathsMixin, unittest.TestCase):
    def test_standalone_disable_is_undone_by_next_scoring_run(self):
        stash = FakeStash()
        self.run_task(stash, "disable-plugins")
        self.assertFalse(stash.plugins["other_a"])
        self.assertTrue(stash.plugins["restash"])
        self.assertTrue(self.disabled_path.exists())

        self.run_task(stash, "dry")
        self.assertTrue(stash.plugins["other_a"] and stash.plugins["other_b"])
        self.assertFalse(stash.plugins["already_off"])
        self.assertFalse(self.disabled_path.exists())

    def test_record_from_interrupted_run_is_restored(self):
        stash = FakeStash()
        stash.plugins["other_a"] = False
        self.disabled_path.write_text(json.dumps(["other_a", "uninstalled"]))
        self.run_task(stash, "refresh")
        self.assertTrue(stash.plugins["other_a"])
        self.assertNotIn("uninstalled", stash.plugins)
        self.assertFalse(self.disabled_path.exists())

    def test_setting_disables_during_run_and_restores_after(self):
        stash = FakeStash()
        seen = {}
        real_full = restash._run_full

        def spy(st, settings):
            seen.update(st.plugins)
            return real_full(st, settings)

        with mock.patch.object(restash, "_run_full", spy), \
                mock.patch.object(stash_io, "fetch_plugin_settings",
                                  lambda s, pid: {"disablePluginsBeforeRun": True}):
            self.run_task(stash, "full")
        self.assertFalse(seen["other_a"])
        self.assertTrue(stash.plugins["other_a"])
        self.assertFalse(stash.plugins["already_off"])


if __name__ == "__main__":
    unittest.main()
