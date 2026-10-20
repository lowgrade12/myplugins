// What the StashDB layer has fetched this session, as one `stashdb` input for
// buildDb (model/db.js, StashdbInput). Each page's lookups add a part: a
// performer's popularity list, a studio's, scenes by id. Parts merge into
// what is there, so visiting more pages only adds to it.

// Records by id, existing order first. A newer record's fields win, except
// those it leaves out or holds as undefined (a scene from a popularity list
// carries no fingerprints, so it keeps a held-by count fetched earlier).
function upsert(list, items) {
  if (!items?.length) return list || []
  const out = [...(list || [])]
  const at = new Map(out.map((x, i) => [x.id, i]))
  for (const item of items) {
    const fields = Object.fromEntries(
      Object.entries(item).filter(([, v]) => v !== undefined),
    )
    if (at.has(item.id))
      out[at.get(item.id)] = { ...out[at.get(item.id)], ...fields }
    else {
      at.set(item.id, out.length)
      out.push(fields)
    }
  }
  return out
}

/**
 * @param {object|null} prev  the stashdb input so far, or null
 * @param {{ endpoint?: string, scenes?: object[], performers?: object[],
 *   studios?: object[], totalScenes?: number }} part
 * @returns {object} a new stashdb input; prev is not changed
 */
export function mergeStashdb(prev, part) {
  const base = prev || { scenes: [], performers: [], studios: [] }
  return {
    ...base,
    endpoint: part.endpoint ?? base.endpoint,
    totalScenes: part.totalScenes ?? base.totalScenes,
    scenes: upsert(base.scenes, part.scenes),
    performers: upsert(base.performers, part.performers),
    studios: upsert(base.studios, part.studios),
  }
}

// Several parts at once (one store change, so the model rebuilds once).
export const mergeAll = (prev, parts) =>
  parts.reduce((acc, part) => mergeStashdb(acc, part), prev)
