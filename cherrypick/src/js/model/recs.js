// Recommendation rows. Each item is { scene | performer, reason, key } where
// key is the feature that made it appear (what "Not interested" lowers).
// state: the RowState in foryou.js (notInterested, settings.excludedTags).

import { isPlaceholderTag, pronoun, fmtStars } from './util.js'
import { barelyPlayed, behaviourOf } from './behaviour.js'
import { popularity } from './signals.js'
import { excludedTagIds } from './foryou.js'

const tagSet = (s) =>
  new Set(s.tags.filter((t) => !isPlaceholderTag(t)).map((t) => t.id))
function jaccard(a, b) {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter || 1)
}

// p: the performer's record. (The mockup passed the scene's credit, which
// carries no gender, so the pronoun always came out "their".)
function performerTaste(M, p) {
  const st = M.stats.get('p:' + p.id)
  if (st && st.n >= 2)
    return `you average ${fmtStars(st.mean)}★ on ${pronoun(p)} scenes`
  if (M.db.favoritePerformerIds.has(p.id)) return 'a favorite of yours'
  return null
}

// A set per Not interested list, so each check is a lookup, not a scan
const hiddenSets = new WeakMap()
const hidden = (state, id) => {
  const list = state.notInterested
  let set = hiddenSets.get(list)
  if (!set) hiddenSets.set(list, (set = new Set(list.map((n) => n.sceneId))))
  return set.has(id)
}
// "Tags to keep out of my picks"
const keptOut = (ex, s) => ex.size && s.tags.some((t) => ex.has(t.id))

// ---------------------------------------------------------------- scene page

export function moreLikeThis(M, state, scene) {
  const db = M.db
  const ex = excludedTagIds(db, state.settings?.excludedTags)
  const tags = tagSet(scene)
  const perfIds = new Set(scene.performers.map((p) => p.id))
  const studioId = scene.studio?.id
  const parentId = scene.studio?.parent?.id

  const relate = (s) => {
    const shared = s.performers.filter((p) => perfIds.has(p.id))
    const sameStudio = studioId != null && s.studio?.id === studioId
    const sameParent =
      !!parentId &&
      (s.studio?.parent?.id === parentId || s.studio?.id === parentId)
    const jac = jaccard(tags, tagSet(s))
    const sim =
      1.0 * shared.length +
      (sameStudio ? 0.6 : sameParent ? 0.25 : 0) +
      1.5 * jac
    return { shared, sameStudio, sameParent, jac, sim }
  }

  // In your library: owned, barely played, similar, ranked by taste
  const inLib = []
  for (const s of db.owned) {
    if (
      s.id === scene.id ||
      hidden(state, s.id) ||
      keptOut(ex, s) ||
      M.rating(s) != null ||
      !barelyPlayed(s)
    )
      continue
    if (M.prediction(s.id).value < M.userMean - 0.6) continue
    const r = relate(s)
    if (!r.shared.length && !r.sameStudio && !r.sameParent && r.jac < 0.25)
      continue
    const score = M.prediction(s.id).value + 0.35 * r.sim
    let reason, key
    const best = r.shared
      .filter((p) => M.performerAffinity(p.id) > -0.05)
      .sort((a, b) => M.performerAffinity(b.id) - M.performerAffinity(a.id))[0]
    if (best) {
      const taste = performerTaste(M, db.performers.get(best.id) || best)
      reason = `Also stars ${best.name}` + (taste ? `; ${taste}` : '')
      key = 'p:' + best.id
    } else if (r.sameStudio || r.sameParent) {
      const st0 = r.sameStudio
        ? s.studio
        : { id: parentId, name: scene.studio.parent.name }
      const st = M.stats.get('s:' + st0.id)
      reason =
        `Also from ${st0.name}` +
        (st && st.n >= 2 ? `; you average ${fmtStars(st.mean)}★ there` : '')
      key = 's:' + st0.id
    } else {
      const n = [...tags].filter((t) => tagSet(s).has(t)).length
      reason = `Shares ${n} tags with this one`
      key = null
    }
    if (!s.local.play_count) reason += ' · never played'
    else if (!behaviourOf(s)) reason += ' · not watched yet'
    inLib.push({ scene: s, score, reason, key })
  }
  inLib.sort((a, b) => b.score - a.score)

  // Not in your library: same performers or studio on StashDB, taste + popularity
  const outLib = []
  for (const s of db.scenes.values()) {
    if (s.owned || hidden(state, s.id) || keptOut(ex, s)) continue
    const r = relate(s)
    if (!r.shared.length && !r.sameStudio && !r.sameParent) continue
    const pop = popularity(db, s, r.shared[0]?.id)
    const popRank = pop.performer?.rank ?? pop.studio?.rank ?? 12
    const popBoost =
      0.5 * (1 - (Math.min(popRank, 12) - 1) / 12) + (pop.global ? 0.25 : 0)
    const score = M.prediction(s.id).value + 0.3 * r.sim + popBoost
    let reason, key
    const best = r.shared
      .slice()
      .sort((a, b) => M.performerAffinity(b.id) - M.performerAffinity(a.id))[0]
    if (best) {
      const bp = popularity(db, s, best.id)
      const taste = performerTaste(M, db.performers.get(best.id) || best)
      reason =
        bp.performer && bp.performer.performer.id === best.id
          ? `${best.name}'s #${bp.performer.rank} on StashDB` +
            (taste ? `; ${taste}` : '')
          : `Also stars ${best.name}` + (taste ? `; ${taste}` : '')
      key = 'p:' + best.id
    } else {
      const st = s.studio
      reason =
        pop.studio && pop.studio.rank <= 10
          ? `Among the 10 most popular at ${pop.studio.studio.name} on StashDB`
          : `Also from ${r.sameStudio ? st.name : st.parent?.name || st.name}`
      key = 's:' + (r.sameStudio ? st.id : st.parent?.id || st.id)
    }
    outLib.push({ scene: s, score, reason, key })
  }
  outLib.sort((a, b) => b.score - a.score)

  return { inLibrary: inLib.slice(0, 8), notInLibrary: outLib.slice(0, 8) }
}

// ---------------------------------------------------------------- performer page

export function theirScenesYouDontHave(M, state, performer) {
  const db = M.db
  const ex = excludedTagIds(db, state.settings?.excludedTags)
  let ids = performer.popularSceneIds
  let ordered = true
  if (!ids) {
    // no popularity order from StashDB: their scenes StashDB sent, best known rank first
    ordered = false
    ids = performer.sceneIds
      .slice()
      .sort(
        (a, b) =>
          (db.scenes.get(a).globalPopularityRank || 1e9) -
          (db.scenes.get(b).globalPopularityRank || 1e9),
      )
  }
  return ids
    .map((id) => db.scenes.get(id))
    .filter((s) => s && !s.owned && !hidden(state, s.id) && !keptOut(ex, s))
    .map((s) => {
      const pop = popularity(db, s, performer.id)
      // "of her 412 scenes" needs their StashDB scene count; the StashDB
      // layer may not have it (the mockup always did)
      const of = performer.sceneCount
        ? `${performer.sceneCount.toLocaleString('en-US')} `
        : ''
      const reason =
        ordered && pop.performer
          ? `#${pop.performer.rank} of ${pronoun(performer)} ${of}scenes on StashDB` +
            (pop.performer.top ? ` (top ${pop.performer.top}%)` : '')
          : pop.global
            ? `#${pop.global} most popular on StashDB`
            : `${performer.name} on StashDB`
      return { scene: s, reason, key: 'p:' + performer.id }
    })
}
