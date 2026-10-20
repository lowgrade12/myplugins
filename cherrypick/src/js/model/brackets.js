// Single-elimination brackets: pools, sizes, anchors and candidates, the
// first round, byes, playing order, undo, results, rating proposals. Pure
// functions over a plain bracket object that the plugin persists (tier 1),
// so a paused bracket survives a reload. Performer brackets are the main
// game; clip brackets ("Bracket her scenes", the Scenes list's Bracket
// button) are secondary.
//
// A bracket exists to add ratings for the model to learn from, and to find
// new favourites. People rate the performers and scenes they like most, so
// a bracket plays candidates (no rating of the user's own) and keeps anchors
// (the user's own rating, or for a performer, the average of the user's
// ratings on their scenes) for the places candidates can't fill: rated
// entrants would win their way to every final. A candidate's proposed
// rating comes from the anchors it beat and lost to when any played, and
// otherwise from where it finished: a bracket's entrants are spread over the
// model's range of the library, so its finishing order is laid over the
// user's own ratings (ratingScale). The champion may then meet up to three
// anchors in an optional Challenge round, which measures it on the user's
// scale and moves the rest with it. No rating or seed shows during play.

import { pluginRating } from './rankings.js'
import { fmtStars } from './util.js'
import { FIELD_PREFIX } from '../name.js'

export const SIZES = [16, 32, 64]
// Every bracket starts at 16 when the pool fills it; 32 and 64 only when picked
export const DEFAULT_SIZE = 16
export const MIN_CLIP_POOL = 4
export const CHAMPIONS_MIN = 4

/**
 * A bracket, as the plugin stores it.
 * @typedef {object} Bracket
 * @property {string} id
 * @property {'performer'|'clip'} kind
 * @property {string|null} gender  Stash's gender value (performer brackets)
 * @property {string} poolLabel
 * @property {number} size  slots: 4, 8, 16, 32 or 64 (byes fill the rest)
 * @property {boolean} champions  a Champions round
 * @property {string|null} origin  the page it was started from
 * @property {string[]} seeds  the entrants: performer or scene ids
 * @property {(string|null)[]} [slots]  the first round, two slots per match
 *   (null: a bye). Brackets from before anchors have none and seed 1 v N.
 * @property {Record<string, number>} [anchors]  the anchors and their
 *   rating100 when the bracket started
 * @property {string[]} [sceneAnchors]  the anchors whose rating100 is the
 *   average of the user's ratings on their scenes (performer brackets)
 * @property {string[]} [waiting]  rated records of the pool that did not
 *   play, which the Challenge round puts up first (waitingIn)
 * @property {number[]} [spread]  where the entrants sat in the library when
 *   it started, highest first (entrantSpread); brackets from before it work
 *   it out when they finish
 * @property {number|null} [championRating]  the user's rating of the
 *   champion, given on the champion screen
 * @property {{ winner: string, loser: string }[]} decisions  picks, in order
 * @property {string} createdAt  ISO
 * @property {string|null} finishedAt  ISO
 * @property {'active'|'done'} status
 * @property {BracketResult} [result]  set by the plugin when it finishes
 *   (bracketState's result)
 * @property {Challenge} [challenge]  the Challenge round offered when it
 *   finished (challengeFor)
 */

/**
 * The champion's Challenge round: the anchors it meets, in order.
 * @typedef {object} Challenge
 * @property {string[]} rungs  lowest rated first, the highest rated last
 * @property {Record<string, number>} ratings  each one's rating100 when the
 *   round was offered
 * @property {string[]} sceneRungs  those rated by their scenes' ratings
 * @property {{ winner: string, loser: string }[]} decisions  picks, in order
 * @property {boolean} [skipped]  the user chose to rate the champion by hand
 */

/**
 * @typedef {object} BracketResult
 * @property {string} champion
 * @property {string} finalist
 * @property {string[]} semifinalists
 * @property {string[]} quarterfinalists
 */

// ---------------------------------------------------------------- performer pools

// Who can enter a performer bracket: in your library, with a photo and a scene
export const eligible = (p) =>
  !!(p.local && p.image && p.local.scene_count >= 1)

// The performer's gender in Stash as read; the UI passes one with edits
// made since (Set genders) applied
const stashGender = (p) => p.local?.gender ?? null

// opts: { gender, pool: 'library'|'favorites'|'filter', filterIds?: Set }
// genderOf: the performer's gender in Stash right now
export function performerPool(M, opts, genderOf = stashGender) {
  return M.db.localPerformers
    .filter(eligible)
    .filter((p) => genderOf(p) === opts.gender)
    .filter(
      (p) => opts.pool !== 'favorites' || M.db.favoritePerformerIds.has(p.id),
    )
    .filter(
      (p) =>
        opts.pool !== 'filter' || !opts.filterIds || opts.filterIds.has(p.id),
    )
    .map((p) => p.id)
}

// Eligible except that Stash has no gender for them
export function genderless(M, genderOf = stashGender) {
  return M.db.localPerformers.filter(
    (p) => p.local.scene_count >= 1 && !genderOf(p),
  )
}

// The size a choice plays at: the picked size if the pool fills it, else 16
// if the pool fills that, else none (the setup sheet then offers fixes)
export const resolveSize = (pref, n) =>
  SIZES.includes(pref) && n >= pref
    ? pref
    : n >= DEFAULT_SIZE
      ? DEFAULT_SIZE
      : null

// Clip pools: the picked size (16, 32 or 64) as resolveSize gives it when the
// pool fills 16; a smaller pool (4 to 15) plays all of its scenes, in the
// next round size up, with byes for the top seeds
export function clipSize(n, pref = DEFAULT_SIZE) {
  if (n >= DEFAULT_SIZE) return resolveSize(pref, n)
  if (n < MIN_CLIP_POOL) return null
  let s = 4
  while (s < n) s *= 2
  return s
}

// "the 7" / "16 of the 60": the Bracket buttons' tooltips, naming what one
// click starts (16, or every scene under 16); Options has 32 and 64. The 16
// of a bigger pool spread over the model's whole range (composeEntrants),
// which clipPoolSpread adds after the pool's name.
export const clipPoolPhrase = (n) =>
  n <= DEFAULT_SIZE ? `the ${n}` : `${DEFAULT_SIZE} of the ${n}`
export const clipPoolSpread = (n) =>
  n > DEFAULT_SIZE ? ', from likely best to likely worst' : ''

// How many of a clip pool of 4 to 15 get a bye in the first round
export const clipByes = (n) =>
  n >= MIN_CLIP_POOL && n < DEFAULT_SIZE ? clipSize(n) - n : 0

// The scenes a scene bracket draws from: every owned scene, watched or not,
// except one with no picture to judge (an audio-only file) and one marked
// Don't learn from this, since every pick teaches the model
export const bracketScenes = (M) =>
  M.db.owned.filter((s) => !s.audioOnly && !M.dontLearn.has(s.id))

// The scenes a clip bracket plays out of a pool: those with
// no rating of the user's own, when there are MIN_CLIP_POOL of them, so the
// rated ones wait for the champion's Challenge round; else the whole pool.
// A clip pool under 16 plays every scene it gets, so without this the rated
// ones would play in every small bracket.
export function clipEntrants(M, ids) {
  const unrated = ids.filter((id) => entrantRole(M, 'clip', id) !== 'anchor')
  return unrated.length >= MIN_CLIP_POOL ? unrated : ids
}

// ---------------------------------------------------------------- anchors and candidates

// A rating a bracket stepped down from its champion's instead of measuring
// it against an anchor. The field holds the rating100 Cherry Pick wrote, so
// once the rating differs the user has changed it and it is theirs; until
// then a later bracket treats the record as a candidate and may correct it.
export const PROVISIONAL_FIELD = FIELD_PREFIX + 'provisional'

// True while the record's rating is still the provisional one Cherry Pick
// wrote (Stash may return the field as a number or a string)
export function isProvisional(local, rating100 = local?.rating100) {
  const v = local?.custom_fields?.[PROVISIONAL_FIELD]
  if (rating100 == null || v == null || v === '') return false
  return Number(v) === rating100
}

const recordOf = (M, kind, id) =>
  kind === 'performer' ? M.db.performers.get(id) : M.db.scenes.get(id)

// Stash's rating on a record now
function stashRatingOf(M, kind, id) {
  if (kind === 'performer') return M.stashPerformerRating(id)
  const s = M.db.scenes.get(id)
  return s ? M.stashRating(s) : null
}

// What an entrant is to a bracket. An anchor carries the user's own rating:
// the bracket measures the others against it and never rewrites it. A
// candidate has none of the user's own (unrated, primed by Ascension, or
// provisional), so the bracket proposes one. A ranked record's rating
// belongs to another plugin: it can play, but Apply never writes it.
export function entrantRole(M, kind, id) {
  const source = M.ratingSource(kind, id)
  if (source && source !== 'primed') return 'ranked'
  const r = stashRatingOf(M, kind, id)
  if (r == null || source === 'primed') return 'candidate'
  return isProvisional(recordOf(M, kind, id)?.local, r) ? 'candidate' : 'anchor'
}

// A performer the user never rated can still anchor a performer bracket,
// at the average of the user's ratings on their scenes, so someone who
// rates scenes and not performers gets anchors too. A scene's rating counts
// when it would anchor a clip bracket (the user's own: no other plugin's,
// no Prime's, not provisional) and the scene is not marked Don't learn from
// this. Like any anchor it is never rewritten, so the performer stays
// unrated and can anchor again.
export const SCENE_ANCHOR_MIN = 2

// The average of the user's own ratings on a performer's scenes, as a
// whole rating100 (Stash's ratings are whole numbers), or null with fewer
// than SCENE_ANCHOR_MIN of them
export function sceneAverage(M, id) {
  let n = 0
  let sum = 0
  for (const sid of M.db.performers.get(id)?.ownedSceneIds || []) {
    if (M.dontLearn.has(sid) || entrantRole(M, 'clip', sid) !== 'anchor')
      continue
    n++
    sum += stashRatingOf(M, 'clip', sid)
  }
  return n >= SCENE_ANCHOR_MIN ? Math.round(sum / n) : null
}

// The rating a performer candidate anchors at by their scenes: their scene
// average when Stash has no rating for them or only Prime's. A provisional
// rating keeps them a candidate, so a bracket can still correct it.
function sceneAnchorRating(M, id) {
  const r = M.stashPerformerRating(id)
  if (isProvisional(M.db.performers.get(id)?.local, r)) return null
  return sceneAverage(M, id)
}

// How strong the model thinks an entrant is: performer affinity, or a
// scene's estimate in stars
const strengthOf = (M, kind) =>
  kind === 'performer'
    ? (id) => M.performerAffinity(id)
    : (id) => M.estimate(id)

// k targets for spreadPick: evenly spaced from the highest value to the
// lowest (linear), or the values at evenly spaced ranks (byRank), which
// keeps a bunched distribution's shape and, when every value is equal,
// leaves the order to decide
export function linearTargets(vals, k) {
  let hi = -Infinity
  let lo = Infinity
  for (const v of vals) {
    if (v > hi) hi = v
    if (v < lo) lo = v
  }
  return Array.from({ length: k }, (_, i) =>
    k === 1 ? hi : hi - (i * (hi - lo)) / (k - 1),
  )
}
export function byRankTargets(vals, k) {
  const sorted = vals.slice().sort((a, b) => b - a)
  return Array.from(
    { length: k },
    (_, i) =>
      sorted[k === 1 ? 0 : Math.round((i * (sorted.length - 1)) / (k - 1))],
  )
}

// k of ids, spread over their values: for each target in turn, the unused
// id nearest it. ids come strongest first, so ties go to the stronger.
export function spreadPick(ids, value, k, targetsFor = byRankTargets) {
  if (k >= ids.length) return ids.slice()
  if (k <= 0) return []
  const vals = ids.map(value)
  const used = new Uint8Array(ids.length)
  const out = []
  for (const t of targetsFor(vals, k)) {
    let best = -1
    for (let j = 0; j < ids.length; j++)
      if (
        !used[j] &&
        (best < 0 || Math.abs(vals[j] - t) < Math.abs(vals[best] - t))
      )
        best = j
    used[best] = 1
    out.push(ids[best])
  }
  return out
}

// How many past brackets of a kind (and gender) hold their entrants back
export const RECENT_BRACKETS = 3

// Who played in the last RECENT_BRACKETS finished brackets of a kind (and,
// for performers, of one gender), Champions rounds aside: they wait while
// others can fill a bracket, so the next one shows new faces
export function recentEntrants(history, kind, gender = null) {
  return new Set(
    history
      .filter(
        (b) =>
          b.kind === kind &&
          b.result &&
          !b.champions &&
          (kind !== 'performer' || b.gender === gender),
      )
      .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))
      .slice(0, RECENT_BRACKETS)
      .flatMap((b) => b.seeds || []),
  )
}

// k of ids by pickK(ids, k): those not in `recent` first, the recent ones
// only for the places left
function freshFirst(ids, k, recent, pickK) {
  if (!recent?.size) return pickK(ids, k)
  const fresh = ids.filter((id) => !recent.has(id))
  const kf = Math.min(k, fresh.length)
  return [
    ...pickK(fresh, kf),
    ...pickK(
      ids.filter((id) => recent.has(id)),
      k - kf,
    ),
  ]
}

// Who plays, out of a pool of ids: candidates take every place they can,
// records another plugin ranks come next, and anchors only fill what is
// left. People rate their favourites, so anchors in the bracket would win
// their way to every final. Anchors with a rating of their own come first;
// performers anchored by their scenes' ratings (sceneAverage) fill the
// anchor places left after them. Candidates spread over the model's whole
// range, not only the likely favourites, since the model learns from
// contrast; anchors spread over the user's own scale, so each candidate
// that meets one has one near it. Entrants of recent brackets (`recent`)
// wait while others can fill their places. Anchors come back highest rated
// first, the rest strongest first; `ratings` holds each anchor's rating100
// and `sceneAnchors` names those from scene ratings.
export function composeEntrants(M, kind, ids, size, recent = null) {
  const strength = strengthOf(M, kind)
  const byStrength = (a, b) => strength(b) - strength(a)
  const role = { anchor: [], scene: [], candidate: [], ranked: [] }
  const average = new Map()
  for (const id of ids) {
    const r = entrantRole(M, kind, id)
    const avg =
      r === 'candidate' && kind === 'performer'
        ? sceneAnchorRating(M, id)
        : null
    if (avg != null) average.set(id, avg)
    role[avg != null ? 'scene' : r].push(id)
  }
  for (const list of Object.values(role)) list.sort(byStrength)
  const kC = Math.min(role.candidate.length, size)
  const kR = Math.min(role.ranked.length, size - kC)
  const kA = Math.min(role.anchor.length, size - kC - kR)
  const kS = Math.min(role.scene.length, size - kC - kR - kA)
  const rating = (id) =>
    average.has(id) ? average.get(id) : stashRatingOf(M, kind, id)
  const byRating = (a, b) => rating(b) - rating(a) || byStrength(a, b)
  const spread = (list, k) =>
    spreadPick(list.slice().sort(byRating), rating, k, linearTargets)
  const sceneAnchors = spread(role.scene, kS)
  const anchors = [...spread(role.anchor, kA), ...sceneAnchors].sort(byRating)
  return {
    anchors,
    candidates: freshFirst(role.candidate, kC, recent, (list, k) =>
      spreadPick(list, strength, k),
    ),
    ranked: freshFirst(role.ranked, kR, recent, (list, k) => list.slice(0, k)),
    ratings: Object.fromEntries(anchors.map((id) => [id, rating(id)])),
    sceneAnchors,
  }
}

// 1 v N: [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6] ... so 1 and 2 can only
// meet in the final. Spreads the first round's matches, and seeds the
// brackets played before anchors.
export function seedOrder(n) {
  let s = [1]
  while (s.length < n) {
    const m = s.length * 2
    s = s.flatMap((x) => [x, m + 1 - x])
  }
  return s
}

// A small seeded generator (mulberry32), so a bracket's sides are random
// but the same for the same `now`
function randomFrom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Evenly spaced picks of k indexes out of n (k <= n), first and last kept
const evenly = (k, n) =>
  Array.from({ length: k }, (_, i) =>
    k === 1 ? 0 : Math.round((i * (n - 1)) / (k - 1)),
  )

/**
 * The first round's slots, two per match (null: a bye). Each candidate
 * meets the anchor of matching rank, so its first pick already places it on
 * the user's scale; byes go to anchors first, which need no measuring; what
 * is left plays across its halves, the strongest against the strongest of
 * the weaker half (1 v 9, 2 v 10 of 16). Since every entrant is rated from
 * where it finished, the strongest shouldn't knock each other out in round
 * one, and a match across halves is still close enough to teach the model.
 * Seeds never show, so the order serves the measuring: matches spread like
 * seeds (the top pairs' apart) and each match's sides are drawn at random.
 * @param {string[]} anchors  highest rated first
 * @param {string[]} unknowns  candidates and ranked records, strongest first
 * @param {number} size
 * @param {number} now  seeds the sides
 */
export function firstRoundSlots(anchors, unknowns, size, now = 0) {
  const n = anchors.length + unknowns.length
  const matches = n - size / 2
  let byes = size - n
  const x = Math.min(anchors.length, unknowns.length, matches)
  const takeA = new Set(evenly(x, anchors.length))
  const takeU = new Set(evenly(x, unknowns.length))
  const pA = anchors.filter((_, i) => takeA.has(i))
  const pU = unknowns.filter((_, i) => takeU.has(i))
  const units = pA.map((a, i) => [a, pU[i]])
  const restA = anchors.filter((_, i) => !takeA.has(i))
  const restU = unknowns.filter((_, i) => !takeU.has(i))
  for (const list of [restA, restU])
    while (byes > 0 && list.length) {
      units.push([list.shift(), null])
      byes--
    }
  const left = [...restU, ...restA]
  const half = left.length / 2
  for (let i = 0; i < half; i++) units.push([left[i], left[i + half]])
  const rand = randomFrom(now)
  const slots = []
  for (const rank of seedOrder(size / 2)) {
    const [p, q] = units[rank - 1]
    if (q && rand() < 0.5) slots.push(q, p)
    else slots.push(p, q)
  }
  return slots
}

// kind: 'performer' | 'clip'; ids: who may play; pool: the whole pool, when
// some of it may not play (a clip pool's rated scenes, clipEntrants); size:
// slots (byes fill the rest). recent: entrants of recent brackets
// (recentEntrants), who wait while others can fill the bracket. now: when it is created, for its id and
// createdAt: the time of the click, not the library's asOf, so two brackets
// in one session get different ids.
export function createBracket(
  M,
  {
    kind,
    gender = null,
    poolLabel,
    size,
    ids,
    champions = false,
    origin = null,
    recent = null,
    pool = ids,
    now = Date.now(),
  },
) {
  const strength = strengthOf(M, kind)
  const { anchors, candidates, ranked, ratings, sceneAnchors } =
    composeEntrants(M, kind, ids, size, recent)
  const unknowns = [...candidates, ...ranked].sort(
    (a, b) => strength(b) - strength(a),
  )
  const slots = firstRoundSlots(anchors, unknowns, size, now)
  const seeds = slots.filter(Boolean)
  return {
    id: 'b' + now.toString(36),
    kind,
    gender,
    poolLabel,
    size,
    champions,
    origin,
    seeds,
    slots,
    spread: entrantSpread(M, kind, gender, seeds),
    anchors: ratings,
    sceneAnchors,
    waiting: champions ? [] : waitingIn(M, kind, pool, slots),
    championRating: null,
    decisions: [],
    createdAt: new Date(now).toISOString(),
    finishedAt: null,
    status: 'active',
  }
}

// ---------------------------------------------------------------- playing

export function roundName(slotsInRound) {
  if (slotsInRound === 2) return 'Final'
  if (slotsInRound === 4) return 'Semifinals'
  if (slotsInRound === 8) return 'Quarterfinals'
  return `Round of ${slotsInRound}`
}

// Rebuild the whole tree from the first round and the picks made so far. A
// missing entrant (smaller pools) is a bye: the other side goes through
// untouched.
export function bracketState(b) {
  let entrants = b.slots
    ? b.slots.slice()
    : seedOrder(b.size).map((seed) => b.seeds[seed - 1] || null)
  const rounds = []
  let di = 0
  let current = null
  while (entrants.length > 1) {
    const matches = []
    for (let i = 0; i < entrants.length; i += 2)
      matches.push({
        a: entrants[i],
        b: entrants[i + 1],
        winner: null,
        bye: false,
      })
    rounds.push(matches)
    const first = rounds.length === 1
    matches.forEach((m, mi) => {
      if (!m.a || !m.b) {
        // a missing seed in the first round is a bye; later it's still to be decided
        if (first) {
          m.winner = m.a || m.b
          m.bye = true
        }
        return
      }
      const d = b.decisions[di]
      if (!current && d) {
        m.winner = d.winner
        di++
      } else if (!current) {
        current = { round: rounds.length - 1, index: mi, a: m.a, b: m.b }
      }
    })
    entrants = matches.map((m) => m.winner)
  }
  const loserOf = (m) => (m.winner === m.a ? m.b : m.a)
  const done = !current
  const n = rounds.length
  const result = done
    ? {
        champion: rounds[n - 1][0].winner,
        finalist: loserOf(rounds[n - 1][0]),
        semifinalists: n >= 2 ? rounds[n - 2].map(loserOf).filter(Boolean) : [],
        quarterfinalists:
          n >= 3 ? rounds[n - 3].map(loserOf).filter(Boolean) : [],
      }
    : null
  let label = 'Finished'
  let roundLabel = null
  if (current) {
    const r = rounds[current.round]
    const real = r.filter((m) => !m.bye)
    const idx = real.indexOf(r[current.index])
    roundLabel = roundName(r.length * 2)
    label =
      real.length > 1
        ? `${roundLabel} · match ${idx + 1} of ${real.length}`
        : roundLabel
  }
  return {
    rounds,
    current,
    done,
    result,
    played: b.decisions.length,
    totalMatches: b.seeds.length - 1,
    label,
    roundLabel,
  }
}

export function pick(b, winner) {
  const st = bracketState(b)
  if (!st.current) return b
  const loser = winner === st.current.a ? st.current.b : st.current.a
  return { ...b, decisions: [...b.decisions, { winner, loser }] }
}

export function undo(b) {
  if (!b.decisions.length) return b
  return { ...b, decisions: b.decisions.slice(0, -1) }
}

// A bracket's picks as the engine takes them (EngineInput.decisions), its
// Challenge round's included
export function modelDecisions(b) {
  return [...(b.decisions || []), ...(b.challenge?.decisions || [])].map(
    (d) => ({
      kind: b.kind,
      winner: d.winner,
      loser: d.loser,
      bracket: b.id,
    }),
  )
}

// ---------------------------------------------------------------- the Challenge round

// The most anchors a champion meets
export const CHALLENGE_RUNGS = 3
// The most rated records a bracket keeps as waiting for its champion
export const WAITING_KEEP = 12

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)

// The rated records among ids, as a bracket would anchor them: the user's
// own rating, else (performers) the average of their scene ratings. above:
// only those rated higher. Returns { own, scene, rating }.
function ratedIn(M, kind, ids, above = -Infinity) {
  const rating = new Map()
  const own = []
  const scene = []
  for (const id of ids) {
    const role = entrantRole(M, kind, id)
    const r =
      role === 'anchor'
        ? stashRatingOf(M, kind, id)
        : role === 'candidate' && kind === 'performer'
          ? sceneAnchorRating(M, id)
          : null
    if (r == null || r <= above) continue
    rating.set(id, r)
    ;(role === 'anchor' ? own : scene).push(id)
  }
  return { own, scene, rating }
}

// k of them, spread over the user's stars like a bracket's anchors: own
// ratings first, scene averages filling. Returns { own, scene }.
function spreadRated(M, kind, { own, scene, rating }, k) {
  const strength = strengthOf(M, kind)
  const value = (id) => rating.get(id)
  const byRating = (x, y) => value(y) - value(x) || strength(y) - strength(x)
  const spread = (list, n) =>
    spreadPick(list.slice().sort(byRating), value, n, linearTargets)
  const kOwn = Math.min(own.length, k)
  return { own: spread(own, kOwn), scene: spread(scene, k - kOwn) }
}

/**
 * The rated records of a bracket's pool that did not play, up to
 * WAITING_KEEP spread over the user's stars: the Challenge round puts these
 * up first, so the champion of a list meets the favorites of that list.
 * @param {object} M
 * @param {'performer'|'clip'} kind
 * @param {string[]} pool
 * @param {(string|null)[]} played  the bracket's slots
 * @returns {string[]}
 */
export function waitingIn(M, kind, pool, played) {
  const seeds = new Set(played)
  const r = spreadRated(
    M,
    kind,
    ratedIn(
      M,
      kind,
      pool.filter((id) => !seeds.has(id)),
    ),
    WAITING_KEEP,
  )
  return [...r.own, ...r.scene]
}

/**
 * The Challenge round a finished bracket offers its champion, or null. The
 * champion must have no rating of the user's own (an anchor needs no
 * measuring), and the user must have rated records of the bracket's kind,
 * and for performers its gender, that did not play in it: up to
 * CHALLENGE_RUNGS of them, those the bracket's pool held back first
 * (b.waiting) and the rest of the library filling, each spread over the
 * user's stars like a bracket's anchors (own ratings first, scene averages
 * filling) and above every anchor the champion already beat in the bracket,
 * met lowest rated first so the highest rated comes last. Champions rounds
 * have none.
 * @param {object} M
 * @param {Bracket} b  finished: b.result set
 * @param {(p: object) => string|null} [genderOf]
 * @returns {Challenge|null}
 */
export function challengeFor(M, b, genderOf = stashGender) {
  const champ = b.result?.champion
  const kind = b.kind
  if (!champ || b.champions || has(b.anchors, champ)) return null
  if (entrantRole(M, kind, champ) === 'anchor') return null
  const played = new Set(b.seeds)
  // a champion beat every anchor in its bracket, directly or through
  // someone it beat
  const floor = Math.max(-Infinity, ...Object.values(b.anchors || {}))
  const library = (
    kind === 'performer'
      ? M.db.localPerformers
          .filter(eligible)
          .filter((p) => genderOf(p) === b.gender)
          .map((p) => p.id)
      : bracketScenes(M).map((s) => s.id)
  ).filter((id) => !played.has(id))
  const inLibrary = new Set(library)
  const held = (b.waiting || []).filter((id) => inLibrary.has(id))
  const heldSet = new Set(held)
  const first = spreadRated(
    M,
    kind,
    ratedIn(M, kind, held, floor),
    CHALLENGE_RUNGS,
  )
  const n = first.own.length + first.scene.length
  const rest = spreadRated(
    M,
    kind,
    ratedIn(
      M,
      kind,
      library.filter((id) => !heldSet.has(id)),
      floor,
    ),
    CHALLENGE_RUNGS - n,
  )
  const sceneRungs = [...first.scene, ...rest.scene]
  const all = [...first.own, ...first.scene, ...rest.own, ...rest.scene]
  if (!all.length) return null
  const rating = (id) =>
    sceneRungs.includes(id)
      ? sceneAnchorRating(M, id)
      : stashRatingOf(M, kind, id)
  const strength = strengthOf(M, kind)
  // lowest rated first; on a tie, the weaker first
  const rungs = all.sort(
    (x, y) => rating(x) - rating(y) || strength(x) - strength(y),
  )
  return {
    rungs,
    ratings: Object.fromEntries(rungs.map((id) => [id, rating(id)])),
    sceneRungs,
    decisions: [],
  }
}

/**
 * Where a bracket's Challenge round stands, or null when it has none. The
 * champion meets the anchors in order until one beats it.
 * @param {Bracket} b
 * @returns {{ rungs: string[], beaten: string[], lostTo: string|null,
 *   current: string|null, started: boolean, done: boolean, won: boolean,
 *   skipped: boolean }|null}  current: the anchor the champion meets now;
 *   won: it beat every one
 */
export function challengeState(b) {
  const c = b?.challenge
  const champ = b?.result?.champion
  if (!c || !champ) return null
  const beaten = []
  let lostTo = null
  for (const [i, d] of c.decisions.entries()) {
    if (i >= c.rungs.length) break
    if (d.winner !== champ) {
      lostTo = c.rungs[i]
      break
    }
    beaten.push(c.rungs[i])
  }
  const current =
    lostTo || beaten.length >= c.rungs.length ? null : c.rungs[beaten.length]
  return {
    rungs: c.rungs,
    beaten,
    lostTo,
    current,
    started: c.decisions.length > 0,
    done: !current,
    won: !lostTo && c.rungs.length > 0 && beaten.length === c.rungs.length,
    skipped: !!c.skipped && !c.decisions.length,
  }
}

// The champion beat every anchor its Challenge round put up
export const challengeWon = (b) => !!challengeState(b)?.won

// One Challenge round pick: the champion or the anchor it meets now.
// against: the anchor on screen when the pick was made, so a second click
// that lands after the next match showed is dropped. What the round
// measures replaces a rating the user gave the champion by hand.
export function challengePick(b, winner, against = null) {
  const st = challengeState(b)
  if (!st?.current || (against != null && against !== st.current)) return b
  const champ = b.result.champion
  if (winner !== champ && winner !== st.current) return b
  const loser = winner === champ ? st.current : champ
  return {
    ...b,
    championRating: null,
    challenge: {
      ...b.challenge,
      skipped: false,
      decisions: [...b.challenge.decisions, { winner, loser }],
    },
  }
}

export function challengeUndo(b) {
  if (!b.challenge?.decisions.length) return b
  return {
    ...b,
    challenge: {
      ...b.challenge,
      decisions: b.challenge.decisions.slice(0, -1),
    },
  }
}

// Skip: the user rates the champion by hand; skipped false offers the
// round again
export const skipChallenge = (b, skipped = true) =>
  b.challenge ? { ...b, challenge: { ...b.challenge, skipped } } : b

// ---------------------------------------------------------------- results across brackets

const performerBrackets = (history) =>
  history.filter((b) => b.kind === 'performer' && b.result)

// { [performerId]: { champion: n, finalist: n, challenger: n } }:
// challenger counts the Challenge rounds won (challengeWon)
export function performerHonours(history) {
  const out = {}
  const bump = (id, k) => {
    if (!id) return
    out[id] = out[id] || { champion: 0, finalist: 0, challenger: 0 }
    out[id][k]++
  }
  for (const b of performerBrackets(history)) {
    bump(b.result.champion, 'champion')
    bump(b.result.finalist, 'finalist')
    if (challengeWon(b)) bump(b.result.champion, 'challenger')
  }
  return out
}

// Distinct champions of ordinary performer brackets of one gender, newest first
export function championsOf(history, gender) {
  const seen = new Set()
  return performerBrackets(history)
    .filter((b) => !b.champions && b.gender === gender)
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
    .map((b) => b.result.champion)
    .filter((id) => !seen.has(id) && seen.add(id))
}

export function championsRoundSize(n) {
  if (n < CHAMPIONS_MIN) return 0
  let s = 4
  while (s * 2 <= Math.min(n, 16)) s *= 2
  return s
}

// ---------------------------------------------------------------- tier 2: custom fields on performers

// Namespaced custom fields the plugin writes on a performer at the end of a
// bracket (performerUpdate, custom_fields partial). Stash shows them in the
// performer's details and can filter the Performers list by them.
export const FIELDS = {
  titles: FIELD_PREFIX + 'titles', // number: brackets won
  best: FIELD_PREFIX + 'best_finish', // string: champion, final, semifinal, quarterfinal
  last: FIELD_PREFIX + 'last_bracket', // date: the last bracket they placed in
}
export const FIELD_TYPES = {
  [FIELDS.titles]: 'number',
  [FIELDS.best]: 'string',
  [FIELDS.last]: 'date',
}
const FINISH_ORDER = ['quarterfinal', 'semifinal', 'final', 'champion']

// The plugin's own fields on a performer or scene (custom_fields as Stash
// returns them), for Remove Cherry Pick data: only these go, never another
// plugin's, Ascension's and HotOrNot's included
export const OWN_FIELDS = [...Object.values(FIELDS), PROVISIONAL_FIELD]
export const ownFieldsOn = (customFields) =>
  OWN_FIELDS.filter((f) => f in (customFields || {}))

// The partial custom fields one finished performer bracket writes: one
// performerUpdate per placed performer (quarterfinals and better, at most 8),
// once, when the bracket ends. current: { [performerId]: fields } now.
export function bracketFieldUpdates(current, b) {
  if (b.kind !== 'performer' || !b.result) return {}
  const r = b.result
  const date = (b.finishedAt || '').slice(0, 10)
  const placed = [
    [r.champion, 'champion'],
    [r.finalist, 'final'],
    ...(r.semifinalists || []).map((x) => [x, 'semifinal']),
    ...(r.quarterfinalists || []).map((x) => [x, 'quarterfinal']),
  ].filter(([x]) => x)
  const out = {}
  for (const [id, finish] of placed) {
    const cur = current[id] || {}
    const prev = cur[FIELDS.best]
    out[id] = {
      [FIELDS.titles]:
        (cur[FIELDS.titles] || 0) + (finish === 'champion' ? 1 : 0),
      [FIELDS.best]:
        FINISH_ORDER.indexOf(finish) > FINISH_ORDER.indexOf(prev)
          ? finish
          : prev,
      [FIELDS.last]: date,
    }
  }
  return out
}

// Fields as they'd stand after a run of brackets, oldest first (to rebuild
// them from the Hall of Fame)
export function fieldsFromHistory(history) {
  const cf = {}
  const runs = history
    .filter((b) => b.kind === 'performer' && b.result)
    .sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))
  for (const b of runs) {
    const up = bracketFieldUpdates(cf, b)
    for (const [id, f] of Object.entries(up))
      cf[id] = { ...(cf[id] || {}), ...f }
  }
  return cf
}

// ---------------------------------------------------------------- Apply to my ratings

// A candidate's rating comes from the anchors around it in the tree: it
// ranks above everyone it beat and everyone they beat, and below whoever
// beat it and whoever beat them. Between two anchors it gets the midpoint
// (to a quarter star); above only one, half a star more. Below only one
// says too little: a loss to a favourite fits any rating under it, so it
// sets nothing on its own.
//
// The champion is measured by its Challenge round as well: between the
// last anchor it beat and the one that beat it, or half a star above the
// highest it beat. Every candidate no anchor places, first-round losers
// included, is rated from where it finished: the finishing order is laid
// over the user's own ratings (ratingScale), each place taking the rating
// at the share of the library the entrant in it was drawn from
// (entrantSpread). These are marked provisional. When the champion is
// measured, or the user rates it on the champion screen, they all move by
// the difference between that and the champion's rating from its finish.
// None is ever above half a star under an anchor that beat it.
//
// Anchors are never written, those from scene ratings included, and the
// preview names those apart: "Cleo Finch (3.8★ from your scene ratings)". A
// rating Ascension's Prime set counts as none.
// A placed record Ascension, HotOrNot or Xenith ranks, or whose rating is
// Restash's mirrored score, is listed with skip: 'ranked' or 'mirrored', to
// show why it is left alone.

const HALF = 10 // half a star in rating100
const clampRating = (r) => Math.min(100, Math.max(HALF, r))
// a midpoint, to the nearest quarter star: between a 4★ and a 4.5★ anchor
// is 4.25★, not either anchor's rating
const quarterStars = (r) => Math.round(r / 5) * 5

// How far short of the title: 0 the champion, 1 the finalist, 2 a
// semifinalist, 3 a quarterfinalist, then earlier rounds
function finishLabel(short) {
  return (
    ['Champion', 'Finalist', 'Semifinalist', 'Quarterfinalist'][short] ||
    `Round of ${2 ** short}`
  )
}

// What the finished tree says about each entrant: everyone it beat
// (directly or through someone it beat), everyone above it (whoever beat it,
// and whoever beat them), and the round it went out in
function treeOrder(st) {
  const beaten = new Map()
  const conqueror = new Map()
  const outIn = new Map()
  st.rounds.forEach((round, ri) => {
    for (const m of round) {
      if (m.bye || !m.winner || !m.a || !m.b) continue
      const w = m.winner
      const l = w === m.a ? m.b : m.a
      const set = beaten.get(w) || new Set()
      set.add(l)
      for (const x of beaten.get(l) || []) set.add(x)
      beaten.set(w, set)
      conqueror.set(l, w)
      outIn.set(l, ri)
    }
  })
  const above = (id) => {
    const out = []
    for (let c = conqueror.get(id); c; c = conqueror.get(c)) out.push(c)
    return out
  }
  return {
    beaten: (id) => beaten.get(id) || new Set(),
    above,
    outIn,
    conqueror: (id) => conqueror.get(id),
  }
}

// ---------------------------------------------------------------- ratings from the finish

// The fewest ratings of the user's own that make the scale on their own
export const SCALE_MIN = 10
// The scale with too few of them, and no Your score to stand in: one star
// to five, evenly
const EVEN_SCALE = [20, 100]

// Who a bracket's entrants are drawn from, for where they sit: every scene
// a scene bracket can draw from, or every performer of the bracket's gender
// in the library
function universeOf(M, kind, gender) {
  return kind === 'performer'
    ? performerPool(M, { gender, pool: 'library' })
    : bracketScenes(M).map((s) => s.id)
}

// The model's strength, or nothing for a record gone from the library
function safeStrength(M, kind) {
  const strength = strengthOf(M, kind)
  return (id) => {
    const there =
      kind === 'performer'
        ? !!M.db.performers.get(id)?.local
        : !!M.db.scenes.get(id)?.owned
    return there ? strength(id) : -Infinity
  }
}

/**
 * Where a bracket's entrants sit among everyone they are drawn from, as the
 * share of the library the model ranks below each (1: above everyone),
 * highest first. Entrants the model can't tell apart (a new library guesses
 * 3★ for every scene) share the places their tie fills evenly, so a bracket
 * from a library the model knows nothing about still spans it.
 * @param {object} M
 * @param {'performer'|'clip'} kind
 * @param {string|null} gender
 * @param {string[]} ids  the entrants
 * @returns {number[]}
 */
export function entrantSpread(M, kind, gender, ids) {
  const strength = safeStrength(M, kind)
  const all = universeOf(M, kind, gender)
    .map(strength)
    .sort((a, b) => b - a)
  const n = Math.max(all.length, 1)
  const EPS = 1e-9
  // how many of the library sit above v, and at or above it
  const countWhile = (ok) => {
    let lo = 0
    let hi = all.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ok(all[mid])) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const ties = new Map()
  for (const id of ids) {
    const v = strength(id)
    const start = countWhile((x) => x > v + EPS)
    const end = Math.max(
      countWhile((x) => x >= v - EPS),
      start + 1,
    )
    const key = start + ':' + end
    ties.set(key, [...(ties.get(key) || []), id])
  }
  const out = []
  for (const [key, list] of ties) {
    const [start, end] = key.split(':').map(Number)
    list.forEach((_, j) => {
      const place = start + ((j + 0.5) * (end - start)) / list.length
      out.push(
        Math.round(Math.min(1, Math.max(0, 1 - place / n)) * 1000) / 1000,
      )
    })
  }
  return out.sort((a, b) => b - a)
}

// The value at share q of values (lowest first), between neighbours
export function quantileOf(values, q) {
  if (!values.length) return null
  const p = Math.min(1, Math.max(0, q)) * (values.length - 1)
  const i = Math.floor(p)
  const next = values[Math.min(i + 1, values.length - 1)]
  return values[i] + (next - values[i]) * (p - i)
}

/**
 * The ratings a bracket's finishing order is laid over, lowest first, and
 * where they come from: the user's own ratings of the bracket's kind (for
 * performers, of its gender), once there are SCALE_MIN of them ('own');
 * else, for scenes, Your score across the library when it spreads over a
 * star or more ('score'); else one star to five, evenly ('even').
 * @returns {{ values: number[], source: 'own'|'score'|'even' }}
 */
export function ratingScale(M, kind, gender) {
  const ids = universeOf(M, kind, gender)
  const own = ids
    .filter((id) => entrantRole(M, kind, id) === 'anchor')
    .map((id) => stashRatingOf(M, kind, id))
    .sort((a, b) => a - b)
  if (own.length >= SCALE_MIN) return { values: own, source: 'own' }
  if (kind === 'clip' && ids.length >= SCALE_MIN) {
    const score = ids.map((id) => M.estimate(id) * 20).sort((a, b) => a - b)
    if (quantileOf(score, 0.9) - quantileOf(score, 0.1) >= 20)
      return { values: score, source: 'score' }
  }
  return { values: EVEN_SCALE, source: 'even' }
}

const SCALE_NAMES = {
  own: 'your ratings',
  score: 'Your score',
  even: 'a one to five star scale',
}

// "in the top 9% of your ratings", "in the bottom 3% of Your score"
const placeText = (q, source) => {
  const where =
    q >= 0.5
      ? `the top ${Math.max(1, Math.round((1 - q) * 100))}%`
      : `the bottom ${Math.max(1, Math.round(q * 100))}%`
  return `in ${where} of ${SCALE_NAMES[source]}`
}

// A finished bracket's entrants, best first: the champion, then the losers
// of each round from the final back; within a round, whoever lost to the
// one that went furthest first, then the model's stronger first
function finishOrder(M, b, st, tree) {
  const champ = st.result.champion
  const rounds = st.rounds.length
  const reach = (id) =>
    id == null ? -1 : id === champ ? rounds : (tree.outIn.get(id) ?? -1)
  const strength = safeStrength(M, b.kind)
  return b.seeds
    .slice()
    .sort(
      (x, y) =>
        reach(y) - reach(x) ||
        reach(tree.conqueror(y)) - reach(tree.conqueror(x)) ||
        strength(y) - strength(x) ||
        (x < y ? -1 : 1),
    )
}

/**
 * A rating a finished bracket proposes.
 * @typedef {object} RatingProposal
 * @property {string} id
 * @property {number|null} from  Stash's rating now
 * @property {number|null} to  the proposed rating100 (null on a skipped row)
 * @property {string} why  the anchors behind it, or its finish
 * @property {boolean} provisional  rated from its finish, not measured
 * @property {true} [fromProvisional]  its rating now is a provisional one
 * @property {number} short  rounds short of the title (0: the champion)
 * @property {number} place  its place in the finishing order (0: the champion)
 * @property {true} [primed]  its rating is Ascension's Prime
 * @property {'ranked'|'mirrored'} [skip]  another plugin owns its rating
 */

/**
 * @returns {{ rows: RatingProposal[], askChampion: boolean }} askChampion is
 *   always false now that the finish rates the champion; kept for the
 *   callers that offer the champion's stars by hand (b.championRating)
 */
export function ratingProposals(M, b) {
  const kind = b.kind
  const st = bracketState(b)
  if (!st.done) return { rows: [], askChampion: false }
  const tree = treeOrder(st)
  const { beaten, above, outIn } = tree
  const rounds = st.rounds.length
  const champ = st.result.champion
  const present = (id) =>
    kind === 'performer'
      ? !!M.db.performers.get(id)?.local
      : !!M.db.scenes.get(id)?.owned
  // The anchors as they were when the bracket started; a bracket from
  // before anchors takes the entrants the user has rated since
  const anchors =
    b.anchors ||
    Object.fromEntries(
      b.seeds
        .filter((id) => present(id) && entrantRole(M, kind, id) === 'anchor')
        .map((id) => [id, stashRatingOf(M, kind, id)]),
    )
  const isAnchor = (id) => has(anchors, id)
  // What measures: the bracket's anchors, and for the champion alone the
  // anchors of its Challenge round
  const cs = challengeState(b)
  const ref = { ...(b.challenge?.ratings || {}), ...anchors }
  const pickRef = (ids, better) => {
    let out = null
    for (const id of ids)
      if (has(ref, id) && (out == null || better(ref[id], ref[out]))) out = id
    return out
  }
  const lowOf = (id) =>
    pickRef(
      id === champ && cs ? [...beaten(id), ...cs.beaten] : beaten(id),
      (x, y) => x > y,
    )
  const highOf = (id) =>
    pickRef(
      id === champ && cs?.lostTo ? [...above(id), cs.lostTo] : above(id),
      (x, y) => x < y,
    )
  // Between two anchors, or half a star above the only one below
  const measured = (lo, hi) =>
    hi != null
      ? clampRating(quarterStars((ref[lo] + ref[hi]) / 2))
      : clampRating(ref[lo] + HALF)
  const name = (id) =>
    (kind === 'performer'
      ? M.db.performers.get(id)?.name
      : M.db.scenes.get(id)?.title) || 'Untitled'
  const fromScenes = new Set([
    ...(b.sceneAnchors || []),
    ...(b.challenge?.sceneRungs || []),
  ])
  const label = (id) =>
    `${name(id)} (${fmtStars(ref[id] / 20)}★${fromScenes.has(id) ? ' from your scene ratings' : ''})`
  const champLo = isAnchor(champ) ? null : lowOf(champ)
  // Each entrant's rating from where it finished: the finishing order laid
  // over the scale, place k taking the k-th highest share of the library
  // the entrants were drawn from
  const order = finishOrder(M, b, st, tree)
  const spread = b.spread?.length
    ? b.spread
    : entrantSpread(M, kind, b.gender, b.seeds)
  const scale = ratingScale(M, kind, b.gender)
  const place = new Map(order.map((id, k) => [id, k]))
  const shareOf = (id) => spread[Math.min(place.get(id), spread.length - 1)]
  const fromFinish = (id) => quantileOf(scale.values, shareOf(id))
  // The champion's rating: an anchor's own, measured by its Challenge
  // round, the user's stars, or from its finish, never above half a star
  // under a favorite that beat it. Everyone rated from the finish moves by
  // the difference, so the order holds.
  const champHi = highOf(champ)
  let top = fromFinish(champ)
  if (isAnchor(champ)) top = anchors[champ]
  else if (champLo != null) top = measured(champLo, champHi)
  else if (b.championRating != null) top = b.championRating
  else if (champHi != null) top = Math.min(top, ref[champHi] - HALF)
  const shift = top - fromFinish(champ)
  const rows = []
  for (const id of b.seeds) {
    if (isAnchor(id) || !present(id)) continue
    const role = entrantRole(M, kind, id)
    if (role === 'anchor') continue // rated by the user since
    const short = id === champ ? 0 : rounds - outIn.get(id)
    let to
    let why
    let provisional = false
    const lo = lowOf(id)
    const hi = highOf(id)
    if (lo != null) {
      to = measured(lo, hi)
      why =
        hi != null
          ? `Above ${label(lo)}, below ${label(hi)}`
          : `Above ${label(lo)}`
    } else if (id === champ && b.championRating != null) {
      to = b.championRating
      why = 'Your rating for the champion'
    } else {
      to = clampRating(quarterStars(fromFinish(id) + shift))
      why =
        id === champ && shift < 0
          ? `${finishLabel(0)}, below ${label(champHi)}`
          : `${finishLabel(short)}, ${placeText(shareOf(id), scale.source)}${shift ? ', moved with the champion' : ''}`
      if (hi != null && ref[hi] - HALF < to) {
        to = clampRating(ref[hi] - HALF)
        why = `${finishLabel(short)}, below ${label(hi)}`
      }
      provisional = true
    }
    const from = stashRatingOf(M, kind, id)
    const row = { id, from, to, why, provisional, short, place: place.get(id) }
    if (isProvisional(recordOf(M, kind, id)?.local, from))
      row.fromProvisional = true
    if (role === 'ranked') {
      if (short > 3) continue // listed only when placed
      row.skip = M.ratingSource(kind, id) === 'mirror' ? 'mirrored' : 'ranked'
      row.why = finishLabel(short)
    } else if (to == null) continue
    else if (M.ratingSource(kind, id) === 'primed') row.primed = true
    else if (from === to) continue // its rating already
    rows.push(row)
  }
  rows.sort((x, y) => x.place - y.place)
  return { rows, askChampion: false }
}

// The change Apply writes for a proposal row: its new rating, and the one
// the preview showed, which writableChanges checks is still there
export function proposedChange(row) {
  const { id, from, to, provisional } = row
  return { id, from, to, provisional, fromProvisional: !!row.fromProvisional }
}

// The changes Apply may still write, against the records as Stash has them
// right before the write (current: Map id -> { rating100, custom_fields }).
// Each change carries the rating the preview showed (from, read from the
// library copy) and whether it was provisional (fromProvisional). A record
// gone from Stash is left out, and one another plugin started ranking or
// mirroring since the preview is listed in `ranked`. A record whose rating
// is no longer the one the preview showed is listed in `changed`: the user
// rated it since, on Stash's own pages or in another tab, or another
// bracket's Apply did. So is a provisional one that lost its mark, which
// makes its rating the user's (isProvisional). Apply leaves both alone.
// Each change written keeps what it replaces, for Undo: the rating, and
// the provisional mark itself (fromProvisional).
export function writableChanges(changes, current) {
  const write = []
  const ranked = []
  const changed = []
  for (const c of changes) {
    const rec = current.get(c.id)
    if (!rec) continue
    if (pluginRating(rec)) ranked.push(c.id)
    else if (
      (rec.rating100 ?? null) !== c.from ||
      (c.fromProvisional && !isProvisional(rec))
    )
      changed.push(c.id)
    else
      write.push({
        ...c,
        fromProvisional: rec.custom_fields?.[PROVISIONAL_FIELD] ?? null,
      })
  }
  return { write, ranked, changed }
}

// The changes of an applied batch that Undo may still put back, against the
// records as Stash has them right before the write (as for writableChanges).
// A record gone from Stash is left out, and one another plugin started
// ranking or mirroring since is listed in `ranked`. A record whose rating is
// no longer the one the batch wrote is listed in `changed`: the user rated
// it by hand, or a later bracket rewrote a provisional one. So is a
// provisional one that lost its mark, which makes its rating the user's
// (isProvisional). Undo leaves both alone.
export function undoableChanges(changes, current) {
  const write = []
  const ranked = []
  const changed = []
  for (const c of changes) {
    const rec = current.get(c.id)
    if (!rec) continue
    if (pluginRating(rec)) ranked.push(c.id)
    else if (
      (rec.rating100 ?? null) !== c.to ||
      (c.provisional && !isProvisional(rec))
    )
      changed.push(c.id)
    else write.push(c)
  }
  return { write, ranked, changed }
}

// The custom_fields input a rating write sends: a provisional rating marks
// the record with the value written; a measured one clears an old mark.
// had: the mark the record carries now.
export function provisionalFieldsInput(to, provisional, had) {
  if (provisional && to != null) return { partial: { [PROVISIONAL_FIELD]: to } }
  if (had != null && had !== '') return { remove: [PROVISIONAL_FIELD] }
  return null
}

// The custom_fields input that puts an applied change's mark back on Undo:
// the mark it replaced, or none
export function restoreProvisionalInput(change) {
  const had = change.fromProvisional
  if (had != null && had !== '')
    return { partial: { [PROVISIONAL_FIELD]: had } }
  return change.provisional ? { remove: [PROVISIONAL_FIELD] } : null
}
