import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import * as FY from '../../src/js/model/foryou.js'
import {
  syntheticLibrary,
  syntheticStashdb,
  withRecentPlays,
} from './fixtures/synthetic.mjs'

const DAY = 86400000
const { input, taste } = syntheticLibrary()
const db = buildDb(input)
const M = createEngine(db).compute({})
const STATE = {
  dontLearn: [],
  notInterested: [],
  settings: { excludedTags: '' },
}
const forYou = (state = STATE, signals = FY.EMPTY_SIGNALS, Mx = M) =>
  FY.computeForYou(FY.context(Mx, state), signals)
const hide = (ids) => ({
  ...STATE,
  notInterested: ids.map((sceneId) => ({ sceneId, key: null })),
})
const tagged = (s, ids) => s.tags.some((t) => ids.has(t.id))

// a fresh library and model after replacing the last two weeks' plays
function afterPlays(plays) {
  const dbx = buildDb(withRecentPlays(input, plays))
  const Mx = createEngine(dbx).compute({})
  return { dbx, Mx, ctx: FY.context(Mx, STATE) }
}

test('For you: 12 scenes you own, at most 2 per performer, each with a reason', () => {
  const fy = forYou()
  assert.equal(fy.length, FY.FY.size)
  assert.equal(new Set(fy.map((it) => it.scene.id)).size, 12)
  const per = new Map()
  for (const it of fy) {
    assert.equal(it.scene.owned, true)
    assert.match(it.reason, /^[A-Z].{8,}/)
    assert.doesNotMatch(it.reason, /undefined|null|NaN/)
    for (const p of it.scene.performers) per.set(p.id, (per.get(p.id) || 0) + 1)
  }
  assert.ok(Math.max(...per.values()) <= FY.FY.perPerformer)
  assert.deepEqual(
    fy.map((it) => it.slot),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  )
  assert.deepEqual(forYou(), fy, 'the same inputs give the same row')
})

test('For you: slot 4 is a forgotten favourite and slot 9 a near miss', () => {
  const fy = forYou()
  assert.equal(fy[3].kind, 'forgotten')
  assert.equal(fy[8].kind, 'nearmiss')
  assert.equal(fy.filter((it) => it.kind === 'main').length, 10)
  const f = fy[3]
  assert.equal(f.freshKind, 'long', 'unplayed for 90+ days')
  assert.ok(M.rating(f.scene) >= 90 || M.rating(f.scene) == null)
  assert.match(f.reason, /^(Not watched since|One of your favorites)/)
  const n = fy[8]
  assert.equal(M.rating(n.scene), null)
  assert.match(n.reason, /^Worth a try/)
  assert.ok(n.parts.exploration >= 0)
})

test('each exploration slot falls back to the other kind', () => {
  // hide forgotten favourites until none is left for slot 4
  const gone = []
  let fy = forYou()
  while (fy[3].kind === 'forgotten' && gone.length < 100) {
    gone.push(fy[3].scene.id)
    fy = forYou(hide(gone))
  }
  assert.equal(fy[3].kind, 'nearmiss', `after hiding ${gone.length}`)
  // and near misses until none is left for slot 9
  const gone2 = []
  fy = forYou()
  while (fy[8].kind === 'nearmiss' && gone2.length < 200) {
    gone2.push(fy[8].scene.id)
    fy = forYou(hide(gone2))
  }
  assert.equal(fy[8].kind, 'forgotten', `after hiding ${gone2.length}`)
})

test('Not interested and excluded tags never appear', () => {
  const first = forYou()
  const hidden = first.slice(0, 3).map((it) => it.scene.id)
  const fy = forYou(hide(hidden))
  for (const id of hidden) assert.ok(!fy.some((it) => it.scene.id === id))

  const state = { ...STATE, settings: { excludedTags: ' beach, VINTAGE ,' } }
  const ex = FY.excludedTagIds(db, state.settings.excludedTags)
  assert.equal(ex.size, 2)
  const ctx = FY.context(M, state)
  const fx = FY.computeForYou(ctx, FY.EMPTY_SIGNALS)
  assert.equal(fx.length, 12)
  for (const it of fx) assert.ok(!tagged(it.scene, ex), it.scene.id)
  for (const it of FY.newInLibrary(ctx)) assert.ok(!tagged(it.scene, ex))
  for (const row of FY.followRows(ctx, FY.EMPTY_SIGNALS, []))
    for (const it of row.items) assert.ok(!tagged(it.scene, ex))
})

test('row signals: opening adds, passing over takes away', () => {
  const sig = (opens, passes) => ({ ...FY.EMPTY_SIGNALS, opens, passes })
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`)
  close(FY.rowSignal(sig({ x: 1 }, {}), 'x'), 0.12)
  close(FY.rowSignal(sig({ x: 5 }, {}), 'x'), 0.24) // up to two opens
  close(FY.rowSignal(sig({}, { x: 2 }), 'x'), 0)
  close(FY.rowSignal(sig({}, { x: 3 }), 'x'), -0.1)
  close(FY.rowSignal(sig({}, { x: 4 }), 'x'), -0.2)
  close(FY.rowSignal(sig({}, { x: 9 }), 'x'), -0.3) // down to −0.3
  close(FY.rowSignal(sig({ x: 2 }, { x: 4 }), 'x'), 0.04)
  close(FY.rowSignal(sig({}, {}), 'x'), 0)

  // a visit counts last visit's unopened cards as passed over, once
  const last = {
    opens: { b: 1 },
    passes: { a: 2, c: 1 },
    lastShown: ['a', 'b', 'c', 'd'],
    lastShownOpened: ['b'],
  }
  const visit = FY.visitSignals(last, new Set(['c']))
  assert.deepEqual(visit.passes, { a: 3, c: 1, d: 1 })
  assert.deepEqual(last.passes, { a: 2, c: 1 }, 'not changed in place')
  const shown = FY.shownSignals(visit, ['e', 'a'])
  assert.deepEqual(shown.lastShown, ['e', 'a'])
  assert.deepEqual(shown.lastShownOpened, [])
  const opened = FY.openSignals(shown, 'a')
  assert.equal(opened.opens.a, 1)
  assert.equal(opened.passes.a, 0, 'an opened card is no longer passed over')
  assert.deepEqual(opened.lastShownOpened, ['a'])
  assert.equal(FY.openSignals(shown, 'a', new Set(['a'])), shown, "Don't learn")

  // in the row
  const id = forYou()[0].scene.id
  const withOpens = forYou(STATE, sig({ [id]: 2 }, {}))
  assert.equal(withOpens.find((it) => it.scene.id === id).feedback, 0.24)
  const skip = { ...STATE, dontLearn: [{ sceneId: id }] }
  const quiet = forYou(skip, sig({ [id]: 2 }, {}))
  assert.equal(quiet.find((it) => it.scene.id === id)?.feedback ?? 0, 0)
})

test('momentum: recent plays of a performer lead the row, with a reason that names them', () => {
  const lovedId = taste.lovedPerformerIds[0]
  const best = db.performers
    .get(lovedId)
    .ownedSceneIds.map((id) => db.scenes.get(id))
    .sort((a, b) => (b.local.rating100 ?? 0) - (a.local.rating100 ?? 0))
    .slice(0, 4)
  // a week of watching them: seven plays over four of their best scenes
  const plays = Array.from({ length: 7 }, (_, d) => ({
    sceneId: best[d % 4].id,
    at: db.asOf - (d + 0.5) * DAY,
  }))
  const { dbx, Mx, ctx } = afterPlays(plays)
  const f = ctx.mom.feat.get('p:' + lovedId)
  assert.equal(f.scenes.size, 4)
  assert.ok(f.m >= 1.2)
  const fy = FY.computeForYou(ctx, FY.EMPTY_SIGNALS)
  const name = dbx.performers.get(lovedId).name
  const i = fy.findIndex((it) => it.reason.includes(name))
  assert.ok(i >= 0 && i < 3, `a card of theirs near the front (${i})`)
  assert.match(
    fy[i].reason,
    /^Because you watched (two|three|four) of Performer \d+'s this week$/,
  )
  assert.equal(fy[i].key, 'p:' + lovedId)

  // "More with <performer>" follows, of their other scenes you own
  const rows = FY.followRows(
    ctx,
    FY.EMPTY_SIGNALS,
    fy.map((it) => it.scene.id),
  )
  assert.ok(rows.length <= 2)
  const more = rows.find((r) => r.id === 'more-' + lovedId)
  assert.ok(more, rows.map((r) => r.title).join(', '))
  assert.equal(more.title, `More with ${name}`)
  assert.ok(more.items.length >= 4 && more.items.length <= 12)
  const shown = new Set(fy.map((it) => it.scene.id))
  for (const it of more.items) {
    assert.equal(it.scene.owned, true)
    assert.ok(it.scene.performers.some((p) => p.id === lovedId))
    assert.ok(!shown.has(it.scene.id), 'not already in For you')
    assert.equal(it.key, 'p:' + lovedId)
    const last = ctx.plays.get(it.scene.id).at(-1)
    assert.ok(
      !last || dbx.asOf - last >= 2 * DAY,
      'nothing played in the last two days',
    )
  }
  assert.ok(Mx.performerAffinity(lovedId) >= 0)
})

test('"More with" needs two of their scenes and 1.2 decayed plays', () => {
  const lovedId = taste.lovedPerformerIds[0]
  const theirs = db.performers.get(lovedId).ownedSceneIds
  // seven plays, one scene
  let { ctx } = afterPlays(
    Array.from({ length: 7 }, (_, d) => ({
      sceneId: theirs[0],
      at: db.asOf - (d + 0.5) * DAY,
    })),
  )
  assert.deepEqual(
    FY.followRows(ctx, FY.EMPTY_SIGNALS, []).filter((r) =>
      r.id.startsWith('more-'),
    ),
    [],
  )
  // two scenes, but long enough ago to have decayed below 1.2
  ;({ ctx } = afterPlays([
    { sceneId: theirs[0], at: db.asOf - 13 * DAY },
    { sceneId: theirs[1], at: db.asOf - 13 * DAY },
  ]))
  assert.ok(ctx.mom.feat.get('p:' + lovedId).m < 1.2)
  assert.deepEqual(
    FY.followRows(ctx, FY.EMPTY_SIGNALS, []).filter((r) =>
      r.id.startsWith('more-'),
    ),
    [],
  )
  // no recent plays at all: no rows
  ;({ ctx } = afterPlays([]))
  assert.equal(ctx.mom.count, 0)
  assert.deepEqual(FY.followRows(ctx, FY.EMPTY_SIGNALS, []), [])
})

// Scenes to play that leave one tag alone able to make a row: no other tag
// on three of them and no performer on two. seen carries over between calls.
function spread(
  candidates,
  n,
  except,
  seen = { tags: new Map(), perfs: new Set() },
) {
  const picked = []
  for (const s of candidates) {
    if (picked.length >= n) break
    const others = s.tags.filter((t) => t.id !== except)
    if (others.some((t) => (seen.tags.get(t.id) || 0) >= 2)) continue
    if (s.performers.some((p) => seen.perfs.has(p.id))) continue
    picked.push(s)
    for (const t of others) seen.tags.set(t.id, (seen.tags.get(t.id) || 0) + 1)
    for (const p of s.performers) seen.perfs.add(p.id)
  }
  assert.equal(picked.length, n)
  return picked
}
const hasTag = (id) => (s) => s.tags.some((t) => t.id === id)
// one play on each of n scenes with the tag, over the last few days
const tagPlays = (tagId, n = 4, seen) =>
  spread(db.owned.filter(hasTag(tagId)), n, tagId, seen).map((s, i) => ({
    sceneId: s.id,
    at: db.asOf - (i + 1) * DAY,
  }))

test('"Back to <tag>" needs three recent scenes, a lift of 0.33 and a tag you like', () => {
  const likedId = taste.likedTagIds[1]
  let { dbx, Mx, ctx } = afterPlays(tagPlays(likedId))
  const f = ctx.mom.feat.get('t:' + likedId)
  assert.ok(f.lift >= 0.33, `lift ${f.lift}`)
  assert.ok(Mx.fits.content.W.get('t:' + likedId) >= 0)
  const rows = FY.followRows(ctx, FY.EMPTY_SIGNALS, [])
  const back = rows.find((r) => r.id === 'back-' + likedId)
  assert.ok(back, rows.map((r) => r.title).join(', '))
  assert.equal(back.title, `Back to ${dbx.tags.get(likedId).name}`)
  assert.ok(back.items.length >= 4)
  for (const it of back.items) {
    assert.ok(it.scene.tags.some((t) => t.id === likedId))
    const last = ctx.plays.get(it.scene.id).at(-1)
    assert.ok(
      !last || dbx.asOf - last >= 14 * DAY,
      'not played in the last two weeks',
    )
  }

  // two scenes are not enough
  ;({ ctx } = afterPlays(tagPlays(likedId).slice(0, 2)))
  assert.ok(
    !FY.followRows(ctx, FY.EMPTY_SIGNALS, []).some((r) =>
      r.id.startsWith('back-'),
    ),
  )

  // nor four, when they are a small part of what you watched lately
  const seen = { tags: new Map(), perfs: new Set() }
  const four = tagPlays(likedId, 4, seen)
  const rest = spread(
    db.owned.filter((s) => !hasTag(likedId)(s)),
    4,
    likedId,
    seen,
  ).map((s) => ({ sceneId: s.id, at: db.asOf - 0.5 * DAY }))
  ;({ ctx } = afterPlays([...four, ...rest]))
  const low = ctx.mom.feat.get('t:' + likedId).lift
  assert.ok(low > 0 && low < 0.33, `lift ${low}`)
  assert.ok(
    !FY.followRows(ctx, FY.EMPTY_SIGNALS, []).some((r) =>
      r.id.startsWith('back-'),
    ),
  )

  // a tag you rate down makes no row however much you played it
  const dislikedId = taste.dislikedTagIds[0]
  ;({ Mx, ctx } = afterPlays(tagPlays(dislikedId)))
  assert.ok(ctx.mom.feat.get('t:' + dislikedId).lift >= 0.33)
  assert.ok(Mx.fits.content.W.get('t:' + dislikedId) < 0)
  assert.ok(
    !FY.followRows(ctx, FY.EMPTY_SIGNALS, []).some(
      (r) => r.id === 'back-' + dislikedId,
    ),
  )
})

test('New in your library: the fallback row while the model builds', () => {
  const ctx = FY.context(M, STATE)
  const row = FY.newInLibrary(ctx)
  assert.equal(row.length, 12)
  for (let i = 0; i < row.length; i++) {
    const s = row[i].scene
    assert.equal(s.owned, true)
    assert.ok((M.rating(s) ?? 60) >= 60, 'nothing rated under 3★')
    const last = ctx.plays.get(s.id).at(-1)
    assert.ok(
      !last || db.asOf - last > 14 * DAY,
      'not played in the last 14 days',
    )
    assert.match(row[i].reason, /^Added (today|yesterday|\d)/)
    assert.equal(row[i].kind, 'fallback')
    if (i)
      assert.ok(
        row[i - 1].scene.local.created_at >= s.local.created_at,
        'newest first',
      )
  }
  // it needs no fit
  const bare = FY.context(FY.withoutModel(db, {}), STATE)
  assert.deepEqual(FY.newInLibrary(bare), row)

  // with StashDB, popularity joins the order and the reason
  const dbs = buildDb({ ...input, stashdb: syntheticStashdb(input) })
  const cs = FY.context(FY.withoutModel(dbs, {}), STATE)
  assert.equal(cs.hasStashdb, true)
  const withPop = FY.newInLibrary(cs)
  assert.ok(withPop.every((it) => it.scene.owned))
  assert.ok(withPop.some((it) => it.reason.includes(' · ')))
  const noPop = FY.newInLibrary(
    FY.context(FY.withoutModel(dbs, {}), STATE, { hasStashdb: false }),
  )
  assert.ok(noPop.every((it) => !it.reason.includes(' · ')))
})

test('libraries under 30 scenes get the fallback row', () => {
  assert.equal(
    FY.tooSmall(buildDb(syntheticLibrary({ scenes: 29 }).input)),
    true,
  )
  assert.equal(
    FY.tooSmall(buildDb(syntheticLibrary({ scenes: 30 }).input)),
    false,
  )
  assert.equal(FY.tooSmall(db), false)
})

test("Don't learn keeps a scene's plays out of momentum, not its freshness", () => {
  const lovedId = taste.lovedPerformerIds[0]
  const theirs = db.performers.get(lovedId).ownedSceneIds.slice(0, 2)
  const plays = theirs.flatMap((id) => [
    { sceneId: id, at: db.asOf - 1 * DAY },
    { sceneId: id, at: db.asOf - 2 * DAY },
  ])
  const { Mx } = afterPlays(plays)
  const on = FY.context(Mx, STATE)
  const off = FY.context(Mx, {
    ...STATE,
    dontLearn: theirs.map((sceneId) => ({ sceneId })),
  })
  assert.ok(on.mom.feat.get('p:' + lovedId).m > 0)
  assert.equal(off.mom.feat.get('p:' + lovedId), undefined)
  // the scenes themselves still count as just watched
  const row = FY.computeForYou(off, FY.EMPTY_SIGNALS)
  for (const it of row)
    if (theirs.includes(it.scene.id)) assert.equal(it.freshKind, 'recent')
})

test('no kind of reason, and no one sentence, dominates the row', () => {
  // A fortnight of heavy watching: momentum could explain most cards.
  const loved = [...db.localPerformers]
    .sort((a, b) => b.ownedSceneIds.length - a.ownedSceneIds.length)
    .slice(0, 3)
  const plays = loved.flatMap((p, k) =>
    p.ownedSceneIds.slice(0, 4).map((sceneId, j) => ({
      sceneId,
      at: input.asOf - (1 + ((j + k) % 10)) * 86_400_000,
    })),
  )
  const { ctx } = afterPlays(plays)
  const fy = FY.computeForYou(ctx, FY.EMPTY_SIGNALS)
  const count = (key) =>
    fy.reduce((m, it) => m.set(it[key], (m.get(it[key]) || 0) + 1), new Map())
  for (const [kind, n] of count('reasonKind'))
    assert.ok(n <= fy.length / 2, `${n} cards give a ${kind} reason`)
  for (const [text, n] of count('reason'))
    assert.ok(n <= 2, `"${text}" on ${n} cards`)
})

test('a sentence the model gives every scene still shows on two cards at most', () => {
  // As in a large library where watch time explains most scores and no card
  // has a momentum or freshness sentence: every scene's strongest reason is
  // the same sentence, with others behind it.
  const same = 'You keep it playing longer than most'
  const ctx = {
    M: {
      ratingsToGo: 0,
      rating: () => null,
      reason: () => ({ text: same, key: 'b' }),
      reasons: (id) => [
        { text: same, key: 'b' },
        { text: `Another reason for ${id}`, key: 'p' },
      ],
    },
  }
  const cards = Array.from({ length: 12 }, (_, i) => ({
    kind: 'main',
    scene: { id: String(i + 1), performers: [] },
    m: { source: null, value: 0 },
    f: { kind: 'recent' },
  }))
  const texts = FY.assignReasons(ctx, cards).map((r) => r.text)
  assert.equal(texts.filter((t) => t === same).length, 2)
  assert.equal(new Set(texts).size, 11)
})

test('a scene you saw months ago comes back only for people who rewatch', () => {
  const now = input.asOf
  const scene = (id) => ({
    id,
    owned: true,
    local: { created_at: new Date(now - 400 * DAY).toISOString() },
  })
  const fresh = (rewatch) => {
    const ctx = { now, rewatch, plays: new Map([['seen', [now - 200 * DAY]]]) }
    return {
      seen: FY.freshnessFor(ctx, scene('seen')).value,
      never: FY.freshnessFor(ctx, scene('never')).value,
    }
  }
  // the mockup's sample user rewatches 73% of what they play
  const rewatcher = fresh(0.73)
  assert.ok(rewatcher.seen > rewatcher.never)
  // someone who never rewatches: a scene they saw ranks below one they didn't
  const once = fresh(0)
  assert.ok(once.seen < once.never - 0.5)
})
