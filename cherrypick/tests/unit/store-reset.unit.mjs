import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isStoreReset } from '../../src/js/runtime/storeReset.js'

// What Apollo 3.14's production build throws when Stash resets the store
const PROD =
  'An error occurred! For more details, see the full error text at https://go.apollo.dev/c/err#%7B%22version%22%3A%223.14.0%22%2C%22message%22%3A42%2C%22args%22%3A%5B%5D%7D'

test("a store reset is recognised in Apollo's production and development forms", () => {
  assert.equal(isStoreReset(new Error(PROD)), true)
  assert.equal(
    isStoreReset(
      new Error('Store reset while query was in flight (not completed in link chain)'),
    ),
    true,
  )
})

test('other errors, including other Apollo codes, are not a store reset', () => {
  assert.equal(isStoreReset(new Error(PROD.replace('%3A42', '%3A48'))), false)
  assert.equal(isStoreReset(new Error('Network error: Failed to fetch')), false)
  assert.equal(isStoreReset(null), false)
  assert.equal(isStoreReset('GraphQL error: something'), false)
})
