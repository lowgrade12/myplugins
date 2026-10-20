// The browser's copy of the library takes in what changed in Stash since it
// was read: a rating set on Stash's own pages and a play, without a full
// read. Every leg runs it; the `tz` leg starts Stash's server at UTC-7
// (STASH_TZ in tests/stash/stash.sh), where Stash's own updated_at filter
// compares a UTC time with the server's local time and missed seven hours
// of edits.
import { expect, test } from '@playwright/test'
import {
  demoScene,
  forYouCards,
  gql,
  setUpCherryPick,
  tearDownCherryPick,
} from './stash.mjs'

let demo
test.beforeAll(async () => {
  ;({ demo } = await setUpCherryPick())
})
test.afterAll(tearDownCherryPick)

// The library copy in IndexedDB (storage/tier3.js), read or changed in the
// page
const readCopy = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('cherrypick')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const req = open.result
            .transaction('cache', 'readonly')
            .objectStore('cache')
            .get('library')
          req.onsuccess = () => resolve(req.result ?? null)
          req.onerror = () => reject(req.error)
        }
      }),
  )
const ageCopy = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('cherrypick')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const store = open.result
            .transaction('cache', 'readwrite')
            .objectStore('cache')
          const req = store.get('library')
          req.onsuccess = () => {
            const lib = req.result
            lib.syncedAt = new Date(Date.parse(lib.syncedAt) - ms).toISOString()
            const put = store.put(lib, 'library')
            put.onsuccess = () => resolve()
            put.onerror = () => reject(put.error)
          }
          req.onerror = () => reject(req.error)
        }
      }),
    ms,
  )

const sceneIn = (lib, id) => lib?.scenes.find((s) => s.id === id)

test('a rating set and a play in Stash reach the copy at the next visit', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: 1 }) { scenes { updated_at } } }',
  )
  test.info().annotations.push({
    type: "Stash's zone",
    description: findScenes.scenes[0].updated_at.slice(19) || 'Z',
  })

  await page.goto('/')
  await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => readCopy(page)).not.toBeNull()
  const before = await readCopy(page)

  const rated = demoScene(demo, { rated: true, played: false })
  const unplayed = demoScene(demo, { rated: false, played: false })
  const was = sceneIn(before, rated).rating100
  const now = was === 20 ? 40 : 20
  await gql(
    'mutation ($id: ID!, $r: Int) { sceneUpdate(input: { id: $id, rating100: $r }) { id } }',
    { id: rated, r: now },
  )
  await gql('mutation ($id: ID!) { sceneAddPlay(id: $id) { count } }', {
    id: unplayed,
  })
  expect(sceneIn(before, unplayed).play_count).toBe(0)

  // Three minutes on, a visit updates the copy (REFRESH_MS is two)
  await ageCopy(page, 3 * 60_000)
  await page.reload()
  await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => sceneIn(await readCopy(page), rated)?.rating100, {
      timeout: 15_000,
    })
    .toBe(now)
  const after = await readCopy(page)
  expect(sceneIn(after, unplayed).play_count).toBe(1)
  // an update, not a full read
  expect(after.fullAt).toBe(before.fullAt)
  expect(after.syncedAt).not.toBe(before.syncedAt)
  expect(errors).toEqual([])
})
