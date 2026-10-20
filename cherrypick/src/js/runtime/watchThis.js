// Watch This's visit to the front page: the order of the scenes it could
// play, worked out once per visit, the pick on screen, the visit's skips for
// Back, and whether the pick was started. Skip and Back change the snoozes
// (tier 1) and the pick. Leaving the front page with a pick neither started
// nor skipped counts it ignored for the day. None of it touches the taste
// model, ratings, Not interested or For you's signals.
import { store } from './app.js'
import { onFrontPage, onLocation } from './location.js'
import { context, visitSignals } from '../model/foryou.js'
import { localDay } from '../model/util.js'
import {
  ignoreScene,
  nextPick,
  settle,
  skipScene,
  unskipScene,
  watchedEnough,
  watchOrder,
} from '../model/watch.js'

let snap = null

// The pick on screen's play time, in ms: the time the player spent
// playing it, as Stash's own play tracking counts it, seeks and buffering
// aside (runtime/watching.js reports the player's events). It starts again
// with each pick.
let playedMs = 0
let playingSince = null

export function pickPlaying(on) {
  if (on) playingSince ??= Date.now()
  else if (playingSince != null) {
    playedMs += Date.now() - playingSince
    playingSince = null
  }
}
const playedSeconds = () =>
  (playedMs + (playingSince != null ? Date.now() - playingSince : 0)) / 1000
function newPick() {
  playedMs = 0
  playingSince = null
}

const keyOf = (s) => [s.visit, JSON.stringify(s.settings)].join('|')

// The visit's order and first pick, worked out when the front page opens
// with a model and held for the visit. The snoozes are settled against
// Stash's plays first: a scene played since its last skip starts its ladder
// again. The visit reads For you's signals and stores nothing back.
export function watchSnapshot(s) {
  if (!s.M || !s.configLoaded) return null
  const key = keyOf(s)
  if (snap?.key === key) return snap
  const skip = new Set(s.dontLearn.map((d) => d.sceneId))
  const order = watchOrder(context(s.M, s), visitSignals(s.signals, skip))
  const { scenes } = s.M.db
  const snoozes = settle(s.snoozes, scenes)
  newPick()
  snap = {
    key,
    order,
    byId: new Map(order.map((it) => [it.scene.id, it])),
    first: nextPick(order, snoozes, [], Date.now())?.scene.id ?? null,
  }
  if (snoozes !== s.snoozes)
    setTimeout(() =>
      store.set((x) => {
        const settled = settle(x.snoozes, scenes)
        return settled === x.snoozes ? null : { snoozes: settled }
      }),
    )
  return snap
}

// The visit as it stands: the pick on screen (a scene id, or null when
// there is nothing to play), the skips Back can undo, newest last, each
// with the scene's snooze from before it, and whether the pick was started.
export function visitState(s, v = snap?.key === keyOf(s) ? snap : null) {
  if (!v) return null
  if (s.watchVisit?.key === v.key) return s.watchVisit
  return { key: v.key, current: v.first, skips: [], started: false }
}

// Skip: the pick on screen one step up its ladder, or back to its first
// step when it played for a tenth of its length or more (watchedEnough),
// and the next pick: the best scene not snoozed that shares no performer
// with the visit's skipped scenes (model/watch.js nextPick).
export function skip() {
  const s = store.get()
  const v = watchSnapshot(s)
  const cur = visitState(s, v)
  if (!cur?.current) return
  const now = Date.now()
  const watched = watchedEnough(
    playedSeconds(),
    v.byId.get(cur.current)?.scene.duration,
  )
  newPick()
  const { snoozes, prev } = skipScene(s.snoozes, cur.current, now, {
    watched,
  })
  const skips = [...cur.skips, { id: cur.current, prev }]
  const skipped = skips.map((k) => v.byId.get(k.id)?.scene).filter(Boolean)
  const next = nextPick(v.order, snoozes, skipped, now)
  store.set({
    snoozes,
    watchVisit: {
      ...cur,
      current: next?.scene.id ?? null,
      skips,
      started: false,
    },
  })
}

// Back: the scene skipped last this visit, on screen again, with its snooze
// as it was before the skip.
export function back() {
  const s = store.get()
  const cur = visitState(s)
  const last = cur?.skips[cur.skips.length - 1]
  if (!last) return
  newPick()
  store.set({
    snoozes: unskipScene(s.snoozes, last.id, last.prev, Date.now()),
    watchVisit: {
      ...cur,
      current: last.id,
      skips: cur.skips.slice(0, -1),
      started: false,
    },
  })
}

// The pick on screen started playing (runtime/watching.js).
export function pickStarted() {
  const s = store.get()
  const cur = visitState(s)
  if (cur && !cur.started) store.set({ watchVisit: { ...cur, started: true } })
}

// The visit ends, by leaving the front page or the page itself: a pick
// that was on screen and neither started nor skipped counts one ignored
// day. Once per visit.
function endVisit() {
  const s = store.get()
  const cur = visitState(s)
  if (!s.settings.watchThis || !cur || cur.ended) return
  store.set({ watchVisit: { ...cur, ended: true } })
  if (!cur.current || cur.started) return
  const now = Date.now()
  store.set((x) => ({
    snoozes: ignoreScene(x.snoozes, cur.current, now, localDay(now)),
  }))
}

// Registered when the bundle loads, ahead of boot's own listeners, so the
// count is in the store before the page's last save (runtime/app.js).
onLocation((loc, prev) => {
  if (onFrontPage(prev) && !onFrontPage(loc)) endVisit()
})
window.addEventListener('pagehide', () => {
  if (onFrontPage()) endVisit()
})
