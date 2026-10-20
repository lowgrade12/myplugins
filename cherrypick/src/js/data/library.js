// Reads the user's library from Stash: every owned scene with its ratings and
// play history, every performer, and the tag and studio names they point to.
// Large libraries load in pages, in the background, and a copy is kept in
// IndexedDB (tier 3: rebuildable) so the next visit starts from it and
// fetches only what changed.
//
// Built for libraries of 100,000+ scenes, where every byte per scene counts
// (a full read at 2 KB a scene is 300 MB):
//   - scenes carry only the ids of their tags, performers and studio; the
//     names come once, from the tag, studio and performer lists (buildDb
//     joins them)
//   - custom fields keep only the keys Cherry Pick reads (keepFields)
//   - a tool that rewrites most of the library at once (Restash's mirror
//     moves every scene's updated_at each run) is not followed edit by edit:
//     past BULK_LIMIT edits since the last check, the edits wait for the
//     next full read. Plays and Os, which teach the model, are always
//     fetched.
//   - the rows are written to IndexedDB only when they changed; the cursors
//     and times live in a small record of their own (`library-meta`)
//
// `run(query, variables)` sends one GraphQL request and returns its data. The
// runtime passes Stash's own client (no Apollo cache: thousands of scenes
// would bloat Stash's cache); tests pass a fake.
import {
  LOOKUPS,
  PERFORMER_TIMES,
  PERFORMERS,
  SCENE_TIMES,
  SCENES,
} from './queries.js'
import { ELO_FIELDS, MIRROR_FIELD } from '../model/rankings.js'
import { FIELD_PREFIX } from '../name.js'

const PAGE = 500
// Changed records are looked for this many at a time first, then a page at
// a time.
const STEP = 50
// A copy whose last full read is this old is read again in full, which
// also drops deleted scenes and catches what no update sees (a play or an
// O removed, play time saved without a play, edits skipped as a bulk
// rewrite).
const FULL_RELOAD_MS = 7 * 24 * 3600 * 1000
// Changes are fetched again after this long, and on every front-page visit.
export const REFRESH_MS = 2 * 60 * 1000
// Changes in the same second as the newest one seen, or saved while a page
// loads: fetch a little overlap.
const OVERLAP_MS = 60 * 1000
// More edits than this since the last check is a bulk rewrite by a tool,
// left to the next full read.
export const BULK_LIMIT = 2000
// 2: scenes carry custom_fields. 3: updates find changed scenes by sorting
// (`cursors`), and the age of the last full read (`fullAt`) decides when to
// read in full. 4: files carry video_codec, width and height, for scene
// brackets. 5: slim rows (ids for tags, performers and studio, with
// `tags` and `studios` lists), custom fields cut to the plugin's keys, the
// times in `library-meta`.
const CACHE_VERSION = 5

// The custom fields Cherry Pick reads: other plugins' ranking marks,
// Restash's score and its own. Others (award lists, Restash's components)
// can be most of a record's size.
const KEEP_FIELDS = new Set([...ELO_FIELDS, MIRROR_FIELD])
export function keepFields(row) {
  const cf = row.custom_fields
  if (!cf) return row
  let kept = null
  for (const k in cf)
    if (KEEP_FIELDS.has(k) || k.startsWith(FIELD_PREFIX)) (kept ||= {})[k] = cf[k]
  return { ...row, custom_fields: kept || {} }
}
const keepAll = (rows) => rows.map(keepFields)

// Every page of one find query, sorted by id so pages never shift.
async function fetchPages(run, query, field, list, variables, onPage) {
  const out = []
  for (let page = 1; ; page++) {
    const data = await run(query, {
      ...variables,
      filter: { per_page: PAGE, page, sort: 'id', direction: 'ASC' },
    })
    const result = data[field]
    out.push(...keepAll(result[list]))
    onPage?.(out.length, result.count)
    if (out.length >= result.count || !result[list].length) return out
  }
}

const latest = (times) =>
  times?.reduce(
    (a, t) => (a == null || Date.parse(t) > Date.parse(a) ? t : a),
    null,
  ) ?? null

// The changes a scene can have, each with the sort Stash offers for it and
// the time it keeps. An edit (rating, custom fields, title, tags) moves
// updated_at; a play moves last_played_at and an O adds to o_history, and
// neither touches updated_at. bulk: whether a bulk rewrite can be left for
// the next full read (edits can; plays and Os teach the model and cannot).
const CHANGES = [
  { sort: 'last_played_at', at: (s) => s.last_played_at, bulk: false },
  { sort: 'last_o_at', at: (s) => latest(s.o_history), bulk: false },
  { sort: 'updated_at', at: (s) => s.updated_at, bulk: true },
]
const PERFORMER_CHANGE = { sort: 'updated_at', at: (p) => p.updated_at }

// The newest time of each change, before a full read starts: anything
// newer is left to the next update.
async function cursorsNow(run) {
  const out = {}
  for (const { sort, at } of CHANGES) {
    const { findScenes } = await run(SCENE_TIMES, {
      filter: { per_page: 1, page: 1, sort, direction: 'DESC' },
    })
    out[sort] = findScenes.scenes[0] ? at(findScenes.scenes[0]) : null
  }
  const { findPerformers } = await run(PERFORMER_TIMES, {
    filter: { per_page: 1, page: 1, sort: 'updated_at', direction: 'DESC' },
  })
  out.performers = findPerformers.performers[0]
    ? PERFORMER_CHANGE.at(findPerformers.performers[0])
    : null
  return out
}

// Whether the copy of a scene holds the times Stash now has for it
const sameTime = (a, b) =>
  a === b || (a != null && b != null && Date.parse(a) === Date.parse(b))
const current = (copy, row) =>
  !!copy &&
  sameTime(copy.updated_at, row.updated_at) &&
  sameTime(copy.last_played_at, row.last_played_at) &&
  copy.o_counter === row.o_counter
const currentPerformer = (copy, row) =>
  !!copy && sameTime(copy.updated_at, row.updated_at)

// One change, newest first, down to a minute before the newest the copy
// saw: the ids whose times differ from the copy's, the newest time seen,
// and whether it stopped at `limit` (a bulk rewrite). Records no newer than
// `skipped` (the newest time of a bulk rewrite left for the next full read)
// count as current: the copy still holds their older time.
async function scan(
  run,
  { query, field, list, sort, at, was, isCurrent, limit, skipped },
) {
  const since = was == null ? null : Date.parse(was) - OVERLAP_MS
  const skip = skipped == null ? -Infinity : Date.parse(skipped)
  const ids = new Set()
  let newest = was
  let per = STEP
  let page = 1
  for (;;) {
    const data = await run(query, {
      filter: { per_page: per, page, sort, direction: 'DESC' },
    })
    const rows = data[field][list]
    let done = rows.length < per
    for (const r of rows) {
      const t = at(r)
      // Newest first, so the rest is older still: past the last check, or
      // inside the bulk rewrite already skipped
      if (
        t == null ||
        (since != null && Date.parse(t) < since) ||
        Date.parse(t) <= skip
      ) {
        done = true
        break
      }
      if (!isCurrent(r)) ids.add(r.id)
      if (newest == null || Date.parse(t) > Date.parse(newest)) newest = t
      if (limit != null && ids.size > limit)
        return { ids: [], newest, bulk: true }
    }
    if (done) break
    // More than one step to look through: go on a page at a time (the
    // first page reads the step again, which the set absorbs)
    if (per === STEP) {
      per = PAGE
      page = 1
    } else page++
  }
  return { ids: [...ids], newest, bulk: false }
}

async function changedIds(run, cached) {
  const copy = new Map(cached.scenes.map((s) => [s.id, s]))
  const ids = new Set()
  // skipped: how far each bulk rewrite reached, kept until the next full read
  const cursors = { skipped: { ...cached.cursors.skipped } }
  let bulk = false
  for (const { sort, at, bulk: canWait } of CHANGES) {
    const found = await scan(run, {
      query: SCENE_TIMES,
      field: 'findScenes',
      list: 'scenes',
      sort,
      at,
      was: cached.cursors[sort] ?? null,
      isCurrent: (r) => current(copy.get(r.id), r),
      limit: canWait ? BULK_LIMIT : null,
      skipped: cursors.skipped[sort],
    })
    found.ids.forEach((id) => ids.add(id))
    cursors[sort] = found.newest
    if (found.bulk) cursors.skipped[sort] = found.newest
    bulk ||= found.bulk
  }
  return { ids: [...ids], cursors, bulk }
}

// The ids of the performers changed since the copy was read
async function changedPerformerIds(run, cached) {
  const copy = new Map(cached.performers.map((p) => [p.id, p]))
  return scan(run, {
    query: PERFORMER_TIMES,
    field: 'findPerformers',
    list: 'performers',
    ...PERFORMER_CHANGE,
    was: cached.cursors.performers ?? null,
    isCurrent: (r) => currentPerformer(copy.get(r.id), r),
    limit: BULK_LIMIT,
    skipped: cached.cursors.skipped?.performers,
  })
}

// The changed records in full, a page of ids at a time
async function fetchByIds(run, query, field, list, ids) {
  const out = []
  for (let i = 0; i < ids.length; i += PAGE) {
    const data = await run(query, {
      ids: ids.slice(i, i + PAGE),
      filter: { per_page: -1 },
    })
    out.push(...keepAll(data[field][list]))
  }
  return out
}

// Merges changed records into the cached list by id.
function merge(scenes, changed) {
  const byId = new Map(scenes.map((s) => [s.id, s]))
  for (const s of changed) byId.set(s.id, s)
  return [...byId.values()]
}

// The copy in IndexedDB: the rows, and the times that go with them.
async function readCopy(cache) {
  if (!cache) return null
  const [rows, meta] = await Promise.all([
    cache.get('library').catch(() => null),
    cache.get('library-meta').catch(() => null),
  ])
  if (rows?.version !== CACHE_VERSION || meta?.version !== CACHE_VERSION)
    return null
  if (meta.rowsId !== rows.rowsId) return null
  return { ...rows, ...meta }
}

/**
 * @param {{ run: Function, cache?: { get: Function, set: Function },
 *   now?: number, force?: boolean, onProgress?: Function,
 *   current?: object|null }} opts
 * @returns {Promise<{ scenes: object[], performers: object[], tags: object[],
 *   studios: object[], syncedAt: string, fullAt: string, cursors: object,
 *   fromCache: boolean, unchanged?: boolean, bulk?: boolean }>}
 */
export async function loadLibrary({
  run,
  cache,
  now = Date.now(),
  force = false,
  onProgress,
  current = null,
}) {
  // The library already in memory, else the IndexedDB copy. Starting from
  // the one in memory lets an update that finds nothing hand back its very
  // lists (unchanged), which the runtime keeps.
  const cached =
    current?.version === CACHE_VERSION ? current : await readCopy(cache)
  const usable = cached?.version === CACHE_VERSION && !force
  if (usable && now - Date.parse(cached.syncedAt) < REFRESH_MS)
    return { ...cached, fromCache: true }

  const syncedAt = new Date(now).toISOString()
  let scenes = null
  let performers = null
  let cursors
  let bulk = false
  let fullAt = usable ? cached.fullAt : null
  if (usable && now - Date.parse(fullAt) < FULL_RELOAD_MS) {
    const found = await changedIds(run, cached)
    cursors = found.cursors
    bulk = found.bulk
    // Nothing changed: keep the copy's own list, so the runtime sees the
    // same scenes and needs no new model.
    scenes = found.ids.length
      ? merge(
          cached.scenes,
          await fetchByIds(run, SCENES, 'findScenes', 'scenes', found.ids),
        )
      : cached.scenes
    // A count that differs means scenes were deleted (or the copy is off):
    // reload in full.
    const { findScenes } = await run(SCENES, { filter: { per_page: 0 } })
    if (findScenes.count !== scenes.length) scenes = null
  }
  // onProgress reports a full read only: a first visit, or a copy too old or
  // out of step to update.
  const full = !scenes
  if (full) {
    cursors = await cursorsNow(run)
    fullAt = syncedAt
    bulk = false
    scenes = await fetchPages(
      run,
      SCENES,
      'findScenes',
      'scenes',
      {},
      (n, of) => onProgress?.({ kind: 'scenes', n, of }),
    )
  } else {
    // The performers that changed, as for the scenes; a count that differs
    // reads them all again.
    const found = await changedPerformerIds(run, cached)
    cursors.performers = found.newest
    if (found.bulk) cursors.skipped.performers = found.newest
    bulk ||= found.bulk
    performers = found.ids.length
      ? merge(
          cached.performers,
          await fetchByIds(
            run,
            PERFORMERS,
            'findPerformers',
            'performers',
            found.ids,
          ),
        )
      : cached.performers
    const { findPerformers } = await run(PERFORMERS, {
      filter: { per_page: 0 },
    })
    if (findPerformers.count !== performers.length) performers = null
  }
  if (!performers)
    performers = await fetchPages(
      run,
      PERFORMERS,
      'findPerformers',
      'performers',
      {},
      full ? (n, of) => onProgress?.({ kind: 'performers', n, of }) : undefined,
    )
  // Tag and studio names: a few thousand short rows, read whole each time,
  // kept as the copy's own lists when nothing in them changed.
  const { findTags, findStudios } = await run(LOOKUPS, {})
  const tags =
    usable && sameRows(cached.tags, findTags.tags) ? cached.tags : findTags.tags
  const studios =
    usable && sameRows(cached.studios, findStudios.studios)
      ? cached.studios
      : findStudios.studios

  const unchanged =
    !full &&
    scenes === cached.scenes &&
    performers === cached.performers &&
    tags === cached.tags &&
    studios === cached.studios
  const rowsId = unchanged ? cached.rowsId : syncedAt
  const meta = { version: CACHE_VERSION, rowsId, syncedAt, fullAt, cursors }
  const rows = { version: CACHE_VERSION, rowsId, scenes, performers, tags, studios }
  // The rows are written only when they changed: writing a hundred thousand
  // scenes again blocks the page. The times always are (a few bytes).
  if (cache) {
    if (!unchanged) await cache.set('library', rows).catch(() => {})
    await cache.set('library-meta', meta).catch(() => {})
  }
  return { ...rows, ...meta, fromCache: false, unchanged, bulk }
}

// Whether two lists of rows from Stash hold the same records
function sameRows(a, b) {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++)
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false
  return true
}
