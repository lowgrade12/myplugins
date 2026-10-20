// A play counts as much as the time behind it (behaviour.js playWeight).
// Stash records a play from a scene's first second, so a swipe past a scene
// in a feed such as Stash TV's is a play in Stash's records, and must not
// teach Cherry Pick what a watch would.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import * as FY from '../../src/js/model/foryou.js'
import { moreLikeThis } from '../../src/js/model/recs.js'
import {
  barelyPlayed,
  behaviourOf,
  playWeight,
  WATCHED_SHARE,
} from '../../src/js/model/behaviour.js'
import { syntheticLibrary, withRecentPlays } from './fixtures/synthetic.mjs'

const DAY = 86400000
const { input } = syntheticLibrary()
const db = buildDb(input)
const STATE = {
  dontLearn: [],
  notInterested: [],
  settings: { excludedTags: '' },
}

// A scene `duration` seconds long with these plays, each [days ago, seconds
// played]
const NOW = Date.parse('2026-10-15T20:00:00Z')
function scene(duration, plays) {
  return {
    duration,
    local: {
      play_count: plays.length,
      play_duration: plays.reduce((t, [, secs]) => t + secs, 0),
      play_history: plays.map(([d]) => new Date(NOW - d * DAY).toISOString()),
      o_counter: 0,
    },
  }
}
const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)

test('a play counts once a tenth of the scene has played', () => {
  const tenth = WATCHED_SHARE * 1800
  assert.equal(playWeight(scene(1800, [])), 0)
  const look = scene(1800, [[0, tenth - 1]])
  assert.equal(playWeight(look), 0)
  assert.equal(behaviourOf(look), null, 'a look has no behaviour score')
  assert.equal(barelyPlayed(look), true)
  // looks on three days are still looks while their time adds up to less
  const looks = scene(1800, [
    [0, 50],
    [2, 50],
    [4, 50],
  ])
  assert.equal(playWeight(looks), 0)
  assert.equal(behaviourOf(looks), null)
  const play = scene(1800, [[0, tenth]])
  assert.equal(playWeight(play), 1)
  assert.equal(behaviourOf(play).rewatchDays, 0)
  // a scene with no length counts as 30 minutes long
  assert.equal(playWeight(scene(0, [[0, tenth]])), 1)
  assert.equal(playWeight(scene(0, [[0, tenth - 1]])), 0)
})

test('plays the time does not pay for count for less, and so do their days', () => {
  // five minutes of a 40-minute scene, then a 20-second swipe past it on
  // four other days: the time pays for 380 / 240 plays of the five
  const s = scene(2400, [
    [8, 300],
    [6, 20],
    [4, 20],
    [2, 20],
    [1, 20],
  ])
  const q = playWeight(s)
  close(q, 380 / 240 / 5, 'each play counts for its share')
  const b = behaviourOf(s)
  assert.equal(b.days, 5)
  close(b.rewatchDays, 5 * q - 1, 'days count for what their plays do')
  assert.ok(b.rewatchDays < 1, 'swipes on other days are no rewatch')
  assert.equal(barelyPlayed(s), true)
  // real rewatches keep every day
  const rewatched = scene(1800, [
    [6, 1800],
    [3, 900],
    [1, 1800],
  ])
  assert.equal(playWeight(rewatched), 1)
  assert.equal(behaviourOf(rewatched).rewatchDays, 2)
  assert.equal(barelyPlayed(rewatched), false)
})

test('plays with no play time count in full', () => {
  // added by hand, or recorded before Stash kept play time
  const s = scene(1800, [
    [5, 0],
    [1, 0],
  ])
  assert.equal(playWeight(s), 1)
  assert.equal(behaviourOf(s).rewatchDays, 1)
})

// Four scenes of one performer that Stash has no play of, added over a month
// ago, so For you's freshness reads them as never watched rather than new
const owned = (id) => db.scenes.get(id)
const oldUnplayed = (id) =>
  !owned(id).local.play_count &&
  db.asOf - Date.parse(owned(id).local.created_at) > FY.FY.newDays * DAY
const performer = [...db.performers.values()].find(
  (p) => p.localId && p.ownedSceneIds.filter(oldUnplayed).length >= 4,
)
const fresh = performer.ownedSceneIds.filter(oldUnplayed).slice(0, 4)
// A week of a feed showing them: seven plays over the four, each for
// `share` of the scene
const feed = (share) =>
  Array.from({ length: 7 }, (_, d) => ({
    sceneId: fresh[d % 4],
    at: db.asOf - (d + 0.5) * DAY,
    share,
  }))
function afterPlays(plays) {
  const dbx = buildDb(withRecentPlays(input, plays))
  const Mx = createEngine(dbx).compute({})
  return { dbx, Mx, ctx: FY.context(Mx, STATE) }
}

test('a feed swiped past teaches For you and Your score nothing', () => {
  const swiped = afterPlays(feed(0.03))
  const watched = afterPlays(feed(1))
  const none = afterPlays([])
  const key = 'p:' + performer.id

  // watching them all the way through is momentum, swiping past is not
  assert.equal(watched.ctx.mom.feat.get(key)?.scenes.size, 4)
  assert.equal(swiped.ctx.mom.feat.get(key), undefined)
  assert.equal(swiped.ctx.mom.count, none.ctx.mom.count)
  assert.equal(swiped.ctx.rewatch, none.ctx.rewatch)
  assert.deepEqual(
    FY.followRows(swiped.ctx, FY.EMPTY_SIGNALS, []).map((r) => r.id),
    FY.followRows(none.ctx, FY.EMPTY_SIGNALS, []).map((r) => r.id),
  )

  // Stash has plays of each, but they are looks: never watched
  for (const id of fresh) {
    const s = swiped.dbx.scenes.get(id)
    assert.ok(s.local.play_count >= 1, 'Stash recorded the swipes')
    assert.equal(behaviourOf(s), null)
    const f = FY.freshnessFor(swiped.ctx, s)
    assert.equal(f.kind, 'never')
    assert.equal(f.looked, true)
    assert.equal(
      FY.freshnessFor(none.ctx, none.dbx.scenes.get(id)).looked,
      false,
    )
  }

  // Your score learns nothing from them
  for (const s of none.dbx.owned)
    assert.equal(
      swiped.Mx.prediction(s.id).value,
      none.Mx.prediction(s.id).value,
      s.id,
    )
})

test('a scene only looked at is "not watched yet", one never played "never played"', () => {
  const swiped = afterPlays(feed(0.03))
  const reasons = (M, ctx, id) => [
    FY.reasonFor(ctx, {
      ...FY.rankedScenes(ctx, FY.EMPTY_SIGNALS).find((x) => x.scene.id === id),
    }),
    ...fresh
      .filter((other) => other !== id)
      .flatMap(
        (other) => moreLikeThis(M, STATE, M.db.scenes.get(other)).inLibrary,
      )
      .filter((it) => it.scene.id === id)
      .map((it) => it.reason),
  ]
  const none = afterPlays([])
  for (const id of fresh) {
    for (const r of reasons(swiped.Mx, swiped.ctx, id)) {
      assert.doesNotMatch(r, /never played/i, r)
      assert.match(r, /Not watched yet|not watched yet$/, r)
    }
    for (const r of reasons(none.Mx, none.ctx, id))
      assert.match(r, /Never played|never played$/, r)
  }
})
