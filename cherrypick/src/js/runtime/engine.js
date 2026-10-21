// The taste model, kept current. Whenever the library, bracket picks, Not
// interested, Don't learn or the switch for other plugins' matches change,
// the model is recomputed off the click
// path (a timeout, so the page that triggered it renders first) and lands in
// the store as `db` (buildDb) and `M` (the engine's answers). Pieces that
// need a score render nothing until `M` is there.
import { store } from './app.js'
import { buildDb } from '../model/db.js'
import { createEngine } from '../model/index.js'
import { modelDecisions } from '../model/brackets.js'
import { KEYS, local } from '../storage/tier3.js'

// Every bracket pick the model learns from: finished brackets and the one in
// progress.
export function allDecisions(state) {
  const out = []
  for (const b of state.brackets.history)
    if (b.decisions) out.push(...modelDecisions(b))
  if (state.brackets.active) out.push(...modelDecisions(state.brackets.active))
  return out
}

// The lists the model was built from. A library check that finds nothing
// hands back the same lists in a new library object, which needs no
// rebuild.
let built = { lists: null, stashdbData: null, db: null, engine: null }
const listsOf = (lib) =>
  lib && [lib.scenes, lib.performers, lib.tags, lib.studios]
const sameLists = (a, b) => !!a && !!b && a.every((x, i) => x === b[i])
let pending = null

// The cross-validation's numbers without its rows, as kept in the browser
const cvSummary = (cv) => {
  if (!cv) return null
  const { rows, ...rest } = cv
  return rest
}

// The cross-validation runs a fold per task after the model is in, so the
// page never waits on its five fits; then the model is computed again (a
// few tens of ms, the fit cached) with the real numbers.
let cvRun = null
function finishCvLater(engine) {
  if (cvRun?.engine === engine) return
  const steps = engine.finishCv()
  cvRun = { engine }
  const run = cvRun
  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(fn, 50)
  const step = () => {
    if (cvRun !== run) return
    const { done, value } = steps.next()
    if (!done) return idle(step)
    cvRun = null
    if (!value || built.engine !== engine) return
    local.set(KEYS.cv, cvSummary(value))
    if (!pending) pending = setTimeout(recompute, 0)
  }
  idle(step)
}

function recompute() {
  pending = null
  const s = store.get()
  if (!s.library) return
  const lists = listsOf(s.library)
  const sameLibrary = sameLists(lists, built.lists)
  if (!sameLibrary || s.stashdbData !== built.stashdbData) {
    const db = buildDb({
      asOf: Date.parse(s.library.syncedAt),
      scenes: s.library.scenes,
      performers: s.library.performers,
      tags: s.library.tags,
      studios: s.library.studios,
      stashdb: s.stashdbData || undefined,
    })
    // Same library, new StashDB data: keep the fit, which reads only the
    // scenes the user owns.
    const reuse = sameLibrary && built.engine
    built = {
      lists,
      stashdbData: s.stashdbData,
      db,
      engine: createEngine(db, {
        ...(reuse ? { fits: built.engine.cache } : {}),
        deferCv: true,
        provisionalCv: local.get(KEYS.cv),
      }),
    }
  }
  const t0 = performance.now()
  const M = built.engine.compute({
    overrides: {},
    performerOverrides: {},
    decisions: allDecisions(s),
    notInterested: s.notInterested,
    dontLearn: s.dontLearn.map((d) => d.sceneId),
    learnFromMatches: !!s.settings.learnFromMatches,
    learnFromRankings: !!s.settings.learnFromRankings,
  })
  store.set({
    db: built.db,
    M,
    modelMs: Math.round(performance.now() - t0),
    // the StashDB data this model was built with (stashdb/layer.js waits
    // for it before showing a page's answers)
    modelStashdb: built.stashdbData,
  })
  if (M.fits.cvPending) finishCvLater(built.engine)
}

// The model as it would be with other bracket picks: the champion screen
// counts the unrated scenes whose Your score one bracket's picks moved.
export function computeWithDecisions(decisions) {
  const s = store.get()
  if (!built.engine || !sameLists(listsOf(s.library), built.lists)) return null
  return built.engine.compute({
    overrides: {},
    performerOverrides: {},
    decisions,
    notInterested: s.notInterested,
    dontLearn: s.dontLearn.map((d) => d.sceneId),
    learnFromMatches: !!s.settings.learnFromMatches,
    learnFromRankings: !!s.settings.learnFromRankings,
  })
}

// The library counts by its lists (sameLists), not the object around them.
const INPUTS = [
  'stashdbData',
  'brackets',
  'notInterested',
  'dontLearn',
]

// Settings the model reads. The settings object is new on every reload from
// Stash, so these are compared one by one.
const SETTINGS = ['learnFromMatches', 'learnFromRankings']

export function keepModelCurrent() {
  store.subscribe((next, prev) => {
    if (
      (next.library === prev.library ||
        sameLists(listsOf(next.library), listsOf(prev.library))) &&
      !INPUTS.some((k) => next[k] !== prev[k]) &&
      !SETTINGS.some((k) => next.settings?.[k] !== prev.settings?.[k])
    )
      return
    if (!pending) pending = setTimeout(recompute, 0)
  })
}
