import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, realImage, STASHDB_PREFIX } from '../../src/js/model/db.js'
import { isPlaceholderTag } from '../../src/js/model/util.js'
import {
  syntheticLibrary,
  syntheticStashdb,
  PLACEHOLDER_TAGS,
  ENDPOINT,
  AS_OF,
} from './fixtures/synthetic.mjs'

const sid = (id) => [{ endpoint: ENDPOINT, stash_id: id }]

// Two owned scenes, three performers (one without a photo, one missing from
// the performer list) and a StashDB part with one scene of each kind
function smallInput() {
  const credit = (id, name, gender) => ({
    id,
    name,
    gender,
    favorite: false,
    image_path: `http://localhost:9999/performer/${id}/image?t=1`,
  })
  return {
    asOf: AS_OF,
    scenes: [
      {
        id: '20',
        title: 'Scene B',
        date: '2025-01-02',
        created_at: '2026-03-01T10:00:00Z',
        rating100: 80,
        files: [{ duration: 1500 }],
        play_count: 2,
        play_duration: 2400,
        play_history: ['2026-03-02T12:00:00Z', '2026-04-02T12:00:00Z'],
        o_counter: 1,
        studio: {
          id: '5',
          name: 'Studio Amber',
          parent_studio: { id: '9', name: 'Network North' },
        },
        performers: [credit('1', 'Performer 01', 'FEMALE')],
        tags: [
          { id: '1', name: 'Beach' },
          { id: '2', name: '4K Available' },
        ],
        stash_ids: sid('sdb-s20'),
        paths: { screenshot: 'http://localhost:9999/scene/20/screenshot' },
      },
      {
        id: '10',
        title: 'Scene A',
        date: null,
        created_at: '2025-11-01T10:00:00Z',
        rating100: null,
        files: [],
        play_count: 0,
        play_duration: 0,
        play_history: [],
        o_counter: 0,
        studio: null,
        performers: [
          credit('2', 'Performer 02', 'MALE'),
          credit('3', 'Performer 03', null),
        ],
        tags: [{ id: '3', name: 'Kitchen' }],
        stash_ids: [],
        paths: { screenshot: null },
      },
    ],
    performers: [
      {
        id: '1',
        name: 'Performer 01',
        disambiguation: null,
        gender: 'FEMALE',
        rating100: 90,
        favorite: true,
        image_path: 'http://localhost:9999/performer/1/image?t=1',
        scene_count: 1,
        stash_ids: sid('sdb-p1'),
        custom_fields: {},
      },
      {
        id: '2',
        name: 'Performer 02',
        disambiguation: 'the other one',
        gender: 'MALE',
        rating100: null,
        favorite: false,
        image_path: 'http://localhost:9999/performer/2/image?default=true',
        scene_count: 1,
        stash_ids: [],
        custom_fields: { note: 'x' },
      },
    ],
    stashdb: {
      scenes: [
        {
          id: 'sdb-s20',
          title: 'StashDB title',
          studio: { id: 'sdb-st-a', name: 'Studio Amber', parent: null },
          performers: [{ id: 'sdb-p1', name: 'Performer 01' }],
          tags: [{ id: 'sdb-t-beach', name: 'Beach' }],
          heldBy: 840,
          globalPopularityRank: 7,
        },
        {
          id: 'sdb-m1',
          title: 'Missing 001',
          duration: 1800,
          studio: {
            id: 'sdb-st-q',
            name: 'Studio Quartz',
            parent: { id: 'sdb-st-n', name: 'Network North' },
          },
          performers: [
            { id: 'sdb-p1', name: 'Performer 01', gender: 'FEMALE' },
            { id: 'sdb-g1', name: 'Guest 01', gender: 'FEMALE' },
          ],
          tags: [
            { id: 'sdb-t-beach', name: 'beach' },
            { id: 'sdb-t-sunset', name: 'Sunset' },
          ],
          heldBy: 120,
          globalPopularityRank: null,
        },
      ],
      performers: [
        {
          id: 'sdb-p1',
          name: 'Performer 01',
          sceneCount: 300,
          popularSceneIds: ['sdb-m1', 'sdb-unknown', 'sdb-s20'],
        },
        { id: 'sdb-g1', name: 'Guest 01', gender: 'FEMALE' },
      ],
      studios: [
        { id: 'sdb-st-a', name: 'Studio Amber', popularSceneIds: ['sdb-s20'] },
      ],
    },
  }
}

test('owned scenes keep their Stash ids and fields', () => {
  const db = buildDb(smallInput())
  assert.deepEqual(
    db.owned.map((s) => s.id),
    ['10', '20'],
    'oldest addition first',
  )
  const b = db.scenes.get('20')
  assert.equal(b.owned, true)
  assert.equal(b.localId, '20')
  assert.equal(b.duration, 1500)
  assert.deepEqual(b.studio, {
    id: '5',
    name: 'Studio Amber',
    parent: { id: '9', name: 'Network North' },
  })
  assert.equal(b.local.rating100, 80)
  assert.equal(b.local.play_count, 2)
  assert.equal(b.stashId, 'sdb-s20')
  assert.equal(db.scenes.get('10').duration, null, 'no file: no duration')
  assert.equal(db.asOf, AS_OF)
})

test('owned scenes come out in the same order whatever order they are read in', () => {
  const { input } = syntheticLibrary()
  const a = buildDb(input).owned.map((s) => s.id)
  const b = buildDb({
    ...input,
    scenes: input.scenes.slice().reverse(),
  }).owned.map((s) => s.id)
  assert.deepEqual(a, b)
})

test("a performer on Stash's default image has no photo", () => {
  const db = buildDb(smallInput())
  assert.equal(
    db.performers.get('1').image,
    'http://localhost:9999/performer/1/image?t=1',
  )
  assert.equal(db.performers.get('2').image, null)
  assert.equal(realImage('/performer/7/image?t=5&default=true'), null)
  assert.equal(realImage(null), null)

  const { input } = syntheticLibrary()
  const lib = buildDb(input)
  for (const row of input.performers)
    assert.equal(
      lib.performers.get(row.id).image === null,
      row.image_path.endsWith('?default=true'),
    )
})

test('library performers carry Stash fields; a credit missing from the list still counts', () => {
  const db = buildDb(smallInput())
  const p1 = db.performers.get('1')
  assert.equal(p1.localId, '1')
  assert.equal(p1.local.rating100, 90)
  assert.equal(p1.local.favorite, true)
  assert.equal(p1.stashId, 'sdb-p1')
  assert.deepEqual(db.performers.get('2').local.custom_fields, { note: 'x' })
  assert.equal(db.performers.get('2').disambiguation, 'the other one')
  const p3 = db.performers.get('3')
  assert.ok(p3.local, 'credited on an owned scene, so in the library')
  assert.equal(p3.local.gender, null)
  assert.equal(p3.local.scene_count, 1)
  assert.deepEqual([...db.favoritePerformerIds], ['1'])
  assert.deepEqual(
    db.localPerformers.map((p) => p.id),
    ['1', '2', '3'],
  )
})

test('placeholder and release tags stay out of the model', () => {
  for (const name of PLACEHOLDER_TAGS)
    assert.ok(isPlaceholderTag({ name }), name)
  for (const name of [
    'HD Available',
    'Trailer',
    'Award Winner 2024',
    'todo: fix',
    '#later',
    '(unsorted)',
  ])
    assert.ok(isPlaceholderTag({ name }), name)
  for (const name of ['Beach', 'Kitchen', 'Black and White', 'Outdoor'])
    assert.equal(isPlaceholderTag({ name }), false, name)
  assert.ok(isPlaceholderTag({}), 'a tag with no name')

  const db = buildDb(smallInput())
  assert.deepEqual(
    db.scenes.get('20').tags.filter((t) => !isPlaceholderTag(t)),
    [{ id: '1', name: 'Beach' }],
  )
})

test("other plugins' score and collection tags stay out of the model", () => {
  for (const name of [
    'Production Quality ★: 4', // Advanced Rating's, and Binge's stars
    'Chemistry ★: 0',
    'Energy & Presence ★: 5',
    'Watch Later 📁', // Binge's collections
    'Road Trip 📁',
  ])
    assert.ok(isPlaceholderTag({ name }), name)
  for (const name of ['Favourite ★', 'Watch Later', 'Road Trip'])
    assert.equal(isPlaceholderTag({ name }), false, name)
})

test('without a StashDB part every scene is owned', () => {
  const { stashdb, ...input } = smallInput()
  assert.ok(stashdb)
  const db = buildDb(input)
  assert.equal(db.hasStashdb, false)
  assert.equal(db.scenes.size, 2)
  assert.equal(db.performerRank.size, 0)
})

test('a StashDB scene an owned scene names in stash_ids is that scene', () => {
  const db = buildDb(smallInput())
  assert.equal(db.hasStashdb, true)
  assert.ok(!db.scenes.has(STASHDB_PREFIX + 'sdb-s20'))
  const b = db.scenes.get('20')
  assert.equal(b.title, 'Scene B', "Stash's own fields stay")
  assert.equal(b.heldBy, 840)
  assert.equal(b.globalPopularityRank, 7)
  assert.deepEqual(
    [...db.scenes.values()].filter((s) => !s.owned).map((s) => s.id),
    [STASHDB_PREFIX + 'sdb-m1'],
  )
})

test('StashDB ids map onto the library: performers by stash_ids, studios and tags by name', () => {
  const db = buildDb(smallInput())
  const m = db.scenes.get(STASHDB_PREFIX + 'sdb-m1')
  assert.equal(m.owned, false)
  assert.equal(m.local, null)
  assert.deepEqual(
    m.performers.map((p) => p.id),
    ['1', STASHDB_PREFIX + 'sdb-g1'],
  )
  assert.equal(m.performers[0].gender, 'FEMALE')
  assert.deepEqual(m.studio, {
    id: STASHDB_PREFIX + 'sdb-st-q',
    name: 'Studio Quartz',
    parent: { id: '9', name: 'Network North' },
  })
  assert.deepEqual(
    m.tags.map((t) => t.id),
    ['1', STASHDB_PREFIX + 'sdb-t-sunset'],
  )
  assert.equal(db.tags.get(STASHDB_PREFIX + 'sdb-t-sunset').name, 'Sunset')

  const p1 = db.performers.get('1')
  assert.deepEqual(p1.sceneIds, ['20', STASHDB_PREFIX + 'sdb-m1'])
  assert.deepEqual(p1.ownedSceneIds, ['20'])
  assert.deepEqual(p1.popularSceneIds, [
    STASHDB_PREFIX + 'sdb-m1',
    STASHDB_PREFIX + 'sdb-unknown',
    '20',
  ])
  assert.equal(p1.sceneCount, 300)
  assert.deepEqual(db.performerRank.get('20'), [{ performerId: '1', rank: 3 }])

  const guest = db.performers.get(STASHDB_PREFIX + 'sdb-g1')
  assert.equal(guest.local, null)
  assert.equal(guest.localId, null)
  assert.equal(guest.stashdbGender, 'FEMALE')

  assert.deepEqual(db.studios.get('5').popularSceneIds, ['20'])
  assert.deepEqual(db.studioRank.get('20'), { studioId: '5', rank: 1 })
  assert.ok(db.studios.get('9').childIds.has(STASHDB_PREFIX + 'sdb-st-q'))
  assert.deepEqual(db.studios.get('9').ownedSceneIds, ['20'])
})

test('a synthetic StashDB part merges onto the synthetic library', () => {
  const { input } = syntheticLibrary()
  const stashdb = syntheticStashdb(input)
  const db = buildDb({ ...input, stashdb })
  const owned = new Set(input.scenes.map((s) => s.id))
  const mine = new Set(
    input.scenes.flatMap((s) => s.stash_ids.map((x) => x.stash_id)),
  )
  const copies = stashdb.scenes.filter((s) => mine.has(s.id))
  assert.ok(copies.length > 10)
  assert.equal(db.owned.length, input.scenes.length)
  assert.equal(
    db.scenes.size,
    input.scenes.length + stashdb.scenes.length - copies.length,
  )
  for (const s of db.scenes.values()) {
    assert.equal(s.owned, owned.has(s.id), s.id)
    if (!s.owned) assert.ok(s.id.startsWith(STASHDB_PREFIX))
  }
  for (const c of copies) {
    const s = db.owned.find((x) => x.stashId === c.id)
    assert.equal(s.heldBy, c.heldBy)
  }
  // every library performer StashDB credits is the library's own record
  for (const s of db.scenes.values())
    for (const p of s.performers)
      assert.ok(
        db.performers.get(p.id).local ||
          p.id.startsWith(STASHDB_PREFIX + 'sdb-guest'),
        p.id,
      )
})

test('slim rows and the name lists build the same database as full rows', async () => {
  const { syntheticLibrary } = await import('./fixtures/synthetic.mjs')
  const { input } = syntheticLibrary({ scenes: 200 })
  const tags = new Map()
  const studios = new Map()
  for (const s of input.scenes) {
    for (const t of s.tags) tags.set(t.id, { id: t.id, name: t.name })
    if (s.studio) {
      const p = s.studio.parent_studio
      if (p) studios.set(p.id, { id: p.id, name: p.name, parent_studio: null })
      studios.set(s.studio.id, {
        id: s.studio.id,
        name: s.studio.name,
        parent_studio: p ? { id: p.id } : null,
      })
    }
  }
  const slim = input.scenes.map((s) => ({
    ...s,
    studio: s.studio ? { id: s.studio.id } : null,
    performers: s.performers.map((p) => ({ id: p.id })),
    tags: s.tags.map((t) => ({ id: t.id })),
  }))
  const full = buildDb(input)
  const fromSlim = buildDb({
    ...input,
    scenes: slim,
    tags: [...tags.values()],
    studios: [...studios.values()],
  })
  const view = (db) =>
    [...db.scenes.values()].map((s) => ({
      id: s.id,
      studio: s.studio,
      performers: s.performers,
      tags: s.tags,
    }))
  assert.deepEqual(view(fromSlim), view(full))
  assert.deepEqual([...fromSlim.tags.keys()].sort(), [...full.tags.keys()].sort())
})
