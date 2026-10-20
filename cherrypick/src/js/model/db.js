// The model's database: one object built from what the plugin's data layer
// reads from Stash (the scenes you own, the performers in your library) and,
// with a StashDB key, what the StashDB layer fetches (scenes you don't have,
// popularity orders). buildDb is the boundary between the two: the data
// layer hands it rows as Stash's GraphQL returns them, and the model reads
// only what it returns. Owned scenes, library performers, studios and tags
// keep Stash's own ids; anything known only from StashDB gets a "stashdb:"
// id, so the two can never collide.
//
// Rows are read once: the model treats the database as immutable and caches
// per-scene values on it, so a change in Stash means a new buildDb.
import { markRatingSources } from './rankings.js'

/**
 * What buildDb takes.
 * @typedef {object} DbInput
 * @property {number} asOf  "now" for the model, in ms (plays in the last 14
 *   days, "new in your library", "not watched since"): when the library was read
 * @property {StashSceneRow[]} scenes  every scene in the library
 * @property {StashPerformerRow[]} performers  every performer in the library
 * @property {StashdbInput} [stashdb]  present only with a StashDB key
 */

/**
 * An owned scene, as Stash's findScenes returns it.
 * @typedef {object} StashSceneRow
 * @property {string} id
 * @property {string|null} [title]
 * @property {string|null} [date]  release date, YYYY-MM-DD
 * @property {string} created_at  ISO time it was added to the library
 * @property {number|null} [rating100]
 * @property {{ duration: number|null, video_codec?: string,
 *   width?: number, height?: number }[]} [files]  the first file's duration
 *   (seconds) and size are the scene's; an empty video_codec means it has
 *   no picture
 * @property {number} [play_count]
 * @property {number} [play_duration]  seconds played, over every play
 * @property {string[]} [play_history]  ISO times, one per play
 * @property {number} [o_counter]
 * @property {StashStudioRef|null} [studio]
 * @property {StashCredit[]} [performers]
 * @property {{ id: string, name: string }[]} [tags]
 * @property {StashId[]} [stash_ids]
 * @property {{ screenshot: string|null }} [paths]
 * @property {Record<string, unknown>} [custom_fields]
 */

/**
 * @typedef {object} StashStudioRef
 * @property {string} id
 * @property {string} name
 * @property {{ id: string, name: string }|null} [parent_studio]
 */

/**
 * A performer credit on an owned scene.
 * @typedef {object} StashCredit
 * @property {string} id
 * @property {string} name
 * @property {string|null} [gender]  one of Stash's six values, or null
 * @property {boolean} [favorite]
 * @property {string|null} [image_path]
 */

/**
 * A performer in the library, as Stash's findPerformers returns it.
 * @typedef {object} StashPerformerRow
 * @property {string} id
 * @property {string} name
 * @property {string|null} [disambiguation]
 * @property {string|null} [gender]
 * @property {number|null} [rating100]
 * @property {boolean} [favorite]
 * @property {string|null} [image_path]  Stash's default silhouette (a URL
 *   ending in ?default=true) counts as no photo
 * @property {number} [scene_count]
 * @property {StashId[]} [stash_ids]
 * @property {Record<string, unknown>} [custom_fields]
 */

/** @typedef {{ endpoint: string, stash_id: string }} StashId */

/**
 * What the StashDB layer fetched. Every id in it is a StashDB id; buildDb
 * maps them onto the library's: scenes and performers through the stash_ids
 * on owned scenes and library performers, studios and tags by name
 * (ignoring case). Anything unmatched keeps its StashDB id behind the
 * "stashdb:" prefix. Every list is optional.
 * @typedef {object} StashdbInput
 * @property {string} [endpoint]  the stash-box endpoint that stash_ids name
 *   for StashDB (default STASHDB_ENDPOINT)
 * @property {number} [totalScenes]  StashDB's scene count, when known
 * @property {StashdbScene[]} [scenes]  scenes fetched in detail. One whose id
 *   is in an owned scene's stash_ids is that owned scene: only its
 *   popularity is kept.
 * @property {StashdbPerformer[]} [performers]  performers with a popularity order
 * @property {StashdbStudio[]} [studios]  studios with a popularity order
 */

/**
 * @typedef {object} StashdbScene
 * @property {string} id
 * @property {string|null} [title]
 * @property {string|null} [date]
 * @property {number|null} [duration]
 * @property {string|null} [image]
 * @property {{ id: string, name: string, parent?: { id: string, name: string }|null }|null} [studio]
 * @property {{ id: string, name: string, gender?: string|null, disambiguation?: string|null }[]} [performers]
 * @property {{ id: string, name: string }[]} [tags]
 * @property {number|null} [heldBy]  approximate number of StashDB users who
 *   hold it (distinct fingerprint submitters); shown, never ranked by
 * @property {number|null} [globalPopularityRank]  its place in StashDB's
 *   global popularity order, where known
 */

/**
 * @typedef {object} StashdbPerformer
 * @property {string} id
 * @property {string} [name]
 * @property {string|null} [gender]
 * @property {string|null} [disambiguation]
 * @property {string|null} [image]
 * @property {number} [sceneCount]  their scenes on StashDB
 * @property {string[]} [popularSceneIds]  StashDB scene ids, most popular first
 */

/**
 * @typedef {object} StashdbStudio
 * @property {string} id
 * @property {string} [name]
 * @property {{ id: string, name: string }|null} [parent]
 * @property {string[]} [popularSceneIds]
 */

/**
 * What the model reads: the result of buildDb.
 * @typedef {object} Db
 * @property {number} asOf
 * @property {boolean} hasStashdb  a StashDB part was given
 * @property {number|null} totalStashdbScenes
 * @property {Map<string, Scene>} scenes  owned scenes first, then StashDB's
 * @property {Scene[]} owned  oldest addition first (a stable order, so the
 *   model's holdout folds don't depend on the order rows were read in)
 * @property {Map<string, Performer>} performers
 * @property {Performer[]} localPerformers  the library's, most scenes first
 * @property {Map<string, Studio>} studios
 * @property {Studio[]} localStudios  studios with owned scenes, by name
 * @property {Map<string, { id: string, name: string }>} tags
 * @property {Map<string, number>} localTagCounts  tag id -> owned scenes
 * @property {Map<string, { performerId: string, rank: number }[]>} performerRank
 *   scene id -> its place in each performer's StashDB popularity order
 * @property {Map<string, { studioId: string, rank: number }>} studioRank
 * @property {Set<string>} favoritePerformerIds
 */

/**
 * @typedef {object} Scene
 * @property {string} id  Stash's id, or "stashdb:<id>"
 * @property {string} title
 * @property {string|null} date
 * @property {number|null} duration  seconds
 * @property {number|null} [width]  the owned file's width in pixels
 * @property {number|null} [height]
 * @property {boolean} [audioOnly]  an owned file with no video stream
 * @property {boolean} [hasVideo]  an owned scene whose first file has a
 *   picture: not audio-only, and not a scene with no file at all
 * @property {string|null} image
 * @property {{ id: string, name: string, parent: { id: string, name: string }|null }|null} studio
 * @property {{ id: string, name: string, gender: string|null }[]} performers
 * @property {{ id: string, name: string }[]} tags
 * @property {boolean} owned
 * @property {SceneLocal|null} local  Stash's fields, for an owned scene
 * @property {string|null} localId  Stash's id for an owned scene
 * @property {string|null} stashId  the StashDB id, when known
 * @property {number|null} heldBy
 * @property {number|null} globalPopularityRank
 */

/**
 * @typedef {object} SceneLocal
 * @property {number|null} rating100
 * @property {string} created_at
 * @property {number} play_count
 * @property {number} play_duration
 * @property {string[]} play_history
 * @property {number} o_counter
 * @property {StashId[]} stash_ids
 * @property {Record<string, unknown>} custom_fields
 * @property {'elo'|'mirror'|'primed'|null} ratingSource  who set rating100 when
 *   another plugin did (rankings.js): the model leaves it out
 */

/**
 * @typedef {object} Performer
 * @property {string} id  Stash's id, or "stashdb:<id>"
 * @property {string} name
 * @property {string|null} disambiguation
 * @property {string|null} stashId
 * @property {string|null} stashdbGender
 * @property {string|null} image  a real photo, or null
 * @property {string[]|null} popularSceneIds  StashDB's popularity order, as
 *   ids in db.scenes (owned scenes by their Stash id)
 * @property {number|null} sceneCount  their scenes on StashDB
 * @property {PerformerLocal|null} local  Stash's fields, for a library performer
 * @property {string[]} sceneIds
 * @property {string[]} ownedSceneIds
 * @property {string|null} localId  Stash's id for a library performer
 */

/**
 * @typedef {object} PerformerLocal
 * @property {string|null} gender
 * @property {boolean} favorite
 * @property {number|null} rating100
 * @property {number} scene_count
 * @property {string|null} image_path
 * @property {StashId[]} stash_ids
 * @property {Record<string, unknown>} custom_fields
 * @property {'elo'|'mirror'|'primed'|null} ratingSource  as on SceneLocal
 */

/**
 * @typedef {object} Studio
 * @property {string} id
 * @property {string} name
 * @property {string|null} parentId
 * @property {string[]|null} popularSceneIds
 * @property {string[]} sceneIds  its own scenes and its children's
 * @property {string[]} ownedSceneIds
 * @property {Set<string>} childIds
 * @property {string|null} localId
 */

export const STASHDB_ENDPOINT = 'https://stashdb.org/graphql'
export const STASHDB_PREFIX = 'stashdb:'

const norm = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
const sameEndpoint = (a, b) =>
  norm(a).replace(/\/+$/, '') === norm(b).replace(/\/+$/, '')
const stashIdOn = (ids, endpoint) =>
  (ids || []).find((x) => sameEndpoint(x.endpoint, endpoint))?.stash_id || null

// Stash serves a generated silhouette for a performer without a photo, at an
// image_path ending in ?default=true. Brackets need a real photo, so that
// counts as none.
export const realImage = (path) =>
  path && !/[?&]default=true(&|$)/.test(path) ? path : null

const newPerformer = (id, name) => ({
  id,
  name: name || '',
  disambiguation: null,
  stashId: null,
  stashdbGender: null,
  image: null,
  popularSceneIds: null,
  sceneCount: null,
  local: null,
  sceneIds: [],
  ownedSceneIds: [],
  localId: null,
})

/**
 * @param {DbInput} input
 * @returns {Db}
 */
export function buildDb(input) {
  const asOf = input.asOf ?? Date.now()
  const sdb = input.stashdb || null
  const endpoint = sdb?.endpoint || STASHDB_ENDPOINT

  const scenes = new Map()
  const performers = new Map()
  const studios = new Map()
  const tags = new Map()

  // Performers. `local` holds Stash's fields for performers in your library;
  // performers known only from StashDB have none.
  const ensurePerformer = (id, name) => {
    if (!performers.has(id)) performers.set(id, newPerformer(id, name))
    return performers.get(id)
  }
  const makeLocal = (rec, row) => {
    rec.name = row.name || rec.name
    rec.disambiguation = row.disambiguation || null
    rec.stashId = stashIdOn(row.stash_ids, endpoint)
    rec.image = realImage(row.image_path)
    rec.localId = rec.id
    rec.local = {
      gender: row.gender ?? null,
      favorite: !!row.favorite,
      rating100: row.rating100 ?? null,
      scene_count: row.scene_count ?? null,
      image_path: row.image_path ?? null,
      stash_ids: row.stash_ids || [],
      custom_fields: row.custom_fields || {},
    }
  }
  for (const row of input.performers || [])
    makeLocal(ensurePerformer(row.id, row.name), row)

  // The names a slim scene row leaves out (data/library.js): its tags',
  // its studio's and its performers' come from the library's lists. A row
  // that carries them (tests, older copies) keeps its own.
  const tagName = new Map((input.tags || []).map((t) => [t.id, t.name]))
  const studioRow = new Map((input.studios || []).map((s) => [s.id, s]))
  const studioOf = (st) => {
    if (!st || st.name != null) return st
    const row = studioRow.get(st.id)
    if (!row) return { id: st.id, name: '', parent_studio: null }
    const parent = row.parent_studio && studioRow.get(row.parent_studio.id)
    return {
      id: row.id,
      name: row.name,
      parent_studio: parent ? { id: parent.id, name: parent.name } : null,
    }
  }
  const creditOf = (p) => {
    if (p.name != null) return p
    const rec = performers.get(p.id)
    return {
      id: p.id,
      name: rec?.name || '',
      disambiguation: rec?.disambiguation || null,
      gender: rec?.local?.gender ?? null,
      favorite: rec?.local?.favorite ?? false,
      image_path: rec?.local?.image_path ?? null,
    }
  }
  const tagOf = (t) =>
    t.name != null ? t : { id: t.id, name: tagName.get(t.id) || '' }

  // Owned scenes, with Stash's fields in `local`
  const owned = []
  for (const row of input.scenes || []) {
    const st = studioOf(row.studio)
    const credits = (row.performers || []).map(creditOf)
    const rowTags = (row.tags || []).map(tagOf)
    owned.push({
      id: row.id,
      title: row.title || '',
      date: row.date || null,
      duration: row.files?.[0]?.duration ?? null,
      width: row.files?.[0]?.width || null,
      height: row.files?.[0]?.height || null,
      audioOnly: row.files?.[0]?.video_codec === '',
      hasVideo:
        !!row.files?.[0] &&
        row.files[0].video_codec !== '' &&
        row.files[0].width !== 0,
      image: row.paths?.screenshot || null,
      studio: st
        ? {
            id: st.id,
            name: st.name,
            parent: st.parent_studio
              ? { id: st.parent_studio.id, name: st.parent_studio.name }
              : null,
          }
        : null,
      performers: credits.map((p) => ({
        id: p.id,
        name: p.name,
        gender: p.gender ?? null,
      })),
      tags: rowTags.map((t) => ({ id: t.id, name: t.name })),
      owned: true,
      local: {
        rating100: row.rating100 ?? null,
        created_at: row.created_at,
        play_count: row.play_count || 0,
        play_duration: row.play_duration || 0,
        play_history: row.play_history || [],
        o_counter: row.o_counter || 0,
        stash_ids: row.stash_ids || [],
        custom_fields: row.custom_fields || {},
      },
      localId: row.id,
      stashId: stashIdOn(row.stash_ids, endpoint),
      heldBy: null,
      globalPopularityRank: null,
    })
    // Every performer on an owned scene is in the library. One the data
    // layer didn't list gets Stash's fields from the credit.
    for (const p of credits) {
      const rec = ensurePerformer(p.id, p.name)
      if (!rec.local) makeLocal(rec, { ...p, rating100: null, stash_ids: [] })
    }
    for (const t of rowTags)
      if (!tags.has(t.id)) tags.set(t.id, { id: t.id, name: t.name })
  }
  owned.sort(
    (a, b) =>
      String(a.local.created_at).localeCompare(String(b.local.created_at)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const s of owned) scenes.set(s.id, s)

  const map = sdb ? stashdbMapping({ owned, performers, tags, endpoint }) : null
  if (sdb) addStashdbScenes(sdb, map, { scenes, performers })

  // Studios (children and their parent networks), and who is in what
  const ensureStudio = (id, name, parentId) => {
    let st = studios.get(id)
    if (!st) {
      st = {
        id,
        name,
        parentId: parentId || null,
        popularSceneIds: null,
        sceneIds: [],
        ownedSceneIds: [],
        childIds: new Set(),
        localId: null,
      }
      studios.set(id, st)
    }
    return st
  }
  for (const s of scenes.values()) {
    for (const p of s.performers) {
      const rec = ensurePerformer(p.id, p.name)
      rec.sceneIds.push(s.id)
      if (s.owned) rec.ownedSceneIds.push(s.id)
    }
    if (!s.studio) continue
    const parent = s.studio.parent
    const ps = parent ? ensureStudio(parent.id, parent.name, null) : null
    const st = ensureStudio(s.studio.id, s.studio.name, parent?.id)
    if (ps) ps.childIds.add(st.id)
    for (const x of ps ? [st, ps] : [st]) {
      x.sceneIds.push(s.id)
      if (s.owned) {
        x.ownedSceneIds.push(s.id)
        x.localId = x.id
      }
    }
  }

  // StashDB popularity orders, on the performers and studios they belong to
  if (sdb) {
    for (const row of sdb.performers || []) {
      const rec = ensurePerformer(map.performerId(row.id), row.name)
      rec.stashId = row.id
      rec.stashdbGender = row.gender ?? rec.stashdbGender
      if (!rec.local) {
        rec.disambiguation = row.disambiguation || rec.disambiguation
        rec.image = row.image || rec.image
      }
      if (row.popularSceneIds)
        rec.popularSceneIds = row.popularSceneIds.map(map.sceneId)
      if (row.sceneCount != null) rec.sceneCount = row.sceneCount
    }
    for (const row of sdb.studios || []) {
      const ref = map.studio(row)
      const st = ensureStudio(ref.id, ref.name, ref.parent?.id)
      if (row.popularSceneIds)
        st.popularSceneIds = row.popularSceneIds.map(map.sceneId)
    }
  }

  const localPerformers = [...performers.values()].filter((p) => p.local)
  for (const p of localPerformers)
    if (p.local.scene_count == null)
      p.local.scene_count = p.ownedSceneIds.length
  // Ratings another plugin set: performers by gender (Prime treats them all
  // alike, but a gender the user rated by hand keeps its ratings), scenes
  // as one library
  markRatingSources(
    localPerformers,
    (p) => p.local,
    (p) => p.local.gender,
  )
  markRatingSources(owned, (s) => s.local)
  localPerformers.sort(
    (a, b) =>
      b.local.scene_count - a.local.scene_count || a.name.localeCompare(b.name),
  )
  const localStudios = [...studios.values()].filter(
    (st) => st.ownedSceneIds.length,
  )
  localStudios.sort((a, b) => a.name.localeCompare(b.name))

  // Tags in the owned library (Stash only knows tags on scenes you have)
  const localTagCounts = new Map()
  for (const s of owned)
    for (const t of s.tags)
      localTagCounts.set(t.id, (localTagCounts.get(t.id) || 0) + 1)

  // StashDB rank lookups: position of a scene in a performer's / studio's POPULARITY order
  const performerRank = new Map() // sceneId -> [{performerId, rank}]
  for (const p of performers.values()) {
    if (!p.popularSceneIds) continue
    p.popularSceneIds.forEach((sid, i) => {
      if (!performerRank.has(sid)) performerRank.set(sid, [])
      performerRank.get(sid).push({ performerId: p.id, rank: i + 1 })
    })
  }
  const studioRank = new Map() // sceneId -> {studioId, rank}
  for (const st of studios.values()) {
    if (!st.popularSceneIds) continue
    st.popularSceneIds.forEach((sid, i) => {
      if (!studioRank.has(sid))
        studioRank.set(sid, { studioId: st.id, rank: i + 1 })
    })
  }

  return {
    asOf,
    hasStashdb: !!sdb,
    totalStashdbScenes: sdb?.totalScenes ?? null,
    scenes,
    owned,
    performers,
    localPerformers,
    studios,
    localStudios,
    tags,
    localTagCounts,
    performerRank,
    studioRank,
    favoritePerformerIds: new Set(
      localPerformers.filter((p) => p.local.favorite).map((p) => p.id),
    ),
  }
}

// ---------------------------------------------------------------- StashDB onto the library

// StashDB ids -> the ids they have in the database
function stashdbMapping({ owned, performers, tags, endpoint }) {
  // scenes and performers: through the library's stash_ids
  const sceneBy = new Map()
  for (const s of owned) {
    const sid = stashIdOn(s.local.stash_ids, endpoint)
    if (sid && !sceneBy.has(sid)) sceneBy.set(sid, s.id)
  }
  const perfBy = new Map()
  for (const p of performers.values()) {
    const sid = p.local && stashIdOn(p.local.stash_ids, endpoint)
    if (sid && !perfBy.has(sid)) perfBy.set(sid, p.id)
  }
  // studios: by name; a library studio keeps the parent Stash gives it
  const studioBy = new Map()
  for (const s of owned) {
    if (!s.studio) continue
    const key = norm(s.studio.name)
    if (!studioBy.has(key)) studioBy.set(key, s.studio)
    const parent = s.studio.parent
    if (parent && !studioBy.has(norm(parent.name)))
      studioBy.set(norm(parent.name), { ...parent, parent: null })
  }
  const studioRef = (ref) => {
    if (!ref) return null
    const lib = studioBy.get(norm(ref.name))
    if (lib) return { id: lib.id, name: lib.name, parent: lib.parent }
    const parent = ref.parent
      ? studioRef({ ...ref.parent, parent: null })
      : null
    return {
      id: STASHDB_PREFIX + ref.id,
      name: ref.name,
      parent: parent ? { id: parent.id, name: parent.name } : null,
    }
  }
  // tags: by name
  const tagBy = new Map()
  for (const t of tags.values())
    if (!tagBy.has(norm(t.name))) tagBy.set(norm(t.name), t)

  return {
    sceneId: (id) => sceneBy.get(id) || STASHDB_PREFIX + id,
    performerId: (id) => perfBy.get(id) || STASHDB_PREFIX + id,
    studio: studioRef,
    tag: (t) => {
      const lib = tagBy.get(norm(t.name))
      if (lib) return lib
      const id = STASHDB_PREFIX + t.id
      if (!tags.has(id)) tags.set(id, { id, name: t.name })
      return tags.get(id)
    },
  }
}

// StashDB's scenes: one you own adds its popularity to yours; the rest are
// scenes you don't have
function addStashdbScenes(sdb, map, { scenes, performers }) {
  for (const row of sdb.scenes || []) {
    const id = map.sceneId(row.id)
    const mine = scenes.get(id)
    if (mine?.owned) {
      if (row.heldBy != null) mine.heldBy = row.heldBy
      if (row.globalPopularityRank != null)
        mine.globalPopularityRank = row.globalPopularityRank
      mine.stashId = row.id
      continue
    }
    if (mine) continue // listed twice
    const credits = (row.performers || []).map((p) => {
      const pid = map.performerId(p.id)
      let rec = performers.get(pid)
      if (!rec) {
        rec = newPerformer(pid, p.name)
        rec.disambiguation = p.disambiguation || null
        rec.stashId = p.id
        rec.stashdbGender = p.gender ?? null
        performers.set(pid, rec)
      }
      return {
        id: pid,
        name: rec.name || p.name,
        gender: (rec.local ? rec.local.gender : (p.gender ?? null)) ?? null,
      }
    })
    const seen = new Set()
    scenes.set(id, {
      id,
      title: row.title || '',
      date: row.date || null,
      duration: row.duration ?? null,
      image: row.image || null,
      studio: map.studio(row.studio),
      performers: credits,
      tags: (row.tags || [])
        .map(map.tag)
        .filter((t) => !seen.has(t.id) && seen.add(t.id)),
      owned: false,
      local: null,
      localId: null,
      stashId: row.id,
      heldBy: row.heldBy ?? null,
      globalPopularityRank: row.globalPopularityRank ?? null,
    })
  }
}
