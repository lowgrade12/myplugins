// Cherry Pick beside Ascension, HotOrNot, Xenith and Restash: ratings those
// plugins set stay out of the model, Apply never writes over a ranked or
// mirrored record, and Cherry Pick's custom-field writes leave theirs alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine, unratedByYou } from '../../src/js/model/index.js'
import * as BR from '../../src/js/model/brackets.js'
import {
  placedIds,
  restoreFieldsInput,
} from '../../src/js/model/bracketSetup.js'
import { SCENES } from '../../src/js/data/queries.js'
import { FIELD_PREFIX } from '../../src/js/name.js'
import { syntheticLibrary } from './fixtures/synthetic.mjs'

const { input } = syntheticLibrary()
const copy = () => structuredClone(input)
const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)

// What Ascension writes after a few matches
const RANKED = {
  hotornot_stats: JSON.stringify({ total_matches: 5, wins: 3, losses: 2 }),
}
const rankedScene = () => ({
  ...RANKED,
  scene_record: JSON.stringify([{ opponentId: '9', won: true }]),
})
const rankedPerformer = () => ({
  ...RANKED,
  performer_record: JSON.stringify([{ opponentId: '9', won: true }]),
})
// What Xenith 3.2.0 writes after a few matches
const xenithRanked = () => ({
  xenith_stats: JSON.stringify({ total_matches: 3, wins: 2, losses: 1 }),
  xenith_record: JSON.stringify([{ opponentId: '9', won: true }]),
})
// What Restash 0.3.0 writes on a record it scores; with its mirror on,
// rating100 is set to the same score
const restash = (score) => ({
  restash_score: score,
  restash_raw: 0.5521,
  restash_components: '{"affinity":0.3}',
  restash_updated: '2026-10-15T08:00:00Z',
})
// Prime's values for the i-th of n records: 70% / 25% / 5%
const primeValue = (i, n, low = 6, mid = 31) =>
  i < Math.floor(n * 0.7)
    ? low
    : i < Math.floor(n * 0.7) + Math.floor(n * 0.25)
      ? mid
      : 40

const engineFor = (lib, input = {}) => createEngine(buildDb(lib)).compute(input)

// Every prediction and performer affinity of two engines match
function sameModel(a, b, what) {
  assert.equal(a.fits.rated.length, b.fits.rated.length, `${what}: targets`)
  close(a.userMean, b.userMean, `${what}: your average`)
  for (const id of a.db.scenes.keys())
    close(a.prediction(id).value, b.prediction(id).value, `${what}: ${id}`)
  for (const p of a.db.localPerformers)
    close(
      a.performerAffinity(p.id),
      b.performerAffinity(p.id),
      `${what}: performer ${p.id}`,
    )
}

test('the library loader reads custom fields on scenes as well as performers', () => {
  assert.match(SCENES, /\bcustom_fields\b/)
})

test('a scene Ascension ranks counts as unrated: no target, no reason', () => {
  const rated = input.scenes.filter((s) => s.rating100 != null).slice(0, 15)
  const ranked = copy()
  const unrated = copy()
  for (const [i, { id }] of rated.entries()) {
    const s = ranked.scenes.find((x) => x.id === id)
    s.rating100 = 30 + ((i * 37) % 70) // its Elo score, whatever it is
    s.custom_fields = rankedScene()
    unrated.scenes.find((x) => x.id === id).rating100 = null
  }
  const Mr = engineFor(ranked)
  const Mu = engineFor(unrated)
  sameModel(Mr, Mu, 'ranked scenes')
  const s = Mr.db.scenes.get(rated[0].id)
  assert.equal(s.local.ratingSource, 'elo')
  assert.equal(Mr.rating(s), null, 'the model reads none')
  assert.equal(Mr.stashRating(s), 30, "Stash's stays on show")
  // Opting in reads them as the user's again
  const Ml = engineFor(ranked, { learnFromRankings: true })
  assert.equal(Ml.fits.rated.length, Mu.fits.rated.length + rated.length)
  assert.equal(Ml.rating(s), 30)
})

test('performer ratings Ascension ranks or primed add no affinity', () => {
  // Five rated by hand, ten ranked, every other one primed. (A 2★ set by
  // hand among primed performers would read as primed: Prime's 40 looks
  // the same.)
  const base = copy()
  for (const p of base.performers) p.rating100 = null
  const hand = base.performers.slice(0, 5)
  hand.forEach((p, i) => (p.rating100 = [100, 80, 20, 90, 60][i]))
  const lib = structuredClone(base)
  const ranked = lib.performers.slice(5, 15)
  ranked.forEach((p, i) => {
    p.rating100 = 20 + i * 8
    p.custom_fields = rankedPerformer()
  })
  const rest = lib.performers.slice(15)
  rest.forEach((p, i) => (p.rating100 = primeValue(i, rest.length)))

  const Mo = engineFor(lib)
  const Mb = engineFor(base)
  sameModel(Mo, Mb, 'ranked and primed performers')
  const local = (id) => Mo.db.performers.get(id).local
  for (const p of ranked) {
    assert.equal(local(p.id).ratingSource, 'elo')
    assert.equal(Mo.performerRating(p.id), null)
    assert.equal(Mo.stashPerformerRating(p.id), p.rating100)
  }
  for (const p of rest) assert.equal(local(p.id).ratingSource, 'primed')
  for (const p of hand) {
    assert.equal(local(p.id).ratingSource, null, 'set by hand')
    assert.equal(Mo.performerRating(p.id), p.rating100)
  }
  // Opting in: the same ratings move affinity again
  const Ml = engineFor(lib, { learnFromRankings: true })
  assert.ok(
    Math.abs(
      Ml.performerAffinity(rest[0].id) - Mb.performerAffinity(rest[0].id),
    ) > 0.5,
    'a primed 0.3★ would have pushed them down',
  )
})

test('primed scenes count as unrated', () => {
  // Ten rated by hand, the rest primed by "Prime Unrated Scenes" (none of
  // the ten on 2★, which would read as Prime's 40)
  const base = copy()
  const keep = new Set(
    base.scenes
      .filter((s) => s.rating100 >= 50)
      .slice(0, 10)
      .map((s) => s.id),
  )
  for (const s of base.scenes) if (!keep.has(s.id)) s.rating100 = null
  const lib = structuredClone(base)
  const others = lib.scenes.filter((s) => !keep.has(s.id))
  others.forEach((s, i) => (s.rating100 = primeValue(i, others.length, 3, 28)))
  const Mp = engineFor(lib)
  sameModel(Mp, engineFor(base), 'primed scenes')
  for (const s of others)
    assert.equal(Mp.db.scenes.get(s.id).local.ratingSource, 'primed')
  for (const id of keep)
    assert.equal(Mp.db.scenes.get(id).local.ratingSource, null)
})

test("scenes Xenith ranks or Restash mirrored count as unrated; Restash's score alone changes nothing", () => {
  const rated = input.scenes.filter((s) => s.rating100 != null).slice(0, 16)
  const xen = rated.slice(0, 8)
  const mirrored = rated.slice(8)
  const lib = copy()
  const unrated = copy()
  const scene = (l, id) => l.scenes.find((x) => x.id === id)
  for (const [i, { id }] of xen.entries()) {
    const s = scene(lib, id)
    s.rating100 = 30 + ((i * 37) % 70)
    s.custom_fields = xenithRanked()
    scene(unrated, id).rating100 = null
  }
  for (const [i, { id }] of mirrored.entries()) {
    const s = scene(lib, id)
    s.rating100 = 20 + i * 9
    // Stash may hand the score back as a string
    s.custom_fields = restash(i % 2 ? String(s.rating100) : s.rating100)
    scene(unrated, id).rating100 = null
  }
  // Scored by Restash with its mirror off: every rating is the user's own
  const own = input.scenes.filter((s) => s.rating100 != null).slice(16, 26)
  for (const [i, { id }] of own.entries()) {
    const score = (scene(lib, id).rating100 + 7 + i) % 101
    scene(lib, id).custom_fields = restash(score)
    scene(unrated, id).custom_fields = restash(score)
  }
  const M = engineFor(lib)
  sameModel(M, engineFor(unrated), 'Xenith and Restash scenes')
  for (const { id } of xen) {
    assert.equal(M.db.scenes.get(id).local.ratingSource, 'elo')
    assert.equal(M.rating(M.db.scenes.get(id)), null)
  }
  for (const { id } of mirrored) {
    const s = M.db.scenes.get(id)
    assert.equal(s.local.ratingSource, 'mirror')
    assert.equal(M.rating(s), null, 'the model reads none')
    assert.equal(M.stashRating(s), scene(lib, id).rating100, "Stash's shows")
  }
  for (const { id } of own) {
    const s = M.db.scenes.get(id)
    assert.equal(s.local.ratingSource, null)
    assert.equal(M.rating(s), scene(lib, id).rating100)
  }
  // Opting in reads both as the user's again
  const Ml = engineFor(lib, { learnFromRankings: true })
  assert.equal(
    Ml.fits.rated.length,
    M.fits.rated.length + xen.length + mirrored.length,
  )
})

test('Your score shows on a scene whose only rating another plugin set, until the user rates it', () => {
  // Most scenes primed, a few ranked by Ascension, a few mirrored by
  // Restash, ten rated by hand
  const lib = copy()
  const mine = lib.scenes.filter((s) => s.rating100 >= 50).slice(0, 10)
  const keep = new Set(mine.map((s) => s.id))
  const others = lib.scenes.filter((s) => !keep.has(s.id))
  const ranked = others.slice(0, 4)
  const mirrored = others.slice(4, 8)
  const primed = others.slice(8)
  for (const s of ranked) {
    s.rating100 = 64
    s.custom_fields = rankedScene()
  }
  for (const s of mirrored) {
    s.rating100 = 47
    s.custom_fields = restash(47)
  }
  primed.forEach((s, i) => (s.rating100 = primeValue(i, primed.length, 3, 28)))
  const M = engineFor(lib)
  const card = (s, rating100 = s.rating100) => ({ id: s.id, rating100 })
  for (const s of [...ranked, ...mirrored, ...primed])
    assert.ok(unratedByYou(M, card(s)), `${s.id} reads as unrated`)
  for (const s of mine) assert.ok(!unratedByYou(M, card(s)), `${s.id} is rated`)
  // A rating the user sets on the card hides it before the library reloads
  assert.ok(!unratedByYou(M, card(primed[0], 90)))
  assert.ok(!unratedByYou(M, card(ranked[0], 90)))
  // As does one Apply set (an override)
  const Mo = engineFor(lib, { overrides: { [primed[0].id]: 70 } })
  assert.ok(!unratedByYou(Mo, card(primed[0], 70)))
  // Unrated in Stash, in the library or not
  assert.ok(unratedByYou(M, { id: 'not-in-library', rating100: null }))
  assert.ok(!unratedByYou(M, { id: 'not-in-library', rating100: 60 }))
  // Opting in to learn from other plugins' ratings makes them the user's
  const Ml = engineFor(lib, { learnFromRankings: true })
  assert.ok(!unratedByYou(Ml, card(ranked[0])))
})

test('performer ratings Xenith ranks or Restash mirrored add no affinity', () => {
  const base = copy()
  for (const p of base.performers) p.rating100 = null
  const hand = base.performers.slice(0, 5)
  hand.forEach((p, i) => (p.rating100 = [100, 80, 20, 90, 60][i]))
  const lib = structuredClone(base)
  const xen = lib.performers.slice(5, 12)
  xen.forEach((p, i) => {
    p.rating100 = 25 + i * 9
    p.custom_fields = xenithRanked()
  })
  const mirrored = lib.performers.slice(12, 20)
  mirrored.forEach((p, i) => {
    p.rating100 = 15 + i * 11
    p.custom_fields = restash(p.rating100)
  })
  // Restash scores the hand-rated ones too, but its mirror is off
  lib.performers
    .slice(0, 5)
    .forEach((p) => (p.custom_fields = restash((p.rating100 + 13) % 100)))
  const M = engineFor(lib)
  sameModel(M, engineFor(base), 'Xenith and Restash performers')
  for (const p of xen) {
    assert.equal(M.db.performers.get(p.id).local.ratingSource, 'elo')
    assert.equal(M.performerRating(p.id), null)
  }
  for (const p of mirrored) {
    assert.equal(M.db.performers.get(p.id).local.ratingSource, 'mirror')
    assert.equal(M.performerRating(p.id), null)
    assert.equal(M.stashPerformerRating(p.id), p.rating100)
  }
  for (const p of hand) assert.equal(M.performerRating(p.id), p.rating100)
})

// A 16-performer bracket played out (always the higher seed), and the
// library as Stash has it afterwards
function placedBracket() {
  const M = engineFor(input)
  const ids = BR.performerPool(M, { gender: 'FEMALE', pool: 'library' })
  let b = BR.createBracket(M, {
    kind: 'performer',
    gender: 'FEMALE',
    poolLabel: 'Female',
    size: 16,
    ids,
    now: 7,
  })
  let st = BR.bracketState(b)
  while (st.current) {
    b = BR.pick(b, st.current.a)
    st = BR.bracketState(b)
  }
  return { ...b, result: st.result, finishedAt: '2026-10-01T20:00:00Z' }
}

// A 16-performer bracket over lib, played out (always side a)
function playedOn(lib) {
  const M = engineFor(lib)
  const ids = BR.performerPool(M, { gender: 'FEMALE', pool: 'library' })
  let b = BR.createBracket(M, {
    kind: 'performer',
    gender: 'FEMALE',
    poolLabel: 'Female',
    size: 16,
    ids,
    now: 7,
  })
  let st = BR.bracketState(b)
  while (st.current) {
    b = BR.pick(b, st.current.a)
    st = BR.bracketState(b)
  }
  return {
    M,
    b: { ...b, result: st.result, finishedAt: '2026-10-01T20:00:00Z' },
  }
}

// The Female pool of a library with every performer rating cleared
function clearedPool() {
  const lib = copy()
  for (const p of lib.performers) p.rating100 = null
  const pool = BR.performerPool(engineFor(lib), {
    gender: 'FEMALE',
    pool: 'library',
  })
  const by = (id) => lib.performers.find((p) => p.id === id)
  return { lib, pool: pool.map(by) }
}

test('Apply never writes a performer Ascension ranks, and says why', () => {
  // four rated by hand, six unrated (with rated scenes), the rest ranked
  const { lib, pool } = clearedPool()
  pool.slice(0, 4).forEach((p, i) => (p.rating100 = [100, 80, 60, 30][i]))
  const ranked = new Set(pool.slice(10).map((p) => p.id))
  pool.slice(10).forEach((p, i) => {
    p.rating100 = 31 + i
    p.custom_fields = rankedPerformer()
  })
  const { M, b } = playedOn(lib)
  const role = (id) => BR.entrantRole(M, 'performer', id)
  const roles = b.seeds.map(role)
  assert.deepEqual(
    ['anchor', 'candidate', 'ranked'].map(
      (r) => roles.filter((x) => x === r).length,
    ),
    [0, 0, 16],
    'the six unrated count as rated by their scenes, so ranked records fill every place before them',
  )
  const { rows } = BR.ratingProposals(M, b)
  const by = new Map(rows.map((x) => [x.id, x]))
  const placedRanked = placedIds(b.result).filter((id) => ranked.has(id))
  assert.ok(placedRanked.length, 'a ranked one placed')
  for (const id of placedRanked) {
    const x = by.get(id)
    assert.equal(x.skip, 'ranked', 'listed, never written')
    assert.equal(x.from, M.stashPerformerRating(id))
  }
  for (const x of rows) if (!x.skip) assert.equal(role(x.id), 'candidate')
  for (const p of pool.slice(0, 4)) assert.equal(by.has(p.id), false)
})

test('Apply fills a primed performer as unrated', () => {
  const { lib, pool } = clearedPool()
  const hand = new Set(pool.slice(0, 6).map((p) => p.id))
  pool
    .slice(0, 6)
    .forEach((p, i) => (p.rating100 = [100, 90, 80, 70, 60, 50][i]))
  const rest = lib.performers.filter((p) => !hand.has(p.id))
  rest.forEach((p, i) => (p.rating100 = primeValue(i, rest.length)))
  const { M, b } = playedOn(lib)
  const { rows } = BR.ratingProposals(M, b)
  assert.ok(rows.length > 0)
  for (const x of rows) {
    assert.equal(x.primed, true, 'a primed rating counts as unrated')
    assert.equal(x.skip, undefined)
    assert.equal(
      x.from,
      lib.performers.find((p) => p.id === x.id).rating100,
      "Now shows Stash's",
    )
    assert.ok(!hand.has(x.id), 'a hand rating is an anchor')
  }
})

test('Apply skips a performer Xenith ranks or Restash mirrored, with the reason', () => {
  const { lib, pool } = clearedPool()
  pool.slice(0, 4).forEach((p, i) => (p.rating100 = [100, 80, 60, 30][i]))
  // Restash scored these, mirror off: one unrated, one rated by hand
  pool[4].custom_fields = restash(71)
  pool[8].rating100 = 60
  pool[8].custom_fields = restash(52)
  const xenith = new Set(pool.slice(9, 20).map((p) => p.id))
  pool.slice(9, 20).forEach((p) => {
    p.rating100 = 58
    p.custom_fields = xenithRanked()
  })
  const mirrored = new Set(pool.slice(20).map((p) => p.id))
  pool.slice(20).forEach((p) => {
    p.rating100 = 64
    p.custom_fields = restash(64)
  })
  const { M, b } = playedOn(lib)
  const role = (id) => BR.entrantRole(M, 'performer', id)
  assert.equal(role(pool[4].id), 'candidate', "Restash's score alone")
  assert.equal(role(pool[8].id), 'anchor', 'a hand rating Restash scored')
  const by = new Map(BR.ratingProposals(M, b).rows.map((x) => [x.id, x]))
  for (const id of placedIds(b.result)) {
    if (xenith.has(id)) assert.equal(by.get(id).skip, 'ranked')
    if (mirrored.has(id)) assert.equal(by.get(id).skip, 'mirrored')
  }
  assert.equal(by.has(pool[8].id), false, "the user's rating stays")
  // every candidate plays; the anchors wait
  for (const p of pool)
    if (role(p.id) === 'candidate' && BR.sceneAverage(M, p.id) == null)
      assert.ok(b.seeds.includes(p.id))
  for (const x of by.values())
    if (!x.skip) assert.equal(role(x.id), 'candidate')
})

test('Apply re-checks each record right before writing', () => {
  // as the preview showed them: unrated, and Ascension's 40
  const changes = [
    { id: '1', from: null, to: 100 },
    { id: '2', from: null, to: 90 },
    { id: '3', from: 40, to: 80 },
    { id: '4', from: null, to: 70 },
  ]
  const current = new Map([
    ['1', { id: '1', rating100: null, custom_fields: {} }],
    // ranked since the preview: its rating is Ascension's now, not a
    // rating changed by hand
    ['2', { id: '2', rating100: 61, custom_fields: rankedPerformer() }],
    ['3', { id: '3', rating100: 40, custom_fields: { elo_matches: 3 } }],
    // '4' is gone from Stash
  ])
  assert.deepEqual(BR.writableChanges(changes, current), {
    write: [{ id: '1', from: null, to: 100, fromProvisional: null }],
    ranked: ['2', '3'],
    changed: [],
  })
})

test('Apply and Undo re-check for Xenith and Restash too', () => {
  const changes = [
    ['1', null],
    ['2', null],
    ['3', null],
    ['4', 80],
    ['5', null],
    ['7', 80],
  ].map(([id, from]) => ({ id, from, to: 90 }))
  const current = new Map([
    // Xenith ranked it since the preview
    ['1', { id: '1', rating100: 47, custom_fields: xenithRanked() }],
    // Restash mirrored its score since
    ['2', { id: '2', rating100: 66, custom_fields: restash(66) }],
    ['3', { id: '3', rating100: 66, custom_fields: restash('66') }],
    // scored, mirror off
    ['4', { id: '4', rating100: 80, custom_fields: restash(66) }],
    ['5', { id: '5', rating100: null, custom_fields: restash(66) }],
    // scored, mirror off, and rated by hand since the preview
    ['7', { id: '7', rating100: 70, custom_fields: restash(66) }],
  ])
  assert.deepEqual(BR.writableChanges(changes, current), {
    write: [
      { id: '4', from: 80, to: 90, fromProvisional: null },
      { id: '5', from: null, to: 90, fromProvisional: null },
    ],
    ranked: ['1', '2', '3'],
    changed: ['7'],
  })
  // Undo after Restash's next run wrote its score over the applied 90
  const undo = [{ id: '6', from: null, to: 90 }]
  const after = new Map([
    ['6', { id: '6', rating100: 58, custom_fields: restash(58) }],
  ])
  assert.deepEqual(BR.writableChanges(undo, after), {
    write: [],
    ranked: ['6'],
    changed: [],
  })
  // Restash's score, not a rating changed by hand
  assert.deepEqual(BR.undoableChanges(undo, after), {
    write: [],
    ranked: ['6'],
    changed: [],
  })
})

test("a bracket's custom-field writes leave Ascension's and HotOrNot's untouched", () => {
  const done = placedBracket()
  const theirs = {
    hotornot_stats: RANKED.hotornot_stats,
    performer_record: rankedPerformer().performer_record,
    elo_matches: 7,
  }
  const current = Object.fromEntries(
    placedIds(done.result).map((id, i) => [
      id,
      { ...theirs, ...(i % 2 ? { [BR.FIELDS.titles]: 1 } : {}) },
    ]),
  )
  const updates = BR.bracketFieldUpdates(current, done)
  assert.equal(Object.keys(updates).length, 8)
  for (const [id, partial] of Object.entries(updates)) {
    for (const k of Object.keys(partial))
      assert.ok(k.startsWith(FIELD_PREFIX), `${k} is Cherry Pick's own`)
    // Stash's `partial` upserts these keys and keeps every other one
    const after = { ...current[id], ...partial }
    for (const [k, v] of Object.entries(theirs)) assert.equal(after[k], v, k)
    // Undo of the final pick puts back only Cherry Pick's keys
    const prev = Object.fromEntries(
      Object.keys(partial).map((k) => [k, current[id][k] ?? null]),
    )
    const undo = restoreFieldsInput(prev)
    assert.equal(undo.full, undefined)
    for (const k of [
      ...Object.keys(undo.partial || {}),
      ...(undo.remove || []),
    ])
      assert.ok(k.startsWith(FIELD_PREFIX), `undo touches ${k}`)
    // Remove Cherry Pick data takes only Cherry Pick's
    const gone = BR.ownFieldsOn(after)
    assert.ok(gone.length && gone.every((k) => k.startsWith(FIELD_PREFIX)))
    for (const k of Object.keys(theirs)) assert.ok(!gone.includes(k))
  }
  assert.deepEqual(BR.ownFieldsOn(theirs), [])
})

test('no custom-field write replaces the whole map', async () => {
  // `full` would drop every other plugin's fields; only partial and remove
  // are allowed
  const root = new URL('../../src/js/', import.meta.url).pathname
  const files = (await readdir(root, { recursive: true })).filter((f) =>
    /\.jsx?$/.test(f),
  )
  let writes = 0
  for (const f of files) {
    const src = await readFile(join(root, f), 'utf8')
    for (const m of src.matchAll(/custom_fields:\s*([^\n]{0,60})/g)) {
      writes++
      assert.doesNotMatch(m[1], /\bfull\b/, `${f}: ${m[0]}`)
    }
  }
  assert.ok(writes >= 3, 'found the writes')
})
