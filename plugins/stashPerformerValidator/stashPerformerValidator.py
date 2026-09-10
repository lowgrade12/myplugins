"""Stash Performer Validator

Checks every local performer's stash-box (StashDB, TPDB, etc.) stash_ids
against the live stash-box GraphQL API to detect performers that have since
become invalid:

  * Deleted   - the stash-box no longer has a record for that id at all
  * Merged    - the stash-box performer is marked deleted=True and has since
                been absorbed into another (surviving) performer. When we can
                resolve the surviving performer's id/name (via the merge
                edit history) we report it so the local stash_id can be
                repointed.
  * Struck out / inactive - the stash-box performer still exists but is
                flagged deleted=True without a resolvable merge target (this
                is how "struck through" performers typically show up in the
                stash-box UI).

Flagged performers are optionally tagged with [StashDB: Needs Review] so they
can be browsed/filtered in the Stash UI, and a summary is always written to
the plugin log.
"""

import json
import sys

import stashapi.log as log
from stashapi.stashapp import StashInterface
from stashapi.stashbox import StashBoxInterface

NEEDS_REVIEW_TAG = "[StashDB: Needs Review]"

# Fields we need from the stash-box Performer type. `edits` lets us try to
# resolve what a deleted/merged performer was folded into, by looking for an
# applied MERGE edit that targeted a different (surviving) performer.
PERFORMER_FRAGMENT_FULL = """
id
name
deleted
merged_ids
edits {
  operation
  applied
  target {
    ... on Performer {
      id
      name
    }
  }
}
"""

# Fallback used if the stash-box instance doesn't support the `edits` field
# on Performer (older/alternate stash-box implementations, e.g. TPDB).
PERFORMER_FRAGMENT_BASIC = """
id
name
deleted
merged_ids
"""

stash_boxes = {}


def get_stashbox(endpoint):
    """Return a cached StashBoxInterface for the given endpoint, building one
    from the configured stash-box connections if needed."""
    if endpoint in stash_boxes:
        return stash_boxes[endpoint]
    for sbx_config in stash.get_configuration()["general"]["stashBoxes"]:
        if sbx_config["endpoint"] == endpoint:
            stashbox = StashBoxInterface(
                {"endpoint": sbx_config["endpoint"], "api_key": sbx_config["api_key"]}
            )
            stash_boxes[endpoint] = stashbox
            return stashbox
    return None


def resolve_merge_target(stashbox_performer):
    """Given a deleted stash-box performer record (fetched with
    PERFORMER_FRAGMENT_FULL), try to find the surviving performer it was
    merged into by scanning its edit history for an applied MERGE edit whose
    target is a different performer."""
    for edit in stashbox_performer.get("edits") or []:
        if edit.get("operation") != "MERGE" or not edit.get("applied"):
            continue
        target = edit.get("target")
        if target and target.get("id") and target["id"] != stashbox_performer["id"]:
            return target
    return None


def check_stashid(endpoint, stash_id):
    """Look up a single stash-box performer id and classify its status.

    Returns a dict: {"status": ..., "name": ..., "merged_into": {...} or None}
    status is one of: "ok", "not_found", "merged", "deleted"
    """
    stashbox = get_stashbox(endpoint)
    if not stashbox:
        log.warning(f"No configured stash-box connection for endpoint {endpoint}, skipping")
        return {"status": "unconfigured", "name": None, "merged_into": None}

    performer = None
    used_full_fragment = True
    try:
        performer = stashbox.find_performer(stash_id, fragment=PERFORMER_FRAGMENT_FULL)
    except Exception as e:
        log.debug(
            f"Full fragment lookup failed for {stash_id} on {endpoint} ({e}), "
            "retrying with basic fragment"
        )
        used_full_fragment = False
        try:
            performer = stashbox.find_performer(stash_id, fragment=PERFORMER_FRAGMENT_BASIC)
        except Exception as e2:
            log.error(f"Failed to look up performer {stash_id} on {endpoint}: {e2}")
            return {"status": "error", "name": None, "merged_into": None}

    if performer is None:
        return {"status": "not_found", "name": None, "merged_into": None}

    if not performer.get("deleted"):
        return {"status": "ok", "name": performer.get("name"), "merged_into": None}

    merge_target = None
    if used_full_fragment:
        merge_target = resolve_merge_target(performer)

    if merge_target:
        return {"status": "merged", "name": performer.get("name"), "merged_into": merge_target}

    return {"status": "deleted", "name": performer.get("name"), "merged_into": None}


def checkPerformers():
    """Check every local performer's stash_ids against their configured
    stash-boxes and report/tag any that are deleted or merged."""
    performers = stash.find_performers(fragment="id name stash_ids { endpoint stash_id } tags { id }")
    log.info(f"Checking {len(performers)} performers with stash_ids against configured stash-boxes")

    flagged = []
    cleared = []
    checked = 0

    for performer in performers:
        stash_ids = performer.get("stash_ids") or []
        if not stash_ids:
            continue

        performer_issues = []
        for sid in stash_ids:
            endpoint = sid["endpoint"]
            stash_id = sid["stash_id"]
            checked += 1
            result = check_stashid(endpoint, stash_id)

            if result["status"] == "not_found":
                log.warning(
                    f"[Not Found] {performer['name']} ({performer['id']}): "
                    f"{stash_id} on {endpoint} no longer resolves (deleted or invalid id)"
                )
                performer_issues.append(f"Not Found on {endpoint} ({stash_id})")
            elif result["status"] == "merged":
                target = result["merged_into"]
                log.warning(
                    f"[Merged] {performer['name']} ({performer['id']}): "
                    f"{stash_id} on {endpoint} was merged into "
                    f"{target.get('name')} ({target.get('id')})"
                )
                performer_issues.append(
                    f"Merged into {target.get('name')} ({target.get('id')}) on {endpoint}"
                )
            elif result["status"] == "deleted":
                log.warning(
                    f"[Deleted/Inactive] {performer['name']} ({performer['id']}): "
                    f"{stash_id} on {endpoint} is marked deleted"
                )
                performer_issues.append(f"Deleted on {endpoint} ({stash_id})")
            elif result["status"] == "error":
                log.debug(
                    f"Could not verify {performer['name']} ({performer['id']}) "
                    f"stash_id {stash_id} on {endpoint} due to a lookup error"
                )
            # "ok" / "unconfigured": nothing to report

        if performer_issues:
            flagged.append((performer, performer_issues))
            if settings.get("tagFlagged"):
                add_review_tag(performer)
        else:
            cleared.append(performer)
            if settings.get("removeTagWhenResolved"):
                remove_review_tag(performer)

    log.info(
        f"Checked {checked} stash_id(s) across {len(performers)} performers with stash_ids: "
        f"{len(flagged)} flagged, {len(performers) - len(flagged)} clean"
    )
    if flagged:
        log.info("Summary of flagged performers:")
        for performer, issues in flagged:
            log.info(f" - {performer['name']} ({performer['id']}): {'; '.join(issues)}")


def add_review_tag(performer):
    current_tag_ids = [t["id"] for t in performer.get("tags", [])]
    if review_tag_id in current_tag_ids:
        return
    stash.update_performer({"id": performer["id"], "tag_ids": current_tag_ids + [review_tag_id]})


def remove_review_tag(performer):
    current_tag_ids = [t["id"] for t in performer.get("tags", [])]
    if review_tag_id not in current_tag_ids:
        return
    new_tag_ids = [tid for tid in current_tag_ids if tid != review_tag_id]
    stash.update_performer({"id": performer["id"], "tag_ids": new_tag_ids})


json_input = json.loads(sys.stdin.read())

FRAGMENT_SERVER = json_input["server_connection"]
stash = StashInterface(FRAGMENT_SERVER)

config = stash.get_configuration()["plugins"]
settings = {
    "tagFlagged": True,
    "removeTagWhenResolved": False,
}
if "stashPerformerValidator" in config:
    settings.update(config["stashPerformerValidator"])

review_tag_id = stash.find_tag(NEEDS_REVIEW_TAG, create=True).get("id")

if "mode" in json_input["args"]:
    PLUGIN_ARGS = json_input["args"]["mode"]
    if "checkPerformers" in PLUGIN_ARGS:
        checkPerformers()
