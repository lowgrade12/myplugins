// Behaviour score: how much someone seems to like a scene from what they did
// with it, using only fields Stash already stores on every scene:
// play_duration / duration (watch-through), play_history (rewatches on
// separate days) and o_counter. Mapped to 0..1. Never-played scenes have none.

import { localDay } from './util.js'

// A play counts as much as the time behind it. At its default Minimum Play
// Percent of 0, Stash records a play from a scene's first second, so a swipe
// past a scene in a feed such as Stash TV's is a play like a full watch.
// Each tenth of a scene's length played pays for one play, Watch This's line
// between a look and a watch (watch.js): a scene played for less than that
// in all was only looked at and counts as never played, and when its time
// pays for fewer plays than Stash records, each play counts for that share.
export const WATCHED_SHARE = 0.1

// What each of a scene's plays counts for, 0..1: 0 for a scene never played
// or only looked at, 1 when its play time pays for every play. Plays with no
// play time at all count in full: added by hand, or recorded before Stash
// kept play time, they say nothing about how long.
export function playWeight(scene) {
  const l = scene.local
  if (!l || !l.play_count) return 0
  if (!l.play_duration) return 1
  const paid = l.play_duration / (WATCHED_SHARE * (scene.duration || 1800))
  return paid < 1 ? 0 : Math.min(1, paid / l.play_count)
}

// Worked out once per scene: the fit, the predictions, For you and More like
// this all ask, and counting days formats every play, which was a fifth of
// the time on a 10,000-scene library. Keyed on `local`, the Stash fields it
// reads, which the database never changes (db.js).
const cache = new WeakMap()

export function behaviourOf(scene) {
  const l = scene.local
  if (!l || !l.play_count) return null
  if (cache.has(l)) return cache.get(l)
  const weight = playWeight(scene)
  let b = null
  if (weight) {
    const duration = scene.duration || 1800
    const watchThrough = Math.min(1, l.play_duration / duration) // capped: rewatches don't push it past 1
    const days = new Set(l.play_history.map(localDay)).size
    // each day counts for what its plays do
    const rewatchDays = Math.max(0, days * weight - 1)
    const o = l.o_counter || 0
    const score =
      0.5 * watchThrough +
      0.3 * (1 - Math.exp(-rewatchDays / 2)) +
      0.2 * (1 - Math.exp(-o / 1.5))
    b = { score, watchThrough, days, rewatchDays, o, plays: l.play_count }
  }
  cache.set(l, b)
  return b
}

// "Barely played": never played, only looked at, or played on one day only
// (each day counting for what its plays do) and not all the way through
export function barelyPlayed(scene) {
  const b = behaviourOf(scene)
  if (!b) return true
  return b.rewatchDays < 1 && b.watchThrough < 0.9
}
