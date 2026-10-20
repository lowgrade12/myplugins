// Cherry Pick's test helpers, on top of the ones every plugin shares. Cherry
// Pick needs a library with ratings and plays, so its specs seed the demo
// library (demo-library.mjs) next to the shared one and remove it after.
import {
  demoIds,
  gql,
  setPluginSettings,
  usePlugins,
} from '../../../tests/stash/helpers.mjs'
import {
  DEMO,
  MARK,
  SPARSE,
  removeDemoLibrary,
  seedDemoLibrary,
} from './demo-library.mjs'

export * from '../../../tests/stash/helpers.mjs'
export { DEMO, SPARSE }

export const PLUGIN_ID = 'CherryPick'

// Cherry Pick alone, with a fresh configuration and the demo library (or
// the sparse one). Returns the shared library's ids (read before the demo
// library adds its own, since demoIds picks the first scene and performer
// it finds) and the demo library's. Both take no arguments: specs pass them
// to beforeAll, which reads a first parameter as fixtures.
async function setUp(sparse) {
  await usePlugins(PLUGIN_ID)
  await setPluginSettings(PLUGIN_ID, {})
  await removeDemoLibrary(gql)
  const shared = await demoIds()
  return { shared, demo: await seedDemoLibrary(gql, { sparse }) }
}
export const setUpCherryPick = () => setUp(false)
export const setUpSparseCherryPick = () => setUp(true)

// The shared clips' scenes, for Don't learn: they are all rated, and the
// sparse library's specs keep their ratings out of the model.
export async function sharedScenes() {
  const { findScenes } = await gql(
    '{ findScenes(filter: { per_page: -1 }) { scenes { id title details } } }',
  )
  return findScenes.scenes.filter((s) => s.details !== MARK)
}

export async function tearDownCherryPick() {
  await removeDemoLibrary(gql)
  await setPluginSettings(PLUGIN_ID, {})
}

// The plugin's configuration map as Stash holds it.
export async function pluginConfig() {
  const { configuration } = await gql('{ configuration { plugins } }')
  return configuration.plugins?.[PLUGIN_ID] ?? null
}

// A demo scene by what it is: rated or not, played or not, in the demo plan
// (or the sparse one).
export function demoScene(ids, { rated, played }, plan = DEMO) {
  const s = plan.scenes.find(
    (x) => !!x.rating100 === rated && !!x.plays.length === played,
  )
  return ids.scenes[s.title]
}

// Apply bracket ratings automatically, set as the user would. Off, the
// champion screen offers Apply to my ratings and its preview; on, closing
// the screen sets the ratings. Set it before the page loads.
export async function setAutoApply(on) {
  await setPluginSettings(PLUGIN_ID, {
    ...((await pluginConfig()) || {}),
    autoApply: on,
  })
}

// The demo performers a bracket counts as candidates: no rating of their
// own (with ownRatings false, as if every performer were unrated) and fewer
// than two rated scenes, which would anchor them at their average
export function demoCandidates({ ownRatings = true } = {}, plan = DEMO) {
  const ratedScenes = (name) =>
    plan.scenes.filter(
      (s) => s.performers.includes(name) && s.rating100 != null,
    ).length
  return new Set(
    plan.performers
      .filter((p) => !(ownRatings && p.rating100 != null))
      .filter((p) => ratedScenes(p.name) < 2)
      .map((p) => p.name),
  )
}

// One bracket pick with the keyboard: the candidate when one meets a rated
// performer, else the left side, so every candidate gets past its first
// match against a rated one and Apply always has a row to show
export async function pickCandidate(page, play, candidates) {
  const [a, b] = await play
    .locator('.cherrypick-contender .cherrypick-cont-title')
    .allInnerTexts()
  await page.keyboard.press(
    candidates.has(b) && !candidates.has(a) ? 'ArrowRight' : 'ArrowLeft',
  )
}

// The For you row is there once the library and the model are in.
export const forYouCards = (page) =>
  page.locator(
    '.cherrypick-for-you .slick-slide:not(.slick-cloned) .scene-card',
  )
