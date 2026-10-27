"""A performer's StashDB scenes you don't have, scored by Restash's taste.

Restash's UI (restash-ui.js) calls this through Stash's runPluginOperation
with args {"mode": "missing", "performer_id": "<local id>"}. Everything runs
here on the server: the StashDB key stays in Stash's configuration, and the
browser makes no request to StashDB.

Steps:
  1. the performer's StashDB id, and the StashDB stash-box (endpoint + key)
  2. their scenes on StashDB, most popular first (one page), minus scenes
     carrying a hidden tag (settings: missingHiddenTags, VR by default)
  3. which of them the library already has (one aliased Stash query)
  4. each scene described as Restash sees a scene: local performer, studio and
     tag ids (aliased Stash queries for performers and studios, tags by name)
  5. scored against the cached taste model like the new-scene hook does, and
     placed on the library's score scale with its raw-score quantiles

The answer goes to stdout as Stash's plugin output: {"output": {...}}.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import algorithm
import models
import rating_model
import state

STASHDB_HOST = "stashdb.org"
PER_PAGE = 100          # StashDB scenes per request, most popular first
MAX_PAGES = 5           # how far down a performer's list to look
DEFAULT_LIMIT = 24      # scenes handed back to the page
HTTP_TIMEOUT = 30
STORE_CATEGORY = "Content distribution platforms"

STASHDB_SCENES = """
query RestashMissing($input: SceneQueryInput!) {
  queryScenes(input: $input) {
    count
    scenes {
      id title release_date duration
      images { url width height }
      studio { id name parent { id name } }
      performers { performer { id name } }
      tags { id name aliases }
      urls { url site { name category { name } } }
    }
  }
}
"""


class MissingError(Exception):
    """A problem worth showing on the page, as is."""


# ---------- StashDB ----------

def stashdb_box(stash) -> dict:
    """The StashDB stash-box from Stash's settings: {endpoint, api_key}."""
    res = stash.call_GQL("query { configuration { general { stashBoxes { endpoint api_key } } } }")
    boxes = (((res or {}).get("configuration") or {}).get("general") or {}).get("stashBoxes") or []
    for box in boxes:
        if STASHDB_HOST in (box.get("endpoint") or "") and box.get("api_key"):
            return box
    raise MissingError("Add a StashDB stash-box with an API key in Settings › Metadata Providers.")


def stashdb_query(box: dict, query: str, variables: dict) -> dict:
    req = urllib.request.Request(
        box["endpoint"],
        data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
        headers={"Content-Type": "application/json", "ApiKey": box["api_key"]},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
            body = json.loads(r.read().decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        raise MissingError(f"StashDB answered {e.code}.") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MissingError(f"StashDB could not be reached: {e}") from e
    if body.get("errors"):
        raise MissingError(f"StashDB: {body['errors'][0].get('message')}")
    return body.get("data") or {}


def performer_scenes(box: dict, stashdb_performer_id: str, page: int = 1) -> tuple[list, int]:
    data = stashdb_query(box, STASHDB_SCENES, {"input": {
        "performers": {"value": [stashdb_performer_id], "modifier": "INCLUDES"},
        "sort": "POPULARITY", "direction": "DESC", "page": page, "per_page": PER_PAGE,
    }})
    q = data.get("queryScenes") or {}
    return q.get("scenes") or [], q.get("count") or 0


def site_of(endpoint: str) -> str:
    """The StashDB site's address, for links to its scene pages."""
    from urllib.parse import urlparse
    u = urlparse(endpoint or "")
    return f"{u.scheme}://{u.netloc}" if u.netloc else "https://stashdb.org"


def is_hidden(row: dict, hidden: frozenset) -> bool:
    """True if any of the scene's StashDB tags matches a hidden tag by name or
    alias (case-insensitive)."""
    if not hidden:
        return False
    for t in row.get("tags") or []:
        for n in [t.get("name")] + list(t.get("aliases") or []):
            if (n or "").strip().lower() in hidden:
                return True
    return False


# ---------- Stash: what the library has ----------

def stashdb_id_of(stash_ids, endpoint) -> str | None:
    for sid in stash_ids or []:
        if sid.get("endpoint") == endpoint:
            return sid.get("stash_id")
    return None


def _aliased(stash, kind: str, endpoint: str, ids: list[str]) -> dict:
    """Local ids for StashDB ids, one request: {stashdb_id: [local ids]}.
    kind: 'scene', 'performer' or 'studio'. Stash's stash_id filter takes one
    id, so each id is its own alias."""
    if not ids:
        return {}
    find = {"scene": ("findScenes", "scene_filter", "scenes"),
            "performer": ("findPerformers", "performer_filter", "performers"),
            "studio": ("findStudios", "studio_filter", "studios")}[kind]
    fn, filt, lst = find
    parts, variables, decl = [], {"e": endpoint}, ["$e: String!"]
    for i, sid in enumerate(ids):
        decl.append(f"$i{i}: String!")
        variables[f"i{i}"] = sid
        parts.append(f'a{i}: {fn}({filt}: {{ stash_id_endpoint: {{ endpoint: $e, stash_id: $i{i}, modifier: EQUALS }} }}, filter: {{ per_page: -1 }}) {{ {lst} {{ id }} }}')
    q = f"query RestashLocal({', '.join(decl)}) {{ {' '.join(parts)} }}"
    res = stash.call_GQL(q, variables) or {}
    return {sid: [r["id"] for r in (res.get(f"a{i}") or {}).get(lst) or []]
            for i, sid in enumerate(ids)}


def performer_stash_ids(stash, performer_id: str, endpoint: str) -> set:
    """The StashDB ids of the scenes the library credits to this performer."""
    res = stash.call_GQL(
        "query RestashTheirs($p: [ID!]) { findScenes(scene_filter: { performers: "
        "{ value: $p, modifier: INCLUDES } }, filter: { per_page: -1 }) "
        "{ scenes { stash_ids { endpoint stash_id } } } }", {"p": [performer_id]}) or {}
    out = set()
    for sc in (res.get("findScenes") or {}).get("scenes") or []:
        sid = stashdb_id_of(sc.get("stash_ids"), endpoint)
        if sid:
            out.add(sid)
    return out


def tag_ids_by_name(stash) -> dict:
    res = stash.call_GQL("query { findTags(filter: { per_page: -1 }) { tags { id name aliases } } }") or {}
    out = {}
    for t in (res.get("findTags") or {}).get("tags") or []:
        for n in [t.get("name")] + list(t.get("aliases") or []):
            if n:
                out.setdefault(n.strip().lower(), t["id"])
    return out


# ---------- Scoring ----------

def _parse_date(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s)[:10]).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _height(images):
    # StashDB's images are covers, not the video; no height to go on
    return None


def to_scene_data(row: dict, perf_map: dict, studio_map: dict, tag_map: dict,
                  now: datetime) -> models.SceneData:
    perf_ids = []
    for a in row.get("performers") or []:
        p = (a or {}).get("performer") or {}
        perf_ids.extend(perf_map.get(p.get("id"), [])[:1])
    st = row.get("studio") or {}
    studio_id = (studio_map.get(st.get("id")) or [None])[0] if st else None
    parent = st.get("parent") or {}
    parent_id = (studio_map.get(parent.get("id")) or [None])[0] if parent else None
    tag_ids = []
    for t in row.get("tags") or []:
        tid = tag_map.get((t.get("name") or "").strip().lower())
        if tid:
            tag_ids.append(tid)
    return models.SceneData(
        id=row["id"], title=row.get("title") or "", play_history=[], o_history=[],
        play_count=0, o_counter=0, play_duration=0.0, resume_time=None,
        last_played_at=None, file_duration=row.get("duration"), height=_height(row.get("images")),
        marker_count=0, organized=False, date=_parse_date(row.get("release_date")),
        created_at=now, rating100=None, tag_ids=tag_ids, performer_ids=perf_ids,
        studio_id=studio_id, custom_fields={}, has_file=False, studio_parent_id=parent_id,
    )


def reason_for(comp: dict, row: dict) -> str | None:
    """A few words on what speaks for the scene, from its strongest part."""
    parts = [("perf", comp.get("perf") or 0.0), ("studio", comp.get("studio") or 0.0),
             ("tag", comp.get("tag") or 0.0)]
    kind, value = max(parts, key=lambda x: x[1])
    if value < 0.15:
        return None
    if kind == "studio" and row.get("studio"):
        return f"You watch {row['studio']['name']}"
    if kind == "perf":
        return "Performers you watch"
    return "Tags you like"


def score(rows: list[dict], st: dict | None, settings, perf_map, studio_map, tag_map,
          now: datetime) -> dict:
    """{stashdb_id: {"score": 0-100, "reason": str|None}}; None scores without
    a taste model (Recompute All has not run)."""
    if not st:
        return {r["id"]: {"score": None, "reason": None} for r in rows}
    scenes = [to_scene_data(r, perf_map, studio_map, tag_map, now) for r in rows]
    scored = algorithm.score_scenes(
        scenes, settings, now, now.strftime("%Y-%m-%d"), aff=st["affinities"],
        context=st["context"], wildcards=False,
        ratings_fit=rating_model.usable(st.get("rating_model")))
    by_id = {r["id"]: r for r in rows}
    out = {}
    for sid, sc in scored.items():
        pct = algorithm.percentile_from_quantiles(sc.raw, st["raw_quantiles"])
        out[sid] = {"score": algorithm.to_restash_score(pct),
                    "reason": reason_for(sc.components, by_id[sid])}
    return out


# ---------- The card ----------

def image_of(images):
    if not images:
        return None
    landscape = [i for i in images if (i.get("width") or 0) >= (i.get("height") or 0)]
    pick = max(landscape or images, key=lambda i: (i.get("width") or 0))
    return pick.get("url")


def store_of(urls):
    links = [{"url": (u or {}).get("url"), "site": ((u or {}).get("site") or {}).get("name"),
              "category": (((u or {}).get("site") or {}).get("category") or {}).get("name")}
             for u in urls or []]
    links = [u for u in links if u["url"] and u["site"] and "web.archive.org" not in u["url"]]
    pick = (next((u for u in links if u["category"] == STORE_CATEGORY), None)
            or next((u for u in links if u["site"].lower() == "studio"), None))
    return {"url": pick["url"], "site": pick["site"]} if pick else None


def card(row: dict, rank: int, scored: dict) -> dict:
    s = scored.get(row["id"]) or {}
    return {
        "id": row["id"],
        "title": row.get("title") or "",
        "date": row.get("release_date"),
        "duration": row.get("duration"),
        "image": image_of(row.get("images")),
        "studio": (row.get("studio") or {}).get("name"),
        "performers": [((a or {}).get("performer") or {}).get("name")
                       for a in row.get("performers") or []],
        "store": store_of(row.get("urls")),
        "score": s.get("score"),
        "reason": s.get("reason"),
        "popularity": rank,
    }


# ---------- The operation ----------

def missing_for_performer(stash, settings, performer_id: str, limit: int = DEFAULT_LIMIT,
                          now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    box = stashdb_box(stash)
    endpoint = box["endpoint"]
    res = stash.call_GQL(
        "query RestashPerformer($id: ID!) { findPerformer(id: $id) { id stash_ids { endpoint stash_id } } }",
        {"id": performer_id}) or {}
    performer = res.get("findPerformer")
    if not performer:
        raise MissingError("Performer not found.")
    pid = stashdb_id_of(performer.get("stash_ids"), endpoint)
    if not pid:
        return {"linked": False, "total": 0, "missing": 0, "scenes": []}

    # A big library has most of a performer's popular scenes: look a page at
    # a time, most popular first, until there are enough to show
    # The performer's own scenes in the library answer most of it in one
    # request; only the rest are looked up one alias each
    # Hidden scenes (VR by default) are dropped before anything else, so they
    # never count toward the limit and the page keeps looking until it fills
    theirs = performer_stash_ids(stash, performer_id, endpoint)
    hide = settings.missing_hidden_tag_set()
    rows, owned, total, looked, hidden = [], {}, 0, 0, 0
    for page in range(1, MAX_PAGES + 1):
        page_rows, total = performer_scenes(box, pid, page)
        looked += len(page_rows)
        shown = [r for r in page_rows if not is_hidden(r, hide)]
        hidden += len(page_rows) - len(shown)
        for r in shown:
            if r["id"] in theirs:
                owned[r["id"]] = [True]
        owned.update(_aliased(stash, "scene", endpoint,
                              [r["id"] for r in shown if r["id"] not in theirs]))
        rows.extend(shown)
        have = sum(1 for r in rows if not owned.get(r["id"]))
        if have >= limit or len(page_rows) < PER_PAGE or looked >= total:
            break
    missing = [r for r in rows if not owned.get(r["id"])]

    perf_ids = sorted({((a or {}).get("performer") or {}).get("id")
                       for r in missing for a in r.get("performers") or []} - {None})
    studio_ids = set()
    for r in missing:
        st = r.get("studio") or {}
        if st.get("id"):
            studio_ids.add(st["id"])
        if (st.get("parent") or {}).get("id"):
            studio_ids.add(st["parent"]["id"])
    perf_map = _aliased(stash, "performer", endpoint, perf_ids)
    studio_map = _aliased(stash, "studio", endpoint, sorted(studio_ids))
    tag_map = tag_ids_by_name(stash)

    st = state.load_state(state.default_state_path())
    ok, _ = state.is_valid(st, settings)
    scored = score(missing, st if ok else None, settings, perf_map, studio_map, tag_map, now)

    cards = [card(r, i, scored) for i, r in enumerate(rows) if not owned.get(r["id"])]
    # Restash's score first; popularity breaks ties and orders an unscored list
    cards.sort(key=lambda c: (-(c["score"] if c["score"] is not None else -1), c["popularity"]))
    return {"linked": True, "site": site_of(endpoint), "total": total, "looked_at": looked,
            "missing": len(missing), "hidden": hidden, "scored": bool(ok),
            "scenes": cards[:limit]}


def run_op(stash, settings, args: dict) -> int:
    try:
        limit = int(args.get("limit") or DEFAULT_LIMIT)
        result = {"ok": True, "result": missing_for_performer(
            stash, settings, str(args.get("performer_id") or ""), max(1, min(limit, 60)))}
    except MissingError as e:
        result = {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001 — the page shows it; never a crash
        result = {"ok": False, "error": f"Restash: {e}"}
    sys.stdout.write(json.dumps({"output": result}))
    sys.stdout.flush()
    return 0
