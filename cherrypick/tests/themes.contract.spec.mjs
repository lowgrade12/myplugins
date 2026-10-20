// Cherry Pick under each CandyBoudoir theme, and at phone width. Cherry Pick
// draws with Stash's own components and classes, so a theme restyles it:
// these check that its pieces still render, take the theme's look and raise
// no page errors with each theme enabled beside it.
import { expect, test } from '@playwright/test'
import { listPlugins } from '../../../scripts/site.mjs'
import {
  forYouCards,
  setUpCherryPick,
  tearDownCherryPick,
  usePlugins,
} from './stash.mjs'

let demo
test.beforeAll(async () => {
  ;({ demo } = await setUpCherryPick())
})
test.afterAll(async () => {
  await tearDownCherryPick()
  await usePlugins('CherryPick')
})

// Every CandyBoudoir theme (`kind = 'theme'` in its plugin.mjs) except the
// incubating ones, so a theme still being built cannot hold back a Cherry
// Pick release
const themes = (await listPlugins())
  .filter(({ mod }) => mod.kind === 'theme' && !mod.incubating)
  .map(({ mod }) => mod.id)

const unratedPlayed = (ids) =>
  ids.scenes['Bright Street'] ?? Object.values(ids.scenes)[0]

for (const theme of themes) {
  test(`with ${theme}: the rows, badges and scene line render in the theme`, async ({
    page,
  }) => {
    await usePlugins('CherryPick', theme)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
    // The row's heading is Stash's, so it takes the theme's font.
    const fonts = await page.evaluate(() => {
      const ours = document.querySelector('.cherrypick-for-you h2')
      const stash = document.querySelector(
        '.recommendations-container:not(.cherrypick-front) .recommendation-row h2',
      )
      return [ours, stash].map((el) => el && getComputedStyle(el).fontFamily)
    })
    expect(fonts[0]).toBeTruthy()
    expect(fonts[0]).toBe(fonts[1])
    await page.goto('/scenes?sortby=title&perPage=120')
    await expect(page.locator('.cherrypick-score-banner').first()).toBeVisible({
      timeout: 20_000,
    })
    await page.goto(`/scenes/${unratedPlayed(demo)}`)
    await expect(
      page.locator('.scene-toolbar .cherrypick-score-line').first(),
    ).toBeAttached({ timeout: 20_000 })
    expect(errors).toEqual([])
  })
}

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  test('For you and a bracket fit a phone screen', async ({ page }) => {
    await usePlugins('CherryPick')
    await page.goto('/')
    await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
    expect(await overflow()).toBe(0)
    await page.goto('/performers')
    const bracket = page
      .locator('.cherrypick-bracket-button')
      .filter({ visible: true })
      .first()
    await expect(bracket).toBeVisible({ timeout: 20_000 })
    await bracket.click()
    const dialog = page.locator('.cherrypick-play-modal .modal-content')
    await expect(dialog).toBeVisible()
    const box = await dialog.boundingBox()
    expect(box.width).toBeGreaterThan(380)
    expect(await overflow()).toBe(0)
  })
})
