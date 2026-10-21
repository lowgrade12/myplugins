// "Your score": an additive taste model fitted in the browser.
//
//   stars ≈ μ + Σ performer weights + studio (+ parent) weight
//             + Σ tag weights / √(tag count) + β · (behaviour − mean)
//
// Ridge (L2) shrinkage per feature group, fitted by coordinate descent.
// Targets are the user's explicit ratings (rating100 / 20; not ones another
// plugin set, see rankings.js). Scenes that were
// watched but never rated add weak pseudo-labels from their behaviour score
// (weight 0.3). Accuracy is measured on held-out ratings: five 80/20 splits,
// each rated scene held out once, against the "your average" baseline.

import { isPlaceholderTag, ownRating } from './util.js'
import { behaviourOf } from './behaviour.js'

export const PARAMS = {
  lambda: { p: 3.0, s: 2.0, t: 4.0, b: 0.6 },
  tagScale: 2, // tag features are 2/√(#tags) so long tag lists don't dominate
  useBehaviour: true,
  minTagSupport: 3, // a tag needs this many training scenes to get a weight
  maxTagShare: 0.85, // ...and must not be on nearly every scene
  pseudoWeight: 0.3,
  iterations: 60,
  folds: 5,
  seed: 20261015,
}

// Rated scenes the holdout needs before it can say whether Your score beats
// your average (two per fold). Below it, Your score stays hidden.
export const MIN_RATED = 10

// ---------------------------------------------------------------- features

export function sceneFeatures(scene, params = PARAMS) {
  const f = []
  for (const p of scene.performers) f.push(['p:' + p.id, 1])
  if (scene.studio) {
    f.push(['s:' + scene.studio.id, 1])
    if (scene.studio.parent) f.push(['s:' + scene.studio.parent.id, 1])
  }
  const tags = scene.tags.filter((t) => !isPlaceholderTag(t))
  const x = tags.length ? params.tagScale / Math.sqrt(tags.length) : 0
  for (const t of tags) f.push(['t:' + t.id, x])
  return f
}

const group = (key) => key[0]

// ---------------------------------------------------------------- samples

// ratings: { sceneId: rating100|null } overrides on top of the library.
// skip: scene ids marked "Don't learn from this": their ratings and plays
// stay out of the model. rating: the scene's rating as the model reads it;
// by default the user's own, so a rating another plugin set is no target
// (its plays still count, as for any unrated scene).
export function buildSamples(db, overrides, skip, rating = ownRating) {
  const rated = []
  const watchedUnrated = []
  for (const s of db.owned) {
    if (skip && skip.has(s.id)) continue
    const r = rating(s, overrides)
    const b = behaviourOf(s)
    if (r != null) rated.push({ scene: s, y: r / 20, b: b?.score ?? null })
    else if (b) watchedUnrated.push({ scene: s, b: b.score })
  }
  return { rated, watchedUnrated }
}

// ---------------------------------------------------------------- fit

export function fit(rated, watchedUnrated, params = PARAMS) {
  // behaviour mean over everything played
  const bs = [...rated, ...watchedUnrated]
    .map((x) => x.b)
    .filter((b) => b != null)
  const bMean = bs.length ? bs.reduce((a, b) => a + b, 0) / bs.length : 0.5

  // pseudo-label calibration: stars ≈ a + c·b on rated scenes
  const withB = rated.filter((x) => x.b != null)
  let a = 3,
    c = 2
  if (withB.length >= 5) {
    const mb = withB.reduce((s, x) => s + x.b, 0) / withB.length
    const my = withB.reduce((s, x) => s + x.y, 0) / withB.length
    let sxy = 0,
      sxx = 0
    for (const x of withB) {
      sxy += (x.b - mb) * (x.y - my)
      sxx += (x.b - mb) ** 2
    }
    c = sxx > 1e-9 ? sxy / sxx : 0
    a = my - c * mb
  }

  const samples = [
    ...rated.map((x) => ({ scene: x.scene, y: x.y, w: 1, b: x.b })),
    ...watchedUnrated.map((x) => ({
      scene: x.scene,
      y: Math.min(5, Math.max(1, a + c * x.b)),
      w: params.pseudoWeight,
      b: x.b,
      pseudo: true,
    })),
  ]

  // vocabulary: tags need support; performers and studios need one scene
  const tagCount = new Map()
  for (const s of samples)
    for (const [k] of sceneFeatures(s.scene, params))
      if (k[0] === 't') tagCount.set(k, (tagCount.get(k) || 0) + 1)
  const keep = (k) => {
    if (k[0] !== 't') return true
    const n = tagCount.get(k) || 0
    return n >= params.minTagSupport && n <= params.maxTagShare * samples.length
  }

  const X = samples.map((s) =>
    sceneFeatures(s.scene, params).filter(([k]) => keep(k)),
  )
  const bx = Float64Array.from(samples, (s) => (s.b == null ? 0 : s.b - bMean))
  const cols = new Map() // key -> [[i, x]]
  X.forEach((row, i) =>
    row.forEach(([k, x]) => {
      if (!cols.has(k)) cols.set(k, [])
      cols.get(k).push([i, x])
    }),
  )
  // The same columns as flat typed arrays, for the loops below: with 10,000
  // scenes the fit runs seven times (two models and five holdout folds), and
  // reading [i, x] pairs was most of its time. The arithmetic and its order
  // are unchanged, so the weights are too.
  const keys = [...cols.keys()]
  const colRows = keys.map((k) => Int32Array.from(cols.get(k), ([i]) => i))
  const colX = keys.map((k) => Float64Array.from(cols.get(k), ([, x]) => x))
  const colLambda = keys.map((k) => params.lambda[group(k)])
  const wts = Float64Array.from(samples, (s) => s.w)
  const wv = new Float64Array(keys.length)

  let beta = 0
  const sw = samples.reduce((s, x) => s + x.w, 0)
  // No ratings and no plays: nothing to fit. μ is 3 stars, the fallback
  // ratedMean and userMean use, and the descent is skipped (each pass
  // divides by sw), so every weight stays 0 and every scene predicts 3.
  // For you then goes by favorites and performer ratings alone.
  let mu = sw ? samples.reduce((s, x) => s + x.w * x.y, 0) / sw : 3
  const r = Float64Array.from(samples, (s) => s.y - mu)
  const n = r.length

  // Coordinate descent. With useBehaviour the behaviour coefficient is fitted
  // jointly (the model for played scenes). Without it, the content weights
  // stand alone: that is the model for never-played and un-owned scenes,
  // where behaviour is missing and content has to carry the taste.
  for (let it = 0; sw && it < params.iterations; it++) {
    let d = 0
    for (let i = 0; i < n; i++) d += wts[i] * r[i]
    d /= sw
    mu += d
    for (let i = 0; i < n; i++) r[i] -= d
    for (let j = 0; j < keys.length; j++) {
      const rows = colRows[j]
      const xs = colX[j]
      const w0 = wv[j]
      let num = 0,
        den = colLambda[j]
      for (let q = 0; q < rows.length; q++) {
        const i = rows[q]
        const x = xs[q]
        num += wts[i] * x * (r[i] + x * w0)
        den += wts[i] * x * x
      }
      const w1 = num / den
      if (w1 !== w0) {
        for (let q = 0; q < rows.length; q++) r[rows[q]] -= xs[q] * (w1 - w0)
        wv[j] = w1
      }
    }
    if (params.useBehaviour) {
      let num = 0,
        den = params.lambda.b
      for (let i = 0; i < n; i++) {
        num += wts[i] * bx[i] * (r[i] + bx[i] * beta)
        den += wts[i] * bx[i] * bx[i]
      }
      const b1 = num / den
      for (let i = 0; i < n; i++) r[i] -= bx[i] * (b1 - beta)
      beta = b1
    }
  }
  const W = new Map(keys.map((k, j) => [k, wv[j]]))

  const ratedMean = rated.length
    ? rated.reduce((s, x) => s + x.y, 0) / rated.length
    : 3
  // what the plays say you'd rate a played scene, on average (null: no plays)
  const pseudo = samples.filter((s) => s.pseudo)
  const pseudoMean = pseudo.length
    ? pseudo.reduce((s, x) => s + x.y, 0) / pseudo.length
    : null
  return {
    mu,
    W,
    beta,
    bMean,
    calib: { a, c },
    ratedMean,
    pseudoMean,
    nRated: rated.length,
    nPseudo: watchedUnrated.length,
    params,
  }
}

// ---------------------------------------------------------------- predict

// extra: { sceneOffset, featureDelta: Map, performerOffset: Map, penalty: Map }
export function predict(model, scene, extra) {
  const parts = []
  for (const [k, x] of sceneFeatures(scene, model.params)) {
    let w = model.W.get(k) || 0
    if (extra?.featureDelta) w += extra.featureDelta.get(k) || 0
    if (extra?.performerOffset && k[0] === 'p')
      w += extra.performerOffset.get(k.slice(2)) || 0
    if (extra?.penalty) w += extra.penalty.get(k) || 0
    if (w) parts.push({ key: k, value: w * x })
  }
  const b = scene.owned && model.params.useBehaviour ? behaviourOf(scene) : null
  if (b)
    parts.push({
      key: 'b',
      value: model.beta * (b.score - model.bMean),
      behaviour: b,
    })
  if (extra?.sceneOffset) parts.push({ key: 'o', value: extra.sceneOffset })
  const raw = model.mu + parts.reduce((s, p) => s + p.value, 0)
  return { value: Math.min(5, Math.max(0.5, raw)), raw, parts }
}

// ---------------------------------------------------------------- holdout

function shuffled(arr, seed) {
  let a = seed | 0
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Most rated scenes the fit trains on. A library whose every scene carries a
// rating (another plugin's, learned from on purpose) has 100,000 or more,
// and the fit's time grows with them: 144,000 took 12 s at once and a
// further 15 s of cross-validation. A few thousand, chosen across the
// library, give nearly the same weights.
export const MAX_TRAIN = 6000

// The rated scenes the fit trains on: all of them up to MAX_TRAIN; past it,
// every one the user played first (their plays are the strongest signal),
// then a seeded random share of the rest, the same on every load.
export function trainingSample(rated, max = MAX_TRAIN, seed = PARAMS.seed) {
  if (rated.length <= max) return rated
  const played = rated.filter((x) => x.b != null)
  if (played.length >= max) return shuffled(played, seed).slice(0, max)
  const rest = shuffled(
    rated.filter((x) => x.b == null),
    seed,
  ).slice(0, max - played.length)
  return [...played, ...rest]
}

export function crossValidate(rated, watchedUnrated, params = PARAMS) {
  const steps = crossValidateSteps(rated, watchedUnrated, params)
  for (;;) {
    const { done, value } = steps.next()
    if (done) return value
  }
}

// crossValidate one fold at a time: it yields after each fold's fit, so the
// browser can run the five fits as separate tasks instead of one long one
// (runtime/engine.js), and returns what crossValidate returns.
export function* crossValidateSteps(rated, watchedUnrated, params = PARAMS) {
  if (rated.length < MIN_RATED) return null
  const order = shuffled(rated, params.seed)
  const k = params.folds
  const rows = []
  for (let f = 0; f < k; f++) {
    const test = order.filter((_, i) => i % k === f)
    const train = order.filter((_, i) => i % k !== f)
    const m = fit(train, watchedUnrated, params)
    for (const t of test) {
      const p = predict(m, t.scene).value
      rows.push({ scene: t.scene, y: t.y, pred: p, base: m.ratedMean })
    }
    if (f < k - 1) yield
  }
  const mae = (key) =>
    rows.reduce((s, r) => s + Math.abs(r[key] - r.y), 0) / rows.length
  const within = (key) =>
    rows.filter((r) => Math.abs(r[key] - r.y) <= 0.5).length / rows.length
  return {
    n: rows.length,
    folds: k,
    maeModel: mae('pred'),
    maeBase: mae('base'),
    withinModel: within('pred'),
    withinBase: within('base'),
    rows,
  }
}
