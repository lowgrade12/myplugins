import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createTier1,
  fromConfig,
  toConfig,
} from '../../src/js/storage/tier1.js'
import {
  autoApplyToWrite,
  SETTING_DEFAULTS,
} from '../../src/js/storage/settings.js'

// A fake Stash (one plugin map), a fake browser mirror and a clock.
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

const state = (patch = {}) => ({
  ...fromConfig(null),
  ...patch,
})

test('a missing map reads as the defaults', () => {
  const s = fromConfig(null)
  assert.deepEqual(s.settings, SETTING_DEFAULTS)
  assert.deepEqual(s.notInterested, [])
  assert.equal(s.brackets.active, null)
})

test('toConfig and fromConfig round-trip', () => {
  const s = state({
    notInterested: [{ sceneId: '4' }],
    brackets: { active: { id: 'b1' }, history: [{ id: 'b0' }] },
  })
  assert.deepEqual(fromConfig(toConfig(s)), s)
})

test('writes are read-modify-write and keep keys the plugin did not change', async () => {
  const { server, tier1 } = rig()
  server.map = { showForYou: false, somethingElse: 1 }
  await tier1.save(toConfig(state({ dontLearn: [{ sceneId: '9' }] })), [
    'dontLearn',
  ])
  assert.equal(server.map.showForYou, false)
  assert.equal(server.map.somethingElse, 1)
  assert.equal(server.map.dontLearn, JSON.stringify([{ sceneId: '9' }]))
  assert.ok(server.map.updatedAt)
})

test('data keys are JSON text, so numbers in arrays survive a Stash restart', () => {
  const s = state({
    brackets: { active: null, history: [{ id: 'b1', size: 16, seeds: ['3'] }] },
  })
  const map = toConfig(s)
  assert.equal(typeof map.hallOfFame, 'string')
  assert.equal(fromConfig(map).brackets.history[0].size, 16)
  // An older map that holds the value itself still reads.
  assert.deepEqual(fromConfig({ dontLearn: [{ sceneId: '1' }] }).dontLearn, [
    { sceneId: '1' },
  ])
})

test("writes wait while Stash's Settings page is open, then land on top", async () => {
  const { server, open, tier1 } = rig({ settingsOpen: true })
  server.map = { updatedAt: '2025-12-31T00:00:00.000Z' }
  const full = toConfig(state({ dontLearn: [{ sceneId: '1' }] }))
  assert.equal(await tier1.save(full, ['dontLearn']), 'deferred')
  assert.equal(server.writes, 0)
  assert.deepEqual(tier1.pending(), ['dontLearn'])
  // The Settings page writes back its stale copy with a toggle.
  server.map = { updatedAt: server.map.updatedAt, badges: false }
  open.value = false
  await tier1.flush()
  assert.equal(server.map.badges, false)
  assert.deepEqual(fromConfig(server.map).dontLearn, [{ sceneId: '1' }])
  assert.deepEqual(tier1.pending(), [])
})

test("a deferred write never undoes a switch turned on Stash's Settings page", async () => {
  const { server, open, tier1 } = rig({ settingsOpen: true })
  server.map = { updatedAt: '2025-12-31T00:00:00.000Z', medals: true }
  // The plugin's copy, still with medals on, writing every key (a restore).
  const full = toConfig(state({ dontLearn: [{ sceneId: '1' }] }))
  assert.equal(full.medals, true)
  await tier1.save(full, Object.keys(full))
  // The user turns medals off; Stash writes its copy.
  server.map = { ...server.map, medals: false }
  open.value = false
  await tier1.flush()
  assert.equal(server.map.medals, false)
  assert.equal(server.map.showForYou, true, 'a missing setting is filled in')
  assert.deepEqual(fromConfig(server.map).dontLearn, [{ sceneId: '1' }])
})

test('a missing map is restored from the mirror', async () => {
  const { server, box, tier1 } = rig()
  await tier1.save(toConfig(state({ notInterested: [{ sceneId: '2' }] })), [
    'notInterested',
  ])
  server.map = null
  const { map, restored } = await tier1.load()
  assert.equal(restored, 'missing')
  assert.deepEqual(fromConfig(map).notInterested, [{ sceneId: '2' }])
  assert.ok(box.mirror)
})

test("a stale map gets the plugin's data back and keeps Stash's settings", async () => {
  const { server, tier1 } = rig()
  await tier1.save(toConfig(state({ dontLearn: [{ sceneId: '3' }] })), [
    'dontLearn',
  ])
  // Stash's Settings page wrote an older copy with a toggle changed.
  server.map = { updatedAt: '2025-01-01T00:00:00.000Z', medals: false }
  const { map, restored } = await tier1.load()
  assert.equal(restored, 'stale')
  assert.equal(map.medals, false)
  assert.deepEqual(fromConfig(map).dontLearn, [{ sceneId: '3' }])
})

test('a write after a stale copy writes back every data key', async () => {
  const { server, tier1 } = rig()
  await tier1.save(toConfig(state({ dontLearn: [{ sceneId: '3' }] })), [
    'dontLearn',
  ])
  server.map = { updatedAt: '2025-01-01T00:00:00.000Z' }
  await tier1.save(toConfig(state({ dontLearn: [{ sceneId: '3' }] })), [
    'consent',
  ])
  assert.deepEqual(fromConfig(server.map).dontLearn, [{ sceneId: '3' }])
})

test("removal leaves a tombstone that other browsers' mirrors respect", async () => {
  const a = rig()
  await a.tier1.save(toConfig(state({ dontLearn: [{ sceneId: '5' }] })), [
    'dontLearn',
  ])
  const otherMirror = structuredClone(a.box.mirror)
  await a.tier1.remove()
  assert.ok(a.server.map.removedAt)
  assert.equal(a.box.mirror, null)
  // Another browser still holds a mirror from before the removal.
  a.box.mirror = otherMirror
  const { map, restored } = await a.tier1.load()
  assert.deepEqual(fromConfig(map).dontLearn, [])
  assert.equal(restored, null)
  assert.equal(a.box.mirror, null)
})

test('a staged change reaches the mirror at once and is restored at the next load', async () => {
  const { server, box, tier1 } = rig()
  await tier1.save(toConfig(state()), ['dontLearn'])
  tier1.stage(toConfig(state({ dontLearn: [{ sceneId: '8' }] })), ['dontLearn'])
  assert.deepEqual(fromConfig(box.mirror).dontLearn, [{ sceneId: '8' }])
  // The tab closed before the save: Stash's map is older than the mirror.
  const { map, restored } = await tier1.load()
  assert.equal(restored, 'stale')
  assert.deepEqual(fromConfig(map).dontLearn, [{ sceneId: '8' }])
  assert.deepEqual(fromConfig(server.map).dontLearn, [])
})

test('the first write after a removal keeps the tombstone', async () => {
  const a = rig()
  await a.tier1.save(toConfig(state({ dontLearn: [{ sceneId: '5' }] })), [
    'dontLearn',
  ])
  const otherMirror = structuredClone(a.box.mirror)
  await a.tier1.remove()
  await a.tier1.save(toConfig(state()), ['notInterested'])
  assert.ok(a.server.map.removedAt)
  assert.deepEqual(fromConfig(a.server.map).dontLearn, [])
  a.box.mirror = otherMirror
  const { map } = await a.tier1.load()
  assert.deepEqual(fromConfig(map).dontLearn, [])
  assert.equal(a.box.mirror, null)
})

test('Apply bracket ratings automatically: on unless another plugin manages ratings, until the user sets it', () => {
  assert.equal(SETTING_DEFAULTS.autoApply, true)
  const w = (value, wrote, managed) =>
    autoApplyToWrite({ value, wrote, managed })
  // first load: the default
  assert.equal(w(undefined, null, false), true)
  assert.equal(w(null, null, true), false, 'Ascension and the like: off')
  // untouched since Cherry Pick wrote it: it follows the plugins
  assert.equal(w(true, true, true), false, 'a ranking plugin turned on since')
  assert.equal(w(false, false, false), true, 'and turned off again')
  assert.equal(w('true', true, true), false, 'a value Stash returns as text')
  assert.equal(w(true, true, false), null, 'nothing to change')
  // the user set it: theirs
  assert.equal(w(false, true, false), null)
  assert.equal(w(true, false, true), null)
  // a map from before the setting's rule was kept: theirs as well
  assert.equal(w(true, null, true), null)
})
