import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import {
  createEngine,
  badgeLabel,
  blameKey,
  keyLabel,
  NI_PENALTY,
} from '../../src/js/model/index.js'
import { replay } from '../../src/js/model/bt.js'
import { behaviourOf, barelyPlayed } from '../../src/js/model/behaviour.js'
import { sceneFeatures } from '../../src/js/model/taste.js'
import {
  approx,
  genderLabel,
  isPlaceholderTag,
  localDay,
  pronoun,
  setGenderResolver,
  timeAgo,
} from '../../src/js/model/util.js'
import { syntheticLibrary, withBookkeepingTags } from './fixtures/synthetic.mjs'

const { input, taste } = syntheticLibrary()
const db = buildDb(input)
const engine = createEngine(db)
const M = engine.compute({})
const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)

test('Your score beats your average on ratings it has not seen', () => {
  const cv = M.cv
  assert.equal(cv.folds, 5)
  assert.equal(cv.n, M.fits.rated.length, 'each rated scene held out once')
  assert.ok(cv.maeModel < cv.maeBase, `MAE ${cv.maeModel} vs ${cv.maeBase}`)
  // the mockup: within half a star 5 times in 10, against 3 in 10 for your average
  assert.ok(cv.withinModel >= 0.5, `model within ½★ ${cv.withinModel}`)
  assert.ok(cv.withinBase <= 0.35, `average within ½★ ${cv.withinBase}`)
  assert.equal(M.gate, true)
})

test('it holds on other libraries drawn from the same taste', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const Mx = createEngine(buildDb(syntheticLibrary({ seed }).input)).compute(
      {},
    )
    assert.ok(Mx.cv.maeModel < Mx.cv.maeBase, `seed ${seed}: MAE`)
    assert.ok(Mx.cv.withinModel > Mx.cv.withinBase, `seed ${seed}: within ½★`)
    assert.equal(Mx.gate, true, `seed ${seed}: gate`)
  }
})

test('the model recovers the hidden taste', () => {
  const W = M.fits.content.W
  for (const id of taste.lovedPerformerIds)
    assert.ok(
      W.get('p:' + id) > 0.2,
      `loved performer ${id}: ${W.get('p:' + id)}`,
    )
  for (const id of taste.dislikedPerformerIds)
    assert.ok(
      W.get('p:' + id) < -0.2,
      `disliked performer ${id}: ${W.get('p:' + id)}`,
    )
  assert.ok(W.get('s:' + taste.favouredStudioId) > 0.2, 'favoured studio')
  for (const id of taste.likedTagIds)
    assert.ok(W.get('t:' + id) > 0, `liked tag ${id}`)
  for (const id of taste.dislikedTagIds)
    assert.ok(W.get('t:' + id) < 0, `disliked tag ${id}`)
  // performer affinity, which seeds performer brackets, agrees
  const aff = (ids) => ids.map((id) => M.performerAffinity(id))
  assert.ok(
    Math.min(...aff(taste.lovedPerformerIds)) >
      Math.max(...aff(taste.dislikedPerformerIds)),
  )
})

test('the gate stays shut without ten ratings to check against', () => {
  const rated = db.owned.filter((s) => s.local.rating100 != null)
  const overrides = Object.fromEntries(rated.slice(5).map((s) => [s.id, null]))
  const Mx = createEngine(db).compute({ overrides })
  assert.equal(Mx.fits.rated.length, 5)
  assert.equal(Mx.cv, null)
  assert.equal(Mx.gate, false)
})

test('predictions stay on the star scale and rated scenes keep their rating', () => {
  for (const s of db.scenes.values()) {
    const v = M.prediction(s.id).value
    assert.ok(v >= 0.5 && v <= 5, `${s.id}: ${v}`)
  }
  const s = db.owned.find((x) => x.local.rating100 === 80)
  assert.equal(M.estimate(s.id), 4)
  assert.equal(M.rating(s), 80)
})

test('reasons are sentences that name the feature behind them', () => {
  let named = 0
  for (const s of db.owned) {
    const r = M.reason(s.id)
    assert.ok(r && r.text, s.id)
    assert.match(r.text, /^[A-Z]/)
    assert.doesNotMatch(r.text, /\.$|undefined|null|NaN/)
    const k = r.key
    if (!k) continue
    const id = k.slice(2)
    if (k[0] === 'p') {
      const p = db.performers.get(id)
      assert.ok(
        r.text.includes(p.name) ||
          /^You rated (her|his|their) other scene/.test(r.text),
        r.text,
      )
      if (taste.lovedPerformerIds.includes(id)) named++
    } else if (k[0] === 's')
      assert.ok(
        r.text.includes(db.studios.get(id).name) ||
          /^Same studio as/.test(r.text),
        r.text,
      )
    else if (k[0] === 't')
      assert.ok(r.text.includes(db.tags.get(id).name), r.text)
    else if (k === 'b')
      assert.match(r.text, /^You('ve come back| watched it| keep it| stopped)/)
  }
  assert.ok(named > 0, 'some reasons name a loved performer')
  // a loved performer's reason points the right way
  const lovedId = taste.lovedPerformerIds[0]
  const s = db.owned.find((x) => {
    const r = M.reason(x.id)
    return r.key === 'p:' + lovedId
  })
  assert.match(
    M.reason(s.id).text,
    /^You average \d\.\d★ on Performer \d+'s scenes$/,
  )
})

test('Not interested takes 0.18 stars off what made the card appear', () => {
  const lovedId = taste.lovedPerformerIds[0]
  const [hidden, other] = db.owned.filter(
    (s) =>
      s.performers.some((p) => p.id === lovedId) &&
      M.prediction(s.id).raw > 1 &&
      M.prediction(s.id).raw < 4.5,
  )
  const key = 'p:' + lovedId
  assert.equal(blameKey(M.prediction(hidden.id)) != null, true)
  assert.equal(keyLabel(db, key), db.performers.get(lovedId).name)
  const Mx = createEngine(db).compute({
    notInterested: [{ sceneId: hidden.id, key }],
  })
  assert.equal(Mx.penalty.get(key), -NI_PENALTY)
  close(
    Mx.prediction(other.id).raw,
    M.prediction(other.id).raw - NI_PENALTY,
    'prediction',
  )
  close(
    Mx.performerAffinity(lovedId),
    M.performerAffinity(lovedId) - NI_PENALTY,
    'affinity',
  )
  const My = createEngine(db).compute({
    notInterested: [
      { sceneId: hidden.id, key },
      { sceneId: other.id, key },
    ],
  })
  assert.equal(My.penalty.get(key), -2 * NI_PENALTY)
  const Mz = createEngine(db).compute({
    notInterested: [{ sceneId: hidden.id, key: null }],
  })
  assert.equal(Mz.penalty.size, 0, 'no key: nothing to lower')
})

test("Don't learn keeps a scene's rating, plays and clip picks out of the model", () => {
  const ratedScene = db.owned.find(
    (s) => s.local.rating100 != null && behaviourOf(s),
  )
  const playedScene = db.owned.find(
    (s) => s.local.rating100 == null && behaviourOf(s),
  )
  const other = db.owned.find(
    (s) => s.local.rating100 != null && s !== ratedScene,
  )
  const [p1, p2] = db.localPerformers
  const decisions = [
    { kind: 'clip', winner: ratedScene.id, loser: other.id },
    { kind: 'clip', winner: other.id, loser: playedScene.id },
    { kind: 'performer', winner: p1.id, loser: p2.id },
  ]
  const dontLearn = [ratedScene.id, playedScene.id]
  const Mx = createEngine(db).compute({ dontLearn, decisions })
  assert.equal(Mx.fits.rated.length, M.fits.rated.length - 1)
  assert.equal(Mx.fits.watchedUnrated.length, M.fits.watchedUnrated.length - 1)
  assert.ok(!Mx.fits.rated.some((x) => x.scene === ratedScene))
  assert.ok(!Mx.fits.watchedUnrated.some((x) => x.scene === playedScene))
  assert.equal(Mx.bt.count, 1, 'only the performer pick is learned from')
  assert.equal(createEngine(db).compute({ decisions }).bt.count, 3)
  const k = 'p:' + ratedScene.performers[0].id
  assert.equal(Mx.stats.get(k)?.n ?? 0, M.stats.get(k).n - 1)
  assert.ok(Mx.dontLearn.has(ratedScene.id))
})

test('bracket picks replay in order, so Undo is dropping the last pick', () => {
  const watched = db.owned.filter((s) => behaviourOf(s)).slice(0, 8)
  const ids = watched.map((s) => s.id)
  // four clip picks, upsets and favourites in turn, then a performer pick
  const decisions = [
    { kind: 'clip', winner: ids[1], loser: ids[0] },
    { kind: 'clip', winner: ids[2], loser: ids[3] },
    { kind: 'clip', winner: ids[5], loser: ids[4] },
    { kind: 'clip', winner: ids[1], loser: ids[2] },
    {
      kind: 'performer',
      winner: db.localPerformers[3].id,
      loser: db.localPerformers[0].id,
    },
  ]
  const run = (d) => createEngine(db).compute({ decisions: d })
  const all = run(decisions)
  const undone = run(decisions.slice(0, -1))
  const fewer = run(decisions.slice(0, 4))
  for (const id of ids) assert.equal(undone.estimate(id), fewer.estimate(id))
  assert.equal(
    undone.performerAffinity(db.localPerformers[3].id),
    M.performerAffinity(db.localPerformers[3].id),
  )
  assert.notEqual(
    all.performerAffinity(db.localPerformers[3].id),
    undone.performerAffinity(db.localPerformers[3].id),
  )
  assert.notDeepEqual(
    ids.map((id) => run(decisions.slice(0, 3)).estimate(id)),
    ids.map((id) => fewer.estimate(id)),
  )
  // the same picks always give the same offsets
  const ctx = {
    baseScene: (id) => M.estimate(id),
    keys: () => [],
    basePerformer: () => 0,
  }
  assert.deepEqual(replay(decisions, ctx), replay(decisions, ctx))
  assert.equal(replay(decisions.slice(0, -1), ctx).count, 4)
  assert.equal(all.bt.wins.get(ids[1]), 2)
  assert.equal(all.bt.losses.get(ids[2]), 1)
})

test('features: performers, studio and network, and tags shared out by count', () => {
  const s = db.owned.find(
    (x) => x.studio?.parent && x.tags.some((t) => isPlaceholderTag(t)),
  )
  const f = sceneFeatures(s)
  const content = s.tags.filter((t) => !isPlaceholderTag(t))
  assert.deepEqual(
    f.map(([k]) => k),
    [
      ...s.performers.map((p) => 'p:' + p.id),
      's:' + s.studio.id,
      's:' + s.studio.parent.id,
      ...content.map((t) => 't:' + t.id),
    ],
  )
  for (const [k, x] of f)
    assert.equal(x, k[0] === 't' ? 2 / Math.sqrt(content.length) : 1)
})

test("other plugins' score and collection tags leave Your score as it was", () => {
  const marked = withBookkeepingTags(input)
  const s = marked.scenes.find((x) => x.rating100 != null)
  assert.deepEqual(
    sceneFeatures(s),
    sceneFeatures(input.scenes.find((x) => x.id === s.id)),
    'content tags keep their full share',
  )
  const Mm = createEngine(buildDb(marked)).compute({})
  for (const x of db.owned) close(Mm.estimate(x.id), M.estimate(x.id), x.id)
})

test('a surprise moves the scores more than an expected pick', () => {
  const ranked = db.owned
    .filter((s) => behaviourOf(s))
    .sort((a, b) => M.estimate(b.id) - M.estimate(a.id))
  const strong = ranked[0].id
  const weak = ranked[ranked.length - 1].id
  const expected = createEngine(db).compute({
    decisions: [{ kind: 'clip', winner: strong, loser: weak }],
  })
  const upset = createEngine(db).compute({
    decisions: [{ kind: 'clip', winner: weak, loser: strong }],
  })
  const gain = (Mx, id) => Mx.bt.sceneOffset.get(id)
  assert.ok(gain(upset, weak) > gain(expected, strong))
  assert.ok(gain(expected, strong) > 0 && gain(expected, weak) < 0)
  const [p1, p2] = db.localPerformers
  const Mp = createEngine(db).compute({
    decisions: [{ kind: 'performer', winner: p2.id, loser: p1.id }],
  })
  assert.ok(Mp.performerAffinity(p2.id) > M.performerAffinity(p2.id))
  assert.ok(Mp.performerAffinity(p1.id) < M.performerAffinity(p1.id))
})

test('badge labels: stars, or where it ranks among your unrated scenes', () => {
  assert.deepEqual(badgeLabel(M, 4.42, false), {
    corner: '~4.4',
    line: 'likely 4.5★ for you',
    relative: false,
  })
  assert.equal(badgeLabel(M, 3.9, false).line, 'likely 4★ for you')
  const unrated = db.owned
    .filter((s) => M.rating(s) == null)
    .map((s) => M.prediction(s.id).value)
  assert.equal(badgeLabel(M, Math.max(...unrated), true).corner, 'Top 10%')
  assert.equal(
    badgeLabel(M, Math.min(...unrated) - 0.1, true).corner,
    'Bottom 25%',
  )
})

test('behaviour: watch-through, days and o counter', () => {
  const s = db.owned.find((x) => x.local.play_count >= 3)
  const b = behaviourOf(s)
  assert.ok(b.score > 0 && b.score <= 1)
  assert.equal(b.days, new Set(s.local.play_history.map(localDay)).size)
  assert.equal(b.rewatchDays, b.days - 1)
  assert.equal(behaviourOf(db.owned.find((x) => !x.local.play_count)), null)
  assert.equal(barelyPlayed(db.owned.find((x) => !x.local.play_count)), true)
})

test('helpers: day, time ago, approximate counts, pronouns', () => {
  assert.match(localDay('2026-10-15T12:00:00Z'), /^\d{4}-\d{2}-\d{2}$/)
  const now = Date.parse('2026-10-15T12:00:00Z')
  assert.equal(timeAgo('2026-10-15T08:00:00Z', now), 'today')
  assert.equal(timeAgo('2026-10-14T08:00:00Z', now), 'yesterday')
  assert.equal(timeAgo('2026-10-01T12:00:00Z', now), '14 days ago')
  assert.equal(timeAgo('2026-08-15T12:00:00Z', now), '2 months ago')
  assert.equal(timeAgo('2025-04-15T12:00:00Z', now), '1.5 years ago')
  assert.equal(approx(843), '~840')
  assert.equal(approx(1288), '~1,300')
  assert.equal(approx(null), '')
  assert.equal(genderLabel('TRANSGENDER_FEMALE'), 'Trans female')
  assert.equal(genderLabel(null), null)
  const p = (gender) => ({ local: { gender } })
  assert.equal(pronoun(p('FEMALE')), 'her')
  assert.equal(pronoun(p('TRANSGENDER_MALE')), 'his')
  assert.equal(pronoun(p(null)), 'their')
  assert.equal(pronoun({ local: null, stashdbGender: 'MALE' }), 'his')
  setGenderResolver(() => 'FEMALE')
  try {
    assert.equal(pronoun(p(null)), 'her', 'the live gender, after edits')
  } finally {
    setGenderResolver(null)
  }
  assert.equal(pronoun(p(null)), 'their')
})

test('an engine reuses an earlier fit when only StashDB data changed', async () => {
  const { syntheticLibrary, syntheticStashdb } =
    await import('./fixtures/synthetic.mjs')
  const { input } = syntheticLibrary()
  const e1 = createEngine(buildDb(input))
  const run = {
    overrides: {},
    performerOverrides: {},
    decisions: [],
    notInterested: [],
    dontLearn: [],
  }
  const m1 = e1.compute(run)
  const db2 = buildDb({ ...input, stashdb: syntheticStashdb(input) })
  const m2 = createEngine(db2, { fits: e1.cache }).compute(run)
  assert.equal(m2.fits, m1.fits)
  for (const s of db2.owned)
    assert.equal(m2.prediction(s.id).value, m1.prediction(s.id).value)
})
