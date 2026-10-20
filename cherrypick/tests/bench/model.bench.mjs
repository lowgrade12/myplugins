// How long the taste model takes on a big library, the work that runs in
// the browser on every library change.
//   node --max-old-space-size=8192 tests/bench/model.bench.mjs [scenes] [performers] [played]
// With `played` given, the library is shaped like one whose ratings all come
// from Restash's mirror (restash_score = rating100, none of the user's own)
// and only that many scenes were played.
import { syntheticLibrary } from '../unit/fixtures/synthetic.mjs'
import { buildDb } from '../../src/js/model/db.js'
import { createEngine } from '../../src/js/model/index.js'

const n = Number(process.argv[2] || 25000)
const nPerf = Number(process.argv[3]) || undefined
const played = process.argv[4] != null ? Number(process.argv[4]) : null
const lib = syntheticLibrary({ scenes: n, performers: nPerf }).input
if (played != null) {
  const playedIds = new Set(
    lib.scenes.filter((s) => s.play_count > 0).slice(0, played).map((s) => s.id),
  )
  for (const s of lib.scenes) {
    const r = s.rating100 ?? 20 + ((Number(s.id) * 37) % 80)
    s.rating100 = r
    s.custom_fields = { ...(s.custom_fields || {}), restash_score: r }
    if (!playedIds.has(s.id)) {
      s.play_count = 0
      s.play_duration = 0
      s.play_history = []
      s.last_played_at = null
      s.resume_time = 0
      s.o_counter = 0
      s.o_history = []
    }
  }
  console.log(`restash-mirrored library, ${playedIds.size} played`)
}
const input = {
  overrides: {},
  performerOverrides: {},
  decisions: [],
  notInterested: [],
  dontLearn: [],
  learnFromMatches: false,
}
const time = (label, fn) => {
  const t0 = performance.now()
  const out = fn()
  console.log(label.padEnd(28), Math.round(performance.now() - t0), 'ms')
  return out
}
const db = time('buildDb', () => buildDb({ ...lib }))
const engine = createEngine(db)
const M = time('first compute (fit)', () => engine.compute(input))
console.log('rated (own):', M.fits.rated.length, 'watched unrated:', M.fits.watchedUnrated.length, 'gate:', M.gate)
time('compute again (fit cached)', () => engine.compute(input))
const deferred = createEngine(db, { deferCv: true })
time('deferred: first compute', () => deferred.compute(input))
const steps = deferred.finishCv()
for (let i = 0; ; i++) {
  const t0 = performance.now()
  const { done } = steps.next()
  console.log(`deferred: cv task ${i + 1}`.padEnd(28), Math.round(performance.now() - t0), 'ms')
  if (done) break
}
