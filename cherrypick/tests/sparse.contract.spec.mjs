// Cherry Pick in a library that gives the model almost nothing: the sparse
// demo library (one rated scene, a dozen played, favorites but no performer
// ratings), with the shared clips' ratings kept out through Don't learn.
// Every piece either shows something or says, in one line, how to get there.
import { expect, test } from '@playwright/test'
import {
  PLUGIN_ID,
  SPARSE,
  demoScene,
  forYouCards,
  gql,
  pluginConfig,
  setPluginSettings,
  setUpSparseCherryPick,
  sharedScenes,
  tearDownCherryPick,
} from './stash.mjs'

let demo
test.beforeAll(async () => {
  ;({ demo } = await setUpSparseCherryPick())
  const at = new Date().toISOString()
  const dontLearn = (await sharedScenes()).map((s) => ({
    sceneId: s.id,
    title: s.title,
    at,
  }))
  await setPluginSettings(PLUGIN_ID, { dontLearn: JSON.stringify(dontLearn) })
})
test.afterAll(tearDownCherryPick)

const favorites = SPARSE.performers.filter((p) => p.favorite).map((p) => p.name)
const visible = (locator) => locator.filter({ visible: true }).first()

test('For you leans on favorites and says how to sharpen it', async ({
  page,
}) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
  expect(await forYouCards(page).count()).toBe(12)
  const line = page.locator('.cherrypick-for-you .cherrypick-sharpen')
  await expect(line).toHaveText(
    'Rate 9 more scenes or play a bracket to sharpen these picks',
  )
  // The ratings link opens the unrated scenes, most played first.
  await expect(line.locator('a')).toHaveAttribute(
    'href',
    /^\/scenes\?c=.*rating100.*IS_NULL.*&sortby=play_count&sortdir=desc$/,
  )
  const reasons = await page
    .locator(
      '.cherrypick-for-you .slick-slide:not(.slick-cloned) .cherrypick-reason',
    )
    .allInnerTexts()
  expect(reasons).toHaveLength(12)
  // Nothing is rated, so nothing claims to be like what you rate well...
  for (const r of reasons) expect(r).not.toMatch(/rate (well|lower)/)
  // ...and the favorites are what it goes by.
  const named = reasons.filter((r) =>
    favorites.some((name) => r.includes(`ith ${name}, one of your favorites`)),
  )
  expect(named.length).toBeGreaterThanOrEqual(2)
  expect(errors).toEqual([])
})

test('no Your score yet: the scene page says how many ratings it needs', async ({
  page,
}) => {
  const unrated = demoScene(demo, { rated: false, played: true }, SPARSE)
  await page.goto(`/scenes/${unrated}`)
  const line = page.locator('.scene-toolbar .cherrypick-score-line')
  await expect(line.locator('.cherrypick-rate-more')).toHaveText(
    'Rate 9 more for Your score',
    { timeout: 20_000 },
  )
  await expect(line.locator('.cherrypick-line-button')).toHaveCount(1)
  await expect(line.locator('.cherrypick-dont-learn')).toBeVisible()
  await expect(
    page.locator('.cherrypick-more-like-this .cherrypick-mlt-owned'),
  ).toBeAttached()

  // The library is in this browser now: the Scenes list shows no badges.
  await page.goto('/scenes?sortby=title&perPage=120')
  await expect(visible(page.locator('.cherrypick-bracket-button'))).toBeEnabled(
    { timeout: 20_000 },
  )
  await expect(page.locator('.scene-card').first()).toBeVisible()
  await expect(page.locator('.cherrypick-score-banner')).toHaveCount(0)
})

test("Cherry Pick's page counts the ratings and links to the scenes to rate", async ({
  page,
}) => {
  await page.goto('/plugins/cherrypick')
  const card = page.locator('#your-score')
  await expect(card).toContainText('Rate 9 more scenes to start', {
    timeout: 20_000,
  })
  await expect(card).toContainText('For you goes by your favorites')
  await expect(page.locator('#hall-of-fame')).toContainText('No brackets yet')
  await card.locator('.cherrypick-rate-link').click()
  await expect(page).toHaveURL(/\/scenes\?c=.*rating100/)
  await expect(page.locator('.scene-card').first()).toBeVisible({
    timeout: 20_000,
  })
})

test("a performer's page says what you've watched of them", async ({
  page,
}) => {
  // a favorite with a played scene
  const name = favorites.find((n) =>
    SPARSE.scenes.some((s) => s.plays.length && s.performers.includes(n)),
  )
  const watched = SPARSE.scenes.filter(
    (s) => s.plays.length && s.performers.includes(name),
  ).length
  await page.goto(`/performers/${demo.performers[name]}`)
  await expect(
    page.locator('.detail-item-value.cherrypick-performer-line'),
  ).toHaveText(
    new RegExp(`^You've watched ${watched} of (her|his|their) scenes$`),
    { timeout: 20_000 },
  )
})

test('play a bracket starts one from the front page', async ({ page }) => {
  await page.goto('/')
  const line = page.locator('.cherrypick-for-you .cherrypick-sharpen')
  await line.locator('.cherrypick-sharpen-bracket').click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 performers')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Escape')
  await expect(play).toBeHidden()
  // a paused bracket: the line offers to finish it
  await expect(line.locator('.cherrypick-sharpen-bracket')).toHaveText(
    'finish your bracket',
  )
  await line.locator('.cherrypick-sharpen-bracket').click()
  await expect(play).toContainText('match 2 of 8')
})

// How many performers carry Cherry Pick's provisional mark (with one value)
async function provisional(value) {
  const { findPerformers } = await gql(
    `query ($f: [CustomFieldCriterionInput!]) {
      findPerformers(filter: { per_page: -1 },
        performer_filter: { custom_fields: $f }) { count }
    }`,
    {
      f: [
        value == null
          ? { field: 'cherrypick_provisional', modifier: 'NOT_NULL' }
          : {
              field: 'cherrypick_provisional',
              modifier: 'EQUALS',
              value: [value],
            },
      ],
    },
  )
  return findPerformers.count
}

test('a bracket of performers you never rated rates all sixteen from their finish, and your stars for the champion move the rest', async ({
  page,
}) => {
  // The bracket the front page's test left paused reaches Stash only if
  // that test outlasts the plugin's write delay, and a paused bracket hides
  // the Bracket button. Start from none.
  // Apply's preview, with Apply bracket ratings automatically off
  const config = { ...(await pluginConfig()), autoApply: false }
  delete config.bracket
  await setPluginSettings(PLUGIN_ID, config)
  await page.goto('/performers')
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeVisible({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 performers')
  // nothing on the cards hints at a rating or a seed
  await expect(play.locator('.rating-stars, .rating-number')).toHaveCount(0)
  await expect(play.locator('.cherrypick-match')).not.toContainText('seed')
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(150)
  }
  const result = page.locator('.cherrypick-result-modal')
  // nothing to challenge and nothing asked: the finish rates all sixteen
  await expect(result.locator('.cherrypick-challenge')).toHaveCount(0)
  await expect(result.locator('.cherrypick-champ-rate')).toHaveCount(0)
  await result.locator('.cherrypick-apply-open').click()
  const apply = page.locator('.cherrypick-apply-modal')
  const rows = apply.locator('.cherrypick-apply-table tbody tr')
  await expect(rows).toHaveCount(16)
  await expect(rows.first()).toContainText(
    /Champion, in the top \d+% of a one to five star scale/,
  )
  await expect(apply.locator('.cherrypick-provisional')).toHaveCount(16)
  await apply.getByRole('button', { name: 'Back' }).click()

  // Rate her myself: the stars set the champion, and the rest move with her
  await result.locator('.cherrypick-rate-own').click()
  const ask = result.locator('.cherrypick-champ-rate')
  await expect(ask).toContainText('How many stars for')
  await expect(ask.locator('.rating-stars .star-fill-100')).toHaveCount(0)
  await ask.locator('.rating-stars button').nth(3).click()
  await expect(ask).toContainText('4.0★')
  await result.locator('.cherrypick-apply-open').click()
  await expect(rows).toHaveCount(16)
  await expect(rows.first()).toContainText('Your rating for the champion')
  await expect(rows.first()).toContainText('4.0★')
  await expect(rows.nth(1)).toContainText(
    /Finalist, in the top \d+% of a one to five star scale, moved with the champion/,
  )
  await expect(apply.locator('.cherrypick-provisional')).toHaveCount(15)
  await apply.locator('.cherrypick-apply-go').click()

  // the ratings from the finish carry the mark, with the value written; the
  // champion's, the user's own, does not
  await expect.poll(() => provisional()).toBe(15)

  // Undo takes the ratings and the marks back
  await result.locator('.cherrypick-applied button').click()
  await expect.poll(() => provisional()).toBe(0)
})
