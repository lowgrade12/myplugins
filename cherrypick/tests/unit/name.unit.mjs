import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIELD_PREFIX,
  PLUGIN_ROUTE,
  STORAGE_PREFIX,
} from '../../src/js/name.js'

test('prefixes derive from the plugin id', () => {
  assert.equal(PLUGIN_ROUTE, '/plugins/cherrypick')
  assert.equal(FIELD_PREFIX, 'cherrypick_')
  assert.equal(STORAGE_PREFIX, 'cherrypick:')
})
