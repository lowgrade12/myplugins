// patchAfter hands Cherry Pick's after patches the whole result, whatever
// shape Stash's arguments arrive in. Stash calls an after patch with
// args.concat(result) (docs/stash-seams.md), so a before patch can drop
// React's second argument and an earlier after patch's array arrives spread.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const ELEMENT = Symbol.for('react.element')
const Fragment = Symbol('Fragment')
const createElement = (type, props, ...children) => ({
  $$typeof: ELEMENT,
  type,
  props: { ...props, children },
})
const after = []
globalThis.window = {
  PluginApi: {
    React: { Fragment, createElement },
    libraries: { Apollo: {} },
    patch: { after: (name, fn) => after.push(fn) },
  },
}
const { patchAfter } = await import('../../src/js/runtime/api.js')

// What one after patch receives back, given the arguments Stash calls it with
let seen
patchAfter('Somewhere', (props, result) => (seen = result))
const call = (...args) => {
  after.at(-1)(...args)
  return seen
}

const props = { id: '1' }
const context = {}
const stash = createElement('div', { className: 'stash' })
const host = createElement('span', { key: 'host' })

test('the result after props and React context', () => {
  assert.equal(call(props, context, stash), stash)
})

test('the result after props alone, when a before patch dropped context', () => {
  assert.equal(call(props, stash), stash)
})

test("an earlier patch's array, spread by concat, comes back whole", () => {
  for (const args of [
    [props, context, stash, host],
    [props, stash, host],
  ]) {
    const r = call(...args)
    assert.equal(r.type, Fragment)
    assert.deepEqual(r.props.children, [stash, host])
  }
})

test('a result that renders nothing is null', () => {
  assert.equal(call(props, context, null), null)
  assert.equal(call(props, context), null)
  assert.equal(call(props, context, false, null), null)
})

test('a ref in the second place is not part of the result', () => {
  assert.equal(call(props, { current: null }, stash), stash)
  assert.equal(
    call(props, () => {}, stash),
    stash,
  )
})
