// Walks every Cherry Pick feature on a library the size of a real one, in
// one browser profile from a first visit to Remove Cherry Pick data, and
// records how long each part takes. Run it against a throwaway Stash seeded
// by library.mjs (or a copy of a real database), never the compatibility
// tests' Stash: it rates, brackets and removes as a user would.
//
//   STASH_URL=http://127.0.0.1:9971 SCALE_SUMMARY=<work>/summary.json \
//     SCALE_OUT=<work>/scale-chromium.json BROWSER=chromium \
//     pnpm exec playwright test plugins/cherrypick/tests/scale
//
// SCALE_SUMMARY is library.mjs's --summary file: the profile and the hidden
// taste the picks are judged against. Without it the walk makes no taste
// claims and reads the profile from the library (a copy of a real one).
// CI never runs it: the compatibility runs select specs by "contract".
import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { gql, setAutoApply } from '../stash.mjs'

const summary = process.env.SCALE_SUMMARY
  ? JSON.parse(await readFile(process.env.SCALE_SUMMARY, 'utf8'))
  : null
const metrics = { browser: process.env.BROWSER ?? 'chromium', steps: {} }
const errors = []
const secs = (t) => +((Date.now() - t) / 1000).toFixed(1)

// Generous limits: a slow laptop must still pass, a regression must not.
const LIMIT = {
  firstForYou: 30,
  reload: 10,
  bracketStart: 10,
  apply: 10,
  remove: 120,
}

let page
let library
test.describe.configure({ mode: 'serial' })
// A missing element fails in seconds, not at the test's 15 minutes.
test.use({ actionTimeout: 30_000 })
test.setTimeout(900_000)

test.beforeAll(async ({ browser }) => {
  const { stats, findScenes, findPerformers } = await gql(`{
    stats { scene_count performer_count }
    findScenes(filter: { per_page: 0 }, scene_filter: { rating100: { value: 0, modifier: NOT_NULL } }) { count }
    findPerformers(filter: { per_page: 0 }, performer_filter: { rating100: { value: 0, modifier: NOT_NULL } }) { count }
  }`)
  library = {
    scenes: stats.scene_count,
    performers: stats.performer_count,
    ratedScenes: findScenes.count,
    ratedPerformers: findPerformers.count,
    profile: summary?.profile ?? 'copy',
  }
  metrics.library = library
  // The walk times Apply's preview, so the champion screen keeps its Apply
  // button
  await setAutoApply(false)
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  page = await context.newPage()
  page.on('pageerror', (e) => {
    // WebKit rejects a request a full page load cancels, and Stash's Apollo
    // client leaves that rejection unhandled. The walk loads pages in full
    // while Cherry Pick's queries are in flight; Stash's own navigation
    // never unloads the page, so users don't hit it.
    if (/graphql due to access control checks/.test(e.message)) return
    errors.push(e.message.slice(0, 300))
  })
  page.on('console', async (m) => {
    if (m.type() !== 'error' || !/cherry/i.test(m.text())) return
    // Firefox prints an Error argument as "Error": ask for its message.
    const detail = await Promise.all(
      m
        .args()
        .map((a) =>
          a
            .evaluate((v) =>
              v instanceof Error ? `${v.message} ${v.stack}` : String(v),
            )
            .catch(() => ''),
        ),
    )
    errors.push(`console: ${(detail.join(' ') || m.text()).slice(0, 400)}`)
  })
})

test.afterAll(async () => {
  metrics.errors = errors
  if (process.env.SCALE_OUT)
    await writeFile(process.env.SCALE_OUT, JSON.stringify(metrics, null, 2))
  await page?.context().close()
})

test.afterEach(() => {
  expect(errors, 'page errors').toEqual([])
})

const forYou = () =>
  page.locator(
    '.cherrypick-for-you .slick-slide:not(.slick-cloned) .scene-card',
  )
const visible = (sel) => page.locator(sel).filter({ visible: true }).first()
const idOf = (href) => href?.match(/\/scenes\/(\d+)/)?.[1]

// Scene ids For you shows, with what the library says about each.
async function forYouScenes() {
  const ids = (
    await forYou().evaluateAll((cards) =>
      cards.map((c) =>
        c.querySelector('a[href*="/scenes/"]')?.getAttribute('href'),
      ),
    )
  ).map(idOf)
  const { findScenes } = await gql(
    `query ($ids: [Int!]) { findScenes(scene_ids: $ids, filter: { per_page: -1 }) {
      scenes { id play_count rating100 performers { name } } } }`,
    { ids: ids.map(Number) },
  )
  return findScenes.scenes
}

// Plays a bracket that is open in the play dialog to its end, picking with
// the given key ('random' for either) every `wait` ms, and returns how many
// picks it took. A scene bracket ignores a pick within 400 ms of the last.
async function playOut(key = 'ArrowLeft', wait = 120) {
  const play = page.locator('.cherrypick-play-modal')
  const result = page.locator('.cherrypick-result-modal')
  let picks = 0
  while (!(await result.isVisible())) {
    if (!(await play.isVisible())) {
      await expect(result).toBeVisible({ timeout: 10_000 })
      break
    }
    await page.keyboard.press(
      key === 'random'
        ? Math.random() < 0.5
          ? 'ArrowLeft'
          : 'ArrowRight'
        : key,
    )
    picks++
    await page.waitForTimeout(wait)
    if (picks > 200) throw new Error('A bracket did not end')
  }
  await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
  return picks
}

// When the result shows the champion's stars (only after Rate them myself
// since the finish rates every entrant): Stash's own star buttons, or a list
// where Stash has none. Four stars.
async function rateChampionIfAsked() {
  const prompt = page.locator('.cherrypick-result-modal .cherrypick-champ-rate')
  if (!(await prompt.count())) return false
  const stars = prompt.locator('.rating-stars button')
  if (await stars.count()) await stars.nth(3).click()
  else
    await prompt
      .locator('.cherrypick-champ-select')
      .selectOption({ value: '80' })
  await expect(prompt).toContainText('4.0★')
  return true
}

async function ratedCount(kind) {
  const data = await gql(
    `{ find${kind}(filter: { per_page: 0 }, ${kind === 'Scenes' ? 'scene' : 'performer'}_filter: { rating100: { value: 0, modifier: NOT_NULL } }) { count } }`,
  )
  return data[`find${kind}`].count
}

// Applies the open result's proposals, then undoes them. Returns timings
// and how many ratings were written.
async function applyAndUndo(kind) {
  const before = await ratedCount(kind)
  await page.locator('.cherrypick-result-modal .cherrypick-apply-open').click()
  const modal = page.locator('.cherrypick-apply-modal')
  await expect(modal).toBeVisible()
  const rows = await modal.locator('.cherrypick-apply-table tbody tr').count()
  const fromScenes = await modal
    .locator('.cherrypick-apply-table tbody tr', {
      hasText: 'from your scene ratings',
    })
    .count()
  const go = modal.locator('.cherrypick-apply-go')
  if (!rows || (await go.isDisabled())) return { rows, fromScenes, applied: 0 }
  const t = Date.now()
  await go.click()
  await expect(page.locator('.cherrypick-result-modal')).toBeVisible({
    timeout: LIMIT.apply * 1000,
  })
  await expect
    .poll(() => ratedCount(kind), { timeout: 30_000 })
    .toBeGreaterThan(before)
  const applySecs = secs(t)
  const applied = (await ratedCount(kind)) - before
  const undo = page
    .locator('.cherrypick-result-modal .cherrypick-applied')
    .getByRole('button', { name: 'Undo' })
  const t2 = Date.now()
  await undo.first().click()
  await expect.poll(() => ratedCount(kind), { timeout: 60_000 }).toBe(before)
  return { rows, fromScenes, applied, applySecs, undoSecs: secs(t2) }
}

async function closeDialogs() {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.modal.show').count())) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
}

test('For you on a first visit', async () => {
  const t = Date.now()
  await page.goto('/')
  await expect(forYou().first()).toBeVisible({
    timeout: LIMIT.firstForYou * 1000,
  })
  metrics.steps.firstForYou = secs(t)
  await expect(forYou()).toHaveCount(12)
  const reasons = await page
    .locator(
      '.cherrypick-for-you .slick-slide:not(.slick-cloned) .cherrypick-reason',
    )
    .allTextContents()
  expect(reasons.length).toBe(12)
  for (const r of reasons) expect(r.trim()).not.toBe('')
  // No sentence on more than two cards.
  const counts = {}
  for (const r of reasons) counts[r] = (counts[r] ?? 0) + 1
  expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2)

  const scenes = await forYouScenes()
  const played = scenes.filter((s) => s.play_count > 0).length
  metrics.forYou = { played, neverPlayed: 12 - played, reasons }
  if (summary) {
    const loved = new Set(summary.taste.loved)
    const disliked = new Set(summary.taste.disliked)
    const has = (s, set) => s.performers.some((p) => set.has(p.name))
    metrics.forYou.loved = scenes.filter((s) => has(s, loved)).length
    metrics.forYou.disliked = scenes.filter((s) => has(s, disliked)).length
    // The hidden taste should show: more loved performers than disliked.
    if (library.profile !== 'none')
      expect(metrics.forYou.disliked).toBeLessThanOrEqual(2)
  }
})

test('a reload uses the cache', async () => {
  const t = Date.now()
  await page.reload()
  await expect(forYou().first()).toBeVisible({ timeout: LIMIT.reload * 1000 })
  metrics.steps.reload = secs(t)
  metrics.storageMB = await page.evaluate(
    async () =>
      +(((await navigator.storage?.estimate?.())?.usage ?? 0) / 1e6).toFixed(1),
  )
})

test('Your score on cards and on a scene page, and More like this', async () => {
  const gate = library.ratedScenes >= 10
  await page.goto('/scenes?sortby=random&perPage=60')
  await expect(page.locator('.scene-card').first()).toBeVisible({
    timeout: 30_000,
  })
  const badges = page.locator('.cherrypick-score-banner')
  if (gate && library.profile !== 'light') {
    await expect(badges.first()).toBeVisible({ timeout: 30_000 })
    metrics.badgesOnPage = await badges.count()
  }
  // An unrated scene someone played, with performers.
  const { findScenes } = await gql(`{
    findScenes(filter: { per_page: 1, sort: "play_count", direction: DESC },
      scene_filter: { rating100: { value: 0, modifier: IS_NULL },
        performer_count: { value: 0, modifier: GREATER_THAN } }) { scenes { id } } }`)
  const id = findScenes.scenes[0].id
  const t = Date.now()
  await page.goto(`/scenes/${id}`)
  const line = page.locator('.cherrypick-line-button, .cherrypick-rate-more')
  await expect(line.first()).toBeVisible({ timeout: 30_000 })
  if (gate && library.profile !== 'light')
    await expect(page.locator('.cherrypick-line-button').first()).toBeVisible()
  const owned = page.locator(
    '.cherrypick-more-like-this .cherrypick-mlt-owned .scene-card',
  )
  await expect(owned.first()).toBeVisible({ timeout: 30_000 })
  metrics.steps.scenePage = secs(t)
  metrics.moreLikeThis = await owned.count()
})

test("a performer's page and the Performers list", async () => {
  // A performer in the most-played scene: the line has something to say.
  // (With no rating, play or bracket of theirs it says nothing.)
  const { findScenes } = await gql(`{
    findScenes(filter: { per_page: 1, sort: "play_count", direction: DESC },
      scene_filter: { performer_count: { value: 0, modifier: GREATER_THAN } }) {
      scenes { performers { id } } } }`)
  const t = Date.now()
  await page.goto(`/performers/${findScenes.scenes[0].performers[0].id}`)
  await expect(page.locator('.cherrypick-performer-line').first()).toBeVisible({
    timeout: 30_000,
  })
  metrics.steps.performerPage = secs(t)
  await page.goto('/performers')
  await expect(page.locator('.performer-card').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(visible('.cherrypick-bracket-ops')).toBeVisible({
    timeout: 30_000,
  })
})

test('a 64-performer bracket from Options, with Apply and Undo', async () => {
  await page.goto('/performers')
  await visible('.cherrypick-options-link').click()
  const sizes = page.locator('.cherrypick-sizes button')
  await expect(sizes.first()).toBeVisible()
  await sizes.filter({ hasText: /^64$/ }).click()
  const t = Date.now()
  await page.locator('.cherrypick-start').click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('64 performers', {
    timeout: LIMIT.bracketStart * 1000,
  })
  metrics.steps.bracketStart64 = secs(t)
  // No ratings or seeds while picking.
  await expect(play.locator('.rating-stars, .rating-number')).toHaveCount(0)
  await expect(play.locator('.cherrypick-match')).not.toContainText('★')
  const t2 = Date.now()
  expect(await playOut()).toBe(63)
  metrics.steps.play63 = secs(t2)
  metrics.championAsked = await rateChampionIfAsked()
  metrics.performerApply = await applyAndUndo('Performers')
  if (library.ratedPerformers || metrics.championAsked)
    expect(metrics.performerApply.applied).toBeGreaterThan(0)
  // Someone who rates scenes and not performers: performers anchor at the
  // average of their scene ratings, and the preview says so.
  if (library.profile === 'light') {
    expect(metrics.championAsked).toBe(false)
    expect(metrics.performerApply.applied).toBeGreaterThan(0)
    expect(metrics.performerApply.fromScenes).toBeGreaterThan(0)
  }
  await closeDialogs()
})

test('four brackets crown four champions, then a Champions round', async () => {
  const champions = new Set()
  // Random picks, so a small pool still crowns four different champions.
  for (let i = 0; i < 12 && champions.size < 4; i++) {
    await page.goto('/performers')
    const button = visible('.cherrypick-bracket-button')
    await expect(button).toBeVisible({ timeout: 30_000 })
    await button.click()
    await expect(page.locator('.cherrypick-play-modal')).toContainText(
      '16 performers',
    )
    await playOut('random')
    champions.add(
      await page
        .locator('.cherrypick-result-modal .cherrypick-champ-name')
        .textContent(),
    )
    if (champions.size === 4) break
    await closeDialogs()
  }
  expect(champions.size).toBe(4)
  const due = page.locator('.cherrypick-result-modal .cherrypick-champions-due')
  await expect(due).toBeVisible()
  await due.getByRole('button').click()
  await expect(page.locator('.cherrypick-play-modal')).toContainText(
    'Champions round',
  )
  await playOut()
  await closeDialogs()
  // The Hall of Fame on the front page, crowns on the Performers list.
  await page.goto('/')
  await expect(
    page.locator('.cherrypick-row-hall-of-fame .performer-card').first(),
  ).toBeVisible({
    timeout: 30_000,
  })
  const champ = [...champions][0]
  await page.goto(`/performers?q=${encodeURIComponent(champ)}`)
  await expect(
    page.locator('.performer-card .cherrypick-honours').first(),
  ).toBeVisible({
    timeout: 30_000,
  })
})

test('a clip bracket from a filtered Scenes list pauses, resumes and applies', async () => {
  // A filtered list: Stash's search for the longest word in the most-played
  // scene's title.
  const { findScenes } = await gql(`{
    findScenes(filter: { per_page: 1, sort: "play_count", direction: DESC }) {
      scenes { title } } }`)
  const word = (findScenes.scenes[0].title ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .sort((a, b) => b.length - a.length)[0]
  await page.goto(`/scenes?q=${encodeURIComponent(word)}`)
  await expect(page.locator('.scene-card').first()).toBeVisible({
    timeout: 30_000,
  })
  const t = Date.now()
  await visible('.cherrypick-bracket-button').click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('scenes', {
    timeout: LIMIT.bracketStart * 1000,
  })
  metrics.steps.clipBracketStart = secs(t)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(200)
  // Where the bracket stands after one pick; a small pool starts past round
  // one, so the walk compares rather than expecting "match 2".
  const at = await play.locator('.cherrypick-round').textContent()
  await page.keyboard.press('Escape')
  await expect(play).toBeHidden()
  await page.reload()
  await visible('.cherrypick-resume-pill').click({ timeout: 30_000 })
  await expect(play.locator('.cherrypick-round')).toHaveText(at)
  await playOut('ArrowLeft', 450)
  metrics.championAskedClip = await rateChampionIfAsked()
  metrics.sceneApply = await applyAndUndo('Scenes')
  await closeDialogs()
})

test('Not interested hides a For you card, and it stays out after a reload', async () => {
  await page.goto('/')
  await expect(forYou().first()).toBeVisible({ timeout: 30_000 })
  const first = forYou().first()
  const href = await first
    .locator('a[href*="/scenes/"]')
    .first()
    .getAttribute('href')
  await first.locator('.cherrypick-card-menu').getByTitle('More').click()
  await page.locator('.cherrypick-ni').click()
  // In its place for the rest of the visit, with Undo.
  await expect(forYou().first()).toHaveClass(/cherrypick-hidden-card/)
  await expect(
    forYou().first().getByRole('button', { name: 'Undo' }),
  ).toBeVisible()
  await page.reload()
  await expect(forYou().first()).toBeVisible({ timeout: 30_000 })
  await expect(forYou()).toHaveCount(12)
  await expect(
    page.locator(`.cherrypick-for-you a[href="${href}"]`),
  ).toHaveCount(0)
})

test('Settings › Plugins lists every Cherry Pick setting', async () => {
  await page.goto('/settings?tab=plugins')
  for (const name of [
    'For you row',
    'Score badges on cards',
    'More like this',
    'Learn from Ascension, HotOrNot and Xenith matches',
    'Apply bracket ratings automatically',
  ])
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    })
})

test('phone width: For you and a bracket fit the screen', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  // Stash's own carousels run 10px past a 390px screen with or without
  // Cherry Pick, so this measures Cherry Pick's own containers.
  const pastEdge = (sel) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => el.getBoundingClientRect().right - window.innerWidth)
  await page.goto('/')
  await expect(forYou().first()).toBeVisible({ timeout: 30_000 })
  expect(await pastEdge('.cherrypick-for-you')).toBeLessThanOrEqual(0)
  await page.goto('/performers')
  await visible('.cherrypick-bracket-button').click({ timeout: 30_000 })
  await expect(page.locator('.cherrypick-play-modal')).toBeVisible()
  expect(
    await pastEdge('.cherrypick-play-modal .modal-content'),
  ).toBeLessThanOrEqual(0)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('StashDB: popularity and scenes you do not have', async () => {
  const { configuration } = await gql(
    '{ configuration { general { stashBoxes { endpoint } } } }',
  )
  test.skip(
    !configuration.general.stashBoxes.some((b) =>
      /stashdb\.org/.test(b.endpoint),
    ),
    'No StashDB key in this Stash',
  )
  const { findPerformers } = await gql(`{
    findPerformers(filter: { per_page: 1, sort: "scenes_count", direction: DESC },
      performer_filter: { stash_id_endpoint: { endpoint: "https://stashdb.org/graphql", modifier: NOT_NULL } }) {
      performers { id } } }`)
  const t = Date.now()
  await page.goto(`/performers/${findPerformers.performers[0].id}`)
  // The performer credited most has scenes StashDB knows that the library
  // lacks: the row fills with cards once StashDB answers.
  const missing = page.locator('.cherrypick-not-in-library')
  await expect(missing.locator('.scene-card').first()).toBeVisible({
    timeout: 60_000,
  })
  metrics.steps.stashdbPerformer = secs(t)
  metrics.stashdbMissing = await missing.locator('.scene-card').count()
})

test('the plugin page, then Remove Cherry Pick data', async () => {
  await page.goto('/plugins/cherrypick')
  await expect(page.locator('.cherrypick-page-title').first()).toBeVisible({
    timeout: 30_000,
  })
  await page.reload()
  await expect(page.locator('.cherrypick-page-title').first()).toBeVisible({
    timeout: 30_000,
  })
  const t = Date.now()
  await page.locator('#remove .btn-danger').click()
  const dialog = page.locator('.modal-dialog')
  await expect(dialog).toContainText('Remove Cherry Pick data?')
  await dialog.locator('.btn-danger').click()
  await expect(dialog).toBeHidden({ timeout: LIMIT.remove * 1000 })
  const left = async () =>
    (
      await gql(`{ findPerformers(filter: { per_page: 0 }, performer_filter: {
        custom_fields: [{ field: "cherrypick_best_finish", modifier: NOT_NULL }] }) { count } }`)
    ).findPerformers.count
  await expect.poll(left, { timeout: LIMIT.remove * 1000 }).toBe(0)
  metrics.steps.remove = secs(t)
})
