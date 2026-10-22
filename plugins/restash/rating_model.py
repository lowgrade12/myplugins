"""Rating model: an additive taste model fitted to the user's own scene ratings.

    stars ≈ μ + Σ performer weights + studio (+ parent) weight
              + Σ tag weights · 2/√(tag count)

Ridge (L2) shrinkage per feature group, fitted by coordinate descent. Ported from
Cherry Pick's "Your score" (src/js/model/taste.js), content-only: Restash already
scores watch behaviour through its direct-evidence term, so the model here is the
one that also works for a scene nobody has played yet (the new-scene hook).

Targets are the user's own rating100 / 20. A rating equal to the scene's stored
restash_score is Restash's mirror, not the user's, and is left out; with the
mirror on, the rating backup holds the user's ratings and is read instead.
Scenes that were watched but never rated add weak pseudo-labels from their
behaviour score (weight 0.3). Accuracy is measured on held-out ratings: five
80/20 splits, each rated scene held out once, against the "your average"
baseline.
"""
from __future__ import annotations
import math
import random
from operator import mul

import models

LAMBDA = {"p": 3.0, "s": 2.0, "t": 4.0}
TAG_SCALE = 2.0         # tag features are 2/√(#tags) so long tag lists don't dominate
MIN_TAG_SUPPORT = 3     # a tag needs this many training scenes to get a weight
MAX_TAG_SHARE = 0.85    # ...and must not be on nearly every scene
PSEUDO_WEIGHT = 0.3
MAX_ITERATIONS = 60
TOLERANCE = 1e-3        # stop once no weight moves by more than this (stars)
FOLDS = 5
SEED = 20261015

# Rated scenes the holdout needs before it can say whether the model beats the
# user's average (two per fold). Below it, the model is not used.
MIN_RATED = 10

# A play counts as much as the time behind it: each tenth of a scene's length
# played pays for one play, so a scene swiped past teaches nothing.
WATCHED_SHARE = 0.1
_DEFAULT_DURATION = 1800.0


# ---------------------------------------------------------------- ratings

def own_scene_ratings(scenes: list[models.SceneData],
                      backup: dict | None = None) -> dict[str, int]:
    """id -> rating100 the user set. `backup` (the rating backup's scenes map) is
    the source when the rating100 mirror is on, since live ratings are then
    Restash's. A live rating equal to the stored restash_score is Restash's mirror
    and is dropped."""
    out: dict[str, int] = {}
    for s in scenes:
        r = backup.get(s.id) if backup is not None else s.rating100
        if r is None:
            continue
        if backup is not None:
            out[s.id] = int(r)
            continue
        stored = (s.custom_fields or {}).get("restash_score")
        try:
            if stored is not None and int(stored) == int(r):
                continue
        except (TypeError, ValueError):
            pass
        out[s.id] = int(r)
    return out


# ---------------------------------------------------------------- behaviour

def play_weight(scene: models.SceneData) -> float:
    """What each play counts for, 0..1: 0 for a scene only looked at, 1 when its
    play time pays for every play. Plays with no play time count in full."""
    if not scene.play_count:
        return 0.0
    if not scene.play_duration:
        return 1.0
    paid = scene.play_duration / (WATCHED_SHARE * (scene.file_duration or _DEFAULT_DURATION))
    return 0.0 if paid < 1 else min(1.0, paid / scene.play_count)


def behaviour_score(scene: models.SceneData) -> float | None:
    """0..1 from watch-through, rewatch days and o count; None if never watched."""
    weight = play_weight(scene)
    if not weight:
        return None
    duration = scene.file_duration or _DEFAULT_DURATION
    watch_through = min(1.0, scene.play_duration / duration)
    days = len({ts.date() for ts in scene.play_history})
    rewatch_days = max(0.0, days * weight - 1)
    o = scene.o_counter or 0
    return (0.5 * watch_through
            + 0.3 * (1 - math.exp(-rewatch_days / 2))
            + 0.2 * (1 - math.exp(-o / 1.5)))


# ---------------------------------------------------------------- features

def scene_features(scene: models.SceneData) -> list[tuple[str, float]]:
    f = [("p:" + p, 1.0) for p in scene.performer_ids]
    if scene.studio_id:
        f.append(("s:" + scene.studio_id, 1.0))
        if scene.studio_parent_id:
            f.append(("s:" + scene.studio_parent_id, 1.0))
    if scene.tag_ids:
        x = TAG_SCALE / math.sqrt(len(scene.tag_ids))
        f.extend(("t:" + t, x) for t in scene.tag_ids)
    return f


# ---------------------------------------------------------------- samples

def build_samples(scenes: list[models.SceneData], ratings: dict[str, int]):
    """(rated, watched_unrated): rated are (scene, stars, behaviour|None),
    watched_unrated are (scene, behaviour)."""
    rated, watched = [], []
    for s in scenes:
        b = behaviour_score(s)
        r = ratings.get(s.id)
        if r is not None:
            rated.append((s, r / 20.0, b))
        elif b is not None:
            watched.append((s, b))
    return rated, watched


# ---------------------------------------------------------------- fit

def _calibration(rated) -> tuple[float, float]:
    """stars ≈ a + c·behaviour on rated scenes that were watched."""
    with_b = [(y, b) for _, y, b in rated if b is not None]
    if len(with_b) < 5:
        return 3.0, 2.0
    mb = sum(b for _, b in with_b) / len(with_b)
    my = sum(y for y, _ in with_b) / len(with_b)
    sxy = sum((b - mb) * (y - my) for y, b in with_b)
    sxx = sum((b - mb) ** 2 for _, b in with_b)
    c = sxy / sxx if sxx > 1e-9 else 0.0
    return my - c * mb, c


def fit(rated, watched, start: dict | None = None) -> dict:
    """Fit the model; returns a JSON-serialisable dict for the state cache.
    `start` (a fitted model) seeds the weights, so a holdout fold only has to
    move from the full fit instead of from zero."""
    a, c = _calibration(rated)
    samples = ([(s, y, 1.0) for s, y, _ in rated]
               + [(s, min(5.0, max(1.0, a + c * b)), PSEUDO_WEIGHT) for s, b in watched])
    rated_mean = sum(y for _, y, _ in rated) / len(rated) if rated else 3.0
    n = len(samples)
    sw = sum(w for _, _, w in samples)
    if not sw:
        return {"mu": 3.0, "weights": {}, "rated_mean": rated_mean,
                "n_rated": 0, "n_pseudo": 0}

    rows_x = [scene_features(s) for s, _, _ in samples]
    tag_count: dict[str, int] = {}
    for row in rows_x:
        for k, _ in row:
            if k[0] == "t":
                tag_count[k] = tag_count.get(k, 0) + 1
    tag_max = MAX_TAG_SHARE * n

    cols: dict[str, tuple[list, list]] = {}
    for i, row in enumerate(rows_x):
        for k, x in row:
            if k[0] == "t" and not (MIN_TAG_SUPPORT <= tag_count[k] <= tag_max):
                continue
            col = cols.get(k)
            if col is None:
                col = cols[k] = ([], [])
            col[0].append(i)
            col[1].append(x)

    wts = [w for _, _, w in samples]
    keys = list(cols)
    col_rows = [cols[k][0] for k in keys]
    col_x = [cols[k][1] for k in keys]
    col_wx = [[wts[i] * x for i, x in zip(r, xs)] for r, xs in zip(col_rows, col_x)]
    col_sxx = [sum(map(mul, wx, xs)) for wx, xs in zip(col_wx, col_x)]
    col_den = [LAMBDA[k[0]] + sxx for k, sxx in zip(keys, col_sxx)]
    if start:
        wv = [start["weights"].get(k, 0.0) for k in keys]
        mu = start["mu"]
    else:
        wv = [0.0] * len(keys)
        mu = sum(w * y for _, y, w in samples) / sw
    r = [y - mu for _, y, _ in samples]
    for j in range(len(keys)):
        if wv[j]:
            for i, x in zip(col_rows[j], col_x[j]):
                r[i] -= x * wv[j]
    for _ in range(MAX_ITERATIONS):
        d = sum(map(mul, wts, r)) / sw
        mu += d
        r = [ri - d for ri in r]
        moved = abs(d)
        for j in range(len(keys)):
            rows, xs, w0 = col_rows[j], col_x[j], wv[j]
            num = w0 * col_sxx[j] + sum(map(mul, col_wx[j], map(r.__getitem__, rows)))
            w1 = num / col_den[j]
            delta = w1 - w0
            if delta:
                for i, x in zip(rows, xs):
                    r[i] -= x * delta
                wv[j] = w1
                if abs(delta) > moved:
                    moved = abs(delta)
        if moved < TOLERANCE:
            break

    return {"mu": mu,
            "weights": {k: round(w, 5) for k, w in zip(keys, wv) if abs(w) >= 1e-5},
            "rated_mean": rated_mean, "n_rated": len(rated), "n_pseudo": len(watched)}


def predict(model: dict, scene: models.SceneData) -> float:
    """Predicted stars, 0.5..5."""
    weights = model["weights"]
    raw = model["mu"] + sum(weights.get(k, 0.0) * x for k, x in scene_features(scene))
    return min(5.0, max(0.5, raw))


# ---------------------------------------------------------------- holdout

def cross_validate(rated, watched, full: dict | None = None, folds: int = FOLDS,
                   seed: int = SEED) -> dict | None:
    """Mean absolute error of the model and of "your average" on held-out ratings,
    and the share of predictions within half a star. None below MIN_RATED.
    `full`, the model fitted on every rating, warm-starts each fold."""
    if len(rated) < MIN_RATED:
        return None
    order = list(rated)
    random.Random(seed).shuffle(order)
    err_model = err_base = 0.0
    within_model = within_base = 0
    for f in range(folds):
        train = [x for i, x in enumerate(order) if i % folds != f]
        test = [x for i, x in enumerate(order) if i % folds == f]
        m = fit(train, watched, start=full)
        for s, y, _ in test:
            pm, pb = abs(predict(m, s) - y), abs(m["rated_mean"] - y)
            err_model += pm
            err_base += pb
            within_model += pm <= 0.5
            within_base += pb <= 0.5
    n = len(order)
    return {"n": n, "folds": folds, "mae_model": err_model / n, "mae_base": err_base / n,
            "within_model": within_model / n, "within_base": within_base / n}


def beats_baseline(cv: dict | None) -> bool:
    return bool(cv) and cv["mae_model"] < cv["mae_base"]


def content_term(model: dict, scene: models.SceneData) -> float:
    """The prediction on Restash's [-1,1] ingredient scale: half a star per 0.25
    around the user's average rating."""
    return max(-1.0, min(1.0, (predict(model, scene) - model["rated_mean"]) / 2.0))


def fit_library(scenes: list[models.SceneData], backup: dict | None = None) -> dict:
    """Fit on every own rating in `scenes` and check it on held-out ones. The
    result is cached in restash_state.json; `usable` says whether scoring uses it
    (only once it predicts held-out ratings better than the user's average)."""
    rated, watched = build_samples(scenes, own_scene_ratings(scenes, backup))
    model = fit(rated, watched)
    model["cv"] = cross_validate(rated, watched, full=model)
    model["usable"] = beats_baseline(model["cv"])
    model["min_rated"] = MIN_RATED
    return model


def usable(model: dict | None) -> dict | None:
    """The model if scoring should use it, else None."""
    return model if model and model.get("usable") else None
