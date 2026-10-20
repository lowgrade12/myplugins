import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, STASHDB_PREFIX } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import { barelyPlayed, behaviourOf } from '../../src/js/model/behaviour.js'
import {
  moreLikeThis,
  theirScenesYouDontHave,
} from '../../src/js/model/recs.js'
import {
  popularity,
  popularityLine,
  performerRankPhrase,
  niceTop,
} from '../../src/js/model/signals.js'
import { excludedTagIds } from '../../src/js/model/foryou.js'
import { isPlaceholderTag } from '../../src/js/model/util.js'
import {
  syntheticLibrary,
  syntheticStashdb,
  withBookkeepingTags,
} from './fixtures/synthetic.mjs'

const { input } = syntheticLibrary()
const plain = createEngine(buildDb(input)).compute({})
const dbs = buildDb({ ...input, stashdb: syntheticStashdb(input) })
const M = createEngine(dbs).compute({})
const STATE = {
  dontLearn: [],
  notInterested: [],
  settings: { excludedTags: '' },
}

const tags = (s) =>
  new Set(s.tags.filter((t) => !isPlaceholderTag(t)).map((t) => t.id))
function overlap(a, b) {
  const x = tags(a)
  const y = tags(b)
  const inter = [...x].filter((t) => y.has(t)).length
  return inter / (x.size + y.size - inter || 1)
}
const network = (s) => s.studio?.parent?.id || null

test('More like this, in your library: barely played scenes you own that are like this one', () => {
  let rows = 0
  for (const scene of plain.db.owned.slice(0, 40)) {
    const { inLibrary, notInLibrary } = moreLikeThis(plain, STATE, scene)
    assert.deepEqual(notInLibrary, [], 'nothing from StashDB without it')
    assert.ok(inLibrary.length <= 8)
    if (inLibrary.length) rows++
    for (let i = 0; i < inLibrary.length; i++) {
      const it = inLibrary[i]
      const s = it.scene
      assert.equal(s.owned, true)
      assert.notEqual(s.id, scene.id)
      assert.equal(plain.rating(s), null, 'not rated')
      assert.ok(barelyPlayed(s), 'barely played')
      const shared = s.performers.some((p) =>
        scene.performers.some((q) => q.id === p.id),
      )
      const studio =
        s.studio?.id === scene.studio?.id ||
        (!!network(scene) &&
          (network(s) === network(scene) || s.studio?.id === network(scene)))
      assert.ok(shared || studio || overlap(s, scene) >= 0.25, 'like this one')
      assert.match(
        it.reason,
        /^(Also stars .+|Also from .+|Shares \d+ tags with this one)/,
      )
      assert.equal(it.reason.endsWith(' · never played'), !s.local.play_count)
      assert.equal(
        it.reason.endsWith(' · not watched yet'),
        !!s.local.play_count && !behaviourOf(s),
      )
      if (i) assert.ok(inLibrary[i - 1].score >= it.score, 'best first')
    }
  }
  assert.ok(rows >= 20, `most scenes have some (${rows} of 40)`)
})

test("reasons give the performer's pronoun from their gender", () => {
  const lines = plain.db.owned
    .flatMap((s) => moreLikeThis(plain, STATE, s).inLibrary)
    .filter((it) => / on (her|his|their) scenes/.test(it.reason))
  assert.ok(lines.length > 0)
  for (const it of lines) {
    const p = plain.db.performers.get(it.key.slice(2))
    const want = { FEMALE: 'her', MALE: 'his' }[p.local.gender] || null
    if (want)
      assert.match(it.reason, new RegExp(` on ${want} scenes`), it.reason)
  }
})

test('More like this, not in your library: StashDB scenes with the same performers or studio', () => {
  let rows = 0
  for (const scene of M.db.owned.slice(0, 40)) {
    const { notInLibrary } = moreLikeThis(M, STATE, scene)
    assert.ok(notInLibrary.length <= 8)
    if (notInLibrary.length) rows++
    for (const it of notInLibrary) {
      const s = it.scene
      assert.equal(s.owned, false)
      assert.ok(s.id.startsWith(STASHDB_PREFIX))
      const shared = s.performers.some((p) =>
        scene.performers.some((q) => q.id === p.id),
      )
      const studio =
        s.studio?.id === scene.studio?.id ||
        (!!network(scene) &&
          (network(s) === network(scene) || s.studio?.id === network(scene)))
      assert.ok(shared || studio)
      assert.match(
        it.reason,
        /^(.+'s #\d+ on StashDB|Also stars |Among the 10 most popular at |Also from )/,
      )
      assert.match(it.key, /^[ps]:/)
    }
  }
  assert.ok(rows >= 20, `most scenes have some (${rows} of 40)`)
})

test('Not interested and excluded tags keep scenes out of both rows', () => {
  const scene = M.db.owned.find((s) => {
    const r = moreLikeThis(M, STATE, s)
    return r.inLibrary.length >= 2 && r.notInLibrary.length >= 2
  })
  const before = moreLikeThis(M, STATE, scene)
  const hiddenIds = [
    before.inLibrary[0].scene.id,
    before.notInLibrary[0].scene.id,
  ]
  const hidden = moreLikeThis(
    M,
    { ...STATE, notInterested: hiddenIds.map((sceneId) => ({ sceneId })) },
    scene,
  )
  for (const it of [...hidden.inLibrary, ...hidden.notInLibrary])
    assert.ok(!hiddenIds.includes(it.scene.id))

  const name = before.inLibrary[0].scene.tags.find(
    (t) => !isPlaceholderTag(t),
  ).name
  const state = { ...STATE, settings: { excludedTags: name.toUpperCase() } }
  const ex = excludedTagIds(M.db, state.settings.excludedTags)
  const kept = moreLikeThis(M, state, scene)
  for (const it of [...kept.inLibrary, ...kept.notInLibrary])
    assert.ok(!it.scene.tags.some((t) => ex.has(t.id)))
})

test("a performer's scenes you don't have, in StashDB's popularity order", () => {
  const p = M.db.localPerformers.find(
    (x) =>
      x.popularSceneIds &&
      x.popularSceneIds.some((id) => !M.db.scenes.get(id)?.owned),
  )
  const items = theirScenesYouDontHave(M, STATE, p)
  assert.ok(items.length > 0)
  const order = items.map((it) => p.popularSceneIds.indexOf(it.scene.id))
  assert.deepEqual(
    order,
    order.slice().sort((a, b) => a - b),
  )
  for (const it of items) {
    assert.equal(it.scene.owned, false)
    assert.equal(it.key, 'p:' + p.id)
    assert.match(
      it.reason,
      /^#\d+ of (her|his|their) [\d,]+ scenes on StashDB( \(top \d+%\))?$/,
    )
  }
  // without their StashDB scene count the line still reads
  const noCount = { ...p, sceneCount: null }
  for (const it of theirScenesYouDontHave(M, STATE, noCount))
    assert.match(
      it.reason,
      /^#\d+ of (her|his|their) scenes on StashDB( \(top \d+%\))?$/,
    )
  // a performer without a popularity order: their StashDB scenes, best known rank first
  const q = M.db.localPerformers.find(
    (x) =>
      !x.popularSceneIds && x.sceneIds.some((id) => !M.db.scenes.get(id).owned),
  )
  for (const it of theirScenesYouDontHave(M, STATE, q)) {
    assert.equal(it.scene.owned, false)
    assert.match(it.reason, /most popular on StashDB$|on StashDB$/)
  }
})

test('popularity lines', () => {
  assert.equal(niceTop(0.004), 1)
  assert.equal(niceTop(0.03), 5)
  assert.equal(niceTop(0.6), null)
  const held = M.db.owned.find((s) => s.heldBy)
  const pop = popularity(M.db, held)
  assert.match(pop.held, /^Held by ~[\d,]+ StashDB users$/)
  const ranked = M.db.owned.find((s) => M.db.performerRank.get(s.id))
  const pr = popularity(M.db, ranked)
  assert.ok(pr.performer.rank >= 1)
  assert.ok(popularityLine(pr))
  assert.match(
    performerRankPhrase(pr),
    /^#\d+ of (her|his|their) [\d,]+ ?scenes on StashDB$/,
  )
  const bare = popularity(
    M.db,
    M.db.owned.find(
      (s) =>
        !s.heldBy &&
        !M.db.performerRank.get(s.id) &&
        !M.db.studioRank.get(s.id),
    ),
  )
  assert.equal(bare.held, null)
  assert.equal(popularityLine(bare), null)
  assert.equal(performerRankPhrase(bare), null)
})

test('More like this on a scene with no studio leaves studio-less scenes unrelated', () => {
  // Every scene loses its studio: before, "no studio" matched "no studio"
  // and the reason read the missing studio's id.
  const bare = {
    ...input,
    scenes: input.scenes.map((s) => ({ ...s, studio: null })),
  }
  const Mb = createEngine(buildDb(bare)).compute({})
  for (const scene of [...Mb.db.owned].slice(0, 40)) {
    const r = moreLikeThis(Mb, STATE, scene)
    for (const it of r.inLibrary) assert.doesNotMatch(it.reason, /^Also from/)
  }
})

test("More like this ignores other plugins' score and collection tags", () => {
  const Mm = createEngine(buildDb(withBookkeepingTags(input))).compute({})
  const rows = (E, scene) =>
    moreLikeThis(E, STATE, scene).inLibrary.map((it) => [
      it.scene.id,
      it.reason,
    ])
  for (const scene of plain.db.owned.slice(0, 40))
    assert.deepEqual(rows(Mm, Mm.db.scenes.get(scene.id)), rows(plain, scene))
})
