// Ratings other plugins set. Ascension, HotOrNot and Xenith (a fork of
// Ascension 1.2.6) rank performers and scenes by Elo: every match writes the
// new score to Stash's own rating100 and the match history to custom fields.
// Ascension's Prime tasks give unrated records a random starting rating and
// mark nothing. Restash keeps a score in custom fields and, with its mirror
// on, writes it over rating100 too. None of these is a rating the user gave,
// so the model leaves them out, and Apply never writes over a ranked or
// mirrored record (the plugin owns that number).

// Custom fields that mark a record as ranked: the stats Ascension and
// HotOrNot keep, Ascension's match lists, the match count older HotOrNot
// builds kept, and Xenith's stats and match list. Xenith still reads the
// first two from libraries it has not migrated.
export const ELO_FIELDS = [
  'hotornot_stats',
  'elo_matches',
  'performer_record',
  'scene_record',
  'xenith_stats',
  'xenith_record',
]

// True when another plugin ranks this record (custom_fields as Stash
// returns them).
export function isRanked(customFields) {
  if (!customFields) return false
  return ELO_FIELDS.some(
    (k) => customFields[k] != null && customFields[k] !== '',
  )
}

// Restash's score, which its "Also mirror score to rating100" setting also
// writes to rating100 (writer.py). Its other fields (restash_raw,
// restash_components, restash_updated) are no ranking.
export const MIRROR_FIELD = 'restash_score'

// True when the record's rating is Restash's score: rating100 equals
// restash_score (Stash may return it as a number or a string). A rating
// that differs, or a record Restash never scored, is the user's.
export function isMirrored(rating100, customFields) {
  const score = customFields?.[MIRROR_FIELD]
  if (rating100 == null || score == null || score === '') return false
  return Number(score) === rating100
}

// Who set a record's rating, when a plugin did and marks it: 'elo' (a
// ranking plugin's score), 'mirror' (Restash's score) or null. rec:
// { rating100, custom_fields } as Stash returns them.
export function pluginRating(rec) {
  if (isRanked(rec.custom_fields)) return 'elo'
  if (isMirrored(rec.rating100, rec.custom_fields)) return 'mirror'
  return null
}

// Where a record's rating came from: 'elo' and 'mirror' (pluginRating),
// 'primed' (Ascension's Prime, see primedIds) or null (the user, or
// unrated). buildDb sets it on each record's `local`.

// ---------------------------------------------------------------- Prime

// Ascension's "Prime Unrated Performers" and "Prime Unrated Scenes" give 70%
// of the unrated records one shared random value in 1–9, 25% one shared
// value in 25–39 and 5% exactly 40 (asc_taskmaster.py: one draw per band,
// repeated). Nothing marks them, so the shape is the evidence.
const LOW = [1, 9]
const MID = [25, 39]
const TOP = 40
const SHARE = { low: 0.7, mid: 0.25, top: 0.05 }
// A value in 1–9 counts only when this many records share it: none of
// Stash's star settings lands there, so a person rating by hand rarely does.
export const PRIME_MIN_SHARED = 3
// A band holding more than this many times what Prime would have put there
// is the user's too, and stays theirs.
const SLACK = 1.5

const inBand = (v, [lo, hi]) => v >= lo && v <= hi
const sum = (pairs) => pairs.reduce((n, [, c]) => n + c, 0)

// The records in one group whose rating sits on Prime's values, or none
// when the group does not have Prime's shape. A 2★ set by hand among primed
// records reads as primed too: it looks just like Prime's 40.
function primedIn(rated) {
  const count = new Map()
  for (const r of rated)
    count.set(r.rating100, (count.get(r.rating100) || 0) + 1)
  const all = [...count]
  // One shared low value per Prime run; a second run draws another.
  const lows = all.filter(([v, n]) => inBand(v, LOW) && n >= PRIME_MIN_SHARED)
  if (!lows.length) return []
  const runs = lows.length
  // How many records the runs primed, at most: the low band holds 70%.
  const primed = (sum(lows) + runs) / SHARE.low
  const values = new Set(lows.map(([v]) => v))
  const mids = all
    .filter(([v]) => inBand(v, MID))
    .sort((a, b) => b[1] - a[1])
    .slice(0, runs)
  if (mids.length && sum(mids) <= SLACK * SHARE.mid * primed + 2 * runs)
    for (const [v] of mids) values.add(v)
  const top = count.get(TOP) || 0
  if (top && top <= SLACK * SHARE.top * primed + 2 * runs) values.add(TOP)
  // Prime fills two bands or three
  if (values.size === runs) return []
  const hits = rated.filter((r) => values.has(r.rating100))
  return hits.length * 2 > rated.length ? hits : []
}

/**
 * The records whose rating looks primed. Conservative: within a group (all
 * the rows, and each group groupOf names, such as a gender's performers) it
 * needs a value in 1–9 shared by PRIME_MIN_SHARED or more, at least two of
 * Prime's three bands, and Prime's values must cover more than half of the
 * group's ratings. Records another plugin ranks or mirrors must be left out
 * of `rows`: their rating is accounted for already.
 * @param {{ id: string, rating100: number|null }[]} rows
 * @param {(row: object) => string|null} [groupOf]
 * @returns {Set<string>}
 */
export function primedIds(rows, groupOf) {
  const rated = rows.filter((r) => r.rating100 != null && r.rating100 >= 1)
  const groups = [rated]
  if (groupOf) {
    const by = new Map()
    for (const r of rated) {
      const g = groupOf(r)
      if (!by.has(g)) by.set(g, [])
      by.get(g).push(r)
    }
    groups.push(...by.values())
  }
  const out = new Set()
  for (const list of groups) for (const r of primedIn(list)) out.add(r.id)
  return out
}

// Sets `local.ratingSource` on every record in `list`. localOf(record)
// returns the record's Stash fields ({ rating100, custom_fields }).
export function markRatingSources(list, localOf, groupOf) {
  const free = []
  for (const rec of list) {
    const local = localOf(rec)
    local.ratingSource = pluginRating(local)
    if (!local.ratingSource)
      free.push({ id: rec.id, rating100: local.rating100, rec })
  }
  const primed = primedIds(free, groupOf && ((r) => groupOf(r.rec)))
  for (const r of free)
    if (primed.has(r.id)) localOf(r.rec).ratingSource = 'primed'
}

// ---------------------------------------------------------------- installed

// Plugin ids as Stash reports them (a plugin's id is its manifest's file
// name): Ascension 1.4.1 ships ascension.yml and ascension-beta.yml,
// HotOrNot's builds hotornot.yml, hotOrNot.yml, hotOrNotV2.yml and
// hot_or_not.yml, and Xenith 3.2.0 xenith.yml. Names cover forks that rename
// the file.
const PLUGINS = [
  ['Ascension', /^ascension\b/i],
  ['HotOrNot', /^hot[\s_-]*or[\s_-]*not/i],
  ['Xenith', /^xenith\b/i],
]

const enabledAs = (plugins, re) =>
  (plugins || []).find(
    (p) => p.enabled && (re.test(p.id) || re.test(p.name || '')),
  )

// The ranking plugins installed and enabled, by name ("Ascension",
// "HotOrNot", "Xenith"), from Stash's `plugins` query. A plugin that is
// installed but disabled writes nothing, so it does not count.
export function rankingPlugins(plugins) {
  return PLUGINS.filter(([, re]) => enabledAs(plugins, re)).map(([n]) => n)
}

// Restash's id (restash.yml), and its "Also mirror score to rating100"
// setting
const RESTASH = /^restash\b/i
export const RESTASH_MIRROR = 'mirrorToRating100'

// The plugins writing Stash's ratings now, by name: the ranking plugins
// installed and enabled, and Restash when it is enabled with its mirror on.
// configs: Stash's configuration.plugins, each plugin's settings by its id.
export function ratingManagers(plugins, configs) {
  const out = rankingPlugins(plugins)
  const restash = enabledAs(plugins, RESTASH)
  const mirror = restash && configs?.[restash.id]?.[RESTASH_MIRROR]
  if (mirror === true || mirror === 'true') out.push('Restash')
  return out
}
