// The plugin's manifest settings: what Stash's Settings › Plugins renders and
// saves. Keep in step with src/CherryPick.yml (a unit test checks).
// Stash stores nothing for a setting the user never touched, so `def` is what
// a missing value means.
export const MANIFEST_SETTINGS = [
  // off by default: Cherry Pick's front-page rows, unless the user asks for
  // one scene ready to play in their place (features/watchThis.jsx)
  { key: 'watchThis', type: 'BOOLEAN', def: false },
  { key: 'showForYou', type: 'BOOLEAN', def: true },
  { key: 'showFollowRows', type: 'BOOLEAN', def: true },
  { key: 'showHallOfFame', type: 'BOOLEAN', def: true },
  { key: 'showMoreLikeThis', type: 'BOOLEAN', def: true },
  { key: 'outOfLibrary', type: 'BOOLEAN', def: true },
  { key: 'badges', type: 'BOOLEAN', def: true },
  { key: 'sceneLine', type: 'BOOLEAN', def: true },
  { key: 'medals', type: 'BOOLEAN', def: true },
  { key: 'performerLine', type: 'BOOLEAN', def: true },
  { key: 'relativeBadges', type: 'BOOLEAN', def: false },
  { key: 'excludedTags', type: 'STRING', def: '' },
  { key: 'learnFromMatches', type: 'BOOLEAN', def: true },
  { key: 'learnFromRankings', type: 'BOOLEAN', def: false },
  // written at first load by autoApplyToWrite, which can make it false
  { key: 'autoApply', type: 'BOOLEAN', def: true },
]
export const SETTING_KEYS = MANIFEST_SETTINGS.map((s) => s.key)
export const SETTING_DEFAULTS = Object.fromEntries(
  MANIFEST_SETTINGS.map((s) => [s.key, s.def]),
)

/**
 * Apply bracket ratings automatically: what to write, or null to leave it.
 * It starts on, unless another plugin manages Stash's ratings (Ascension,
 * HotOrNot, Xenith, or Restash with its mirror on), whose rankings would
 * take up every rating applied without a preview. Cherry Pick keeps
 * following that rule while the switch holds the value it last wrote
 * (`wrote`, the autoApplyDefault key), so installing or removing such a
 * plugin moves it; once the user sets it otherwise, it is theirs.
 * @param {{ value: unknown, wrote: boolean|null, managed: boolean }} input
 * @returns {boolean|null}
 */
export function autoApplyToWrite({ value, wrote, managed }) {
  const want = !managed
  const v = value === 'true' ? true : value === 'false' ? false : value
  if (v == null) return want
  if (wrote != null && v === wrote && want !== wrote) return want
  return null
}

// Stash keeps a plugin's settings in a map, so Settings › Plugins lists them
// in no fixed order; Cherry Pick sorts its own into the manifest's.
export function inManifestOrder(settings) {
  const rank = new Map(SETTING_KEYS.map((k, i) => [k, i]))
  return [...settings].sort(
    (a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99),
  )
}
