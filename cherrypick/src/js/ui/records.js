// Stash's own records for the cards Cherry Pick shows. Stash's SceneCard and
// PerformerCard take the fragments Stash's lists use (SlimSceneData,
// PerformerData), so rows fetch those by id through Stash's own queries and
// client, sharing its cache with Stash's pages.
import { React, utils } from '../runtime/api.js'

const { useEffect, useState } = React

const fetchers = {
  scene: async (ids) =>
    (await utils.StashService.queryFindScenesByID(ids.map(Number))).data
      .findScenes.scenes,
  performer: async (ids) =>
    (await utils.StashService.queryFindPerformersByID(ids.map(Number))).data
      .findPerformers.performers,
}

// Records for ids, in the order of ids. null while loading.
export function useStashRecords(kind, ids) {
  const key = ids.join(',')
  const [records, setRecords] = useState(null)
  useEffect(() => {
    let live = true
    if (!ids.length) {
      setRecords([])
      return
    }
    fetchers[kind](ids)
      .then((rows) => {
        if (!live) return
        const byId = new Map(rows.map((r) => [r.id, r]))
        setRecords(ids.map((id) => byId.get(id)).filter(Boolean))
      })
      .catch((e) => {
        console.error('CherryPick:', e)
        if (live) setRecords([])
      })
    return () => {
      live = false
    }
    // ids are compared by value through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key])
  return records
}
