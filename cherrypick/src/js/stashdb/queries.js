// What Cherry Pick asks StashDB, and how the answers become the `stashdb`
// input buildDb documents (model/db.js, StashdbInput). Pure, so the unit
// tests run it in Node.
//
// Three lookups, all in StashDB's own popularity order (POPULARITY counts
// the distinct users who submitted a fingerprint; TRENDING would drop every
// scene without a submission in the last week):
//   - a performer's scenes, up to 100, and how many they have
//   - a studio's scenes, up to 40, for More like this
//   - scenes by id, with fingerprint submissions for "held by about N"
import { STASHDB_ENDPOINT } from '../model/db.js'

export { STASHDB_ENDPOINT }

// Only StashDB itself counts: the manifest lets the browser reach
// https://stashdb.org and nothing else.
export function isStashdbEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname.toLowerCase() === 'stashdb.org'
  } catch {
    return false
  }
}

// A record's StashDB id, from Stash's stash_ids.
export const stashdbIdOf = (stashIds) =>
  (stashIds || []).find((x) => isStashdbEndpoint(x?.endpoint))?.stash_id || null

// A page on the StashDB site: kind is 'scenes', 'performers' or 'studios'.
export function stashdbPage(endpoint, kind, id) {
  let origin = 'https://stashdb.org'
  try {
    origin = new URL(endpoint).origin
  } catch {
    // keep the default
  }
  return `${origin}/${kind}/${encodeURIComponent(id)}`
}

// ---------------------------------------------------------------- Stash's stash-boxes

export const STASHBOX_NAME = 'StashDB'

// A name no other stash-box has (Stash's stash-box list wants names).
function freeName(boxes) {
  const taken = new Set(boxes.map((b) => b.name))
  for (let n = 1; ; n++) {
    const name = n === 1 ? STASHBOX_NAME : `${STASHBOX_NAME} ${n}`
    if (!taken.has(name)) return name
  }
}

// The stash-box list with the key in it. Every other entry stays exactly as
// Stash reports it (name, endpoint, key and request limit). If a StashDB
// entry is there already (its key failed to validate), only its key
// changes. (Stash 0.31 reports every request limit as 0: its configuration
// writes the limit under a key it does not read back, so its own settings
// page loses it on any save too.)
export function withStashdbKey(boxes, apiKey) {
  const list = boxes.map((b) => ({
    endpoint: b.endpoint,
    api_key: b.api_key,
    name: b.name,
    max_requests_per_minute: b.max_requests_per_minute,
  }))
  const i = list.findIndex((b) => isStashdbEndpoint(b.endpoint))
  if (i >= 0) {
    list[i] = { ...list[i], api_key: apiKey }
    return { boxes: list, endpoint: list[i].endpoint }
  }
  list.push({
    endpoint: STASHDB_ENDPOINT,
    api_key: apiKey,
    name: freeName(list),
  })
  return { boxes: list, endpoint: STASHDB_ENDPOINT }
}

// ---------------------------------------------------------------- queries

export const PERFORMER_SCENES = 100
export const STUDIO_SCENES = 40
// Scenes asked for by id in one request (aliases of findScene).
export const SCENE_BATCH = 25

const SCENE_FIELDS = `
  fragment CherryPickStashdbScene on Scene {
    id
    title
    release_date
    duration
    images { url width height }
    studio { id name parent { id name } }
    performers { performer { id name disambiguation gender } }
    tags { id name }
    urls { url site { name category { name } } }
  }
`

// A performer's or a studio's scenes, most popular first.
export const SCENE_QUERY = `
  query CherryPickStashdbSceneQuery($input: SceneQueryInput!) {
    queryScenes(input: $input) {
      count
      scenes { ...CherryPickStashdbScene }
    }
  }
  ${SCENE_FIELDS}
`

const byPopularity = (filter, perPage) => ({
  input: {
    ...filter,
    sort: 'POPULARITY',
    direction: 'DESC',
    page: 1,
    per_page: perPage,
  },
})
export const performerScenesVariables = (id) =>
  byPopularity(
    { performers: { value: [id], modifier: 'INCLUDES' } },
    PERFORMER_SCENES,
  )
export const studioScenesVariables = (id) =>
  byPopularity(
    { studios: { value: [id], modifier: 'INCLUDES' } },
    STUDIO_SCENES,
  )

// Scenes by id: StashDB serves no findScenes(ids), so one request carries a
// findScene per id, as aliases s0, s1, ...
export function scenesByIdQuery(n) {
  const vars = Array.from({ length: n }, (_, i) => `$s${i}: ID!`).join(', ')
  const fields = Array.from(
    { length: n },
    (_, i) =>
      `s${i}: findScene(id: $s${i}) { ...CherryPickStashdbScene fingerprints { algorithm submissions } }`,
  ).join('\n    ')
  return `
  query CherryPickStashdbScenes(${vars}) {
    ${fields}
  }
  ${SCENE_FIELDS}
`
}
export const scenesByIdVariables = (ids) =>
  Object.fromEntries(ids.map((id, i) => [`s${i}`, id]))

// ---------------------------------------------------------------- answers

// "Held by about N StashDB users": the submissions on the scene's OSHASH
// fingerprints (every file Stash scans has one). One user with two copies
// counts twice, so it is shown as approximate and never used to rank. A
// scene with no OSHASH falls back to its largest per-algorithm sum.
export function heldByOf(fingerprints) {
  if (!fingerprints?.length) return null
  const sums = {}
  for (const f of fingerprints)
    sums[f.algorithm] = (sums[f.algorithm] || 0) + (f.submissions || 0)
  const n = sums.OSHASH ?? Math.max(...Object.values(sums))
  return n > 0 ? n : null
}

// The landscape cover if there is one.
function imageOf(images) {
  const list = (images || []).filter((i) => i?.url)
  const wide = list.find((i) => !i.height || i.width >= i.height)
  return (wide || list[0])?.url || null
}

// Query parameters that carry an affiliate or tracking code. Affiliate codes
// never appear in the plugin, so a link keeps only the address of the
// scene's page.
const TRACKING =
  /^(utm_\w*|ref|refid|referrer|aff\w*|nats|ats|campaign\w*|track\w*|click\w*|coupon\w*|promo\w*|partner\w*|source|src|fbclid|gclid)$/i

// StashDB files each link under the site whose address pattern it matches.
// The stores and tubes a scene is sold or shown on (Clips4Sale, iWantClips,
// ManyVids, Pornhub, ...) are sites in this category; "Studio" has no
// pattern and takes the rest, mostly paysites.
export const STORE_CATEGORY = 'Content distribution platforms'

// Archives copy a page; they never sell the scene. The stores' patterns
// match a Wayback Machine copy of their own pages too.
const ARCHIVE = /(^|\.)(archive\.org|archive\.(is|ph|today))$/i

// A link's address without tracking parameters or fragment, or null when it
// is not a web page or is an archive's copy.
function cleanUrl(raw) {
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol) || ARCHIVE.test(url.hostname))
      return null
    for (const k of [...url.searchParams.keys()])
      if (TRACKING.test(k)) url.searchParams.delete(k)
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Where to get the scene, from StashDB's links: a store's page first, else
 * its studio's, as { url, site } with the site's name ("Clips4Sale",
 * "Studio"), or null when StashDB lists neither.
 */
export function storeLink(urls) {
  const links = (urls || [])
    .map((u) => ({
      site: u?.site?.name,
      category: u?.site?.category?.name,
      url: cleanUrl(u?.url),
    }))
    .filter((u) => u.url && u.site)
  const link =
    links.find((u) => u.category === STORE_CATEGORY) ||
    links.find((u) => /^studio$/i.test(u.site))
  return link ? { url: link.url, site: link.site } : null
}

// Where to get a fetched scene: { url, site }, or null. A scene cached
// before store links (cache format 1) carries only its studio link,
// studioUrl, until the client asks StashDB for it again in the background.
export const storeOf = (scene) =>
  scene?.store ||
  (scene?.studioUrl ? { url: scene.studioUrl, site: 'Studio' } : null)

/**
 * One StashDB scene, in buildDb's StashdbScene shape, plus `store` for the
 * card (buildDb ignores it). heldBy is left out when the answer had no
 * fingerprints, and store when it had no link, so merging never overwrites
 * a known count or link.
 */
export function sceneFromApi(row) {
  const st = row.studio
  const scene = {
    id: row.id,
    title: row.title || '',
    date: row.release_date || row.date || null,
    duration: row.duration ?? null,
    image: imageOf(row.images),
    studio: st
      ? {
          id: st.id,
          name: st.name,
          parent: st.parent ? { id: st.parent.id, name: st.parent.name } : null,
        }
      : null,
    performers: (row.performers || [])
      .map((a) => a?.performer)
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name,
        gender: p.gender ?? null,
        disambiguation: p.disambiguation || null,
      })),
    tags: (row.tags || []).map((t) => ({ id: t.id, name: t.name })),
  }
  const store = storeLink(row.urls)
  if (store) scene.store = store
  if (row.fingerprints) scene.heldBy = heldByOf(row.fingerprints)
  return scene
}

// A performer's popularity list, as a part of the stashdb input.
export function performerPart(id, result) {
  const scenes = (result?.scenes || []).map(sceneFromApi)
  const credit = scenes.flatMap((s) => s.performers).find((p) => p.id === id)
  const performer = {
    id,
    sceneCount: result?.count ?? scenes.length,
    popularSceneIds: scenes.map((s) => s.id),
  }
  if (credit) {
    performer.name = credit.name
    performer.gender = credit.gender
    performer.disambiguation = credit.disambiguation
  }
  return { performers: [performer], scenes }
}

// A studio's popularity list. A studio with no scenes on StashDB adds
// nothing: buildDb matches studios by name, and there is none to take.
export function studioPart(id, result) {
  const scenes = (result?.scenes || []).map(sceneFromApi)
  const own = scenes.find((s) => s.studio?.id === id)?.studio
  if (!own) return { scenes }
  return {
    studios: [
      {
        id,
        name: own.name,
        parent: own.parent,
        popularSceneIds: scenes.map((s) => s.id),
      },
    ],
    scenes,
  }
}
