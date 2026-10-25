import json
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "plugins" / "restash"))

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
import state  # noqa: E402

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)


def performer(pid, stats=None, favorite=False):
    cf = {"hotornot_stats": json.dumps(stats)} if stats is not None else {}
    return models.PerformerData(id=pid, name=pid, favorite=favorite, rating100=None,
                                o_counter=0, scene_count=0, tag_ids=[],
                                created_at=NOW, custom_fields=cf)


def iso(days_ago):
    return (NOW - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")


class ChampionBonusTest(unittest.TestCase):
    def setUp(self):
        self.cfg = config.Settings()

    def bonus(self, *performers):
        return algorithm.champion_bonuses(list(performers), NOW, self.cfg)

    def test_each_title_closes_half_the_gap(self):
        b = self.bonus(performer("1", {"tournament_wins": 1, "last_title": iso(0)}),
                       performer("2", {"tournament_wins": 2, "last_title": iso(0)}),
                       performer("3", {"tournament_wins": 3, "last_title": iso(0)}))
        full = self.cfg.champion_affinity_bonus
        self.assertAlmostEqual(b["1"], full * 0.5)
        self.assertAlmostEqual(b["2"], full * 0.75)
        self.assertAlmostEqual(b["3"], full * 0.875)

    def test_the_bonus_halves_every_half_life_since_the_last_title(self):
        hl = self.cfg.champion_half_life_days
        fresh = self.bonus(performer("a", {"tournament_wins": 1, "last_title": iso(0)}))["a"]
        old = self.bonus(performer("a", {"tournament_wins": 1, "last_title": iso(hl)}))["a"]
        older = self.bonus(performer("a", {"tournament_wins": 1, "last_title": iso(2 * hl)}))["a"]
        self.assertAlmostEqual(old, fresh / 2)
        self.assertAlmostEqual(older, fresh / 4)

    def test_titles_without_a_date_fall_back_to_the_last_match(self):
        b = self.bonus(performer("m", {"tournament_wins": 1, "last_match": iso(0)}),
                       performer("n", {"tournament_wins": 1}))
        self.assertAlmostEqual(b["m"], self.cfg.champion_affinity_bonus * 0.5)
        self.assertAlmostEqual(b["n"], self.cfg.champion_affinity_bonus * 0.25)

    def test_no_title_no_stats_or_bad_stats_give_nothing(self):
        bad = performer("x")
        bad.custom_fields = {"hotornot_stats": "{not json"}
        b = self.bonus(performer("0", {"tournament_wins": 0, "last_title": iso(0)}),
                       performer("none"), bad)
        self.assertEqual(b, {})

    def test_zero_strength_turns_it_off(self):
        self.cfg.champion_affinity_bonus = 0
        self.assertEqual(self.bonus(performer("1", {"tournament_wins": 3, "last_title": iso(0)})), {})

    def test_a_champion_lifts_their_affinity_like_a_favourite(self):
        z = {"c": 0.0, "f": 0.0, "plain": 0.0}
        champs = self.bonus(performer("c", {"tournament_wins": 3, "last_title": iso(0)}))
        aff = algorithm.apply_performer_priors(z, {"f"}, {}, self.cfg, champs)
        self.assertGreater(aff["c"], aff["plain"])
        self.assertGreater(aff["f"], aff["c"])  # the favourite bonus (1.0) is stronger
        self.assertEqual(aff["plain"], 0.0)

    def test_the_setting_reaches_the_cache_fingerprint(self):
        before = state.settings_fingerprint(self.cfg)
        self.cfg.champion_affinity_bonus = 0.2
        self.assertNotEqual(state.settings_fingerprint(self.cfg), before)

    def test_the_setting_is_read_from_stash(self):
        cfg = config.Settings.from_plugin_settings({"championAffinityBonus": "0.4"})
        self.assertEqual(cfg.champion_affinity_bonus, 0.4)


if __name__ == "__main__":
    unittest.main()
