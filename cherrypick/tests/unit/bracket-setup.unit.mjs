import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import * as BR from '../../src/js/model/brackets.js'
import * as S from '../../src/js/model/bracketSetup.js'
import { syntheticLibrary } from './fixtures/synthetic.mjs'

const { input } = syntheticLibrary()
const db = buildDb(input)
const M = createEngine(db).compute({})
const stash = (p) => S.liveGender(null, p)

// A filtered Performers list, as the list buttons hand it over
const listOf = (gender, ids, label = '') => ({
  active: true,
  gender,
  ids: ids ? new Set(ids) : null,
  label,
  fullLabel: label,
})

test('live gender: a Set genders tap wins over the library copy', () => {
  const p = db.localPerformers.find((x) => x.local.gender === null)
  assert.equal(S.liveGender({}, p), null)
  assert.equal(S.liveGender({ [p.id]: 'MALE' }, p), 'MALE')
  const f = db.localPerformers.find((x) => x.local.gender === 'FEMALE')
  assert.equal(S.liveGender(null, f), 'FEMALE')
  assert.equal(S.liveGender({}, null), null)
})

test('pool counts and the largest pool', () => {
  const counts = S.poolCounts(M, stash)
  assert.deepEqual(Object.keys(counts), S.GENDER_KEYS)
  assert.equal(
    counts.FEMALE,
    BR.performerPool(M, { gender: 'FEMALE', pool: 'library' }).length,
  )
  assert.equal(S.dominantGender(counts), 'FEMALE')
  assert.equal(S.dominantGender({ FEMALE: 3, MALE: 9 }), 'MALE')
  assert.equal(
    S.dominantGender({ FEMALE: 5, MALE: 5 }),
    'FEMALE',
    "ties go to Stash's order",
  )
  assert.equal(S.dominantGender({}), 'FEMALE')
})

test('the default gender: list filter, then remembered, then largest pool', () => {
  // nothing remembered, no filter: the largest pool, 16, my library
  assert.deepEqual(S.quickChoice(null, 'FEMALE', null), {
    pool: 'library',
    size: 16,
    gender: 'FEMALE',
  })
  // remembered
  const saved = { gender: 'MALE', pool: 'favorites', size: 32 }
  assert.deepEqual(S.quickChoice(saved, 'FEMALE', null), {
    pool: 'favorites',
    size: 16,
    gender: 'MALE',
  })
  // the Performers list's gender filter wins, and the list is the pool
  assert.deepEqual(S.quickChoice(saved, 'FEMALE', listOf('NON_BINARY')), {
    pool: 'filter',
    size: 16,
    gender: 'NON_BINARY',
  })
  // a filter with no single gender (or "no gender") keeps the default
  assert.equal(S.quickChoice(saved, 'FEMALE', listOf('none')).gender, 'MALE')
  assert.equal(S.quickChoice(null, 'FEMALE', listOf(null)).gender, 'FEMALE')
  // a remembered filter pool needs a filtered list
  assert.equal(
    S.quickChoice({ pool: 'filter' }, 'FEMALE', null).pool,
    'library',
  )
  // a stray remembered value is not a gender
  assert.equal(S.prefs({ gender: 'robot' }, 'MALE').gender, 'MALE')
})

test("the setup sheet's first choice", () => {
  assert.deepEqual(S.sheetChoice(null, 'FEMALE', null), {
    pool: 'library',
    size: 16,
    gender: 'FEMALE',
  })
  // the list's gender, but the pool stays the remembered one
  assert.deepEqual(
    S.sheetChoice({ pool: 'favorites' }, 'FEMALE', listOf('MALE')),
    { pool: 'favorites', size: 16, gender: 'MALE' },
  )
  // a choice handed over is kept as it is
  const given = { gender: 'INTERSEX', pool: 'filter', size: 32 }
  assert.deepEqual(S.sheetChoice(null, 'FEMALE', listOf('MALE'), given), given)
  assert.equal(
    S.sheetChoice(null, 'FEMALE', null, given).pool,
    'library',
    'no filter, no filter pool',
  )
})

test('why the sheet shows its gender', () => {
  const base = { dominant: 'FEMALE', saved: null, listFilter: null }
  assert.deepEqual(
    S.genderWhy({ ...base, choice: { gender: 'FEMALE' }, picked: false }),
    { text: 'Female: your largest pool', forget: false },
  )
  assert.deepEqual(
    S.genderWhy({
      ...base,
      choice: { gender: 'MALE' },
      picked: false,
      saved: { gender: 'MALE' },
    }),
    { text: 'Remembered from your last pick', forget: true },
  )
  assert.equal(
    S.genderWhy({
      ...base,
      choice: { gender: 'MALE' },
      picked: false,
      listFilter: listOf('MALE'),
    }).text,
    "From the Performers list's filter",
  )
  assert.equal(
    S.genderWhy({ ...base, choice: { gender: 'MALE' }, picked: true }).text,
    'Remembered for next time (across browsers)',
  )
  assert.equal(
    S.genderWhy({ ...base, choice: { gender: 'FEMALE' }, picked: true }).text,
    'Your largest pool; picking it goes back to following the library',
  )
})

test('what the sheet remembers: a picked gender that is not the largest pool, never the size', () => {
  const c = { gender: 'MALE', pool: 'favorites', size: 32 }
  assert.deepEqual(S.rememberedPrefs(c, true, null, 'FEMALE'), {
    gender: 'MALE',
    pool: 'favorites',
  })
  assert.deepEqual(
    S.rememberedPrefs(
      { ...c, gender: 'FEMALE' },
      true,
      { gender: 'MALE' },
      'FEMALE',
    ),
    { gender: null, pool: 'favorites' },
    'picking the largest pool goes back to following the library',
  )
  assert.deepEqual(
    S.rememberedPrefs(c, false, { gender: 'NON_BINARY' }, 'FEMALE'),
    { gender: 'NON_BINARY', pool: 'favorites' },
    'no tap: the remembered gender stays',
  )
})

test('pool resolution: library, favorites and the list filter', () => {
  const lib = S.resolvePerformerPool(
    M,
    { gender: 'FEMALE', pool: 'library', size: 16 },
    null,
    stash,
  )
  assert.deepEqual(
    lib.ids,
    BR.performerPool(M, { gender: 'FEMALE', pool: 'library' }),
  )
  assert.equal(lib.size, 16)
  assert.equal(lib.pool, 'library')
  assert.equal(lib.poolLabel, 'Female')

  const fav = S.resolvePerformerPool(
    M,
    { gender: 'FEMALE', pool: 'favorites', size: 16 },
    null,
    stash,
  )
  assert.ok(fav.ids.every((id) => db.favoritePerformerIds.has(id)))
  assert.equal(fav.poolLabel, 'Female · favorites')
  assert.equal(fav.size, fav.ids.length >= 16 ? 16 : null)

  // the filter pool is the list's matches among the eligible
  const matches = [
    ...lib.ids.slice(0, 5),
    ...db.localPerformers.map((p) => p.id).slice(-3),
  ]
  const filtered = S.resolvePerformerPool(
    M,
    { gender: 'FEMALE', pool: 'filter', size: 16 },
    listOf('FEMALE', matches, 'Blonde'),
    stash,
  )
  assert.equal(filtered.pool, 'filter')
  assert.deepEqual(filtered.ids, lib.ids.slice(0, 5))
  assert.equal(filtered.size, null, 'five cannot fill 16')
  assert.equal(filtered.poolLabel, 'Female · Blonde')
  // ids not loaded yet: an empty pool, never the whole library
  assert.deepEqual(
    S.resolvePerformerPool(
      M,
      { gender: 'FEMALE', pool: 'filter', size: 16 },
      listOf('FEMALE', null),
      stash,
    ).ids,
    [],
  )
  // a filter pool without a filtered list is the library
  assert.equal(
    S.resolvePerformerPool(
      M,
      { gender: 'FEMALE', pool: 'filter', size: 16 },
      null,
      stash,
    ).pool,
    'library',
  )
  // 32 when picked and the pool fills it, else 16
  const n = lib.ids.length
  assert.equal(
    S.resolvePerformerPool(
      M,
      { gender: 'FEMALE', pool: 'library', size: 32 },
      null,
      stash,
    ).size,
    n >= 32 ? 32 : 16,
  )
})

test('Set genders fills a short pool', () => {
  const short = S.resolvePerformerPool(
    M,
    { gender: 'MALE', pool: 'library', size: 16 },
    null,
    stash,
  )
  const none = BR.genderless(M, stash).filter(BR.eligible)
  const edits = Object.fromEntries(none.map((p) => [p.id, 'MALE']))
  const filled = S.resolvePerformerPool(
    M,
    { gender: 'MALE', pool: 'library', size: 16 },
    null,
    (p) => S.liveGender(edits, p),
  )
  assert.equal(filled.ids.length, short.ids.length + none.length)
})

test('clip pools: every owned scene, or those a filter matches', () => {
  const all = S.scenePool(M, null)
  assert.deepEqual(
    all,
    db.owned.map((s) => s.id),
  )
  const unwatched = db.owned.find((s) => !s.local.play_count)
  const some = new Set([all[0], all[1], unwatched.id, 'not-a-scene'])
  assert.deepEqual(S.scenePool(M, some), [all[0], all[1], unwatched.id])
})

test("clip pools leave out audio-only scenes and Don't learn ones", () => {
  const rows = input.scenes.slice(0, 6).map((r, i) => ({
    ...r,
    files: [{ ...r.files[0], video_codec: i === 1 ? '' : 'h264' }],
  }))
  const small = buildDb({ ...input, scenes: rows })
  const ids = rows.map((r) => r.id)
  const M2 = createEngine(small).compute({ dontLearn: [ids[2]] })
  assert.equal(small.scenes.get(ids[1]).audioOnly, true)
  assert.equal(small.scenes.get(ids[0]).audioOnly, false)
  const kept = [ids[0], ids[3], ids[4], ids[5]].sort()
  assert.deepEqual(S.scenePool(M2, null).sort(), kept)
  // the Challenge round's library draws from the same scenes
  assert.deepEqual(
    BR.bracketScenes(M2)
      .map((s) => s.id)
      .sort(),
    kept,
  )
})

test('a Champions round seeds the distinct champions still in the library', () => {
  const female = BR.performerPool(M, { gender: 'FEMALE', pool: 'library' })
  const won = (id, i, extra = {}) => ({
    id: 'b' + i,
    kind: 'performer',
    gender: 'FEMALE',
    finishedAt: `2026-10-0${i}T10:00:00Z`,
    result: {
      champion: id,
      finalist: female[9],
      semifinalists: [],
      quarterfinalists: [],
    },
    ...extra,
  })
  const history = [
    won(female[0], 1),
    won(female[1], 2),
    won(female[0], 3),
    won(female[2], 4),
    won(female[5], 5, { champions: true }),
  ]
  assert.deepEqual(S.championsRoundPool(M, history, 'FEMALE'), {
    ids: [female[2], female[0], female[1]],
    size: 0,
  })
  history.push(won('gone', 6))
  assert.equal(
    S.championsRoundPool(M, history, 'FEMALE').size,
    0,
    'a champion no longer in the library does not count',
  )
  history.push(won(female[3], 7))
  assert.deepEqual(S.championsRoundPool(M, history, 'FEMALE'), {
    ids: [female[3], female[2], female[0], female[1]],
    size: 4,
  })
})

test('placed ids and putting custom fields back', () => {
  assert.deepEqual(
    S.placedIds({
      champion: 'a',
      finalist: 'b',
      semifinalists: ['c', 'd'],
      quarterfinalists: ['e', null],
    }),
    ['a', 'b', 'c', 'd', 'e'],
  )
  assert.deepEqual(S.placedIds(null), [])
  assert.deepEqual(
    S.restoreFieldsInput({
      [BR.FIELDS.titles]: 2,
      [BR.FIELDS.best]: 'champion',
      [BR.FIELDS.last]: null,
    }),
    {
      partial: { [BR.FIELDS.titles]: 2, [BR.FIELDS.best]: 'champion' },
      remove: [BR.FIELDS.last],
    },
  )
  assert.deepEqual(S.restoreFieldsInput({ [BR.FIELDS.titles]: null }), {
    remove: [BR.FIELDS.titles],
  })
  assert.deepEqual(S.restoreFieldsInput({}), {})
})
