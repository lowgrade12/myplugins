// The lookups a page asks for, each through the client's cache. Each one
// resolves to { part, entries } (part: a piece of the stashdb input;
// entries: the cache entries it came from, as "key@time", so the runtime can
// tell an answer it already merged), or null when StashDB could not be asked.
// Pure: the client comes in as an argument.
import {
  performerPart,
  performerScenesVariables,
  SCENE_BATCH,
  SCENE_QUERY,
  sceneFromApi,
  scenesByIdQuery,
  scenesByIdVariables,
  studioPart,
  studioScenesVariables,
} from './queries.js'

const stamp = (key, entry) => `${key}@${entry.at}`

// A list query's answer, kept as StashDB sent it (count and scenes).
const listLoad = (client, variables) => async () => {
  const data = await client.request(SCENE_QUERY, variables)
  return data?.queryScenes ?? undefined
}

// A performer's scenes, most popular first, and how many they have.
export async function performerScenes(client, id) {
  const key = 'performer-scenes:' + id
  const entry = await client.cached(
    key,
    listLoad(client, performerScenesVariables(id)),
  )
  if (!entry) return null
  return { part: performerPart(id, entry.data), entries: [stamp(key, entry)] }
}

// A studio's most popular scenes.
export async function studioScenes(client, id) {
  const key = 'studio-scenes:' + id
  const entry = await client.cached(
    key,
    listLoad(client, studioScenesVariables(id)),
  )
  if (!entry) return null
  return { part: studioPart(id, entry.data), entries: [stamp(key, entry)] }
}

// Scenes by id from StashDB, one request per SCENE_BATCH, each kept in the
// cache as it comes (a scene StashDB does not have as null). Resolves to
// their entries by id, without the ones whose request failed.
async function fetchScenes(client, ids) {
  const got = new Map()
  for (let i = 0; i < ids.length; i += SCENE_BATCH) {
    const chunk = ids.slice(i, i + SCENE_BATCH)
    const data = await client.request(
      scenesByIdQuery(chunk.length),
      scenesByIdVariables(chunk),
    )
    if (!data) continue
    for (const [j, id] of chunk.entries()) {
      const row = data['s' + j]
      got.set(
        id,
        await client.put('scene:' + id, row ? sceneFromApi(row) : null),
      )
    }
  }
  return got
}

// Scenes by id, with their held-by counts. Cached per scene; the ones not
// cached go to StashDB, and stale ones go again in the background, all
// together. A scene StashDB does not have adds nothing.
export async function scenesById(client, ids) {
  const scenes = []
  const entries = []
  const missing = []
  const stale = []
  const add = (id, entry) => {
    entries.push(stamp('scene:' + id, entry))
    if (entry.data) scenes.push(entry.data)
  }
  for (const id of [...new Set(ids)]) {
    const hit = await client.peek('scene:' + id)
    if (!hit) missing.push(id)
    else {
      add(id, hit)
      if (hit.stale) stale.push(id)
    }
  }
  const got = await fetchScenes(client, missing)
  for (const id of missing) if (got.has(id)) add(id, got.get(id))
  if (stale.length)
    client.refresh('scenes:' + stale.join(','), () =>
      fetchScenes(client, stale),
    )
  const complete = got.size === missing.length
  if (!complete && !scenes.length) return null
  return { part: { scenes }, entries, complete }
}
