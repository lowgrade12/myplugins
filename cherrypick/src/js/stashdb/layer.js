// The StashDB layer at run time: whether to look things up (a StashDB key in
// Stash's settings, unless the user turned StashDB off in Cherry Pick), the client for
// that key, and what each page fetches. Nothing is fetched at load: a page
// asks for its own lookups when it shows, and the answers merge into the
// store's `stashdbData`, the stashdb input buildDb takes, so the model
// rebuilds with them (runtime/engine.js).
//
// What a page costs StashDB on its first visit (the cache answers later
// visits; after 7 days, StashDB is asked again in the background once the
// page's lookups are done, and the new answer shows the next time a page
// asks for it, so a page never changes under the user):
//   - a performer's Scenes tab: 1 request, their 100 most popular scenes;
//   - a scene page: 1 request for the scene itself (its held-by count, its
//     StashDB performers and studio), 1 per performer for up to 3 of them,
//     and 1 for the studio when More like this shows scenes you don't have;
//   - the front page's New in your library (libraries under 30 scenes): 1
//     per performer for the 3 performers most present in the row. Its other
//     scenes use what is cached.
import { React } from '../runtime/api.js'
import { store } from '../runtime/app.js'
import { onLocation } from '../runtime/location.js'
import { cache } from '../storage/tier3.js'
import { PLUGIN_ID } from '../name.js'
import { useAppState } from '../ui/hooks.js'
import { CACHE_PREFIX, createStashdbClient, MAX_AGE_MS } from './client.js'
import { mergeAll } from './merge.js'
import { performerScenes, scenesById, studioScenes } from './lookups.js'
import { stashdbIdOf } from './queries.js'

const SCENE_PERFORMERS = 3
const FALLBACK_PERFORMERS = 3

// A StashDB key in Stash turns the lookups on: the user gave Stash the key,
// and Stash uses it the same way. Cherry Pick's page can turn them off
// (tier 1 consent.stashdbOff).
export const stashdbReady = (s) =>
  !!(s.stashdb?.apiKey && !s.consent?.stashdbOff)

// ------------------------------------------------------------ the client

let client = null
let clientFor = ''

function clientOf(s) {
  const id = `${s.stashdb.endpoint}\n${s.stashdb.apiKey}`
  if (!client || clientFor !== id) {
    client = createStashdbClient({
      endpoint: s.stashdb.endpoint,
      apiKey: s.stashdb.apiKey,
      fetch: (...args) => window.fetch(...args),
      cache,
      log: (text) => console.debug(`${PLUGIN_ID}: ${text}`),
    })
    clientFor = id
  }
  return client
}

// Each route change is a new page view (a new request budget; requests still
// queued for the page left behind are dropped).
onLocation(() => client?.newView())

// ------------------------------------------------------------ page lookups

// key -> 'loading' | 'done' | 'partial' | 'failed', in the store as
// stashdbLookups. 'partial' and 'failed' try again the next time the page
// shows.
function setStatus(key, status) {
  store.set((s) => ({
    stashdbLookups: { ...(s.stashdbLookups || {}), [key]: status },
  }))
}

// Cache entries already merged ("key@time"): a page whose answers are all
// in stashdbData changes nothing, so the model does not rebuild for it.
const merged = new Set()

async function runPage(key, lookups) {
  const s = store.get()
  if (!stashdbReady(s)) return
  const cur = s.stashdbLookups?.[key]
  if (cur === 'loading' || cur === 'done') return
  setStatus(key, 'loading')
  const c = clientOf(s)
  let results = [null]
  try {
    results = await lookups(c)
  } catch (e) {
    console.warn(`${PLUGIN_ID}: StashDB lookup failed`, e)
  }
  const got = results.filter(Boolean)
  const fresh = got.filter((r) => r.entries.some((e) => !merged.has(e)))
  if (fresh.length) {
    for (const r of fresh) r.entries.forEach((e) => merged.add(e))
    store.set((st) => ({
      stashdbData: mergeAll(
        st.stashdbData || null,
        fresh.map((r) => ({ endpoint: st.stashdb?.endpoint, ...r.part })),
      ),
    }))
  }
  const whole =
    got.length === results.length && got.every((r) => r.complete !== false)
  setStatus(
    key,
    !got.length && results.length ? 'failed' : whole ? 'done' : 'partial',
  )
  // the stale answers the page used, asked for again and only kept
  c.revalidate().catch((e) =>
    console.debug(`${PLUGIN_ID}: StashDB refresh failed`, e),
  )
  setTimeout(pruneOnce, 5000)
}

export const performerKey = (stashId) => 'performer:' + stashId

// A performer's Scenes tab: their scenes on StashDB in popularity order.
export const lookupPerformer = (stashId) =>
  runPage(performerKey(stashId), async (c) => [
    await performerScenes(c, stashId),
  ])

export const sceneKey = (sceneId, withStudio) =>
  `scene:${sceneId}${withStudio ? '+studio' : ''}`

// A scene page: the scene itself (held by about N), then More like this
// candidates from its StashDB performers and, for the row of scenes you
// don't have, its studio. scene: Stash's SceneData.
export const lookupScene = (scene, { studio }) =>
  runPage(sceneKey(scene.id, studio), async (c) => {
    const out = []
    const id = stashdbIdOf(scene.stash_ids)
    let remote = null
    if (id) {
      const r = await scenesById(c, [id])
      out.push(r)
      remote = r?.part.scenes.find((x) => x.id === id) || null
    }
    const performers = [
      ...new Set(
        [
          ...(scene.performers || []).map((p) => stashdbIdOf(p.stash_ids)),
          ...(remote?.performers || []).map((p) => p.id),
        ].filter(Boolean),
      ),
    ].slice(0, SCENE_PERFORMERS)
    const studioId = studio
      ? stashdbIdOf(scene.studio?.stash_ids) || remote?.studio?.id
      : null
    out.push(
      ...(await Promise.all([
        ...performers.map((p) => performerScenes(c, p)),
        ...(studioId ? [studioScenes(c, studioId)] : []),
      ])),
    )
    return out
  })

// New in your library: popularity for its order and reason lines, by
// performer. The performers most present in the row (up to 3) are looked
// up; the rest of the row uses what earlier pages cached.
export function lookupFallback(db, scenes) {
  const count = new Map()
  for (const s of scenes)
    for (const p of s.performers) {
      const id = db.performers.get(p.id)?.stashId
      if (id) count.set(id, (count.get(id) || 0) + 1)
    }
  const ids = [...count]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FALLBACK_PERFORMERS)
    .map(([id]) => id)
  if (!ids.length) return Promise.resolve()
  return runPage('fallback', (c) =>
    Promise.all(ids.map((id) => performerScenes(c, id))),
  )
}

// A page's lookups as the page sees them: 'idle' (none asked), 'loading'
// (asked, or answered but not yet in the model), or the status.
export function lookupState(s, key) {
  const st = s.stashdbLookups?.[key]
  if (!st) return 'idle'
  if (st === 'loading') return st
  if ((s.modelStashdb ?? null) !== (s.stashdbData ?? null)) return 'loading'
  return st
}

// ------------------------------------------------------------ hooks

export function usePerformerLookups(stashId, enabled) {
  const ready = useAppState(stashdbReady)
  React.useEffect(() => {
    if (ready && enabled && stashId) lookupPerformer(stashId)
  }, [ready, enabled, stashId])
}

// scene: Stash's SceneData on the scene page. Runs when the row of scenes
// you don't have or the score line's popover could use the answers.
export function useSceneLookups(scene) {
  const ready = useAppState(stashdbReady)
  const row = useAppState(
    (s) => s.settings.showMoreLikeThis && s.settings.outOfLibrary,
  )
  const line = useAppState((s) => s.settings.sceneLine)
  const latest = React.useRef(scene)
  latest.current = scene
  React.useEffect(() => {
    if (ready && (row || line)) lookupScene(latest.current, { studio: row })
  }, [ready, row, line, scene.id])
  return useAppState((s) => lookupState(s, sceneKey(scene.id, row)))
}

// items: New in your library's row.
export function useFallbackLookups(items) {
  const ready = useAppState(stashdbReady)
  const db = useAppState((s) => s.db)
  const has = !!items?.length
  React.useEffect(() => {
    if (ready && has && db)
      lookupFallback(
        db,
        items.map((it) => it.scene),
      )
    // once per row: the fallback holds for the visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, has, !!db])
}

// The StashDB scene as fetched (with its store link), by StashDB id.
let index = { data: undefined, byId: new Map() }
export function fetchedScene(s, id) {
  if (index.data !== s.stashdbData)
    index = {
      data: s.stashdbData,
      byId: new Map((s.stashdbData?.scenes || []).map((x) => [x.id, x])),
    }
  return index.byId.get(id) || null
}

// ------------------------------------------------------------ the cache

async function cacheKeys() {
  return (await cache.keys()).filter(
    (k) => typeof k === 'string' && k.startsWith(CACHE_PREFIX),
  )
}

// How many lookups this browser holds, and when the oldest was made.
export async function cacheStats() {
  const keys = await cacheKeys()
  if (!keys.length) return { count: 0, oldest: null }
  const ats = (await cache.getMany(keys))
    .map((v) => v?.at)
    .filter((n) => typeof n === 'number')
  return { count: keys.length, oldest: ats.length ? Math.min(...ats) : null }
}

export async function clearStashdbCache() {
  await cache.delMany(await cacheKeys())
  merged.clear()
  store.set({ stashdbData: null, stashdbLookups: {} })
}

// Lookups older than 30 days go, once a session, after the first lookups.
let pruned = false
async function pruneOnce() {
  if (pruned) return
  pruned = true
  const keys = await cacheKeys()
  const values = await cache.getMany(keys)
  const old = keys.filter(
    (k, i) => !(Date.now() - (values[i]?.at ?? 0) < MAX_AGE_MS),
  )
  if (old.length) await cache.delMany(old)
}
