// The pure parts of judging a scene in a scene bracket (judge.jsx): reading
// Stash's sprite list, spacing frames over a scene, the next match, the
// resolution's name and the card's tags. No React and no Stash here, so
// unit tests can run them.
import { isPlaceholderTag } from '../../model/util.js'

// A scene with no sprite sheet
export const NONE = { frames: [] }

// Stash's sprite list: 81 cues of "<hash>_sprite.jpg#xywh=x,y,w,h", evenly
// over the runtime. Each frame keeps its start time and its cell.
export function parseSprites(text, base) {
  const frames = []
  let url = null
  let t = null
  for (const line of text.split(/\r?\n/)) {
    const time = line.match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+-->/)
    if (time) {
      t = (+time[1] || 0) * 3600 + +time[2] * 60 + +time[3]
      continue
    }
    const cell = line.match(/^(.+)#xywh=(\d+),(\d+),(\d+),(\d+)\s*$/)
    if (cell && t != null) {
      url ||= new URL(cell[1], base).href
      const [x, y, w, h] = cell.slice(2).map(Number)
      frames.push({ t, x, y, w, h })
      t = null
    }
  }
  if (!frames.length) return NONE
  return {
    url,
    frames,
    width: Math.max(...frames.map((f) => f.x + f.w)),
    height: Math.max(...frames.map((f) => f.y + f.h)),
  }
}

// k frames spread evenly over n, each from the middle of its stretch
export const evenly = (k, n) =>
  n
    ? Array.from({ length: Math.min(k, n) }, (_, j) =>
        Math.round(((j + 0.5) * n) / Math.min(k, n) - 0.5),
      )
    : []

// The next match whose two scenes are known, after the current one, so
// its pictures are ready before the pick
export function nextPair(st) {
  const cur = st.current
  if (!cur) return []
  for (let r = cur.round; r < st.rounds.length; r++)
    for (
      let i = r === cur.round ? cur.index + 1 : 0;
      i < st.rounds[r].length;
      i++
    ) {
      const m = st.rounds[r][i]
      if (m.a && m.b && !m.winner) return [m.a, m.b]
    }
  return []
}

// Stash's resolution names, from the shorter side
const RESOLUTIONS = [
  [4320, '8K'],
  [2880, '5K'],
  [2160, '4K'],
  [1440, '1440p'],
  [1080, '1080p'],
  [720, '720p'],
  [540, '540p'],
  [480, '480p'],
  [360, '360p'],
  [240, '240p'],
]
export function resolution(s) {
  const side = Math.min(s.width || Infinity, s.height || Infinity)
  if (!Number.isFinite(side)) return null
  const hit = RESOLUTIONS.find(([px]) => side >= px * 0.95)
  return hit ? hit[1] : `${side}p`
}

// How many owned scenes carry each tag: a rarer tag says more about one
// scene. Kept per library copy.
const tagCounts = new WeakMap()
function tagCount(db) {
  let counts = tagCounts.get(db)
  if (!counts) {
    counts = new Map()
    for (const s of db.owned)
      for (const t of s.tags) counts.set(t.id, (counts.get(t.id) || 0) + 1)
    tagCounts.set(db, counts)
  }
  return counts
}

// The card's tags: the rarest in the library first, leaving out tags about
// the file or the release and placeholders. One row shows as many as fit.
export function cardTags(db, s, n = 8) {
  const counts = tagCount(db)
  return s.tags
    .filter((t) => !isPlaceholderTag(t))
    .sort(
      (a, b) =>
        (counts.get(a.id) || 0) - (counts.get(b.id) || 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, n)
}
