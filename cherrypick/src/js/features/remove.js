// "Remove Cherry Pick data": a tombstone in tier 1 (so another browser's
// mirror cannot bring the data back), the plugin's custom fields off every
// performer and scene (tier 2), and this browser's cache (tier 3). Ratings
// the plugin applied are Stash's own and stay; without their provisional
// mark they count as the user's.
import {
  cancelWrites,
  patchLibraryPerformers,
  patchLibraryScenes,
  run,
  runMutation,
  store,
  tier1,
} from '../runtime/app.js'
import {
  PERFORMER_UPDATE,
  PERFORMERS_WITH_FIELD,
  SCENE_SET_FIELDS,
  SCENES_WITH_FIELD,
} from '../data/queries.js'
import { fromConfig } from '../storage/tier1.js'
import { clearTier3, KEYS, local } from '../storage/tier3.js'
import { EMPTY_SIGNALS } from '../model/foryou.js'
import {
  OWN_FIELDS,
  ownFieldsOn,
  PROVISIONAL_FIELD,
} from '../model/brackets.js'

// Performers holding any of the plugin's fields, with those fields.
async function performersWithFields() {
  const found = new Map()
  for (const field of OWN_FIELDS) {
    const { findPerformers } = await run(PERFORMERS_WITH_FIELD, {
      performer_filter: { custom_fields: [{ field, modifier: 'NOT_NULL' }] },
    })
    for (const p of findPerformers.performers) found.set(p.id, p)
  }
  return [...found.values()]
}

// Scenes holding the plugin's one scene field, the provisional mark
async function scenesWithFields() {
  const { findScenes } = await run(SCENES_WITH_FIELD, {
    scene_filter: {
      custom_fields: [{ field: PROVISIONAL_FIELD, modifier: 'NOT_NULL' }],
    },
  })
  return findScenes.scenes
}

export async function removalCounts() {
  return {
    brackets: store.get().brackets.history.length,
    performers: (await performersWithFields()).length,
    scenes: (await scenesWithFields()).length,
  }
}

export async function removePluginData() {
  cancelWrites()
  await tier1.remove()
  // One library update for each list at the end: each update rebuilds the
  // model.
  const performers = new Map()
  for (const p of await performersWithFields()) {
    const remove = ownFieldsOn(p.custom_fields)
    await runMutation(PERFORMER_UPDATE, {
      input: { id: p.id, custom_fields: { remove } },
    })
    const rest = { ...(p.custom_fields || {}) }
    for (const f of remove) delete rest[f]
    performers.set(p.id, { custom_fields: rest })
  }
  patchLibraryPerformers(performers)
  const scenes = new Map()
  for (const s of await scenesWithFields()) {
    const data = await runMutation(SCENE_SET_FIELDS, {
      input: {
        id: s.id,
        custom_fields: { remove: ownFieldsOn(s.custom_fields) },
      },
    })
    scenes.set(s.id, { custom_fields: data.sceneUpdate.custom_fields })
  }
  patchLibraryScenes(scenes)
  await clearTier3()
  local.del(KEYS.signals)
  store.set({
    ...fromConfig(null),
    signals: EMPTY_SIGNALS,
    stashdbData: null,
    stashdbLookups: {},
    recentHidden: [],
    notice: { kind: 'removed' },
  })
}
