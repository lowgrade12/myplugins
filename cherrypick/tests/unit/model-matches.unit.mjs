// Learning from other plugins' matches: what Ascension, HotOrNot_V3 and
// Xenith write to custom fields becomes bracket picks, each match once, at
// half a pick's weight, ahead of Cherry Pick's own picks and only with the
// switch on (it starts on). Every record here is synthetic, in the shape
// each plugin writes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import { BT, replay } from '../../src/js/model/bt.js'
import {
  matchDecisions,
  SAME_MATCH_MS,
  sourcesText,
} from '../../src/js/model/matches.js'
import { performerLineFor } from '../../src/js/features/performerLine.js'
import { SETTING_DEFAULTS } from '../../src/js/storage/settings.js'
import { AS_OF, syntheticLibrary } from './fixtures/synthetic.mjs'

const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)

// A match t seconds after the first, as each plugin writes it
const T0 = Date.parse('2026-10-01T20:00:00Z')
const at = (t) => new Date(T0 + t * 1000).toISOString()
const asc = (opp, won, t) => ({
  date: at(t),
  opponent: `${opp}:Someone`,
  won,
  AscRatingAfter: 61.25,
})
const ascScene = (opp, won, t) => ({
  date: at(t),
  opponentId: String(opp),
  won,
  ratingAfter: 60,
  AscRatingAfter: 6.1,
})
const hon = (opp, won, t) => ({
  date: at(t),
  opponent: `${opp}:Someone`,
  won,
  ratingAfter: 55,
})
const xen = (opp, won, t) => ({
  date: at(t),
  opponent: `${opp}:A title: with colons`,
  won,
  ratingAfter: 61,
})
const xenDraw = (opp, t) => ({
  date: at(t),
  opponent: `${opp}:Someone`,
  draw: true,
  ratingAfter: 60,
})
const list = (...entries) => JSON.stringify(entries)

// Five library performers and five owned scenes, ids 1-5 in both, so a
// scene and a performer can share an id
const IDS = ['1', '2', '3', '4', '5']
function tinyDb({ performers = {}, scenes = {} } = {}) {
  return buildDb({
    asOf: AS_OF,
    performers: IDS.map((id) => ({
      id,
      name: `Performer ${id}`,
      custom_fields: performers[id] || {},
    })),
    scenes: IDS.map((id) => ({
      id,
      title: `Scene ${id}`,
      created_at: `2026-01-0${id}T00:00:00Z`,
      custom_fields: scenes[id] || {},
    })),
  })
}
const picks = (db) =>
  matchDecisions(db).map((d) => `${d.kind} ${d.winner}>${d.loser} ${d.source}`)

// ---------------------------------------------------------------- reading

test('each plugin’s lists read as picks, with the plugin that played them', () => {
  const db = tinyDb({
    performers: {
      1: { performer_record: list(asc('2', true, 0), hon('3', false, 10)) },
      4: { xenith_record: list(xen('5', true, 20)) },
    },
    scenes: {
      1: { scene_record: list(ascScene(2, false, 30)) },
      3: { xenith_record: list(xen('4', true, 40)) },
    },
  })
  assert.deepEqual(picks(db), [
    'performer 1>2 Ascension',
    'performer 3>1 HotOrNot',
    'performer 4>5 Xenith',
    'clip 2>1 Ascension',
    'clip 3>4 Xenith',
  ])
})

test('skips, draws, unknown opponents and unreadable entries teach nothing', () => {
  const db = tinyDb({
    performers: {
      1: {
        performer_record: list(
          asc('2', null, 0), // Ascension's skip
          hon('2', null, 1), // HotOrNot's skip
          { ...hon('0', true, 2) }, // "0:Unknown"
          { date: at(3), opponent: 'Unknown', won: true },
          { date: 'not a date', opponent: '2:Someone', won: true },
          { opponent: '2:Someone', won: true }, // no date
          { date: at(4), opponent: '1:Themself', won: true },
          { date: at(5), opponent: '2:Someone', won: 'true' },
          null,
          'a string',
          hon('3', true, 6), // the one real match
        ),
      },
      2: { xenith_record: list(xenDraw('3', 7)) },
      3: { performer_record: '[{"date": "2026-' }, // cut off
      4: { performer_record: JSON.stringify({ not: 'a list' }) },
    },
  })
  assert.deepEqual(picks(db), ['performer 1>3 HotOrNot'])
})

test('opponents not in the library are left out', () => {
  const db = tinyDb({
    performers: { 1: { performer_record: list(asc('99', true, 0)) } },
    scenes: {
      // no scene 77 in the library
      1: { scene_record: list(ascScene(77, true, 0), ascScene(2, true, 5)) },
    },
  })
  assert.deepEqual(picks(db), ['clip 1>2 Ascension'])
})

test('performer matches and scene matches stay apart when ids are shared', () => {
  const db = tinyDb({
    performers: { 1: { performer_record: list(asc('2', true, 0)) } },
    scenes: { 1: { scene_record: list(ascScene(2, true, 0)) } },
  })
  assert.deepEqual(picks(db), ['performer 1>2 Ascension', 'clip 1>2 Ascension'])
})

test('picks come out oldest first, whichever record holds them', () => {
  const db = tinyDb({
    performers: {
      1: { performer_record: list(hon('2', true, 300), hon('3', true, 100)) },
      4: { performer_record: list(hon('5', false, 200)) },
    },
  })
  assert.deepEqual(picks(db), [
    'performer 1>3 HotOrNot',
    'performer 5>4 HotOrNot',
    'performer 1>2 HotOrNot',
  ])
})

// ---------------------------------------------------------------- dedupe

test('a match both players recorded counts once', () => {
  const db = tinyDb({
    performers: {
      // Ascension writes both sides at once
      1: { performer_record: list(asc('2', true, 0)) },
      2: { performer_record: list(asc('1', false, 0.004)) },
      // HotOrNot writes the loser after the winner's update returns
      3: { performer_record: list(hon('4', true, 100)) },
      4: { performer_record: list(hon('3', false, 102.5)) },
    },
    scenes: {
      // Xenith gives both sides one date
      1: { xenith_record: list(xen('5', true, 200)) },
      5: { xenith_record: list(xen('1', false, 200)) },
    },
  })
  assert.deepEqual(picks(db), [
    'performer 1>2 Ascension',
    'performer 3>4 HotOrNot',
    'clip 1>5 Xenith',
  ])
})

test('a match only one player still holds counts once', () => {
  // the other side has dropped out of a full list
  const db = tinyDb({
    performers: { 2: { performer_record: list(asc('1', false, 0)) } },
  })
  assert.deepEqual(picks(db), ['performer 1>2 Ascension'])
})

test('Xenith’s copy of an older list counts once, as the plugin that played it', () => {
  const old = [hon('2', true, 0), hon('3', false, 50)]
  const db = tinyDb({
    performers: {
      1: {
        performer_record: list(...old),
        xenith_record: list(...old, xen('4', true, 100)),
      },
    },
  })
  assert.deepEqual(picks(db), [
    'performer 1>2 HotOrNot',
    'performer 3>1 HotOrNot',
    'performer 1>4 Xenith',
  ])
})

test('a quick rematch counts twice, and so does a win each way', () => {
  const db = tinyDb({
    performers: {
      1: {
        performer_record: list(
          asc('2', true, 0),
          asc('2', true, 5),
          asc('3', true, 20),
        ),
      },
      2: { performer_record: list(asc('1', false, 0), asc('1', false, 5)) },
      3: { performer_record: list(asc('1', true, 10), asc('1', false, 20)) },
    },
  })
  assert.deepEqual(picks(db), [
    'performer 1>2 Ascension',
    'performer 1>2 Ascension',
    'performer 3>1 Ascension',
    'performer 1>3 Ascension',
  ])
})

test('two sides further apart than SAME_MATCH_MS are two matches', () => {
  const t = SAME_MATCH_MS / 1000
  const near = tinyDb({
    performers: {
      1: { performer_record: list(hon('2', true, 0)) },
      2: { performer_record: list(hon('1', false, t)) },
    },
  })
  const far = tinyDb({
    performers: {
      1: { performer_record: list(hon('2', true, 0)) },
      2: { performer_record: list(hon('1', false, t + 1)) },
    },
  })
  assert.equal(matchDecisions(near).length, 1)
  assert.equal(matchDecisions(far).length, 2)
})

// ---------------------------------------------------------------- weighting

test('a match moves things half as far as one of your picks', () => {
  assert.equal(BT.external, 0.5)
  const ctx = {
    baseScene: (id) => (id === '1' ? 3.2 : 3.6),
    keys: (id) => (id === '1' ? ['p:7', 's:2'] : ['p:8', 's:2']),
    basePerformer: (id) => (id === '1' ? 0.1 : -0.2),
  }
  for (const kind of ['performer', 'clip']) {
    const own = replay([{ kind, winner: '1', loser: '2' }], ctx)
    const theirs = replay(
      [{ kind, winner: '1', loser: '2', source: 'Ascension' }],
      ctx,
    )
    for (const m of ['sceneOffset', 'performerOffset', 'featureDelta'])
      for (const [k, v] of own[m])
        close(theirs[m].get(k), BT.external * v, `${kind} ${m} ${k}`)
  }
})

test('your bracket counts and bracket offsets leave other plugins’ matches out', () => {
  const ctx = { baseScene: () => 3, keys: () => [], basePerformer: () => 0 }
  const bt = replay(
    [
      { kind: 'performer', winner: '1', loser: '2', source: 'HotOrNot' },
      { kind: 'performer', winner: '1', loser: '3', source: 'Xenith' },
      { kind: 'clip', winner: '4', loser: '1', source: 'Ascension' },
      { kind: 'performer', winner: '2', loser: '1', bracket: 'b1' },
    ],
    ctx,
  )
  assert.deepEqual([...bt.wins], [['2', 1]])
  assert.deepEqual([...bt.losses], [['1', 1]])
  assert.ok(bt.bracketPerformerOffset.get('1') < 0, 'its bracket loss alone')
  assert.ok(
    bt.performerOffset.get('1') > bt.bracketPerformerOffset.get('1'),
    'its two wins elsewhere lift it',
  )
  const p1 = bt.performerMatches.get('1')
  assert.deepEqual(
    [p1.won, p1.lost, sourcesText(p1.sources)],
    [2, 0, 'HotOrNot and Xenith'],
  )
  const s1 = bt.sceneMatches.get('1')
  assert.deepEqual([s1.won, s1.lost, [...s1.sources]], [0, 1, ['Ascension']])
})

// ---------------------------------------------------------------- the engine

// The synthetic library, with Ascension's and HotOrNot's matches among its
// performers and scenes. The first performers and scenes win most.
function rankedLibrary() {
  const { input } = syntheticLibrary()
  const lib = structuredClone(input)
  const ps = lib.performers.slice(0, 12)
  const ss = lib.scenes.slice(0, 12)
  const rec = new Map()
  const push = (row, field, e) => {
    const key = row.id + field
    if (!rec.has(key)) rec.set(key, { row, field, list: [] })
    rec.get(key).list.push(e)
  }
  let t = 0
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      t += 60
      // the lower index wins, except every fifth match
      const upset = (i + j) % 5 === 0
      push(ps[i], 'performer_record', hon(ps[j].id, !upset, t))
      push(ps[j], 'performer_record', hon(ps[i].id, upset, t + 1))
      push(ss[i], 'scene_record', ascScene(ss[j].id, !upset, t))
      push(ss[j], 'scene_record', ascScene(ss[i].id, upset, t))
    }
  for (const { row, field, list: l } of rec.values())
    row.custom_fields = { ...row.custom_fields, [field]: JSON.stringify(l) }
  return { lib, ps, ss }
}

test('the switch starts on, and off teaches nothing', () => {
  assert.equal(SETTING_DEFAULTS.learnFromMatches, true)
  const { lib } = rankedLibrary()
  const engine = createEngine(buildDb(lib))
  const M = engine.compute({})
  assert.equal(M.matches.count, 0)
  assert.equal(M.bt.count, 0)
  assert.equal(M.bt.performerMatches.size, 0)
  const on = engine.compute({ learnFromMatches: true })
  assert.equal(on.matches.count, 2 * 66, '66 performer and 66 scene matches')
  assert.deepEqual(on.matches.sources, ['Ascension', 'HotOrNot'])
})

test('matches replay ahead of your own picks', () => {
  const { lib, ps, ss } = rankedLibrary()
  const db = buildDb(lib)
  const own = [
    { kind: 'performer', winner: ps[11].id, loser: ps[0].id, bracket: 'b1' },
    { kind: 'clip', winner: ss[10].id, loser: ss[1].id, bracket: 'b2' },
  ]
  const a = createEngine(db).compute({ decisions: own, learnFromMatches: true })
  const b = createEngine(db).compute({
    decisions: [...matchDecisions(db), ...own],
  })
  for (const id of db.scenes.keys())
    close(a.prediction(id).value, b.prediction(id).value, `scene ${id}`)
  for (const p of db.localPerformers)
    close(
      a.performerAffinity(p.id),
      b.performerAffinity(p.id),
      `performer ${p.id}`,
    )
})

test('matches lift the winners: the first performers and scenes rise', () => {
  const { lib, ps, ss } = rankedLibrary()
  const engine = createEngine(buildDb(lib))
  const off = engine.compute({})
  const on = engine.compute({ learnFromMatches: true })
  // the replay weighs recent results more, so compare the ends of the field
  const mean = (rows, f) => rows.reduce((t, r) => t + f(r.id), 0) / rows.length
  const top = (rows) => rows.slice(0, 4)
  const bottom = (rows) => rows.slice(-4)
  const perf = (id) => on.bt.performerOffset.get(id) || 0
  const scene = (id) => on.bt.sceneOffset.get(id) || 0
  assert.ok(mean(top(ps), perf) > 0.1)
  assert.ok(mean(bottom(ps), perf) < -0.1)
  assert.ok(mean(top(ss), scene) > 0.1)
  assert.ok(mean(bottom(ss), scene) < -0.1)
  const lift = (id) => on.performerAffinity(id) - off.performerAffinity(id)
  assert.ok(mean(top(ps), lift) > mean(bottom(ps), lift), 'affinity follows')
})

test("Don't learn from this keeps a scene's matches out", () => {
  const { lib, ss } = rankedLibrary()
  const engine = createEngine(buildDb(lib))
  const all = engine.compute({ learnFromMatches: true })
  const M = engine.compute({ learnFromMatches: true, dontLearn: [ss[0].id] })
  assert.equal(M.matches.count, all.matches.count - 11)
  assert.equal(M.bt.sceneMatches.get(ss[0].id), undefined)
  assert.equal(M.bt.sceneOffset.get(ss[0].id), undefined)
})

test('what the UI says names the plugin, never your brackets', () => {
  const { lib, ps, ss } = rankedLibrary()
  const db = buildDb(lib)
  const M = createEngine(db).compute({ learnFromMatches: true })
  // no "rising in your brackets" from HotOrNot's matches
  assert.doesNotMatch(
    performerLineFor(M, [], { id: ps[0].id, gender: null }) || '',
    /brackets/,
  )
  // scene reasons from matches
  const texts = ss.map((s) => M.reason(s.id, true)?.text || '')
  assert.ok(
    texts.some((t) => /^Won \d+ of 11 matches in Ascension$/.test(t)),
    texts.join(' | '),
  )
  assert.ok(
    texts.every((t) => !/bracket/.test(t)),
    texts.join(' | '),
  )
})
