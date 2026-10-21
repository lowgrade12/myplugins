// The engine: fits the taste model, folds in bracket picks and "Not
// interested" feedback, and answers the questions the views ask
// (what's the score, why, how does it rank among your scenes).

import {
  buildSamples,
  fit,
  crossValidate,
  crossValidateSteps,
  trainingSample,
  predict,
  MIN_RATED,
  PARAMS,
  sceneFeatures,
} from './taste.js'
import { replay } from './bt.js'
import { matchDecisions, sourcesText } from './matches.js'
import { behaviourOf } from './behaviour.js'
import { ownRating, sceneRating, pronoun, fmtStars } from './util.js'

export { fmtStars }

export const NI_PENALTY = 0.18 // stars taken off whatever made a "Not interested" card appear
const FAVOURITE_BONUS = 0.15
const PERFORMER_RATING_WEIGHT = 0.3 // stars of affinity per star of your own performer rating above 3.5

const fmt1 = fmtStars

/**
 * What compute takes. Every field is optional; ids are the database's.
 * @typedef {object} EngineInput
 * @property {Record<string, number|null>} [overrides]  scene id -> rating100,
 *   for ratings changed since the library was read (an applied batch, an undo)
 * @property {Record<string, number|null>} [performerOverrides]  performer id
 *   -> rating100, likewise
 * @property {import('./bt.js').Decision[]} [decisions]  every bracket pick,
 *   oldest first (brackets.js modelDecisions, over finished brackets and the
 *   one in progress)
 * @property {NotInterested[]} [notInterested]
 * @property {string[]} [dontLearn]  ids of scenes marked "Don't learn from
 *   this": their ratings, plays and clip-bracket picks stay out of the model
 * @property {boolean} [learnFromRankings]  read ratings another plugin set
 *   (Elo scores, Restash's mirrored score, Ascension's Prime; rankings.js)
 *   as the user's own. Off by default: they stay out of the model, which
 *   then sees those records as unrated
 * @property {boolean} [learnFromMatches]  replay the matches Ascension,
 *   HotOrNot and Xenith recorded (matches.js) as picks, ahead of
 *   `decisions` and at BT.external of their weight. Off unless given; the
 *   setting that gives it starts on (storage/settings.js). With
 *   learnFromRankings on as well, the same matches count twice: once as
 *   picks and once in the scores they made
 */

/**
 * A scene marked Not interested. Other fields the UI keeps on it (title,
 * date, label) are ignored here.
 * @typedef {object} NotInterested
 * @property {string} sceneId
 * @property {string|null} key  the feature that made the card appear
 *   ("p:<id>", "s:<id>" or "t:<id>": the row item's key, else blameKey)
 */

function featureStats(db, overrides, skip, rate) {
  const stats = new Map()
  const bump = (k, scene, r, b) => {
    let st = stats.get(k)
    if (!st)
      stats.set(
        k,
        (st = { n: 0, sum: 0, watched: 0, rewatched: 0, through: 0 }),
      )
    if (r != null) {
      st.n++
      st.sum += r / 20
    }
    if (b) {
      st.watched++
      if (b.rewatchDays >= 1) st.rewatched++
      if (b.watchThrough >= 0.9) st.through++
    }
  }
  for (const s of db.owned) {
    if (skip.has(s.id)) continue
    const r = rate(s, overrides)
    const b = behaviourOf(s)
    for (const [k] of sceneFeatures(s)) bump(k, s, r, b)
  }
  for (const st of stats.values()) st.mean = st.n ? st.sum / st.n : null
  return stats
}

/** @param {import('./db.js').Db} db */
// shared.fits: an earlier engine's fit cache, reused when only the StashDB
// part of the database changed. The fit reads only owned scenes, which
// StashDB data never changes, so a page's lookups need no refit.
// shared.deferCv: leave the cross-validation (five of the fit's seven fits)
// for later. Until finishCv has run it, the fits carry shared.provisionalCv
// (the last result the browser kept, without its rows) or null, and
// cvPending is set.
export function createEngine(db, shared = {}) {
  const cache = shared.fits || {}
  const deferCv = !!shared.deferCv

  // skip: Set of scene ids marked "Don't learn from this". rate: how the
  // model reads a scene's rating (ownRating, or sceneRating to learn from
  // ratings other plugins set)
  function fits(overrides, skip = new Set(), rate = ownRating) {
    const key =
      JSON.stringify(overrides || {}) +
      '|' +
      [...skip].sort().join(',') +
      '|' +
      (rate === ownRating ? 'own' : 'all')
    if (cache.key === key) return cache.fits
    const { rated, watchedUnrated } = buildSamples(db, overrides, skip, rate)
    // The fit and its check train on at most MAX_TRAIN of them; `rated`
    // stays whole for the counts and averages that read every rating.
    const train = trainingSample(rated)
    const f = {
      rated,
      train,
      watchedUnrated,
      full: fit(train, watchedUnrated, { ...PARAMS, useBehaviour: true }),
      content: fit(train, watchedUnrated, { ...PARAMS, useBehaviour: false }),
      cv: deferCv
        ? train.length >= MIN_RATED
          ? shared.provisionalCv || null
          : null
        : crossValidate(train, watchedUnrated, PARAMS),
      cvPending: deferCv && train.length >= MIN_RATED,
      stats: featureStats(db, overrides, skip, rate),
    }
    cache.key = key
    cache.fits = f
    return f
  }

  // The deferred cross-validation of the current fits, a fold per step
  // (a generator; null when nothing is pending). Once it finishes, the
  // cache holds new fits with the real cv, so the next compute reads it.
  function* finishCv() {
    const f = cache.fits
    if (!f?.cvPending) return null
    const cv = yield* crossValidateSteps(f.train, f.watchedUnrated, PARAMS)
    // A refit while this ran replaced the fits: its cv is not this one.
    if (cache.fits !== f) return null
    cache.fits = { ...f, cv, cvPending: false }
    return cv
  }

  /** @param {EngineInput} input */
  function compute(input) {
    const overrides = input.overrides || {}
    const performerOverrides = input.performerOverrides || {}
    const dontLearn = new Set(input.dontLearn || [])
    const learnAll = !!input.learnFromRankings
    const rate = learnAll ? sceneRating : ownRating
    const F = fits(overrides, dontLearn, rate)
    // Stash's performer rating, after edits made since the library was read
    const stashPerformerRating = (id) => {
      if (Object.prototype.hasOwnProperty.call(performerOverrides, id))
        return performerOverrides[id]
      return db.performers.get(id)?.local?.rating100 ?? null
    }
    // Who set a record's rating, when another plugin did ('elo', 'mirror',
    // 'primed'; rankings.js). An override is the user's own.
    const ratingSource = (kind, id) => {
      const over = kind === 'performer' ? performerOverrides : overrides
      if (Object.prototype.hasOwnProperty.call(over, id)) return null
      const rec =
        kind === 'performer' ? db.performers.get(id) : db.scenes.get(id)
      return rec?.local?.ratingSource ?? null
    }
    // The performer rating the model reads: the user's own
    const performerRating = (id) =>
      !learnAll && ratingSource('performer', id)
        ? null
        : stashPerformerRating(id)
    // How you rate their scenes: the model's weight where their scenes are in
    // the sample. (The mockup fell back to a summary of scenes outside its
    // 119-scene sample. Every scene in the library is in db.owned here, so a
    // performer with no rated or watched scene has no weight yet.)
    const sceneTaste = (id) => F.content.W.get('p:' + id) ?? 0
    const penalty = new Map()
    for (const ni of input.notInterested || [])
      if (ni.key) penalty.set(ni.key, (penalty.get(ni.key) || 0) - NI_PENALTY)

    // The scene rating the model reads (the user's own), and Stash's
    const rating = (scene) => rate(scene, overrides)
    const stashRating = (scene) => sceneRating(scene, overrides)
    const modelFor = (scene) =>
      scene.owned && behaviourOf(scene) ? F.full : F.content

    const baseCache = new Map()
    const baseScene = (id) => {
      if (!baseCache.has(id)) {
        const s = db.scenes.get(id)
        const r = rating(s)
        baseCache.set(
          id,
          r != null ? r / 20 : predict(modelFor(s), s, { penalty }).value,
        )
      }
      return baseCache.get(id)
    }
    const basePerformer = (id) => {
      const r = performerRating(id)
      return (
        sceneTaste(id) +
        (r != null ? PERFORMER_RATING_WEIGHT * (r / 20 - 3.5) : 0) +
        (penalty.get('p:' + id) || 0) +
        (db.favoritePerformerIds.has(id) ? FAVOURITE_BONUS : 0)
      )
    }
    const btKeys = (id) =>
      sceneFeatures(db.scenes.get(id))
        .map(([k]) => k)
        .filter((k) => k[0] === 'p' || k[0] === 's')
    // Other plugins' matches first, then the user's own picks. Clip picks
    // involving a "Don't learn" scene teach nothing, whoever made them, nor
    // do picks on a scene deleted (or merged away) in Stash since: the
    // library no longer holds it. matches.js keeps other plugins' matches
    // to the library already.
    const learns = (id) => !!db.scenes.get(id)?.owned && !dontLearn.has(id)
    const decisions = [
      ...(input.learnFromMatches ? matchDecisions(db) : []),
      ...(input.decisions || []),
    ].filter(
      (d) => d.kind === 'performer' || (learns(d.winner) && learns(d.loser)),
    )
    const bt = replay(decisions, { baseScene, keys: btKeys, basePerformer })
    // The matches it learned from: how many, and from which plugins
    const fromMatches = decisions.filter((d) => d.source)
    const matches = {
      count: fromMatches.length,
      sources: [...new Set(fromMatches.map((d) => d.source))].sort(),
    }

    const extraFor = (scene) => ({
      penalty,
      featureDelta: bt.featureDelta,
      performerOffset: bt.performerOffset,
      sceneOffset: bt.sceneOffset.get(scene.id) || 0,
    })

    // Each scene's Your score, worked out when first asked for and kept for
    // this model. Working out all of them up front cost 0.7 s per compute
    // on a library of 144,000, most of them never read: a scene with a
    // rating the model reads shows that rating, not a guess.
    const predicted = new Map()
    const predictions = {
      get(id) {
        let p = predicted.get(id)
        if (p === undefined) {
          const s = db.scenes.get(id)
          if (!s) return undefined
          p = predict(modelFor(s), s, extraFor(s))
          predicted.set(id, p)
        }
        return p
      },
      has: (id) => db.scenes.has(id),
    }

    // Ratings Your score still needs before it can check itself (0 once it can)
    const ratingsToGo = Math.max(0, MIN_RATED - F.rated.length)

    // your ratings and their spread
    const ratedStars = F.rated.map((x) => x.y)
    const ratedSum = ratedStars.reduce((a, b) => a + b, 0)
    const ratedMean = ratedStars.length ? ratedSum / ratedStars.length : 3
    // Your average, the line For you's taste and More like this measure
    // scenes against. Until Your score has its ten ratings, each one it still
    // needs counts as what your plays suggest (the fit's pseudo-labels): with
    // one or two ratings, their plain mean sits far from the guesses, which
    // lean on the plays, and every unrated scene would share that offset.
    // From ten ratings on, the plain mean, as before.
    const userMean = ratingsToGo
      ? (ratedSum + ratingsToGo * (F.content.pseudoMean ?? ratedMean)) /
        MIN_RATED
      : ratedMean
    const highShare = ratedStars.length
      ? ratedStars.filter((y) => y >= 4).length / ratedStars.length
      : 0
    // how you rate, so your ratings alone
    const inflated = ratedMean >= 3.6 && highShare >= 0.5

    // Relative labels rank a score among your Your scores: every owned scene
    // you haven't rated ("Top 10% for you" = top tenth of what's left to rate)
    // Gathered and sorted once, on first use (only relative badges ask),
    // then a binary search per card: a scan of every unrated scene per card
    // is slow on a library of 100,000.
    let sorted = null
    const topShareOf = (v) => {
      sorted ||= Float64Array.from(
        db.owned
          .filter((s) => rating(s) == null)
          .map((s) => predictions.get(s.id).value),
      ).sort()
      if (!sorted.length) return 0.5
      // the first index whose value is above v (+ the same tolerance)
      let lo = 0
      let hi = sorted.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sorted[mid] > v + 1e-9) hi = mid
        else lo = mid + 1
      }
      return (sorted.length - lo) / sorted.length
    }

    const cv = F.cv
    // Your score shows only when it beats your average on held-out ratings
    const gate = !!cv && cv.maeModel < cv.maeBase

    const estimate = (id) => {
      const s = db.scenes.get(id)
      const r = rating(s)
      if (r != null)
        return Math.min(
          5,
          Math.max(0.5, r / 20 + (bt.sceneOffset.get(id) || 0)),
        )
      return predictions.get(id).value
    }

    const performerAffinity = (id) =>
      basePerformer(id) + (bt.performerOffset.get(id) || 0)

    // How they sit in your scene ratings: { n, mean } from rated scenes,
    // watched counts likewise
    const performerSceneStats = (id) => {
      const st = F.stats.get('p:' + id)
      if (st && (st.n || st.watched))
        return { n: st.n, mean: st.mean, watched: st.watched }
      return { n: 0, mean: null, watched: 0 }
    }

    return {
      db,
      overrides,
      performerOverrides,
      dontLearn,
      performerRating,
      stashPerformerRating,
      ratingSource,
      performerSceneStats,
      fits: F,
      cv,
      gate,
      ratingsToGo,
      penalty,
      bt,
      matches,
      predictions,
      userMean,
      highShare,
      inflated,
      rating,
      stashRating,
      estimate,
      performerAffinity,
      prediction: (id) => predictions.get(id),
      topShare: (v) => topShareOf(v),
      stats: F.stats,
      // positive: explain what speaks for it, even when the score is below average (for picks)
      reason: (id, positive) =>
        reasonFor(
          db,
          F,
          bt,
          predictions.get(id),
          db.scenes.get(id),
          positive ? -Infinity : userMean,
        ),
      reasons: (id, positive) =>
        reasonsFor(
          db,
          F,
          bt,
          predictions.get(id),
          db.scenes.get(id),
          positive ? -Infinity : userMean,
        ),
    }
  }

  return { compute, fits, cache, finishCv }
}

// ---------------------------------------------------------------- labels

// "Rate 9 more scenes" ("Rate 10 scenes" with none rated): what Your score
// still needs before it can check itself. null once it has them. short:
// "Rate 9 more", for beside the stars.
export function rateMore(M, { short = false } = {}) {
  const n = M?.ratingsToGo
  if (!n) return null
  if (n === MIN_RATED) return `Rate ${n} scenes`
  return `Rate ${n} more` + (short ? '' : ` scene${n === 1 ? '' : 's'}`)
}

// True when the user hasn't rated the scene themselves, so Your score has a
// place on its card and page: Stash has no rating for it, or only one that
// another plugin set (an Elo ranking, Restash's mirror, Ascension's Prime;
// rankings.js), which the model reads as none. The card's rating must be the
// one the model read, so a rating the user sets on it counts at once.
// scene: { id, rating100 } as Stash hands it to the card.
export function unratedByYou(M, scene) {
  if (scene.rating100 == null) return true
  const s = M.db.scenes.get(scene.id)
  return !!s && M.rating(s) == null && M.stashRating(s) === scene.rating100
}

// Badge text. Stars: "~4.5" on the card corner, "likely 4.5★ for you" on the
// scene page. Relative (a setting): where it ranks among your unrated scenes.
export function badgeLabel(M, value, relativeStyle) {
  const half = Math.round(value * 2) / 2
  if (!relativeStyle)
    return {
      corner: '~' + fmt1(value),
      line: `likely ${half % 1 ? half.toFixed(1) : half}★ for you`,
      relative: false,
    }
  const share = M.topShare(value)
  let short
  if (share < 0.1) short = 'Top 10%'
  else if (share < 0.25) short = 'Top 25%'
  else if (share < 0.5) short = 'Top half'
  else if (share < 0.75) short = 'Lower half'
  else short = 'Bottom 25%'
  return {
    corner: short,
    line: `likely ${short.toLowerCase()} for you`,
    relative: true,
    share,
  }
}

// ---------------------------------------------------------------- reasons

// One plain sentence from the biggest contribution pointing the same way
// as the score (above your average: biggest plus; below: biggest minus).
function reasonFor(db, F, bt, pred, scene, userMean) {
  return reasonsFor(db, F, bt, pred, scene, userMean)[0] ?? null
}

// Every such sentence, biggest contribution first, then the general one
// once there are enough ratings to compare with. For you takes the next
// when a row already carries the first twice.
function reasonsFor(db, F, bt, pred, scene, userMean) {
  if (!pred) return []
  const dir = pred.value >= userMean ? 1 : -1
  const parts = pred.parts.slice().sort((a, b) => dir * b.value - dir * a.value)
  const out = []
  for (const part of parts) {
    if (dir * part.value < 0.03) break
    const text = phrase(db, F, bt, part, scene, dir)
    if (text && !out.some((o) => o.text === text))
      out.push({ text, key: part.key })
  }
  // Too few ratings to compare a scene with what you rate well
  if (F.rated.length < MIN_RATED) return out
  out.push({
    text:
      dir > 0
        ? 'A lot like scenes you rate well'
        : 'Not much like what you rate well',
    key: null,
  })
  return out
}

function phrase(db, F, bt, part, scene, dir) {
  const k = part.key
  if (k === 'b') {
    const b = part.behaviour
    if (dir > 0) {
      if (b.rewatchDays >= 1)
        return `You've come back to it on ${b.days} different days`
      if (b.watchThrough >= 0.9) return 'You watched it all the way through'
      return 'You keep it playing longer than most'
    }
    return `You stopped about ${Math.max(5, Math.round((b.watchThrough * 100) / 5) * 5)}% of the way in`
  }
  if (k === 'o') {
    const w = bt.wins.get(scene.id) || 0
    const l = bt.losses.get(scene.id) || 0
    if (dir > 0 && w)
      return `Won ${w} match${w === 1 ? '' : 'es'} in your brackets`
    if (dir < 0 && l) return 'Went out early in a bracket'
    return matchesPhrase(bt.sceneMatches.get(scene.id), dir, 'Won', 'Lost')
  }
  const id = k.slice(2)
  const st = F.stats.get(k)
  if (k[0] === 'p') {
    const p = db.performers.get(id)
    if (!p) return null
    // What moved them more than their scenes' ratings did: your performer
    // brackets, or another plugin's matches
    const own = bt.bracketPerformerOffset.get(id) || 0
    const other = (bt.performerOffset.get(id) || 0) - own
    const learned = Math.abs(F.content.W.get(k) || 0)
    if (
      part.value &&
      own &&
      Math.abs(own) > learned &&
      Math.abs(own) >= Math.abs(other)
    ) {
      return dir > 0
        ? `${p.name} did well in your performer bracket`
        : `${p.name} went out early in your performer bracket`
    }
    if (part.value && other * dir > 0 && Math.abs(other) > learned) {
      const text = matchesPhrase(
        bt.performerMatches.get(id),
        dir,
        'won',
        'lost',
      )
      if (text) return `${p.name} ${text}`
    }
    if (st && st.n >= 2)
      return `You average ${fmt1(st.mean)}★ on ${p.name}'s scenes`
    if (st && st.n === 1)
      return `You rated ${pronoun(p)} other scene ${fmt1(st.mean)}★`
    if (st && st.through >= 2 && dir > 0)
      return `You watch ${p.name}'s scenes all the way through`
    // None of their scenes is rated: the weight comes from how you watch them
    if (!st?.watched) return null
    return dir > 0
      ? `You watch more of ${p.name}'s scenes than most`
      : `You tend to stop ${p.name}'s scenes early`
  }
  if (k[0] === 's') {
    const s = db.studios.get(id)
    if (!s) return null
    if (st && st.n >= 2)
      return `You average ${fmt1(st.mean)}★ on ${s.name} scenes`
    if (st && st.rewatched >= 2 && dir > 0)
      return `Same studio as ${st.rewatched} scenes you've watched twice`
    return null
  }
  if (k[0] === 't') {
    const t = db.tags.get(id)
    if (!t || !st || st.n < 3) return null
    return `Scenes tagged ${t.name} average ${fmt1(st.mean)}★ for you`
  }
  return null
}

// "Won 7 of 9 matches in Ascension" (dir > 0) or "Lost 5 of 8 matches in
// HotOrNot and Xenith", from another plugin's matches (bt.js tally); null
// when none went that way
function matchesPhrase(t, dir, won, lost) {
  const n = t ? t.won + t.lost : 0
  const k = dir > 0 ? t?.won : t?.lost
  if (!k) return null
  return `${dir > 0 ? won : lost} ${k} of ${n} match${n === 1 ? '' : 'es'} in ${sourcesText(t.sources)}`
}

// The key most responsible for a scene showing up, for "Not interested"
export function blameKey(pred) {
  if (!pred) return null
  const pos = pred.parts
    .filter((p) => p.key !== 'b' && p.key !== 'o')
    .sort((a, b) => b.value - a.value)[0]
  return pos && pos.value > 0 ? pos.key : null
}

export function keyLabel(db, key) {
  if (!key) return null
  const id = key.slice(2)
  if (key[0] === 'p') return db.performers.get(id)?.name
  if (key[0] === 's') return db.studios.get(id)?.name
  if (key[0] === 't') return 'tag ' + db.tags.get(id)?.name
  return null
}
