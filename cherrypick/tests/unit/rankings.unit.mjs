import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ELO_FIELDS,
  isMirrored,
  isRanked,
  markRatingSources,
  pluginRating,
  PRIME_MIN_SHARED,
  primedIds,
  rankingPlugins,
  ratingManagers,
  RESTASH_MIRROR,
} from '../../src/js/model/rankings.js'
import { FIELD_PREFIX } from '../../src/js/name.js'

// Rows as Ascension's Prime leaves them: `n` unrated records, 70% on one
// value in 1–9, 25% on one in 25–39, the rest on 40 (asc_taskmaster.py's
// int() truncation included). ids start at `from`.
function primed(n, { low = 6, mid = 31, from = 1, group = null } = {}) {
  const f = Math.floor(n * 0.7)
  const d = Math.floor(n * 0.25)
  return Array.from({ length: n }, (_, i) => ({
    id: 'p' + (from + i),
    rating100: i < f ? low : i < f + d ? mid : 40,
    group,
  }))
}
// Ratings a person set by hand, cycling through the given values
const byHand = (n, values, { from = 1000, group = null } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'u' + (from + i),
    rating100: values[i % values.length],
    group,
  }))
const ids = (rows) => rows.map((r) => r.id).sort()
const sorted = (set) => [...set].sort()

test('a record is ranked when it carries any of the Elo plugins’ fields', () => {
  assert.deepEqual(ELO_FIELDS, [
    'hotornot_stats',
    'elo_matches',
    'performer_record',
    'scene_record',
    'xenith_stats',
    'xenith_record',
  ])
  for (const k of ELO_FIELDS)
    assert.equal(isRanked({ [k]: k === 'elo_matches' ? 4 : '{}' }), true, k)
  assert.equal(isRanked({ hotornot_stats: '' }), false, 'empty is none')
  assert.equal(isRanked({ hotornot_stats: null }), false)
  assert.equal(isRanked({}), false)
  assert.equal(isRanked(null), false)
  assert.equal(
    isRanked({ [FIELD_PREFIX + 'titles']: 2, other: 'x' }),
    false,
    "Cherry Pick's own fields are not a ranking",
  )
})

// What Restash writes on each record it scores (writer.py)
const restash = (score) => ({
  restash_score: score,
  restash_raw: 0.6172,
  restash_components: '{"affinity":0.41}',
  restash_updated: '2026-10-15T08:00:00Z',
})

test('a record Xenith ranks is ranked, by its own fields or the legacy ones', () => {
  // Xenith 3.2.0's matchmaking.js: one match's writes
  const xenith = {
    xenith_stats: JSON.stringify({ total_matches: 4, wins: 3, losses: 1 }),
    xenith_record: JSON.stringify([{ opponentId: '7', won: true }]),
  }
  assert.equal(isRanked(xenith), true)
  assert.equal(isRanked({ xenith_stats: xenith.xenith_stats }), true)
  assert.equal(isRanked({ xenith_record: xenith.xenith_record }), true)
  // a library Xenith has not migrated keeps HotOrNot's names
  assert.equal(isRanked({ hotornot_stats: '{}', performer_record: '[]' }), true)
  assert.equal(pluginRating({ rating100: 64, custom_fields: xenith }), 'elo')
  assert.equal(
    pluginRating({
      rating100: 64,
      custom_fields: { ...xenith, ...restash(64) },
    }),
    'elo',
    'a ranking wins over a mirror',
  )
})

test("a rating equal to Restash's score is its mirror; any other stays the user's", () => {
  assert.equal(isMirrored(62, restash(62)), true)
  assert.equal(
    isMirrored(62, restash('62')),
    true,
    'Stash may return the score as a string',
  )
  assert.equal(isMirrored(80, restash(62)), false, 'set by hand')
  assert.equal(isMirrored(null, restash(62)), false, 'unrated')
  assert.equal(isMirrored(62, restash('')), false)
  assert.equal(isMirrored(62, { restash_score: null }), false)
  assert.equal(isMirrored(62, {}), false)
  assert.equal(isMirrored(62, null), false)
  // Restash's other fields are no ranking
  const rest = { ...restash(62), restash_score: undefined }
  assert.equal(isMirrored(62, rest), false)
  assert.equal(isRanked(restash(62)), false)
  assert.equal(
    pluginRating({ rating100: 62, custom_fields: restash(62) }),
    'mirror',
  )
  assert.equal(
    pluginRating({ rating100: 80, custom_fields: restash(62) }),
    null,
  )
  assert.equal(pluginRating({ rating100: 80, custom_fields: null }), null)
})

test('Ascension and HotOrNot are found by their real plugin ids, enabled only', () => {
  const p = (id, enabled = true, name = id) => ({ id, name, enabled })
  // Ascension 1.4.1's zip holds Release/ascension.yml and
  // Beta-Builds/ascension-beta.yml; HotOrNot's builds name theirs hotornot,
  // hotOrNot, hotOrNotV2 and hot_or_not.
  assert.deepEqual(rankingPlugins([p('ascension', true, 'Ascension')]), [
    'Ascension',
  ])
  assert.deepEqual(rankingPlugins([p('ascension-beta', true, 'Ascension')]), [
    'Ascension',
  ])
  for (const id of ['hotornot', 'hotOrNot', 'hotOrNotV2', 'hot_or_not'])
    assert.deepEqual(rankingPlugins([p(id)]), ['HotOrNot'], id)
  assert.deepEqual(
    rankingPlugins([p('renamed', true, 'HotOrNot_V3')]),
    ['HotOrNot'],
    'a fork that renames its file keeps the name',
  )
  assert.deepEqual(
    rankingPlugins([
      p('ascension'),
      p('ascension-beta', false),
      p('hotOrNot'),
      p('CherryPick', true, 'Cherry Pick'),
    ]),
    ['Ascension', 'HotOrNot'],
  )
  assert.deepEqual(rankingPlugins([p('ascension', false)]), [], 'disabled')
  assert.deepEqual(
    rankingPlugins([p('Juicy'), p('stashAscend', true, 'Stash Ascend')]),
    [],
  )
  assert.deepEqual(rankingPlugins(null), [])
})

test('Xenith is found by its plugin id or name, enabled only', () => {
  const p = (id, enabled = true, name = id) => ({ id, name, enabled })
  // Xenith 3.2.0 ships xenith.yml; its stable and canary builds share it
  assert.deepEqual(rankingPlugins([p('xenith', true, 'Xenith')]), ['Xenith'])
  assert.deepEqual(rankingPlugins([p('renamed', true, 'Xenith')]), ['Xenith'])
  assert.deepEqual(rankingPlugins([p('xenith', false, 'Xenith')]), [])
  assert.deepEqual(
    rankingPlugins([p('ascension'), p('xenith', true, 'Xenith')]),
    ['Ascension', 'Xenith'],
  )
  // Restash scores; it ranks nothing from Stash's ratings
  assert.deepEqual(rankingPlugins([p('restash', true, 'Restash')]), [])
})

test('Prime: a primed library is found, and the ratings set by hand stay', () => {
  const prime = primed(100)
  const mine = byHand(20, [60, 80, 100, 90, 70])
  assert.deepEqual(sorted(primedIds([...prime, ...mine])), ids(prime))
  // once the user rated most of it by hand, the same values are a minority
  const many = byHand(150, [60, 80, 100, 90, 70])
  assert.deepEqual(sorted(primedIds([...prime, ...many])), [])
})

test('Prime: ordinary star ratings are never mistaken for it', () => {
  // full, half and quarter stars: 1–9 never comes up
  const stars = byHand(200, [20, 40, 40, 60, 80, 100, 30, 25, 35])
  assert.equal(primedIds(stars).size, 0)
  // a few deliberate 0.5s on the ten-point scale are too few to be shared
  const decimal = [
    ...byHand(PRIME_MIN_SHARED - 1, [5]),
    ...byHand(10, [30, 40], { from: 2000 }),
  ]
  assert.equal(primedIds(decimal).size, 0)
  // a shared low value alone is not Prime's shape: it fills two bands or three
  assert.equal(primedIds(byHand(10, [5])).size, 0)
})

test('Prime: a band the user rates in too stays theirs', () => {
  const prime = primed(100)
  // sixty two-star ratings: far more 40s than Prime's 5%
  const twos = byHand(60, [40])
  const found = primedIds([...prime, ...twos])
  assert.deepEqual(
    sorted(found),
    ids(prime.filter((r) => r.rating100 !== 40)),
    'the 1–9 and 25–39 values go; every 40 stays',
  )
})

test('Prime: a gender the user rated by hand keeps its ratings', () => {
  const men = primed(20, { low: 3, mid: 28, group: 'MALE' })
  const women = byHand(40, [60, 80, 100, 40], { group: 'FEMALE' })
  const found = primedIds([...men, ...women], (r) => r.group)
  assert.deepEqual(sorted(found), ids(men))
})

test('Prime: a second run, with its own values, is found too', () => {
  const first = primed(100)
  const second = primed(20, { low: 2, mid: 27, from: 500 })
  const mine = byHand(10, [80, 100])
  assert.deepEqual(
    sorted(primedIds([...first, ...second, ...mine])),
    ids([...first, ...second]),
  )
})

test('rating sources: a ranked record is elo, and stays out of the Prime count', () => {
  const recs = [
    ...primed(30).map((r) => ({ id: r.id, local: { ...r } })),
    // Ascension battled these: their ratings moved off Prime's values
    ...[55, 6, 72].map((v, i) => ({
      id: 'e' + i,
      local: {
        rating100: v,
        custom_fields: { hotornot_stats: '{"total_matches":3}' },
      },
    })),
    // ranked, then reset by Ascension's "Reset All Performer Ratings"
    {
      id: 'reset',
      local: { rating100: null, custom_fields: { elo_matches: 2 } },
    },
    { id: 'mine', local: { rating100: 100, custom_fields: {} } },
  ]
  markRatingSources(recs, (r) => r.local)
  const by = Object.fromEntries(recs.map((r) => [r.id, r.local.ratingSource]))
  assert.equal(by.e0, 'elo')
  assert.equal(by.e1, 'elo', 'a ranked 6 is a ranking, not Prime')
  assert.equal(by.reset, 'elo')
  assert.equal(by.mine, null)
  for (const r of primed(30)) assert.equal(by[r.id], 'primed', r.id)
})

test('rating sources: Xenith is elo, a Restash mirror is mirror, and neither counts toward Prime', () => {
  const recs = [
    ...primed(30).map((r) => ({ id: r.id, local: { ...r } })),
    // Xenith's Elo scores, one sitting on Prime's low band
    ...[48, 6].map((v, i) => ({
      id: 'x' + i,
      local: {
        rating100: v,
        custom_fields: { xenith_stats: '{"total_matches":2}' },
      },
    })),
    // Restash's mirror on: rating100 is its score
    ...[71, 33, 6].map((v, i) => ({
      id: 'r' + i,
      local: { rating100: v, custom_fields: restash(String(v)) },
    })),
    // scored by Restash with its mirror off: the rating is the user's
    { id: 'mine', local: { rating100: 80, custom_fields: restash(57) } },
    { id: 'unrated', local: { rating100: null, custom_fields: restash(57) } },
  ]
  markRatingSources(recs, (r) => r.local)
  const by = Object.fromEntries(recs.map((r) => [r.id, r.local.ratingSource]))
  assert.equal(by.x0, 'elo')
  assert.equal(by.x1, 'elo')
  for (const id of ['r0', 'r1', 'r2']) assert.equal(by[id], 'mirror', id)
  assert.equal(by.mine, null)
  assert.equal(by.unrated, null)
  for (const r of primed(30)) assert.equal(by[r.id], 'primed', r.id)
})

test('who manages Stash ratings: the ranking plugins, and Restash with its mirror on', () => {
  const p = (id, enabled = true, name = id) => ({ id, name, enabled })
  assert.equal(RESTASH_MIRROR, 'mirrorToRating100')
  const on = { restash: { [RESTASH_MIRROR]: true } }
  assert.deepEqual(ratingManagers([p('xenith', true, 'Xenith')], {}), [
    'Xenith',
  ])
  assert.deepEqual(ratingManagers([p('restash', true, 'Restash')], on), [
    'Restash',
  ])
  assert.deepEqual(
    ratingManagers([p('restash', true, 'Restash')], {
      restash: { [RESTASH_MIRROR]: 'true' },
    }),
    ['Restash'],
    'a setting Stash returns as text',
  )
  assert.deepEqual(
    ratingManagers([p('restash', true, 'Restash')], {
      restash: { [RESTASH_MIRROR]: false },
    }),
    [],
    'mirror off: its score stays in its own fields',
  )
  assert.deepEqual(
    ratingManagers([p('restash', true, 'Restash')], {}),
    [],
    'mirror never set',
  )
  assert.deepEqual(
    ratingManagers([p('restash', false, 'Restash')], on),
    [],
    'disabled',
  )
  assert.deepEqual(
    ratingManagers([p('hotornot', false), p('stash-curator', true)], on),
    [],
    'Curator writes no rating',
  )
  assert.deepEqual(ratingManagers(null, null), [])
})
