// For you: the front page's first row, and the rows that follow it. Both hold
// only scenes you own; scenes you don't have show on performer pages and in the
// scene page's "Not in your library" row.
//
// Each card's rank adds five parts, in star units:
//   taste       long-term taste: Your score (or your rating, damped, since you
//               already know those), nudged by implicit signals from the row
//               (opened: a mild plus; passed over on 3+ visits: a small minus).
//               Until Your score has ten ratings to check itself against, it
//               also goes by the performers you favorite and rate in Stash
//               (statedFor), fading as your ratings arrive
//   momentum    performers, studios and tags you played in the last two weeks,
//               each play decaying with a 7-day half-life ("now" is the
//               library's asOf) and counting for the time behind it
//               (behaviour.js playWeight)
//   freshness   never watched or not watched in a long time: up; watched
//               recently: down, less so for people who rewatch a lot; seen
//               at all: down for people who rarely rewatch. A scene only
//               looked at counts as never watched
//   variety     at most 2 cards per performer, and a small minus for each card
//               already in the row that shares one
//   exploration 2 of the 12 cards are owned near-misses or forgotten favorites
//               in fixed slots (4 and 9). In the debug view it is how far the slot lifted the card above
//               the row's cut.
//
// Scenes marked "Don't learn from this" add nothing to momentum or signals
// (their own freshness still counts: it is a fact about the scene, not
// something learned). Scenes with a tag from "Tags to keep out of my picks"
// and scenes marked Not interested never appear.

import {
  isPlaceholderTag,
  localDay,
  timeAgo,
  fmtStars,
  sceneRating,
} from './util.js'
import { behaviourOf, barelyPlayed, playWeight } from './behaviour.js'
import { popularity, popularityLine } from './signals.js'
import { MIN_RATED } from './taste.js'

export const FY = {
  size: 12,
  halfLifeDays: 7,
  windowDays: 14,
  perPerformer: 2,
  explore: { 3: 'forgotten', 8: 'nearmiss' }, // slot index -> kind (2 of 12, about 20%)
  minLibrary: 30,
  newDays: 30,
}
const DAY = 86400000
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const r2 = (x) => Math.round(x * 100) / 100
const NUM = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]
const numWord = (n) => NUM[n] || String(n)
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * The plugin state the rows read (For you here, More like this in recs.js).
 * @typedef {object} RowState
 * @property {{ sceneId: string }[]} dontLearn  scenes marked "Don't learn
 *   from this" (tier 1)
 * @property {{ sceneId: string }[]} notInterested  scenes marked Not
 *   interested (tier 1)
 * @property {{ excludedTags?: string }} settings  excludedTags: "Tags to keep
 *   out of my picks", tag names separated by commas
 * @property {RowSignals} [signals]  For you's implicit signals (tier 3).
 *   computeForYou and followRows take the visit's copy as an argument
 *   (visitSignals), not this one.
 */

/**
 * For you's implicit signals, kept in browser storage (tier 3).
 * @typedef {object} RowSignals
 * @property {Record<string, number>} opens  scene id -> times opened from For you
 * @property {Record<string, number>} passes  scene id -> visits it was shown
 *   and not opened
 * @property {string[]} lastShown  the row's scene ids at the last visit
 * @property {string[]} lastShownOpened  those opened since
 */

// ---------------------------------------------------------------- inputs

// Every play the plugin can see: Stash's play_history, none for a scene only
// looked at (playWeight). sceneId -> sorted ms timestamps
export function playMap(db) {
  const out = new Map()
  for (const s of db.owned)
    out.set(
      s.id,
      playWeight(s)
        ? s.local.play_history.map((t) => Date.parse(t)).sort((a, b) => a - b)
        : [],
    )
  return out
}

export function excludedTagIds(db, text) {
  const names = new Set(
    String(text || '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  )
  if (!names.size) return new Set()
  return new Set(
    [...db.tags.values()]
      .filter((t) => names.has(t.name.toLowerCase()))
      .map((t) => t.id),
  )
}

// Decayed plays per performer (p:), studio (s:) and tag (t:) over the window
export function momentumOf(db, plays, skip, now) {
  const feat = new Map()
  let total = 0
  let count = 0
  // how common each tag and studio is in the library, for lift
  const lib = new Map()
  const bumpLib = (k) => lib.set(k, (lib.get(k) || 0) + 1)
  for (const s of db.owned) {
    for (const t of s.tags) if (!isPlaceholderTag(t)) bumpLib('t:' + t.id)
    if (s.studio) bumpLib('s:' + s.studio.id)
    if (s.studio?.parent) bumpLib('s:' + s.studio.parent.id)
    if (skip.has(s.id)) continue
    const q = playWeight(s)
    for (const at of plays.get(s.id) || []) {
      const age = (now - at) / DAY
      if (age < 0 || age > FY.windowDays) continue
      const w = q * 0.5 ** (age / FY.halfLifeDays)
      total += w
      count++
      // in a big cast each performer gets a smaller share of the play
      const pw = w / Math.sqrt(Math.max(1, s.performers.length / 2))
      const keys = s.performers.map((p) => ['p:' + p.id, pw])
      if (s.studio) keys.push(['s:' + s.studio.id, w])
      if (s.studio?.parent) keys.push(['s:' + s.studio.parent.id, w])
      for (const t of s.tags)
        if (!isPlaceholderTag(t)) keys.push(['t:' + t.id, w])
      for (const [k, kw] of keys) {
        let f = feat.get(k)
        if (!f)
          feat.set(k, (f = { m: 0, plays: 0, scenes: new Set(), oldest: 0 }))
        f.m += kw
        f.plays++
        f.scenes.add(s.id)
        f.oldest = Math.max(f.oldest, age)
      }
    }
  }
  // a tag's or studio's lift: its share of recent plays over its share of the
  // library (a network most of the library belongs to has little)
  const n = db.owned.length || 1
  for (const [k, f] of feat)
    if (k[0] !== 'p')
      f.lift = total ? Math.max(0, f.m / total - (lib.get(k) || 0) / n) : 0
  return { feat, total, count }
}

// Share of played scenes you came back to on another day, each day counting
// for what its plays do (playWeight): a scene whose time pays for one and a
// half days' plays is half a scene come back to
export function rewatchRate(db, plays, skip) {
  let played = 0
  let again = 0
  for (const s of db.owned) {
    if (skip.has(s.id)) continue
    const ps = plays.get(s.id) || []
    if (!ps.length) continue
    played++
    const days = new Set(ps.map((t) => localDay(new Date(t).toISOString())))
    again += clamp(days.size * playWeight(s) - 1, 0, 1)
  }
  return played ? again / played : 0
}

// M: the engine's compute() result. opts.hasStashdb: StashDB data is there to
// mix into the fallback row (default: the database has a StashDB part).
/** @param {RowState} state */
export function context(M, state, opts = {}) {
  const db = M.db
  const now = db.asOf
  const skip = new Set(state.dontLearn.map((d) => d.sceneId))
  const plays = playMap(db)
  const mom = momentumOf(db, plays, skip, now)
  const rewatch = rewatchRate(db, plays, skip)
  return {
    M,
    db,
    state,
    now,
    skip,
    plays,
    mom,
    rewatch,
    hasStashdb: opts.hasStashdb ?? db.hasStashdb,
    hidden: new Set(state.notInterested.map((n) => n.sceneId)),
    excluded: excludedTagIds(db, state.settings?.excludedTags),
  }
}

// Not marked Not interested, and no tag from "Tags to keep out of my picks"
export const allowed = (ctx, s) =>
  !ctx.hidden.has(s.id) && !s.tags.some((t) => ctx.excluded.has(t.id))
const lastPlay = (ctx, s) => {
  const ps = ctx.plays.get(s.id) || []
  return ps.length ? ps[ps.length - 1] : null
}

// ---------------------------------------------------------------- row signals

export const EMPTY_SIGNALS = {
  opens: {},
  passes: {},
  lastShown: [],
  lastShownOpened: [],
}

// What the row's signals add to a card's taste: opening it from For you adds
// 0.12 (up to two opens); shown and passed over on 3 visits loses 0.1 for
// each visit past two, down to −0.3
export function rowSignal(signals, sceneId) {
  let fb = 0
  fb += 0.12 * Math.min(2, signals.opens[sceneId] || 0)
  const pa = signals.passes[sceneId] || 0
  if (pa >= 3) fb -= Math.min(0.3, 0.1 * (pa - 2))
  return fb
}

// The signals a visit starts from: cards shown last visit and not opened
// count as passed over, once, here ("Don't learn" scenes teach nothing).
// skip: Set of "Don't learn" scene ids
export function visitSignals(signals, skip) {
  const passes = { ...signals.passes }
  for (const id of signals.lastShown)
    if (!signals.lastShownOpened.includes(id) && !skip.has(id))
      passes[id] = (passes[id] || 0) + 1
  return { ...signals, passes }
}

// What to store once the visit's row is shown: the row, for the next visit
// to count passes against. opened: the cards opened since the visit began
// (none, unless the row was recomputed within the visit)
export function shownSignals(visit, shownIds, opened = []) {
  return { ...visit, lastShown: shownIds, lastShownOpened: opened }
}

// Opening a card from For you: a mild plus (and it no longer counts as passed over)
export function openSignals(signals, sceneId, skip) {
  if (skip && skip.has(sceneId)) return signals
  return {
    ...signals,
    opens: { ...signals.opens, [sceneId]: (signals.opens[sceneId] || 0) + 1 },
    passes: { ...signals.passes, [sceneId]: 0 },
    lastShownOpened: [...signals.lastShownOpened, sceneId],
  }
}

// ---------------------------------------------------------------- the five parts

// What you told Stash about a scene's cast, for libraries with too few
// ratings to learn from: a favorite adds 0.5 stars, a performer rating 0.25
// per star above or below 3. The cast's best and worst performers count,
// scaled by the share of the ten ratings Your score still needs, so it is
// gone once Your score can check itself. Bracket picks need no share here:
// they are already in Your score's prediction.
export const STATED = { favorite: 0.5, perStar: 0.25 }

export function statedFor(ctx, s) {
  const { M, db } = ctx
  const share = M.ratingsToGo / MIN_RATED
  if (!share) return { value: 0, source: null }
  let best = null
  let worst = 0
  for (const credit of s.performers) {
    const favorite = db.favoritePerformerIds.has(credit.id)
    const r = M.performerRating(credit.id)
    const v =
      (favorite ? STATED.favorite : 0) +
      (r != null ? STATED.perStar * (r / 20 - 3) : 0)
    if (v > 0 && (!best || v > best.value))
      best = { performer: db.performers.get(credit.id), favorite, r, value: v }
    worst = Math.min(worst, v)
  }
  return { value: share * ((best?.value || 0) + worst), source: best }
}

function tasteOf(ctx, s, signals) {
  const { M } = ctx
  const r = s.owned ? M.rating(s) : null
  const est = r != null ? r / 20 : M.prediction(s.id).value
  const base = r != null ? 0.6 * (est - M.userMean) : est - M.userMean
  const fb = ctx.skip.has(s.id) ? 0 : rowSignal(signals, s.id)
  // your own rating says it all; the cast speaks for unrated scenes
  const stated = r != null ? 0 : statedFor(ctx, s).value
  return {
    value: base + fb + stated,
    base,
    feedback: fb,
    stated,
    rated: r != null,
  }
}

function momentumFor(ctx, s) {
  const { feat, total } = ctx.mom
  let perf = 0
  let topP = null
  for (const credit of s.performers) {
    const f = feat.get('p:' + credit.id)
    if (f && (!topP || f.m > topP.f.m))
      topP = { p: ctx.db.performers.get(credit.id), f }
  }
  if (topP) perf = 0.5 * (1 - Math.exp(-topP.f.m / 1.5))
  let studio = 0
  let topS = null
  for (const st of [s.studio, s.studio?.parent].filter(Boolean)) {
    const f = feat.get('s:' + st.id)
    if (f && f.lift > 0 && (!topS || f.lift > topS.f.lift)) topS = { st, f }
  }
  if (topS) studio = 0.3 * topS.f.lift
  let tag = 0
  let topT = null
  if (total) {
    const lifts = s.tags
      .filter((t) => !isPlaceholderTag(t))
      .map((t) => ({ t, f: feat.get('t:' + t.id) }))
      .filter((x) => x.f && x.f.lift > 0)
      .sort((a, b) => b.f.lift - a.f.lift)
    if (lifts.length) {
      topT = lifts[0]
      tag = (0.3 * lifts.slice(0, 3).reduce((a, x) => a + x.f.lift, 0)) / 3
    }
  }
  const parts = [
    ['performer', perf, topP],
    ['studio', studio, topS],
    ['tag', tag, topT],
  ].sort((a, b) => b[1] - a[1])
  return {
    value: perf + studio + tag,
    perf,
    studio,
    tag,
    source: parts[0][1] > 0 ? { kind: parts[0][0], ...parts[0][2] } : null,
  }
}

// How far a scene you have seen can come back, by how much you rewatch.
// Someone who rewatches half of what they play or more (the mockup's sample
// user: 73%) gets the full lift for scenes not watched in months. Someone who
// never rewatches gets none, and a scene they have seen ranks SEEN below one
// they haven't: on an invented 5,000-scene library with no rewatching, 10 of
// 12 cards were scenes already watched once.
const SEEN = 0.4
export function freshnessFor(ctx, s) {
  if (!s.owned) return { value: 0.3, kind: 'never' }
  const last = lastPlay(ctx, s)
  const addedDays = (ctx.now - Date.parse(s.local.created_at)) / DAY
  if (!last) {
    const isNew = addedDays <= FY.newDays
    return {
      value: 0.3 + (isNew ? 0.15 : 0),
      kind: isNew ? 'new' : 'never',
      addedDays,
      // Stash has plays of it, all looks
      looked: !!s.local.play_count,
    }
  }
  const d = (ctx.now - last) / DAY
  const P = 1.4 * (1 - 0.5 * ctx.rewatch)
  const w = Math.min(1, ctx.rewatch / 0.5)
  const value =
    -P * 0.5 ** (d / 14) +
    0.35 * w * clamp((d - 60) / 120, 0, 1) -
    SEEN * (1 - w)
  return {
    value,
    kind: d < 14 ? 'recent' : d >= 90 ? 'long' : 'mid',
    days: d,
    last,
  }
}

// ---------------------------------------------------------------- reasons

function monthOf(ctx, ms) {
  const d = new Date(ms)
  const same = d.getUTCFullYear() === new Date(ctx.now).getUTCFullYear()
  return MONTHS[d.getUTCMonth()] + (same ? '' : ' ' + d.getUTCFullYear())
}

// sceneId: the card's own scene, which doesn't count as "watched one of hers"
function momentumPhrase(ctx, src, sceneId) {
  const when = src.f.oldest <= 7 ? 'this week' : 'in the last two weeks'
  const n = src.f.scenes.size - (src.f.scenes.has(sceneId) ? 1 : 0)
  if (n <= 0) return null
  if (src.kind === 'performer')
    return `Because you watched ${numWord(n)} of ${src.p.name}'s ${when}`
  if (src.kind === 'studio')
    return `Because you watched ${numWord(n)} ${src.st.name} scene${n === 1 ? '' : 's'} ${when}`
  return `Like your last few plays: ${src.t.name}`
}

// Why the scene fits your taste: the favorite or rated performer that
// carries a cold library's pick, else Your score's own reason. null when
// neither has anything true to say.
function tastePhrase(ctx, s) {
  return tastePhrases(ctx, s)[0] ?? null
}

// The stated pick's sentence, then each of Your score's, strongest first.
function tastePhrases(ctx, s) {
  const st = statedFor(ctx, s)
  if (st.source && st.value >= 0.1) {
    const { performer: p, favorite, r } = st.source
    if (r != null && (r >= 80 || !favorite))
      return [`You rated ${p.name} ${fmtStars(r / 20).replace('.0', '')}★`]
    return [`With ${p.name}, one of your favorites`]
  }
  return (ctx.M.reasons?.(s.id, true) ?? []).map((r) => r.text)
}

function freshPhrase(ctx, s, f) {
  const r = ctx.M.rating(s)
  const rated =
    r != null && r >= 80
      ? `; you rated it ${fmtStars(r / 20).replace('.0', '')}★`
      : ''
  if (f.kind === 'new') return 'New in your library'
  if (f.kind === 'never') {
    const never = f.looked ? 'Not watched yet' : 'Never played'
    const t = tastePhrase(ctx, s)
    return t ? `${never} · ${t[0].toLowerCase() + t.slice(1)}` : never
  }
  if (f.kind === 'long')
    return `Not watched since ${monthOf(ctx, f.last)}` + rated
  if (f.kind === 'mid')
    return (
      `Last watched ${timeAgo(new Date(f.last).toISOString(), ctx.now)}` + rated
    )
  return null
}

// The reasons a card could give, best first, each with its kind: recent
// behaviour (momentum), then freshness, then taste. Exploration cards have
// one reason of their own.
function reasonOptions(ctx, it) {
  if (it.kind === 'forgotten')
    return [
      {
        kind: 'explore',
        text: freshPhrase(ctx, it.scene, it.f) || 'One of your favorites',
      },
    ]
  if (it.kind === 'nearmiss') {
    const t = tastePhrase(ctx, it.scene)
    return [
      {
        kind: 'explore',
        text: 'Worth a try' + (t ? ': ' + t[0].toLowerCase() + t.slice(1) : ''),
      },
    ]
  }
  const out = []
  const mp =
    it.m.source && it.m.value >= 0.2
      ? momentumPhrase(ctx, it.m.source, it.scene.id)
      : null
  if (mp) out.push({ kind: 'momentum', text: mp })
  const fp = freshPhrase(ctx, it.scene, it.f)
  if (fp) out.push({ kind: 'fresh', text: fp })
  for (const text of tastePhrases(ctx, it.scene))
    out.push({ kind: 'taste', text })
  out.push({
    kind: 'taste',
    text: ctx.M.ratingsToGo
      ? 'From your library'
      : 'A lot like scenes you rate well',
  })
  return out
}

// No kind of reason on more than half the row, and no one sentence more
// than twice: in the mockup 7 of 12 cards cited recent watching (the sample
// user's recent plays were their favourites) and the row read as
// repetitive. A card past a limit gives its next-best reason; only the text
// changes, never the ranking.
export const REASON_SHARE = 0.5
export function assignReasons(ctx, cards) {
  const cap = Math.ceil(cards.length * REASON_SHARE)
  const kinds = new Map()
  const texts = new Map()
  return cards.map((card) => {
    const options = reasonOptions(ctx, card)
    const pick =
      options.find(
        (o) => (kinds.get(o.kind) || 0) < cap && (texts.get(o.text) || 0) < 2,
      ) ||
      options.find((o) => (texts.get(o.text) || 0) < 2) ||
      options[options.length - 1]
    kinds.set(pick.kind, (kinds.get(pick.kind) || 0) + 1)
    texts.set(pick.text, (texts.get(pick.text) || 0) + 1)
    return pick
  })
}

// ---------------------------------------------------------------- the row

function scoreScene(ctx, s, signals) {
  const t = tasteOf(ctx, s, signals)
  const m = momentumFor(ctx, s)
  const f = freshnessFor(ctx, s)
  return { scene: s, t, m, f, base: t.value + m.value + f.value }
}

// For you's own order, before variety and exploration: taste, momentum and
// freshness over every scene you own that the row allows and `keep` lets
// through, highest first. Watch This plays the first (model/watch.js).
export function rankedScenes(ctx, signals, keep = () => true) {
  return ctx.db.owned
    .filter((s) => allowed(ctx, s) && keep(s))
    .map((s) => scoreScene(ctx, s, signals))
    .sort((a, b) => b.base - a.base)
}

// The reason For you gives one scene of rankedScenes on a card of its own:
// its best, with no other card to share the row's reasons with.
export const reasonFor = (ctx, x) =>
  reasonOptions(ctx, { ...x, kind: 'main' })[0].text

// signals: the visit's (visitSignals). Every candidate is a scene you own.
export function computeForYou(ctx, signals) {
  const { M } = ctx
  const scored = rankedScenes(ctx, signals)

  const loved = (x) =>
    (M.rating(x.scene) ?? 0) >= 90 ||
    (M.rating(x.scene) == null && (behaviourOf(x.scene)?.score ?? 0) >= 0.6)
  const forgotten = scored
    .filter((x) => x.f.kind === 'long' && loved(x))
    .sort((a, b) => b.t.value + b.f.value - (a.t.value + a.f.value))
  const nearmiss = scored.filter(
    (x) =>
      M.rating(x.scene) == null &&
      barelyPlayed(x.scene) &&
      x.t.value > -0.6 &&
      x.t.value < 0.2,
  )

  const picked = []
  const count = new Map()
  const capOk = (s) =>
    s.performers.every((p) => (count.get(p.id) || 0) < FY.perPerformer)
  const varietyOf = (s) =>
    -0.15 *
    picked.filter((it) =>
      it.scene.performers.some((p) => s.performers.some((q) => q.id === p.id)),
    ).length
  const isPicked = (s) => picked.some((it) => it.scene.id === s.id)
  const take = (x, kind, relaxed) => {
    const it = { ...x, kind, variety: varietyOf(x.scene), relaxed: !!relaxed }
    picked.push(it)
    for (const p of x.scene.performers)
      count.set(p.id, (count.get(p.id) || 0) + 1)
  }
  const bestMain = (relax) => {
    let best = null
    for (const x of scored) {
      if (isPicked(x.scene) || (!relax && !capOk(x.scene))) continue
      const v = x.base + varietyOf(x.scene)
      if (!best || v > best.v) best = { x, v }
    }
    return best?.x
  }
  for (let i = 0; i < FY.size; i++) {
    const ek = FY.explore[i]
    if (ek) {
      const pools =
        ek === 'forgotten' ? [forgotten, nearmiss] : [nearmiss, forgotten]
      let done = false
      for (const pool of pools) {
        // an exploration card is one the main ranking would not have shown
        const x = pool.find(
          (y) =>
            !isPicked(y.scene) &&
            capOk(y.scene) &&
            scored.indexOf(y) >= FY.size - 2,
        )
        if (x) {
          take(x, pool === forgotten ? 'forgotten' : 'nearmiss')
          done = true
          break
        }
      }
      if (done) continue
    }
    const x = bestMain(false) || bestMain(true)
    if (!x) break
    take(x, 'main', !capOk(x.scene))
  }

  // the cut: the lowest main card; exploration is how far its slot lifted a card past it
  const mains = picked.filter((it) => it.kind === 'main')
  const cut = mains.length
    ? Math.min(...mains.map((it) => it.base + it.variety))
    : 0
  const items = picked.map((it, i) => {
    const exploration =
      it.kind === 'main' ? 0 : Math.max(0, cut - (it.base + it.variety))
    const item = {
      scene: it.scene,
      kind: it.kind,
      parts: {
        taste: r2(it.t.value),
        momentum: r2(it.m.value),
        freshness: r2(it.f.value),
        variety: r2(it.variety),
        exploration: r2(exploration),
      },
      feedback: r2(it.t.feedback),
      total: r2(it.base + it.variety + exploration),
      slot: i + 1,
      momentumSource: it.m.source ? describeSource(it.m.source) : null,
      freshKind: it.f.kind,
    }
    item.key =
      it.m.source?.kind === 'performer' ? 'p:' + it.m.source.p.id : null
    return item
  })
  const reasons = assignReasons(
    ctx,
    picked.map((it, i) => ({ ...it, ...items[i], m: it.m, f: it.f })),
  )
  items.forEach((item, i) => {
    item.reason = reasons[i].text
    item.reasonKind = reasons[i].kind
  })
  return items
}

function describeSource(src) {
  if (src.kind === 'performer') return `${src.p.name} (${src.f.m.toFixed(2)})`
  if (src.kind === 'studio')
    return `${src.st.name} (lift ${src.f.lift.toFixed(2)})`
  return `${src.t.name} (lift ${src.f.lift.toFixed(2)})`
}

// ---------------------------------------------------------------- rows that follow For you

// 0–2 rows, only when recent watching justifies them, of scenes you own:
// "More with <performer>" (2+ of their scenes in the window, decayed plays
// ≥ 1.2) and "Back to <tag>" (3+ recent scenes, and a share of your recent
// plays at least 33 percentage points above its share of your library).
export function followRows(ctx, signals, shownIds) {
  const { db, M, mom } = ctx
  const shown = new Set(shownIds)
  const rows = []
  const performers = [...mom.feat]
    .filter(([k, f]) => k[0] === 'p' && f.m >= 1.2 && f.scenes.size >= 2)
    .sort((a, b) => b[1].m - a[1].m)
  for (const [k, f] of performers) {
    const p = db.performers.get(k.slice(2))
    if (!p?.localId || M.performerAffinity(p.id) < 0) continue
    const own = p.ownedSceneIds
      .map((id) => db.scenes.get(id))
      .filter((s) => allowed(ctx, s) && !shown.has(s.id))
      .map((s) => scoreScene(ctx, s, signals))
      .filter((x) => !(x.f.kind === 'recent' && x.f.days < 2))
      .sort((a, b) => b.t.value + b.f.value - (a.t.value + a.f.value))
      .map((x) => ({
        scene: x.scene,
        reason: followReason(ctx, x),
        key: 'p:' + p.id,
      }))
    const items = own.slice(0, 12)
    if (items.length >= 4)
      rows.push({
        id: 'more-' + p.id,
        title: `More with ${p.name}`,
        items,
        why: `${p.name}: ${f.m.toFixed(2)} decayed plays of ${f.scenes.size} scenes in ${FY.windowDays} days`,
        strength: f.m,
      })
    if (rows.length >= 2) break
  }
  const tags = [...mom.feat]
    .filter(
      ([k, f]) =>
        k[0] === 't' &&
        f.scenes.size >= 3 &&
        f.lift >= 0.33 &&
        (M.fits.content.W.get(k) ?? 0) >= 0,
    )
    .sort((a, b) => b[1].lift - a[1].lift)
  for (const [k, f] of tags.slice(0, 1)) {
    const t = db.tags.get(k.slice(2))
    const items = db.owned
      .filter(
        (s) =>
          s.tags.some((x) => x.id === t.id) &&
          allowed(ctx, s) &&
          !shown.has(s.id),
      )
      .map((s) => scoreScene(ctx, s, signals))
      .filter((x) => x.f.kind !== 'recent')
      .sort((a, b) => b.t.value + b.f.value - (a.t.value + a.f.value))
      .slice(0, 12)
      .map((x) => ({ scene: x.scene, reason: followReason(ctx, x), key: k }))
    if (items.length >= 4)
      rows.push({
        id: 'back-' + t.id,
        title: `Back to ${t.name}`,
        items,
        why: `${t.name}: in ${f.scenes.size} recent scenes, lift ${f.lift.toFixed(2)} over your library`,
        strength: f.m * f.lift,
      })
  }
  return rows.sort((a, b) => b.strength - a.strength).slice(0, 2)
}

function followReason(ctx, x) {
  return (
    freshPhrase(ctx, x.scene, x.f) ||
    tastePhrase(ctx, x.scene) ||
    'From your library'
  )
}

// ---------------------------------------------------------------- fallback

// While the model builds, and for libraries under ~30 scenes: a plain row of
// what's new in the library, with StashDB popularity mixed in when there's a
// key. Needs no model. (The mockup always had one, since its build was
// simulated; here, while the fit runs, build the context from withoutModel.)
// keep and size: the scenes it may show and how many (Watch This takes the
// ones with video, all of them).
export function newInLibrary(ctx, { keep = () => true, size = FY.size } = {}) {
  const { db } = ctx
  const list = db.owned
    .filter((s) => allowed(ctx, s) && keep(s) && (ctx.M.rating(s) ?? 60) >= 60)
    .filter((s) => {
      const last = lastPlay(ctx, s)
      return !last || (ctx.now - last) / DAY > 14
    })
    .slice()
    .sort((a, b) => b.local.created_at.localeCompare(a.local.created_at))
  const n = list.length || 1
  const scored = list.map((s, i) => {
    const pop = ctx.hasStashdb ? popularity(db, s) : null
    const popScore = pop?.global
      ? 1 - pop.global / 40
      : pop?.performer?.top
        ? 0.5 * (1 - pop.performer.top / 50)
        : 0
    return { s, pop, score: 1 - i / n + 0.8 * popScore }
  })
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map(({ s, pop }) => {
      const added = timeAgo(s.local.created_at, ctx.now)
      const line = pop ? popularityLine(pop) : null
      return {
        scene: s,
        reason: `Added ${added}` + (line ? ` · ${line}` : ''),
        key: null,
        kind: 'fallback',
      }
    })
}

export const tooSmall = (db) => db.owned.length < FY.minLibrary

// The part of the engine's result that context() and newInLibrary read, for
// before the model is ready: context(withoutModel(db, overrides), state)
export const withoutModel = (db, overrides) => ({
  db,
  rating: (s) => sceneRating(s, overrides),
})
