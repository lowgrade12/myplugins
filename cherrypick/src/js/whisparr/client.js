// Whisparr, through the Whisparr Update plugin. Cards for StashDB scenes the
// user does not own can add one to Whisparr and start a search, and show
// whether Whisparr has it. Cherry Pick never talks to Whisparr itself: it
// asks Whisparr Update (plugins/whisparrUpdate) with Stash's
// runPluginOperation, so Whisparr's URL and API key stay in that plugin's
// settings on the server, and no browser request crosses to Whisparr.
//
// The states, by StashDB scene id, live in a store of their own: a card's
// lookup landing redraws that card, nothing else of the plugin's.
import { run, runMutation } from '../runtime/app.js'
import { createStore, useStoreValue } from '../runtime/store.js'
import { PLUGINS } from '../data/queries.js'
import { React } from '../runtime/api.js'
import { isStoreReset } from '../runtime/storeReset.js'

export const WHISPARR_PLUGIN = 'whisparrUpdate'

const OPERATION = `
  mutation CherryPickWhisparr($args: Map) {
    runPluginOperation(plugin_id: "${WHISPARR_PLUGIN}", args: $args)
  }
`

// Lookups wait this long for the page's other cards, then go as one
const BATCH_MS = 60
// and at most this many in one operation (the plugin's own cap)
const BATCH_MAX = 50
// After a store reset cut a request off, try again this much later
const RESET_RETRY_MS = 5000

// { available: null|boolean, scenes: { [stashId]: State } }, a State being
//   { kind: 'loading' }
//   { kind: 'none' }                       not in Whisparr
//   { kind: 'have', id, monitored, hasFile }
//   { kind: 'adding' }
//   { kind: 'error', error }
export const whisparr = createStore({ available: null, scenes: {} })

const setScene = (id, state) =>
  whisparr.set((s) => ({ scenes: { ...s.scenes, [id]: state } }))
const setScenes = (states) =>
  whisparr.set((s) => ({ scenes: { ...s.scenes, ...states } }))

// The plugin's answer: Stash hands back what the script printed as output
async function operation(args) {
  const data = await runMutation(OPERATION, { args })
  const out = data?.runPluginOperation
  if (!out || typeof out !== 'object') throw new Error('No answer from Whisparr Update')
  if (!out.ok) throw new Error(out.error || 'Whisparr Update failed')
  return out.result
}

const toState = (m) => (m ? { kind: 'have', ...m } : { kind: 'none' })

// Whether Whisparr Update is installed and enabled, asked once per load
let availability = null
export function checkAvailable() {
  availability ||= run(PLUGINS)
    .then(({ plugins }) =>
      (plugins || []).some((p) => p.id === WHISPARR_PLUGIN && p.enabled),
    )
    .catch((e) => {
      // Cut off by a store reset: ask again shortly, not never
      if (isStoreReset(e)) {
        availability = null
        setTimeout(checkAvailable, RESET_RETRY_MS)
        return null
      }
      return false
    })
    .then((available) => {
      if (available == null) return null
      whisparr.set({ available })
      return available
    })
  return availability
}

let queue = new Set()
let timer = null

function flush() {
  timer = null
  const ids = [...queue].slice(0, BATCH_MAX)
  ids.forEach((id) => queue.delete(id))
  if (queue.size) timer = setTimeout(flush, 0)
  operation({ mode: 'status', stash_ids: ids })
    .then((result) =>
      setScenes(
        Object.fromEntries(ids.map((id) => [id, toState(result?.[id])])),
      ),
    )
    .catch((e) => {
      if (isStoreReset(e)) {
        // Cut off by a store reset: forget these and look them up again
        whisparr.set((s) => {
          const scenes = { ...s.scenes }
          ids.forEach((id) => delete scenes[id])
          return { scenes }
        })
        setTimeout(() => ids.forEach(requestStatus), RESET_RETRY_MS)
        return
      }
      setScenes(
        Object.fromEntries(
          ids.map((id) => [id, { kind: 'error', error: String(e.message || e) }]),
        ),
      )
    })
}

// Looks a scene up, once per load, batched with the page's other cards
export function requestStatus(stashId) {
  if (!stashId || whisparr.get().scenes[stashId]) return
  setScene(stashId, { kind: 'loading' })
  queue.add(stashId)
  timer ??= setTimeout(flush, BATCH_MS)
}

// Adds the scene to Whisparr, monitored, and starts a search (or, already
// there, monitors it and searches again)
export async function addToWhisparr(stashId, title) {
  const before = whisparr.get().scenes[stashId]
  setScene(stashId, { kind: 'adding' })
  try {
    const result = await operation({ mode: 'add', stash_id: stashId, title })
    setScene(stashId, toState(result))
    return result
  } catch (e) {
    setScene(stashId, { kind: 'error', error: String(e.message || e), before })
    throw e
  }
}

// A card's view of one scene: null while Whisparr Update is unknown or not
// there (the card shows nothing), else its state, looked up on first use.
export function useWhisparrScene(stashId) {
  const available = useStoreValue(whisparr, (s) => s.available)
  const state = useStoreValue(whisparr, (s) => s.scenes[stashId] || null)
  React.useEffect(() => {
    checkAvailable()
  }, [])
  React.useEffect(() => {
    if (available && stashId) requestStatus(stashId)
  }, [available, stashId])
  if (!available || !stashId) return null
  return state || { kind: 'loading' }
}
