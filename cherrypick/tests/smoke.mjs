// A headless smoke test of Cherry Pick on your own Stash, run after
// `pnpm deploy:local cherrypick` (`pnpm smoke`). CI never runs it, since it
// needs that Stash and its library. It reads the same settings as
// deploy:local: STASH_URL, STASH_API_KEY_FILE when Stash has a login, and
// STASH_SSH_HOST with STASH_PLUGINS_DIR for the deployed bundle's hashes.
//
// It prints statuses and counts only, never a title, name, ID or message from
// the library, so its output is safe to paste anywhere. Page errors show
// their route and error type; reproduce one on a throwaway Stash for its text.
//
// The API key goes to Stash's origin only. Set as a context-wide header it
// would also reach StashDB, whose own ApiKey header it would replace.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'

const { STASH_URL, STASH_API_KEY_FILE, STASH_SSH_HOST, STASH_PLUGINS_DIR } =
  process.env
if (!STASH_URL) {
  console.error('Set STASH_URL (and STASH_API_KEY_FILE if Stash has a login)')
  process.exit(2)
}
const key = STASH_API_KEY_FILE
  ? (await readFile(STASH_API_KEY_FILE, 'utf8')).trim()
  : null
const origin = new URL(STASH_URL).origin
const root = new URL('../../../', import.meta.url)

// How many scene pages to check for More like this, out of how many tried
const SCENES = 5
const TRIES = 40
const WIDE = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

async function gql(query) {
  const res = await fetch(`${STASH_URL}/graphql`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key && { ApiKey: key }),
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`Stash's GraphQL answered ${res.status}`)
  const { data, errors } = await res.json()
  if (errors?.length) throw new Error(`${errors.length} GraphQL errors`)
  return data
}

// Playwright's messages can carry the page's address: keep the server's
// address and scene IDs out of the output
const scrub = (message) =>
  message
    .split('\n')[0]
    .replaceAll(origin, '$STASH_URL')
    .replace(/\/(scenes|performers)\/\d+/g, '/$1/:id')
    .slice(0, 200)

const results = []
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push(`ok   ${name}${detail ? ` (${detail})` : ''}`)
  } catch (e) {
    results.push(`FAIL ${name}: ${scrub(e.message)}`)
  }
  console.log(results.at(-1))
}
const skip = (name, why) => {
  results.push(`skip ${name}: ${why}`)
  console.log(results.at(-1))
}

// The deployed bundle is the one in dist/site, file for file
const bundle = 'deployed bundle matches dist/site'
if (!STASH_SSH_HOST || !STASH_PLUGINS_DIR)
  skip(bundle, 'set STASH_SSH_HOST and STASH_PLUGINS_DIR')
else
  await check(bundle, async () => {
    const entries = JSON.parse(
      await readFile(new URL('dist/entries.json', root), 'utf8').catch(() => {
        throw new Error('no dist/entries.json: run pnpm build first')
      }),
    )
    const { id } = entries.find((e) => e.folder === 'cherrypick')
    const dir = new URL(`dist/site/${id}/`, root)
    const local = new Map()
    for (const file of await readdir(dir))
      local.set(
        file,
        createHash('sha256')
          .update(await readFile(new URL(file, dir)))
          .digest('hex'),
      )
    // A missing file fails sha256sum but still hashes the rest
    const { stdout, code } = await promisify(execFile)('ssh', [
      '-o',
      'BatchMode=yes',
      STASH_SSH_HOST,
      `cd '${STASH_PLUGINS_DIR}/${id}' && sha256sum ${[...local.keys()].map((f) => `'${f}'`).join(' ')}`,
    ]).catch((e) => e)
    if (code === 255) throw new Error('ssh to STASH_SSH_HOST failed')
    // The remote shell may print terminal codes around the hashes
    const remote = new Map(
      [...stdout.matchAll(/^([0-9a-f]{64}) [ *](.+)$/gm)].map((m) => [
        m[2],
        m[1],
      ]),
    )
    const differ = [...local].filter(([f, h]) => remote.get(f) !== h)
    if (differ.length)
      throw new Error(
        `${differ.length} of ${local.size} files differ (${differ.map(([f]) => f).join(', ')}): run pnpm deploy:local cherrypick`,
      )
    return `${local.size} files`
  })

const browser = await chromium.launch()
// One context throughout, so Cherry Pick reads the library once
const context = await browser.newContext({ baseURL: STASH_URL, viewport: WIDE })
if (key)
  await context.route(
    (url) => url.origin === origin,
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), apikey: key },
      }),
  )
const page = await context.newPage()
const pageErrors = new Map()
page.on('pageerror', (e) => {
  const at = `${new URL(page.url()).pathname.replace(/\d+/g, ':id')}: ${e.name}`
  pageErrors.set(at, (pageErrors.get(at) ?? 0) + 1)
})
// Some markup renders twice (the navbar's for wide and narrow screens)
const visible = (selector, timeout = 30_000) =>
  page
    .locator(selector)
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout })

await check('front page: navbar cherries and For you', async () => {
  await page.goto('/')
  await visible('.navbar .cherrypick-nav-icon')
  // The first visit reads the whole library before For you can fill
  const cards = page.locator(
    '.cherrypick-for-you .slick-slide:not(.slick-cloned) .scene-card',
  )
  await cards.first().waitFor({ timeout: 120_000 })
  const rows = await page.locator('.cherrypick-front .cherrypick-row').count()
  return `${rows} Cherry Pick rows, ${await cards.count()} For you cards`
})

// A paused bracket shows its resume pill and Options in place of the button
for (const list of ['scenes', 'performers'])
  await check(`${list} list: bracket controls`, async () => {
    await page.goto(`/${list}`)
    await visible('.cherrypick-bracket-button, .cherrypick-bracket-ops')
  })

await check('plugin page survives a reload', async () => {
  await page.goto('/plugins/cherrypick')
  await visible('#your-score')
  await page.reload()
  await visible('#your-score')
})

await check('Settings › Plugins: the matches switch', async () => {
  await page.goto('/settings?tab=plugins')
  await visible('text=Learn from Ascension, HotOrNot and Xenith matches')
})

// More like this on the most played scenes: it fits the page, its slider's
// arrows stay on screen, and below Stash's xl breakpoint, where it follows
// the scene's tabs, it starts below everything in them.
let scenes = []
await check('scenes to try for More like this', async () => {
  const { findScenes } = await gql(
    `{ findScenes(filter: { per_page: ${TRIES}, sort: "play_count", direction: DESC }) { scenes { id } } }`,
  )
  scenes = findScenes.scenes.map((s) => s.id)
  if (!scenes.length) throw new Error('the library has no scenes')
  return `${scenes.length} scenes`
})
async function moreLikeThisFits(viewport) {
  await page.setViewportSize(viewport)
  let checked = 0
  // Each problem: on how many scenes, and the worst one
  const problems = new Map()
  const note = (problem, amount) => {
    if (amount <= 0) return
    const p = problems.get(problem) ?? { scenes: 0, worst: 0 }
    problems.set(problem, {
      scenes: p.scenes + 1,
      worst: Math.max(p.worst, amount),
    })
  }
  for (const id of scenes) {
    if (checked === SCENES) break
    await page.goto(`/scenes/${id}`)
    const shown = await page
      .locator('.cherrypick-more-like-this .slick-slider')
      .first()
      .waitFor({ timeout: 15_000 })
      .then(
        () => true,
        () => false,
      )
    if (!shown) continue
    // Let the slider and the tabs' cards settle
    await page.waitForTimeout(800)
    const m = await page.evaluate(() => {
      const tabs = document.querySelector('.scene-tabs')
      const mlt = document.querySelector('.cherrypick-more-like-this')
      if (!tabs) return null
      const bottom = Math.max(
        ...[...tabs.querySelectorAll('*')].map(
          (e) => e.getBoundingClientRect().bottom,
        ),
      )
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        offscreen: [...mlt.querySelectorAll('.slick-arrow')]
          .map((a) => a.getBoundingClientRect())
          .filter((r) => r.left < 0 || r.right > innerWidth).length,
        overlap:
          innerWidth < 1200
            ? Math.round(bottom - mlt.getBoundingClientRect().top)
            : 0,
      }
    })
    if (!m) throw new Error("Stash's .scene-tabs is gone")
    checked++
    note('px sideways scroll', m.overflow)
    note(' arrows off screen', m.offscreen)
    note('px over the tabs', m.overlap)
  }
  if (!checked)
    throw new Error(`none of ${scenes.length} scenes showed More like this`)
  if (problems.size)
    throw new Error(
      [...problems]
        .map(
          ([problem, p]) =>
            `up to ${p.worst}${problem} on ${p.scenes} of ${checked} scenes`,
        )
        .join('; '),
    )
  return `${checked} scenes`
}
for (const viewport of [WIDE, PHONE])
  await check(`scene pages at ${viewport.width}: More like this fits`, () =>
    moreLikeThisFits(viewport),
  )

await browser.close()

const errorCount = [...pageErrors.values()].reduce((a, b) => a + b, 0)
console.log(`page errors: ${errorCount}`)
for (const [at, n] of pageErrors) console.log(`  ${n}× ${at}`)
const count = (status) => results.filter((r) => r.startsWith(status)).length
const failed = count('FAIL')
console.log(
  `${count('ok')} ok, ${failed} failed, ${count('skip')} skipped, ${errorCount} page errors`,
)
process.exit(failed || errorCount ? 1 : 0)
