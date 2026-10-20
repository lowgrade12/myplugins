// What the performer pieces say, as pure functions: the For you line in a
// performer's details ("You average 4.9★ on her scenes · 3× champion · rising
// in your brackets") and the crown or medal on their card. performers.jsx
// renders them.
import { performerHonours } from '../model/brackets.js'
import { fmtStars, pronoun } from '../model/util.js'

// Stars of bracket offset before a performer counts as moving.
const MOVING = 0.05

// "her", "his" or "their", from a gender as Stash stores it.
const theirOf = (gender) => pronoun({ local: { gender: gender ?? null } })

/**
 * The For you line's parts, in order.
 * @param {object} input
 * @param {{ n: number, mean: number|null, watched: number }|null} [input.stats]
 *   how the user rates the performer's scenes (M.performerSceneStats)
 * @param {{ champion: number, finalist: number, challenger?: number }|null} [input.honours]
 *   finished performer brackets they won or reached the final of, and the
 *   Challenge rounds they won
 * @param {number} [input.offset]  how far bracket picks moved them, in stars
 *   (M.bt.bracketPerformerOffset: not other plugins' matches)
 * @param {string|null} [input.gender]  the performer's gender in Stash
 * @returns {string[]}
 */
export function performerLineParts({ stats, honours, offset = 0, gender }) {
  const their = theirOf(gender)
  const parts = []
  if (stats?.n >= 2 && stats.mean != null)
    parts.push(`You average ${fmtStars(stats.mean)}★ on ${their} scenes`)
  else if (stats?.n === 1 && stats.mean != null)
    parts.push(`You rated one of ${their} scenes ${fmtStars(stats.mean)}★`)
  else if (stats?.watched)
    parts.push(`You've watched ${stats.watched} of ${their} scenes`)
  if (honours?.champion)
    parts.push(
      honours.champion > 1
        ? `${honours.champion}× champion`
        : 'Bracket champion',
    )
  else if (honours?.finalist)
    parts.push(
      honours.finalist > 1
        ? `${honours.finalist}× finalist`
        : 'Bracket finalist',
    )
  if (honours?.challenger) parts.push('beat your favorites')
  if (Math.abs(offset) >= MOVING)
    parts.push(
      offset > 0 ? 'rising in your brackets' : 'slipping in your brackets',
    )
  return parts
}

// The whole line, or null when there is nothing to say.
export function performerLine(input) {
  const text = performerLineParts(input).join(' · ')
  return text ? text[0].toUpperCase() + text.slice(1) : null
}

// Honours by performer id, computed once per Hall of Fame (every card on a
// page asks).
const honoursCache = new WeakMap()
export function honoursOf(history) {
  if (!honoursCache.has(history))
    honoursCache.set(history, performerHonours(history))
  return honoursCache.get(history)
}

/**
 * The line for one performer.
 * @param {object|null} M  the engine's answers (null while the model loads:
 *   the line then has only the bracket honours)
 * @param {object[]} history  finished brackets (tier 1 hallOfFame)
 * @param {{ id: string, gender?: string|null }} performer  Stash's record
 */
export function performerLineFor(M, history, performer) {
  return performerLine({
    stats: M ? M.performerSceneStats(performer.id) : null,
    honours: honoursOf(history)[performer.id] || null,
    offset: M?.bt.bracketPerformerOffset.get(performer.id) || 0,
    gender: performer.gender,
  })
}

/**
 * The mark on a performer's card: a trophy for a champion who won a
 * Challenge round, a crown for any other champion (each with the count from
 * two titles), else a medal for a finalist; null for none.
 * @param {{ champion: number, finalist: number, challenger?: number }|null|undefined} honours
 * @returns {{ kind: 'challenger'|'champion'|'finalist', count: number|null, title: string }|null}
 */
export function honoursMark(honours) {
  if (honours?.challenger)
    return {
      kind: 'challenger',
      count: honours.champion > 1 ? honours.champion : null,
      title:
        honours.champion > 1
          ? `Bracket champion ×${honours.champion} who beat your favorites`
          : 'Bracket champion who beat your favorites',
    }
  if (honours?.champion)
    return {
      kind: 'champion',
      count: honours.champion > 1 ? honours.champion : null,
      title:
        honours.champion > 1
          ? `Bracket champion ×${honours.champion}`
          : 'Bracket champion',
    }
  if (honours?.finalist)
    return {
      kind: 'finalist',
      count: null,
      title:
        honours.finalist > 1
          ? `Bracket finalist ×${honours.finalist}`
          : 'Bracket finalist',
    }
  return null
}
