// Popularity, from StashDB (needs the user's key).

import { approx, pronoun } from './util.js'

// ---------------------------------------------------------------- popularity

// heldBy is approximate (distinct fingerprint submitters), so it is shown as
// "~840" and never used to rank. Ranks come from StashDB's POPULARITY order:
// globalPopularityRank, and each performer's / studio's popularSceneIds.
export function popularity(db, scene, contextPerformerId) {
  const out = {
    heldBy: scene.heldBy,
    held: scene.heldBy ? `Held by ${approx(scene.heldBy)} StashDB users` : null,
    global: scene.globalPopularityRank || null,
    performer: null,
    studio: null,
  }
  const pr = db.performerRank.get(scene.id) || []
  const pick =
    (contextPerformerId &&
      pr.find((x) => x.performerId === contextPerformerId)) ||
    pr.slice().sort((a, b) => topShare(db, a) - topShare(db, b))[0]
  if (pick) {
    const p = db.performers.get(pick.performerId)
    // `top` needs their StashDB scene count; without it (the StashDB layer
    // didn't get it) the line falls back to the rank alone
    out.performer = {
      performer: p,
      rank: pick.rank,
      top: p.sceneCount ? niceTop(pick.rank / p.sceneCount) : null,
      of: p.sceneCount,
    }
  }
  const sr = db.studioRank.get(scene.id)
  if (sr) out.studio = { studio: db.studios.get(sr.studioId), rank: sr.rank }
  return out
}

function topShare(db, x) {
  const p = db.performers.get(x.performerId)
  return x.rank / (p.sceneCount || 1)
}

export function niceTop(share) {
  for (const t of [1, 2, 5, 10, 25, 50]) if (share <= t / 100) return t
  return null
}

// One short line for a card
export function popularityLine(pop, contextPerformerId) {
  if (pop.performer && (contextPerformerId || !pop.global)) {
    const p = pop.performer.performer
    return pop.performer.top
      ? `Top ${pop.performer.top}% of ${p.name}'s scenes`
      : `#${pop.performer.rank} of ${p.name}'s scenes`
  }
  if (pop.global) return `#${pop.global} most popular on StashDB`
  if (pop.studio)
    return `#${pop.studio.rank} at ${pop.studio.studio.name} on StashDB`
  return null
}

export function performerRankPhrase(pop) {
  if (!pop.performer) return null
  const p = pop.performer.performer
  // without their StashDB scene count: "#3 of her scenes on StashDB"
  const of = p.sceneCount ? `${p.sceneCount.toLocaleString('en-US')} ` : ''
  return `#${pop.performer.rank} of ${pronoun(p)} ${of}scenes on StashDB`
}
