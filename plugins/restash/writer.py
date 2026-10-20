from __future__ import annotations
import json
import time

import models

RESTASH_KEYS = ["restash_score", "restash_raw", "restash_components", "restash_updated"]


def _round_components(components: dict) -> dict:
    out = {}
    for k, v in components.items():
        out[k] = round(v, 3) if isinstance(v, float) else v
    return out


def scene_partial(score: models.SceneScore, now_iso: str) -> dict:
    return {"restash_score": int(score.restash_score),
            "restash_raw": round(score.raw, 4),
            "restash_components": json.dumps(_round_components(score.components)),
            "restash_updated": now_iso}


def performer_partial(score: models.PerformerScore, now_iso: str) -> dict:
    return {"restash_score": int(score.restash_score),
            "restash_raw": round(score.raw, 4),
            "restash_components": json.dumps(_round_components(score.components)),
            "restash_updated": now_iso}


def _is_wildcard(components) -> bool:
    """True if a restash_components value (JSON string or dict) marks a wildcard."""
    if isinstance(components, str):
        try:
            components = json.loads(components)
        except ValueError:
            return False
    return isinstance(components, dict) and bool(components.get("wildcard"))


def stored_score(existing_custom_fields: dict) -> int | None:
    """The restash_score currently stored on an entity, or None if absent/garbled.
    Stash's custom_fields Map may return ints, floats or strings."""
    existing = existing_custom_fields.get("restash_score")
    try:
        return int(float(existing))
    except (TypeError, ValueError):
        return None


def needs_write(existing_custom_fields: dict, new_partial: dict,
                min_change: float = 1) -> bool:
    """Write when there is no stored score, when a wildcard promotion starts or
    ends, or when the headline score moved by at least `min_change` (hysteresis:
    small jitter-driven wobbles are not worth a mutation + every other plugin's
    Scene.Update.Post hook). restash_updated is intentionally NOT compared."""
    existing = stored_score(existing_custom_fields)
    if existing is None:
        return True
    new = int(new_partial["restash_score"])
    if existing == new:
        return False
    if (_is_wildcard(existing_custom_fields.get("restash_components"))
            or _is_wildcard(new_partial.get("restash_components"))):
        return True
    return abs(new - existing) >= max(1, min_change)


_UPDATE_FIELD = {"scene": ("sceneUpdate", "SceneUpdateInput"),
                 "performer": ("performerUpdate", "PerformerUpdateInput")}


def aliased_update_mutation(entity: str, n: int) -> str:
    """Build a single GraphQL mutation with n aliased <entity>Update calls, each
    taking its own input variable ($i0, $i1, ...). Works for both partial-write
    and remove inputs (the input shape is decided by the caller's variables)."""
    field, itype = _UPDATE_FIELD[entity]
    decls = ", ".join(f"$i{k}: {itype}!" for k in range(n))
    body = "\n".join(f"  u{k}: {field}(input: $i{k}) {{ id }}" for k in range(n))
    return f"mutation({decls}) {{\n{body}\n}}"


def _chunks(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _call_with_retry(stash, query: str, variables: dict, cfg):
    """Call the GraphQL endpoint, retrying on ANY transport exception with
    exponential backoff (stashapi raises generic Exceptions; we treat any failure
    as retryable up to write_max_retries)."""
    last_exc = None
    for attempt in range(cfg.write_max_retries + 1):
        try:
            return stash.call_GQL(query, variables)
        except Exception as exc:   # noqa: BLE001 — any transport failure is retryable
            last_exc = exc
            if attempt < cfg.write_max_retries:
                time.sleep(cfg.write_backoff_base * (2 ** attempt))
    raise last_exc


def _count_succeeded(result, n: int) -> int:
    """How many of the n aliased updates (u0..u{n-1}) actually committed.
    stashapi returns HTTP 200 + a data dict even when some aliases error (the
    failed ones come back as null), so a batch is NOT necessarily all-or-nothing.
    Count only the non-null aliases. If the response shape is unrecognized, assume
    all n committed (we cannot prove a failure) rather than under-reporting."""
    if not isinstance(result, dict):
        return n
    return sum(1 for k in range(n) if result.get(f"u{k}") is not None)


def write_scores(stash, entity: str, scored: dict, existing_custom_fields: dict,
                 cfg, now_iso: str, current_ratings: dict | None = None) -> dict:
    """Partial-write restash_* for changed entities only, in aliased batches.
    `scored` maps id → SceneScore/PerformerScore; `existing_custom_fields` maps id →
    that entity's current custom_fields (for skip-unchanged). When
    cfg.mirror_to_rating100 is set, also writes rating100 = score and (using
    `current_ratings`, id → current rating100) writes entities whose native rating
    differs from the score left stored after hysteresis (D20). Honors write_limit
    (subset-first gate). Returns {written, skipped, would_write, failed} where
    `written`/`failed` count only server-acknowledged (non-null) aliases."""
    build = scene_partial if entity == "scene" else performer_partial
    current_ratings = current_ratings or {}
    pending = []
    skipped = 0
    for eid, score in scored.items():
        partial = build(score, now_iso)
        existing = existing_custom_fields.get(eid) or {}
        need = needs_write(existing, partial, cfg.min_score_change)
        if not need and cfg.mirror_to_rating100:
            # The score held back by hysteresis is what stays stored, so the
            # mirrored rating only needs to match that.
            need = current_ratings.get(eid) != stored_score(existing)
        if not need:
            skipped += 1
            continue
        inp = {"id": str(eid), "custom_fields": {"partial": partial}}
        if cfg.mirror_to_rating100:
            inp["rating100"] = int(score.restash_score)
        pending.append(inp)

    would_write = len(pending)
    if cfg.write_limit and would_write > cfg.write_limit:
        pending = pending[:cfg.write_limit]

    written = 0
    failed = 0
    for batch in _chunks(pending, cfg.write_chunk_size):
        query = aliased_update_mutation(entity, len(batch))
        variables = {f"i{k}": inp for k, inp in enumerate(batch)}
        result = _call_with_retry(stash, query, variables, cfg)
        ok = _count_succeeded(result, len(batch))
        written += ok
        failed += len(batch) - ok
    return {"written": written, "skipped": skipped, "would_write": would_write,
            "failed": failed}


def clear_scores(stash, entity: str, ids: list, cfg) -> int:
    """Remove all restash_* keys from the given entities via CustomFieldsInput.remove
    (v0.30+), in aliased batches. Leaves every other custom field untouched."""
    inputs = [{"id": str(i), "custom_fields": {"remove": RESTASH_KEYS}} for i in ids]
    cleared = 0
    for batch in _chunks(inputs, cfg.write_chunk_size):
        query = aliased_update_mutation(entity, len(batch))
        variables = {f"i{k}": inp for k, inp in enumerate(batch)}
        result = _call_with_retry(stash, query, variables, cfg)
        cleared += _count_succeeded(result, len(batch))
    return cleared


def write_ratings(stash, entity: str, id_to_rating: dict, cfg) -> dict:
    """Write native rating100 (a value, or None to clear) to the given entities, in
    aliased batches. Used by the Restore Ratings task -- touches ONLY rating100, no
    custom_fields. Returns {written, failed} counting server-acknowledged aliases."""
    inputs = [{"id": str(i), "rating100": v} for i, v in id_to_rating.items()]
    written = 0
    failed = 0
    for batch in _chunks(inputs, cfg.write_chunk_size):
        query = aliased_update_mutation(entity, len(batch))
        variables = {f"i{k}": inp for k, inp in enumerate(batch)}
        result = _call_with_retry(stash, query, variables, cfg)
        ok = _count_succeeded(result, len(batch))
        written += ok
        failed += len(batch) - ok
    return {"written": written, "failed": failed}
