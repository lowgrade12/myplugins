// Small helpers the model shares: which tags count, a scene's rating, the
// local calendar day, and the short phrases reasons are built from.

// Tags that describe the file or the release rather than the content.
// The model ignores them (users' own placeholder tags look like the last regex).
const META_TAGS = new Set([
  'Professional Production',
  '4K Available',
  'Full HD Available',
  'HD Available',
  'Trailer',
  'Photos',
  'Redistribution',
  'Exclusive',
  'Series',
  'Behind the Scenes',
])
export function isPlaceholderTag(tag) {
  if (!tag || !tag.name) return true
  if (META_TAGS.has(tag.name)) return true
  if (/^Award Winner/.test(tag.name)) return true
  if (
    /^[[_(#!.~-]|^(todo|tbd|unsorted|unorganized|placeholder)/i.test(tag.name)
  )
    return true
  // Other plugins' bookkeeping: Advanced Rating's score tags ("Production
  // Quality ★: 4", which Binge's stars write too) sit only on rated scenes
  // and spell out the rating; Binge's collections end in " 📁" ("Watch
  // Later 📁"). Advanced Rating's "Favourite ★" stays: it's the user's verdict.
  if (/ ★\s*:\s*[0-5]$/.test(tag.name) || tag.name.endsWith(' 📁')) return true
  return false
}

// rating100 (0..100) as stars
export const stars = (rating100) => (rating100 == null ? null : rating100 / 20)

// overrides: { sceneId: rating100|null }, ratings changed since the library
// was read (an applied batch, an undo), on top of Stash's own
export function sceneRating(scene, overrides) {
  if (!scene.owned) return null
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, scene.id))
    return overrides[scene.id]
  return scene.local.rating100
}

// The rating the model learns from: Stash's, unless another plugin set it
// (an Elo ranking, Restash's mirror, Ascension's Prime; rankings.js), which
// counts as none
export function ownRating(scene, overrides) {
  if (!scene.owned) return null
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, scene.id))
    return overrides[scene.id]
  return scene.local.ratingSource ? null : scene.local.rating100
}

// The calendar day of a timestamp in the browser's own time zone, so "came
// back on another day" follows the user's evenings, not UTC's midnight
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export const localDay = (iso) => dayFmt.format(new Date(iso))

export function timeAgo(iso, now = Date.now()) {
  const days = Math.round((now - Date.parse(iso)) / 86400000)
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30.4)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.round((days / 365) * 10) / 10
  return `${years} year${years === 1 ? '' : 's'} ago`
}

// "~840", "~1,300": heldBy is approximate, so show two significant figures
export function approx(n) {
  if (n == null) return ''
  const digits = Math.max(0, Math.floor(Math.log10(n)) - 1)
  const r = Math.round(n / 10 ** digits) * 10 ** digits
  return '~' + r.toLocaleString('en-US')
}

// Stash's six gender values, in Stash's own order, with its labels
export const GENDERS = [
  ['FEMALE', 'Female'],
  ['MALE', 'Male'],
  ['TRANSGENDER_FEMALE', 'Trans female'],
  ['TRANSGENDER_MALE', 'Trans male'],
  ['NON_BINARY', 'Non-binary'],
  ['INTERSEX', 'Intersex'],
]
export const genderLabel = (g) => GENDERS.find(([k]) => k === g)?.[1] || null

// Pronoun from the performer's gender in Stash (the UI plugs in the live
// value, after edits made since the library was read); "their" when Stash
// has none
const defaultGender = (p) => (p?.local ? p.local.gender : p?.stashdbGender)
let resolveGender = defaultGender
export const setGenderResolver = (fn) => (resolveGender = fn || defaultGender)
export function pronoun(performer) {
  const g = performer ? resolveGender(performer) : null
  if (g === 'FEMALE' || g === 'TRANSGENDER_FEMALE') return 'her'
  if (g === 'MALE' || g === 'TRANSGENDER_MALE') return 'his'
  return 'their'
}

// 4.25 -> "4.3": stars with one decimal, for reasons and badges
export const fmtStars = (x) => (Math.round(x * 10) / 10).toFixed(1)

// ["a", "b", "c"] -> "a, b and c"
export const andList = (items) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : items[0] || ''
