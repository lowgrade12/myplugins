import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syntheticLibrary } from './fixtures/synthetic.mjs'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'

const db = buildDb(syntheticLibrary({ scenes: 400 }).input)

const finish = (engine) => {
  const steps = engine.finishCv()
  let n = 0
  for (;;) {
    const { done, value } = steps.next()
    if (done) return { value, steps: n }
    n++
  }
}

test('a deferred cross-validation ends where the plain one does', () => {
  const plain = createEngine(db).compute({})
  const engine = createEngine(db, { deferCv: true })
  const before = engine.compute({})
  assert.equal(before.fits.cvPending, true)
  assert.equal(before.cv, null)
  assert.equal(before.gate, false)
  const { value, steps } = finish(engine)
  assert.equal(steps, 4) // five folds, a yield between each
  const after = engine.compute({})
  assert.equal(after.fits.cvPending, false)
  assert.equal(after.cv.maeModel, plain.cv.maeModel)
  assert.equal(after.cv.maeBase, plain.cv.maeBase)
  assert.equal(after.gate, plain.gate)
  assert.equal(value.maeModel, plain.cv.maeModel)
})

test('until it finishes, the last numbers kept stand in for the gate', () => {
  const plain = createEngine(db).compute({})
  const { rows, ...kept } = plain.cv
  const M = createEngine(db, { deferCv: true, provisionalCv: kept }).compute({})
  assert.equal(M.fits.cvPending, true)
  assert.equal(M.gate, plain.gate)
})

test('a refit while it runs drops the stale result', () => {
  const engine = createEngine(db, { deferCv: true })
  engine.compute({})
  const steps = engine.finishCv()
  steps.next()
  engine.compute({ dontLearn: [db.owned[0].id] })
  let r
  do r = steps.next()
  while (!r.done)
  assert.equal(r.value, null)
  assert.equal(engine.cache.fits.cvPending, true)
})
