// @ts-check
// Cherry Pick's StashDB layer against the mock stash-box
// (tests/stash/stashbox.mjs): the Connect StashDB dialog, "Not in your
// library" on a performer page, More like this's row of scenes you don't
// have, the plugin page's StashDB section and the cache.
//
// How the tests reach the mock. Cherry Pick treats only stashdb.org as
// StashDB, and its manifest lets the browser reach https://stashdb.org and
// nothing else, so the plugin these tests install is the one users get. The
// tests move the traffic instead:
//   - the browser's requests to https://stashdb.org/graphql, which Stash's
//     real CSP lets through, are answered from the mock by Playwright
//     (context.route; Playwright answers the CORS preflight of a routed
//     request itself);
//   - the one call Stash's server makes, validateStashBoxCredentials from
//     the dialog, has its endpoint swapped for the mock's on its way to
//     Stash, so Stash validates against the mock and then stores
//     https://stashdb.org/graphql, as it would for a user;
//   - in Chromium, the test browser cannot resolve stashdb.org
//     (--host-resolver-rules), so a request the routes missed fails instead
//     of reaching StashDB. Firefox and WebKit have no such switch (Linux
//     WebKit refuses to launch with it); there, the routes' catch-all, which
//     aborts every other stashdb.org request, is the only guard.
// Nothing ships for the tests: no localhost CSP entry, no hidden switch.
//
// The tests add their own performer, studio and three scenes linked to the
// mock's StashDB catalogue, set the stash-boxes and Cherry Pick's
// configuration as they need, and put everything back afterwards, so the
// themes' screenshots never see them.
import { expect, test } from '@playwright/test'
import { gql, STASH, usePlugins } from '../../../tests/stash/helpers.mjs'
import {
  ENDPOINT as MOCK,
  STASHDB as CATALOGUE,
} from '../../../tests/stash/stashbox-data.mjs'

const STASHDB = 'https://stashdb.org/graphql'
const MARK = "Invented for Cherry Pick's StashDB tests."
const KEY = 'candy-stashdb-key'
const PERFORMER = { name: 'Caramel Coco', stashId: 'sdb-p-coco' }
const STUDIO = 'Fudge Factory'
// Three of her scenes the library owns
const OWNED = ['Gumball Garden', 'Wafer Way', 'Brittle Bridge']

const sceneId = (title) => CATALOGUE.scenes.find((s) => s.title === title).id
// Her scenes on StashDB, most popular first, as the mock orders them
const HERS = CATALOGUE.scenes
  .filter((s) => s.performers.some((p) => p.performer.id === PERFORMER.stashId))
  .sort((a, b) => b.popularity - a.popularity)
const MISSING = HERS.filter((s) => !OWNED.includes(s.title))

test.use({
  launchOptions: [
    async ({ browserName }, use) =>
      use(
        browserName === 'chromium'
          ? {
              args: [
                '--host-resolver-rules=MAP stashdb.org ~NOTFOUND, MAP *.stashdb.org ~NOTFOUND',
              ],
            }
          : {},
      ),
    { scope: 'worker' },
  ],
})
test.describe.configure({ mode: 'serial' })

// ------------------------------------------------------------ the routes

/** @type {{ query: string, variables: object, apiKey: string }[]} */
let toStashdb = []
// While set, StashDB's answers wait for it.
let hold = null

async function routeStashdb(context) {
  // Anything else on stashdb.org (the dialog's links): refused.
  await context.route(/^https:\/\/([\w-]+\.)?stashdb\.org\//, (route) =>
    route.abort(),
  )
  // Cherry Pick's lookups: answered by the mock.
  await context.route(STASHDB, async (route) => {
    const request = route.request()
    toStashdb.push({
      ...request.postDataJSON(),
      apiKey: request.headers()['apikey'],
    })
    await hold
    const response = await route.fetch({ url: MOCK })
    await route.fulfill({ response })
  })
  // Stash's own call to check a key: sent to the mock.
  await context.route(`${STASH}/graphql`, async (route) => {
    const body = route.request().postData() || ''
    if (body.includes('validateStashBoxCredentials'))
      return route.continue({ postData: body.replaceAll(STASHDB, MOCK) })
    return route.fallback()
  })
}

const lookups = (kind) =>
  toStashdb.filter((r) =>
    kind === 'list'
      ? r.query.includes('queryScenes')
      : r.query.includes('findScene'),
  )

// ------------------------------------------------------------ setup

let saved = { boxes: [], plugin: null }
let ids = { performer: '', studio: '', scenes: {} }

async function stashBoxes() {
  const { configuration } = await gql(`{ configuration { general {
    stashBoxes { endpoint api_key name max_requests_per_minute } } } }`)
  return configuration.general.stashBoxes
}
const setStashBoxes = (boxes) =>
  gql(
    `mutation ($b: [StashBoxInput!]) {
      configureGeneral(input: { stashBoxes: $b }) { stashBoxes { endpoint } } }`,
    { b: boxes },
  )
const pluginMap = async () =>
  (await gql('{ configuration { plugins } }')).configuration.plugins
    ?.CherryPick ?? null
const setPluginMap = (map) =>
  gql(
    'mutation ($i: Map!) { configurePlugin(plugin_id: "CherryPick", input: $i) }',
    { i: map },
  )

async function removeRecords() {
  const like = { value: MARK, modifier: 'EQUALS' }
  const { findScenes, findPerformers, findStudios } = await gql(
    `query ($like: StringCriterionInput) {
      findScenes(filter: { per_page: -1 }, scene_filter: { details: $like }) { scenes { id } }
      findPerformers(filter: { per_page: -1 }, performer_filter: { details: $like }) { performers { id } }
      findStudios(filter: { per_page: -1 }, studio_filter: { details: $like }) { studios { id } }
    }`,
    { like },
  )
  const list = (xs) => xs.map((x) => x.id)
  if (findScenes.scenes.length)
    await gql(
      'mutation ($i: ScenesDestroyInput!) { scenesDestroy(input: $i) }',
      {
        i: {
          ids: list(findScenes.scenes),
          delete_file: false,
          delete_generated: true,
        },
      },
    )
  if (findPerformers.performers.length)
    await gql('mutation ($ids: [ID!]!) { performersDestroy(ids: $ids) }', {
      ids: list(findPerformers.performers),
    })
  if (findStudios.studios.length)
    await gql('mutation ($ids: [ID!]!) { studiosDestroy(ids: $ids) }', {
      ids: list(findStudios.studios),
    })
}

const create = async (kind, input) =>
  (
    await gql(
      `mutation ($i: ${kind}CreateInput!) { ${kind.toLowerCase()}Create(input: $i) { id } }`,
      { i: input },
    )
  )[`${kind.toLowerCase()}Create`].id

test.beforeAll(async () => {
  await usePlugins('CherryPick')
  saved = { boxes: await stashBoxes(), plugin: await pluginMap() }
  // Cherry Pick as just installed: no consent yet.
  await setPluginMap({})
  await removeRecords()
  ids.studio = await create('Studio', { name: STUDIO, details: MARK })
  ids.performer = await create('Performer', {
    name: PERFORMER.name,
    gender: 'FEMALE',
    details: MARK,
    stash_ids: [{ endpoint: STASHDB, stash_id: PERFORMER.stashId }],
  })
  for (const [n, title] of OWNED.entries())
    ids.scenes[title] = await create('Scene', {
      title,
      details: MARK,
      date: `2025-0${n + 1}-01`,
      rating100: 80,
      studio_id: ids.studio,
      performer_ids: [ids.performer],
      stash_ids: [{ endpoint: STASHDB, stash_id: sceneId(title) }],
    })
})

test.afterAll(async () => {
  await removeRecords()
  await setStashBoxes(saved.boxes)
  await setPluginMap(saved.plugin ?? {})
})

test.beforeEach(async ({ context }) => {
  toStashdb = []
  hold = null
  await routeStashdb(context)
})

// Cherry Pick's cached answer for a lookup, in the browser's IndexedDB.
// olderBy: make it that much older first, in the format 0.1.6 kept (no v).
const cacheEntry = (page, key, olderBy = 0) =>
  page.evaluate(
    ([key, olderBy]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('cherrypick')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const store = open.result
            .transaction('cache', 'readwrite')
            .objectStore('cache')
          const get = store.get(key)
          get.onsuccess = () => {
            const entry = get.result
            if (!olderBy || !entry) return resolve(entry)
            const aged = { at: entry.at - olderBy, data: entry.data }
            store.put(aged, key).onsuccess = () => resolve(aged)
          }
        }
      }),
    [key, olderBy],
  )

const section = (page) => page.locator('.cherrypick-not-in-library')
const cards = (page) => section(page).locator('.cherrypick-missing')

// ------------------------------------------------------------ the tests

test('without a key, the connect line stands where the scenes would be', async ({
  page,
}) => {
  await page.goto(`/performers/${ids.performer}`)
  await expect(section(page).locator('.cherrypick-connect-line')).toContainText(
    "Connect StashDB to see what you're missing.",
  )
  expect(toStashdb).toEqual([])
})

test('the dialog shows a refused key, then saves a good one beside the other stash-boxes', async ({
  page,
}) => {
  await page.goto(`/performers/${ids.performer}`)
  await section(page).getByRole('button', { name: 'Connect StashDB' }).click()
  const dialog = page.locator('.modal.cherrypick-connect')
  await expect(dialog.locator('.modal-title')).toHaveText('Connect StashDB')
  const guidelines = dialog.getByRole('link', { name: /StashDB guidelines/ })
  await expect(guidelines).toHaveAttribute(
    'href',
    'https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/',
  )
  await expect(guidelines).toHaveAttribute('target', '_blank')
  await expect(
    dialog.getByRole('link', { name: /Register on StashDB/ }),
  ).toHaveAttribute('href', 'https://stashdb.org/register')

  await dialog.getByRole('button', { name: 'I have a key' }).click()
  const input = dialog.getByLabel('StashDB API key')
  await input.fill('invalid-key')
  await dialog.getByRole('button', { name: 'Validate' }).click()
  await expect(dialog.locator('.cherrypick-key-problem')).toHaveText(
    'Invalid or expired API key.',
  )
  expect(await stashBoxes()).toHaveLength(saved.boxes.length)

  await input.fill(KEY)
  await dialog.getByRole('button', { name: 'Validate' }).click()
  await expect(dialog).toContainText('Added StashDB to your Stash settings.')
  const boxes = await stashBoxes()
  // Every other stash-box as Stash reported it before. (Stash itself
  // reports a request limit of 0 for every box: its configuration stores
  // the limit under a key it does not read back.)
  expect(boxes.slice(0, -1)).toEqual(saved.boxes)
  expect(boxes.at(-1)).toMatchObject({
    endpoint: STASHDB,
    api_key: KEY,
    name: 'StashDB',
  })
  await dialog.getByRole('button', { name: 'Done' }).click()

  // Lookups start at once, for this page only.
  await expect(cards(page)).toHaveCount(12)
  expect(lookups('list')).toHaveLength(1)
  expect(toStashdb[0].apiKey).toBe(KEY)
  expect(toStashdb[0].variables.input).toMatchObject({
    performers: { value: [PERFORMER.stashId], modifier: 'INCLUDES' },
    sort: 'POPULARITY',
  })
  // Consent, with its date, in Cherry Pick's configuration
  await expect
    .poll(async () => JSON.parse((await pluginMap())?.consent || 'null'))
    .toMatchObject({ stashdb: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) })
})

test("a linked performer's scenes you don't have, most popular first; the second visit asks StashDB nothing", async ({
  page,
}) => {
  await page.goto(`/performers/${ids.performer}`)
  await expect(cards(page)).toHaveCount(12)
  await expect(cards(page).locator('.card-section-title')).toHaveText(
    MISSING.slice(0, 12).map((s) => s.title),
  )
  const first = cards(page).first()
  const rank = HERS.indexOf(MISSING[0]) + 1
  await expect(first.locator('.cherrypick-reason')).toHaveText(
    new RegExp(
      `^#${rank} of her ${HERS.length} scenes on StashDB \\(top \\d+%\\)$`,
    ),
  )
  await expect(first.locator('.cherrypick-missing-badge')).toHaveText(
    'Not in your library',
  )
  await expect(first.locator('.cherrypick-stashdb-link')).toHaveAttribute(
    'href',
    `https://stashdb.org/scenes/${MISSING[0].id}`,
  )
  // the studio's page, without its tracking parameters
  const studioLink = first.locator('.cherrypick-store-link')
  await expect(studioLink).toHaveText('Studio')
  await expect(studioLink).toHaveAttribute(
    'href',
    `https://example.com/scenes/${MISSING[0].id}`,
  )
  // a store's page, named for the store, past the Wayback Machine's copy
  const onStore = MISSING.slice(0, 12).find(
    (s) => s.studio.id === 'sdb-st-toffee',
  )
  const storeLink = cards(page)
    .filter({ hasText: onStore.title })
    .locator('.cherrypick-store-link')
  await expect(storeLink).toHaveText('Candy Clips')
  await expect(storeLink).toHaveAttribute(
    'href',
    `https://clips.example/clip/${onStore.id}`,
  )
  await expect(first.locator('.studio-overlay a')).toHaveAttribute(
    'href',
    `/studios/${ids.studio}`,
  )
  expect(toStashdb).toHaveLength(1)

  // Another page and back, then a reload: the cache answers.
  await page.goto('/scenes')
  await page.goBack()
  await expect(cards(page)).toHaveCount(12)
  await page.reload()
  await expect(cards(page)).toHaveCount(12)
  expect(toStashdb).toHaveLength(1)
})

test('an answer over a week old shows at once, and StashDB is asked again behind it', async ({
  page,
}) => {
  const key = `stashdb:performer-scenes:${PERFORMER.stashId}`
  await page.goto(`/performers/${ids.performer}`)
  await expect(cards(page)).toHaveCount(12)
  expect(toStashdb).toHaveLength(1)
  // eight days old, and kept in 0.1.6's format
  const aged = await cacheEntry(page, key, 8 * 24 * 3600 * 1000)
  // StashDB answers nothing until released
  let release
  hold = new Promise((r) => (release = r))
  await page.reload()
  await expect(cards(page)).toHaveCount(12)
  await expect.poll(() => toStashdb.length).toBe(2)
  expect(lookups('list')).toHaveLength(2)
  await expect(cards(page)).toHaveCount(12)
  release()
  await expect
    .poll(async () => (await cacheEntry(page, key))?.at > aged.at)
    .toBe(true)
  expect((await cacheEntry(page, key)).v).toBe(2)
  // fresh again: the next visit asks nothing
  await page.reload()
  await expect(cards(page)).toHaveCount(12)
  expect(toStashdb).toHaveLength(2)
})

test('Not interested takes a card out', async ({ page }) => {
  await page.goto(`/performers/${ids.performer}`)
  await expect(cards(page)).toHaveCount(12)
  const first = cards(page).first()
  await first.locator('.cherrypick-card-menu').getByTitle('More').click()
  await page.locator('.cherrypick-ni').click()
  await expect(cards(page).first().locator('.card-section-title')).toHaveText(
    MISSING[1].title,
  )
  // Undo, on the plugin page (through the navbar, so nothing reloads)
  await page.locator('.cherrypick-nav-icon').filter({ visible: true }).click()
  await page
    .locator('#not-interested .setting', { hasText: MISSING[0].title })
    .getByRole('button', { name: 'Undo' })
    .click()
  await expect(page.locator('#not-interested')).toContainText('Nothing hidden')
  await expect
    .poll(async () => JSON.parse((await pluginMap())?.notInterested || '[]'))
    .toEqual([])
})

test("More like this on an owned scene: a row of StashDB scenes you don't have", async ({
  page,
}) => {
  await page.goto(`/scenes/${ids.scenes[OWNED[0]]}`)
  const row = page.locator('.cherrypick-mlt-missing')
  await expect(row.locator('.cherrypick-missing').first()).toBeVisible()
  await expect(row.locator('.cherrypick-missing-badge').first()).toHaveText(
    'Not in your library',
  )
  // the scene itself, her list and the studio's: three requests
  expect(lookups('scene')).toHaveLength(1)
  expect(lookups('list')).toHaveLength(2)
})

test('the plugin page: connected, the cache, and clearing it', async ({
  page,
}) => {
  await page.goto(`/performers/${ids.performer}`)
  await expect(cards(page)).toHaveCount(12)
  await page.goto('/plugins/cherrypick#stashdb')
  const box = page.locator('#stashdb')
  await expect(box).toContainText('Connected')
  await expect(box).toContainText(
    '1 lookup, the oldest from today. Lookups are kept in this browser for 30 days, and asked for again in the background after 7.',
  )
  await box.getByRole('button', { name: 'Clear StashDB cache' }).click()
  await expect(box).toContainText('Nothing looked up yet.')
})

test('a key already in Stash is used without asking; Stop using StashDB turns the lookups off', async ({
  page,
}) => {
  // As on a Stash that had the key before Cherry Pick: nothing recorded.
  await setPluginMap({
    ...(await pluginMap()),
    consent: JSON.stringify({ stashdb: null }),
  })
  await page.goto(`/performers/${ids.performer}`)
  await expect(cards(page)).toHaveCount(12)

  await page.goto('/plugins/cherrypick#stashdb')
  const box = page.locator('#stashdb')
  await box.getByRole('button', { name: 'Stop using StashDB' }).click()
  await expect(box).toContainText('Off')
  await expect
    .poll(async () => JSON.parse((await pluginMap())?.consent || 'null'))
    .toMatchObject({ stashdbOff: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) })

  toStashdb = []
  await page.goto(`/performers/${ids.performer}`)
  const line = section(page).locator('.cherrypick-connect-line')
  await expect(line).toContainText('StashDB lookups are off')
  await expect(cards(page)).toHaveCount(0)
  expect(toStashdb).toEqual([])

  await line.getByRole('button', { name: 'Use StashDB' }).click()
  await expect(cards(page)).toHaveCount(12)
  await expect
    .poll(async () => JSON.parse((await pluginMap())?.consent || 'null'))
    .toMatchObject({ stashdbOff: null })
})

test('with "Show scenes you don\'t have" off, nothing shows and nothing is asked', async ({
  page,
}) => {
  const map = await pluginMap()
  await setPluginMap({ ...map, outOfLibrary: false })
  try {
    await page.goto(`/performers/${ids.performer}`)
    await page.locator('.scene-card').first().waitFor()
    // Cherry Pick has loaded its settings when its rows' pieces show
    await expect(page.locator('.cherrypick-nav-icon').first()).toBeAttached()
    await page.waitForTimeout(1500)
    await expect(section(page)).toHaveCount(0)
    expect(lookups('list')).toEqual([])
  } finally {
    await setPluginMap({ ...(await pluginMap()), outOfLibrary: true })
  }
})
