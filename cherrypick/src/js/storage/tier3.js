// Tier 3: browser storage, only for what Cherry Pick can do without: the
// library copy (data/library.js) and the StashDB cache (stashdb/client.js)
// in IndexedDB, too big for localStorage, and For you's row signals and the
// tier 1 mirror in localStorage. The taste model is not stored: it is fitted
// again on each load (runtime/engine.js). A private window or full storage
// degrades to no persistence.
import {
  clear,
  createStore,
  del,
  delMany,
  get,
  getMany,
  keys,
  set,
} from 'idb-keyval'
import { PLUGIN_ID, STORAGE_PREFIX } from '../name.js'

export const KEYS = {
  mirror: STORAGE_PREFIX + 'config-mirror',
  signals: STORAGE_PREFIX + 'for-you-signals',
  stashdb: STORAGE_PREFIX + 'stashdb-cache',
  // the last cross-validation's numbers, for the gate until this load's
  // own finishes (runtime/engine.js)
  cv: STORAGE_PREFIX + 'last-cv',
}

export const local = {
  get(key) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // private mode or full: run without persistence
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      // nothing to remove
    }
  },
}

let idb = null
const db = () => (idb ||= createStore(PLUGIN_ID.toLowerCase(), 'cache'))

// IndexedDB through idb-keyval; every call fails soft.
export const cache = {
  get: (key) => get(key, db()).catch(() => null),
  set: (key, value) => set(key, value, db()).catch(() => {}),
  del: (key) => del(key, db()).catch(() => {}),
  // for the StashDB cache's stats and clearing (its keys share a prefix)
  keys: () => keys(db()).catch(() => []),
  getMany: (list) => getMany(list, db()).catch(() => list.map(() => undefined)),
  delMany: (list) => delMany(list, db()).catch(() => {}),
}

// "Remove Cherry Pick data" and "Open on a new device": everything here goes.
export async function clearTier3() {
  for (const key of Object.values(KEYS)) local.del(key)
  await clear(db()).catch(() => {})
}
