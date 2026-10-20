// The demo library the README's screenshots are taken on: 52 short clips
// cut from three Blender Foundation open movies, 26 performers whose photos
// are stills of the films' characters, and invented names, ratings and play
// history, so every screenshot has something to show. It is for
// screenshots only. The compatibility tests keep their own demo library
// (demo-library.mjs: ffmpeg test patterns, nothing downloaded).
//
// The films are licensed under Creative Commons Attribution, and the README
// credits them where it shows the screenshots (FILMS has the wording).
// `media` downloads each film from download.blender.org, checks its sha256,
// and cuts the clips and stills into a folder of their own. Nothing it
// makes belongs in the repo. `seed` runs Stash's setup on that folder,
// scans it (Stash generates the sprites and previews scene brackets need),
// then adds the names, casts, covers, ratings, plays and O counts and
// installs Cherry Pick from dist/site.
//
// Usage, beside a throwaway Stash started by tests/stash/stash.sh:
//   node plugins/cherrypick/tests/screenshots/blender-library.mjs media <dir>
//   WORK=<stash work dir> node plugins/cherrypick/tests/screenshots/blender-library.mjs seed <dir>
// Env: STASH_URL (default http://127.0.0.1:9999), SITE (default dist/site)
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

// Downloads from the Blender Foundation's own server. A zip holds the one
// film named by `file`.
export const FILMS = {
  bunny: {
    title: 'Big Buck Bunny',
    url: 'https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_720p_h264.mov.zip',
    sha256: 'b0c9ade80b086179feee41514929de583966eec87c703575d97f051f88b33b67',
    file: 'big_buck_bunny_720p_h264.mov',
    credit: '© 2008 Blender Foundation, www.bigbuckbunny.org',
    license: 'CC BY 3.0',
  },
  sintel: {
    title: 'Sintel',
    url: 'https://download.blender.org/durian/movies/Sintel.2010.720p.mkv.zip',
    sha256: 'd252f898641b20f51c64206f31063e659c28b152a9d988936736d1b56e6e4db3',
    file: 'Sintel.2010.720p.mkv',
    credit: '© Blender Foundation, durian.blender.org',
    license: 'CC BY 3.0',
  },
  dream: {
    title: 'Elephants Dream',
    url: 'https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov',
    sha256: '6fc295e0e92835316ec95929ccfc664b05ed2434f673e6f5e684f98f7558a547',
    file: 'elephantsdream-720-h264-st-aac.mov',
    credit:
      '© 2006 Blender Foundation and Netherlands Media Art Institute, www.elephantsdream.org',
    license: 'CC BY 2.5',
  },
}

// What the invented viewer likes: it sets the ratings, how much each scene
// was played and its O count. MOMENTUM's scenes were played a lot in the
// last two weeks, for a "More with ..." row.
const TASTE = {
  loved: ['Mabel Thorne', 'Winnie Larkin', 'Pippa Coleby', 'Marlowe Finch'],
  disliked: ['Prosper Gale', 'Corin Ashgrove', 'Hazel Moorcroft'],
  studio: 'Ember Row',
  likedTags: ['Rooftops', 'Sunset', 'Friendship', 'Butterflies', 'Flying'],
  dislikedTags: ['Clockwork', 'Snow', 'Moody'],
}
const MOMENTUM = 'Mabel Thorne'

// Name, gender, photo (film, second, where the character stands across the
// frame, 0 to 1), favorite, rating100. Sixteen women have no rating and at
// most one rated scene, so a 16-performer bracket draws exactly them and
// the four rated women wait for its Challenge round.
const PERFORMERS = [
  ['Clara Downing', 'FEMALE', ['bunny', 62, 0.58], false, null],
  ['Mabel Thorne', 'FEMALE', ['bunny', 112, 0.42], true, 90],
  ['Hattie Fenwick', 'FEMALE', ['bunny', 480, 0.31], false, null],
  ['Rosa Petley', 'FEMALE', ['bunny', 78, 0.44], false, null],
  ['Winnie Larkin', 'FEMALE', ['bunny', 17, 0.49], true, 100],
  ['Dora Greyling', 'FEMALE', ['bunny', 382, 0.73], false, null],
  ['Lettie Ellery', 'FEMALE', ['bunny', 592, 0.54], false, null],
  ['Nell Burrows', 'FEMALE', ['bunny', 118, 0.6], false, null],
  ['Ruth Vale', 'FEMALE', ['bunny', 118, 0.33], false, null],
  ['Sally Acton', 'FEMALE', ['bunny', 398, 0.55], false, null],
  ['Esther Gale', 'FEMALE', ['bunny', 425, 0.5], false, null],
  ['Marlowe Finch', 'FEMALE', ['sintel', 270, 0.52], false, null],
  ['Ivy Tallow', 'FEMALE', ['sintel', 126, 0.42], false, 60],
  ['Hester Reed', 'FEMALE', ['sintel', 186, 0.42], false, null],
  ['June Quill', 'FEMALE', ['sintel', 345, 0.54], false, null],
  ['Hazel Moorcroft', 'FEMALE', ['sintel', 352, 0.42], false, 30],
  ['Bridget Wynn', 'FEMALE', ['sintel', 445, 0.46], false, null],
  ['Linnea Frost', 'FEMALE', ['sintel', 177, 0.32], false, null],
  ['Pippa Coleby', 'FEMALE', ['sintel', 274.5, 0.5], false, null],
  ['Tilda Ember', 'FEMALE', ['sintel', 283, 0.25], false, null],
  ['Elliot Wirth', 'MALE', ['dream', 52, 0.56], false, 60],
  ['Prosper Gale', 'MALE', ['dream', 62, 0.5], false, 20],
  ['Gideon Spool', 'MALE', ['dream', 262, 0.58], false, null],
  ['Toby Wick', 'MALE', ['dream', 426, 0.45], false, null],
  ['Bram Hearth', 'MALE', ['sintel', 458, 0.52], true, 70],
  ['Corin Ashgrove', 'MALE', ['sintel', 400, 0.25], false, 40],
]

// Name and parent.
const STUDIOS = [
  ['Hollowmere', null],
  ['Meadowlark Lane', 'Hollowmere'],
  ['Acorn & Ash', 'Hollowmere'],
  ['Lanternfield', null],
  ['Ember Row', 'Lanternfield'],
  ['Snowdrop Hill', 'Lanternfield'],
  ['Copper Spool Works', null],
]

// Tag and parent. Scene inspectors group tags by their first parent.
const TAGS = [
  ['Setting', null],
  ['Mood', null],
  ...['Meadow', 'Forest', 'Treetops', 'City', 'Market', 'Rooftops'].map(
    (name) => [name, 'Setting'],
  ),
  ...['Snow', 'Desert', 'Campfire', 'Clockwork'].map((name) => [
    name,
    'Setting',
  ]),
  ...['Playful', 'Cozy', 'Dreamy', 'Moody', 'Hopeful'].map((name) => [
    name,
    'Mood',
  ]),
  ...[
    'Adventure',
    'Birds',
    'Butterflies',
    'Dragons',
    'Flying',
    'Friendship',
    'Mischief',
    'Picnic',
    'Sunset',
  ].map((name) => [name, null]),
]

// Film, start and length in seconds (and the second of the clip its cover
// shows, the middle by default), title, studio, cast, tags, and what the
// viewer did: 'rated' (played and rated), 'played' (played, unrated) or
// 'never'. The segments avoid every scene with a weapon, an injury or a
// fight.
const SCENES = `
bunny 3 16 | First Light | Meadowlark Lane | Winnie Larkin | Meadow, Birds, Hopeful | rated
bunny 32 18 | Out of the Burrow | Meadowlark Lane | Mabel Thorne | Meadow, Cozy | rated
bunny 52 18 | Stretch and Sniff | Meadowlark Lane | Clara Downing | Meadow, Playful | rated
bunny 70 18 | Butterfly Visit | Meadowlark Lane | Mabel Thorne, Rosa Petley | Meadow, Butterflies, Playful | played
bunny 88 18 | An Apple for Later | Meadowlark Lane | Mabel Thorne | Meadow, Picnic, Cozy | rated
bunny 106 18 | A Hat of Wings | Meadowlark Lane | Mabel Thorne, Rosa Petley | Meadow, Butterflies, Friendship | rated
bunny 124 18 | Who's in the Tree | Acorn & Ash | Mabel Thorne, Ruth Vale | Treetops, Mischief | played
bunny 142 18 | Three Little Troublemakers | Acorn & Ash | Ruth Vale, Nell Burrows, Mabel Thorne | Meadow, Mischief | rated
bunny 160 18 | Plotting Under the Oak | Acorn & Ash | Sally Acton, Ruth Vale, Nell Burrows | Treetops, Mischief | played
bunny 222 18 | Apples Everywhere | Meadowlark Lane | Mabel Thorne, Nell Burrows | Meadow, Picnic, Mischief | played
bunny 270 18 | Rope and Patience | Acorn & Ash | Mabel Thorne | Forest, Adventure | rated
bunny 302 18 | Into the Long Grass | Acorn & Ash | Nell Burrows, Ruth Vale, Sally Acton | Forest, Adventure | never
bunny 326 12 | The Acorn Swing | Acorn & Ash | Sally Acton, Nell Burrows, Ruth Vale | Forest, Mischief, Playful | never
bunny 338 18 | Nut Hunt | Acorn & Ash | Nell Burrows | Forest, Playful | never
bunny 356 18 | The Hollow Log | Acorn & Ash | Nell Burrows, Hattie Fenwick | Forest, Mischief | played
bunny 374 18 | A Bird's Eye View | Acorn & Ash | Dora Greyling, Sally Acton | Treetops, Birds | rated
bunny 392 18 | Gliding Lessons | Acorn & Ash | Esther Gale | Treetops, Flying, Playful | played
bunny 410 18 | Treetop Glide | Acorn & Ash | Esther Gale | Treetops, Flying | rated
bunny 468 18 | Kite Day | Meadowlark Lane | Hattie Fenwick, Mabel Thorne | Meadow, Flying, Friendship, Hopeful | rated
bunny 580 16 | Up with the Kite | Meadowlark Lane | Lettie Ellery, Esther Gale | Flying, Birds, Playful | never
sintel 5 18 | Over the White Peaks | Snowdrop Hill |  | Snow, Adventure | rated
sintel 23 18 | The Long Climb | Snowdrop Hill | Hazel Moorcroft | Snow, Adventure | rated
sintel 100 18 16 | Fire in the Yurt | Snowdrop Hill | Bram Hearth, Ivy Tallow | Campfire, Cozy | rated
sintel 118 18 1 | A Bowl of Soup | Snowdrop Hill | Ivy Tallow, Bram Hearth | Campfire, Cozy | rated
sintel 136 16 | First Sight of the City | Ember Row | Ivy Tallow | City, Hopeful | rated
sintel 152 16 | Narrow Streets | Ember Row | Linnea Frost | City, Adventure | played
sintel 168 12 | Bread and a Climb | Ember Row | Linnea Frost | City, Rooftops | rated
sintel 250 18 | Market Morning | Ember Row | Pippa Coleby, Hester Reed | Market, City, Dragons | played
sintel 268 18 | A Small Friend on the Beam | Ember Row | Marlowe Finch, Pippa Coleby | Market, Dragons, Friendship | rated
sintel 286 18 | Running the Rooftops | Ember Row | Hester Reed, Tilda Ember | Rooftops, Sunset, Dragons | rated
sintel 304 18 1 | Wings at Dusk | Ember Row | June Quill, Tilda Ember | Rooftops, Sunset, Flying | never
sintel 322 18 3.5 | The Big Wings | Ember Row | June Quill, Marlowe Finch | Rooftops, Sunset, Dragons | played
sintel 340 18 | Over the Old City | Ember Row | June Quill | Rooftops, Sunset, Moody | rated
sintel 360 18 | Across the Dunes | Snowdrop Hill | Hazel Moorcroft | Desert, Moody | rated
sintel 378 18 | Bamboo and Stone | Snowdrop Hill | Hazel Moorcroft, Corin Ashgrove | Forest, Desert, Adventure | rated
sintel 396 18 | A Traveller with a Staff | Snowdrop Hill | Corin Ashgrove | Snow, Moody | rated
sintel 414 18 | Footprints in the Snow | Snowdrop Hill | Hazel Moorcroft, Bridget Wynn | Snow, Adventure | played
sintel 440 18 | Stories by the Fire | Snowdrop Hill | Bridget Wynn, Bram Hearth | Campfire, Cozy | rated
sintel 684 12 | On the Edge | Snowdrop Hill | Hester Reed, Marlowe Finch | Sunset, Dreamy | never
sintel 712 14 | Where the Snowdrops Grow | Snowdrop Hill | Marlowe Finch | Sunset, Hopeful, Dreamy | never
dream 30 18 | Hanging On | Copper Spool Works | Elliot Wirth, Prosper Gale | Clockwork, Adventure | rated
dream 50 18 | Two at the Window | Copper Spool Works | Elliot Wirth, Prosper Gale | Clockwork, Dreamy | rated
dream 90 18 | The Wire Garden | Copper Spool Works | Gideon Spool, Elliot Wirth | Clockwork, Dreamy | rated
dream 115 18 | Stepping Stones | Copper Spool Works | Elliot Wirth, Gideon Spool | Clockwork, Adventure | played
dream 145 15 | The Red Room | Copper Spool Works | Prosper Gale | Clockwork, Moody | rated
dream 160 18 | A Call in the Dark | Copper Spool Works | Prosper Gale | Clockwork, Moody | played
dream 245 18 | Dance of the Pillars | Copper Spool Works | Gideon Spool, Toby Wick | Clockwork, Playful | rated
dream 265 18 | Light Through the Gears | Copper Spool Works | Toby Wick | Clockwork, Dreamy | never
dream 300 18 | Showing the Way | Copper Spool Works | Gideon Spool, Toby Wick | Clockwork, Friendship | rated
dream 345 18 | Glow | Copper Spool Works | Prosper Gale, Elliot Wirth | Dreamy | never
dream 380 16 | Lantern Machines | Copper Spool Works |  | Clockwork, Dreamy | rated
dream 425 18 1 | The Green Room | Copper Spool Works | Toby Wick, Prosper Gale | Clockwork, Moody | never
`
  .trim()
  .split('\n')
  .map((line) => {
    const [clip, title, studio, cast, tags, seen] = line.split(' | ')
    const [film, start, length, cover = length / 2] = clip.split(' ')
    const list = (x) => (x ? x.split(', ') : [])
    return [
      film,
      +start,
      +length,
      +cover,
      title,
      studio,
      list(cast),
      list(tags),
      seen,
    ]
  })

// Covers for the StashDB scenes in the not-in-library screenshot, one per
// scene in take-screenshots.mjs's MISSING, in its order: film and second.
export const STASHDB_COVERS = [
  ['sintel', 262],
  ['sintel', 310],
  ['bunny', 484],
  ['sintel', 296],
  ['sintel', 325],
  ['sintel', 255],
  ['bunny', 64],
  ['sintel', 330],
  ['bunny', 96],
  ['sintel', 345],
  ['sintel', 720],
  ['bunny', 10],
  ['sintel', 300],
  ['sintel', 420],
  ['sintel', 30],
]

const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const DAY = 24 * 60

// mulberry32, as demo-library.mjs: the same history on every run.
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Every scene's date, rating, plays and O events (minutes before the start
// of the UTC day the seed runs), from TASTE.
export function plan() {
  const r = random(7)
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
  const noise = (spread) => (r() + r() + r() - 1.5) * spread
  const count = (list, names) => list.filter((x) => names.includes(x)).length
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
  const at = (day) => day * DAY - int(17 * 60, 23 * 60 - 1)
  const scenes = SCENES.map(
    ([film, start, length, cover, title, studio, cast, tags, seen]) => {
      const affinity = Math.round(
        48 +
          22 * count(cast, TASTE.loved) -
          22 * count(cast, TASTE.disliked) +
          (studio === TASTE.studio ? 12 : 0) +
          8 * count(tags, TASTE.likedTags) -
          10 * count(tags, TASTE.dislikedTags) +
          noise(10),
      )
      const rating = 50 + (affinity - 50) * 1.2 + noise(12)
      return {
        film,
        start,
        length,
        cover,
        title,
        file: `${slug(title)}.mp4`,
        studio,
        cast,
        tags,
        seen,
        affinity,
        date: `${int(2019, 2025)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
        rating100:
          seen === 'rated'
            ? clamp(Math.round(rating / 10) * 10, 10, 100)
            : null,
        plays: [],
        os: [],
        duration: null,
        resume: null,
      }
    },
  )
  const played = scenes.filter((s) => s.seen !== 'never')
  for (const s of played) {
    const n = clamp(Math.round(1 + (s.affinity - 45) / 15 + r() - 0.5), 1, 6)
    const days = new Set()
    while (days.size < n) days.add(int(15, 365))
    s.plays = [...days].map(at)
  }
  // The last two weeks: MOMENTUM's scenes again and again, and a few others
  for (const s of played.filter((s) => s.cast.includes(MOMENTUM)))
    s.plays.push(at(int(1, 6)), at(int(7, 12)))
  for (const s of played.filter((_, i) => i % 9 === 4))
    s.plays.push(at(int(1, 14)))
  for (const s of played) {
    s.plays.sort((a, b) => b - a)
    const watched = s.plays.map(() =>
      s.affinity >= 70
        ? int(s.length - 4, s.length)
        : s.affinity >= 45
          ? int(Math.round(s.length / 2), s.length)
          : int(3, Math.round(s.length / 3)),
    )
    s.duration = watched.reduce((n, x) => n + x, 0)
    s.resume = s.affinity < 45 ? watched.at(-1) : null
    const os = s.affinity >= 85 ? int(1, 3) : s.affinity >= 70 ? int(0, 2) : 0
    s.os = s.plays.slice(0, Math.min(os, s.plays.length)).map((ago) => ago - 1)
  }
  return scenes
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

const ffmpeg = (args) =>
  run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 64 * 1024 * 1024,
  })

// Downloads a film once, checks it and unpacks it. Returns the film's path.
async function film(dir, key) {
  const f = FILMS[key]
  const out = join(dir, 'films', f.file)
  if (await exists(out)) return out
  const download = join(dir, 'films', f.url.split('/').pop())
  if (!(await exists(download))) {
    console.log(`Downloading ${f.title} from ${f.url}`)
    const res = await fetch(f.url)
    if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`)
    await pipeline(
      Readable.fromWeb(res.body),
      createWriteStream(`${download}.part`),
    )
    await rename(`${download}.part`, download)
  }
  const actual = await sha256(download)
  if (actual !== f.sha256)
    throw new Error(`${f.title}: sha256 ${actual}, expected ${f.sha256}`)
  if (download.endsWith('.zip')) {
    await run('unzip', ['-o', '-q', download, f.file, '-d', join(dir, 'films')])
    await rm(download)
  }
  return out
}

// A frame as JPEG bytes: a 2:3 portrait around `center`, a 16:9 landscape,
// or the whole frame `width` wide.
async function still(path, second, { center, width, height }) {
  const crop =
    center != null
      ? `crop=ih*2/3:ih:max(0\\,min(iw-ih*2/3\\,iw*${center}-ih/3)):0,`
      : height
        ? 'crop=min(iw\\,ih*16/9):min(ih\\,iw*9/16),'
        : ''
  const { stdout } = await run(
    'ffmpeg',
    [
      ...['-nostdin', '-loglevel', 'error', '-ss', String(second)],
      ...['-i', path, '-frames:v', '1'],
      ...['-vf', `${crop}scale=${width}:${height ?? -2}`, '-q:v', '3'],
      ...['-f', 'image2pipe', '-vcodec', 'mjpeg', '-'],
    ],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
  )
  return stdout
}

// Downloads the films and cuts the clips (into <dir>/library, the folder
// Stash scans), their covers, the performer photos and the StashDB covers.
export async function prepareMedia(dir) {
  await mkdir(join(dir, 'films'), { recursive: true })
  await mkdir(join(dir, 'library'), { recursive: true })
  await mkdir(join(dir, 'stills'), { recursive: true })
  await mkdir(join(dir, 'covers'), { recursive: true })
  const paths = {}
  for (const key of Object.keys(FILMS)) paths[key] = await film(dir, key)
  for (const s of plan()) {
    const out = join(dir, 'library', s.file)
    if (await exists(out)) continue
    await ffmpeg([
      ...['-ss', String(s.start), '-t', String(s.length), '-i', paths[s.film]],
      ...['-map', '0:v:0', '-map', '0:a:0', '-sn'],
      // 720 lines, as the bunny is; Sintel keeps its letterboxed 1280x544
      ...['-vf', 'scale=-2:min(720\\,ih*1280/iw)'],
      ...['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22'],
      ...['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-b:a', '128k'],
      ...['-movflags', '+faststart', out],
    ])
  }
  for (const s of plan())
    await writeFile(
      join(dir, 'covers', `${slug(s.title)}.jpg`),
      await still(paths[s.film], s.start + s.cover, { width: 1280 }),
    )
  for (const [name, , [key, second, center]] of PERFORMERS)
    await writeFile(
      join(dir, 'stills', `${slug(name)}.jpg`),
      await still(paths[key], second, { center, width: 400, height: 600 }),
    )
  for (const [i, [key, second]] of STASHDB_COVERS.entries())
    await writeFile(
      join(dir, 'stills', `stashdb-${i}.jpg`),
      await still(paths[key], second, { width: 640, height: 360 }),
    )
  console.log(
    `Cut ${SCENES.length} clips, ${PERFORMERS.length} performer photos and ${STASHDB_COVERS.length} StashDB covers into ${dir}`,
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForJobs(gql) {
  for (let i = 0; i < 900; i++) {
    const { jobQueue } = await gql('{ jobQueue { id } }')
    if (!jobQueue?.length) return
    await sleep(1000)
  }
  throw new Error('Stash jobs did not finish')
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

// Sets up a fresh Stash on <dir>/library, scans it with covers, previews and
// sprites, seeds the names and history and installs Cherry Pick. Returns
// the ids by name (scenes by title).
export async function seedBlenderLibrary(gql, { dir, work, site }) {
  const { systemStatus } = await gql('{ systemStatus { status } }')
  if (systemStatus.status !== 'SETUP')
    throw new Error('Stash is set up already: seed a fresh one')
  const config = join(work, 'config')
  await gql('mutation ($i: SetupInput!) { setup(input: $i) }', {
    i: {
      configLocation: join(config, 'config.yml'),
      stashes: [
        { path: join(dir, 'library'), excludeVideo: false, excludeImage: true },
      ],
      databaseFile: join(config, 'stash-go.sqlite'),
      generatedLocation: join(config, 'generated'),
      cacheLocation: join(config, 'cache'),
      blobsLocation: join(config, 'blobs'),
      storeBlobsInDatabase: false,
    },
  })
  await gql('mutation { configureUI(partial: { lastNoteSeen: 99999999 }) }')
  await gql(`mutation { metadataScan(input: {
    scanGenerateCovers: true, scanGeneratePreviews: true,
    scanGenerateSprites: true, scanGenerateThumbnails: false }) }`)
  await waitForJobs(gql)

  const tags = {}
  for (const [name, parent] of TAGS)
    tags[name] = await create(gql, 'Tag', {
      name,
      parent_ids: parent ? [tags[parent]] : [],
    })
  const studios = {}
  for (const [name, parent] of STUDIOS)
    studios[name] = await create(gql, 'Studio', {
      name,
      parent_id: parent ? studios[parent] : null,
    })
  const performers = {}
  for (const [name, gender, , favorite, rating100] of PERFORMERS) {
    const jpeg = await readFile(join(dir, 'stills', `${slug(name)}.jpg`))
    performers[name] = await create(gql, 'Performer', {
      name,
      gender,
      favorite,
      rating100,
      image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      details: `A character from ${FILMS[PERFORMERS.find((p) => p[0] === name)[2][0]].title}, with an invented name.`,
    })
  }

  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: -1 }) { scenes { id files { basename } } } }',
  )
  const idOf = Object.fromEntries(
    findScenes.scenes.map((s) => [s.files[0].basename, s.id]),
  )
  const anchor = Math.floor(Date.now() / 86_400_000) * 86_400_000
  const times = (list) => list.map((ago) => timestamp(anchor, ago))
  const scenes = {}
  for (const s of plan()) {
    const id = idOf[s.file]
    if (!id) throw new Error(`Stash did not scan ${s.file}`)
    scenes[s.title] = id
    const f = FILMS[s.film]
    await gql(
      'mutation ($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id } }',
      {
        i: {
          id,
          title: s.title,
          date: s.date,
          details: `Cut from ${f.title} (${f.credit}), licensed ${f.license}. The title, studio and cast names are invented.`,
          rating100: s.rating100,
          cover_image: `data:image/jpeg;base64,${(await readFile(join(dir, 'covers', `${slug(s.title)}.jpg`))).toString('base64')}`,
          studio_id: studios[s.studio],
          performer_ids: s.cast.map((name) => performers[name]),
          tag_ids: s.tags.map((name) => tags[name]),
        },
      },
    )
    if (!s.plays.length) continue
    await gql(
      `mutation ($id: ID!, $times: [Timestamp!], $resume: Float, $duration: Float) {
        sceneAddPlay(id: $id, times: $times) { count }
        sceneSaveActivity(id: $id, resume_time: $resume, playDuration: $duration) }`,
      { id, times: times(s.plays), resume: s.resume, duration: s.duration },
    )
    if (s.os.length)
      await gql(
        'mutation ($id: ID!, $times: [Timestamp!]) { sceneAddO(id: $id, times: $times) { count } }',
        { id, times: times(s.os) },
      )
  }

  // Cherry Pick as the build packs it, without a plugin source
  const plugins = join(config, 'plugins', 'candyboudoir', 'CherryPick')
  await mkdir(plugins, { recursive: true })
  await cp(join(site, 'CherryPick'), plugins, { recursive: true })
  await gql('mutation { reloadPlugins }')
  return { scenes, performers, studios, tags }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2)
  if (command === 'media' && dir) await prepareMedia(resolve(dir))
  else if (command === 'seed' && dir && process.env.WORK) {
    const { gql } = await import('../../../../tests/stash/helpers.mjs')
    const ids = await seedBlenderLibrary(gql, {
      dir: resolve(dir),
      work: resolve(process.env.WORK),
      site: resolve(process.env.SITE ?? 'dist/site'),
    })
    const scenes = plan()
    console.log(
      `Seeded ${Object.keys(ids.scenes).length} scenes (${scenes.filter((s) => s.rating100).length} rated, ${scenes.filter((s) => s.plays.length).length} played), ${Object.keys(ids.performers).length} performers, ${Object.keys(ids.studios).length} studios and ${Object.keys(ids.tags).length} tags`,
    )
  } else {
    console.error(
      'Usage: node blender-library.mjs media <dir> | WORK=<stash work dir> node blender-library.mjs seed <dir>',
    )
    process.exitCode = 1
  }
}
