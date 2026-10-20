// Checks Cherry Pick on performer pages and cards and in its Settings entry:
// the For you line, crowns and medals, and the remembered bracket gender.
import { expect, test } from '@playwright/test'
import {
  PLUGIN_ID,
  pluginConfig,
  setPluginSettings,
  setUpCherryPick,
  tearDownCherryPick,
} from './stash.mjs'

let demo
test.beforeAll(async () => {
  ;({ demo } = await setUpCherryPick())
})
test.afterAll(tearDownCherryPick)

// A finished 16-performer bracket, as the plugin stores it: its champion and
// finalist get a crown and a medal.
function finishedBracket(champion, finalist) {
  return {
    id: 'btest',
    kind: 'performer',
    gender: 'FEMALE',
    poolLabel: 'Female',
    size: 16,
    champions: false,
    seeds: [],
    decisions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:20:00.000Z',
    status: 'done',
    result: {
      champion,
      finalist,
      semifinalists: [],
      quarterfinalists: [],
    },
  }
}

test('the performer page shows the For you line', async ({ page }) => {
  const id = demo.performers['Bea Lark']
  await page.goto(`/performers/${id}`)
  const line = page.locator('.detail-group div.cherrypick-performer-line')
  await expect(line).toBeVisible({ timeout: 20_000 })
  await expect(line).toContainText(/on her scenes/)
})

test('champions get a crown and finalists a medal', async ({ page }) => {
  const champion = demo.performers['Bea Lark']
  const finalist = demo.performers['Juno Marsh']
  const before = await pluginConfig()
  await setPluginSettings(PLUGIN_ID, {
    ...before,
    hallOfFame: JSON.stringify([finishedBracket(champion, finalist)]),
  })
  await page.goto('/performers?sortby=name')
  const card = (id) =>
    page.locator(`.performer-card:has(a[href="/performers/${id}"])`)
  await expect(card(champion).locator('.cherrypick-honours')).toBeVisible({
    timeout: 20_000,
  })
  await expect(
    card(champion).locator(
      '.cherrypick-honours .fa-crown, .cherrypick-honours svg',
    ),
  ).toBeAttached()
  await expect(card(finalist).locator('.cherrypick-honours')).toBeVisible()
  // The front page's Hall of Fame row lists the champion.
  await page.goto('/')
  await expect(
    page.locator(
      `.cherrypick-row-hall-of-fame .performer-card:has(a[href="/performers/${champion}"])`,
    ),
  ).not.toHaveCount(0, { timeout: 20_000 })
})

test('Settings › Plugins offers to forget the remembered gender', async ({
  page,
}) => {
  const before = await pluginConfig()
  await setPluginSettings(PLUGIN_ID, {
    ...before,
    bracketPrefs: JSON.stringify({ gender: 'MALE', pool: 'library' }),
  })
  await page.goto('/settings?tab=plugins')
  const extras = page.locator('.plugin-settings', { hasText: 'Bracket gender' })
  await expect(extras).toBeAttached({ timeout: 20_000 })
  await expect(extras).toContainText('Male')
})
