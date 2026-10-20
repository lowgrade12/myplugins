import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  criterionLabel,
  customFieldUrl,
  describeFilter,
  encodeCriterion,
  listGender,
  listPlace,
  listUrl,
  noGenderUrl,
  taggerUrl,
  toRateUrl,
} from '../../src/js/data/listFilter.js'

// A criterion as Stash's list filter holds it
const crit = (type, modifier, value) => ({
  criterionOption: { type },
  modifier,
  value,
})
// A ListFilterModel-shaped stand-in
const filterOf = (criteria, input, searchTerm = '') => ({
  criteria,
  searchTerm,
  makeFilter: () => input,
})

test("the list's gender: one gender, none, or no answer", () => {
  assert.equal(listGender({}), null)
  assert.equal(listGender(null), null)
  assert.equal(
    listGender({ gender: { value_list: ['MALE'], modifier: 'INCLUDES' } }),
    'MALE',
  )
  assert.equal(
    listGender({ gender: { value: 'FEMALE', modifier: 'EQUALS' } }),
    'FEMALE',
    'the older single value',
  )
  assert.equal(listGender({ gender: { modifier: 'IS_NULL' } }), 'none')
  assert.equal(
    listGender({
      gender: { value_list: ['MALE', 'FEMALE'], modifier: 'INCLUDES' },
    }),
    null,
    'two genders are not one',
  )
  assert.equal(
    listGender({ gender: { value_list: ['MALE'], modifier: 'EXCLUDES' } }),
    null,
  )
  assert.equal(listGender({ gender: { modifier: 'NOT_NULL' } }), null)
})

test('criterion labels, close to Stash filter tags', () => {
  const items = (...labels) => ({
    items: labels.map((label, i) => ({ id: String(i), label })),
    excluded: [],
    depth: 0,
  })
  assert.equal(
    criterionLabel(crit('tags', 'INCLUDES', items('Rooftop'))),
    'Rooftop',
  )
  assert.equal(
    criterionLabel(crit('performers', 'INCLUDES_ALL', items('Ada', 'Bea'))),
    'Ada, Bea',
  )
  assert.equal(
    criterionLabel(crit('tags', 'EXCLUDES', items('Snow'))),
    'Not Snow',
  )
  assert.equal(criterionLabel(crit('gender', 'INCLUDES', ['Female'])), 'Female')
  assert.equal(criterionLabel(crit('gender', 'IS_NULL', [])), 'No gender')
  assert.equal(
    criterionLabel(crit('filter_favorites', 'EQUALS', 'true')),
    'Favorites',
  )
  assert.equal(
    criterionLabel(crit('organized', 'EQUALS', 'false')),
    'Not organized',
  )
  assert.equal(
    criterionLabel(crit('rating100', 'GREATER_THAN', { value: 60 })),
    'Rating > 60',
  )
  assert.equal(
    criterionLabel(crit('play_count', 'BETWEEN', { value: 1, value2: 3 })),
    'Play count 1 to 3',
  )
  assert.equal(
    criterionLabel(
      crit('custom_fields', undefined, [
        { field: 'cherrypick_titles', modifier: 'GREATER_THAN', value: [0] },
      ]),
    ),
    'cherrypick_titles > 0',
  )
  assert.equal(
    criterionLabel(crit('some_new_thing', 'EQUALS', null)),
    'Some new thing',
  )
})

test('describing a filter: active, its gender, labels with and without it', () => {
  const none = describeFilter(filterOf([], {}))
  assert.equal(none.active, false)
  assert.equal(none.gender, null)
  assert.equal(none.label, '')
  assert.equal(none.count, 0)

  const f = describeFilter(
    filterOf(
      [
        crit('gender', 'INCLUDES', ['Female']),
        crit('filter_favorites', 'EQUALS', 'true'),
      ],
      {
        gender: { value_list: ['FEMALE'], modifier: 'INCLUDES' },
        filter_favorites: true,
      },
    ),
  )
  assert.equal(f.active, true)
  assert.equal(f.gender, 'FEMALE')
  assert.equal(f.label, 'Favorites', 'the bracket names its gender already')
  assert.equal(f.fullLabel, 'Female · Favorites')
  assert.equal(f.count, 2)

  const q = describeFilter(filterOf([], {}, 'lake'))
  assert.equal(q.active, true, 'a search filters the list too')
  assert.equal(q.label, '"lake"')
  assert.equal(q.q, 'lake')

  assert.notEqual(f.key, none.key)
  assert.equal(
    describeFilter(filterOf([], {}, 'lake')).key,
    q.key,
    'the same filter, the same key',
  )
})

test("another plugin's criterion: left out of the query, named in the labels", () => {
  const known = new Set(['rating100', 'gender', 'performers'])
  const list = filterOf(
    [
      crit('rating100', 'GREATER_THAN', { value: 60 }),
      crit('curator_appeal', 'GREATER_THAN', '0'),
    ],
    {
      rating100: { value: 60, modifier: 'GREATER_THAN' },
      curator_appeal: { value: 0, modifier: 'GREATER_THAN' },
    },
  )
  const f = describeFilter(list, known)
  assert.deepEqual(f.criteria, {
    rating100: { value: 60, modifier: 'GREATER_THAN' },
  })
  assert.deepEqual(f.notApplied, ['Curator Appeal not applied'])
  assert.equal(f.label, 'Rating > 60 · Curator Appeal not applied')
  assert.equal(f.fullLabel, 'Rating > 60 · Curator Appeal not applied')
  assert.equal(f.active, true, 'the list is still filtered')
  assert.equal(f.count, 2)
  assert.equal(
    f.key,
    describeFilter(
      filterOf([crit('rating100', 'GREATER_THAN', { value: 60 })], {
        rating100: { value: 60, modifier: 'GREATER_THAN' },
      }),
      known,
    ).key,
    'the same query, the same key',
  )

  const alone = describeFilter(
    filterOf(
      [
        crit('gender', 'INCLUDES', ['Female']),
        crit('curator_affinity', 'GREATER_THAN', '0'),
      ],
      {
        gender: { value_list: ['FEMALE'], modifier: 'INCLUDES' },
        curator_affinity: { value: 0, modifier: 'GREATER_THAN' },
      },
    ),
    known,
  )
  assert.equal(alone.label, 'Curator affinity not applied')
  assert.equal(alone.fullLabel, 'Female · Curator affinity not applied')
  assert.equal(alone.gender, 'FEMALE')

  assert.deepEqual(
    describeFilter(filterOf([], { some_field: { value: 1 } }), known)
      .notApplied,
    ['Some field not applied'],
    'a key no criterion carries as its type',
  )

  const unknown = describeFilter(list)
  assert.ok('curator_appeal' in unknown.criteria, 'no fields: every key goes')
  assert.deepEqual(unknown.notApplied, [])
})

test("criteria in URLs, encoded as Stash's ListFilterModel does", () => {
  assert.equal(
    encodeCriterion({ type: 'gender', modifier: 'IS_NULL' }),
    '(%22type%22:%22gender%22,%22modifier%22:%22IS_NULL%22)',
  )
  // braces inside strings stay; the reserved ?#&;=+ are encoded
  assert.equal(
    encodeCriterion({ type: 'tags', value: 'a{b}&c=d' }),
    '(%22type%22:%22tags%22,%22value%22:%22a%7Bb%7D%26c%3Dd%22)',
  )
  assert.equal(
    encodeCriterion({ type: 't', value: 'say "hi" {x}' }),
    '(%22type%22:%22t%22,%22value%22:%22say%20%5C%22hi%5C%22%20%7Bx%7D%22)',
    'escaped quotes do not end the string',
  )
  assert.equal(listUrl('/performers'), '/performers')
  assert.equal(
    noGenderUrl(),
    '/performers?c=(%22type%22:%22gender%22,%22modifier%22:%22IS_NULL%22)',
  )
  assert.equal(taggerUrl(), noGenderUrl() + '&disp=3')
  assert.equal(
    toRateUrl(),
    '/scenes?c=(%22type%22:%22rating100%22,%22modifier%22:%22IS_NULL%22)&sortby=play_count&sortdir=desc',
  )
  assert.equal(
    customFieldUrl('cherrypick_titles'),
    '/performers?c=(%22type%22:%22custom_fields%22,%22value%22:%5B(%22field%22:%22cherrypick_titles%22,%22modifier%22:%22GREATER_THAN%22,%22value%22:%5B0%5D)%5D)',
    'a number, so Stash compares it as one',
  )
})

test('which list a list component is', () => {
  assert.deepEqual(listPlace('performer', '/performers'), {
    place: 'performers',
  })
  assert.deepEqual(listPlace('performer', '/performers/'), {
    place: 'performers',
  })
  assert.equal(listPlace('performer', '/tags/3/performers'), null)
  assert.equal(listPlace('performer', '/performers/7/appearswith'), null)
  assert.deepEqual(listPlace('scene', '/scenes'), { place: 'scenes' })
  assert.deepEqual(listPlace('scene', '/performers/7'), {
    place: 'performer-scenes',
    performerId: '7',
  })
  assert.deepEqual(listPlace('scene', '/performers/7/scenes'), {
    place: 'performer-scenes',
    performerId: '7',
  })
  assert.deepEqual(listPlace('scene', '/tags/3'), { place: 'scene-list' })
  assert.deepEqual(listPlace('scene', '/studios/2/scenes'), {
    place: 'scene-list',
  })
  assert.equal(listPlace('gallery', '/galleries'), null)
})
