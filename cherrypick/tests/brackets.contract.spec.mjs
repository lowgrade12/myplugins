// Checks Cherry Pick's brackets in Stash: the Bracket button beside the
// Performers and Scenes lists, a bracket played to its champion with the
// keyboard, the custom fields written at the end, no ratings while you pick,
// Apply's ratings for the unrated only, Apply and Undo leaving a rating set
// by hand since the preview or since Apply, performers anchored by their
// scenes' ratings, a bracket of unrated performers and its Challenge round,
// and pause and resume.
import { expect, test } from '@playwright/test'
import {
  DEMO,
  demoCandidates,
  gql,
  pickCandidate,
  setAutoApply,
  setUpCherryPick,
  tearDownCherryPick,
} from './stash.mjs'

let demo
test.beforeAll(async () => {
  ;({ demo } = await setUpCherryPick())
})
test.afterAll(tearDownCherryPick)

const visible = (locator) => locator.filter({ visible: true }).first()

// How many performers match one custom-field criterion.
async function withField(field, modifier = 'NOT_NULL', value) {
  const { findPerformers } = await gql(
    `query ($f: [CustomFieldCriterionInput!]) {
      findPerformers(filter: { per_page: -1 },
        performer_filter: { custom_fields: $f }) { count }
    }`,
    { f: [{ field, modifier, ...(value ? { value } : {}) }] },
  )
  return findPerformers.count
}

test('one click plays a 16-performer bracket to its champion', async ({
  page,
}) => {
  await page.goto('/performers')
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeVisible({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 performers')
  // 15 picks in a 16-performer bracket.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(150)
  }
  const result = page.locator('.cherrypick-result-modal')
  await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
  // Every placed performer gets the fields; only the champion has a title.
  await expect
    .poll(() => withField('cherrypick_titles', 'GREATER_THAN', [0]))
    .toBe(1)
  const placed = await withField('cherrypick_best_finish')
  expect(placed).toBeGreaterThan(1)
  expect(placed).toBeLessThanOrEqual(8)
})

test('an anchored bracket hides ratings while you pick and rates only the unrated', async ({
  page,
}) => {
  await setAutoApply(false)
  await page.goto('/performers')
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeVisible({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 performers')
  await expect(play.locator('.rating-stars, .rating-number')).toHaveCount(0)
  await expect(play.locator('.cherrypick-match')).not.toContainText('seed')
  await expect(play.locator('.cherrypick-match')).not.toContainText('★')
  const candidates = demoCandidates()
  for (let i = 0; i < 15; i++) {
    await pickCandidate(page, play, candidates)
    await page.waitForTimeout(150)
  }
  const result = page.locator('.cherrypick-result-modal')
  await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
  // rated performers played, so no one is asked for the champion's stars
  await expect(result.locator('.cherrypick-champ-rate')).toHaveCount(0)
  await result.locator('.cherrypick-apply-open').click()
  const rows = page.locator(
    '.cherrypick-apply-modal .cherrypick-apply-table tbody tr',
  )
  await expect(rows.first()).toBeVisible()
  for (const row of await rows.all()) {
    // only the unrated, each placed by the rated ones around it
    await expect(row.locator('td.num').first()).toHaveText('unrated')
    await expect(row.locator('td').last()).toHaveText(
      /^(Above .+★( from your scene ratings)?\)|(Finalist|Semifinalist|Quarterfinalist|Round of \d+), (below .+★( from your scene ratings)?\)|in the (top|bottom) \d+% of .+))$/,
    )
  }
})

// Stars as the Apply preview shows a rating100: one decimal
const stars = (r) => (Math.round(r / 2) / 10).toFixed(1)

// The demo plan's average of a performer's rated scenes, as a whole rating100
function sceneAverage(name) {
  const rated = DEMO.scenes
    .filter((s) => s.performers.includes(name) && s.rating100 != null)
    .map((s) => s.rating100)
  return Math.round(rated.reduce((a, b) => a + b, 0) / rated.length)
}

// The performers' ratings in Stash, by id
async function performerRatings(ids) {
  const { findPerformers } = await gql(
    `query ($ids: [ID!]) {
      findPerformers(ids: $ids, filter: { per_page: -1 }) {
        performers { id rating100 } }
    }`,
    { ids },
  )
  return Object.fromEntries(
    findPerformers.performers.map((p) => [p.id, p.rating100]),
  )
}

const setPerformerRating = (id, rating100) =>
  gql(
    'mutation ($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }',
    { i: { id, rating100 } },
  )

// The scenes' ratings in Stash, by id
async function sceneRatings(ids) {
  const { findScenes } = await gql(
    `query ($ids: [ID!]) {
      findScenes(ids: $ids, filter: { per_page: -1 }) {
        scenes { id rating100 } }
    }`,
    { ids },
  )
  return Object.fromEntries(findScenes.scenes.map((x) => [x.id, x.rating100]))
}

const setSceneRating = (id, rating100) =>
  gql('mutation ($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id } }', {
    i: { id, rating100 },
  })

test('performers rated only through their scenes anchor a bracket, and Apply rates neither them nor one rated by hand while its preview is open', async ({
  page,
}) => {
  // Every demo performer unrated; their scenes keep their ratings
  await setAutoApply(false)
  const ids = Object.values(demo.performers)
  const before = await performerRatings(ids)
  for (const id of ids) await setPerformerRating(id, null)
  try {
    await page.goto('/performers')
    const bracket = visible(page.locator('.cherrypick-bracket-button'))
    await expect(bracket).toBeVisible({ timeout: 20_000 })
    await bracket.click()
    const play = page.locator('.cherrypick-play-modal')
    await expect(play).toContainText('16 performers')
    // an anchor looks like any other entrant
    await expect(play.locator('.rating-stars, .rating-number')).toHaveCount(0)
    await expect(play.locator('.cherrypick-match')).not.toContainText('★')
    const candidates = demoCandidates({ ownRatings: false })
    for (let i = 0; i < 15; i++) {
      await pickCandidate(page, play, candidates)
      await page.waitForTimeout(150)
    }
    const result = page.locator('.cherrypick-result-modal')
    await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
    // the scene averages anchor it, so no one is asked for the champion's stars
    await expect(result.locator('.cherrypick-champ-rate')).toHaveCount(0)

    await result.locator('.cherrypick-apply-open').click()
    const apply = page.locator('.cherrypick-apply-modal')
    await expect(apply).toContainText("or whose scenes you've rated")
    const rows = apply.locator('.cherrypick-apply-table tbody tr')
    // the eight candidates play and scene-average anchors fill the other
    // places; a candidate out in round one to an anchor gets no row
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeLessThanOrEqual(8)
    // "Above A (4.3★ from your scene ratings), below B (...)", or one of the
    // two; a row with neither is rated from where it finished
    const above = /^Above ([^,]+) \((\d\.\d)★ from your scene ratings\)/
    const below =
      /(?:^|, )[Bb]elow ([^,]+) \((\d\.\d)★ from your scene ratings\)$/
    const anchors = new Set()
    const expected = {}
    const stepped = []
    for (const row of await rows.all()) {
      const name = await row.locator('td').nth(1).innerText()
      await expect(row.locator('td.num').first()).toHaveText('unrated')
      const why = await row.locator('td').last().innerText()
      const [, loName, loStars] = why.match(above) || []
      const [, hiName, hiStars] = why.match(below) || []
      if (!loName && !hiName) {
        expect(why).toMatch(/, in the (top|bottom) \d+% of .+$/)
        await expect(row.locator('.cherrypick-provisional')).toHaveCount(1)
        stepped.push(name)
        continue
      }
      // below an anchor alone: provisional, half a star under it
      if (!loName)
        await expect(row.locator('.cherrypick-provisional')).toHaveCount(1)
      // each anchor at the average of its scenes' ratings in the demo plan
      const lo = loName && sceneAverage(loName)
      const hi = hiName && sceneAverage(hiName)
      if (loName) expect(stars(lo), why).toBe(loStars)
      if (hiName) expect(stars(hi), why).toBe(hiStars)
      for (const a of [loName, hiName]) if (a) anchors.add(a)
      const to = Math.min(
        100,
        Math.max(
          10,
          loName && hiName
            ? Math.round((lo + hi) / 2 / 5) * 5
            : loName
              ? lo + 10
              : hi - 10,
        ),
      )
      await expect(row.locator('td.num').nth(1)).toContainText(`${stars(to)}★`)
      expected[name] = to
    }
    // no anchor among the rated
    expect(
      [...Object.keys(expected), ...stepped].filter((name) =>
        anchors.has(name),
      ),
    ).toEqual([])
    const byId = (byName) =>
      Object.fromEntries(
        Object.entries(byName).map(([name, r]) => [demo.performers[name], r]),
      )

    // One of them rated by hand while the preview is open, on Stash's own
    // pages or in another tab: Apply leaves it as it is and says so
    const [hand] = Object.keys(expected)
    const handId = demo.performers[hand]
    const handRating = expected[hand] === 20 ? 30 : 20
    await setPerformerRating(handId, handRating)
    delete expected[hand]

    await apply.locator('.cherrypick-apply-go').click()
    await expect(result.locator('.cherrypick-applied')).toContainText(
      'Left 1 as it is: its rating changed since the bracket offered one.',
    )
    const measured = Object.keys(byId(expected))
    await expect.poll(() => performerRatings(measured)).toEqual(byId(expected))
    expect((await performerRatings([handId]))[handId]).toBe(handRating)
    const rated = [...measured, ...stepped.map((name) => demo.performers[name])]
    expect(
      Object.values(await performerRatings(rated)).every((r) => r != null),
    ).toBe(true)
    // the anchors stay unrated, ready to anchor again
    const anchorIds = [...anchors].map((name) => demo.performers[name])
    expect(Object.values(await performerRatings(anchorIds))).toEqual(
      anchorIds.map(() => null),
    )

    // Undo puts the candidates back to unrated, and the one rated by hand
    // keeps its rating
    await result.locator('.cherrypick-applied button').click()
    await expect
      .poll(async () => Object.values(await performerRatings(rated)))
      .toEqual(rated.map(() => null))
    expect((await performerRatings([handId]))[handId]).toBe(handRating)
  } finally {
    for (const [id, r] of Object.entries(before))
      await setPerformerRating(id, r)
  }
})

// The two names on the play cards now
const contenders = (modal) =>
  modal.locator('.cherrypick-contender .cherrypick-cont-title').allInnerTexts()

test('a bracket of unrated performers, then its champion takes on your favorites', async ({
  page,
}) => {
  // Every demo performer and scene unrated but three Female performers: the
  // bracket plays only unrated performers, and the three wait for its
  // champion, lowest rated first
  const favorites = { 'Edie Flint': 20, 'Hana Ridge': 70, 'Bea Lark': 100 }
  await setAutoApply(false)
  const ids = Object.values(demo.performers)
  const sceneIds = Object.values(demo.scenes)
  const before = await performerRatings(ids)
  const scenesBefore = await sceneRatings(sceneIds)
  try {
    for (const id of ids) await setPerformerRating(id, null)
    for (const id of sceneIds) await setSceneRating(id, null)
    for (const [name, r] of Object.entries(favorites))
      await setPerformerRating(demo.performers[name], r)
    await page.goto('/performers')
    const bracket = visible(page.locator('.cherrypick-bracket-button'))
    await expect(bracket).toBeVisible({ timeout: 20_000 })
    await bracket.click()
    const play = page.locator('.cherrypick-play-modal')
    await expect(play).toContainText('16 performers')
    for (let i = 0; i < 15; i++) {
      await expect(play.locator('.cherrypick-contender')).toHaveCount(2)
      for (const name of await contenders(play))
        expect(Object.keys(favorites)).not.toContain(name)
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(150)
    }
    const result = page.locator('.cherrypick-result-modal')
    const champ = await result.locator('.cherrypick-champ-name').innerText()
    const card = result.locator('.cherrypick-challenge')
    await expect(card).toContainText(
      `Test ${champ} against your favorites? Optional: the ratings from this bracket are ready without it.`,
    )
    await expect(card).toContainText(
      "3 of the performers you've rated wait, lowest rated first",
    )
    // optional: no stars asked for, before or instead of it
    await expect(result.locator('.cherrypick-champ-rate')).toHaveCount(0)
    await card.locator('.cherrypick-challenge-start').click()

    // Edie Flint first, with the champion on the left: the champion wins
    const ch = page.locator('.cherrypick-challenge-modal')
    await expect(ch).toContainText('Favorite 1 of 3')
    expect(await contenders(ch)).toEqual([champ, 'Edie Flint'])
    await expect(ch.locator('.cherrypick-match')).not.toContainText('★')
    await page.keyboard.press('ArrowLeft')
    // Hana Ridge next, on the left: she wins, and the round is over
    await expect(ch).toContainText('Favorite 2 of 3')
    expect(await contenders(ch)).toEqual(['Hana Ridge', champ])
    await page.keyboard.press('ArrowLeft')
    const outcome = result.locator('.cherrypick-challenge-outcome')
    await expect(outcome).toHaveText(
      `${champ} beat Edie Flint, then lost to Hana Ridge. Apply to my ratings sets her at 2.3★, and moves the rest with her.`,
    )
    // Undo that pick, beat Hana Ridge and Bea Lark: every favorite beaten
    await result.getByRole('button', { name: 'Undo the last pick' }).click()
    await expect(ch).toContainText('Favorite 2 of 3')
    await page.keyboard.press('ArrowRight')
    await expect(ch).toContainText('Favorite 3 of 3')
    expect(await contenders(ch)).toEqual([champ, 'Bea Lark'])
    await page.keyboard.press('ArrowLeft')
    await expect(result.locator('.cherrypick-challenge-badge')).toHaveText(
      'Beat your favorites',
    )
    await expect(outcome).toHaveText(
      `${champ} beat all 3 of your favorites: Edie Flint, Hana Ridge and Bea Lark. Apply to my ratings sets her at 5.0★, and moves the rest with her.`,
    )

    // Apply: the champion above Bea Lark; all fifteen others rated from
    // where they finished, moved with her
    await result.locator('.cherrypick-apply-open').click()
    const apply = page.locator('.cherrypick-apply-modal')
    const rows = apply.locator('.cherrypick-apply-table tbody tr')
    await expect(rows).toHaveCount(16)
    await expect(rows.first()).toContainText(champ)
    await expect(rows.first()).toContainText('Above Bea Lark (5.0★)')
    await expect(rows.nth(1)).toContainText(
      /Finalist, in the top \d+% of a one to five star scale, moved with the champion/,
    )
    await expect(apply.locator('.cherrypick-provisional')).toHaveCount(15)
    await apply.locator('.cherrypick-apply-go').click()
    const champId = demo.performers[champ]
    await expect
      .poll(async () => (await performerRatings([champId]))[champId])
      .toBe(100)
    await result.locator('.cherrypick-applied button').click()
    await expect
      .poll(async () => (await performerRatings([champId]))[champId])
      .toBe(null)

    // the champion's page says so (an earlier spec may have crowned her
    // too: "2× champion"). The centered dialog moves as Undo's line
    // goes, so a click by position can land beside the link: wait for the
    // line, then click the link itself
    await expect(result.locator('.cherrypick-applied')).toHaveCount(0)
    await result.locator('.cherrypick-champ-name a').dispatchEvent('click')
    await expect(
      visible(page.locator('.detail-item-value.cherrypick-performer-line')),
    ).toContainText(/(Bracket champion|\d+× champion) · beat your favorites/, {
      timeout: 20_000,
    })
  } finally {
    for (const [id, r] of Object.entries(before))
      await setPerformerRating(id, r)
    for (const [id, r] of Object.entries(scenesBefore))
      await setSceneRating(id, r)
  }
})

test('with auto-apply on, closing the champion screen sets its ratings, and Undo puts them back but one rated by hand since', async ({
  page,
}) => {
  await setAutoApply(true)
  const ids = Object.values(demo.performers)
  const before = await performerRatings(ids)
  const changed = async () => {
    const now = await performerRatings(ids)
    return ids.filter((id) => now[id] !== before[id]).length
  }
  await page.goto('/performers')
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeVisible({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 performers')
  const candidates = demoCandidates()
  for (let i = 0; i < 15; i++) {
    await pickCandidate(page, play, candidates)
    await page.waitForTimeout(150)
  }
  const result = page.locator('.cherrypick-result-modal')
  await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
  // no Apply button: the screen says what closing it sets
  await expect(result.locator('.cherrypick-apply-open')).toHaveCount(0)
  const note = result.locator('.cherrypick-auto-apply')
  await expect(note).toContainText(
    /^Closing this sets \d+ performer ratings? in Stash\. You can undo (it|them) on Cherry Pick's page\.$/,
  )
  const n = Number((await note.innerText()).match(/sets (\d+)/)[1])
  expect(n).toBeGreaterThan(0)
  expect(await changed()).toBe(0)
  await result.getByRole('button', { name: 'Done' }).click()
  await expect(result).toBeHidden()
  await expect.poll(changed).toBe(n)

  // One of them rated by hand since: Undo leaves it as it is
  const applied = await performerRatings(ids)
  const mine = ids.find((id) => applied[id] !== before[id])
  const hand = [20, 40, 60, 80, 100].find(
    (r) => r !== applied[mine] && r !== before[mine],
  )
  try {
    await setPerformerRating(mine, hand)

    // Cherry Pick's page lists the batch, with Undo
    await visible(page.locator('a.cherrypick-nav-icon')).click()
    await expect(page.locator('#your-score')).toContainText(
      'within half a star',
      { timeout: 20_000 },
    )
    const batches = page.locator('.cherrypick-applied-batches')
    await expect(batches).toContainText(
      `Applied ${n} performer ${n === 1 ? 'rating' : 'ratings'}`,
    )
    await batches.getByRole('button', { name: 'Undo' }).first().click()
    await expect(batches).toContainText(
      'Left 1 as it is: its rating changed since Apply.',
    )
    await expect.poll(changed).toBe(1)
    expect((await performerRatings([mine]))[mine]).toBe(hand)
    // nothing left to undo: Dismiss drops the note
    await batches.getByRole('button', { name: 'Dismiss' }).first().click()
    await expect(page.getByText('its rating changed since Apply')).toHaveCount(
      0,
    )
  } finally {
    await setPerformerRating(mine, before[mine])
    await clearProvisional([mine])
  }
})

// Takes the provisional mark off the demo performers that carry one
async function clearProvisional(ids) {
  const { findPerformers } = await gql(
    `query ($ids: [ID!]) {
      findPerformers(ids: $ids, filter: { per_page: -1 }) {
        performers { id custom_fields } }
    }`,
    { ids },
  )
  for (const p of findPerformers.performers)
    if (p.custom_fields?.cherrypick_provisional != null)
      await gql(
        'mutation ($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }',
        {
          i: {
            id: p.id,
            custom_fields: { remove: ['cherrypick_provisional'] },
          },
        },
      )
}

test('with auto-apply on, a bracket of unrated performers sets all sixteen on close, and stars given by hand move them', async ({
  page,
}) => {
  // A bracket of unrated performers: each is rated from where it finished,
  // with no Challenge round played
  const favorites = { 'Edie Flint': 20, 'Hana Ridge': 70, 'Bea Lark': 100 }
  await setAutoApply(true)
  const ids = Object.values(demo.performers)
  const sceneIds = Object.values(demo.scenes)
  const before = await performerRatings(ids)
  const scenesBefore = await sceneRatings(sceneIds)
  try {
    for (const id of ids) await setPerformerRating(id, null)
    for (const id of sceneIds) await setSceneRating(id, null)
    for (const [name, r] of Object.entries(favorites))
      await setPerformerRating(demo.performers[name], r)
    await page.goto('/performers')
    const bracket = visible(page.locator('.cherrypick-bracket-button'))
    await expect(bracket).toBeVisible({ timeout: 20_000 })
    await bracket.click()
    await expect(page.locator('.cherrypick-play-modal')).toContainText(
      '16 performers',
    )
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(150)
    }
    const result = page.locator('.cherrypick-result-modal')
    const champ = await result.locator('.cherrypick-champ-name').innerText()
    await expect(result.locator('.cherrypick-auto-apply-none')).toHaveCount(0)
    await expect(result.locator('.cherrypick-auto-apply')).toContainText(
      'Closing this sets 16 performer ratings in Stash.',
    )
    // Rate her myself: her stars move the rest with her
    await result.locator('.cherrypick-challenge-skip').click()
    const ask = result.locator('.cherrypick-champ-rate')
    await expect(ask).toContainText(
      `How many stars for ${champ}? The rest move with her.`,
    )
    await ask.locator('.rating-stars button').nth(3).click()
    await expect(ask).toContainText('4.0★, and the rest move with her.')
    await expect(result.locator('.cherrypick-auto-apply')).toContainText(
      'Closing this sets 16 performer ratings in Stash.',
    )
    await result.getByRole('button', { name: 'Done' }).click()
    const champId = demo.performers[champ]
    await expect
      .poll(async () => (await performerRatings([champId]))[champId])
      .toBe(80)
    // the three favorites, the champion and the fifteen it beat or outlasted
    await expect
      .poll(
        async () =>
          Object.values(await performerRatings(ids)).filter((r) => r != null)
            .length,
      )
      .toBe(19)
    const after = await performerRatings(ids)
    for (const [id, r] of Object.entries(after))
      if (r != null && id !== champId && !Object.values(favorites).includes(r))
        expect(r).toBeLessThanOrEqual(80)
  } finally {
    for (const [id, r] of Object.entries(before))
      await setPerformerRating(id, r)
    for (const [id, r] of Object.entries(scenesBefore))
      await setSceneRating(id, r)
    await clearProvisional(ids)
  }
})

test('a scene bracket plays the unrated scenes and keeps the rated ones for the Challenge round', async ({
  page,
}) => {
  await setAutoApply(false)
  await page.goto('/scenes')
  const options = visible(page.locator('.cherrypick-options-link'))
  await expect(options).toBeEnabled({ timeout: 20_000 })
  await options.click()
  const sheet = page.locator('.cherrypick-clip-dialog')
  await expect(sheet.locator('.cherrypick-new-faces')).toContainText(
    /^\d+ scenes you've rated sit out, and the champion can meet up to 3 of them in an optional Challenge round\.$/,
  )
  await sheet.locator('.cherrypick-start').click()
  const play = page.locator('.cherrypick-play-modal')
  // no rated scene plays (the shared library's clips are rated too)
  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: -1 }) { scenes { title rating100 } } }',
  )
  const rated = new Set(
    findScenes.scenes.filter((s) => s.rating100 != null).map((s) => s.title),
  )
  let picks = 0
  while (picks < 64 && (await play.isVisible())) {
    await expect(play.locator('.cherrypick-contender')).toHaveCount(2)
    for (const title of await contenders(play))
      expect(rated.has(title), title).toBe(false)
    await page.keyboard.press('ArrowLeft')
    // a scene bracket ignores a pick within 400 ms of the last
    await page.waitForTimeout(450)
    picks++
  }
  const result = page.locator('.cherrypick-result-modal')
  await expect(result.locator('.cherrypick-challenge')).toContainText(
    "3 of the scenes you've rated wait, lowest rated first",
  )
  await result.locator('.cherrypick-challenge-start').click()
  const ch = page.locator('.cherrypick-challenge-modal')
  await expect(ch).toContainText('Favorite 1 of 3')
  const rung = (await contenders(ch))[1]
  expect(rated.has(rung), rung).toBe(true)
  await page.keyboard.press('ArrowRight')
  await expect(result.locator('.cherrypick-challenge-outcome')).toContainText(
    `lost to ${rung}.`,
  )
})

test('a clip bracket pauses and resumes after a reload', async ({ page }) => {
  await page.goto('/scenes')
  const bracket = visible(page.locator('.cherrypick-bracket-button'))
  await expect(bracket).toBeVisible({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 scenes')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(play).toBeHidden()
  await page.reload()
  const pill = visible(page.locator('.cherrypick-resume-pill'))
  await expect(pill).toBeVisible({ timeout: 20_000 })
  await pill.click()
  await expect(page.locator('.cherrypick-play-modal')).toContainText(
    'match 2 of 8',
  )
})
