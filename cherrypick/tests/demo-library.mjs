// Cherry Pick's demo library: 90 invented scenes, 41 performers, 6 studios
// and 15 tags, rated and played along a hidden taste (TASTE), so the model
// has something real to learn in the compatibility tests. The shared demo
// library (tests/stash/prepare.mjs) is too small for that, and the themes'
// screenshots depend on it, so this adds its own records next to it and
// removes every one of them afterwards. It never changes a shared clip,
// performer, studio or tag.
//
// Every record it creates carries MARK in its details (tags: description),
// so removeDemoLibrary finds them even after a crashed run, and seeding
// removes an earlier seed first.
//
// Scenes have no files. Plays, O history and watch time go through Stash's
// own mutations (sceneAddPlay, sceneAddO, sceneSaveActivity) at chosen
// times. No mutation sets created_at or updated_at, so every demo record is
// created "now".
//
// None of it links to the mock stash-box: its catalogue (stashbox-data.mjs)
// holds the shared library's names, not these. The StashDB layer adds its
// own entries when it needs them.
//
// A sparse variant (SPARSE, `seed sparse`) has the same records with one
// rated scene and a dozen played, for how Cherry Pick starts in a library
// that gives the model almost nothing.
//
// Usage: node plugins/cherrypick/tests/demo-library.mjs seed [sparse]|remove
// Env: STASH_URL (default http://127.0.0.1:9999)
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const MARK = 'Invented for the Cherry Pick demo library.'

// What the invented viewer likes. It drives ratings, play counts, watch time
// and O history; the specs check what Cherry Pick learns against it.
// `momentum` performers were watched a lot in the last two weeks.
export const TASTE = {
  loved: ['Bea Lark', 'Juno Marsh', 'Cal Reed'],
  disliked: ['Edie Flint', 'Sadie Clove', 'Kai Shale'],
  momentum: ['Juno Marsh', 'Mira Cobb', 'Hugo Fell'],
  studio: 'Birchwood',
  likedTags: ['Rooftop', 'Rain', 'Neon', 'Dance'],
  dislikedTags: ['Cosplay', 'Picnic', 'Snow'],
}

// Name, gender (null for none), photo, favourite, rating100.
const PERFORMERS = [
  ['Ada Moss', 'FEMALE', true, true, 60],
  ['Bea Lark', 'FEMALE', true, true, 100],
  ['Cleo Finch', 'FEMALE', true, false, null],
  ['Dot Fern', 'FEMALE', true, false, null],
  ['Edie Flint', 'FEMALE', true, false, 20],
  ['Fay Wren', 'FEMALE', true, false, null],
  ['Gwen Alder', 'FEMALE', true, false, null],
  ['Hana Ridge', 'FEMALE', true, false, 70],
  ['Iris Pike', 'FEMALE', true, false, null],
  ['Juno Marsh', 'FEMALE', true, false, 90],
  ['Kira Holm', 'FEMALE', true, false, null],
  ['Lena Brook', 'FEMALE', true, false, 80],
  ['Mira Cobb', 'FEMALE', true, false, null],
  ['Nell Thatch', 'FEMALE', true, false, null],
  ['Opal Birch', 'FEMALE', true, true, 70],
  ['Pia Hedge', 'FEMALE', true, false, null],
  ['Rhea Teal', 'FEMALE', true, false, null],
  ['Sadie Clove', 'FEMALE', true, false, 30],
  ['Tess Rowan', 'FEMALE', true, false, null],
  ['Uma Sedge', 'FEMALE', true, false, null],
  ['Vera Gorse', 'FEMALE', true, false, null],
  ['Willa Tarn', 'FEMALE', false, false, null],
  ['Yara Loam', 'FEMALE', true, false, null],
  ['Zoe Fallow', 'FEMALE', true, false, null],
  ['Cal Reed', 'MALE', true, true, 90],
  ['Ben Larch', 'MALE', true, false, null],
  ['Finn Cairn', 'MALE', true, false, null],
  ['Hugo Fell', 'MALE', true, false, 60],
  ['Ivo Heron', 'MALE', true, true, null],
  ['Jude Quarry', 'MALE', true, false, null],
  ['Milo Sparrow', 'MALE', true, false, null],
  ['Otto Glen', 'MALE', false, false, null],
  ['Lou Briar', 'TRANSGENDER_FEMALE', true, false, null],
  ['Ray Furrow', 'TRANSGENDER_MALE', false, false, null],
  ['Quinn Sorrel', 'NON_BINARY', true, true, null],
  ['Rory Ash', null, true, false, 50],
  ['Pat Hollow', null, true, false, null],
  ['Lee Dale', null, true, false, null],
  ['Robin Coombe', null, true, false, null],
  ['Kai Shale', null, true, false, null],
  ['Jo Peat', null, false, false, null],
]

// In no scene, so a photo and a gender alone do not put her in a bracket.
const UNCAST = ['Zoe Fallow']

// Name, parent, number of scenes. Five more scenes have no studio.
const STUDIOS = [
  ['Orchard Group', null, 5],
  ['Amberline', 'Orchard Group', 16],
  ['Birchwood', 'Orchard Group', 18],
  ['Copperleaf', 'Orchard Group', 16],
  ['Driftwood', null, 15],
  ['Elmstead', null, 15],
]

// Tag, and the noun a scene whose first tag it is takes in its title.
const TAGS = [
  ['Beach', 'Beach'],
  ['Kitchen', 'Kitchen'],
  ['Outdoor', 'Trail'],
  ['Vintage', 'Diner'],
  ['Cosplay', 'Convention'],
  ['Dance', 'Ballroom'],
  ['Rooftop', 'Rooftop'],
  ['Rain', 'Street'],
  ['Garden', 'Garden'],
  ['Picnic', 'Picnic'],
  ['Snow', 'Cabin'],
  ['Neon', 'Arcade'],
  ['Library', 'Library'],
  ['Road Trip', 'Highway'],
  ['Lakeside', 'Lake'],
]

const ADJECTIVES = [
  'Sunset',
  'Rainy',
  'Golden',
  'Quiet',
  'Windy',
  'Misty',
  'Bright',
  'Lazy',
  'Late',
  'Early',
  'Silver',
  'Sunday',
  'Autumn',
  'Winter',
  'Summer',
  'Little',
]

const SCENES = 90
const NEVER_PLAYED = 15
const RATED_UNPLAYED = 2
const RATED_PLAYED = 52
const SPARSE_RATED = 1
const SPARSE_PLAYED = 12
const DAY = 24 * 60

// mulberry32: the same plan on every machine and every run.
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The whole library as data: names, casts, ratings, and plays and O events
// as minutes before the anchor (the start of the UTC day the seed runs).
function plan({ sparse = false } = {}) {
  const r = random(43)
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
  const pick = (list) => list[Math.floor(r() * list.length)]
  const shuffle = (list) => {
    const out = [...list]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const sample = (list, n) => shuffle(list).slice(0, n)
  const count = (list, names) => list.filter((x) => names.includes(x)).length
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
  const noise = (spread) => (r() + r() + r() - 1.5) * spread

  const performers = PERFORMERS.map(
    ([name, gender, photo, favorite, rating100]) => ({
      name,
      gender,
      photo,
      favorite,
      rating100,
      // A small hidden lean on the performers TASTE leaves out.
      bias:
        TASTE.loved.includes(name) || TASTE.disliked.includes(name)
          ? 0
          : int(-5, 5),
    }),
  )
  const studios = STUDIOS.map(([name, parent]) => ({ name, parent }))
  const tags = TAGS.map(([name]) => ({ name }))

  const studioOf = shuffle([
    ...STUDIOS.flatMap(([name, , n]) => Array(n).fill(name)),
    ...Array(SCENES - STUDIOS.reduce((n, s) => n + s[2], 0)).fill(null),
  ])
  const titles = new Set()
  const scenes = studioOf.map((studio, i) => {
    const [first, noun] = pick(TAGS)
    const others = sample(
      TAGS.map(([name]) => name).filter((name) => name !== first),
      pick([0, 1, 1, 2, 2, 3]),
    )
    let a = int(0, ADJECTIVES.length - 1)
    while (titles.has(`${ADJECTIVES[a]} ${noun}`))
      a = (a + 1) % ADJECTIVES.length
    const title = `${ADJECTIVES[a]} ${noun}`
    titles.add(title)
    return {
      title,
      date: `${int(2019, 2025)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
      studio,
      performers: [],
      tags: [first, ...others],
      organized: r() < 0.3,
      cover: i,
    }
  })

  // Casts: loved performers in six scenes, momentum ones in five, disliked
  // ones in four, the rest in two to four. Three scenes have no performers.
  const appearances = performers.flatMap(({ name }) => {
    if (UNCAST.includes(name)) return []
    const n = TASTE.loved.includes(name)
      ? 6
      : TASTE.momentum.includes(name)
        ? 5
        : TASTE.disliked.includes(name)
          ? 4
          : int(2, 4)
    return Array(n).fill(name)
  })
  const castless = new Set(sample(scenes, 3))
  const castable = scenes.filter((s) => !castless.has(s))
  for (const name of shuffle(appearances)) {
    const open = castable.filter(
      (s) => s.performers.length < 3 && !s.performers.includes(name),
    )
    const empty = open.filter((s) => !s.performers.length)
    pick(empty.length > open.length / 3 ? empty : open).performers.push(name)
  }
  for (const s of castable)
    if (!s.performers.length) s.performers.push(pick(appearances))

  const bias = Object.fromEntries(performers.map((p) => [p.name, p.bias]))
  for (const s of scenes) {
    s.affinity = Math.round(
      48 +
        26 * count(s.performers, TASTE.loved) -
        26 * count(s.performers, TASTE.disliked) +
        (s.studio === TASTE.studio ? 14 : 0) +
        9 * count(s.tags, TASTE.likedTags) -
        11 * count(s.tags, TASTE.dislikedTags) +
        s.performers.reduce((n, p) => n + bias[p], 0),
    )
  }

  // Who watched what: 15 scenes never played (two of them rated anyway), 52
  // played and rated, the rest played and left unrated. Momentum
  // performers' scenes are all played.
  const momentum = (s) => s.performers.some((p) => TASTE.momentum.includes(p))
  const unplayed = sample(
    scenes.filter((s) => !momentum(s)),
    NEVER_PLAYED,
  )
  const played = shuffle(scenes.filter((s) => !unplayed.includes(s)))
  const rated = new Set([
    ...unplayed.slice(0, RATED_UNPLAYED),
    ...played.slice(0, RATED_PLAYED),
  ])
  // An evening play `day` days before the anchor.
  const at = (day) => day * DAY - int(17 * 60, 23 * 60 - 1)
  // Ratings spread the affinity a little wider, with some noise.
  for (const s of scenes) {
    const rating = 50 + (s.affinity - 50) * 1.3 + noise(24)
    s.rating100 = rated.has(s)
      ? clamp(Math.round(rating / 10) * 10, 10, 100)
      : null
    s.plays = []
    s.os = []
    s.duration = null
    s.resume = null
  }
  for (const s of played) {
    // Plays on distinct days between two weeks and a year ago, more for
    // scenes the taste favours.
    const n = clamp(Math.round(1 + (s.affinity - 45) / 15 + r() - 0.5), 1, 7)
    const days = sample(
      Array.from({ length: 351 }, (_, d) => d + 15),
      n,
    )
    s.plays = days.map(at)
  }
  // The last two weeks: momentum performers' scenes again and again, and a
  // few stray plays elsewhere.
  for (const s of played.filter(momentum)) {
    const days = sample(
      Array.from({ length: 12 }, (_, d) => d + 1),
      int(2, 3),
    )
    s.plays.push(...days.map(at))
  }
  for (const s of sample(
    played.filter((s) => !momentum(s)),
    4,
  ))
    s.plays.push(at(int(1, 14)))
  for (const s of played) {
    s.plays.sort((a, b) => b - a)
    const watch = () =>
      s.affinity >= 70
        ? int(720, 1500)
        : s.affinity >= 45
          ? int(360, 900)
          : int(60, 300)
    const watched = s.plays.map(watch)
    s.duration = watched.reduce((n, x) => n + x, 0)
    // Disliked scenes stop early; a few others were left halfway.
    s.resume =
      s.affinity < 45 ? watched.at(-1) : r() < 0.2 ? int(60, 600) : null
    const os = s.affinity >= 90 ? int(1, 3) : s.affinity >= 72 ? int(0, 2) : 0
    s.os = sample(s.plays, Math.min(os, s.plays.length))
      .map((ago) => ago - 15)
      .sort((a, b) => b - a)
  }
  // Sparse: the same names, casts, studios, tags and favourites, as someone
  // who rarely rates and mostly watches outside Stash's player would have
  // them. One scene rated, a dozen played, no performer ratings. Every
  // random draw above still happens, so the two plans share their names.
  if (sparse) {
    const kept = new Set(played.slice(0, SPARSE_PLAYED))
    const rate = new Set(played.slice(0, SPARSE_RATED))
    for (const s of scenes) {
      if (!rate.has(s)) s.rating100 = null
      if (kept.has(s)) continue
      Object.assign(s, { plays: [], os: [], duration: null, resume: null })
    }
    for (const p of performers) p.rating100 = null
  }
  return { performers, studios, tags, scenes }
}

// The plan, for specs to assert against. Each scene carries its affinity
// (the taste's score before noise), its rating and its plays and O events in
// minutes before the anchor seedDemoLibrary returns.
export const DEMO = plan()
export const SPARSE = plan({ sparse: true })

const run = promisify(execFile)

async function ffmpeg(args) {
  try {
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args])
  } catch (error) {
    throw new Error(
      `ffmpeg could not draw the demo images: ${error.stderr || error.message}`,
      { cause: error },
    )
  }
}

// Covers: ffmpeg's test patterns, as the shared clips (tests/stash/media.sh),
// each in nine hues.
const PATTERNS = [
  'testsrc2',
  'smptebars',
  'rgbtestsrc',
  'colorspectrum',
  'mandelbrot',
  'pal100bars',
  'yuvtestsrc',
  'smptehdbars',
  'testsrc',
  'pal75bars',
]

// Photos: a head-and-shoulders silhouette on one of four gradients, the
// frame number N picking the gradient and the hue filter turning each frame
// by the golden angle, so no two performers look alike.
const GRADIENT = `if(eq(mod(N,4),0),Y/H,if(eq(mod(N,4),1),(X+Y)/(W+H),if(eq(mod(N,4),2),min(1,hypot(X-W/2,Y-H*0.38)/(H*0.6)),0.6*Y/H+0.2*(1+sin((X-Y)/9)))))`
const SILHOUETTE = `gt(lt(hypot(X-W/2,Y-H*0.38),W*0.2)+lt(pow((X-W/2)/(W*0.44),2)+pow((Y-H*1.02)/(H*0.48),2),1),0)`
const channel = (dark, from, to) =>
  `'if(${SILHOUETTE},${dark},${from}-${from - to}*${GRADIENT})'`

// Draws the photos (200x300) and covers (320x180) into a temporary folder
// and returns them as data URLs. ffmpeg is already a requirement of the test
// harness, and 130 images drawn in about a second keep image files out of
// the repo.
async function drawImages(photos, covers) {
  const dir = await mkdtemp(join(tmpdir(), 'cherrypick-demo-'))
  const dataUrl = async (file) =>
    `data:image/jpeg;base64,${(await readFile(join(dir, file))).toString('base64')}`
  try {
    await ffmpeg([
      ...['-f', 'lavfi', '-i', 'color=c=black:s=200x300:r=1'],
      '-vf',
      `format=rgb24,geq=r=${channel(70, 250, 196)}:g=${channel(42, 196, 72)}:b=${channel(66, 150, 104)},hue=h=n*137.508`,
      ...['-frames:v', String(photos), '-q:v', '4'],
      ...['-start_number', '0', join(dir, 'photo-%d.jpg')],
    ])
    const frames = Math.ceil(covers / PATTERNS.length)
    await Promise.all(
      PATTERNS.map((pattern, i) =>
        ffmpeg([
          ...['-f', 'lavfi', '-i', `${pattern}=size=320x180:rate=1`],
          ...['-vf', `hue=h=n*40+${i * 17}`],
          ...['-frames:v', String(frames), '-q:v', '4'],
          ...['-start_number', '0', join(dir, `cover-${i}-%d.jpg`)],
        ]),
      ),
    )
    return {
      photos: await Promise.all(
        Array.from({ length: photos }, (_, i) => dataUrl(`photo-${i}.jpg`)),
      ),
      covers: await Promise.all(
        Array.from({ length: covers }, (_, i) =>
          dataUrl(
            `cover-${i % PATTERNS.length}-${Math.floor(i / PATTERNS.length)}.jpg`,
          ),
        ),
      ),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Stash's INCLUDES matches any of the words, which the shared clips' details
// share, so the query asks for the exact text and each record is checked
// again before anything is destroyed.
const like = { value: MARK, modifier: 'EQUALS' }
const marked = (record) => (record.details ?? record.description) === MARK

// The demo records in Stash, found by MARK, with their ids by name (scenes
// by title).
export async function demoLibraryIds(gql) {
  const { findScenes, findPerformers, findStudios, findTags } = await gql(
    `query ($like: StringCriterionInput) {
      findScenes(filter: { per_page: -1 }, scene_filter: { details: $like }) {
        scenes { id title details } }
      findPerformers(filter: { per_page: -1 }, performer_filter: { details: $like }) {
        performers { id name details } }
      findStudios(filter: { per_page: -1 }, studio_filter: { details: $like }) {
        studios { id name details } }
      findTags(filter: { per_page: -1 }, tag_filter: { description: $like }) {
        tags { id name description } }
    }`,
    { like },
  )
  const byName = (list, key = 'name') =>
    Object.fromEntries(list.filter(marked).map((x) => [x[key], x.id]))
  return {
    scenes: byName(findScenes.scenes, 'title'),
    performers: byName(findPerformers.performers),
    studios: byName(findStudios.studios),
    tags: byName(findTags.tags),
  }
}

// Destroys every demo record, scenes first. Returns how many of each it
// removed.
export async function removeDemoLibrary(gql) {
  const ids = await demoLibraryIds(gql)
  const list = (kind) => Object.values(ids[kind])
  if (list('scenes').length)
    await gql(
      'mutation ($i: ScenesDestroyInput!) { scenesDestroy(input: $i) }',
      {
        i: { ids: list('scenes'), delete_file: false, delete_generated: true },
      },
    )
  for (const kind of ['performers', 'studios', 'tags'])
    if (list(kind).length)
      await gql(`mutation ($ids: [ID!]!) { ${kind}Destroy(ids: $ids) }`, {
        ids: list(kind),
      })
  return Object.fromEntries(
    Object.keys(ids).map((kind) => [kind, list(kind).length]),
  )
}

const create = async (gql, kind, input) =>
  (
    await gql(
      `mutation ($i: ${kind}CreateInput!) { ${kind.toLowerCase()}Create(input: $i) { id } }`,
      { i: input },
    )
  )[`${kind.toLowerCase()}Create`].id

const timestamp = (anchor, ago) =>
  new Date(anchor - ago * 60_000).toISOString().replace(/\.\d+Z$/, 'Z')

// Removes an earlier seed, then creates the demo library and its history
// (the sparse one with `sparse`). Plays and O events are placed relative to
// the start of the UTC day of `now`. Returns the anchor and the new ids by
// name.
export async function seedDemoLibrary(
  gql,
  { now = Date.now(), sparse = false } = {},
) {
  await removeDemoLibrary(gql)
  const anchor = Math.floor(now / 86_400_000) * 86_400_000
  const { performers, studios, tags, scenes } = sparse ? SPARSE : DEMO
  const images = await drawImages(performers.length, scenes.length)

  const tagIds = {}
  for (const { name } of tags)
    tagIds[name] = await create(gql, 'Tag', {
      name,
      description: MARK,
      ignore_auto_tag: true,
    })
  const studioIds = {}
  for (const { name, parent } of studios)
    studioIds[name] = await create(gql, 'Studio', {
      name,
      parent_id: parent ? studioIds[parent] : null,
      details: MARK,
      ignore_auto_tag: true,
    })
  const performerIds = {}
  for (const [i, p] of performers.entries())
    performerIds[p.name] = await create(gql, 'Performer', {
      name: p.name,
      gender: p.gender,
      image: p.photo ? images.photos[i] : null,
      favorite: p.favorite,
      rating100: p.rating100,
      details: MARK,
      ignore_auto_tag: true,
    })

  const sceneIds = {}
  for (const s of scenes) {
    const id = await create(gql, 'Scene', {
      title: s.title,
      date: s.date,
      details: MARK,
      rating100: s.rating100,
      organized: s.organized,
      studio_id: s.studio ? studioIds[s.studio] : null,
      performer_ids: s.performers.map((name) => performerIds[name]),
      tag_ids: s.tags.map((name) => tagIds[name]),
      cover_image: images.covers[s.cover],
    })
    sceneIds[s.title] = id
    if (!s.plays.length) continue
    const times = (list) => list.map((ago) => timestamp(anchor, ago))
    await gql(
      `mutation ($id: ID!, $times: [Timestamp!], $resume: Float, $duration: Float) {
        sceneAddPlay(id: $id, times: $times) { count }
        sceneSaveActivity(id: $id, resume_time: $resume, playDuration: $duration) }`,
      { id, times: times(s.plays), resume: s.resume, duration: s.duration },
    )
    // sceneAddO with no times adds one O now, so only scenes with O history
    // get the call.
    if (s.os.length)
      await gql(
        'mutation ($id: ID!, $times: [Timestamp!]) { sceneAddO(id: $id, times: $times) { count } }',
        { id, times: times(s.os) },
      )
  }
  return {
    anchor: new Date(anchor).toISOString(),
    scenes: sceneIds,
    performers: performerIds,
    studios: studioIds,
    tags: tagIds,
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { gql } = await import('../../../tests/stash/helpers.mjs')
  const [command, variant] = process.argv.slice(2)
  if (command === 'seed' && (!variant || variant === 'sparse')) {
    const sparse = variant === 'sparse'
    const { scenes } = sparse ? SPARSE : DEMO
    const ids = await seedDemoLibrary(gql, { sparse })
    const played = scenes.filter((s) => s.plays.length)
    console.log(
      `Seeded the ${sparse ? 'sparse ' : ''}Cherry Pick demo library: ${Object.keys(ids.scenes).length} scenes (${scenes.filter((s) => s.rating100).length} rated, ${played.length} played, ${scenes.length - played.length} never played), ${Object.keys(ids.performers).length} performers, ${Object.keys(ids.studios).length} studios, ${Object.keys(ids.tags).length} tags; plays before ${ids.anchor}`,
    )
  } else if (command === 'remove') {
    const removed = await removeDemoLibrary(gql)
    console.log(
      `Removed the Cherry Pick demo library: ${Object.entries(removed)
        .map(([kind, n]) => `${n} ${kind}`)
        .join(', ')}`,
    )
  } else {
    console.error(
      'Usage: node plugins/cherrypick/tests/demo-library.mjs seed [sparse]|remove',
    )
    process.exitCode = 1
  }
}
