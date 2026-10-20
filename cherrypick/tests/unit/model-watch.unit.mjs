import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import * as FY from '../../src/js/model/foryou.js'
import * as W from '../../src/js/model/watch.js'
import { playable, watchOrder } from '../../src/js/model/watch.js'
import { syntheticLibrary } from './fixtures/synthetic.mjs'

const STATE = {
  dontLearn: [],
  notInterested: [],
  settings: { excludedTags: '' },
}
const { input } = syntheticLibrary()

function setUp(scenes = input.scenes, state = STATE) {
  const db = buildDb({ ...input, scenes })
  const M = createEngine(db).compute({})
  return { db, M, ctx: FY.context(M, state) }
}
const ids = (list) => list.map((it) => it.scene.id)

// The first file as Stash reports an audio-only one, or no file at all
const audioOnly = (s) => ({
  ...s,
  files: [{ ...s.files[0], video_codec: '', width: 0, height: 0 }],
})
const noFile = (s) => ({ ...s, files: [] })
const withVideo = (s) => ({
  ...s,
  files: [{ ...s.files[0], video_codec: 'h264', width: 1920, height: 1080 }],
})

test("Watch This plays For you's first card, with its reason", () => {
  const { ctx } = setUp()
  const fy = FY.computeForYou(ctx, FY.EMPTY_SIGNALS)
  const order = watchOrder(ctx, FY.EMPTY_SIGNALS)
  assert.equal(fy[0].kind, 'main')
  assert.equal(order[0].scene.id, fy[0].scene.id)
  assert.equal(order[0].reason(), fy[0].reason)
})

test("the order is For you's score before variety and exploration, every scene with video", () => {
  const { ctx } = setUp()
  const ranked = FY.rankedScenes(ctx, FY.EMPTY_SIGNALS, playable)
  for (let i = 1; i < ranked.length; i++)
    assert.ok(ranked[i - 1].base >= ranked[i].base, 'highest first')
  const order = watchOrder(ctx, FY.EMPTY_SIGNALS)
  assert.deepEqual(
    ids(order),
    ranked.map((x) => x.scene.id),
  )
  assert.equal(order.length, ctx.db.owned.length)
  // no cap per performer: For you's row takes two of a performer at most,
  // the order takes them as they score
  const fyIds = new Set(ids(FY.computeForYou(ctx, FY.EMPTY_SIGNALS)))
  assert.ok(ids(order.slice(0, 12)).some((id) => !fyIds.has(id)))
  for (const it of order.slice(0, 20)) assert.match(it.reason(), /^[A-Z].{8,}/)
})

test('audio-only files and scenes with no file stay out', () => {
  const scenes = input.scenes.map((s, i) =>
    i % 3 === 0 ? audioOnly(s) : i % 3 === 1 ? noFile(s) : withVideo(s),
  )
  const { ctx, db } = setUp(scenes)
  const order = watchOrder(ctx, FY.EMPTY_SIGNALS)
  assert.equal(order.length, scenes.length - Math.ceil(scenes.length * (2 / 3)))
  for (const it of order) {
    assert.equal(it.scene.hasVideo, true)
    assert.notEqual(it.scene.audioOnly, true)
  }
  assert.equal(db.owned.filter((s) => s.audioOnly).length, 40)
})

test('Not interested and the tags kept out of picks stay out', () => {
  const { ctx } = setUp()
  const first = watchOrder(ctx, FY.EMPTY_SIGNALS)[0].scene
  const tag = first.tags[0]
  const state = {
    ...STATE,
    notInterested: [{ sceneId: first.id, key: null }],
    settings: { excludedTags: tag.name },
  }
  const { ctx: kept } = setUp(input.scenes, state)
  const order = watchOrder(kept, FY.EMPTY_SIGNALS)
  assert.ok(order.length > 0)
  for (const it of order) {
    assert.notEqual(it.scene.id, first.id)
    assert.ok(!it.scene.tags.some((t) => t.id === tag.id))
  }
})

test('a library under 30 scenes plays the newest scene with video, as New in your library would', () => {
  const small = syntheticLibrary({ scenes: 29 }).input
  const scenes = small.scenes.map((s, i) => (i % 4 === 0 ? audioOnly(s) : s))
  const db = buildDb({ ...small, scenes })
  const M = createEngine(db).compute({})
  const ctx = FY.context(M, STATE)
  assert.equal(FY.tooSmall(db), true)
  const order = watchOrder(ctx, FY.EMPTY_SIGNALS)
  const row = FY.newInLibrary(ctx).filter((it) => playable(it.scene))
  assert.equal(order[0].scene.id, row[0].scene.id)
  assert.equal(order[0].reason(), row[0].reason)
  // every scene with video, the ones New in your library leaves out last
  assert.equal(order.length, db.owned.filter(playable).length)
  assert.equal(new Set(ids(order)).size, order.length)

  // rated under 3 stars or played this fortnight: still the newest plays
  const disliked = scenes.map((s) => ({ ...s, rating100: 20 }))
  const dbd = buildDb({ ...small, scenes: disliked })
  const ctxd = FY.context(createEngine(dbd).compute({}), STATE)
  assert.equal(FY.newInLibrary(ctxd).length, 0)
  const newest = dbd.owned
    .filter(playable)
    .sort((a, b) => b.local.created_at.localeCompare(a.local.created_at))[0]
  const first = watchOrder(ctxd, FY.EMPTY_SIGNALS)[0]
  assert.equal(first.scene.id, newest.id)
  assert.match(first.reason(), /^Added /)
})

test('a library with no scene that has video has nothing to play', () => {
  const { ctx } = setUp(input.scenes.map(audioOnly))
  assert.deepEqual(watchOrder(ctx, FY.EMPTY_SIGNALS), [])
  const small = syntheticLibrary({ scenes: 20 }).input
  const db = buildDb({ ...small, scenes: small.scenes.map(noFile) })
  const ctxs = FY.context(createEngine(db).compute({}), STATE)
  assert.deepEqual(watchOrder(ctxs, FY.EMPTY_SIGNALS), [])
})

// ---------------------------------------------------------------- snoozes

const HOUR = 3600000
const T0 = Date.parse('2026-10-18T23:50:00Z')

// A tiny order of scenes, each with its performers
const scene = (id, ...performers) => ({
  scene: { id, performers: performers.map((p) => ({ id: p })) },
  reason: () => '',
})
// db.scenes as settle reads it: Stash's plays by scene
const played = (entries) =>
  new Map(
    Object.entries(entries).map(([id, times]) => [
      id,
      { local: { play_history: times.map((t) => new Date(t).toISOString()) } },
    ]),
  )

test('each skip climbs one step: 48 hours, a week, then 30 days', () => {
  let snoozes = []
  const lengths = []
  let now = T0
  for (let i = 0; i < 5; i++) {
    ;({ snoozes } = W.skipScene(snoozes, 'a', now))
    const e = snoozes.find((x) => x.id === 'a')
    assert.equal(e.step, i + 1)
    lengths.push((e.until - now) / HOUR)
    now = e.until + HOUR
  }
  assert.deepEqual(lengths, [48, 168, 720, 720, 720])
  // counted in hours from the skip: a skip at 11:50 pm lasts two full days
  const { snoozes: late } = W.skipScene([], 'a', T0)
  assert.equal(late[0].until, T0 + 48 * HOUR)
})

test('a play recorded after the skip starts the ladder again; the look before the skip does not', () => {
  let { snoozes } = W.skipScene([], 'a', T0)
  ;({ snoozes } = W.skipScene(snoozes, 'a', T0 + 50 * HOUR))
  const at = T0 + 50 * HOUR
  // the look before the skip: played before it, or recorded as it lands
  assert.equal(
    W.settle(snoozes, played({ a: [at - 30 * 1000, at + 5 * 1000] })),
    snoozes,
  )
  // a play of its own, later
  assert.deepEqual(W.settle(snoozes, played({ a: [at + 3 * HOUR] })), [])
  // the next skip starts again at the first step
  const { snoozes: again } = W.skipScene([], 'a', at + 4 * HOUR)
  assert.equal(again[0].step, 1)
  // a scene the library no longer has keeps its entry
  assert.equal(W.settle(snoozes, new Map()), snoozes)
})

test('Back puts the step and the snooze end back as they were', () => {
  const first = W.skipScene([], 'a', T0).snoozes
  const before = first.find((e) => e.id === 'a')
  const now = T0 + 60 * HOUR
  const { snoozes, prev } = W.skipScene(first, 'a', now)
  assert.equal(snoozes.find((e) => e.id === 'a').step, 2)
  const back = W.unskipScene(snoozes, 'a', prev, now + 1000)
  const e = back.find((x) => x.id === 'a')
  assert.equal(e.step, before.step)
  assert.equal(e.until, before.until)
  // its clock restarts: the look before the skip resets nothing
  assert.deepEqual(W.settle(back, played({ a: [now + 2000] })), back)
  // a scene with no entry before its skip has none after Back
  const once = W.skipScene([], 'b', T0)
  assert.deepEqual(W.unskipScene(once.snoozes, 'b', once.prev, T0 + 1), [])
})

test('Skip, Back and Skip on the same scene moves it one step', () => {
  const s1 = W.skipScene([], 'a', T0)
  const b = W.unskipScene(s1.snoozes, 'a', s1.prev, T0 + 1000)
  const s2 = W.skipScene(b, 'a', T0 + 2000)
  assert.equal(s2.snoozes.length, 1)
  assert.equal(s2.snoozes[0].step, 1)
  assert.equal(s2.snoozes[0].until, T0 + 2000 + 48 * HOUR)
})

test("the next pick shares no performer with the visit's skipped scenes, until none is left", () => {
  const order = [
    scene('a', 'p1', 'p2'),
    scene('b', 'p2'),
    scene('c', 'p3'),
    scene('d', 'p1', 'p4'),
  ]
  const { snoozes } = W.skipScene([], 'a', T0)
  assert.equal(W.nextPick(order, [], [], T0).scene.id, 'a')
  // b shares p2 with a, so c comes first
  assert.equal(W.nextPick(order, snoozes, [order[0].scene], T0).scene.id, 'c')
  // c skipped too: b and d share a performer with a; the rule lifts
  const both = W.skipScene(snoozes, 'c', T0).snoozes
  assert.equal(
    W.nextPick(order, both, [order[0].scene, order[2].scene], T0).scene.id,
    'b',
  )
})

test('when every scene is snoozed, the one whose snooze ends soonest plays', () => {
  const order = [scene('a', 'p1'), scene('b', 'p2'), scene('c', 'p3')]
  let snoozes = W.skipScene([], 'a', T0).snoozes
  snoozes = W.skipScene(snoozes, 'a', T0 + 1).snoozes // a week
  snoozes = W.skipScene(snoozes, 'b', T0 + 2).snoozes // 48 hours
  snoozes = W.skipScene(snoozes, 'c', T0 + 3).snoozes // 48 hours, later
  const skipped = order.map((it) => it.scene)
  assert.equal(W.nextPick(order, snoozes, skipped, T0 + 10).scene.id, 'b')
  // once b's snooze ends it is free again
  assert.equal(W.nextPick(order, snoozes, [], T0 + 2 + 48 * HOUR).scene.id, 'b')
  assert.equal(W.nextPick([], snoozes, [], T0), null)
})

test('an ignored pick counts once a day and steps up on the third day', () => {
  const day = (n) => `2026-10-${18 + n}`
  let snoozes = W.ignoreScene([], 'a', T0, day(0))
  assert.deepEqual(
    snoozes.map(({ step, ignored, until }) => ({ step, ignored, until })),
    [{ step: 0, ignored: 1, until: 0 }],
  )
  // the same day again counts nothing
  assert.equal(W.ignoreScene(snoozes, 'a', T0 + HOUR, day(0)), snoozes)
  snoozes = W.ignoreScene(snoozes, 'a', T0 + 24 * HOUR, day(1))
  assert.equal(snoozes[0].ignored, 2)
  assert.equal(snoozes[0].until, 0, 'not snoozed yet')
  const now = T0 + 48 * HOUR
  snoozes = W.ignoreScene(snoozes, 'a', now, day(2))
  assert.equal(snoozes[0].step, 1)
  assert.equal(snoozes[0].until, now + 48 * HOUR)
  assert.equal(snoozes[0].ignored, 0, 'the count starts again')
  // a play clears the ignored days with the ladder
  const counted = W.ignoreScene([], 'b', T0, day(0))
  assert.deepEqual(W.settle(counted, played({ b: [T0 + 5 * HOUR] })), [])
})

test('past 300 entries, the ones whose snooze ended longest ago go', () => {
  let snoozes = []
  for (let i = 0; i < 305; i++)
    snoozes = W.skipScene(snoozes, `s${i}`, T0 + i * HOUR).snoozes
  assert.equal(snoozes.length, W.MAX_SNOOZES)
  const ids = new Set(snoozes.map((e) => e.id))
  for (let i = 0; i < 5; i++) assert.ok(!ids.has(`s${i}`), `s${i} dropped`)
  assert.ok(ids.has('s5') && ids.has('s304'))
})

test('a skip after playing a tenth of the scene or more starts the ladder again at 48 hours', () => {
  // an 8-minute scene: a tenth is 48 seconds of play
  assert.equal(W.watchedEnough(47.9, 480), false)
  assert.equal(W.watchedEnough(48, 480), true)
  assert.equal(W.watchedEnough(300, 480), true)
  assert.equal(W.watchedEnough(30, null), false, 'no length, no watch')

  // a scene two steps up, with an ignored day
  let snoozes = W.skipScene([], 'a', T0).snoozes
  snoozes = W.skipScene(snoozes, 'a', T0 + 50 * HOUR).snoozes
  snoozes = W.ignoreScene(snoozes, 'a', T0 + 300 * HOUR, '2026-10-30')
  const now = T0 + 400 * HOUR
  // just under a tenth: a look, one step up to 30 days
  const look = W.skipScene(snoozes, 'a', now, {
    watched: W.watchedEnough(47.9, 480),
  }).snoozes[0]
  assert.equal(look.step, 3)
  assert.equal(look.until, now + 720 * HOUR)
  assert.equal(look.ignored, 1)
  // a tenth or more: watched, a plain first step
  const watched = W.skipScene(snoozes, 'a', now, {
    watched: W.watchedEnough(48, 480),
  }).snoozes[0]
  assert.equal(watched.step, 1)
  assert.equal(watched.until, now + 48 * HOUR)
  assert.equal(watched.ignored, 0)
  assert.equal(watched.ignoredDay, null)
  // a watched scene with no entry gets the same first step
  const fresh = W.skipScene([], 'b', now, { watched: true }).snoozes[0]
  assert.equal(fresh.step, 1)
  assert.equal(fresh.until, now + 48 * HOUR)
})

test('Back after a long watch and Skip puts the ladder back as it was', () => {
  let snoozes = W.skipScene([], 'a', T0).snoozes
  snoozes = W.skipScene(snoozes, 'a', T0 + 50 * HOUR).snoozes
  const before = snoozes.find((e) => e.id === 'a')
  assert.equal(before.step, 2)
  const now = T0 + 300 * HOUR
  const skipped = W.skipScene(snoozes, 'a', now, { watched: true })
  assert.equal(skipped.snoozes.find((e) => e.id === 'a').step, 1)
  const back = W.unskipScene(skipped.snoozes, 'a', skipped.prev, now + 1000)
  const e = back.find((x) => x.id === 'a')
  assert.equal(e.step, before.step)
  assert.equal(e.until, before.until)
})
