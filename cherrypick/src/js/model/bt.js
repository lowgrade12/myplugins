// Bracket picks as pairwise comparisons (Bradley–Terry with logistic updates).
//
// Each clip pick nudges three things, in star units:
//   - the two scenes' own offsets (winner up, loser down),
//   - the performers and studios only one side has (so similar scenes move too),
// by K · (1 − p), where p is the chance the model already gave the winner.
// A surprise moves things a lot; a pick the model expected barely moves them.
// Performer picks set performer affinity directly.
//
// Offsets are recomputed by replaying every pick in order, so Undo is just
// "drop the last pick and replay".
//
// Matches another plugin recorded (matches.js) replay the same way, first,
// at BT.external of a pick's K. Ascension, HotOrNot and Xenith are played as
// quick runs of one pair after another, and a record keeps its last 30 or
// 50: on a ranked library they outnumber Cherry Pick's picks many times
// over. At half weight a match still moves a scene or performer, and the
// user's own picks, deliberate and replayed last, keep the final say.

export const BT = {
  scale: 0.8, // stars per logit
  kScene: 0.38,
  kFeature: 0.12,
  kPerformer: 0.3,
  external: 0.5, // a match from another plugin, as a share of a pick
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x))
const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v)

/**
 * A pick, as the engine takes it (brackets.js modelDecisions makes them).
 * @typedef {object} Decision
 * @property {'performer'|'clip'} kind
 * @property {string} winner  performer or scene id
 * @property {string} loser
 * @property {string} [bracket]  the bracket's id
 * @property {string} [source]  the plugin that recorded it, for a match
 *   from another plugin's history ("Ascension", "HotOrNot", "Xenith")
 */

// Another plugin's matches for one scene or performer, and which plugins
const tally = (m, id, won, source) => {
  let t = m.get(id)
  if (!t) m.set(id, (t = { won: 0, lost: 0, sources: new Set() }))
  if (won) t.won++
  else t.lost++
  t.sources.add(source)
}

// ctx.baseScene(id) -> stars before brackets; ctx.keys(id) -> feature keys (p:/s:)
// ctx.basePerformer(id) -> performer affinity before brackets (stars)
// Returns the offsets, and for what the UI says about them: wins and losses
// in Cherry Pick's picks, the share of performerOffset those picks made,
// and other plugins' matches by scene and by performer.
export function replay(decisions, ctx) {
  const sceneOffset = new Map()
  const featureDelta = new Map()
  const performerOffset = new Map()
  const bracketPerformerOffset = new Map()
  const wins = new Map()
  const losses = new Map()
  const sceneMatches = new Map()
  const performerMatches = new Map()
  const keyCache = new Map()
  const keys = (id) => {
    if (!keyCache.has(id)) keyCache.set(id, ctx.keys(id))
    return keyCache.get(id)
  }
  const est = (id) =>
    ctx.baseScene(id) +
    (sceneOffset.get(id) || 0) +
    keys(id).reduce((s, k) => s + (featureDelta.get(k) || 0), 0)

  for (const d of decisions) {
    const w = d.source ? BT.external : 1
    if (d.source) {
      const m = d.kind === 'performer' ? performerMatches : sceneMatches
      tally(m, d.winner, true, d.source)
      tally(m, d.loser, false, d.source)
    } else {
      add(wins, d.winner, 1)
      add(losses, d.loser, 1)
    }
    if (d.kind === 'performer') {
      const aff = (id) => ctx.basePerformer(id) + (performerOffset.get(id) || 0)
      const g = w * (1 - sigmoid((aff(d.winner) - aff(d.loser)) / BT.scale))
      add(performerOffset, d.winner, BT.kPerformer * g)
      add(performerOffset, d.loser, -BT.kPerformer * g)
      if (!d.source) {
        add(bracketPerformerOffset, d.winner, BT.kPerformer * g)
        add(bracketPerformerOffset, d.loser, -BT.kPerformer * g)
      }
      continue
    }
    const g = w * (1 - sigmoid((est(d.winner) - est(d.loser)) / BT.scale))
    add(sceneOffset, d.winner, BT.kScene * g)
    add(sceneOffset, d.loser, -BT.kScene * g)
    const kw = new Set(keys(d.winner))
    const kl = new Set(keys(d.loser))
    const onlyW = [...kw].filter((k) => !kl.has(k))
    const onlyL = [...kl].filter((k) => !kw.has(k))
    for (const k of onlyW)
      add(featureDelta, k, (BT.kFeature * g) / Math.sqrt(onlyW.length))
    for (const k of onlyL)
      add(featureDelta, k, (-BT.kFeature * g) / Math.sqrt(onlyL.length))
  }
  return {
    sceneOffset,
    featureDelta,
    performerOffset,
    bracketPerformerOffset,
    wins,
    losses,
    sceneMatches,
    performerMatches,
    count: decisions.length,
  }
}
