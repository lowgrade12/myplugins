// The plugin's state and how it comes to life. Stash renders Cherry Pick's
// pieces in many separate places (cards, rows, the scene page, dialogs), so
// they all read one store and change it through actions.
//
// Boot: read the plugin's configuration (tier 1), then the library (from the
// IndexedDB copy if there is one, refreshed in the background), then fit the
// taste model. Each step updates the store, and pieces render as soon as what
// they need is there.
import { PLUGIN_ID } from '../name.js'
import { createStore } from './store.js'
import { client, gql, GQL, mutate, query, utils } from './api.js'
import { isStoreReset } from './storeReset.js'
import { inSettings, onFrontPage, onLocation } from './location.js'
import * as Q from '../data/queries.js'
import { loadLibrary, REFRESH_MS } from '../data/library.js'
import {
  createTier1,
  fromConfig,
  STATE_TO_CONFIG,
  toConfig,
} from '../storage/tier1.js'
import { cache, KEYS, local } from '../storage/tier3.js'
import { autoApplyToWrite, SETTING_KEYS } from '../storage/settings.js'
import { ratingManagers } from '../model/rankings.js'
import { EMPTY_SIGNALS } from '../model/foryou.js'
import { isStashdbEndpoint } from '../stashdb/queries.js'

const docs = new Map()
const doc = (text) => {
  if (!docs.has(text)) docs.set(text, gql(text))
  return docs.get(text)
}
// One GraphQL request through Stash's client, outside Apollo's cache.
export const run = (text, variables) => query(doc(text), variables, 'no-cache')
export const runMutation = (text, variables) => mutate(doc(text), variables)

export const store = createStore({
  ...fromConfig(null),
  configLoaded: false,
  // the library as Stash returned it, and when
  library: null,
  // the StashDB stash-box from Stash's settings, if any: { endpoint, apiKey }
  stashdb: null,
  // what the StashDB layer fetched (buildDb's stashdb input), and the state
  // of each page's lookups (stashdb/layer.js)
  stashdbData: null,
  stashdbLookups: {},
  // For you's row signals (tier 3)
  signals: { ...EMPTY_SIGNALS, ...(local.get(KEYS.signals) || {}) },
  // A full read of the library, page by page ({ kind, n, of }), so For
  // you's first build can say how far it is. It stays null when the page
  // starts from the browser's copy of the library.
  loadProgress: null,
  // session only
  watching: false,
  // Watch This's visit: the pick on screen, the visit's skips and whether
  // the pick was started (runtime/watchThis.js)
  watchVisit: null,
  dialog: null,
  visit: 0,
  recentHidden: [],
  notice: null,
  error: null,
})

const readPluginMap = async () => {
  const { configuration } = await run(Q.CONFIGURATION)
  return configuration.plugins?.[PLUGIN_ID] ?? null
}

// Stash's Settings page and its plugin-settings save read the plugin's map
// from Stash's cached configuration, so that copy must hold what was
// written before the page uses it. Dropping the cached configuration after
// every write, as Stash's own useConfigurePlugin does, makes Stash fetch it
// again and redraw every page that reads it, after each bracket pick. So
// the written map is put into the cached copy in place (no request), and
// only when the Settings page opens or is open, the one place that reads it.
let unsyncedMap = null

function syncStashCache() {
  if (!unsyncedMap) return
  const map = unsyncedMap
  unsyncedMap = null
  try {
    client().cache.updateQuery({ query: GQL.ConfigurationDocument }, (data) =>
      data?.configuration
        ? {
            ...data,
            configuration: {
              ...data.configuration,
              plugins: { ...data.configuration.plugins, [PLUGIN_ID]: map },
            },
          }
        : data,
    )
  } catch (e) {
    // A cache whose shape this does not know: fall back to Stash's way.
    console.warn(`${PLUGIN_ID}: refreshing Stash's configuration`, e)
    utils.StashService.evictQueries(client().cache, [GQL.ConfigurationDocument])
  }
}

async function writePluginMap(map) {
  await runMutation(Q.CONFIGURE_PLUGIN, { plugin_id: PLUGIN_ID, input: map })
  unsyncedMap = map
  if (inSettings()) syncStashCache()
}

export const tier1 = createTier1({
  read: readPluginMap,
  write: writePluginMap,
  mirror: {
    get: () => local.get(KEYS.mirror),
    set: (map) => local.set(KEYS.mirror, map),
    del: () => local.del(KEYS.mirror),
  },
  settingsOpen: () => inSettings(),
})

// Writes what changed to where it lives: tier 1 for the plugin's own data,
// tier 3 for row signals. Settings are Stash's to write, except one the user
// changes through Cherry Pick itself (changeSettings). Tier 1 writes wait
// for a second of quiet (every write makes Stash refetch its
// configuration, and bracket picks come quickly), and Watch This's snoozes
// alone for five, so skips a few seconds apart go out as one write; the
// mirror takes each change at once.
const WRITE_DELAY_MS = 1000
const SNOOZE_DELAY_MS = 5000
const unsaved = new Set()
const unsavedSettings = new Set()
let saveTimer = null

function saveNow() {
  clearTimeout(saveTimer)
  saveTimer = null
  if (!unsaved.size && !unsavedSettings.size) return Promise.resolve()
  const own = [...unsavedSettings]
  const keys = [...unsaved, ...own]
  unsaved.clear()
  unsavedSettings.clear()
  return tier1.save(toConfig(store.get()), keys, own).catch((e) => {
    // Cut off by a store reset: the changes wait for the next try (the
    // mirror already holds them).
    if (!isStoreReset(e)) return reportError(e)
    keys.forEach((k) => (own.includes(k) ? unsavedSettings : unsaved).add(k))
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, RESET_RETRY_MS)
  })
}

// Settings the user changes through Cherry Pick, off Stash's Settings page
// (Hide on cards, beside Stash Curator): the store at once, then Stash, now
// and with anything else waiting. On Stash's Settings page, that page saves
// them instead (features/settingsExtras.jsx).
export function changeSettings(changes) {
  store.set((s) => ({ settings: { ...s.settings, ...changes } }))
  Object.keys(changes).forEach((k) => unsavedSettings.add(k))
  return saveNow()
}

function persist(next, prev) {
  // Loading the configuration is not a change to write back.
  if (!next.configLoaded || !prev.configLoaded || next === prev) return
  const keys = []
  for (const [k, cfg] of Object.entries(STATE_TO_CONFIG))
    if (prev[k] !== next[k]) keys.push(...cfg)
  if (keys.length) {
    tier1.stage(toConfig(next), keys)
    keys.forEach((k) => unsaved.add(k))
    clearTimeout(saveTimer)
    const onlySnoozes =
      !unsavedSettings.size && [...unsaved].every((k) => k === 'snoozes')
    saveTimer = setTimeout(
      saveNow,
      onlySnoozes ? SNOOZE_DELAY_MS : WRITE_DELAY_MS,
    )
  }
  if (prev.signals !== next.signals) local.set(KEYS.signals, next.signals)
}

// Writes anything waiting now (before leaving, or when a flow ends).
export const flushWrites = saveNow

// Drops writes still waiting (the plugin's data is being removed).
export function cancelWrites() {
  clearTimeout(saveTimer)
  saveTimer = null
  unsaved.clear()
  unsavedSettings.clear()
}

// While the page is being left, requests still in flight are cut off: a
// query, or the last save, whose content the browser mirror keeps for the
// next load to put back (storage/tier1.js). Neither is an error to report.
// Firefox cuts them off when the navigation starts, before pagehide.
let leaving = false

// After a store reset cut a request off, try again this much later: resets
// come in bursts while Stash scans a batch of files.
const RESET_RETRY_MS = 5000

function reportError(e) {
  if (leaving) return
  // Stash reset its store under the request: nothing went wrong
  if (isStoreReset(e)) return
  console.error(`${PLUGIN_ID}:`, e)
  store.set({ error: String(e?.message || e) })
}

async function loadConfig() {
  const { configuration } = await run(Q.CONFIGURATION)
  const box = (configuration.general.stashBoxes || []).find((b) =>
    isStashdbEndpoint(b.endpoint),
  )
  const { map, restored } = await tier1.load()
  store.set({
    ...fromConfig(map),
    configLoaded: true,
    stashdb: box?.api_key
      ? { endpoint: box.endpoint, apiKey: box.api_key }
      : null,
  })
  if (restored) {
    // Put back what the mirror restored, before anything else writes.
    await tier1.save(toConfig(store.get()), Object.keys(toConfig(store.get())))
    store.set({ notice: { kind: 'restored', restored } })
  }
  // Apply bracket ratings automatically starts on unless another plugin
  // manages Stash's ratings, and follows that rule until the user sets it
  const auto = await autoApplyNow(map, configuration.plugins)
  if (auto != null)
    store.set((s) => ({
      settings: { ...s.settings, autoApply: auto },
      autoApplyDefault: auto,
    }))
  // Stash shows a setting nobody has touched as off, and its first click
  // would turn it on. Writing the defaults once makes its switches match.
  const missing = SETTING_KEYS.filter((k) => map?.[k] == null)
  const moved = auto != null && map?.autoApply != null ? ['autoApply'] : []
  const keys = [
    ...missing,
    ...moved,
    ...(auto != null ? ['autoApplyDefault'] : []),
  ]
  if (keys.length) await tier1.save(toConfig(store.get()), keys, moved)
}

// The value to write for autoApply, or null to leave it (storage/settings.js)
async function autoApplyNow(map, configs) {
  try {
    const { plugins } = await run(Q.PLUGINS)
    return autoApplyToWrite({
      value: map?.autoApply,
      wrote: store.get().autoApplyDefault ?? null,
      managed: ratingManagers(plugins, configs).length > 0,
    })
  } catch (e) {
    reportError(e)
    return null
  }
}

// Settings changed on Stash's own page: read them again.
async function reloadSettings() {
  const map = await readPluginMap()
  store.set({ settings: fromConfig(map).settings })
}

let loading = null
export function refreshLibrary(force = false) {
  if (loading) return loading
  loading = loadLibrary({
    run,
    cache,
    force,
    current: store.get().library,
    onProgress: (p) => store.set({ loadProgress: p }),
  })
    .then((library) => {
      const cur = store.get().library
      // A check that found nothing hands back the same lists with new
      // cursors: the model compares the lists and is not built again
      // (runtime/engine.js).
      if (!cur || library.syncedAt !== cur.syncedAt) store.set({ library })
    })
    .catch((e) => {
      if (!isStoreReset(e)) return reportError(e)
      // Cut off by a store reset: check again once the burst has passed
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => refreshLibrary(force), RESET_RETRY_MS)
    })
    .finally(() => (loading = null))
  return loading
}
let retryTimer = null

let booted = false
export function boot() {
  if (booted) return
  booted = true
  store.subscribe(persist)
  window.addEventListener('beforeunload', () => (leaving = true))
  window.addEventListener('pagehide', () => {
    leaving = true
    saveNow()
  })
  // back from the browser's page cache
  window.addEventListener('pageshow', () => (leaving = false))
  onLocation((loc, prev) => {
    if (inSettings(loc)) syncStashCache()
    if (inSettings(prev) && !inSettings(loc)) {
      tier1.flush(toConfig(store.get())).catch(reportError)
      reloadSettings().catch(reportError)
    }
    store.set((s) => ({
      watching: false,
      visit: onFrontPage(loc) ? s.visit + 1 : s.visit,
      recentHidden: onFrontPage(loc) ? [] : s.recentHidden,
    }))
    // Fresh plays show up at the next front-page visit.
    const lib = store.get().library
    if (
      onFrontPage(loc) &&
      lib &&
      Date.now() - Date.parse(lib.syncedAt) > REFRESH_MS
    )
      refreshLibrary()
  })
  if (onFrontPage()) store.set((s) => ({ visit: s.visit + 1 }))
  // The library loads even if the configuration could not be read: the
  // rows then run on the default settings. A configuration read cut off by
  // a store reset is tried again, until it lands.
  const configure = () =>
    loadConfig().catch((e) => {
      if (!isStoreReset(e)) return reportError(e)
      return new Promise((r) => setTimeout(r, RESET_RETRY_MS)).then(configure)
    })
  configure().then(() => refreshLibrary())
}

// After the plugin changes a record in Stash (a gender, a rating, custom
// fields), it patches its copy of the library so the model sees the change at
// once, without waiting for the next refresh.
// patches: a Map of id to fields. Every change to the library rebuilds the
// model (runtime/engine.js), about half a second on a 25,000-scene library,
// so a loop of writes collects its patches and lands them in one update.
function patchLibrary(list, patches) {
  if (!patches.size) return
  store.set((s) => {
    if (!s.library) return null
    const rows = s.library[list].map((r) =>
      patches.has(r.id) ? { ...r, ...patches.get(r.id) } : r,
    )
    return { library: { ...s.library, [list]: rows } }
  })
}
export const patchLibraryScene = (id, fields) =>
  patchLibrary('scenes', new Map([[id, fields]]))
export const patchLibraryPerformer = (id, fields) =>
  patchLibrary('performers', new Map([[id, fields]]))
export const patchLibraryScenes = (patches) => patchLibrary('scenes', patches)
export const patchLibraryPerformers = (patches) =>
  patchLibrary('performers', patches)
