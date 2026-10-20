// An invented Stash library in buildDb's input shape, for the model's unit
// tests. A hidden taste (loved and disliked performers, a favoured studio,
// liked and disliked tags, plus per-scene noise) drives how scenes are rated
// and played, so the taste model has something coherent to learn and the
// tests can check what it recovered against the truth. Every random draw
// comes from one seeded PRNG in a fixed order, so the same options always
// give the same library. Every name is made up.

export const AS_OF = Date.parse('2026-10-15T12:00:00Z')
export const ENDPOINT = 'https://stashdb.org/graphql'
const DAY = 86400000
const HOST = 'http://localhost:9999'

const STUDIOS = [
  // [name, parent network]
  ['Studio Amber', 'Network North'],
  ['Studio Birch', 'Network North'],
  ['Studio Cedar', 'Network North'],
  ['Studio Dune', null],
  ['Studio Ember', 'Network South'],
  ['Studio Fern', 'Network South'],
  ['Studio Grove', null],
  ['Studio Harbor', null],
]
const TAGS = [
  'Beach',
  'Kitchen',
  'Outdoor',
  'Vintage',
  'Cosplay',
  'Dance',
  'Pool',
  'Garden',
  'Office',
  'Rooftop',
  'Sauna',
  'Candlelight',
  'Rain',
  'Picnic',
  'Road Trip',
  'Hotel',
  'Black and White',
  'Yoga',
  'Workout',
  'Masquerade',
  'Library',
  'Snow',
  'Vineyard',
  'Lakeside',
]
// tags the model must ignore: release descriptions and the user's placeholders
export const PLACEHOLDER_TAGS = [
  '4K Available',
  'Full HD Available',
  '_todo',
  '[unsorted]',
]

// The hidden taste, by name
const TASTE = {
  favouredStudio: 'Studio Amber',
  likedTags: ['Beach', 'Vintage', 'Dance'],
  dislikedTags: ['Kitchen', 'Cosplay'],
}
export const WEIGHTS = {
  lovedPerformer: 1.5,
  dislikedPerformer: -1.6,
  performerCap: 2.0, // total performer contribution is clamped to +/- this
  favouredStudio: 1.2,
  likedTag: 0.5,
  dislikedTag: -0.7,
  noiseSd: 0.6,
}
// Positions in the performers' popularity order (the most credited first)
const LOVED = [0, 2, 4]
const DISLIKED = [1, 6]
const EXTRA_FAVOURITE = 3 // a favourite in Stash that is not part of the taste

// Stash's six genders and none, by performer index: about 60% female
const genderAt = (i) => {
  const k = i % 20
  if (k < 12) return 'FEMALE'
  if (k < 16) return 'MALE'
  return ['TRANSGENDER_FEMALE', 'TRANSGENDER_MALE', 'NON_BINARY', null][k - 16]
}
// about one in seven performers has no photo (Stash's default silhouette)
const hasPhoto = (i) => i % 7 !== 5

// ---------------------------------------------------------------- seeded PRNG

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function rng(seed) {
  const rand = mulberry32(seed)
  const uniform = (a, b) => a + (b - a) * rand()
  const randInt = (a, b) => Math.floor(uniform(a, b + 1))
  const chance = (p) => rand() < p
  const normal = (mu = 0, sd = 1) => {
    const u = 1 - rand()
    const v = rand()
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  // index from cumulative weights
  const pickCum = (cum) => {
    const r = rand() * cum[cum.length - 1]
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] > r) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  return { rand, uniform, randInt, chance, normal, pickCum }
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const sigmoid = (x) => 1 / (1 + Math.exp(-x))
const iso = (ms) => new Date(Math.round(ms / 1000) * 1000).toISOString()
const day = (ms) => new Date(ms).toISOString().slice(0, 10)
const pad = (n, width) => String(n).padStart(width, '0')
const cumulative = (ws) => {
  let t = 0
  return ws.map((w) => (t += w))
}
// a time on a day: noon UTC give or take 90 minutes, so a play stays on its
// calendar day in any time zone within ten and a half hours of UTC
const onDay = (dayStart, r) =>
  dayStart + 12 * 3600000 + r.uniform(-1, 1) * 5400000

// ---------------------------------------------------------------- the library

/**
 * @param {object} [opts]
 * @param {number} [opts.scenes]  owned scenes (default 120)
 * @param {number} [opts.performers]  library performers (default 60, or a
 *   quarter of the scenes in big libraries)
 * @param {number} [opts.seed]
 * @param {number} [opts.asOf]
 */
export function syntheticLibrary(opts = {}) {
  const nScenes = opts.scenes ?? 120
  const nPerformers = opts.performers ?? Math.max(60, Math.round(nScenes / 4))
  const seed = opts.seed ?? 20261015
  const asOf = opts.asOf ?? AS_OF
  const r = rng(seed)
  const windowStart = asOf - 540 * DAY // plays reach back 18 months
  const libraryStart = asOf - 900 * DAY // the earliest addition

  // performers, most credited first
  const width = Math.max(2, String(nPerformers).length)
  const performers = Array.from({ length: nPerformers }, (_, i) => {
    const id = String(i + 1)
    return {
      id,
      name: `Performer ${pad(i + 1, width)}`,
      disambiguation: null,
      gender: genderAt(i),
      rating100: null,
      favorite: false,
      image_path: hasPhoto(i)
        ? `${HOST}/performer/${id}/image?t=1`
        : `${HOST}/performer/${id}/image?default=true`,
      scene_count: 0,
      stash_ids:
        i % 9 === 8 ? [] : [{ endpoint: ENDPOINT, stash_id: 'sdb-p' + id }],
      custom_fields: {},
    }
  })
  const performerCum = cumulative(performers.map((_, i) => 1 / (i + 4)))

  // studios and networks; bigger libraries get more studios
  const nStudios = Math.max(STUDIOS.length, Math.round(nScenes / 100))
  const studioList = Array.from({ length: nStudios }, (_, i) => {
    const [name, parent] = STUDIOS[i] || [`Studio ${pad(i + 1, 3)}`, null]
    return { id: String(i + 1), name, parent }
  })
  const networks = new Map()
  for (const st of studioList)
    if (st.parent && !networks.has(st.parent))
      networks.set(st.parent, String(nStudios + networks.size + 1))
  const studioRef = (st) => ({
    id: st.id,
    name: st.name,
    parent_studio: st.parent
      ? { id: networks.get(st.parent), name: st.parent }
      : null,
  })
  // the favoured studio gets a sixth of the library
  const studioCum = cumulative(
    studioList.map((st, i) =>
      st.name === TASTE.favouredStudio ? 0.16 * nStudios : 1 / (1 + i / 4),
    ),
  )

  // tags; bigger libraries get more
  const nTags = Math.max(TAGS.length, Math.round(nScenes / 250))
  const tagList = Array.from({ length: nTags }, (_, i) => ({
    id: String(i + 1),
    name: TAGS[i] || `Theme ${pad(i + 1, 3)}`,
  }))
  const placeholderTags = PLACEHOLDER_TAGS.map((name, i) => ({
    id: String(nTags + i + 1),
    name,
  }))
  const tagCum = cumulative(tagList.map((_, i) => 1 / (1 + i / 8)))

  const byName = (list, name) => list.find((x) => x.name === name)
  const taste = {
    lovedPerformerIds: LOVED.map((i) => performers[i].id),
    dislikedPerformerIds: DISLIKED.map((i) => performers[i].id),
    extraFavouriteId: performers[EXTRA_FAVOURITE].id,
    favouredStudioId: byName(studioList, TASTE.favouredStudio).id,
    likedTagIds: TASTE.likedTags.map((n) => byName(tagList, n).id),
    dislikedTagIds: TASTE.dislikedTags.map((n) => byName(tagList, n).id),
    weights: WEIGHTS,
    affinityBySceneId: new Map(),
  }
  const loved = new Set(taste.lovedPerformerIds)
  const disliked = new Set(taste.dislikedPerformerIds)
  const liked = new Set(taste.likedTagIds)
  const hated = new Set(taste.dislikedTagIds)

  // 1. scenes and the affinity the taste gives each (the ground truth)
  const sceneWidth = Math.max(3, String(nScenes).length)
  const scenes = []
  for (let i = 0; i < nScenes; i++) {
    const id = String(i + 1)
    const cast = [1, 2, 2, 2, 2, 3, 3, 2, 1, 6][r.randInt(0, 9)]
    const credits = new Set()
    for (let k = 0; k < 20 && credits.size < cast; k++)
      credits.add(performers[r.pickCum(performerCum)])
    const st = studioList[r.pickCum(studioCum)]
    const nT = r.randInt(2, 6)
    const sceneTags = new Set()
    for (let k = 0; k < 30 && sceneTags.size < nT; k++)
      sceneTags.add(tagList[r.pickCum(tagCum)])
    if (r.chance(0.12)) sceneTags.add(placeholderTags[r.randInt(0, 3)])
    const release = asOf - r.uniform(60, 4000) * DAY

    let perf = 0
    for (const p of credits) {
      if (loved.has(p.id)) perf += WEIGHTS.lovedPerformer
      if (disliked.has(p.id)) perf += WEIGHTS.dislikedPerformer
    }
    let a = clamp(perf, -WEIGHTS.performerCap, WEIGHTS.performerCap)
    if (st.id === taste.favouredStudioId) a += WEIGHTS.favouredStudio
    for (const t of sceneTags) {
      if (liked.has(t.id)) a += WEIGHTS.likedTag
      if (hated.has(t.id)) a += WEIGHTS.dislikedTag
    }
    a += r.normal(0, WEIGHTS.noiseSd)
    taste.affinityBySceneId.set(id, a)

    scenes.push({
      id,
      title: `Scene ${pad(i + 1, sceneWidth)}`,
      date: day(release),
      created_at: null,
      rating100: null,
      files: [{ duration: r.randInt(900, 3600) }],
      play_count: 0,
      play_duration: 0,
      play_history: [],
      o_counter: 0,
      studio: studioRef(st),
      performers: [...credits].map((p) => ({
        id: p.id,
        name: p.name,
        gender: p.gender,
        favorite: false,
        image_path: p.image_path,
      })),
      tags: [...sceneTags].map((t) => ({ id: t.id, name: t.name })),
      stash_ids: r.chance(0.8)
        ? [{ endpoint: ENDPOINT, stash_id: 'sdb-s' + id }]
        : [],
      paths: { screenshot: `${HOST}/scene/${id}/screenshot` },
      _release: release,
    })
  }
  const aff = (s) => taste.affinityBySceneId.get(s.id)

  // 2. never played, rated, or played but unrated
  const nNever = Math.round(0.15 * nScenes)
  const nRated = Math.round(0.6 * nScenes)
  const neverOrder = scenes
    .map((s) => ({ s, k: -0.5 * aff(s) + r.normal(0, 1) }))
    .sort((x, y) => y.k - x.k)
  const never = new Set(neverOrder.slice(0, nNever).map((x) => x.s.id))
  const played = scenes.filter((s) => !never.has(s.id))
  // strong feelings either way get rated more often
  const rateOrder = played
    .map((s) => ({ s, k: 0.7 * Math.abs(aff(s)) + r.normal(0, 0.8) }))
    .sort((x, y) => y.k - x.k)
  const rated = new Set(rateOrder.slice(0, nRated).map((x) => x.s.id))

  // 3. ratings: inflated, mostly whole stars, by affinity quantile
  const BANDS = [
    [0.35, 100],
    [0.7, 80],
    [0.84, 60],
    [0.94, 40],
    [1.0, 20],
  ]
  const ratedList = played
    .filter((s) => rated.has(s.id))
    .map((s) => ({ s, k: aff(s) + r.normal(0, 0.35) }))
    .sort((x, y) => y.k - x.k)
  ratedList.forEach((x, i) => {
    const q = (i + 0.5) / ratedList.length
    let rating = BANDS.find(([cut]) => q <= cut)[1]
    // about 15% half stars
    if (r.chance(0.15)) rating = rating === 100 ? 90 : rating + 10
    x.s.rating100 = rating
  })

  // 4. when each scene was added, and how it was played
  for (const s of scenes) {
    const a = aff(s)
    const dur = s.files[0].duration
    const isNever = never.has(s.id)
    const addFrom = Math.max(s._release + r.randInt(1, 30) * DAY, libraryStart)
    let created
    if (isNever && r.chance(0.5))
      // added lately and not watched yet
      created = r.uniform(Math.max(addFrom, asOf - 60 * DAY), asOf - DAY)
    else created = r.uniform(Math.min(addFrom, asOf - 4 * DAY), asOf - 3 * DAY)
    s.created_at = iso(created)
    delete s._release
    if (isNever) continue

    const z = a + r.normal(0, 0.4) // engagement
    const count = clamp(
      Math.round(1 + Math.max(0, 1.7 * z + 1.2) + r.normal(0, 0.8)),
      1,
      10,
    )
    // the first play soon after adding (sooner for loved scenes)
    const firstFrom = Math.max(created + 2 * 3600000, windowStart)
    const gap = -Math.log(1 - r.rand()) * (z > 1 ? 4 : 20) * DAY
    const firstDay = Math.floor(
      Math.max(firstFrom, Math.min(firstFrom + gap, asOf - 2 * DAY)) / DAY,
    )
    const lastDay = Math.floor((asOf - DAY) / DAY)
    // rewatches on other days, up to yesterday
    const days = new Set([firstDay])
    for (let k = 1; k < count && lastDay > firstDay; k++)
      days.add(r.randInt(firstDay + 1, lastDay))
    const starts = [...days]
      .sort((x, y) => x - y)
      .map((d) => Math.max(created + 3600000, onDay(d * DAY, r)))
    // loved scenes are watched through; disliked ones abandoned early
    const fracs = starts.map((_, i) => {
      let f
      if (i === 0)
        f = clamp(
          0.08 + 0.92 * sigmoid(1.8 * z + 0.6) + r.normal(0, 0.08),
          0.05,
          1,
        )
      else if (r.chance(z > 0.8 ? 0.5 : 0.25)) f = 1
      else f = clamp(r.normal(z > 0.8 ? 0.7 : 0.5, 0.18), 0.15, 1)
      return f > 0.93 ? 1 : f
    })
    const oProb = 0.8 * sigmoid(2.0 * z - 1.2)
    s.play_count = starts.length
    s.play_history = starts.map(iso)
    s.play_duration =
      Math.round(fracs.reduce((t, f) => t + f * dur, 0) * 10) / 10
    s.o_counter = fracs.filter((f) =>
      r.chance(oProb * (f >= 0.5 ? 1 : 0.3)),
    ).length
  }

  // 5. performers' own fields: rating, favourite, scene count
  const pr = rng(seed + 1)
  const count = new Map()
  for (const s of scenes)
    for (const p of s.performers) count.set(p.id, (count.get(p.id) || 0) + 1)
  taste.performerAppeal = new Map()
  performers.forEach((p, i) => {
    const a = loved.has(p.id)
      ? WEIGHTS.lovedPerformer
      : disliked.has(p.id)
        ? WEIGHTS.dislikedPerformer
        : pr.normal(0, 0.55)
    taste.performerAppeal.set(p.id, a)
    p.scene_count = count.get(p.id) || 0
    if (pr.chance(clamp(0.35 + 0.25 * Math.abs(a), 0, 0.9)))
      p.rating100 = clamp(
        Math.round((3.5 + 0.9 * a + pr.normal(0, 0.35)) * 2) * 10,
        20,
        100,
      )
    p.favorite =
      loved.has(p.id) || i === EXTRA_FAVOURITE || (a > 0.9 && pr.chance(0.5))
  })
  const fav = new Map(performers.map((p) => [p.id, p.favorite]))
  for (const s of scenes)
    for (const c of s.performers) c.favorite = fav.get(c.id)

  return { input: { asOf, scenes, performers }, taste }
}

/**
 * The library as Advanced Rating and Binge leave it: score tags matching the
 * rating on every rated scene (Binge's stars write the same ones) and Binge's
 * Watch Later on every third unrated one.
 * @param {ReturnType<typeof syntheticLibrary>['input']} input
 */
export function withBookkeepingTags(input) {
  const scenes = input.scenes.map((s, i) => {
    const extra = []
    if (s.rating100 != null) {
      const n = Math.round(s.rating100 / 20)
      extra.push(
        { id: 'ar-pq-' + n, name: `Production Quality ★: ${n}` },
        { id: 'ar-ch-' + n, name: `Chemistry ★: ${n}` },
      )
    } else if (i % 3 === 0) extra.push({ id: 'bg-wl', name: 'Watch Later 📁' })
    return { ...s, tags: [...s.tags, ...extra] }
  })
  return { ...input, scenes }
}

// ---------------------------------------------------------------- StashDB

/**
 * What the StashDB layer would fetch for a synthetic library: StashDB's copy
 * of some owned scenes (popularity only), scenes the user doesn't have with
 * library performers and some StashDB-only ones, and popularity orders.
 * @param {ReturnType<typeof syntheticLibrary>['input']} input
 */
export function syntheticStashdb(input, { missing = 40, seed = 7 } = {}) {
  const r = rng(seed)
  const withSdb = input.performers.filter((p) => p.stash_ids.length)
  const byId = new Map(input.performers.map((p) => [p.id, p]))
  const perfCum = cumulative(withSdb.map((_, i) => 1 / (i + 4)))
  const studios = new Map()
  for (const s of input.scenes)
    if (s.studio) studios.set(s.studio.name, s.studio)
  const studioNames = [...studios.keys()]
  const tagNames = [
    ...new Set(input.scenes.flatMap((s) => s.tags.map((t) => t.name))),
  ]
  const sdbStudio = (name) => {
    const lib = studios.get(name)
    return {
      id: 'sdb-st-' + name.toLowerCase().replace(/\W+/g, '-'),
      name,
      parent: lib?.parent_studio
        ? {
            id:
              'sdb-st-' +
              lib.parent_studio.name.toLowerCase().replace(/\W+/g, '-'),
            name: lib.parent_studio.name,
          }
        : null,
    }
  }
  const sdbTag = (name) => ({
    id: 'sdb-t-' + name.toLowerCase().replace(/\W+/g, '-'),
    name,
  })
  const guests = Array.from({ length: 5 }, (_, i) => ({
    id: 'sdb-guest-' + (i + 1),
    name: `Guest ${pad(i + 1, 2)}`,
    gender: i % 2 ? 'MALE' : 'FEMALE',
  }))

  const scenes = []
  // StashDB's copy of owned scenes: its own ids, names and credits, plus popularity
  for (const s of input.scenes) {
    const sid = s.stash_ids[0]?.stash_id
    if (!sid || !r.chance(0.5)) continue
    scenes.push({
      id: sid,
      title: s.title,
      date: s.date,
      duration: s.files[0].duration,
      studio: s.studio ? sdbStudio(s.studio.name) : null,
      performers: s.performers
        .map((c) => byId.get(c.id))
        .filter((p) => p.stash_ids.length)
        .map((p) => ({
          id: p.stash_ids[0].stash_id,
          name: p.name,
          gender: p.gender,
        })),
      tags: s.tags.map((t) => sdbTag(t.name)),
      heldBy: r.randInt(40, 4000),
      globalPopularityRank: r.chance(0.1) ? r.randInt(1, 40) : null,
    })
  }
  // scenes the user doesn't have
  for (let i = 0; i < missing; i++) {
    const cast = new Set()
    const n = r.randInt(1, 3)
    for (let k = 0; k < 10 && cast.size < n; k++) {
      if (r.chance(0.15)) cast.add(guests[r.randInt(0, guests.length - 1)])
      else {
        const p = withSdb[r.pickCum(perfCum)]
        cast.add({
          id: p.stash_ids[0].stash_id,
          name: p.name,
          gender: p.gender,
        })
      }
    }
    const studioName = r.chance(0.1)
      ? 'Studio Quartz'
      : studioNames[r.randInt(0, studioNames.length - 1)]
    const tags = new Set()
    const nT = r.randInt(2, 5)
    for (let k = 0; k < 20 && tags.size < nT; k++)
      tags.add(
        r.chance(0.1) ? 'Sunset' : tagNames[r.randInt(0, tagNames.length - 1)],
      )
    scenes.push({
      id: 'sdb-m' + (i + 1),
      title: `Missing ${pad(i + 1, 3)}`,
      date: '2026-0' + r.randInt(1, 9) + '-1' + r.randInt(0, 9),
      duration: r.randInt(900, 3600),
      studio: sdbStudio(studioName),
      performers: [...cast],
      tags: [...tags].map(sdbTag),
      heldBy: r.randInt(20, 3000),
      globalPopularityRank: r.chance(0.2) ? r.randInt(1, 40) : null,
    })
  }

  // popularity orders: each performer's and studio's scenes on StashDB
  const order = (ids) =>
    ids
      .map((id) => ({ id, k: r.rand() }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.id)
  const performers = withSdb.slice(0, 12).map((p) => {
    const sid = p.stash_ids[0].stash_id
    const ids = order(
      scenes
        .filter((s) => s.performers.some((c) => c.id === sid))
        .map((s) => s.id),
    )
    return {
      id: sid,
      name: p.name,
      gender: p.gender,
      sceneCount: ids.length + r.randInt(10, 300),
      popularSceneIds: ids,
    }
  })
  performers.push({
    id: guests[0].id,
    name: guests[0].name,
    gender: guests[0].gender,
    image: `${HOST}/stashdb/guest-1.jpg`,
    sceneCount: 50,
    popularSceneIds: order(
      scenes
        .filter((s) => s.performers.some((c) => c.id === guests[0].id))
        .map((s) => s.id),
    ),
  })
  const studiosOut = [
    ...new Set(scenes.map((s) => s.studio?.name).filter(Boolean)),
  ].map((name) => ({
    ...sdbStudio(name),
    popularSceneIds: order(
      scenes.filter((s) => s.studio?.name === name).map((s) => s.id),
    ),
  }))
  return {
    endpoint: ENDPOINT,
    totalScenes: 1000000,
    scenes,
    performers,
    studios: studiosOut,
  }
}

// ---------------------------------------------------------------- edits for tests

// A copy of the input with every play in the last `days` days removed and
// these plays added ({ sceneId, at: ms, share }), each watched all the way
// through unless `share` gives the part of the scene played
export function withRecentPlays(input, plays, days = 14) {
  const cut = input.asOf - days * DAY
  const out = structuredClone(input)
  for (const s of out.scenes) {
    const keep = s.play_history.filter((t) => Date.parse(t) < cut)
    const dropped = s.play_history.length - keep.length
    if (dropped) {
      s.play_duration = Math.max(
        0,
        s.play_duration * (keep.length / s.play_history.length),
      )
      s.play_history = keep
      s.play_count = keep.length
    }
  }
  const byId = new Map(out.scenes.map((s) => [s.id, s]))
  for (const p of plays) {
    const s = byId.get(p.sceneId)
    s.play_history = [...s.play_history, iso(p.at)].sort()
    s.play_count++
    s.play_duration += (p.share ?? 1) * s.files[0].duration
  }
  return out
}

// A copy of the input as someone who rarely rates and mostly watches outside
// Stash's player would have it: `rated` scene ratings and `played` played
// scenes kept (the first in id order that were played), every other rating
// and play removed. favorites: false clears them, an array of performer ids
// makes those the only ones; performerRatings: false clears those.
export function withFewRatings(
  input,
  { rated = 1, played = 14, favorites = true, performerRatings = true } = {},
) {
  const out = structuredClone(input)
  let keptRated = 0
  let keptPlayed = 0
  for (const s of out.scenes) {
    const wasPlayed = s.play_count > 0
    if (s.rating100 != null && wasPlayed && keptRated < rated) keptRated++
    else s.rating100 = null
    if (wasPlayed && keptPlayed < played) keptPlayed++
    else
      Object.assign(s, {
        play_count: 0,
        play_duration: 0,
        play_history: [],
        o_counter: 0,
      })
  }
  for (const p of out.performers) {
    if (Array.isArray(favorites)) p.favorite = favorites.includes(p.id)
    else if (!favorites) p.favorite = false
    if (!performerRatings) p.rating100 = null
  }
  const fav = new Map(out.performers.map((p) => [p.id, p.favorite]))
  for (const s of out.scenes)
    for (const c of s.performers) c.favorite = fav.get(c.id)
  return out
}
