# Stash Performer Validator

Checks every local performer's stash-box IDs (StashDB, TPDB, etc.) against
the live stash-box GraphQL API to find performers whose data has since
changed upstream:

- **Not Found** — the stash-box no longer has any record for that id (the id
  is invalid or was hard-deleted).
- **Merged** — the stash-box performer is marked `deleted` and was merged
  into another (surviving) performer. When the surviving performer can be
  resolved from the merge edit history, its name/id is reported so you can
  repoint the local performer's stash_id.
- **Deleted/Inactive** — the stash-box performer is marked `deleted` but no
  merge target could be resolved (this is how a "struck out" performer
  typically appears on the stash-box site).

## Usage

Run the **Check Performers** task from Settings > Tasks > Plugin Tasks. Any
performer with an affected stash_id is logged, and — if the *Tag flagged
performers* setting is enabled (default on) — tagged with
`[StashDB: Needs Review]` so it can be found/filtered in the Stash UI.

## Settings

- **Tag flagged performers**: adds `[StashDB: Needs Review]` to any performer
  with a deleted/merged stash_id.
- **Remove tag once resolved**: removes the tag automatically once a
  performer's stash_ids all resolve cleanly again (e.g. after you fix the
  stash_id manually).

## Notes

- This plugin only reads from the configured stash-boxes (Settings > Metadata
  Providers > Stash-boxes); it does not modify anything on the remote
  stash-box.
- Resolving a merge target relies on the stash-box exposing edit history on
  the `Performer` type (`edits { operation applied target { ... on Performer
  { id name } } }`). If a stash-box instance doesn't support this, the
  performer is still flagged as deleted, just without a resolved merge
  target.
