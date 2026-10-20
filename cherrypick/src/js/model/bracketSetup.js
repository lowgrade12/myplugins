// The choices around a bracket: which gender it starts with, which pool a
// choice resolves to and what the setup sheet remembers. Pure: the UI passes
// the model, the remembered choice (tier 1 bracketPrefs), the list's filter
// and each performer's live gender.
//
// The list's filter, as listFilter.js describes it, with the ids of what it
// matches once loaded: { active, gender, label, fullLabel, ids: Set|null }.
import * as BR from './brackets.js'
import { GENDERS, genderLabel } from './util.js'

export const GENDER_KEYS = GENDERS.map(([g]) => g)
const isGender = (g) => GENDER_KEYS.includes(g)

// A performer's gender in Stash right now: a Set genders tap made since the
// library was read, else the library's value. Never guessed.
export function liveGender(edits, p) {
  if (!p) return null
  if (edits && Object.prototype.hasOwnProperty.call(edits, p.id))
    return edits[p.id]
  return p.local ? (p.local.gender ?? null) : null
}

// Eligible performers per gender in the library: { FEMALE: 22, MALE: 7, ... }
export function poolCounts(M, genderOf) {
  return Object.fromEntries(
    GENDER_KEYS.map((g) => [
      g,
      BR.performerPool(M, { gender: g, pool: 'library' }, genderOf).length,
    ]),
  )
}

// The gender with the largest pool; ties go to Stash's order
export const dominantGender = (counts) =>
  GENDER_KEYS.reduce(
    (best, g) => ((counts[g] || 0) > (counts[best] || 0) ? g : best),
    GENDER_KEYS[0],
  )

// The choice to start from: the remembered gender (one the user picked that
// wasn't the largest pool), else the largest pool. The size always starts
// at 16: 32 and 64 are picked per bracket and never remembered.
export function prefs(saved, dominant) {
  const s = saved || {}
  return {
    pool: s.pool === 'favorites' || s.pool === 'filter' ? s.pool : 'library',
    size: BR.DEFAULT_SIZE,
    gender: isGender(s.gender) ? s.gender : dominant,
  }
}

// One click on the Performers list's Bracket: a filtered list becomes the
// pool, and the gender it filters on wins over the remembered one
export function quickChoice(saved, dominant, listFilter) {
  const c = prefs(saved, dominant)
  if (listFilter?.active) {
    c.pool = 'filter'
    if (isGender(listFilter.gender)) c.gender = listFilter.gender
  } else if (c.pool === 'filter') c.pool = 'library'
  return c
}

// The setup sheet's first choice. given: a choice handed over (from one
// click that could not fill the pool, or back from Set genders).
export function sheetChoice(saved, dominant, listFilter, given) {
  const c = { ...prefs(saved, dominant), ...(given || {}) }
  if (!given && listFilter?.active && isGender(listFilter.gender))
    c.gender = listFilter.gender
  if (c.pool === 'filter' && !listFilter?.active) c.pool = 'library'
  return c
}

// Why the sheet shows this gender, and whether to offer the way back to
// the largest pool. picked: the user tapped a gender chip in this sheet.
export function genderWhy({ choice, picked, dominant, saved, listFilter }) {
  const remembered = saved?.gender || null
  if (picked)
    return {
      text:
        choice.gender === dominant
          ? 'Your largest pool; picking it goes back to following the library'
          : 'Remembered for next time (across browsers)',
      forget: false,
    }
  if (
    listFilter?.active &&
    isGender(listFilter.gender) &&
    listFilter.gender === choice.gender
  )
    return { text: "From the Performers list's filter", forget: false }
  if (remembered && remembered === choice.gender)
    return {
      text: 'Remembered from your last pick',
      forget: remembered !== dominant,
    }
  return { text: `${genderLabel(dominant)}: your largest pool`, forget: false }
}

// What tier 1 keeps when a bracket starts from the sheet: the gender only
// when the user picked one, and not the largest pool (picking that goes back
// to following the library); the pool. Never the size.
export function rememberedPrefs(choice, pickedGender, saved, dominant) {
  const s = saved || {}
  const gender = pickedGender
    ? choice.gender === dominant
      ? null
      : choice.gender
    : s.gender || null
  return { gender, pool: choice.pool }
}

// The performers a choice puts in the bracket, the size it plays at (null
// when the pool can't fill 16) and the bracket's label. A filter pool is
// the list's matches among the eligible; until its ids load it is empty.
export function resolvePerformerPool(M, choice, listFilter, genderOf) {
  const usingFilter = choice.pool === 'filter' && !!listFilter?.active
  const pool = usingFilter
    ? 'filter'
    : choice.pool === 'favorites'
      ? 'favorites'
      : 'library'
  const ids = BR.performerPool(
    M,
    {
      gender: choice.gender,
      pool,
      filterIds: usingFilter ? listFilter.ids || new Set() : null,
    },
    genderOf,
  )
  // The filter's gender is already the bracket's: say it once
  const poolLabel = [
    genderLabel(choice.gender),
    pool === 'favorites'
      ? 'favorites'
      : pool === 'filter'
        ? listFilter.label || null
        : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return { ids, size: BR.resolveSize(choice.size, ids.length), pool, poolLabel }
}

// A clip pool: every scene a bracket can draw from (BR.bracketScenes), or
// those among ids (the scenes a list's filter matches)
export const scenePool = (M, ids) =>
  BR.bracketScenes(M)
    .filter((s) => !ids || ids.has(s.id))
    .map((s) => s.id)

// The distinct champions a Champions round seeds: ordinary brackets'
// champions of one gender still in the library
export function championsRoundPool(M, history, gender) {
  const ids = BR.championsOf(history, gender).filter(
    (id) => M.db.performers.get(id)?.local,
  )
  return { ids, size: BR.championsRoundSize(ids.length) }
}

// Placed performers or scenes of a finished bracket, best first
export const placedIds = (r) =>
  r
    ? [
        r.champion,
        r.finalist,
        ...(r.semifinalists || []),
        ...(r.quarterfinalists || []),
      ].filter(Boolean)
    : []

// A custom_fields input that puts fields back as they were: the old values
// in `partial`, and fields that did not exist in `remove`. prev: { field:
// value|null }.
export function restoreFieldsInput(prev) {
  const partial = {}
  const remove = []
  for (const [k, v] of Object.entries(prev || {}))
    if (v == null) remove.push(k)
    else partial[k] = v
  const out = {}
  if (Object.keys(partial).length) out.partial = partial
  if (remove.length) out.remove = remove
  return out
}
