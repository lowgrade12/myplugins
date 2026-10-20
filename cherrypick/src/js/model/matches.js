// Matches other plugins played. Ascension, HotOrNot_V3 and Xenith keep each
// record's recent matches in a custom field: a JSON list with the opponent's
// id and who won, the same thing a bracket pick says. With "Learn from
// Ascension, HotOrNot and Xenith matches" on, the engine replays them as
// picks (bt.js), oldest first, ahead of Cherry Pick's own and at a lower
// weight (BT.external).
//
// What each plugin writes (Ascension 1.4.1, HotOrNot_V3 3.1.0, Xenith 3.2.0):
//   - performer_record: Ascension's and HotOrNot_V3's last 30 performer
//     matches, { date, opponent: "<id>:<name>", won }, with AscRatingAfter
//     from Ascension and ratingAfter from HotOrNot. Xenith wrote it before
//     its field migration.
//   - scene_record: Ascension's last 30 scene matches, { date, opponentId,
//     won, ratingAfter, AscRatingAfter }.
//   - xenith_record: Xenith's last 50, for performers and scenes, { date,
//     opponent: "<id>:<name or title>", won, ratingAfter }.
// Ascension's Skip writes nothing and its draw is won: null; a skip is won:
// null in HotOrNot and { draw: true } with no won in Xenith; an unknown
// opponent is "0". None of them teaches anything.
// HotOrNot 1.0 and V2 keep only totals (hotornot_stats), so they add none.
//
// Every match lands in both players' records, written at most a few seconds
// apart, unless the older side has since dropped out of a full list.
// Xenith's first write to a record also copies its performer_record into
// xenith_record. A match counts once either way.

import { andList } from './util.js'

// The fields that hold match lists, in the order they are read: a match
// Xenith copied keeps the plugin that played it.
const FIELDS = ['performer_record', 'scene_record', 'xenith_record']

// How far apart the two sides of one match can be dated. Ascension writes
// both at once and Xenith gives them one date; HotOrNot writes the loser's
// after the winner's update returns, which a busy Stash can take seconds
// over. Only an entry from the other player's record can join a match, so a
// rematch inside the window still counts.
export const SAME_MATCH_MS = 30 * 1000

// Stash's ids are whole numbers
const ID = /^\d+$/

// A record's match list. Stash returns a custom field as the JSON text the
// plugin wrote; anything unreadable counts as no matches.
function entriesOf(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// The opponent's id: Ascension's scene matches name it in opponentId, every
// other list as "<id>:<name>". null for "0" and anything not an id.
function opponentOf(e) {
  const raw =
    e.opponentId ??
    (typeof e.opponent === 'string' ? e.opponent.split(':')[0] : null)
  const id = raw == null ? '' : String(raw).trim()
  return ID.test(id) && id !== '0' ? id : null
}

// The plugin that played a match: Xenith's own field, else Ascension (its
// entries carry AscRatingAfter), else HotOrNot
const sourceOf = (field, e) =>
  field === 'xenith_record'
    ? 'Xenith'
    : 'AscRatingAfter' in e
      ? 'Ascension'
      : 'HotOrNot'

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// Each won or lost entry, once per record that holds it
function entries(db) {
  const out = []
  const seen = new Set()
  const read = (kind, owner, fields, inLibrary) => {
    for (const field of FIELDS)
      for (const e of entriesOf(fields?.[field])) {
        if (!e || typeof e !== 'object' || typeof e.won !== 'boolean') continue
        const opponent = opponentOf(e)
        const at = Date.parse(e.date)
        if (!opponent || opponent === owner || !Number.isFinite(at)) continue
        if (!inLibrary(opponent)) continue
        // Xenith's copy of an older list
        const key = [owner, opponent, e.won, at].join('|')
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          kind,
          owner,
          winner: e.won ? owner : opponent,
          loser: e.won ? opponent : owner,
          at,
          source: sourceOf(field, e),
        })
      }
    seen.clear()
  }
  for (const p of db.localPerformers)
    read(
      'performer',
      p.id,
      p.local.custom_fields,
      (id) => !!db.performers.get(id)?.local,
    )
  for (const s of db.owned)
    read(
      'clip',
      s.id,
      s.local.custom_fields,
      (id) => !!db.scenes.get(id)?.owned,
    )
  return out
}

function collect(db) {
  const found = entries(db).sort(
    (a, b) =>
      a.at - b.at ||
      cmp(a.winner, b.winner) ||
      cmp(a.loser, b.loser) ||
      cmp(a.owner, b.owner),
  )
  // The two sides of one match: the same winner and loser, one from each
  // player's record, within SAME_MATCH_MS
  const open = new Map()
  const out = []
  for (const f of found) {
    const pair = `${f.kind}|${f.winner}|${f.loser}`
    const recent = (open.get(pair) || []).filter(
      (m) => f.at - m.at <= SAME_MATCH_MS,
    )
    open.set(pair, recent)
    const match = recent.find((m) => !m.sides.has(f.owner))
    if (match) {
      match.sides.add(f.owner)
      continue
    }
    const m = { ...f, sides: new Set([f.owner]) }
    recent.push(m)
    out.push(m)
  }
  return out.map(({ kind, winner, loser, source }) => ({
    kind,
    winner,
    loser,
    source,
  }))
}

const cache = new WeakMap()

/**
 * Every match another plugin recorded between two records in the library,
 * as picks for bt.js replay (each with its `source`), oldest first. Skips,
 * draws, unreadable entries and opponents not in the library are left out,
 * and a match both players recorded counts once. Read once per database.
 * @param {import('./db.js').Db} db
 * @returns {import('./bt.js').Decision[]}
 */
export function matchDecisions(db) {
  if (!cache.has(db)) cache.set(db, collect(db))
  return cache.get(db)
}

// "Ascension", "Ascension and Xenith", "Ascension, HotOrNot and Xenith"
export const sourcesText = (sources) => andList([...sources].sort())
