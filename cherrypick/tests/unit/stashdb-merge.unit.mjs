import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStashdbClient } from '../../src/js/stashdb/client.js'
import {
  performerScenes,
  scenesById,
  studioScenes,
} from '../../src/js/stashdb/lookups.js'
import { mergeAll, mergeStashdb } from '../../src/js/stashdb/merge.js'
import {
  heldByOf,
  isStashdbEndpoint,
  sceneFromApi,
  stashdbIdOf,
  stashdbPage,
  STORE_CATEGORY,
  storeLink,
  storeOf,
  withStashdbKey,
} from '../../src/js/stashdb/queries.js'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'
import { theirScenesYouDontHave } from '../../src/js/model/recs.js'
import { popularity } from '../../src/js/model/signals.js'

const EP = 'https://stashdb.org/graphql'

// ---------------------------------------------------------------- a small StashDB

const perf = (id, name, gender = 'FEMALE') => ({
  performer: { id, name, gender, disambiguation: null },
})
const apiScene = (n, users, cast, studio = 'st-a') => ({
  id: `s${n}`,
  title: `Scene ${n}`,
  release_date: `2025-01-${String(n).padStart(2, '0')}`,
  duration: 600,
  images: [
    { url: `https://img.example/s${n}-p.jpg`, width: 400, height: 600 },
    { url: `https://img.example/s${n}.jpg`, width: 640, height: 360 },
  ],
  studio: {
    id: studio,
    name: studio === 'st-a' ? 'Studio Amber' : 'Studio Birch',
    parent: null,
  },
  performers: cast,
  tags: [{ id: 't-beach', name: 'Beach' }],
  urls: [
    {
      url: `https://studio.example/s${n}?nats=abc&id=${n}`,
      site: { name: 'Studio' },
    },
  ],
  users,
})
const ANNA = perf('p-anna', 'Anna Example')
const BEA = perf('p-bea', 'Bea Example')
const CATALOGUE = [
  apiScene(1, 50, [ANNA]),
  apiScene(2, 900, [ANNA, BEA]),
  apiScene(3, 300, [ANNA], 'st-b'),
  apiScene(4, 10, [BEA]),
  apiScene(5, 700, [ANNA]),
]
// StashDB's answer: the scene without the test's hidden user count
const strip = (s) =>
  Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'users'))
const withPrints = (s) => ({
  ...strip(s),
  fingerprints: [
    { algorithm: 'OSHASH', submissions: Math.ceil(s.users / 2) },
    { algorithm: 'OSHASH', submissions: Math.floor(s.users / 2) },
    { algorithm: 'PHASH', submissions: 3 },
  ],
})

// A fetch answering Cherry Pick's three lookups from CATALOGUE.
function fakeStashdb() {
  const sent = []
  const fetch = async (_, init) => {
    const { query, variables } = JSON.parse(init.body)
    sent.push(query)
    let data
    if (query.includes('queryScenes')) {
      const { performers, studios } = variables.input
      const list = CATALOGUE.filter(
        (s) =>
          (!performers ||
            s.performers.some((a) =>
              performers.value.includes(a.performer.id),
            )) &&
          (!studios || studios.value.includes(s.studio.id)),
      ).sort((a, b) => b.users - a.users)
      data = { queryScenes: { count: list.length, scenes: list.map(strip) } }
    } else {
      data = Object.fromEntries(
        Object.entries(variables).map(([k, id]) => {
          const s = CATALOGUE.find((x) => x.id === id)
          return [k, s ? withPrints(s) : null]
        }),
      )
    }
    return { ok: true, status: 200, json: async () => ({ data }) }
  }
  const cache = new Map()
  const client = createStashdbClient({
    endpoint: EP,
    apiKey: 'k',
    fetch,
    cache: {
      get: async (k) => cache.get(k),
      set: async (k, v) => void cache.set(k, v),
    },
    wait: async () => {},
    perView: 50,
  })
  return { client, sent, cache }
}

// ---------------------------------------------------------------- answers

test('a StashDB scene in buildDb shape, with its store link cleaned', () => {
  const s = sceneFromApi(withPrints(CATALOGUE[1]))
  assert.equal(s.id, 's2')
  assert.equal(s.date, '2025-01-02')
  assert.equal(s.image, 'https://img.example/s2.jpg', 'the landscape cover')
  assert.deepEqual(
    s.performers.map((p) => p.id),
    ['p-anna', 'p-bea'],
  )
  assert.equal(s.heldBy, 900, 'OSHASH submissions')
  assert.deepEqual(
    s.store,
    { url: 'https://studio.example/s2?id=2', site: 'Studio' },
    'no affiliate code',
  )
  assert.equal('heldBy' in sceneFromApi(strip(CATALOGUE[1])), false)
  assert.equal(
    'store' in sceneFromApi({ ...CATALOGUE[1], urls: [] }),
    false,
    'no link: nothing to overwrite one fetched earlier',
  )
})

test('held by: OSHASH submissions, else the largest algorithm', () => {
  assert.equal(heldByOf([]), null)
  assert.equal(
    heldByOf([
      { algorithm: 'OSHASH', submissions: 4 },
      { algorithm: 'MD5', submissions: 9 },
      { algorithm: 'OSHASH', submissions: 5 },
    ]),
    9,
  )
  assert.equal(heldByOf([{ algorithm: 'PHASH', submissions: 7 }]), 7)
  assert.equal(heldByOf([{ algorithm: 'OSHASH', submissions: 0 }]), null)
})

const STUDIO = { name: 'Studio', category: { name: 'Primary sources' } }
const site = (name) => ({ name, category: { name: STORE_CATEGORY } })

test('store links: http(s) only, tracking parameters dropped', () => {
  const link = (url) => storeLink([{ url, site: STUDIO }])?.url ?? null
  assert.equal(
    link('https://a.example/v/1?utm_source=x&ats=y&aff_id=3&page=2#t'),
    'https://a.example/v/1?page=2',
  )
  assert.equal(link('javascript:alert(1)'), null)
  assert.equal(storeLink([]), null)
  assert.equal(
    storeLink([{ url: 'https://a.example', site: { name: 'Twitter' } }]),
    null,
    'a site that neither sells nor shows the scene',
  )
})

test('store links: a store before the studio, named for the store', () => {
  assert.deepEqual(
    storeLink([
      { url: 'https://studio.example/v/1', site: STUDIO },
      {
        url: 'https://www.clips4sale.com/studio/1/2/x',
        site: site('Clips4Sale'),
      },
      { url: 'https://www.manyvids.com/Video/3/x', site: site('ManyVids') },
    ]),
    { url: 'https://www.clips4sale.com/studio/1/2/x', site: 'Clips4Sale' },
    'the first store StashDB lists',
  )
  assert.deepEqual(
    storeLink([
      { url: 'https://www.iafd.com/title.rme/id=1', site: { name: 'IAFD' } },
      { url: 'https://studio.example/v/1', site: STUDIO },
    ]),
    { url: 'https://studio.example/v/1', site: 'Studio' },
  )
  assert.deepEqual(
    storeLink([
      {
        url: 'https://www.pornhub.com/view_video.php?viewkey=ab12',
        site: site('Pornhub'),
      },
    ]),
    {
      url: 'https://www.pornhub.com/view_video.php?viewkey=ab12',
      site: 'Pornhub',
    },
    'a tube counts: it is where to get the scene',
  )
  assert.deepEqual(
    storeLink([
      { url: 'https://studio.example/v/1', site: { name: 'Studio' } },
    ]),
    { url: 'https://studio.example/v/1', site: 'Studio' },
    'an answer cached before categories were asked for',
  )
})

test('a scene cached before store links keeps its studio link', () => {
  assert.deepEqual(storeOf({ studioUrl: 'https://studio.example/v/1' }), {
    url: 'https://studio.example/v/1',
    site: 'Studio',
  })
  const store = { url: 'https://clips.example/1', site: 'Clips4Sale' }
  assert.equal(
    storeOf({ store, studioUrl: 'https://studio.example/v/1' }),
    store,
  )
  assert.equal(storeOf({ id: 's1' }), null)
  assert.equal(storeOf(null), null)
})

test('store links: an archive copy never counts', () => {
  const live = 'https://www.manyvids.com/Video/3/x'
  assert.deepEqual(
    storeLink([
      {
        url: `https://web.archive.org/web/2021/${live}/`,
        site: site('ManyVids'),
      },
      { url: live, site: site('ManyVids') },
    ]),
    { url: live, site: 'ManyVids' },
  )
  assert.equal(
    storeLink([
      {
        url: `https://web.archive.org/web/2021/${live}`,
        site: site('ManyVids'),
      },
      { url: 'https://archive.ph/abc', site: STUDIO },
    ]),
    null,
  )
})

test('only stashdb.org counts as StashDB', () => {
  assert.ok(isStashdbEndpoint('https://stashdb.org/graphql'))
  assert.ok(isStashdbEndpoint('https://StashDB.org/graphql/'))
  assert.ok(!isStashdbEndpoint('https://stashdb.org.example.com/graphql'))
  assert.ok(!isStashdbEndpoint('http://127.0.0.1:9998/graphql'))
  assert.ok(!isStashdbEndpoint('not a url'))
  assert.equal(
    stashdbIdOf([
      { endpoint: 'http://127.0.0.1:9998/graphql', stash_id: 'x' },
      { endpoint: EP, stash_id: 'y' },
    ]),
    'y',
  )
  assert.equal(
    stashdbPage(EP, 'scenes', 'a b'),
    'https://stashdb.org/scenes/a%20b',
  )
})

// ---------------------------------------------------------------- lookups and merging

test('a performer lookup: their scenes most popular first, and their count', async () => {
  const { client } = fakeStashdb()
  const r = await performerScenes(client, 'p-anna')
  assert.deepEqual(r.part.performers, [
    {
      id: 'p-anna',
      sceneCount: 4,
      popularSceneIds: ['s2', 's5', 's3', 's1'],
      name: 'Anna Example',
      gender: 'FEMALE',
      disambiguation: null,
    },
  ])
  assert.equal(r.part.scenes.length, 4)
  assert.match(r.entries[0], /^performer-scenes:p-anna@\d+$/)
})

test('scenes by id: one request, cached per scene', async () => {
  const { client, sent } = fakeStashdb()
  const r = await scenesById(client, ['s2', 'nope', 's2'])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /s0: findScene\(id: \$s0\)/)
  assert.deepEqual(
    r.part.scenes.map((s) => [s.id, s.heldBy]),
    [['s2', 900]],
  )
  await scenesById(client, ['s2', 'nope'])
  assert.equal(
    sent.length,
    1,
    'both answered from the cache, the missing one too',
  )
})

test('scenes by id: stale ones show, then go again together after the misses', async () => {
  const { client, sent, cache } = fakeStashdb()
  // two scenes as 0.1.6 kept them: a studio link and no cache format
  for (const id of ['s1', 's3'])
    cache.set('stashdb:scene:' + id, {
      at: Date.now(),
      data: {
        ...sceneFromApi(CATALOGUE[+id[1] - 1]),
        store: undefined,
        studioUrl: 'https://studio.example/old',
      },
    })
  const r = await scenesById(client, ['s1', 's2', 's3'])
  assert.deepEqual(
    r.part.scenes.map((s) => s.id),
    ['s1', 's3', 's2'],
  )
  assert.equal(r.complete, true)
  assert.equal(sent.length, 1, 'only the miss before the page has them')
  assert.match(sent[0], /s0: findScene/)
  assert.doesNotMatch(sent[0], /s1: findScene/)
  await client.revalidate()
  assert.equal(sent.length, 2, 'the stale ones in one request')
  assert.match(sent[1], /s1: findScene/)
  assert.deepEqual(cache.get('stashdb:scene:s3').data.store, {
    url: 'https://studio.example/s3?id=3',
    site: 'Studio',
  })
  const again = await scenesById(client, ['s1', 's2', 's3'])
  await client.revalidate()
  assert.equal(sent.length, 2, 'all fresh now')
  assert.equal(
    again.part.scenes.find((s) => s.id === 's1').studioUrl,
    undefined,
  )
})

test('parts merge into the stashdb input; nothing is replaced', async () => {
  const { client } = fakeStashdb()
  const scene = await scenesById(client, ['s2'])
  const anna = await performerScenes(client, 'p-anna')
  const bea = await performerScenes(client, 'p-bea')
  const studio = await studioScenes(client, 'st-b')
  let input = mergeStashdb(null, { endpoint: EP, ...scene.part })
  input = mergeAll(input, [anna.part, bea.part, studio.part])
  assert.equal(input.endpoint, EP)
  assert.deepEqual(
    input.performers.map((p) => p.id),
    ['p-anna', 'p-bea'],
  )
  assert.deepEqual(
    input.studios.map((s) => [s.id, s.name]),
    [['st-b', 'Studio Birch']],
  )
  assert.deepEqual(
    input.scenes.map((s) => s.id),
    ['s2', 's5', 's3', 's1', 's4'],
    'each scene once',
  )
  const s2 = input.scenes.find((s) => s.id === 's2')
  assert.equal(s2.heldBy, 900, 'a list without fingerprints keeps the count')
  // the input before is untouched, and a newer list replaces the order
  const before = input
  const again = mergeStashdb(input, {
    performers: [{ id: 'p-anna', popularSceneIds: ['s5'], sceneCount: 4 }],
  })
  assert.deepEqual(before.performers[0].popularSceneIds, [
    's2',
    's5',
    's3',
    's1',
  ])
  assert.deepEqual(again.performers[0].popularSceneIds, ['s5'])
  assert.equal(again.performers[0].name, 'Anna Example')
})

test('the merged input in the model: missing scenes in StashDB order, with reasons', async () => {
  const { client } = fakeStashdb()
  const anna = await performerScenes(client, 'p-anna')
  const own = await scenesById(client, ['s5'])
  const stashdb = mergeAll(null, [{ endpoint: EP, ...anna.part }, own.part])
  // the library: Anna, linked to StashDB, and one of her scenes (s5)
  const db = buildDb({
    asOf: Date.parse('2026-10-15T12:00:00Z'),
    scenes: [
      {
        id: '100',
        title: 'Scene 5',
        created_at: '2026-01-01T00:00:00Z',
        studio: { id: '7', name: 'Studio Amber' },
        performers: [{ id: '1', name: 'Anna Example', gender: 'FEMALE' }],
        tags: [{ id: '9', name: 'Beach' }],
        stash_ids: [{ endpoint: EP, stash_id: 's5' }],
      },
    ],
    performers: [
      {
        id: '1',
        name: 'Anna Example',
        gender: 'FEMALE',
        stash_ids: [{ endpoint: EP, stash_id: 'p-anna' }],
      },
    ],
    stashdb,
  })
  assert.ok(db.hasStashdb)
  const anna1 = db.performers.get('1')
  assert.deepEqual(anna1.popularSceneIds, [
    'stashdb:s2',
    '100',
    'stashdb:s3',
    'stashdb:s1',
  ])
  assert.equal(
    db.scenes.get('100').heldBy,
    700,
    'the owned scene gets its count',
  )
  const M = createEngine(db).compute({})
  const state = { notInterested: [], settings: { excludedTags: '' } }
  const items = theirScenesYouDontHave(M, state, anna1)
  assert.deepEqual(
    items.map((it) => it.scene.id),
    ['stashdb:s2', 'stashdb:s3', 'stashdb:s1'],
  )
  assert.equal(items[0].reason, '#1 of her 4 scenes on StashDB (top 25%)')
  assert.equal(items[0].scene.studio.id, '7', 'the library studio, by name')
  // Not interested and excluded tags keep scenes out
  const hidden = theirScenesYouDontHave(
    M,
    {
      notInterested: [{ sceneId: 'stashdb:s2' }],
      settings: { excludedTags: '' },
    },
    anna1,
  )
  assert.deepEqual(
    hidden.map((it) => it.scene.id),
    ['stashdb:s3', 'stashdb:s1'],
  )
  const excluded = theirScenesYouDontHave(
    M,
    { notInterested: [], settings: { excludedTags: 'beach' } },
    anna1,
  )
  assert.deepEqual(excluded, [])
  // the owned scene's popularity line
  const pop = popularity(db, db.scenes.get('100'))
  assert.equal(pop.held, 'Held by ~700 StashDB users')
  assert.equal(pop.performer.rank, 2)
})

// ---------------------------------------------------------------- Stash's stash-boxes

test('adding the key keeps every stash-box exactly', () => {
  const boxes = [
    {
      endpoint: 'http://127.0.0.1:9998/graphql',
      api_key: 'demo',
      name: 'StashDB',
      max_requests_per_minute: 17,
    },
    {
      endpoint: 'https://other.example/graphql',
      api_key: 'o',
      name: 'Other',
      max_requests_per_minute: 240,
      __typename: 'StashBox',
    },
  ]
  const { boxes: next, endpoint } = withStashdbKey(boxes, 'new-key')
  assert.equal(endpoint, EP)
  assert.deepEqual(next.slice(0, 2), [
    {
      endpoint: 'http://127.0.0.1:9998/graphql',
      api_key: 'demo',
      name: 'StashDB',
      max_requests_per_minute: 17,
    },
    {
      endpoint: 'https://other.example/graphql',
      api_key: 'o',
      name: 'Other',
      max_requests_per_minute: 240,
    },
  ])
  assert.deepEqual(next[2], {
    endpoint: EP,
    api_key: 'new-key',
    name: 'StashDB 2',
  })
})

test('a StashDB entry already there only gets the new key', () => {
  const boxes = [
    {
      endpoint: 'https://stashdb.org/graphql/',
      api_key: 'old',
      name: 'My StashDB',
      max_requests_per_minute: 60,
    },
  ]
  const { boxes: next, endpoint } = withStashdbKey(boxes, 'new')
  assert.equal(endpoint, 'https://stashdb.org/graphql/')
  assert.deepEqual(next, [
    {
      endpoint: 'https://stashdb.org/graphql/',
      api_key: 'new',
      name: 'My StashDB',
      max_requests_per_minute: 60,
    },
  ])
})
