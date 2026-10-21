// A library with too few ratings for Your score to check itself: what the
// model says, and how For you leans on favorites and performer ratings until
// it can.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine, rateMore } from '../../src/js/model/index.js'
import * as FY from '../../src/js/model/foryou.js'
import { MIN_RATED } from '../../src/js/model/taste.js'
import { syntheticLibrary, withFewRatings } from './fixtures/synthetic.mjs'

const { input, taste } = syntheticLibrary()
const STATE = {
  dontLearn: [],
  notInterested: [],
  settings: { excludedTags: '' },
}
const engine = (opts, compute = {}) => {
  const db = buildDb(withFewRatings(input, opts))
  return createEngine(db).compute(compute)
}
const forYou = (Mx) => FY.computeForYou(FY.context(Mx, STATE), FY.EMPTY_SIGNALS)
const close = (a, b, msg) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`)

const M = engine({ rated: 1 })
const { db } = M
const hasFavorite = (s) =>
  s.performers.some((p) => db.favoritePerformerIds.has(p.id))
// four favorites from the middle of the cast list, who would not otherwise
// lead the row
const picks = [...db.localPerformers]
  .sort((a, b) => b.ownedSceneIds.length - a.ownedSceneIds.length)
  .slice(20, 24)
  .map((p) => p.id)
const withPick = (it) => it.scene.performers.some((p) => picks.includes(p.id))

test('Your score counts the ratings it still needs and stays hidden', () => {
  assert.equal(M.fits.rated.length, 1)
  assert.equal(M.ratingsToGo, 9)
  assert.equal(M.cv, null)
  assert.equal(M.gate, false)
  assert.equal(rateMore(M), 'Rate 9 more scenes')
  assert.equal(rateMore(M, { short: true }), 'Rate 9 more')

  const none = engine({ rated: 0 })
  assert.equal(none.ratingsToGo, 10)
  assert.equal(rateMore(none), 'Rate 10 scenes')
  assert.equal(rateMore(none, { short: true }), 'Rate 10 scenes')
  assert.equal(rateMore(engine({ rated: 9 })), 'Rate 1 more scene')

  // ten ratings: it can check itself, whether or not it beats your average
  const ten = engine({ rated: 10 })
  assert.equal(ten.ratingsToGo, 0)
  assert.ok(ten.cv)
  assert.equal(rateMore(ten), null)
  // Don't learn keeps a rating out of the count
  const skip = M.fits.rated[0].scene.id
  assert.equal(
    createEngine(db).compute({ dontLearn: [skip] }).ratingsToGo,
    MIN_RATED,
  )
})

test('with too few ratings, no reason claims you rate anything well', () => {
  const claims = /rate (well|lower)|scenes you rate/
  let named = 0
  for (const s of db.owned)
    for (const positive of [true, false]) {
      const r = M.reason(s.id, positive)
      if (!r) continue
      named++
      assert.doesNotMatch(r.text, claims, r.text)
    }
  assert.ok(named > 0, 'scenes with plays to speak of still get a reason')
  for (const it of forYou(M)) assert.doesNotMatch(it.reason, claims)
  // a library with ratings keeps its sentences
  const warm = createEngine(buildDb(input)).compute({})
  assert.ok(db.owned.every((s) => warm.reason(s.id)?.text))
})

test('For you leans on your favorites until Your score can check itself', () => {
  const theirs = (row) => row.filter(withPick)
  const row = forYou(engine({ rated: 1, favorites: picks }))
  const plain = forYou(engine({ rated: 1, favorites: [] }))
  assert.ok(
    theirs(row).length >= Math.max(5, theirs(plain).length + 2),
    `${theirs(row).length} cards with a favorite, ${theirs(plain).length} without`,
  )
  // and the cards say who
  const said = row.filter((it) =>
    /(^|· )[Ww]ith Performer \d+, one of your favorites$/.test(it.reason),
  )
  assert.ok(said.length >= 2, row.map((it) => it.reason).join('\n'))
  for (const it of said) assert.ok(theirs([it]).length)
  // still at most two cards per performer
  const per = new Map()
  for (const it of row)
    for (const p of it.scene.performers) per.set(p.id, (per.get(p.id) || 0) + 1)
  assert.ok(Math.max(...per.values()) <= FY.FY.perPerformer)
})

test('with no ratings and no plays, Your score guesses 3 and favorites lead For you', () => {
  // a brand-new library: nothing to fit, so every scene predicts 3 stars
  // (not 0/0, which made every total NaN and the row's order arbitrary)
  const empty = (favorites) =>
    engine({ rated: 0, played: 0, favorites, performerRatings: false })
  const Mx = empty(picks)
  assert.equal(Mx.fits.rated.length + Mx.fits.watchedUnrated.length, 0)
  for (const id of Mx.db.scenes.keys())
    assert.equal(Mx.prediction(id).value, 3, id)
  const row = forYou(Mx)
  assert.equal(row.length, FY.FY.size)
  for (const it of row) assert.ok(Number.isFinite(it.total), it.scene.id)
  // the favorites carry the row
  const theirs = row.filter(withPick)
  const plain = forYou(empty([])).filter(withPick)
  assert.ok(
    theirs.length >= Math.max(6, plain.length + 3),
    `${theirs.length} cards with a favorite, ${plain.length} without`,
  )
  const mains = row.filter((it) => it.kind === 'main')
  const lowest = Math.min(...mains.filter(withPick).map((it) => it.total))
  const rest = mains.filter((it) => !withPick(it)).map((it) => it.total)
  assert.ok(
    rest.every((t) => t < lowest),
    `favorites' cards from ${lowest}, others ${rest}`,
  )
  assert.ok(theirs.some((it) => it.reason.endsWith('one of your favorites')))
})

test('a performer rating lifts or sinks their scenes, by the stars', () => {
  // a scene with one performer, who is not a favorite
  const s = db.owned.find(
    (x) =>
      x.performers.length === 1 &&
      !hasFavorite(x) &&
      M.rating(x) == null &&
      x.performers[0].id,
  )
  const id = s.performers[0].id
  const stated = (rating100) =>
    FY.statedFor(
      FY.context(
        createEngine(db).compute({ performerOverrides: { [id]: rating100 } }),
        STATE,
      ),
      s,
    )
  // 9 of the 10 ratings still to go: 0.9 of the stars per star from 3
  const per = 0.9 * FY.STATED.perStar
  close(stated(100).value, per * 2, '5 stars')
  close(stated(20).value, per * -2, '1 star')
  close(stated(60).value, 0, '3 stars')
  close(stated(null).value, 0, 'unrated')
  assert.equal(stated(100).source.performer.id, id)
  assert.equal(stated(20).source, null)
  // in the row: their scenes, saying so, at 5 stars; none at 1 star
  const cards = (rating100) =>
    forYou(
      createEngine(db).compute({ performerOverrides: { [id]: rating100 } }),
    ).filter((it) => it.scene.performers.some((p) => p.id === id))
  const five = cards(100)
  assert.ok(five.length >= 1, 'their scenes make the row')
  assert.ok(five.some((it) => it.reason.endsWith(`rated Performer ${id} 5★`)))
  assert.equal(cards(20).length, 0)
})

test('the lean fades as ratings arrive and is gone at ten', () => {
  const opts = { performerRatings: false }
  for (const rated of [0, 1, 5, 9, 10]) {
    const Mx = engine({ ...opts, rated })
    const ctx = FY.context(Mx, STATE)
    const s = Mx.db.owned.find((x) => hasFavorite(x) && Mx.rating(x) == null)
    close(
      FY.statedFor(ctx, s).value,
      ((10 - rated) / 10) * FY.STATED.favorite,
      `${rated} rated`,
    )
  }
  // a library with ratings: none at all, so For you is as before
  const warm = createEngine(buildDb(input)).compute({})
  assert.equal(warm.ratingsToGo, 0)
  const ctx = FY.context(warm, STATE)
  for (const s of warm.db.owned)
    assert.equal(FY.statedFor(ctx, s).value, 0, s.id)
})

test('a performer bracket moves For you in a cold library, not the gate', () => {
  // the first loved performer wins four picks
  const champ = taste.lovedPerformerIds[0]
  const others = [...db.localPerformers]
    .map((p) => p.id)
    .filter((id) => id !== champ && !taste.lovedPerformerIds.includes(id))
    .slice(0, 4)
  const decisions = others.map((loser) => ({
    kind: 'performer',
    winner: champ,
    loser,
  }))
  const Mx = createEngine(db).compute({ decisions })
  assert.equal(Mx.gate, false)
  assert.equal(Mx.ratingsToGo, M.ratingsToGo)
  const theirs = db.performers.get(champ).ownedSceneIds
  for (const sid of theirs)
    assert.ok(
      Mx.prediction(sid).value > M.prediction(sid).value,
      `scene ${sid} rises`,
    )
  const before = forYou(M).filter((it) => theirs.includes(it.scene.id)).length
  const after = forYou(Mx).filter((it) => theirs.includes(it.scene.id)).length
  assert.ok(after >= before, `${after} of their scenes, ${before} before`)
  assert.ok(after >= 1)
})

test('your average counts each rating Your score still needs as your plays suggest', () => {
  const sum = (Mx) => Mx.fits.rated.reduce((a, x) => a + x.y, 0)
  for (const rated of [0, 1, 2, 5, 9]) {
    const Mx = engine({ rated })
    close(
      Mx.userMean,
      (sum(Mx) + (MIN_RATED - rated) * Mx.fits.content.pseudoMean) / MIN_RATED,
      `${rated} rated`,
    )
  }
  // no plays to go by: your ratings' plain mean, or 3 with none
  const unplayed = engine({ rated: 1, played: 0 })
  assert.equal(unplayed.fits.content.pseudoMean, null)
  assert.equal(unplayed.userMean, sum(unplayed))
  assert.equal(engine({ rated: 0, played: 0 }).userMean, 3)
  // ten ratings and up: the plain mean, so those libraries rank as before
  const warm = createEngine(buildDb(input)).compute({})
  for (const Mx of [engine({ rated: 10 }), warm])
    assert.equal(Mx.userMean, sum(Mx) / Mx.fits.rated.length)
})

test('with one rating, unrated scenes sit around your average and the near-miss slot fills', () => {
  const id = M.fits.rated[0].scene.id
  const rerated = (rating100) =>
    createEngine(db).compute({ overrides: { [id]: rating100 } })
  for (const [label, Mx] of [
    ['no ratings', engine({ rated: 0 })],
    [`one ${M.rating(db.scenes.get(id)) / 20}★`, M],
    ['one 2★', rerated(40)],
    ['one 5★', rerated(100)],
  ]) {
    // your average cuts through Your score's guesses instead of sitting
    // below or above them all, so For you's near-miss band and More like
    // this's "well below your average" are about these scenes
    const guesses = Mx.db.owned
      .filter((s) => Mx.rating(s) == null)
      .map((s) => Mx.prediction(s.id).value)
    assert.ok(
      Math.min(...guesses) < Mx.userMean && Mx.userMean < Math.max(...guesses),
      `${label}: your average ${Mx.userMean}, guesses ${Math.min(...guesses)} to ${Math.max(...guesses)}`,
    )
    const row = forYou(Mx)
    const near = row.filter((it) => it.kind === 'nearmiss')
    assert.equal(near.length, 1, `${label}: ${row.map((it) => it.kind)}`)
    assert.equal(near[0].slot, 9, label)
    assert.match(near[0].reason, /^Worth a try/, label)
  }
})
