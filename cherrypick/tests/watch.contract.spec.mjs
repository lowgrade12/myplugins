// Watch This: with its setting on, one scene in Stash's own player takes the
// place of Cherry Pick's front-page rows. Checks the setting, the player,
// what Stash records when it plays, Stash's Auto-start video setting, the
// layout at desktop and phone widths, and each CandyBoudoir theme. Stash
// Curator patches ScenePlayer, so its leg runs this file too.
//
// Only the shared demo clips have video, so every pick is one of them. The
// spec plays them, and puts their plays, play time and resume points back
// as they were afterwards, for the themes' screenshots.
import { expect, test } from '@playwright/test'
import { listPlugins } from '../../../scripts/site.mjs'
import {
  PLUGIN_ID,
  forYouCards,
  gql,
  pluginConfig,
  setPluginSettings,
  setUpCherryPick,
  sharedScenes,
  tearDownCherryPick,
  usePlugins,
} from './stash.mjs'

const setWatchThis = async (on) =>
  setPluginSettings(PLUGIN_ID, {
    ...((await pluginConfig()) || {}),
    watchThis: on,
  })

// Watch This's snoozes as Stash keeps them, and none at the start of each
// test
const snoozesIn = (config) => JSON.parse(config?.snoozes || '[]')
async function clearSnoozes() {
  const config = { ...((await pluginConfig()) || {}) }
  delete config.snoozes
  await setPluginSettings(PLUGIN_ID, config)
}

const setAutostart = (on) =>
  gql(
    'mutation ($on: Boolean) { configureInterface(input: { autostartVideo: $on }) { autostartVideo } }',
    { on },
  )

// What Stash keeps of a scene's watching
async function activity(id) {
  const { findScene } = await gql(
    'query ($id: ID!) { findScene(id: $id) { play_count play_duration resume_time play_history } }',
    { id },
  )
  return findScene
}

async function clipsActivity() {
  const clips = await sharedScenes()
  return Promise.all(
    clips.map(async (s) => ({ id: s.id, ...(await activity(s.id)) })),
  )
}

async function restoreActivity(before) {
  for (const b of before) {
    const now = await activity(b.id)
    const added = now.play_history.filter((t) => !b.play_history.includes(t))
    if (added.length)
      await gql(
        'mutation ($id: ID!, $t: [Timestamp!]) { sceneDeletePlay(id: $id, times: $t) { count } }',
        { id: b.id, t: added },
      )
    await gql(
      'mutation ($id: ID!) { sceneResetActivity(id: $id, reset_resume: true, reset_duration: true) }',
      { id: b.id },
    )
    if (b.resume_time || b.play_duration)
      await gql(
        'mutation ($id: ID!, $r: Float, $d: Float) { sceneSaveActivity(id: $id, resume_time: $r, playDuration: $d) }',
        { id: b.id, r: b.resume_time, d: b.play_duration },
      )
  }
}

let clips
let autostart
test.beforeAll(async () => {
  await setUpCherryPick()
  clips = await clipsActivity()
  const { configuration } = await gql(
    '{ configuration { interface { autostartVideo } } }',
  )
  autostart = !!configuration.interface.autostartVideo
  await setAutostart(false)
})
test.beforeEach(clearSnoozes)
test.afterAll(async () => {
  await restoreActivity(clips)
  await setAutostart(autostart)
  await tearDownCherryPick()
  await usePlugins(PLUGIN_ID)
})

const player = (page) => page.locator('.cherrypick-watch-player .video-js')
const line = (page) => page.locator('.cherrypick-watch-line')
// The pick's line, once the player has its scene (the skeleton has a line
// of its own for the progress)
const ready = (page) =>
  expect(page.locator('.cherrypick-watch-title')).toBeVisible({
    timeout: 20_000,
  })
const pickId = async (page) =>
  (await page.locator('.cherrypick-watch-title').getAttribute('href'))
    .split('/')
    .pop()

// Writes of the plugin's map are counted once Stash has answered them
// ('requestfinished'), so a read after the count sees what they wrote.

// The scene in the player, from its source (the line hides during playback)
const playerSceneId = (page) =>
  page
    .locator('.cherrypick-watch-player video')
    .evaluate((v) => v.currentSrc.match(/\/scene\/(\d+)\//)?.[1] ?? null)

// Cherry Pick's pieces a user could see on the page
const visibleOurs = (page) =>
  page.locator('.cherrypick-ui').filter({ visible: true }).count()

test('with Watch This off, the front page is as it was', async ({ page }) => {
  await setWatchThis(false)
  await page.goto('/')
  await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.cherrypick-watch')).toHaveCount(0)
})

test("with Watch This on, one player takes the place of Cherry Pick's rows, above Stash's", async ({
  page,
}) => {
  await setWatchThis(true)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(player(page)).toBeVisible({ timeout: 20_000 })
  await expect(line(page)).toBeVisible()
  await expect(
    page.locator('.cherrypick-watch-player .VideoPlayer'),
  ).toHaveCount(1)
  // No For you, no rows that follow your watching, no Hall of Fame
  await expect(page.locator('.cherrypick-front')).toHaveCount(0)
  await expect(page.locator('.cherrypick-row')).toHaveCount(0)
  // Stash's rows and Customise button follow the player
  const order = await page.evaluate(() => {
    const ours = document.querySelector('.cherrypick-watch')
    const stash = document.querySelector('.recommendations-container')
    return {
      before: !!(
        ours &&
        stash &&
        ours.compareDocumentPosition(stash) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      customise: !!stash?.querySelector('.recommendations-footer .btn'),
    }
  })
  expect(order).toEqual({ before: true, customise: true })
  // The pick is a scene with video, with its performers and a reason
  const clipIds = (await sharedScenes()).map((s) => s.id)
  expect(clipIds).toContain(await pickId(page))
  await expect(page.locator('.cherrypick-watch-performers a')).not.toHaveCount(
    0,
  )
  await expect(page.locator('.cherrypick-watch-reason')).not.toBeEmpty()
  // The rows' switches keep their values for when Watch This goes off
  const config = await pluginConfig()
  expect([
    config.showForYou,
    config.showFollowRows,
    config.showHallOfFame,
  ]).toEqual([true, true, true])
  expect(errors).toEqual([])
})

test('Space plays the pick, Stash records it, the line steps out and the end brings nothing', async ({
  page,
}) => {
  await setWatchThis(true)
  await page.goto('/')
  await ready(page)
  const id = await pickId(page)
  const before = await activity(id)
  // The player takes focus when the scene loads, as on the scene page
  await expect
    .poll(() =>
      page.evaluate(
        () => !!document.activeElement?.closest('.cherrypick-watch-player'),
      ),
    )
    .toBe(true)
  await page.keyboard.press('Space')
  await expect(player(page)).toHaveClass(/vjs-playing/)
  await expect(line(page)).toHaveCount(0)
  await page.waitForTimeout(3500)
  // Paused, Stash saves the play time and resume point and counts the play
  await page.keyboard.press('Space')
  await expect(player(page)).toHaveClass(/vjs-paused/)
  await expect
    .poll(async () => (await activity(id)).play_duration, { timeout: 10_000 })
    .toBeGreaterThan(before.play_duration)
  const paused = await activity(id)
  expect(paused.resume_time).toBeGreaterThan(1)
  expect(paused.play_count).toBe(before.play_count + 1)
  expect(await visibleOurs(page)).toBe(0)
  // To the end: nothing happens, and nothing of Cherry Pick's comes back
  await page.keyboard.press('Space')
  await expect(player(page)).toHaveClass(/vjs-ended/, { timeout: 20_000 })
  await page.waitForTimeout(3000)
  expect(new URL(page.url()).pathname).toBe('/')
  // Still the same scene, stopped at its end
  const video = await page
    .locator('.cherrypick-watch-player video')
    .evaluate((v) => ({ src: v.currentSrc, ended: v.ended }))
  expect(video.ended).toBe(true)
  expect(video.src).toContain(`/scene/${id}/`)
  await expect(page.locator('.modal')).toHaveCount(0)
  expect(await visibleOurs(page)).toBe(0)
  await expect(line(page)).toHaveCount(0)
  // At the end Stash clears the resume point, as on the scene page
  await expect
    .poll(async () => (await activity(id)).resume_time, { timeout: 10_000 })
    .toBe(0)
  expect((await activity(id)).play_count).toBe(before.play_count + 1)
  // Leaving the front page and coming back brings the line back
  await page.goto('/scenes')
  await page.goto('/')
  await ready(page)
})

test("Stash's Auto-start video decides whether the pick starts by itself", async ({
  page,
}) => {
  await setWatchThis(true)
  await setAutostart(true)
  try {
    await page.goto('/')
    await expect(player(page)).toHaveClass(/vjs-playing/, { timeout: 20_000 })
    await expect(line(page)).toHaveCount(0)
  } finally {
    await setAutostart(false)
  }
  await page.goto('/scenes')
  await page.goto('/')
  await ready(page)
  await page.waitForTimeout(2000)
  await expect(player(page)).not.toHaveClass(/vjs-has-started/)
  await page.locator('.cherrypick-watch-player .vjs-big-play-button').click()
  await expect(player(page)).toHaveClass(/vjs-playing/)
})

const HOUR = 3600000
const SIGNALS = 'cherrypick:for-you-signals'

async function clipRatings() {
  const clips = await sharedScenes()
  const { findScenes } = await gql(
    'query ($ids: [ID!]) { findScenes(ids: $ids) { scenes { id rating100 } } }',
    { ids: clips.map((c) => c.id) },
  )
  return findScenes.scenes
}

// What a skip must leave alone in the plugin's map: the settings, Not
// interested, Don't learn and the brackets, read as the plugin reads them
// (a list missing or empty is the same)
const LEFT_ALONE = ['notInterested', 'dontLearn', 'bracket', 'hallOfFame']
function leftAlone(config) {
  const out = {}
  for (const [k, v] of Object.entries(config || {}))
    if (typeof v === 'boolean' || k === 'excludedTags') out[k] = v
  for (const k of LEFT_ALONE) {
    const v = JSON.parse(config?.[k] || 'null')
    out[k] = Array.isArray(v) && !v.length ? null : v
  }
  return out
}

test('Skip twice and Back once: one write to Stash, the snooze holds after a reload, and nothing else changes', async ({
  page,
}) => {
  await setWatchThis(true)
  // For you's signals in this browser, to show a skip leaves them alone
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key))
      localStorage.setItem(
        key,
        JSON.stringify({
          opens: { 1: 1 },
          passes: { 2: 3 },
          lastShown: [],
          lastShownOpened: [],
        }),
      )
  }, SIGNALS)
  await page.goto('/')
  await ready(page)
  const ratings = await clipRatings()
  const config = leftAlone(await pluginConfig())
  const signals = await page.evaluate(
    (key) => localStorage.getItem(key),
    SIGNALS,
  )
  const writes = []
  page.on('requestfinished', (r) => {
    if ((r.postData() || '').includes('CherryPickConfigurePlugin'))
      writes.push(Date.now())
  })

  const skipButton = page.locator('.cherrypick-watch-skip')
  const backButton = page.locator('.cherrypick-watch-back')
  const a = await pickId(page)
  await expect(backButton).toHaveCount(0)
  await skipButton.click()
  await expect.poll(() => pickId(page)).not.toBe(a)
  const b = await pickId(page)
  await expect(backButton).toBeVisible()
  await skipButton.click()
  await expect.poll(() => pickId(page)).not.toBe(b)
  expect(await pickId(page)).not.toBe(a)
  await backButton.click()
  await expect.poll(() => pickId(page)).toBe(b)

  // Skips seconds apart go out as one write, once the skipping stops
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1)
  await page.waitForTimeout(2000)
  expect(writes).toHaveLength(1)
  const snoozes = snoozesIn(await pluginConfig())
  expect(snoozes.map((e) => [e.id, e.step])).toEqual([[a, 1]])
  const left = (snoozes[0].until - Date.now()) / HOUR
  expect(left).toBeGreaterThan(47.9)
  expect(left).toBeLessThanOrEqual(48)

  // After a reload the snoozed scene is out of the pick, and the scene
  // left on screen, neither started nor skipped, has one ignored day
  await page.reload()
  await ready(page)
  expect(await pickId(page)).not.toBe(a)
  await expect
    .poll(
      async () =>
        snoozesIn(await pluginConfig()).find((e) => e.id === b)?.ignored,
      { timeout: 15_000 },
    )
    .toBe(1)

  // A skip changes no rating, nothing else in the plugin's map (Not
  // interested, Don't learn, the brackets) and none of For you's signals
  expect(await clipRatings()).toEqual(ratings)
  expect(leftAlone(await pluginConfig())).toEqual(config)
  expect(await page.evaluate((key) => localStorage.getItem(key), SIGNALS)).toBe(
    signals,
  )
})

test("during playback the player's next and previous buttons skip and go back", async ({
  page,
}) => {
  await setWatchThis(true)
  await page.goto('/')
  await ready(page)
  const next = page.locator(
    '.cherrypick-watch-player .vjs-skip-button.vjs-icon-next-item',
  )
  const previous = page.locator(
    '.cherrypick-watch-player .vjs-skip-button.vjs-icon-previous-item',
  )
  // no previous button before the visit's first skip
  await expect(next).toBeVisible()
  await expect(previous).toBeHidden()
  const a = await pickId(page)
  await page.keyboard.press('Space')
  await expect(player(page)).toHaveClass(/vjs-playing/)
  await expect(line(page)).toHaveCount(0)

  const writes = []
  page.on('requestfinished', (r) => {
    if ((r.postData() || '').includes('CherryPickConfigurePlugin'))
      writes.push(r.postData())
  })
  await next.click()
  await expect.poll(() => playerSceneId(page)).not.toBe(a)
  await expect(previous).toBeVisible()
  // the same player, with the next pick, and still no line
  await expect(
    page.locator('.cherrypick-watch-player .VideoPlayer'),
  ).toHaveCount(1)
  await expect(line(page)).toHaveCount(0)
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1)
  expect(snoozesIn(await pluginConfig()).map((e) => [e.id, e.step])).toEqual([
    [a, 1],
  ])

  await previous.click()
  await expect.poll(() => playerSceneId(page)).toBe(a)
  await expect(previous).toBeHidden()
  // Back puts the snooze back as it was: none
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2)
  expect(snoozesIn(await pluginConfig())).toEqual([])
})

test('a skip after playing a tenth of the pick starts its ladder again; a shorter look steps it up', async ({
  page,
}) => {
  await setWatchThis(true)
  await page.goto('/')
  await ready(page)
  const a = await pickId(page)
  // a already two steps up, its snooze over, so it is still the pick. The
  // page is left first: leaving counts a as ignored and writes the
  // page's own snoozes.
  await page.goto('about:blank')
  await page.waitForTimeout(1500)
  const now = Date.now()
  await setPluginSettings(PLUGIN_ID, {
    ...(await pluginConfig()),
    snoozes: JSON.stringify([
      { id: a, step: 2, until: now - 1000, at: now - 1000, ignored: 0 },
    ]),
    updatedAt: new Date(now).toISOString(),
  })
  await page.goto('/')
  await ready(page)
  expect(await pickId(page)).toBe(a)
  const writes = []
  page.on('requestfinished', (r) => {
    if ((r.postData() || '').includes('CherryPickConfigurePlugin'))
      writes.push(Date.now())
  })
  const next = page.locator(
    '.cherrypick-watch-player .vjs-skip-button.vjs-icon-next-item',
  )
  const previous = page.locator(
    '.cherrypick-watch-player .vjs-skip-button.vjs-icon-previous-item',
  )
  const stepOf = async (id) =>
    snoozesIn(await pluginConfig()).find((e) => e.id === id)

  // The demo clip lasts 8 seconds: 2 seconds of play is a quarter of it.
  // The control bar takes clicks once the mouse moves over the player.
  await page.keyboard.press('Space')
  await expect(player(page)).toHaveClass(/vjs-playing/)
  await page.waitForTimeout(2000)
  await player(page).hover()
  await next.click()
  expect(
    await page
      .locator('.cherrypick-watch-player video')
      .evaluate((v) => v.ended),
  ).toBe(false)
  await expect.poll(() => playerSceneId(page)).not.toBe(a)
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1)
  const watched = await stepOf(a)
  expect(watched.step).toBe(1)
  expect((watched.until - Date.now()) / HOUR).toBeGreaterThan(47.9)

  // Back puts the two steps back; skipped at once, a look, it climbs
  await previous.click()
  await expect.poll(() => playerSceneId(page)).toBe(a)
  expect(
    await page
      .locator('.cherrypick-watch-player video')
      .evaluate((v) => v.paused),
  ).toBe(true)
  await next.click()
  await expect.poll(() => playerSceneId(page)).not.toBe(a)
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2)
  const look = await stepOf(a)
  expect(look.step).toBe(3)
  expect((look.until - Date.now()) / HOUR).toBeGreaterThan(719.9)
})

test('at 1440×900 the line under the player shows without scrolling', async ({
  page,
}) => {
  await setWatchThis(true)
  await page.goto('/')
  await ready(page)
  const box = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect()
    return {
      scrollY: window.scrollY,
      height: window.innerHeight,
      line: r('.cherrypick-watch-line').bottom,
      player: r('.cherrypick-watch-player').width,
      video: r('.cherrypick-watch .video-wrapper'),
      stash: r('.recommendations-container').width,
    }
  })
  expect(box.scrollY).toBe(0)
  expect(box.line).toBeLessThanOrEqual(box.height)
  // Theatre width: the content area's, as wide as Stash's rows
  expect(box.player).toBe(box.stash)
  expect(box.video.height).toBeLessThanOrEqual((box.video.width * 9) / 16 + 1)
})

test.describe('phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  test('at 390 wide the player is full width at 16:9 and nothing scrolls sideways', async ({
    page,
  }) => {
    await setWatchThis(true)
    await page.goto('/')
    await ready(page)
    const box = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect()
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        video: r('.cherrypick-watch .video-wrapper'),
        line: r('.cherrypick-watch-line'),
        stash: r('.recommendations-container').width,
      }
    })
    expect(box.overflow).toBe(0)
    expect(box.video.width).toBe(box.stash)
    expect(
      Math.abs(box.video.height - (box.video.width * 9) / 16),
    ).toBeLessThan(1)
    expect(box.line.top).toBeGreaterThanOrEqual(box.video.bottom)
  })
})

// Every CandyBoudoir theme but the incubating ones, as in
// themes.contract.spec.mjs
const themes = (await listPlugins())
  .filter(({ mod }) => mod.kind === 'theme' && !mod.incubating)
  .map(({ mod }) => mod.id)

for (const theme of themes) {
  test(`with ${theme}: the player and its line render, the line on screen`, async ({
    page,
  }) => {
    await usePlugins(PLUGIN_ID, theme)
    await setWatchThis(true)
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      await page.goto('/')
      await expect(player(page)).toBeVisible({ timeout: 20_000 })
      await expect(line(page)).toBeVisible()
      const bottom = await line(page).evaluate(
        (el) => el.getBoundingClientRect().bottom,
      )
      expect(bottom).toBeLessThanOrEqual(900)
      expect(errors).toEqual([])
    } finally {
      await usePlugins(PLUGIN_ID)
    }
  })
}
