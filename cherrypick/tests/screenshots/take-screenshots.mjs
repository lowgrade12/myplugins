// Takes the README's screenshots (docs/screenshots/) on a throwaway Stash
// that blender-library.mjs seeded, in one browser profile, in the order a
// user would get there: a performer bracket won in its Challenge round
// first, so the front page has a Hall of Fame and the champion's page says
// she beat your favorites. StashDB's answers for the not-in-library shot
// come from MISSING below, with covers cut from the films.
//
// Usage: STASH_URL=http://127.0.0.1:<port> node plugins/cherrypick/tests/screenshots/take-screenshots.mjs <media dir> <out dir> [name,...]
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { gql, STASH } from '../../../../tests/stash/helpers.mjs'
import { plan, STASHDB_COVERS } from './blender-library.mjs'

const [media, out, only] = process.argv.slice(2)
if (!media || !out) {
  console.error('Usage: take-screenshots.mjs <media dir> <out dir> [name,...]')
  process.exit(1)
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(STASH))
  throw new Error('STASH_URL must be a throwaway Stash on this machine')
const want = (name) => !only || only.split(',').includes(name)

// Who wins a performer match: these, in this order, then the rest, so the
// champion screen shows characters from different films. The bracket shot
// is the first match PREFER[1] plays.
const PREFER = ['Marlowe Finch', 'Rosa Petley', 'Pippa Coleby', 'Nell Burrows']
const rank = (name) => {
  const i = PREFER.indexOf(name)
  return i < 0 ? PREFER.length : i
}

// The scene and performer pages shown
const SCENE = 'The Big Wings'
const CHAMPION = PREFER[0]

// The scene-bracket shot is the first match between scenes of two films.
const filmOf = Object.fromEntries(plan().map((s) => [s.title, s.film]))

// StashDB's answers for the not-in-library shot: one performer, three of
// her scenes the library owns and the rest it lacks, [title, users holding
// it, studio]. The covers are STASHDB_COVERS, cut by blender-library.mjs.
const STASHDB = 'https://stashdb.org/graphql'
const IMAGES = 'https://cdn.stashdb.org/images'
const SDB_PERFORMER = { name: 'June Quill', id: 'sdb-p-june' }
const OWNED = ['Wings at Dusk', 'The Big Wings', 'Over the Old City']
const SDB_STUDIOS = {
  'Ember Row': { id: 'sdb-st-ember', name: 'Ember Row', parent: null },
  Kiteworks: { id: 'sdb-st-kite', name: 'Kiteworks', parent: null },
}
const MISSING = [
  ['Lantern Night', 860, 'Ember Row'],
  ['Wings at Dusk', 720, 'Ember Row'],
  ['Kites over the Meadow', 640, 'Kiteworks'],
  ['The Bell Steeple', 590, 'Ember Row'],
  ['The Big Wings', 540, 'Ember Row'],
  ['Sparrow Market', 480, 'Ember Row'],
  ['Morning Errands', 410, 'Kiteworks'],
  ['Tiles and Chimneys', 350, 'Ember Row'],
  ['A Map of the Hills', 300, 'Kiteworks'],
  ['Over the Old City', 260, 'Ember Row'],
  ['The Long Way Home', 210, 'Kiteworks'],
  ['Clover Fields', 150, 'Kiteworks'],
  ['Evening Bells', 90, 'Ember Row'],
  ['Snow on the Steps', 40, 'Ember Row'],
  ['First Frost', 15, 'Kiteworks'],
]
const sdbScenes = MISSING.map(([title, popularity, studio], i) => ({
  id: `sdb-s-${title.toLowerCase().replace(/\W+/g, '-')}`,
  title,
  release_date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(10 + i).padStart(2, '0')}`,
  duration: 600 + i * 37,
  images: [
    {
      url: `${IMAGES}/${i % STASHDB_COVERS.length}.jpg`,
      width: 640,
      height: 360,
    },
  ],
  studio: SDB_STUDIOS[studio],
  performers: [
    {
      performer: {
        id: SDB_PERFORMER.id,
        name: SDB_PERFORMER.name,
        disambiguation: null,
        gender: 'FEMALE',
      },
    },
  ],
  tags: [],
  urls: [
    {
      url: `https://example.com/scenes/${title.toLowerCase().replace(/\W+/g, '-')}`,
      site: { name: 'Studio' },
    },
  ],
  fingerprints: [{ algorithm: 'OSHASH', submissions: popularity }],
  popularity,
}))

// queryScenes in popularity order and findScene by id, as Cherry Pick asks
// (tests/stash/stashbox.mjs answers the same for the compatibility tests).
function answer({ query, variables }) {
  const data = {}
  for (const [, alias, name, arg] of query.matchAll(
    /(?:(\w+)\s*:\s*)?\b(findScene|queryScenes)\s*\(\s*\w+\s*:\s*\$(\w+)\s*\)/g,
  )) {
    const value = variables[arg]
    const strip = (scene) =>
      Object.fromEntries(
        Object.entries(scene).filter(([k]) => k !== 'popularity'),
      )
    if (name === 'queryScenes') {
      const hers = value?.performers?.value?.includes(SDB_PERFORMER.id)
      const list = hers
        ? [...sdbScenes].sort((a, b) => b.popularity - a.popularity)
        : []
      data[alias ?? name] = { count: list.length, scenes: list.map(strip) }
    } else {
      const scene = sdbScenes.find((s) => s.id === value)
      data[alias ?? name] = scene ? strip(scene) : null
    }
  }
  return { data }
}

async function routeStashdb(context) {
  await context.route(/^https:\/\/([\w-]+\.)?stashdb\.org\//, (route) =>
    route.abort(),
  )
  await context.route(STASHDB, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          json: answer(route.request().postDataJSON()),
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
  )
  await context.route(`${IMAGES}/*`, async (route) => {
    const n = /(\d+)\.jpg$/.exec(route.request().url())[1]
    await route.fulfill({
      body: await readFile(join(media, 'stills', `stashdb-${n}.jpg`)),
      contentType: 'image/jpeg',
    })
  })
}

async function idOf(kind, name) {
  const d =
    kind === 'scene'
      ? await gql(
          'query ($n: String!) { findScenes(scene_filter: { title: { value: $n, modifier: EQUALS } }) { scenes { id } } }',
          { n: name },
        )
      : await gql(
          'query ($n: String!) { findPerformers(performer_filter: { name: { value: $n, modifier: EQUALS } }) { performers { id } } }',
          { n: name },
        )
  return (
    kind === 'scene' ? d.findScenes.scenes : d.findPerformers.performers
  )[0].id
}

// Waits for the network and for every image in view, then a moment more.
async function settle(page) {
  await page
    .waitForLoadState('networkidle', { timeout: 10_000 })
    .catch(() => {})
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        [...document.images]
          .filter((i) => {
            const r = i.getBoundingClientRect()
            return !i.complete && r.bottom > 0 && r.top < innerHeight
          })
          .map((i) => new Promise((r) => ((i.onload = r), (i.onerror = r)))),
      ),
      new Promise((r) => setTimeout(r, 10_000)),
    ]),
  )
  await page.waitForTimeout(800)
}

async function shot(page, name, { mouse = true } = {}) {
  const { width, height } = page.viewportSize()
  if (mouse) await page.mouse.move(width - 1, height - 1)
  await settle(page)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log('took', name)
}

const visible = (l) => l.filter({ visible: true }).first()
const titles = (modal) =>
  modal.locator('.cherrypick-contender .cherrypick-cont-title').allInnerTexts()

const browser = await chromium.launch({
  args: [
    '--host-resolver-rules=MAP stashdb.org ~NOTFOUND, MAP *.stashdb.org ~NOTFOUND',
  ],
})
const context = await browser.newContext({
  baseURL: STASH,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
await routeStashdb(context)
const page = await context.newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))

await page.goto('/')
await page
  .locator('.cherrypick-for-you .scene-card')
  .first()
  .waitFor({ timeout: 60_000 })

if (want('bracket') || want('champion')) {
  await page.goto('/performers')
  const button = visible(page.locator('.cherrypick-bracket-button'))
  await button.waitFor({ timeout: 30_000 })
  await button.click()
  const play = page.locator('.cherrypick-play-modal')
  await play.getByText('16 performers').first().waitFor()
  let shown = !want('bracket')
  for (let i = 1; i <= 15; i++) {
    await play.locator('.cherrypick-contender').nth(1).waitFor()
    const [left, right] = await titles(play)
    console.log(i, left, 'vs', right)
    if (!shown && [left, right].includes(PREFER[1])) {
      await shot(page, 'bracket')
      shown = true
    }
    await page.keyboard.press(
      rank(right) < rank(left) ? 'ArrowRight' : 'ArrowLeft',
    )
    await page.waitForTimeout(450)
  }
  const result = page.locator('.cherrypick-result-modal')
  const champ = await result.locator('.cherrypick-champ-name').innerText()
  console.log('champion', champ)
  await result.locator('.cherrypick-challenge-start').click()
  const challenge = page.locator('.cherrypick-challenge-modal')
  for (let i = 1; i <= 3; i++) {
    await challenge.getByText(`Favorite ${i} of 3`).waitFor()
    const [left] = await titles(challenge)
    await page.keyboard.press(left === champ ? 'ArrowLeft' : 'ArrowRight')
    await page.waitForTimeout(450)
  }
  await result.locator('.cherrypick-challenge-badge').waitFor()
  if (want('champion')) await shot(page, 'champion')
  console.log(await result.locator('.cherrypick-challenge-outcome').innerText())
  await result.getByRole('button', { name: 'Done', exact: true }).click()
  await page.waitForTimeout(3000)
}

if (want('front')) {
  await page.goto('/')
  await page
    .locator('.cherrypick-for-you .scene-card')
    .first()
    .waitFor({ timeout: 30_000 })
  await shot(page, 'front')
}

if (want('phone')) {
  const phone = await browser.newContext({
    baseURL: STASH,
    viewport: { width: 390, height: 664 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })
  const p = await phone.newPage()
  await p.goto('/')
  await p
    .locator('.cherrypick-for-you .scene-card')
    .first()
    .waitFor({ timeout: 60_000 })
  await settle(p)
  await p.screenshot({ path: join(out, 'phone.png') })
  console.log('took phone')
  await phone.close()
}

if (want('scene') || want('more-like-this')) {
  await page.goto(`/scenes/${await idOf('scene', SCENE)}`)
  const line = page.locator('.cherrypick-line-button').first()
  await line.waitFor({ timeout: 30_000 })
  if (want('scene')) {
    await settle(page)
    await line.hover()
    await page.locator('.popover').waitFor()
    await shot(page, 'scene', { mouse: false })
  }
  if (want('more-like-this')) {
    await page.mouse.move(5, 895)
    const row = page.locator('.cherrypick-more-like-this').first()
    await row.locator('.scene-card').first().waitFor()
    await page.evaluate(() => {
      const el = document.querySelector('.cherrypick-more-like-this')
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 370)
    })
    await shot(page, 'more-like-this')
  }
}

if (want('performer')) {
  await page.goto(`/performers/${await idOf('performer', CHAMPION)}`)
  await visible(page.locator('.cherrypick-performer-line')).waitFor({
    timeout: 30_000,
  })
  await shot(page, 'performer')
}

if (want('performers')) {
  await page.goto('/performers')
  await visible(page.locator('.cherrypick-bracket-button')).waitFor({
    timeout: 30_000,
  })
  await shot(page, 'performers')
}

if (want('plugin-page')) {
  await page.goto('/plugins/cherrypick')
  await page.locator('#your-score').waitFor({ timeout: 30_000 })
  await page.getByText('Hall of Fame').first().waitFor()
  await shot(page, 'plugin-page')
  console.log((await page.locator('#your-score').innerText()).slice(0, 400))
}

if (want('settings')) {
  await page.goto('/settings?tab=plugins')
  await page.getByText('Watch This', { exact: true }).first().waitFor({
    timeout: 30_000,
  })
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('h3, h4, h5, h6, div')].find(
      (e) => e.textContent.trim() === 'Watch This',
    )
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 60)
  })
  await shot(page, 'settings')
}

// Watch This on: one scene ready to play where For you was, before play,
// with the mouse off the player and the line. The setting goes back off
// after.
async function setWatchThis(on) {
  const { configuration } = await gql('{ configuration { plugins } }')
  await gql(
    'mutation ($i: Map!) { configurePlugin(plugin_id: "CherryPick", input: $i) }',
    { i: { ...configuration.plugins?.CherryPick, watchThis: on } },
  )
}
if (want('watch-this')) {
  await setWatchThis(true)
  await page.goto('/')
  await page.locator('.cherrypick-watch-title').waitFor({ timeout: 30_000 })
  await page.mouse.move(1050, 24)
  await shot(page, 'watch-this', { mouse: false })
  await setWatchThis(false)
}

if (want('scene-bracket') || want('scene-inspector')) {
  await page.goto('/scenes')
  const button = visible(page.locator('.cherrypick-bracket-button'))
  await button.waitFor({ timeout: 30_000 })
  await button.click()
  const play = page.locator('.cherrypick-play-modal')
  for (let i = 1; ; i++) {
    await play.locator('.cherrypick-judge').nth(1).waitFor()
    const [left, right] = await titles(play)
    if (filmOf[left] !== filmOf[right] || i === 8) break
    await page.waitForTimeout(450)
    await page.keyboard.press('ArrowLeft')
    await play.getByText(`match ${i + 1} of 8`).waitFor()
  }
  await play
    .locator('.cherrypick-sheet .cherrypick-frame-img')
    .first()
    .waitFor({ timeout: 30_000 })
  console.log('scene match:', (await titles(play)).join(' vs '))
  if (want('scene-bracket')) await shot(page, 'scene-bracket')
  if (want('scene-inspector')) {
    await page.keyboard.press('1')
    const inspector = play.locator('.cherrypick-inspector')
    await inspector.waitFor()
    await inspector
      .locator('.cherrypick-insp-grid .cherrypick-frame')
      .nth(6)
      .click()
    await shot(page, 'scene-inspector')
    await page.keyboard.press('Escape')
  }
  await page.keyboard.press('Escape')
}

if (want('not-in-library')) {
  await gql(
    `mutation ($b: [StashBoxInput!]) {
      configureGeneral(input: { stashBoxes: $b }) { stashBoxes { endpoint } } }`,
    { b: [{ name: 'StashDB', endpoint: STASHDB, api_key: 'demo-key' }] },
  )
  const performer = await idOf('performer', SDB_PERFORMER.name)
  await gql(
    'mutation ($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }',
    {
      i: {
        id: performer,
        stash_ids: [{ endpoint: STASHDB, stash_id: SDB_PERFORMER.id }],
      },
    },
  )
  for (const title of OWNED)
    await gql(
      'mutation ($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id } }',
      {
        i: {
          id: await idOf('scene', title),
          stash_ids: [
            {
              endpoint: STASHDB,
              stash_id: sdbScenes.find((s) => s.title === title).id,
            },
          ],
        },
      },
    )
  // A fresh profile: the other one's copy of the library predates the links
  const fresh = await browser.newContext({
    baseURL: STASH,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await routeStashdb(fresh)
  const p = await fresh.newPage()
  await p.goto(`/performers/${performer}`)
  await p
    .locator('.cherrypick-not-in-library .cherrypick-missing')
    .first()
    .waitFor({ timeout: 60_000 })
  await p.evaluate(() => {
    const el = document.querySelector('.cherrypick-not-in-library')
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 110)
  })
  await shot(p, 'not-in-library')
  await fresh.close()
}

await browser.close()
console.log(`Screenshots in ${resolve(out)}`)
