// Checks how a scene bracket lets you judge a scene you have never watched:
// every owned scene can play; each side of a match is a contact sheet of
// the cover and eight frames from Stash's sprite sheet, with no rating; the
// cover picks, and a second pick within 400 ms is ignored; a frame, Look
// closer and 1 or 2 open the inspector without picking, its keys move
// through the frames, O switches, Enter picks and Esc goes back instead of
// pausing;
// Play the preview is in place when the inspector opens and plays Stash's
// preview clip, muted, and nothing records a play; a scene without
// generated previews says so; at 390 px the scenes stack with both Pick
// buttons above the footer.
//
// The shared demo clips (tests/stash/prepare.mjs) have sprites and
// previews, and the Scenes list's search for "ffmpeg" (their description)
// gives a pool of those eight alone. The demo library's scenes have no
// files, so they have no frames.
import { expect, test } from '@playwright/test'
import {
  PLUGIN_ID,
  gql,
  pluginConfig,
  setPluginSettings,
  setUpCherryPick,
  tearDownCherryPick,
} from './stash.mjs'

test.beforeAll(async () => {
  await setUpCherryPick()
})
test.afterAll(tearDownCherryPick)
// each test starts its own bracket, so none is left paused
test.beforeEach(async () => {
  const config = { ...((await pluginConfig()) || {}) }
  delete config.bracket
  await setPluginSettings(PLUGIN_ID, config)
})

const visible = (locator) => locator.filter({ visible: true }).first()
const CLIPS = '/scenes?q=ffmpeg'
const SETTLE = 450

async function startBracket(page, list) {
  await page.goto(list)
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeEnabled({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play.locator('.cherrypick-judge')).toHaveCount(2)
  return play
}

const round = (play) => play.locator('.cherrypick-round')
const sceneIds = (play) =>
  play
    .locator('.cherrypick-judge')
    .evaluateAll((els) => els.map((el) => el.dataset.scene))

// What would show a play: Stash's counts and times for the shared clips
async function plays() {
  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: -1, q: "ffmpeg" }) { scenes { id play_count play_duration resume_time last_played_at } } }',
  )
  return findScenes.scenes
}

test('a scene bracket draws on scenes you have never played', async ({
  page,
}) => {
  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: -1 }) { scenes { rating100 play_count } } }',
  )
  const playedUnrated = findScenes.scenes.filter(
    (s) => s.rating100 == null && s.play_count > 0,
  ).length
  await page.goto('/scenes')
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeEnabled({ timeout: 20_000 })
  const title = await bracket.getAttribute('title')
  const n = +title.match(
    /^Bracket 16 of the (\d+) unrated scenes in this list/,
  )[1]
  expect(n).toBeGreaterThan(playedUnrated)
  expect(title).not.toContain('watched')
})

test('a scene match shows contact sheets, and the cover picks', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const play = await startBracket(page, CLIPS)
  await expect(play).toContainText('8 scenes')
  await expect(round(play)).toContainText('match 1 of 4')
  const card = play.locator('.cherrypick-judge').first()
  // the cover, and eight frames from Stash's sprite sheet under it
  const frames = card.locator('.cherrypick-sheet .cherrypick-frame-img')
  await expect(frames).toHaveCount(8)
  expect(
    await frames.evaluateAll((els) =>
      els.every((el) =>
        getComputedStyle(el).backgroundImage.includes('_sprite.jpg'),
      ),
    ),
  ).toBe(true)
  await expect(card.locator('.cherrypick-cover-pick img')).toHaveCount(1)
  await expect(
    card.locator('.cherrypick-sheet button').first(),
  ).toHaveAttribute('aria-label', /^Look closer from \d+:\d\d$/)
  await expect(card.locator('.cherrypick-cont-meta')).toContainText(
    /0:08 · 360p$/,
  )
  await expect(
    card.locator('.cherrypick-cont-faces .cherrypick-face'),
  ).toHaveCount(2)
  await expect(card.locator('.cherrypick-cont-tags .tag-item')).toHaveCount(2)
  // no rating, stars, seed or reason
  await expect(play.locator('.rating-stars, .rating-number')).toHaveCount(0)
  await expect(play.locator('.cherrypick-match')).not.toContainText('★')
  await expect(play.locator('.cherrypick-match')).not.toContainText('seed')

  await card.locator('.cherrypick-cover-pick').click()
  await expect(round(play)).toContainText('match 2 of 4')
  // a double click picks once: the second lands on the next match
  await page.waitForTimeout(SETTLE)
  await play
    .locator('.cherrypick-judge .cherrypick-cover-pick')
    .nth(1)
    .dblclick()
  await expect(round(play)).toContainText('match 3 of 4')
  await page.waitForTimeout(SETTLE)
  await expect(round(play)).toContainText('match 3 of 4')
  // the Pick button picks too
  await play.locator('.cherrypick-pick').first().click()
  await expect(round(play)).toContainText('match 4 of 4')
  expect(errors).toEqual([])
})

test('a frame or Look closer opens the inspector without picking, and Esc goes back', async ({
  page,
}) => {
  const before = await plays()
  const streams = []
  page.on('request', (r) => {
    if (/\/scene\/\d+\/stream/.test(r.url())) streams.push(r.url())
  })
  // the scenes Stash has answered for about their preview clip
  const answered = new Set()
  page.on('response', (r) => {
    const m = /\/scene\/(\d+)\/preview$/.exec(r.url())
    if (m) answered.add(m[1])
  })
  const play = await startBracket(page, CLIPS)
  const [left, right] = await sceneIds(play)
  // a frame under the cover opens the inspector at that frame (the third of
  // eight spread over 81: frame 25)
  await play
    .locator('.cherrypick-judge')
    .nth(1)
    .locator('.cherrypick-sheet button')
    .nth(2)
    .click()
  const insp = play.locator('.cherrypick-inspector')
  await expect(insp).toHaveAttribute('data-scene', right)
  await expect(insp.locator('.cherrypick-scrub')).toHaveAttribute(
    'aria-valuenow',
    '25',
  )
  await expect(round(play)).toContainText('match 1 of 4')
  await play.locator('.cherrypick-insp-back').click()
  await expect(insp).toHaveCount(0)
  // Look closer opens it on the cover. The match asked Stash about the
  // scene's preview clip, so Play the preview is under the scrub bar from
  // the inspector's first frame, and the dialog doesn't move up later.
  await expect.poll(() => answered.has(left)).toBe(true)
  await page.evaluate(() => {
    const seen = new MutationObserver(() => {
      if (!document.querySelector('.cherrypick-scrub')) return
      window.__previewAtOpen = !!document.querySelector(
        '.cherrypick-preview-btn',
      )
      seen.disconnect()
    })
    seen.observe(document.body, { childList: true, subtree: true })
  })
  await play.locator('.cherrypick-look-btn').first().click()
  await expect(insp).toHaveAttribute('data-scene', left)
  expect(await page.evaluate(() => window.__previewAtOpen)).toBe(true)
  await expect(round(play)).toContainText('match 1 of 4')
  // the cover and fifteen frames
  await expect(
    insp.locator('.cherrypick-insp-grid .cherrypick-frame'),
  ).toHaveCount(16)
  await expect(insp.locator('.cherrypick-insp-time')).toHaveText('Cover · 0:08')
  const scrub = insp.locator('.cherrypick-scrub')
  await page.keyboard.press('ArrowRight')
  await expect(scrub).toHaveAttribute('aria-valuenow', '0')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(scrub).toHaveAttribute('aria-valuenow', '10')
  await page.keyboard.press('ArrowLeft')
  await expect(scrub).toHaveAttribute('aria-valuenow', '9')
  // the bar follows the mouse
  const box = await scrub.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // pointermove arrives with the next frame
  const now = async () => +(await scrub.getAttribute('aria-valuenow'))
  await expect.poll(now).toBeGreaterThan(35)
  expect(await now()).toBeLessThan(46)
  await insp.locator('.cherrypick-insp-grid .cherrypick-frame').nth(3).click()
  await expect(insp.locator('.cherrypick-frame.active')).toHaveCount(1)

  // the preview: Stash's generated clip, muted (sound on preview is off)
  const preview = insp.locator('.cherrypick-preview-btn')
  await expect(preview).toHaveText(/^Play the (\d+ s )?preview$/)
  await preview.click()
  const video = insp.locator('video')
  await expect(video).toHaveAttribute(
    'src',
    new RegExp(`/scene/${left}/preview$`),
  )
  expect(await video.evaluate((v) => v.muted)).toBe(true)
  await expect(preview).toHaveText('Stop the preview')
  await preview.click()
  await expect(video).toHaveCount(0)

  // O and The other scene switch; Esc goes back to the match, not paused
  await page.keyboard.press('o')
  await expect(insp).toHaveAttribute('data-scene', right)
  await play.locator('.cherrypick-insp-other').click()
  await expect(insp).toHaveAttribute('data-scene', left)
  await page.keyboard.press('Escape')
  await expect(insp).toHaveCount(0)
  await expect(play.locator('.cherrypick-judge')).toHaveCount(2)
  await expect(round(play)).toContainText('match 1 of 4')

  // 2 opens the right scene, and Enter picks it
  await page.keyboard.press('2')
  await expect(insp).toHaveAttribute('data-scene', right)
  await page.keyboard.press('Enter')
  await expect(insp).toHaveCount(0)
  await expect(round(play)).toContainText('match 2 of 4')
  // Pick this one in the footer
  await page.waitForTimeout(SETTLE)
  await page.keyboard.press('1')
  await play.locator('.cherrypick-insp-pick').click()
  await expect(round(play)).toContainText('match 3 of 4')

  // nothing played the scenes' own files, and Stash recorded no play
  expect(streams).toEqual([])
  expect(await plays()).toEqual(before)
})

test('a scene without generated previews says so', async ({ page }) => {
  // the demo library's scenes have no files: an unfiltered bracket plays them
  const play = await startBracket(page, '/scenes')
  const card = play.locator('.cherrypick-judge').first()
  await expect(card.locator('.cherrypick-sheet-none')).toHaveText(
    "No frames: Stash hasn't generated previews for this scene.",
  )
  await expect(card.locator('.cherrypick-sheet')).toHaveCount(0)
  await card.locator('.cherrypick-look-btn').click()
  const insp = play.locator('.cherrypick-inspector')
  await expect(insp.locator('.cherrypick-insp-none')).toContainText(
    "Stash hasn't generated previews for this scene",
  )
  await expect(insp.locator('.cherrypick-scrub')).toHaveCount(0)
  await expect(insp.locator('.cherrypick-insp-grid')).toHaveCount(0)
  await expect(insp.locator('.cherrypick-preview-btn')).toHaveCount(0)
  // ←/→ have no frames to move through, and pick nothing
  await page.keyboard.press('ArrowRight')
  await expect(insp).toBeVisible()
  await expect(round(play)).toContainText('match 1 of')
})

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the scenes stack, and both Pick buttons sit above the footer', async ({
    page,
  }) => {
    const play = await startBracket(page, CLIPS)
    const cards = play.locator('.cherrypick-judge')
    const [a, b] = [
      await cards.nth(0).boundingBox(),
      await cards.nth(1).boundingBox(),
    ]
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1)
    expect(a.width).toBeGreaterThan(340)
    // four of the eight frames show
    await expect(
      cards
        .first()
        .locator('.cherrypick-sheet .cherrypick-frame')
        .filter({ visible: true }),
    ).toHaveCount(4)
    const footer = await play.locator('.modal-footer').boundingBox()
    for (const pick of await play.locator('.cherrypick-pick').all()) {
      const p = await pick.boundingBox()
      expect(p.height).toBeGreaterThanOrEqual(44)
      expect(p.y + p.height).toBeLessThanOrEqual(footer.y)
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBe(0)
    // the inspector's footer fits on one line, with Other scene
    await play.locator('.cherrypick-look-btn').first().click()
    await expect(play.locator('.cherrypick-insp-other')).toHaveText(
      'Other scene',
      { useInnerText: true },
    )
    const back = await play.locator('.cherrypick-insp-back').boundingBox()
    const pick = await play.locator('.cherrypick-insp-pick').boundingBox()
    expect(Math.abs(back.y - pick.y)).toBeLessThan(4)
    await play.locator('.cherrypick-insp-back').click()
    // a tap on the picture picks: the next match is on screen
    const first = await sceneIds(play)
    await cards.nth(1).locator('.cherrypick-cover-pick').tap()
    await expect.poll(() => sceneIds(play)).not.toEqual(first)
    await play.getByRole('button', { name: 'Show bracket' }).click()
    await expect(
      play.locator('.cherrypick-tree .font-weight-bold'),
    ).toHaveCount(1)
  })
})
