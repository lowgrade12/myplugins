import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb } from '../../src/js/model/db.js'
import * as BR from '../../src/js/model/brackets.js'
import { createEngine } from '../../src/js/model/index.js'
import {
  NONE,
  cardTags,
  evenly,
  nextPair,
  parseSprites,
  resolution,
} from '../../src/js/features/brackets/sheet.js'
import { syntheticLibrary } from './fixtures/synthetic.mjs'

// A sprite list as Stash writes it: 81 cues of 160x90 cells, nine a row
function spriteList(seconds, { w = 160, h = 90 } = {}) {
  const t = (s) => {
    const hh = Math.floor(s / 3600)
    const mm = Math.floor((s % 3600) / 60)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`
  }
  const step = seconds / 81
  const cues = Array.from({ length: 81 }, (_, i) => {
    const x = (i % 9) * w
    const y = Math.floor(i / 9) * h
    return `${t(i * step)} --> ${t((i + 1) * step)}\nabc123_sprite.jpg#xywh=${x},${y},${w},${h}`
  })
  return 'WEBVTT\n\n' + cues.join('\n\n') + '\n'
}

test("Stash's sprite list reads as 81 frames over the runtime", () => {
  const base = 'http://localhost:9999/scene/abc123_thumbs.vtt'
  const sheet = parseSprites(spriteList(2 * 3600 + 30), base)
  assert.equal(sheet.url, 'http://localhost:9999/scene/abc123_sprite.jpg')
  assert.equal(sheet.frames.length, 81)
  const { t, ...cell } = sheet.frames[10]
  assert.equal(t.toFixed(3), (10 * ((2 * 3600 + 30) / 81)).toFixed(3))
  assert.deepEqual(cell, { x: 160, y: 90, w: 160, h: 90 })
  assert.equal(sheet.width, 9 * 160)
  assert.equal(sheet.height, 9 * 90)
  // a 4:3 scene's cells
  assert.equal(parseSprites(spriteList(600, { h: 120 }), base).frames[0].h, 120)
})

test('a missing or empty sprite list has no frames', () => {
  assert.equal(parseSprites('', 'http://localhost/x.vtt'), NONE)
  assert.equal(parseSprites('WEBVTT\n\n', 'http://localhost/x.vtt'), NONE)
  assert.equal(
    parseSprites('<html>404 page not found</html>', 'http://localhost/x.vtt'),
    NONE,
  )
})

test('frames spread evenly over the runtime, each from the middle of its stretch', () => {
  assert.deepEqual(evenly(8, 81), [5, 15, 25, 35, 45, 55, 65, 75])
  const fifteen = evenly(15, 81)
  assert.equal(fifteen.length, 15)
  assert.equal(new Set(fifteen).size, 15)
  assert.ok(fifteen[0] >= 0 && fifteen.at(-1) <= 80)
  assert.deepEqual(evenly(8, 3), [0, 1, 2])
  assert.deepEqual(evenly(8, 0), [])
})

test("resolution names follow Stash's, from the shorter side", () => {
  assert.equal(resolution({ width: 3840, height: 2160 }), '4K')
  assert.equal(resolution({ width: 1920, height: 1080 }), '1080p')
  assert.equal(resolution({ width: 1920, height: 1072 }), '1080p')
  assert.equal(resolution({ width: 1080, height: 1920 }), '1080p')
  assert.equal(resolution({ width: 640, height: 360 }), '360p')
  assert.equal(resolution({ width: 200, height: 112 }), '112p')
  assert.equal(resolution({ width: null, height: null }), null)
})

test('the card shows the rarest tags first, without placeholders', () => {
  const { input } = syntheticLibrary()
  const db = buildDb(input)
  const s = db.owned.find((x) => x.tags.length >= 3)
  const counts = new Map()
  for (const o of db.owned)
    for (const t of o.tags) counts.set(t.id, (counts.get(t.id) || 0) + 1)
  const tags = cardTags(db, s)
  const n = tags.map((t) => counts.get(t.id))
  assert.deepEqual(
    n,
    [...n].sort((a, b) => a - b),
  )
  const withPlaceholders = {
    ...s,
    tags: [
      ...s.tags,
      { id: 'x1', name: 'todo' },
      { id: 'x2', name: '4K Available' },
    ],
  }
  assert.deepEqual(
    cardTags(db, withPlaceholders).map((t) => t.id),
    tags.map((t) => t.id),
  )
})

test('the next match is the first undecided one with both scenes known', () => {
  const { input } = syntheticLibrary()
  const db = buildDb(input)
  const M = createEngine(db).compute({})
  const ids = BR.bracketScenes(M)
    .slice(0, 16)
    .map((s) => s.id)
  let b = BR.createBracket(M, {
    kind: 'clip',
    poolLabel: 'All',
    size: 16,
    ids,
    now: Date.parse('2026-10-01T00:00:00Z'),
  })
  let st = BR.bracketState(b)
  const second = st.rounds[0][1]
  assert.deepEqual(nextPair(st), [second.a, second.b])
  // the last match of a round: the next round's first match, once both
  // of its scenes are known
  for (let i = 0; i < 7; i++) {
    b = BR.pick(b, st.current.a)
    st = BR.bracketState(b)
  }
  assert.equal(st.current.index, 7)
  const next = st.rounds[1][0]
  assert.deepEqual(nextPair(st), [next.a, next.b])
  b = BR.pick(b, st.current.a)
  st = BR.bracketState(b)
  assert.deepEqual(nextPair(st), [st.rounds[1][1].a, st.rounds[1][1].b])
})
