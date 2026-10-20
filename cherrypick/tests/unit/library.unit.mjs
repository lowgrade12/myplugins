import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  keepFields,
  loadLibrary,
  REFRESH_MS,
} from '../../src/js/data/library.js'

// A fake Stash with n scenes and two performers that answers the library's
// queries, counting requests. Like Stash on a server at UTC-4, it reports
// updated_at in the server's zone, and its updated_at filter compares the
// text sent with that local time, so a filter in UTC finds nothing for four
// hours. It sorts by updated_at, last_played_at and last_o_at, newest first,
// then by id.
const local = (ms) =>
  new Date(ms - 4 * 3600e3).toISOString().slice(0, 19) + '-04:00'
function fakeStash(n) {
  const at = Date.parse('2026-01-01T00:00:00Z')
  const scenes = Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    title: `Scene ${i + 1}`,
    updated_at: local(at),
    last_played_at: null,
    o_history: [],
  }))
  const performers = [
    { id: '1', updated_at: local(at) },
    { id: '2', updated_at: local(at) },
  ]
  const tags = [{ id: '1', name: 'Tag' }]
  const studios = [{ id: '1', name: 'Studio', parent_studio: null }]
  const calls = []
  const time = {
    updated_at: (s) => Date.parse(s.updated_at),
    last_played_at: (s) =>
      s.last_played_at ? Date.parse(s.last_played_at) : -Infinity,
    last_o_at: (s) => Math.max(-Infinity, ...s.o_history.map(Date.parse)),
  }
  const run = async (query, vars) => {
    calls.push({
      ...vars,
      kind: query.includes('findScenes')
        ? 'scenes'
        : query.includes('findTags')
          ? 'lookups'
          : 'performers',
    })
    if (query.includes('findTags'))
      return { findTags: { tags }, findStudios: { studios } }
    const list = query.includes('findScenes') ? scenes : performers
    const field = query.includes('findScenes') ? 'findScenes' : 'findPerformers'
    const key = field === 'findScenes' ? 'scenes' : 'performers'
    let rows = list
    if (vars.ids) rows = rows.filter((s) => vars.ids.includes(s.id))
    const since = vars.scene_filter?.updated_at?.value
    if (since) rows = rows.filter((s) => s.updated_at.slice(0, 19) > since)
    const { per_page, page = 1, sort, direction } = vars.filter
    if (time[sort] && direction === 'DESC')
      rows = [...rows].sort(
        (a, b) => time[sort](b) - time[sort](a) || a.id - b.id,
      )
    const pageRows =
      per_page < 0
        ? rows
        : per_page
          ? rows.slice((page - 1) * per_page, page * per_page)
          : []
    return { [field]: { count: rows.length, [key]: pageRows } }
  }
  // An edit on Stash's own pages, a play or an O, at a moment
  const edit = (i, ms, change) => {
    scenes[i] = { ...scenes[i], ...change, updated_at: local(ms) }
  }
  const play = (i, ms) => {
    scenes[i] = { ...scenes[i], last_played_at: new Date(ms).toISOString() }
  }
  const addO = (i, ms) => {
    scenes[i] = {
      ...scenes[i],
      o_history: [...scenes[i].o_history, new Date(ms).toISOString()],
    }
  }
  // A bulk rewrite of every scene, as Restash's mirror does
  const touchAll = (ms) => {
    for (let i = 0; i < scenes.length; i++)
      scenes[i] = { ...scenes[i], updated_at: local(ms) }
  }
  const editPerformer = (i, ms, change) => {
    performers[i] = { ...performers[i], ...change, updated_at: local(ms) }
  }
  return {
    scenes,
    performers,
    run,
    calls,
    edit,
    play,
    addO,
    touchAll,
    editPerformer,
  }
}

const memCache = () => {
  const m = new Map()
  return { get: async (k) => m.get(k), set: async (k, v) => m.set(k, v) }
}

test('loads every page of scenes and performers', async () => {
  const stash = fakeStash(1234)
  const lib = await loadLibrary({ run: stash.run, cache: memCache() })
  assert.equal(lib.scenes.length, 1234)
  assert.equal(lib.performers.length, 2)
  assert.equal(lib.fromCache, false)
})

test('a fresh copy comes from the cache with no requests', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.calls.length = 0
  const lib = await loadLibrary({ run: stash.run, cache, now: now + 1000 })
  assert.equal(lib.fromCache, true)
  assert.equal(stash.calls.length, 0)
})

test('an older copy fetches only what changed', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.edit(3, now + 60e3, { title: 'Renamed' })
  const lib = await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 1000,
  })
  assert.equal(lib.fromCache, false)
  assert.equal(lib.scenes.find((s) => s.id === '4').title, 'Renamed')
  assert.equal(lib.scenes.length, 10)
})

test('progress is reported for a full read and not for an update', async () => {
  const stash = fakeStash(1234)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  const first = []
  await loadLibrary({
    run: stash.run,
    cache,
    now,
    onProgress: (p) => first.push(p),
  })
  assert.deepEqual(first.at(0), { kind: 'scenes', n: 500, of: 1234 })
  assert.deepEqual(first.at(-1), { kind: 'performers', n: 2, of: 2 })
  const update = []
  await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 1000,
    onProgress: (p) => update.push(p),
  })
  assert.deepEqual(update, [])
})

test('a deleted scene triggers a full reload', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.scenes.pop()
  const lib = await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 1000,
  })
  assert.equal(lib.scenes.length, 9)
})

test('a copy saved before scenes carried custom fields is read again in full', async () => {
  const stash = fakeStash(10)
  const now = Date.parse('2026-02-01T00:00:00Z')
  const cache = memCache()
  await cache.set('library', {
    version: 1,
    syncedAt: new Date(now).toISOString(),
    scenes: stash.scenes.slice(0, 3),
    performers: [],
  })
  const lib = await loadLibrary({ run: stash.run, cache, now: now + 1000 })
  assert.equal(lib.fromCache, false)
  assert.equal(lib.scenes.length, 10)
})

// Two minutes and more after a read, as a front-page visit refreshes
const later = (now, k = 1) => now + k * (REFRESH_MS + 1000)

test('on a server outside UTC, a rating edit reaches the next update', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.edit(2, now + 30e3, { rating100: 95 })
  const lib = await loadLibrary({ run: stash.run, cache, now: later(now) })
  assert.equal(lib.scenes.find((s) => s.id === '3').rating100, 95)
  // and no update sends Stash a timestamp filter
  assert.ok(stash.calls.every((v) => !v.scene_filter))
})

test('an update finds plays and Os, which leave updated_at alone', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.play(4, now + 30e3)
  stash.scenes[4] = { ...stash.scenes[4], play_count: 1 }
  stash.addO(6, now + 40e3)
  stash.scenes[6] = { ...stash.scenes[6], o_counter: 1 }
  const lib = await loadLibrary({ run: stash.run, cache, now: later(now) })
  assert.equal(lib.scenes.find((s) => s.id === '5').play_count, 1)
  assert.equal(lib.scenes.find((s) => s.id === '7').o_counter, 1)
})

test('an update fetches only the scenes that changed', async () => {
  const stash = fakeStash(1234)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.edit(100, now + 30e3, { title: 'A' })
  stash.play(200, now + 30e3)
  stash.calls.length = 0
  await loadLibrary({ run: stash.run, cache, now: later(now) })
  const byIds = stash.calls.filter((v) => v.ids)
  assert.deepEqual(
    byIds.map((v) => v.ids.sort()),
    [['101', '201']],
  )
})

test('many changed scenes are all found, past the first step', async () => {
  const stash = fakeStash(1234)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  for (let i = 0; i < 700; i++) stash.edit(i, now + 1000 * i, { title: 'New' })
  const lib = await loadLibrary({ run: stash.run, cache, now: later(now) })
  assert.equal(lib.scenes.filter((s) => s.title === 'New').length, 700)
})

test('each update looks back only to a minute before the newest change it saw', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  stash.edit(1, now + 30e3, { rating100: 40 })
  await loadLibrary({ run: stash.run, cache, now: later(now) })
  stash.edit(2, now + 200e3, { rating100: 60 })
  await loadLibrary({ run: stash.run, cache, now: later(now, 2) })
  stash.edit(3, now + 300e3, { rating100: 80 })
  stash.calls.length = 0
  const lib = await loadLibrary({ run: stash.run, cache, now: later(now, 3) })
  assert.equal(lib.scenes.find((s) => s.id === '4').rating100, 80)
  // the light reads stop at the scene edited first, and nothing already in
  // the copy is fetched again
  const looked = stash.calls.filter(
    (v) => v.kind === 'scenes' && v.filter?.sort === 'updated_at',
  )
  assert.equal(looked.length, 1)
  assert.deepEqual(
    stash.calls.filter((v) => v.ids).map((v) => v.ids),
    [['4']],
  )
})

test('a week after the last full read, the library is read in full again', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  await loadLibrary({ run: stash.run, cache, now })
  // updates twice a day never reset the week
  for (let h = 12; h < 7 * 24; h += 12) {
    const progress = []
    await loadLibrary({
      run: stash.run,
      cache,
      now: now + h * 3600e3,
      onProgress: (p) => progress.push(p),
    })
    assert.equal(progress.length, 0)
  }
  stash.calls.length = 0
  const progress = []
  await loadLibrary({
    run: stash.run,
    cache,
    now: now + 7 * 24 * 3600e3 + 1000,
    onProgress: (p) => progress.push(p),
  })
  assert.equal(progress[0].kind, 'scenes')
})

test('an update that finds nothing keeps the copy and writes nothing', async () => {
  const stash = fakeStash(10)
  const m = new Map()
  let writes = []
  const cache = {
    get: async (k) => m.get(k),
    set: async (k, v) => (writes.push(k), m.set(k, v)),
  }
  const now = Date.parse('2026-02-01T00:00:00Z')
  const first = await loadLibrary({ run: stash.run, cache, now })
  writes = []
  const lib = await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 1000,
    current: first,
  })
  assert.equal(lib.unchanged, true)
  assert.equal(lib.scenes, first.scenes)
  assert.equal(lib.performers, first.performers)
  // only the small record of times is written, never the rows again
  assert.deepEqual(writes, ['library-meta'])
})

test('an update that finds a change from the copy in memory is written', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  const first = await loadLibrary({ run: stash.run, cache, now })
  stash.play(3, now + 5000)
  const lib = await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 10000,
    current: first,
  })
  assert.equal(lib.unchanged, false)
  assert.notEqual(lib.scenes, first.scenes)
  assert.ok(lib.scenes.find((s) => s.id === '4').last_played_at)
  assert.equal((await cache.get('library-meta')).syncedAt, lib.syncedAt)
  assert.equal((await cache.get('library')).rowsId, lib.rowsId)
})

test('a bulk rewrite of the library is left for the next full read', async () => {
  const stash = fakeStash(3000)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  const first = await loadLibrary({ run: stash.run, cache, now })
  // Restash's mirror touches every scene; one scene is also played
  stash.touchAll(now + 5000)
  stash.play(7, now + 6000)
  stash.calls.length = 0
  const lib = await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 10000,
    current: first,
  })
  assert.equal(lib.bulk, true)
  // the play is fetched, the rewrite is not
  assert.deepEqual(
    stash.calls.filter((v) => v.ids).map((v) => v.ids),
    [['8']],
  )
  assert.ok(lib.scenes.find((s) => s.id === '8').last_played_at)
  // and the next check starts past the rewrite
  stash.calls.length = 0
  const next = await loadLibrary({
    run: stash.run,
    cache,
    now: now + 2 * REFRESH_MS + 20000,
    current: lib,
  })
  assert.equal(next.unchanged, true)
  assert.equal(next.bulk, false)
  assert.equal(
    stash.calls.filter((v) => v.kind === 'scenes' && v.filter?.per_page > 1)
      .length <= 3,
    true,
  )
})

test('a changed performer is fetched alone', async () => {
  const stash = fakeStash(10)
  const cache = memCache()
  const now = Date.parse('2026-02-01T00:00:00Z')
  const first = await loadLibrary({ run: stash.run, cache, now })
  stash.editPerformer(1, now + 5000, { favorite: true })
  stash.calls.length = 0
  const lib = await loadLibrary({
    run: stash.run,
    cache,
    now: now + REFRESH_MS + 10000,
    current: first,
  })
  assert.deepEqual(
    stash.calls.filter((v) => v.ids).map((v) => [v.kind, v.ids]),
    [['performers', ['2']]],
  )
  assert.equal(lib.performers.find((p) => p.id === '2').favorite, true)
  assert.equal(lib.scenes, first.scenes)
})

test('custom fields keep only the keys Cherry Pick reads', () => {
  const row = keepFields({
    id: '1',
    custom_fields: {
      restash_score: 80,
      restash_components: '{"base": 0.5}',
      hotornot_stats: '{}',
      cherrypick_titles: 2,
      'Awards Won': 'many',
    },
  })
  assert.deepEqual(Object.keys(row.custom_fields).sort(), [
    'cherrypick_titles',
    'hotornot_stats',
    'restash_score',
  ])
})
