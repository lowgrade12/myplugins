// Watch This: one scene ready to play in place of Cherry Pick's front-page
// rows (features/watchThis.jsx). The pick is For you's own order before
// variety and exploration (taste, momentum and freshness), over the scenes
// you own whose file has a picture; Watch This has no exploration slots. A
// library under 30 scenes plays the newest, the one New in your library
// would put first. Skip snoozes the scene on screen and Back undoes it
// (runtime/watchThis.js); the snoozes live in tier 1, so a skip holds on
// every device.
import {
  allowed,
  newInLibrary,
  rankedScenes,
  reasonFor,
  tooSmall,
} from './foryou.js'
import { timeAgo } from './util.js'
import { WATCHED_SHARE } from './behaviour.js'

// A scene Watch This can play: its first file has video. An audio-only file
// (no video codec, a width of 0) and a scene with no file have none.
export const playable = (s) => !!s.hasVideo

/**
 * One scene Watch This could play.
 * @typedef {object} WatchItem
 * @property {import('./db.js').Scene} scene
 * @property {() => string} reason  the line's reason, worked out when shown
 */

// Every scene Watch This could play this visit, best first.
// signals: the visit's For you signals (visitSignals), which it reads and
// never changes.
/** @returns {WatchItem[]} */
export function watchOrder(ctx, signals) {
  if (tooSmall(ctx.db)) return newestOrder(ctx)
  return rankedScenes(ctx, signals, playable).map((x) => ({
    scene: x.scene,
    reason: () => reasonFor(ctx, x),
  }))
}

// A small library: New in your library's order, then the scenes it leaves
// out (rated under 3 stars, or played in the last two weeks), newest first,
// so a library with any scene that has video has one to play.
function newestOrder(ctx) {
  const first = newInLibrary(ctx, { keep: playable, size: Infinity })
  const seen = new Set(first.map((it) => it.scene.id))
  const rest = ctx.db.owned
    .filter((s) => playable(s) && allowed(ctx, s) && !seen.has(s.id))
    .sort((a, b) => b.local.created_at.localeCompare(a.local.created_at))
  return [
    ...first.map((it) => ({ scene: it.scene, reason: () => it.reason })),
    ...rest.map((s) => ({
      scene: s,
      reason: () => `Added ${timeAgo(s.local.created_at, ctx.now)}`,
    })),
  ]
}

// ---------------------------------------------------------------- snoozes

// A skip means "not in the mood": it snoozes the scene and teaches the
// model nothing. Each scene has one ladder, climbed one step per skip while
// no play comes in between: 48 hours, then a week, then 30 days for every
// later step. A snooze counts hours from the moment of the skip.
const HOUR = 3600000
export const LADDER_HOURS = [48, 7 * 24, 30 * 24]
export const stepLength = (step) =>
  LADDER_HOURS[Math.min(step, LADDER_HOURS.length) - 1] * HOUR
// Past this many entries, the ones whose snooze ended longest ago go.
export const MAX_SNOOZES = 300
// A pick ignored on this many days (shown, neither started nor skipped)
// steps up the ladder as a skip would.
export const IGNORED_DAYS = 3
// What Stash records of the look before a skip lands as the next pick
// loads: Stash counts a play from the first second at its default minimum
// play percent (docs/stash-seams.md). A play recorded this long after a
// snooze last changed is a play of its own, and resets the ladder.
export const LOOK_MS = 2 * 60 * 1000
// A pick that played for a tenth of its length before its skip
// (WATCHED_SHARE, the line the model draws between a look and a play) was
// watched, not looked at: the skip starts its ladder again, at the first
// step. Play time counts the seconds the player spent playing, as Stash's
// own play tracking does, not how far into the scene it got.
export const watchedEnough = (playedSeconds, duration) =>
  duration > 0 && playedSeconds >= WATCHED_SHARE * duration

/**
 * One scene's place on the ladder, as tier 1 keeps it (the `snoozes` key).
 * @typedef {object} Snooze
 * @property {string} id  the scene's Stash id
 * @property {number} step  0 (only ignored so far), then 1, 2, 3...
 * @property {number} until  when the snooze ends, in ms (0 for step 0)
 * @property {number} at  when the entry last changed, in ms: a play
 *   recorded after it (LOOK_MS on) resets the ladder
 * @property {number} ignored  days the scene was ignored since its last
 *   step or play
 * @property {string|null} ignoredDay  the last day it was counted
 *   ignored, the browser's calendar day (YYYY-MM-DD)
 */

const entryOf = (snoozes, id) => snoozes.find((e) => e.id === id) || null
const without = (snoozes, id) => snoozes.filter((e) => e.id !== id)
const stepUp = (cur, id, now) => {
  const step = (cur?.step || 0) + 1
  return { id, step, until: now + stepLength(step), at: now }
}

// The ladder after Stash's plays: a scene played since its entry last
// changed starts again, with no step and no ignored days. scenes: db.scenes
// (a Map by id), each with Stash's play_history.
export function settle(snoozes, scenes) {
  const out = snoozes.filter((e) => {
    const s = scenes.get(e.id)
    if (!s?.local) return true
    return !s.local.play_history.some((t) => Date.parse(t) > e.at + LOOK_MS)
  })
  return out.length === snoozes.length ? snoozes : out
}

// Keeps the ladder to MAX_SNOOZES entries, dropping those whose snooze
// ended longest ago (an entry with only ignored days counts from when it
// last changed).
export function capped(snoozes) {
  if (snoozes.length <= MAX_SNOOZES) return snoozes
  const ended = (e) => Math.max(e.until || 0, e.at || 0)
  const keep = new Set(
    [...snoozes]
      .sort((a, b) => ended(b) - ended(a))
      .slice(0, MAX_SNOOZES)
      .map((e) => e.id),
  )
  return snoozes.filter((e) => keep.has(e.id))
}

// Skip: the scene one step up the ladder, or, when it was watched
// (watchedEnough), back on the first step with no ignored days, so it
// still sleeps 48 hours. Returns the new list and the entry as it was, for
// Back to put back.
export function skipScene(snoozes, id, now, { watched = false } = {}) {
  const prev = entryOf(snoozes, id)
  const next = watched
    ? { ...stepUp(null, id, now), ignored: 0, ignoredDay: null }
    : {
        ...stepUp(prev, id, now),
        ignored: prev?.ignored || 0,
        ignoredDay: prev?.ignoredDay || null,
      }
  return { snoozes: capped([...without(snoozes, id), next]), prev }
}

// Back: the entry as it was before the skip (none, if it had none). Its
// clock restarts, so what Stash recorded of the look before the skip
// resets nothing; a play from here on does.
export function unskipScene(snoozes, id, prev, now) {
  const rest = without(snoozes, id)
  return prev ? [...rest, { ...prev, at: now }] : rest
}

// A pick left on screen for a visit, neither started nor skipped: one
// ignored day, at most one a day; the third steps it up the ladder and
// starts the count again. An ignored day leaves the entry's clock where it
// was, so a play since its last step still resets it. day: the browser's
// calendar day.
export function ignoreScene(snoozes, id, now, day) {
  const cur = entryOf(snoozes, id)
  if (cur?.ignoredDay === day) return snoozes
  const ignored = (cur?.ignored || 0) + 1
  const next =
    ignored >= IGNORED_DAYS
      ? { ...stepUp(cur, id, now), ignored: 0, ignoredDay: day }
      : {
          id,
          step: cur?.step || 0,
          until: cur?.until || 0,
          at: cur?.at ?? now,
          ignored,
          ignoredDay: day,
        }
  return capped([...without(snoozes, id), next])
}

// The scene to show: the first in order that is not snoozed and shares no
// performer with a scene skipped this visit; without the performer rule
// when none is left; and when every scene is snoozed, the one whose snooze
// ends soonest. skipped: the scenes skipped this visit.
export function nextPick(order, snoozes, skipped, now) {
  if (!order.length) return null
  const ends = new Map(
    snoozes.filter((e) => e.until > now).map((e) => [e.id, e.until]),
  )
  const free = order.filter((it) => !ends.has(it.scene.id))
  const avoid = new Set(skipped.flatMap((s) => s.performers.map((p) => p.id)))
  return (
    free.find((it) => !it.scene.performers.some((p) => avoid.has(p.id))) ||
    free[0] ||
    [...order].sort((a, b) => ends.get(a.scene.id) - ends.get(b.scene.id))[0]
  )
}
