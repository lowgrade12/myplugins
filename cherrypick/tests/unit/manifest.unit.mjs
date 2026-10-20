import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  inManifestOrder,
  MANIFEST_SETTINGS,
} from '../../src/js/storage/settings.js'

const manifest = await readFile(
  new URL('../../src/CherryPick.yml', import.meta.url),
  'utf8',
)

test('the manifest declares every setting the plugin reads, with its type', () => {
  const declared = [
    ...manifest.matchAll(/^ {2}(\w+):\n(?:^ {4}.*\n)*? {4}type: (\w+)$/gm),
  ].map((m) => [m[1], m[2]])
  assert.deepEqual(
    declared,
    MANIFEST_SETTINGS.map((s) => [s.key, s.type]),
  )
})

test('the manifest lets the browser reach StashDB', () => {
  assert.match(manifest, /connect-src:\n\s+- https:\/\/stashdb\.org/)
})

test("Settings › Plugins lists Cherry Pick's switches in manifest order", () => {
  const order = MANIFEST_SETTINGS.map((s) => s.key)
  const shuffled = [...order].reverse().map((name) => ({ name }))
  assert.deepEqual(
    inManifestOrder(shuffled).map((s) => s.name),
    order,
  )
})
