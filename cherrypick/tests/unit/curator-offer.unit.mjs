import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANSWERS,
  answerSettings,
  curatorEnabled,
  offersToHide,
} from '../../src/js/model/curator.js'
import {
  createTier1,
  DATA_KEYS,
  fromConfig,
  toConfig,
  withCuratorAnswer,
} from '../../src/js/storage/tier1.js'

// A fake Stash (one plugin map), a fake browser mirror and a clock, as in
// tier1.unit.mjs.
function rig({ settingsOpen = false } = {}) {
  const server = { map: null, writes: 0 }
  const box = { mirror: null }
  let t = 0
  const open = { value: settingsOpen }
  const tier1 = createTier1({
    read: async () => (server.map ? structuredClone(server.map) : null),
    write: async (map) => {
      server.map = structuredClone(map)
      server.writes++
    },
    mirror: {
      get: () => box.mirror,
      set: (m) => (box.mirror = structuredClone(m)),
      del: () => (box.mirror = null),
    },
    settingsOpen: () => open.value,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString(),
  })
  return { server, box, open, tier1 }
}

// The plugin's state with an answer, and the settings it changes
const answered = (answer) => {
  const s = fromConfig(null)
  return {
    ...s,
    curatorOffer: answer,
    settings: { ...s.settings, ...answerSettings(answer) },
  }
}

// Stash's plugins query, as Stash Curator 0.36.0 shows in it
const CURATOR = { id: 'stash-curator', name: 'Stash Curator', enabled: true }
const CHERRY = { id: 'CherryPick', name: 'Cherry Pick', enabled: true }

test('Curator counts when installed and enabled, by id or by name', () => {
  assert.equal(curatorEnabled([CHERRY, CURATOR]), true)
  assert.equal(curatorEnabled([CHERRY, { ...CURATOR, enabled: false }]), false)
  assert.equal(curatorEnabled([CHERRY]), false)
  assert.equal(curatorEnabled(null), false)
  // A fork that renames the manifest keeps the name
  assert.equal(
    curatorEnabled([
      { id: 'curator-fork', name: 'Stash Curator', enabled: true },
    ]),
    true,
  )
  // Other plugins with "curator" further in their names do not count
  assert.equal(
    curatorEnabled([{ id: 'tag-curator', name: 'Tag Curator', enabled: true }]),
    false,
  )
})

test('the offer shows beside Curator while Your score is on cards and unanswered', () => {
  assert.equal(
    offersToHide({ curator: true, badges: true, answer: null }),
    true,
  )
  // Stash not asked yet, or no Curator
  assert.equal(
    offersToHide({ curator: null, badges: true, answer: null }),
    false,
  )
  assert.equal(
    offersToHide({ curator: false, badges: true, answer: null }),
    false,
  )
  // The switch already off: nothing to hide
  assert.equal(
    offersToHide({ curator: true, badges: false, answer: null }),
    false,
  )
  // Answered either way: never again
  for (const answer of ANSWERS)
    assert.equal(offersToHide({ curator: true, badges: true, answer }), false)
})

test('Hide on cards turns the badges switch off; Keep both changes no setting', () => {
  assert.deepEqual(answerSettings('hide'), { badges: false })
  assert.deepEqual(answerSettings('keep'), {})
})

test('a missing map has no answer, and an answer round-trips as JSON text', () => {
  assert.equal(fromConfig(null).curatorOffer, null)
  assert.ok(DATA_KEYS.includes('curatorOffer'))
  for (const answer of ANSWERS) {
    const map = toConfig(answered(answer))
    assert.equal(map.curatorOffer, JSON.stringify(answer))
    assert.equal(fromConfig(map).curatorOffer, answer)
  }
  assert.equal(toConfig(fromConfig(null)).curatorOffer, null)
})

test("answered on Stash's Settings page, the page's copy carries the answer and the switch", () => {
  // The copy Stash's Settings page loaded, with the plugin's data in it
  const loaded = {
    ...toConfig(fromConfig(null)),
    notInterested: JSON.stringify([{ sceneId: '4' }]),
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const hide = withCuratorAnswer(loaded, 'hide', answerSettings('hide'))
  assert.equal(hide.badges, false)
  assert.equal(hide.sceneLine, true, 'Your score stays on scene pages')
  assert.equal(fromConfig(hide).curatorOffer, 'hide')
  assert.deepEqual(fromConfig(hide).notInterested, [{ sceneId: '4' }])
  assert.equal(hide.updatedAt, loaded.updatedAt)
  const keep = withCuratorAnswer(loaded, 'keep', answerSettings('keep'))
  assert.equal(keep.badges, true)
  assert.equal(fromConfig(keep).curatorOffer, 'keep')
})

test("Hide on cards off the Settings page writes the switch over Stash's value", async () => {
  const { server, tier1 } = rig()
  // Stash's map with the defaults Cherry Pick wrote at first load
  server.map = { ...toConfig(fromConfig(null)), updatedAt: 'x' }
  await tier1.save(
    toConfig(answered('hide')),
    ['curatorOffer', 'badges'],
    ['badges'],
  )
  assert.equal(server.writes, 1)
  assert.equal(server.map.badges, false)
  assert.equal(fromConfig(server.map).curatorOffer, 'hide')
  // Without the user's word, a setting Stash holds stays Stash's
  await tier1.save(toConfig(fromConfig(null)), ['badges'])
  assert.equal(server.map.badges, false)
})

test('a Hide deferred by the Settings page still turns the switch off when it lands', async () => {
  const { server, open, tier1 } = rig({ settingsOpen: true })
  server.map = { ...toConfig(fromConfig(null)), updatedAt: 'x' }
  await tier1.save(
    toConfig(answered('hide')),
    ['curatorOffer', 'badges'],
    ['badges'],
  )
  assert.equal(server.writes, 0)
  open.value = false
  await tier1.flush()
  assert.equal(server.map.badges, false)
  assert.equal(fromConfig(server.map).curatorOffer, 'hide')
})

test('an answer lost from the map comes back from the mirror', async () => {
  const { server, tier1 } = rig()
  await tier1.save(toConfig(answered('keep')), ['curatorOffer'])
  const { curatorOffer, ...lost } = server.map
  assert.equal(curatorOffer, JSON.stringify('keep'))
  server.map = lost
  const { map, restored } = await tier1.load()
  assert.equal(restored, 'missing')
  assert.equal(fromConfig(map).curatorOffer, 'keep')
})

test('Remove Cherry Pick data clears the answer, so the offer can return', async () => {
  const { server, tier1 } = rig()
  await tier1.save(
    toConfig(answered('hide')),
    ['curatorOffer', 'badges'],
    ['badges'],
  )
  await tier1.remove()
  const { map } = await tier1.load()
  const s = fromConfig(map)
  assert.equal(s.curatorOffer, null)
  assert.equal(s.settings.badges, true)
  assert.equal(
    offersToHide({
      curator: true,
      badges: s.settings.badges,
      answer: s.curatorOffer,
    }),
    true,
  )
  assert.deepEqual(Object.keys(server.map), ['removedAt'])
})
