// Tier 1: the plugin's configuration map, kept by Stash in config.yml with
// configurePlugin and the same in every browser. It holds the settings, the
// remembered bracket choice, Not interested, Don't learn, the bracket in
// progress, the Hall of Fame, applied-rating batches, consent, the answer
// to the offer beside Stash Curator, the auto-apply default last written
// and Watch This's snoozes: a few KB, the snoozes at most 300 entries.
//
// Two Stash behaviours shape it:
//   - configurePlugin replaces the plugin's whole map, so every write is
//     read-modify-write.
//   - Stash's Settings page loads the configuration when it opens and, on any
//     toggle, writes back the copy it loaded. A value the plugin wrote while
//     that page was open would be lost, so the plugin's writes wait until the
//     user leaves Settings, then land on top.
// A mirror of the map lives in browser storage. On load, a missing map is
// restored from it, and a map older than the mirror gets the plugin's data
// keys back while keeping the settings Stash wrote.
//
// Each data key holds one JSON string. Stash keeps nested maps, but numbers
// inside arrays come back as strings after a restart (its YAML writer has no
// case for them), and a string round-trips exactly.
import { SETTING_DEFAULTS, SETTING_KEYS } from './settings.js'

// Keys the plugin itself writes (the settings are written by Stash's page).
export const DATA_KEYS = [
  'bracketPrefs',
  'notInterested',
  'dontLearn',
  'bracket',
  'hallOfFame',
  'applied',
  'consent',
  'curatorOffer',
  'autoApplyDefault',
  'snoozes',
]
export const ALL_KEYS = [...SETTING_KEYS, ...DATA_KEYS]

// A data key's value: JSON text, or (from an older or hand-edited map) the
// value itself. Unreadable text counts as missing.
function decode(v) {
  if (typeof v !== 'string') return v ?? null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}
const encode = (v) => (v == null ? null : JSON.stringify(v))

// The map, as the plugin's state reads it.
export function fromConfig(map) {
  const m = map || {}
  const settings = { ...SETTING_DEFAULTS }
  for (const k of SETTING_KEYS) if (m[k] != null) settings[k] = m[k]
  return {
    settings,
    bracketPrefs: decode(m.bracketPrefs),
    notInterested: decode(m.notInterested) || [],
    dontLearn: decode(m.dontLearn) || [],
    brackets: {
      active: decode(m.bracket),
      history: decode(m.hallOfFame) || [],
    },
    applied: decode(m.applied) || [],
    consent: decode(m.consent) || { stashdb: null },
    // 'hide' or 'keep' once the user answered (model/curator.js)
    curatorOffer: decode(m.curatorOffer),
    // the autoApply value Cherry Pick last wrote (autoApplyToWrite)
    autoApplyDefault: decode(m.autoApplyDefault),
    // Watch This's skipped and ignored scenes (model/watch.js Snooze)
    snoozes: decode(m.snoozes) || [],
  }
}

// The plugin's state, as the map stores it.
export function toConfig(s) {
  return {
    ...Object.fromEntries(SETTING_KEYS.map((k) => [k, s.settings[k]])),
    bracketPrefs: encode(s.bracketPrefs),
    notInterested: encode(s.notInterested),
    dontLearn: encode(s.dontLearn),
    bracket: encode(s.brackets.active),
    hallOfFame: encode(s.brackets.history),
    applied: encode(s.applied),
    consent: encode(s.consent),
    curatorOffer: encode(s.curatorOffer),
    autoApplyDefault: encode(s.autoApplyDefault),
    snoozes: encode(s.snoozes),
  }
}

// Which config keys each piece of plugin state lands in.
export const STATE_TO_CONFIG = {
  bracketPrefs: ['bracketPrefs'],
  notInterested: ['notInterested'],
  dontLearn: ['dontLearn'],
  brackets: ['bracket', 'hallOfFame'],
  applied: ['applied'],
  consent: ['consent'],
  curatorOffer: ['curatorOffer'],
  snoozes: ['snoozes'],
}

// The map Stash's Settings page saves when the Curator offer is answered
// there: that page's own copy, with the answer and the settings it changes.
// The page writes its copy back on every toggle, so the answer goes through
// it rather than past it.
export const withCuratorAnswer = (map, answer, settings) => ({
  ...map,
  ...settings,
  curatorOffer: encode(answer),
})

/**
 * @param {{
 *   read: () => Promise<object|null>,      // this plugin's map from Stash
 *   write: (map: object) => Promise<void>, // configurePlugin
 *   mirror: { get: () => object|null, set: (map: object) => void, del: () => void },
 *   settingsOpen: () => boolean,
 *   now?: () => string,
 *   log?: (text: string) => void,
 * }} io
 */
export function createTier1(io) {
  const now = io.now || (() => new Date().toISOString())
  const log = io.log || (() => {})
  const pending = new Set()
  const pendingOwn = new Set()
  let pendingFull = null
  let chain = Promise.resolve()

  // Writes run one at a time, so two read-modify-writes never interleave.
  const serial = (fn) => (chain = chain.then(fn, fn))

  // own: settings among keys the user changed through the plugin itself,
  // which are written over Stash's value.
  async function readModifyWrite(full, keys, own = []) {
    const cur = await io.read()
    const mirror = io.mirror.get()
    const stale =
      !!cur && !!mirror?.updatedAt && (cur.updatedAt || '') < mirror.updatedAt
    const write = new Set(
      !cur || cur.removedAt ? ALL_KEYS : stale ? [...DATA_KEYS, ...keys] : keys,
    )
    // After a removal the map starts empty but keeps its tombstone, so
    // another browser's older mirror still cannot bring old data back.
    const next =
      cur && !cur.removedAt
        ? { ...cur }
        : cur?.removedAt
          ? { removedAt: cur.removedAt }
          : {}
    // Settings are Stash's to write: the plugin only fills in one the map
    // lacks (the defaults, or a map restored from the mirror), or one the
    // user changed through the plugin (own). A deferred write that carried
    // the plugin's older copy would otherwise undo a switch the user just
    // turned on Stash's Settings page.
    const stashOwns = (k) =>
      SETTING_KEYS.includes(k) &&
      !own.includes(k) &&
      !!cur &&
      !cur.removedAt &&
      cur[k] != null
    for (const k of write)
      if (full[k] !== undefined && !stashOwns(k)) next[k] = full[k]
    next.updatedAt = now()
    await io.write(next)
    io.mirror.set(next)
    log(
      !cur
        ? 'configurePlugin: the map was missing; wrote back everything'
        : stale
          ? "configurePlugin: the map was stale; wrote back the plugin's data"
          : `configurePlugin: ${[...keys].join(', ')}`,
    )
    return 'written'
  }

  return {
    // full: the whole map from the plugin's state; keys: what changed;
    // own: settings among them the user changed through the plugin itself
    // (Hide on cards, off Stash's Settings page), written over Stash's.
    save(full, keys, own = []) {
      if (!keys.length) return Promise.resolve('none')
      if (io.settingsOpen()) {
        keys.forEach((k) => pending.add(k))
        own.forEach((k) => pendingOwn.add(k))
        pendingFull = full
        log(`deferred ${keys.join(', ')}: Stash's Settings page is open`)
        return Promise.resolve('deferred')
      }
      return serial(() => readModifyWrite(full, keys, own))
    },

    // Call when the user leaves Stash's Settings page.
    flush(full) {
      if (!pending.size) return Promise.resolve('none')
      const keys = [...pending]
      const own = [...pendingOwn]
      const map = full || pendingFull
      pending.clear()
      pendingOwn.clear()
      pendingFull = null
      return serial(() => readModifyWrite(map, keys, own))
    },

    pending: () => [...pending],

    // Records a change in the mirror at once, ahead of a debounced save, so
    // a tab closed before the save still has it at the next load (the
    // mirror is then newer than Stash's map, and load restores it).
    stage(full, keys) {
      const next = { ...(io.mirror.get() || {}) }
      for (const k of keys) if (full[k] !== undefined) next[k] = full[k]
      next.updatedAt = now()
      io.mirror.set(next)
    },

    // The map to start from, and whether it came back from the mirror
    // ('missing' or 'stale'), in which case the caller writes it back.
    async load() {
      const cur = await io.read()
      const mirror = io.mirror.get()
      if (cur?.removedAt && cur.removedAt >= (mirror?.updatedAt || '')) {
        // The plugin's data was removed after this browser last wrote: its
        // mirror is void, and the map holds only what came after.
        io.mirror.del()
        return { map: cur, restored: null }
      }
      if (!mirror) {
        if (cur && !cur.removedAt) io.mirror.set(cur)
        return { map: cur, restored: null }
      }
      if (!cur) return { map: { ...mirror }, restored: 'missing' }
      const stale = (cur.updatedAt || '') < (mirror.updatedAt || '')
      const lost = DATA_KEYS.filter((k) => mirror[k] != null && cur[k] == null)
      if (stale || lost.length) {
        const map = { ...cur }
        for (const k of stale ? DATA_KEYS : lost) map[k] = mirror[k]
        return { map, restored: stale ? 'stale' : 'missing' }
      }
      return { map: cur, restored: null }
    },

    // "Remove Cherry Pick data": a tombstone stops other browsers' mirrors
    // from bringing the data back.
    async remove() {
      await serial(async () => {
        await io.write({ removedAt: now() })
        io.mirror.del()
      })
    },
  }
}
