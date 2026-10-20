// Cherry Pick beside the plugins the compatibility tests can install
// (companions.mjs): the Elo ranking plugins Ascension 1.4.1, HotOrNot 1.0.0
// and Xenith 3.2.0, Stash Curator 0.39.1 and Restash 0.3.0. Each block runs
// when prepare.mjs installed its plugin alone (COMPANIONS=ascension,
// hotornot, xenith, curator or restash) and is skipped otherwise: Ascension
// is a fork of HotOrNot and the two claim the same element ids, so they
// fight over a performer's page whatever Cherry Pick does. Beside a ranking
// plugin, both plugins' pieces render on the pages they share, nothing
// throws, they don't overlap, Your score stays on cards whose rating the
// other plugin hides, a dialog's buttons are never covered, and Apply never
// writes over a performer the other plugin ranks and says that plugin will
// pick up what it sets. Matches played in the other plugin's own dialog
// (Ascension's, HotOrNot's and Xenith's) leave what Apply looks for and keep
// both plugins' navbar items; Cherry Pick counts Xenith's, and a bracket of
// the performers Xenith played leaves every one alone. Beside Curator, whose
// patches change the list components' arguments and whose criteria Stash's
// schema lacks, the lists render and Bracket works on a list it filters.
// Beside Restash, its own tasks score the library: with its mirror off
// every rating stays the user's, and with it on Apply leaves each mirrored
// performer alone and checks again before it writes and before an Undo.
import { expect, test } from '@playwright/test'
import { companionPluginIds } from '../../../tests/stash/companions.mjs'
import {
  demoCandidates,
  demoScene,
  forYouCards,
  gql,
  pickCandidate,
  PLUGIN_ID,
  pluginConfig,
  setPluginSettings,
  setUpCherryPick,
  tearDownCherryPick,
} from './stash.mjs'

// What each plugin writes on a performer after a few matches, the pieces it
// puts on the pages Cherry Pick also decorates, and where. `theirs` matches
// everything of its own on the page; `seen` says what each page shows.
// `play` plays in the plugin's own dialog; `played` is the field each match
// writes on both players, and `matches` the list Cherry Pick learns from.
const SIDE = {
  ascension: {
    name: 'Ascension',
    // As Ascension 1.4.1's matches leave a performer, against an opponent no
    // longer in the library
    ranked: {
      hotornot_stats: JSON.stringify({
        total_matches: 4,
        wins: 3,
        losses: 1,
        draws: 0,
        win_margin: 22,
        streaks_killed: 0,
        current_streak: 2,
        best_streak: 2,
        worst_streak: -1,
        last_match: '2026-10-15T20:00:00.000Z',
      }),
      performer_record: JSON.stringify([
        {
          date: '2026-10-15T20:00:00.000Z',
          opponent: '0:Unknown',
          won: true,
          AscRatingAfter: 6.2,
        },
      ]),
    },
    theirs: '.hon-asc-score-display',
    seen: {
      front: (page) =>
        forYouCards(page).first().locator('.hon-asc-score-display'),
      // Ascension hides the first .rating-banner on each card, Stash's
      // rating as it expects; on an unrated scene that is Your score,
      // which stays.
      scenes: (page) =>
        page
          .locator('.scene-card', {
            has: page.locator('.cherrypick-score-banner'),
          })
          .first()
          .locator('.hon-asc-score-display'),
      performers: (page) => page.locator('.hon-asc-score-display').first(),
      performer: (page) =>
        page.locator('.detail-header .hon-asc-score-display'),
    },
    played: 'performer_record',
    // One match in its own dialog, which the navbar's Ascension item opens
    // on Head to Head among every performer: the left card wins
    play: async (page) => {
      await page.goto('/performers')
      await page.locator('#plugin_hon').click()
      await page
        .locator(
          '#hon-comparison-area .hon-scene-card[data-side="left"] [data-winner]',
        )
        .first()
        .click()
      await page.locator('#hon-modal .hon-modal-close').click()
      await expect(page.locator('#hon-modal')).toBeHidden()
    },
  },
  hotornot: {
    name: 'HotOrNot',
    // As one match leaves a performer: hotornot_stats alone
    ranked: {
      hotornot_stats: JSON.stringify({
        total_matches: 4,
        last_match: '2026-10-15T20:00:00.000Z',
        wins: 3,
        losses: 1,
        current_streak: 2,
        best_streak: 2,
        worst_streak: 0,
      }),
    },
    theirs: '#hon-floating-btn, #hon-battle-rank-badge',
    seen: {
      // A fixed button on the Performers and Images pages, above Stash's
      // modals, and a rank badge beside the rating on a performer's page
      performers: (page) => page.locator('#hon-floating-btn'),
      performer: (page) => page.locator('#hon-battle-rank-badge'),
    },
    played: 'hotornot_stats',
    // One match in its own dialog, the left performer winning. It draws a
    // gender at random from every chip but Male, and the demo performers
    // are all Female, so the others come off first.
    play: async (page) => {
      await page.goto('/performers')
      await page.locator('#hon-floating-btn').click()
      for (const g of [
        'TRANSGENDER_MALE',
        'TRANSGENDER_FEMALE',
        'INTERSEX',
        'NON_BINARY',
      ])
        await page
          .locator(`#hon-modal .hon-gender-btn[data-gender="${g}"]`)
          .click()
      await page
        .locator('#hon-modal .hon-scene-card[data-side="left"] .hon-scene-body')
        .click()
      await page.locator('#hon-modal .hon-modal-close').click()
    },
  },
  xenith: {
    name: 'Xenith',
    // As one match leaves a performer: xenith_stats and xenith_record
    ranked: {
      xenith_stats: JSON.stringify({
        total_matches: 4,
        wins: 3,
        losses: 1,
        draws: 0,
        current_streak: 2,
        best_streak: 2,
        worst_streak: 0,
        last_match: '2026-10-15T20:00:00.000Z',
      }),
      xenith_record: JSON.stringify([
        {
          date: '2026-10-15T20:00:00.000Z',
          opponent: '1:Gumdrop Gigi',
          won: true,
          ratingAfter: 62,
        },
      ]),
    },
    theirs: '.hon-compact-badge, #hon-battle-rank-badge',
    seen: {
      // Its rank badge on every scene and performer card, whose rating it
      // hides, and beside the rating on a performer's page
      front: (page) => forYouCards(page).first().locator('.hon-compact-badge'),
      scenes: (page) =>
        page
          .locator('.scene-card', {
            has: page.locator('.cherrypick-score-banner'),
          })
          .first()
          .locator('.hon-compact-badge'),
      performers: (page) =>
        page.locator('.performer-card .hon-compact-badge').first(),
      performer: (page) => page.locator('#hon-battle-rank-badge'),
    },
    played: 'xenith_stats',
    matches: 'xenith_record',
    // Head to head in its own dialog, among female performers, until
    // BRACKET of them who can enter a bracket have played, so a bracket of
    // performers it ranks can follow. Its cards re-render one side at a
    // time, so the pair on screen at a click can be stale: each pick waits
    // for a new match in the records, whichever pair it was.
    play: async (page) => {
      await page.goto('/performers')
      await page.locator('#hon-floating-btn').click()
      const app = page.locator('#hon-app-mount')
      await app.locator('button[aria-controls="hon-gender-panel"]').click()
      await app
        .locator('#hon-gender-panel button', { hasText: /^Female$/ })
        .click()
      const choose = app.locator(
        '.hon-scene-card[data-side="left"] .hon-choose-btn',
      )
      for (let picks = 0; ; picks++) {
        const { bracketable, entries } = await xenithPlayed()
        if (bracketable >= BRACKET) break
        expect(picks, `${bracketable} of ${BRACKET} played`).toBeLessThan(40)
        await expect(async () => {
          await choose.click()
          await expect
            .poll(async () => (await xenithPlayed()).entries, {
              timeout: 5_000,
            })
            .toBeGreaterThan(entries)
        }).toPass({ timeout: 30_000 })
      }
      await page.locator('#hon-modal .hon-modal-close').click()
      await expect(page.locator('#hon-modal')).toBeHidden()
    },
  },
}

// Performers in a bracket from a list
const BRACKET = 16

// What Xenith has played so far: the female performers with its stats who
// can enter a bracket (a real photo and a scene), and every entry in its
// match lists
async function xenithPlayed() {
  const { findPerformers } = await gql(
    '{ findPerformers(filter: { per_page: -1 }) { performers { gender scene_count image_path custom_fields } } }',
  )
  let bracketable = 0
  let entries = 0
  for (const p of findPerformers.performers) {
    const f = p.custom_fields || {}
    if (!f.xenith_stats) continue
    entries += JSON.parse(f.xenith_record || '[]').length
    if (
      p.gender === 'FEMALE' &&
      p.scene_count >= 1 &&
      !/[?&]default=true/.test(p.image_path)
    )
      bracketable++
  }
  return { bracketable, entries }
}

// Performers by id, with the name, the rating and the fields a ranking
// plugin writes
async function performerState() {
  const { findPerformers } = await gql(
    '{ findPerformers(filter: { per_page: -1 }) { performers { id name rating100 custom_fields } } }',
  )
  return Object.fromEntries(findPerformers.performers.map((p) => [p.id, p]))
}

const rankedKeys = (side) => Object.keys(side.ranked)

async function rankEveryPerformer(side, on) {
  const { findPerformers } = await gql(
    '{ findPerformers(filter: { per_page: -1 }) { performers { id } } }',
  )
  for (const { id } of findPerformers.performers)
    await gql(
      'mutation ($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }',
      {
        i: {
          id,
          custom_fields: on
            ? { partial: side.ranked }
            : { remove: rankedKeys(side) },
        },
      },
    )
}

// Puts back each performer's rating as `before` had it and takes off the
// custom fields added since: the other plugin's, and a bracket's results
async function putBack(before) {
  for (const p of Object.values(await performerState())) {
    const was = before[p.id]
    if (!was) continue
    const added = Object.keys(p.custom_fields || {}).filter(
      (k) => was.custom_fields?.[k] == null,
    )
    if (p.rating100 === was.rating100 && !added.length) continue
    await gql(
      'mutation ($i: PerformerUpdateInput!) { performerUpdate(input: $i) { id } }',
      {
        i: {
          id: p.id,
          rating100: was.rating100,
          custom_fields: { remove: added },
        },
      },
    )
  }
}

// The keys of a field's JSON: the object's, or each entry's in a list
const shapeOf = (raw) => {
  const v = JSON.parse(raw)
  return new Set(
    (Array.isArray(v) ? v : [v]).map((e) => Object.keys(e).sort().join()),
  )
}

// The Performers list filtered to those with a custom field, in Stash's URL
// encoding
const withField = (field) =>
  `/performers?c=(%22type%22:%22custom_fields%22,%22value%22:%5B(%22field%22:%22${field}%22,%22modifier%22:%22NOT_NULL%22,%22value%22:%5B%5D)%5D)`

async function performerRatings() {
  const { findPerformers } = await gql(
    '{ findPerformers(filter: { per_page: -1 }) { performers { id rating100 } } }',
  )
  return Object.fromEntries(
    findPerformers.performers.map((p) => [p.id, p.rating100]),
  )
}

// The pairs of the other plugin's pieces and Cherry Pick's, on the same
// page, that overlap
const overlaps = (page, theirs) =>
  page.evaluate((theirs) => {
    const box = (el) => {
      const b = el.getBoundingClientRect()
      return b.width && b.height && getComputedStyle(el).visibility !== 'hidden'
        ? b
        : null
    }
    const hit = (a, b) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom
    const ours = [
      ...document.querySelectorAll(
        '.cherrypick-score-banner, .cherrypick-honours, .cherrypick-performer-line, .cherrypick-bracket-slot, .rating-banner',
      ),
    ]
      .map((el) => [el.className, box(el)])
      .filter(([, b]) => b)
    const out = []
    for (const el of document.querySelectorAll(theirs)) {
      const a = box(el)
      if (a)
        for (const [cls, b] of ours)
          if (hit(a, b)) out.push(`${el.id || el.className} on ${cls}`)
    }
    return out
  }, theirs)

// Your scores on the page that are not drawn: hidden by another plugin's
// rule or inline style, or squashed to nothing
const hiddenScores = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cherrypick-score-banner')]
      .filter((el) => {
        const b = el.getBoundingClientRect()
        return (
          !b.width ||
          !b.height ||
          !el.checkVisibility({ visibilityProperty: true })
        )
      })
      .map((el) => el.title),
  )

// The buttons, links and fields of Cherry Pick's open dialogs that a piece of
// the other plugin sits on top of, at any of nine points across each one
const covered = (page, theirs) =>
  page.evaluate((theirs) => {
    const out = new Set()
    for (const el of document.querySelectorAll(
      '.cherrypick-dialog button, .cherrypick-dialog a[href], .cherrypick-dialog input, .cherrypick-dialog label',
    )) {
      const b = el.getBoundingClientRect()
      if (!b.width || !b.height) continue
      const points = [0.05, 0.5, 0.95].flatMap((x) =>
        [0.15, 0.5, 0.85].map((y) => [
          b.left + b.width * x,
          b.top + b.height * y,
        ]),
      )
      if (
        points.some(([x, y]) =>
          document.elementFromPoint(x, y)?.closest(theirs),
        )
      )
        out.add(
          `${el.textContent.trim().slice(0, 30)} (${el.tagName.toLowerCase()})`,
        )
    }
    return [...out]
  }, theirs)

// Plays a 16-performer bracket from the Performers list (or the one at
// `list`) to its champion, the demo's candidates winning past rated
// performers
async function playBracket(page, list = '/performers') {
  await page.goto(list)
  const bracket = page
    .locator('.cherrypick-bracket-button')
    .filter({ visible: true })
    .first()
  await expect(bracket).toBeEnabled({ timeout: 20_000 })
  await bracket.click()
  const play = page.locator('.cherrypick-play-modal')
  await expect(play).toContainText('16 performers')
  // candidates past the rated: Apply always has a row
  const candidates = demoCandidates()
  for (let i = 0; i < 15; i++) {
    await pickCandidate(page, play, candidates)
    await page.waitForTimeout(150)
  }
  const result = page.locator('.cherrypick-result-modal')
  await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
  return result
}

for (const [key, side] of Object.entries(SIDE)) {
  test.describe(`beside ${side.name}`, () => {
    test.skip(
      companionPluginIds().length !== 1 || !companionPluginIds().includes(key),
      `${side.name} is not installed alone (COMPANIONS=${key})`,
    )

    let demo
    test.beforeAll(async () => {
      ;({ demo } = await setUpCherryPick())
    })
    test.afterAll(async () => {
      await rankEveryPerformer(side, false)
      await tearDownCherryPick()
    })

    test(`${side.name} writes Stash's ratings, so Apply bracket ratings automatically starts off`, async ({
      page,
    }) => {
      const config = await pluginConfig()
      await setPluginSettings(PLUGIN_ID, {})
      try {
        await page.goto('/performers')
        await expect
          .poll(async () => (await pluginConfig())?.autoApply, {
            timeout: 20_000,
          })
          .toBe(false)
      } finally {
        await setPluginSettings(PLUGIN_ID, config ?? {})
      }
    })

    test('both plugins render on the pages they share, apart and error-free', async ({
      page,
    }) => {
      const errors = []
      page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`))
      const seen = async (where) => {
        if (side.seen[where])
          await expect(side.seen[where](page)).toBeVisible({
            timeout: 20_000,
          })
      }

      await page.goto('/')
      await expect(forYouCards(page).first()).toBeVisible({ timeout: 20_000 })
      await seen('front')
      expect(await hiddenScores(page)).toEqual([])
      expect(await overlaps(page, side.theirs)).toEqual([])

      await page.goto('/scenes?sortby=title&perPage=120')
      await expect(
        page.locator('.cherrypick-score-banner').first(),
      ).toBeVisible({ timeout: 20_000 })
      await seen('scenes')
      expect(await hiddenScores(page)).toEqual([])
      await expect(
        page.locator('.cherrypick-bracket-button').filter({ visible: true }),
      ).toHaveCount(1)
      expect(await overlaps(page, side.theirs)).toEqual([])

      await page.goto('/performers')
      await seen('performers')
      await expect(
        page.locator('.cherrypick-bracket-button').filter({ visible: true }),
      ).toHaveCount(1)
      expect(await overlaps(page, side.theirs)).toEqual([])

      await page.goto(`/performers/${Object.values(demo.performers)[0]}`)
      await seen('performer')
      await expect(
        page.locator('.detail-item.cherrypick-performer-line'),
      ).toBeVisible({ timeout: 20_000 })
      expect(await overlaps(page, side.theirs)).toEqual([])

      expect(errors).toEqual([])
    })

    test('matches in its own dialog leave what Apply looks for, and the page still works', async ({
      page,
      browser,
    }) => {
      test.skip(!side.play, `${side.name}'s dialog is not scripted`)
      test.slow(!!side.matches, 'enough matches for a bracket')
      const errors = []
      const watch = (p) =>
        p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`))
      watch(page)
      const before = await performerState()
      const config = await pluginConfig()
      let later
      try {
        await side.play(page)
        // Cherry Pick's cherries and Stash's Settings link outlast the dialog
        await expect(
          page
            .locator('.cherrypick-nav-icon')
            .filter({ visible: true })
            .first(),
        ).toBeVisible()
        await expect(
          page
            .locator('.navbar a.nav-utility[href="/settings"]')
            .filter({ visible: true })
            .first(),
        ).toBeVisible()

        const played = () =>
          performerState().then((now) =>
            Object.values(now).filter(
              (p) =>
                p.custom_fields?.[side.played] &&
                !before[p.id].custom_fields?.[side.played],
            ),
          )
        await expect
          .poll(async () => (await played()).length)
          .toBeGreaterThan(0)
        const now = await played()
        // Its records are what the fixtures say they are
        for (const p of now)
          for (const key of rankedKeys(side))
            expect(shapeOf(p.custom_fields[key]), `${key} of ${p.id}`).toEqual(
              shapeOf(side.ranked[key]),
            )

        if (side.matches) {
          // Each match as both players recorded it: the same date, each
          // the other's opponent, one of them the winner
          const state = await performerState()
          const list = (p) =>
            JSON.parse(p?.custom_fields?.[side.matches] || '[]')
          const matches = new Set()
          for (const p of now)
            for (const e of list(p)) {
              const them = e.opponent.split(':')[0]
              const mirror = list(state[them]).find(
                (x) => x.date === e.date && x.opponent.split(':')[0] === p.id,
              )
              expect(mirror?.won, `${p.id} v ${them} at ${e.date}`).toBe(!e.won)
              matches.add([e.date, ...[p.id, them].sort()].join(' '))
            }

          // Cherry Pick keeps the library it read for two minutes, so it
          // sees the matches on a later visit: a browser of its own
          later = await browser.newContext()
          const visit = await later.newPage()
          watch(visit)
          await setPluginSettings(PLUGIN_ID, {
            ...config,
            learnFromMatches: true,
          })
          await visit.goto('/plugins/cherrypick')
          await expect(visit.locator('#your-score')).toContainText(
            `${matches.size} matches in ${side.name}`,
            { timeout: 20_000 },
          )

          // A bracket of the performers it played leaves every one alone
          const ratings = await performerRatings()
          const result = await playBracket(visit, withField(side.played))
          await result.locator('.cherrypick-apply-open').click()
          const apply = visit.locator('.cherrypick-apply-modal')
          const rows = apply.locator('.cherrypick-apply-table tbody tr')
          await expect(rows).toHaveCount(8)
          await expect(apply.locator('.cherrypick-apply-skipped')).toHaveCount(
            8,
          )
          await expect(rows.first()).toContainText(`${side.name} ranks them`)
          const names = now.map((p) => p.name)
          for (const name of await rows
            .locator('td:nth-child(2)')
            .allTextContents())
            expect(names).toContain(name)
          await expect(apply.locator('.cherrypick-apply-go')).toBeDisabled()
          expect(await performerRatings()).toEqual(ratings)
        }
      } finally {
        await later?.close()
        await setPluginSettings(PLUGIN_ID, config ?? {})
        await putBack(before)
      }
      await page.goto('/performers')
      await expect(
        page.locator('.cherrypick-bracket-button').filter({ visible: true }),
      ).toHaveCount(1, {
        timeout: 20_000,
      })
      expect(errors).toEqual([])
    })

    test('Apply leaves every performer it ranks alone, and says why', async ({
      page,
    }) => {
      await rankEveryPerformer(side, true)
      const before = await performerRatings()
      const result = await playBracket(page)
      await result.locator('.cherrypick-apply-open').click()
      const apply = page.locator('.cherrypick-apply-modal')
      await expect(apply.locator('.cherrypick-apply-ranking')).toContainText(
        side.name,
      )
      await expect(apply.locator('.cherrypick-apply-ranking')).toContainText(
        'installed',
      )
      const rows = apply.locator('.cherrypick-apply-table tbody tr')
      await expect(rows).toHaveCount(8)
      await expect(apply.locator('.cherrypick-apply-skipped')).toHaveCount(8)
      await expect(rows.first()).toContainText(`${side.name} ranks them`)
      await expect(apply.locator('.cherrypick-apply-go')).toBeDisabled()
      expect(await performerRatings()).toEqual(before)

      // The champion's crown sits clear of the other plugin's pieces
      await page.keyboard.press('Escape')
      await page.goto('/performers?perPage=120')
      await expect(
        page.locator('.performer-card .cherrypick-honours').first(),
      ).toBeVisible({ timeout: 20_000 })
      // once the other plugin has drawn its own, which can come later
      if (side.seen.performers)
        await expect(side.seen.performers(page)).toBeVisible({
          timeout: 20_000,
        })
      expect(await overlaps(page, side.theirs)).toEqual([])
      await rankEveryPerformer(side, false)
    })

    test('Apply checks again right before it writes', async ({ page }) => {
      const result = await playBracket(page)
      await result.locator('.cherrypick-apply-open').click()
      const apply = page.locator('.cherrypick-apply-modal')
      const go = apply.locator('.cherrypick-apply-go')
      if (await go.isDisabled()) await apply.locator('label').first().click()
      await expect(go).toBeEnabled()
      // The other plugin ranks them all while the preview is open
      await rankEveryPerformer(side, true)
      const before = await performerRatings()
      await go.click()
      await expect(page.locator('.cherrypick-applied').first()).toContainText(
        'another plugin rates',
      )
      expect(await performerRatings()).toEqual(before)
      await rankEveryPerformer(side, false)
    })

    test.describe('at phone width', () => {
      test.use({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      })

      test("a bracket's dialogs keep every button clear of it", async ({
        page,
      }) => {
        await page.goto('/performers')
        await expect(
          page.locator('.cherrypick-bracket-button').filter({ visible: true }),
        ).toHaveCount(1, { timeout: 20_000 })
        await page
          .locator('.cherrypick-bracket-button')
          .filter({ visible: true })
          .click()
        const play = page.locator('.cherrypick-play-modal')
        await expect(play).toContainText('16 performers')
        expect(await covered(page, side.theirs)).toEqual([])
        for (let i = 0; i < 15; i++) {
          await page.keyboard.press('ArrowLeft')
          await page.waitForTimeout(150)
        }
        const result = page.locator('.cherrypick-result-modal')
        await expect(result.locator('.cherrypick-champ-name')).not.toBeEmpty()
        expect(await covered(page, side.theirs)).toEqual([])
        await result.locator('.cherrypick-apply-open').click()
        await expect(page.locator('.cherrypick-apply-modal')).toBeVisible()
        expect(await covered(page, side.theirs)).toEqual([])
      })
    })
  })
}

// A list filtered on one of Curator's criteria, "is greater than 0", in
// Stash's URL encoding
const curatorFilter = (path, type) =>
  `${path}?c=(%22type%22:%22${type}%22,%22modifier%22:%22GREATER_THAN%22,%22value%22:%220%22)`

// Curator's pieces on Stash's own cards and its controls on a list
const CURATOR = '.curator-scene-card-badge, .curator-performer-card-badge'

// The offer to hide Your score on cards beside Curator, on Cherry Pick's page
// and under its settings in Settings › Plugins
const offer = (page) => page.locator('.cherrypick-curator-offer')

// Cherry Pick's settings in Settings › Plugins, open: develop collapses each
// plugin's settings until its heading is clicked.
async function cherryPickSettings(page) {
  await page.goto('/settings?tab=plugins')
  const badges = page.locator('#plugin-CherryPick-badges')
  await expect(badges).toBeAttached({ timeout: 20_000 })
  if (await badges.isHidden())
    await page
      .locator('.setting-group', { has: badges })
      .locator(':scope > .setting')
      .click()
  await expect(badges).toBeVisible()
  return badges
}

// What the offer leaves in the plugin's configuration
async function answered() {
  const c = await pluginConfig()
  return { badges: c?.badges, curatorOffer: c?.curatorOffer ?? null }
}

// Stash's answers that rejected a query outright, as "400 CherryPickListScenes"
function rejected(page) {
  const out = []
  page.on('response', (r) => {
    if (r.url().endsWith('/graphql') && r.status() === 400)
      out.push(`400 ${r.request().postDataJSON()?.operationName}`)
  })
  return out
}

test.describe('beside Stash Curator', () => {
  test.skip(
    companionPluginIds().length !== 1 ||
      !companionPluginIds().includes('stash-curator'),
    'Stash Curator is not installed alone (COMPANIONS=curator)',
  )

  let demo
  test.beforeAll(async () => {
    ;({ demo } = await setUpCherryPick())
    // Curator scores what its last sync saw: the demo library's plays
    await gql(
      'mutation { runPluginTask(plugin_id: "stash-curator", task_name: "Sync and build recommendations") }',
    )
    await expect
      .poll(async () => (await gql('{ jobQueue { id } }')).jobQueue?.length, {
        timeout: 120_000,
      })
      .toBeFalsy()
  })
  test.afterAll(tearDownCherryPick)
  // A bracket left paused hides the list's Bracket button
  test.beforeEach(() => setPluginSettings(PLUGIN_ID, {}))

  test('both lists render, with both plugins on their cards and apart', async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`))
    const bracket = page
      .locator('.cherrypick-bracket-button')
      .filter({ visible: true })

    await page.goto('/scenes?sortby=title&perPage=120')
    await expect(page.locator('.scene-card').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.locator('.scene-card .curator-scene-card-badge').first(),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.locator('.scene-card .cherrypick-score-banner').first(),
    ).toBeVisible({ timeout: 20_000 })
    await expect(bracket).toHaveCount(1)
    expect(await overlaps(page, CURATOR)).toEqual([])

    await page.goto('/performers')
    await expect(
      page.locator('.performer-card .curator-performer-card-badge').first(),
    ).toBeVisible({ timeout: 20_000 })
    await expect(bracket).toHaveCount(1, { timeout: 20_000 })
    expect(await overlaps(page, CURATOR)).toEqual([])

    // A performer's Scenes tab is the same scene list
    await page.goto(`/performers/${Object.values(demo.performers)[0]}/scenes`)
    await expect(page.locator('.scene-card').first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.locator('.detail-item.cherrypick-performer-line'),
    ).toBeVisible({ timeout: 20_000 })

    expect(errors).toEqual([])
  })

  test('Bracket on a Scenes list filtered by Curator Appeal leaves it out and says so', async ({
    page,
  }) => {
    const bad = rejected(page)
    await page.goto(curatorFilter('/scenes', 'curator_appeal'))
    await expect(page.locator('.scene-card').first()).toBeVisible({
      timeout: 20_000,
    })
    const bracket = page
      .locator('.cherrypick-bracket-button')
      .filter({ visible: true })
    await expect(bracket).toBeEnabled({ timeout: 20_000 })
    await expect(bracket).toHaveAttribute(
      'title',
      / scenes in this list(, from likely best to likely worst)? · Curator Appeal not applied$/,
    )
    await bracket.click()
    await expect(page.locator('.cherrypick-play-modal')).toContainText(
      'Curator Appeal not applied',
    )
    expect(bad).toEqual([])
  })

  test('Bracket on a Performers list filtered by Curator affinity leaves it out and says so', async ({
    page,
  }) => {
    const bad = rejected(page)
    await page.goto(curatorFilter('/performers', 'curator_affinity'))
    await expect(page.locator('.performer-card').first()).toBeVisible({
      timeout: 20_000,
    })
    const bracket = page
      .locator('.cherrypick-bracket-button')
      .filter({ visible: true })
    await expect(bracket).toBeEnabled({ timeout: 20_000 })
    await expect(bracket).toHaveAttribute(
      'title',
      'Bracket the performers in this list · Curator affinity not applied',
    )
    await bracket.click()
    await expect(page.locator('.cherrypick-play-modal')).toContainText(
      'Curator affinity not applied',
    )
    expect(bad).toEqual([])
  })

  test("Bracket says why when Stash rejects the list's filter", async ({
    page,
  }) => {
    // Without Stash's filter fields, Curator's key goes to Stash as it is
    await page.route('**/graphql', (route) =>
      route.request().postDataJSON()?.operationName === 'CherryPickFilterFields'
        ? route.fulfill({ status: 500, body: '' })
        : route.fallback(),
    )
    await page.goto(curatorFilter('/scenes', 'curator_appeal'))
    const bracket = page
      .locator('.cherrypick-bracket-button')
      .filter({ visible: true })
    await expect(bracket).toHaveAttribute(
      'title',
      "Can't bracket this list: unknown field (scene_filter.curator_appeal)",
      { timeout: 20_000 },
    )
    await expect(bracket).toBeDisabled()

    await page.goto(curatorFilter('/performers', 'curator_affinity'))
    await expect(bracket).toHaveAttribute(
      'title',
      "Can't bracket this list: unknown field (performer_filter.curator_affinity)",
      { timeout: 20_000 },
    )
    await expect(bracket).toBeDisabled()
  })

  test("Cherry Pick's page offers to hide Your score on cards, and Hide on cards keeps it on scene pages only", async ({
    page,
  }) => {
    const before = await pluginConfig()
    const banners = page.locator('.scene-card .cherrypick-score-banner')
    try {
      await page.goto('/scenes?sortby=title&perPage=120')
      await expect(banners.first()).toBeVisible({ timeout: 20_000 })

      await page.goto('/plugins/cherrypick')
      const card = page.locator('#your-score .cherrypick-curator-offer')
      await expect(card).toContainText('Stash Curator also scores your cards', {
        timeout: 20_000,
      })
      await card.getByRole('button', { name: 'Hide on cards' }).click()
      await expect(card).toContainText('Your score is off on cards')
      await expect
        .poll(answered)
        .toEqual({ badges: false, curatorOffer: JSON.stringify('hide') })

      // Not offered again once the page knows the answer: the accuracy line
      // comes after the configuration and the library
      await page.reload()
      await expect(page.locator('#your-score')).toContainText(
        /within half a star \d+ times in 10/,
        { timeout: 20_000 },
      )
      await expect(offer(page)).toHaveCount(0)

      // No Your score on the Scenes list, once the model that draws them is
      // in (Bracket's title counts the list's scenes)
      await page.goto('/scenes?sortby=title&perPage=120')
      await expect(
        page.locator('.cherrypick-bracket-button').filter({ visible: true }),
      ).toHaveAttribute('title', / scenes in this list/, {
        timeout: 20_000,
      })
      await expect(
        page.locator('.scene-card .curator-scene-card-badge').first(),
      ).toBeVisible({ timeout: 20_000 })
      await expect(banners).toHaveCount(0)

      // It stays beside the stars on the scene page
      await page.goto(
        `/scenes/${demoScene(demo, { rated: false, played: true })}`,
      )
      await expect(
        page
          .locator(
            '.scene-toolbar .cherrypick-score-line .cherrypick-line-button',
          )
          .first(),
      ).toHaveText(/^likely .* for you$/, { timeout: 20_000 })

      // Settings › Plugins shows the switch off, and no offer
      const badges = await cherryPickSettings(page)
      await expect(badges).not.toBeChecked()
      await expect(offer(page)).toHaveCount(0)
    } finally {
      await setPluginSettings(PLUGIN_ID, before)
    }
  })

  test('Settings › Plugins offers it too, and its answer survives the next switch there', async ({
    page,
  }) => {
    const before = await pluginConfig()
    try {
      // Cherry Pick writes its defaults at first load, as it would long
      // before anyone opens Settings
      await page.goto('/plugins/cherrypick')
      await expect(offer(page)).toBeVisible({ timeout: 20_000 })
      await expect.poll(async () => (await pluginConfig())?.badges).toBe(true)

      const badges = await cherryPickSettings(page)
      await expect(badges).toBeChecked()
      const row = page.locator('#plugin-CherryPick-curator-offer')
      await expect(row).toContainText('Stash Curator also scores your cards', {
        timeout: 20_000,
      })
      await row.getByRole('button', { name: 'Hide on cards' }).click()
      await expect(badges).not.toBeChecked()
      await expect(row).toHaveCount(0)
      await expect
        .poll(answered)
        .toEqual({ badges: false, curatorOffer: JSON.stringify('hide') })

      // Stash's page writes back its copy of the map on any switch: the
      // copy carries the answer
      // (Bootstrap draws the switch over its input, so the click is forced)
      await page
        .locator('#plugin-CherryPick-relativeBadges')
        .check({ force: true })
      await expect
        .poll(async () => (await pluginConfig())?.relativeBadges)
        .toBe(true)
      expect(await answered()).toEqual({
        badges: false,
        curatorOffer: JSON.stringify('hide'),
      })

      await page.reload()
      await expect(badges).not.toBeChecked({ timeout: 20_000 })
      await expect(row).toHaveCount(0)
    } finally {
      await setPluginSettings(PLUGIN_ID, before)
    }
  })

  test('Keep both leaves Your score on cards and the offer away', async ({
    page,
  }) => {
    const before = await pluginConfig()
    try {
      await page.goto('/plugins/cherrypick')
      await offer(page).getByRole('button', { name: 'Keep both' }).click({
        timeout: 20_000,
      })
      await expect(offer(page)).toHaveCount(0)
      await expect
        .poll(answered)
        .toEqual({ badges: true, curatorOffer: JSON.stringify('keep') })

      await page.reload()
      await expect(page.locator('#your-score')).toContainText(
        /within half a star \d+ times in 10/,
        { timeout: 20_000 },
      )
      await expect(offer(page)).toHaveCount(0)

      await page.goto('/scenes?sortby=title&perPage=120')
      await expect(
        page.locator('.scene-card .cherrypick-score-banner').first(),
      ).toBeVisible({ timeout: 20_000 })
    } finally {
      await setPluginSettings(PLUGIN_ID, before)
    }
  })
})

// Runs one of Restash's tasks as Settings › Tasks does, after setting its
// "Also mirror score to rating100" switch when `mirror` is given, and waits
// for it to finish
async function runRestash(task, mirror) {
  if (mirror != null)
    await setPluginSettings('restash', { mirrorToRating100: mirror })
  await gql(
    'mutation ($t: String!) { runPluginTask(plugin_id: "restash", task_name: $t) }',
    { t: task },
  )
  await expect
    .poll(async () => (await gql('{ jobQueue { id } }')).jobQueue?.length, {
      timeout: 120_000,
    })
    .toBeFalsy()
}

// Scenes by id, with the rating and custom fields
async function sceneState() {
  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: -1 }) { scenes { id rating100 custom_fields } } }',
  )
  return Object.fromEntries(findScenes.scenes.map((s) => [s.id, s]))
}

// Puts back each scene's rating as `before` had it
async function putBackScenes(before) {
  for (const s of Object.values(await sceneState())) {
    const was = before[s.id]
    if (!was || s.rating100 === was.rating100) continue
    await gql(
      'mutation ($i: SceneUpdateInput!) { sceneUpdate(input: $i) { id } }',
      { i: { id: s.id, rating100: was.rating100 } },
    )
  }
}

// A rating that is the record's Restash score
const isScore = (r) =>
  r.rating100 != null &&
  r.custom_fields?.restash_score != null &&
  Number(r.custom_fields.restash_score) === r.rating100

// The rated scenes Cherry Pick learns from: all but those whose rating is
// Restash's score
const learnedScenes = async () =>
  Object.values(await sceneState()).filter(
    (s) => s.rating100 != null && !isScore(s),
  ).length

// What Cherry Pick's page says it learns from
const learning = (n) => new RegExp(`Learning from\\s*${n} rated scenes`)

// Restash keeps its score in custom fields and, with its mirror on, writes
// it over Stash's rating. It has no UI of its own, so the checks run its
// tasks and watch what Cherry Pick learns and what Apply writes.
test.describe('beside Restash', () => {
  test.skip(
    companionPluginIds().length !== 1 ||
      !companionPluginIds().includes('restash'),
    'Restash is not installed alone (COMPANIONS=restash)',
  )

  test.beforeAll(async () => {
    await setUpCherryPick()
    await setPluginSettings('restash', { mirrorToRating100: false })
  })
  test.afterAll(async () => {
    await setPluginSettings('restash', { mirrorToRating100: false })
    await runRestash('Clear Restash Data')
    await tearDownCherryPick()
  })
  // A bracket left paused hides the list's Bracket button
  test.beforeEach(() => setPluginSettings(PLUGIN_ID, {}))

  test("with its mirror off, its scores leave every rating the user's", async ({
    page,
  }) => {
    const performers = await performerRatings()
    const scenes = await sceneState()
    await runRestash('Recompute All', false)
    const now = await performerState()
    // It scores every performer, into its own fields only
    for (const p of Object.values(now)) {
      expect(p.custom_fields.restash_score, p.name).toBeGreaterThanOrEqual(1)
      expect(Object.keys(p.custom_fields)).toEqual(
        expect.arrayContaining([
          'restash_score',
          'restash_raw',
          'restash_components',
          'restash_updated',
        ]),
      )
    }
    expect(await performerRatings()).toEqual(performers)
    for (const s of Object.values(await sceneState()))
      expect(s.rating100, s.id).toBe(scenes[s.id].rating100)
    // Cherry Pick learns from every rated scene but one that equals its
    // score by chance
    await page.goto('/plugins/cherrypick')
    await expect(page.locator('#your-score')).toContainText(
      learning(await learnedScenes()),
      { timeout: 20_000 },
    )
  })

  test('with its mirror on, Apply leaves every performer it mirrored alone, and says why', async ({
    page,
  }) => {
    const before = await performerState()
    const scenes = await sceneState()
    try {
      await runRestash('Recompute All', true)
      const now = await performerState()
      for (const p of Object.values(now))
        expect(isScore(p), `${p.name} carries Restash's score`).toBe(true)
      const learned = await learnedScenes()
      expect(learned).toBeLessThan(
        Object.values(scenes).filter((s) => s.rating100 != null).length,
      )
      await page.goto('/plugins/cherrypick')
      await expect(page.locator('#your-score')).toContainText(
        learning(learned),
        { timeout: 20_000 },
      )
      // with its mirror on, Restash writes Stash's ratings, so Apply bracket
      // ratings automatically starts off
      await expect
        .poll(async () => (await pluginConfig())?.autoApply)
        .toBe(false)

      const ratings = await performerRatings()
      const result = await playBracket(page)
      await result.locator('.cherrypick-apply-open').click()
      const apply = page.locator('.cherrypick-apply-modal')
      const rows = apply.locator('.cherrypick-apply-table tbody tr')
      await expect(rows.first()).toContainText("Restash's score")
      await expect(apply.locator('.cherrypick-apply-skipped')).toHaveCount(
        await rows.count(),
      )
      await expect(apply.locator('.cherrypick-apply-go')).toBeDisabled()
      expect(await performerRatings()).toEqual(ratings)
    } finally {
      await setPluginSettings('restash', { mirrorToRating100: false })
      await putBack(before)
      await putBackScenes(scenes)
    }
  })

  test('Apply and Undo check again for its mirror right before they write', async ({
    page,
  }) => {
    const before = await performerState()
    const scenes = await sceneState()
    // Apply's preview: with the mirror off, auto-apply would start on
    await setPluginSettings(PLUGIN_ID, { autoApply: false })
    try {
      // Restash mirrors while the preview is open: Apply writes nothing
      let result = await playBracket(page)
      await result.locator('.cherrypick-apply-open').click()
      let apply = page.locator('.cherrypick-apply-modal')
      let go = apply.locator('.cherrypick-apply-go')
      await expect(go).toBeEnabled()
      await runRestash('Recompute All', true)
      let ratings = await performerRatings()
      await go.click()
      await expect(page.locator('.cherrypick-applied').first()).toContainText(
        'another plugin rates',
      )
      expect(await performerRatings()).toEqual(ratings)

      await putBack(before)
      await putBackScenes(scenes)
      await setPluginSettings('restash', { mirrorToRating100: false })
      await setPluginSettings(PLUGIN_ID, { autoApply: false })

      // Restash mirrors over what Apply wrote: Undo leaves its scores
      result = await playBracket(page)
      await result.locator('.cherrypick-apply-open').click()
      apply = page.locator('.cherrypick-apply-modal')
      go = apply.locator('.cherrypick-apply-go')
      await expect(go).toBeEnabled()
      const unrated = await performerRatings()
      await go.click()
      const applied = page.locator('.cherrypick-applied').first()
      await expect(applied).toContainText('Applied')
      await expect
        .poll(async () => {
          const now = await performerRatings()
          return Object.keys(now).filter((id) => now[id] !== unrated[id]).length
        })
        .toBeGreaterThan(0)
      await runRestash('Recompute All', true)
      ratings = await performerRatings()
      await applied.getByRole('button', { name: 'Undo' }).click()
      await expect(applied).toContainText('another plugin rates')
      expect(await performerRatings()).toEqual(ratings)
    } finally {
      await setPluginSettings('restash', { mirrorToRating100: false })
      await putBack(before)
      await putBackScenes(scenes)
    }
  })
})
