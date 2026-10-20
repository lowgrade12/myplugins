import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  honoursMark,
  honoursOf,
  performerLine,
  performerLineFor,
  performerLineParts,
} from '../../src/js/features/performerLine.js'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import { syntheticLibrary } from './fixtures/synthetic.mjs'

const rated = (n, mean) => ({ n, mean, watched: n })

test('the line: scenes, then honours, then bracket movement', () => {
  assert.equal(
    performerLine({
      stats: rated(6, 4.94),
      honours: { champion: 3, finalist: 1 },
      offset: 0.2,
      gender: 'FEMALE',
    }),
    'You average 4.9★ on her scenes · 3× champion · rising in your brackets',
  )
  assert.deepEqual(
    performerLineParts({
      stats: rated(2, 2),
      honours: null,
      offset: -0.3,
      gender: 'MALE',
    }),
    ['You average 2.0★ on his scenes', 'slipping in your brackets'],
  )
})

test('the line: one rated scene is not an average', () => {
  assert.equal(
    performerLine({ stats: rated(1, 4), gender: 'FEMALE' }),
    'You rated one of her scenes 4.0★',
  )
})

test('the line: watched but unrated scenes', () => {
  const stats = { n: 0, mean: null, watched: 3 }
  assert.equal(
    performerLine({ stats, gender: 'FEMALE' }),
    "You've watched 3 of her scenes",
  )
  assert.equal(
    performerLine({ stats: { ...stats, watched: 1 }, gender: 'MALE' }),
    "You've watched 1 of his scenes",
  )
})

test('the line: pronouns follow the gender in Stash', () => {
  const line = (gender) => performerLine({ stats: rated(3, 4), gender })
  assert.match(line('FEMALE'), / her scenes$/)
  assert.match(line('TRANSGENDER_FEMALE'), / her scenes$/)
  assert.match(line('MALE'), / his scenes$/)
  assert.match(line('TRANSGENDER_MALE'), / his scenes$/)
  assert.match(line('NON_BINARY'), / their scenes$/)
  assert.match(line('INTERSEX'), / their scenes$/)
  assert.match(line(null), / their scenes$/)
  assert.match(line(undefined), / their scenes$/)
})

test('the line: a champion title outranks final appearances', () => {
  const honours = (champion, finalist) =>
    performerLine({ honours: { champion, finalist } })
  assert.equal(honours(1, 0), 'Bracket champion')
  assert.equal(honours(2, 4), '2× champion')
  assert.equal(honours(0, 1), 'Bracket finalist')
  assert.equal(honours(0, 3), '3× finalist')
})

test('the line: starts with a capital whatever comes first', () => {
  assert.equal(performerLine({ offset: 0.1 }), 'Rising in your brackets')
  assert.equal(performerLine({ offset: -0.1 }), 'Slipping in your brackets')
})

test('the line: nothing to say is null', () => {
  assert.equal(performerLine({}), null)
  assert.equal(
    performerLine({
      stats: { n: 0, mean: null, watched: 0 },
      honours: { champion: 0, finalist: 0 },
      offset: 0.049,
      gender: 'FEMALE',
    }),
    null,
    'a bracket nudge under 0.05★ is not movement',
  )
})

test('card mark: crown with a count from two titles, else a medal', () => {
  assert.equal(honoursMark(undefined), null)
  assert.equal(honoursMark({ champion: 0, finalist: 0 }), null)
  assert.deepEqual(honoursMark({ champion: 1, finalist: 2 }), {
    kind: 'champion',
    count: null,
    title: 'Bracket champion',
  })
  assert.deepEqual(honoursMark({ champion: 2, finalist: 0 }), {
    kind: 'champion',
    count: 2,
    title: 'Bracket champion ×2',
  })
  assert.deepEqual(honoursMark({ champion: 0, finalist: 1 }), {
    kind: 'finalist',
    count: null,
    title: 'Bracket finalist',
  })
  assert.equal(
    honoursMark({ champion: 0, finalist: 2 }).title,
    'Bracket finalist ×2',
  )
})

test('card mark and line: a trophy for a champion who beat your favorites', () => {
  assert.deepEqual(honoursMark({ champion: 1, finalist: 0, challenger: 1 }), {
    kind: 'challenger',
    count: null,
    title: 'Bracket champion who beat your favorites',
  })
  assert.deepEqual(honoursMark({ champion: 3, finalist: 1, challenger: 1 }), {
    kind: 'challenger',
    count: 3,
    title: 'Bracket champion ×3 who beat your favorites',
  })
  assert.equal(
    honoursMark({ champion: 1, finalist: 0, challenger: 0 }).kind,
    'champion',
  )
  assert.equal(
    performerLine({
      honours: { champion: 1, finalist: 0, challenger: 1 },
      gender: 'FEMALE',
    }),
    'Bracket champion · beat your favorites',
  )
})

const finished = (champion, finalist, kind = 'performer') => ({
  id: champion + finalist,
  kind,
  gender: 'FEMALE',
  status: 'done',
  finishedAt: '2026-10-01T20:00:00Z',
  result: { champion, finalist, semifinalists: [], quarterfinalists: [] },
})

test('honours are computed once per Hall of Fame', () => {
  const history = [
    finished('a', 'b'),
    finished('a', 'c'),
    finished('x', 'y', 'clip'),
  ]
  const h = honoursOf(history)
  assert.equal(honoursOf(history), h, 'the same history gives the same object')
  assert.deepEqual(h.a, { champion: 2, finalist: 0, challenger: 0 })
  assert.equal(h.x, undefined, 'clip brackets give no performer honours')
  assert.notEqual(honoursOf([...history]), h)
})

test('the line from the engine and the Hall of Fame', () => {
  const { input } = syntheticLibrary()
  const db = buildDb(input)
  const engine = createEngine(db)
  const M0 = engine.compute({})
  // An upset: the performer the model likes least among those with rated
  // scenes beats the one it likes most, twice.
  const byAffinity = input.performers
    .filter((x) => M0.performerSceneStats(x.id).n >= 2)
    .sort((a, b) => M0.performerAffinity(a.id) - M0.performerAffinity(b.id))
  const p = byAffinity[0]
  const other = byAffinity[byAffinity.length - 1]
  const st = M0.performerSceneStats(p.id)
  const her = { FEMALE: 'her', MALE: 'his' }[p.gender] || 'their'
  const average = `You average ${(Math.round(st.mean * 10) / 10).toFixed(1)}★ on ${her} scenes`

  assert.equal(performerLineFor(M0, [], p), average)

  const M = engine.compute({
    decisions: [
      { kind: 'performer', winner: p.id, loser: other.id, bracket: 'b1' },
      { kind: 'performer', winner: p.id, loser: other.id, bracket: 'b2' },
    ],
  })
  const history = [finished(p.id, other.id), finished(p.id, other.id)]
  assert.equal(
    performerLineFor(M, history, p),
    `${average} · 2× champion · rising in your brackets`,
  )
  assert.equal(
    performerLineFor(M, history, other),
    performerLine({
      stats: M.performerSceneStats(other.id),
      honours: { champion: 0, finalist: 2 },
      offset: M.bt.performerOffset.get(other.id),
      gender: other.gender,
    }),
  )
  assert.match(performerLineFor(M, history, other), /2× finalist · slipping/)

  // before the model is ready, the honours alone
  assert.equal(performerLineFor(null, history, p), '2× champion')
})
