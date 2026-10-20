// Cherry Pick's scale library: thousands of invented scenes, performers,
// studios and tags, watched and rated by an invented viewer, for checking
// Cherry Pick at the size of a real library (scale.spec.mjs). It goes into a
// throwaway Stash of its own, never one the compatibility tests use: their
// specs and the themes' screenshots expect the small demo libraries.
//
// Like the demo library (../demo-library.mjs), every record carries MARK in
// its details and scenes have no files; plays, O history and watch time go
// through Stash's own mutations. Mutations are sent in aliased batches, so
// 5,000 scenes seed in a few minutes. Stash has no mutation for created_at,
// so with --db the seeder spreads the scenes' created_at over four years
// with sqlite3 (each scene before its first play); without it every scene is
// "added today" and For you reads every unplayed scene as new.
//
// The viewer's profile sets how they use Stash:
//   rater  rates a quarter of what they play, performers too, and rewatches
//   once   rates like rater but plays each scene once (a non-rewatcher)
//   light  a few dozen scene ratings, no performer ratings, some favourites
//   none   plays and favourites only, no ratings at all
//
// Usage: node plugins/cherrypick/tests/scale/library.mjs seed <profile>
//          [--scenes 5000] [--performers <scenes / 5>]
//          [--db <work>/config/stash-go.sqlite] [--summary <file.json>]
//        node plugins/cherrypick/tests/scale/library.mjs remove
// Env: STASH_URL (default http://127.0.0.1:9999)
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const MARK = 'Invented for the Cherry Pick scale library.'
export const PROFILES = ['rater', 'once', 'light', 'none']

const DAY = 24 * 60
const GENDERS = [
  ['FEMALE', 0.78],
  ['MALE', 0.14],
  ['TRANSGENDER_FEMALE', 0.04],
  ['NON_BINARY', 0.02],
  [null, 0.02],
]
const SYLLABLES =
  'ka la mi no ra se ti vo yu ze bri cal dor fen gil hal ish jun kel lor mar nel or pim quin ros sal tam uri vel wyn xan yel zor'.split(
    ' ',
  )
const WORDS =
  'Amber Velvet Midnight Golden Silver Neon Quiet Wild Gentle Bold Rainy Sunny Hidden Lazy Electric Secret Sweet Late Early Distant'.split(
    ' ',
  )
const NOUNS =
  'Rooftop Garden Studio Harbor Library Kitchen Balcony Lounge Cabin Meadow Gallery Station Terrace Workshop Pool Market Loft Orchard Bridge Lighthouse'.split(
    ' ',
  )

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

// The whole library as data. Plays and O events are minutes before the
// anchor; created is days before it.
export function plan({
  profile = 'rater',
  scenes: nScenes = 5000,
  performers: nPerf = null,
} = {}) {
  if (!PROFILES.includes(profile)) throw new Error(`Unknown profile ${profile}`)
  const r = random(97)
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
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
  const noise = (spread) => (r() + r() + r() - 1.5) * spread
  const weighted = (pairs) => {
    let x = r()
    for (const [v, w] of pairs) if ((x -= w) < 0) return v
    return pairs.at(-1)[0]
  }
  const name = (n) => Array.from({ length: n }, () => pick(SYLLABLES)).join('')
  const cap = (s) => s[0].toUpperCase() + s.slice(1)

  const nPerformers = nPerf ?? Math.round(nScenes / 5)
  const names = new Set()
  const performers = Array.from({ length: nPerformers }, () => {
    let full
    do full = `${cap(name(2))} ${cap(name(int(2, 3)))}`
    while (names.has(full))
    names.add(full)
    return {
      name: full,
      gender: weighted(GENDERS),
      photo: r() < 0.9,
      favorite: false,
      rating100: null,
      // Popularity: a few performers in dozens of scenes, most in a handful.
      weight: 1 / (1 + r() * 40) ** 1.2,
      bias: int(-6, 6),
    }
  })
  const studioNames = new Set()
  const studios = Array.from({ length: 60 }, (_, i) => {
    let full
    do
      full = `${cap(name(2))} ${pick(['Films', 'Studio', 'Pictures', 'Works', 'House'])}`
    while (studioNames.has(full))
    studioNames.add(full)
    return { name: full, parent: i >= 50 ? i - 50 : null }
  })
  const tags = Array.from({ length: 300 }, (_, i) => ({
    name: `${cap(name(2))}${i}`,
  }))

  // The viewer's hidden taste.
  const loved = new Set(sample(performers, 25).map((p) => p.name))
  const disliked = new Set(
    sample(
      performers.filter((p) => !loved.has(p.name)),
      25,
    ).map((p) => p.name),
  )
  const likedTags = new Set(sample(tags, 15).map((t) => t.name))
  const dislikedTags = new Set(
    sample(
      tags.filter((t) => !likedTags.has(t.name)),
      15,
    ).map((t) => t.name),
  )
  const likedStudios = new Set(sample(studios, 3).map((s) => s.name))
  const momentum = new Set(
    sample([...loved], 2).concat(
      sample(
        performers.filter((p) => !loved.has(p.name) && !disliked.has(p.name)),
        2,
      ).map((p) => p.name),
    ),
  )

  const totalWeight = performers.reduce((n, p) => n + p.weight, 0)
  const drawPerformer = () => {
    let x = r() * totalWeight
    for (const p of performers) if ((x -= p.weight) < 0) return p
    return performers.at(-1)
  }
  const tagWeights = tags.map((t, i) => [t.name, 1 / (1 + i / 20)])
  const tagTotal = tagWeights.reduce((n, [, w]) => n + w, 0)
  const drawTag = () => weighted(tagWeights.map(([t, w]) => [t, w / tagTotal]))

  const titles = new Set()
  const scenes = Array.from({ length: nScenes }, () => {
    let title
    do title = `${pick(WORDS)} ${pick(NOUNS)} ${int(1, 999)}`
    while (titles.has(title))
    titles.add(title)
    const cast = new Set()
    if (r() > 0.05)
      for (
        let k = weighted([
          [1, 0.55],
          [2, 0.35],
          [3, 0.1],
        ]);
        k > 0;
        k--
      )
        cast.add(drawPerformer().name)
    const sceneTags = new Set()
    for (let k = int(1, 7); k > 0; k--) sceneTags.add(drawTag())
    return {
      title,
      date: `${int(2015, 2026)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
      studio: r() < 0.9 ? pick(studios).name : null,
      performers: [...cast],
      tags: [...sceneTags],
      organized: r() < 0.4,
      cover: int(0, 39),
    }
  })
  const bias = Object.fromEntries(performers.map((p) => [p.name, p.bias]))
  const count = (list, set) => list.filter((x) => set.has(x)).length
  for (const s of scenes)
    s.affinity = clamp(
      Math.round(
        45 +
          24 * count(s.performers, loved) -
          24 * count(s.performers, disliked) +
          (likedStudios.has(s.studio) ? 12 : 0) +
          8 * count(s.tags, likedTags) -
          10 * count(s.tags, dislikedTags) +
          s.performers.reduce((n, p) => n + bias[p], 0) +
          noise(10),
      ),
      0,
      100,
    )

  // What they played: favoured scenes more often. A non-rewatcher plays each
  // scene once; the others come back to what they like.
  const share = { rater: 0.36, once: 0.36, light: 0.24, none: 0.18 }[profile]
  const byAffinity = [...scenes].sort((a, b) => b.affinity - a.affinity)
  const played = new Set(
    byAffinity.filter(
      (s, i) => r() < share * (1.6 - (1.2 * i) / scenes.length),
    ),
  )
  const at = (day) => day * DAY - int(17 * 60, 23 * 60 - 1)
  for (const s of scenes) {
    s.plays = []
    s.os = []
    s.duration = null
    s.resume = null
    s.rating100 = null
  }
  for (const s of played) {
    const n =
      profile === 'once'
        ? 1
        : clamp(Math.round(1 + (s.affinity - 40) / 12 + noise(2)), 1, 12)
    const days = sample(
      Array.from({ length: 1080 }, (_, d) => d + 15),
      n,
    )
    s.plays = days.map(at)
  }
  // The last two weeks: momentum performers' scenes, and some strays.
  for (const s of scenes.filter((s) =>
    s.performers.some((p) => momentum.has(p)),
  )) {
    if (profile === 'once' && s.plays.length) continue
    s.plays.push(
      ...sample(
        Array.from({ length: 13 }, (_, d) => d + 1),
        profile === 'once' ? 1 : int(1, 3),
      ).map(at),
    )
    played.add(s)
  }
  for (const s of sample(
    [...played].filter((s) => profile !== 'once' || !s.plays.length),
    profile === 'once' ? 0 : 30,
  ))
    s.plays.push(at(int(1, 14)))
  for (const s of played) {
    s.plays.sort((a, b) => b - a)
    const watch = () =>
      s.affinity >= 70
        ? int(600, 1800)
        : s.affinity >= 40
          ? int(300, 900)
          : int(60, 300)
    const watched = s.plays.map(watch)
    s.duration = watched.reduce((n, x) => n + x, 0)
    s.resume =
      s.affinity < 40 ? watched.at(-1) : r() < 0.15 ? int(60, 600) : null
    const os = s.affinity >= 85 ? int(1, 3) : s.affinity >= 70 ? int(0, 2) : 0
    s.os = sample(s.plays, Math.min(os, s.plays.length))
      .map((ago) => ago - 15)
      .sort((a, b) => b - a)
  }

  // Ratings: people rate what they liked, so ratings bunch at 4 to 5 stars.
  const rate = (s) => {
    const x = 50 + (s.affinity - 45) * 1.2 + noise(18)
    return clamp(Math.round(x / 10) * 10, 10, 100)
  }
  const playedList = [...played]
  if (profile === 'rater' || profile === 'once') {
    for (const s of playedList)
      if (r() < 0.12 + (0.35 * s.affinity) / 100) s.rating100 = rate(s)
    for (const s of sample(
      scenes.filter((s) => !played.has(s)),
      40,
    ))
      s.rating100 = rate(s)
    const seen = new Set(playedList.flatMap((s) => s.performers))
    for (const p of sample(
      performers.filter((p) => seen.has(p.name)),
      Math.round(nPerformers * 0.15),
    ))
      p.rating100 = clamp(
        Math.round(
          (60 +
            (loved.has(p.name) ? 30 : disliked.has(p.name) ? -35 : p.bias * 2) +
            noise(12)) /
            10,
        ) * 10,
        10,
        100,
      )
  }
  if (profile === 'light')
    for (const s of sample(
      playedList.filter((s) => s.affinity >= 55),
      45,
    ))
      s.rating100 = rate(s)
  const favourites = { rater: 40, once: 40, light: 30, none: 15 }[profile]
  for (const p of sample(
    performers.filter((p) => loved.has(p.name) || r() < 0.03),
    favourites,
  ))
    p.favorite = true

  // created: days before the anchor, before the first play.
  for (const s of scenes) {
    const first = s.plays.length ? Math.max(...s.plays) / DAY : 0
    s.created = Math.ceil(first) + int(1, Math.max(2, 1460 - Math.ceil(first)))
  }
  // A few scenes added this week and never played, for the New label.
  for (const s of sample(
    scenes.filter((s) => !s.plays.length),
    12,
  ))
    s.created = int(0, 6)

  return {
    profile,
    taste: {
      loved: [...loved],
      disliked: [...disliked],
      momentum: [...momentum],
      likedTags: [...likedTags],
      dislikedTags: [...dislikedTags],
      likedStudios: [...likedStudios],
    },
    performers,
    studios,
    tags,
    scenes,
  }
}

const run = promisify(execFile)

// 24 portraits and 40 covers, reused across records; ffmpeg is already a
// requirement of the test harness.
async function drawImages() {
  const dir = await mkdtemp(join(tmpdir(), 'cherrypick-scale-'))
  const dataUrl = async (file) =>
    `data:image/jpeg;base64,${(await readFile(join(dir, file))).toString('base64')}`
  const ffmpeg = (args) =>
    run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args])
  try {
    await ffmpeg([
      ...['-f', 'lavfi', '-i', 'testsrc2=size=200x300:rate=1'],
      ...['-vf', 'hue=h=n*37', '-frames:v', '24', '-q:v', '5'],
      ...['-start_number', '0', join(dir, 'photo-%d.jpg')],
    ])
    await ffmpeg([
      ...['-f', 'lavfi', '-i', 'mandelbrot=size=320x180:rate=1'],
      ...['-vf', 'hue=h=n*29', '-frames:v', '40', '-q:v', '5'],
      ...['-start_number', '0', join(dir, 'cover-%d.jpg')],
    ])
    return {
      photos: await Promise.all(
        Array.from({ length: 24 }, (_, i) => dataUrl(`photo-${i}.jpg`)),
      ),
      covers: await Promise.all(
        Array.from({ length: 40 }, (_, i) => dataUrl(`cover-${i}.jpg`)),
      ),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Sends one aliased mutation per item, `size` items to a request. `field`
// returns the mutation field for item i and the variable it takes.
async function batched(gql, items, size, build) {
  const out = []
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    const vars = {}
    const decls = []
    const fields = chunk.map((item, k) => {
      const { field, type, value } = build(item, k)
      vars[`v${k}`] = value
      decls.push(`$v${k}: ${type}`)
      return `m${k}: ${field.replace('$v', `$v${k}`)}`
    })
    const data = await gql(
      `mutation (${decls.join(', ')}) { ${fields.join('\n')} }`,
      vars,
    )
    out.push(...chunk.map((_, k) => data[`m${k}`]))
  }
  return out
}

const like = { value: MARK, modifier: 'EQUALS' }

// Destroys every scale record. Returns how many of each it removed.
export async function removeScaleLibrary(gql) {
  const { findScenes, findPerformers, findStudios, findTags } = await gql(
    `query ($like: StringCriterionInput) {
      findScenes(filter: { per_page: -1 }, scene_filter: { details: $like }) { scenes { id } }
      findPerformers(filter: { per_page: -1 }, performer_filter: { details: $like }) { performers { id } }
      findStudios(filter: { per_page: -1 }, studio_filter: { details: $like }) { studios { id } }
      findTags(filter: { per_page: -1 }, tag_filter: { description: $like }) { tags { id } }
    }`,
    { like },
  )
  const ids = {
    scenes: findScenes.scenes.map((x) => x.id),
    performers: findPerformers.performers.map((x) => x.id),
    studios: findStudios.studios.map((x) => x.id),
    tags: findTags.tags.map((x) => x.id),
  }
  for (let i = 0; i < ids.scenes.length; i += 500)
    await gql(
      'mutation ($i: ScenesDestroyInput!) { scenesDestroy(input: $i) }',
      {
        i: {
          ids: ids.scenes.slice(i, i + 500),
          delete_file: false,
          delete_generated: true,
        },
      },
    )
  for (const kind of ['performers', 'studios', 'tags'])
    if (ids[kind].length)
      await gql(`mutation ($ids: [ID!]!) { ${kind}Destroy(ids: $ids) }`, {
        ids: ids[kind],
      })
  return Object.fromEntries(
    Object.entries(ids).map(([kind, list]) => [kind, list.length]),
  )
}

const timestamp = (anchor, ago) =>
  new Date(anchor - ago * 60_000).toISOString().replace(/\.\d+Z$/, 'Z')
const sqlTime = (anchor, days) =>
  new Date(anchor - days * DAY * 60_000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '')

// Removes an earlier seed, then creates the library and its history. With
// db, spreads created_at through sqlite3. Returns the anchor and counts.
export async function seedScaleLibrary(
  gql,
  {
    profile = 'rater',
    scenes: n = 5000,
    performers = null,
    db = null,
    now = Date.now(),
  } = {},
) {
  await removeScaleLibrary(gql)
  const anchor = Math.floor(now / 86_400_000) * 86_400_000
  const lib = plan({ profile, scenes: n, performers })
  const images = await drawImages()

  const tagIds = {}
  const tagOut = await batched(gql, lib.tags, 50, (t) => ({
    field: 'tagCreate(input: $v) { id }',
    type: 'TagCreateInput!',
    value: { name: t.name, description: MARK, ignore_auto_tag: true },
  }))
  lib.tags.forEach((t, i) => (tagIds[t.name] = tagOut[i].id))
  const studioIds = {}
  for (const pass of [false, true]) {
    const list = lib.studios.filter((s) => (s.parent != null) === pass)
    const out = await batched(gql, list, 50, (s) => ({
      field: 'studioCreate(input: $v) { id }',
      type: 'StudioCreateInput!',
      value: {
        name: s.name,
        parent_id: pass ? studioIds[lib.studios[s.parent].name] : null,
        details: MARK,
        ignore_auto_tag: true,
      },
    }))
    list.forEach((s, i) => (studioIds[s.name] = out[i].id))
  }
  const performerIds = {}
  const perfOut = await batched(gql, lib.performers, 25, (p, k) => ({
    field: 'performerCreate(input: $v) { id }',
    type: 'PerformerCreateInput!',
    value: {
      name: p.name,
      gender: p.gender,
      image: p.photo ? images.photos[k % images.photos.length] : null,
      favorite: p.favorite,
      rating100: p.rating100,
      details: MARK,
      ignore_auto_tag: true,
    },
  }))
  lib.performers.forEach((p, i) => (performerIds[p.name] = perfOut[i].id))

  const sceneOut = await batched(gql, lib.scenes, 25, (s) => ({
    field: 'sceneCreate(input: $v) { id }',
    type: 'SceneCreateInput!',
    value: {
      title: s.title,
      date: s.date,
      details: MARK,
      rating100: s.rating100,
      organized: s.organized,
      studio_id: s.studio ? studioIds[s.studio] : null,
      performer_ids: s.performers.map((name) => performerIds[name]),
      tag_ids: s.tags.map((name) => tagIds[name]),
      cover_image: images.covers[s.cover],
    },
  }))
  lib.scenes.forEach((s, i) => (s.id = sceneOut[i].id))

  const times = (list) => list.map((ago) => timestamp(anchor, ago))
  const played = lib.scenes.filter((s) => s.plays.length)
  // sceneAddPlay, sceneSaveActivity and sceneAddO take more than one
  // argument each, so their batches are built here.
  for (let i = 0; i < played.length; i += 40) {
    const chunk = played.slice(i, i + 40)
    const vars = {}
    const decls = []
    const fields = []
    chunk.forEach((s, k) => {
      vars[`i${k}`] = s.id
      vars[`t${k}`] = times(s.plays)
      vars[`r${k}`] = s.resume
      vars[`d${k}`] = s.duration
      decls.push(
        `$i${k}: ID!, $t${k}: [Timestamp!], $r${k}: Float, $d${k}: Float`,
      )
      fields.push(
        `p${k}: sceneAddPlay(id: $i${k}, times: $t${k}) { count }`,
        `a${k}: sceneSaveActivity(id: $i${k}, resume_time: $r${k}, playDuration: $d${k})`,
      )
      if (s.os.length) {
        vars[`o${k}`] = times(s.os)
        decls.push(`$o${k}: [Timestamp!]`)
        fields.push(`o${k}: sceneAddO(id: $i${k}, times: $o${k}) { count }`)
      }
    })
    await gql(`mutation (${decls.join(', ')}) { ${fields.join('\n')} }`, vars)
  }

  if (db) {
    const sql = [
      'BEGIN;',
      ...lib.scenes.map(
        (s) =>
          `UPDATE scenes SET created_at = '${sqlTime(anchor, s.created)}' WHERE id = ${Number(s.id)};`,
      ),
      'COMMIT;',
    ].join('\n')
    const file = join(tmpdir(), `cherrypick-scale-${process.pid}.sql`)
    await writeFile(file, sql)
    try {
      await run('sqlite3', ['-cmd', '.timeout 10000', db, `.read ${file}`])
    } finally {
      await rm(file, { force: true })
    }
  }

  return {
    anchor: new Date(anchor).toISOString(),
    profile,
    scenes: lib.scenes.length,
    played: played.length,
    rated: lib.scenes.filter((s) => s.rating100).length,
    performers: lib.performers.length,
    ratedPerformers: lib.performers.filter((p) => p.rating100).length,
    favourites: lib.performers.filter((p) => p.favorite).length,
    plays: played.reduce((n, s) => n + s.plays.length, 0),
    taste: lib.taste,
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { gql } = await import('../../../../tests/stash/helpers.mjs')
  const [command, profile, ...rest] = process.argv.slice(2)
  const opt = (k) => {
    const i = rest.indexOf(`--${k}`)
    return i >= 0 ? rest[i + 1] : null
  }
  if (command === 'seed' && PROFILES.includes(profile)) {
    const t = Date.now()
    const out = await seedScaleLibrary(gql, {
      profile,
      scenes: Number(opt('scenes') ?? 5000),
      performers: opt('performers') ? Number(opt('performers')) : null,
      db: opt('db'),
    })
    // The hidden taste goes to --summary, for scale.spec.mjs to judge picks.
    if (opt('summary'))
      await writeFile(opt('summary'), JSON.stringify(out, null, 2))
    console.log(
      `Seeded the scale library in ${Math.round((Date.now() - t) / 1000)} s: ${JSON.stringify({ ...out, taste: undefined })}`,
    )
  } else if (command === 'remove') {
    console.log(`Removed: ${JSON.stringify(await removeScaleLibrary(gql))}`)
  } else {
    console.error(
      `Usage: node plugins/cherrypick/tests/scale/library.mjs seed <${PROFILES.join('|')}> [--scenes N] [--performers N] [--db path] | remove`,
    )
    process.exitCode = 1
  }
}
