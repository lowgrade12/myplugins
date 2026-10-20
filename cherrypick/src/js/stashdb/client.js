// The StashDB client: GraphQL over POST to the stash-box endpoint with the
// user's key in the ApiKey header, the way Stash's own client sends it.
// StashDB is a community service, so the client is polite:
//   - one request at a time, at least a second apart;
//   - at most a few requests per page view, and a request queued for a page
//     the user has left is dropped;
//   - a 429 or a server error rests it for ten minutes (longer if StashDB
//     says so), a network error for a minute, a refused key for the session.
// A failure is never an error on the page: the lookup returns nothing, and
// the page shows what it has without StashDB.
//
// Answers are kept in IndexedDB (tier 3), one entry per lookup
// (`stashdb:<lookup>:<id>`), so a second visit to a page sends nothing. An
// answer under 7 days old is used as it is. One from 7 to 30 days old, or
// kept in an older format, is used too, and asked for again in the
// background once the page's own lookups are done (revalidate): the new
// answer is only kept, and shows the next time a page asks for it, so
// nothing on the page changes under the user. One over 30 days old is asked
// for again before it is used.
// Everything it touches comes in as arguments, so the unit tests run it with
// a fake fetch, cache and clock.

export const CACHE_PREFIX = 'stashdb:'
// What a lookup keeps, by version. An entry from an older version is used
// while it is asked for again, so a new version must still read the old
// ones (2: links carry their site's category, for store links).
export const CACHE_FORMAT = 2
export const TTL_MS = 7 * 24 * 3600 * 1000
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000
export const GAP_MS = 1000
export const PER_VIEW = 6
const TIMEOUT_MS = 20 * 1000
const REST_MS = 10 * 60 * 1000
const NETWORK_REST_MS = 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {{
 *   endpoint: string,
 *   apiKey: string,
 *   fetch: typeof fetch,
 *   cache: { get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<void> },
 *   now?: () => number,
 *   wait?: (ms: number) => Promise<void>,
 *   gapMs?: number,
 *   perView?: number,
 *   ttlMs?: number,
 *   maxAgeMs?: number,
 *   timeoutMs?: number,
 *   log?: (text: string) => void,
 * }} io
 */
export function createStashdbClient(io) {
  const now = io.now || Date.now
  const wait = io.wait || sleep
  const gapMs = io.gapMs ?? GAP_MS
  const perView = io.perView ?? PER_VIEW
  const ttlMs = io.ttlMs ?? TTL_MS
  const maxAgeMs = io.maxAgeMs ?? MAX_AGE_MS
  const timeoutMs = io.timeoutMs ?? TIMEOUT_MS
  const log = io.log || (() => {})

  let view = 0
  let sent = 0 // this view
  let lastAt = -Infinity
  let restUntil = 0
  let refused = false
  let chain = Promise.resolve()
  const inflight = new Map()
  // stale lookups to ask for again this view (key -> job), and the ones
  // being asked for now
  const later = new Map()
  const refreshing = new Set()
  const stats = { requests: 0, hits: 0, skipped: 0, failed: 0 }

  function rest(ms, why) {
    restUntil = Math.max(restUntil, now() + ms)
    log(`StashDB lookups paused for ${Math.round(ms / 1000)} s: ${why}`)
  }

  async function send(text, variables, forView) {
    const skip = (why) => {
      stats.skipped++
      log(`StashDB request skipped: ${why}`)
      return null
    }
    if (refused) return skip('StashDB refused the key')
    if (forView !== view) return skip('the page changed')
    if (now() < restUntil) return skip('resting')
    if (sent >= perView) return skip(`${perView} requests this page already`)
    const delay = lastAt + gapMs - now()
    if (delay > 0) await wait(delay)
    if (forView !== view) return skip('the page changed')
    sent++
    stats.requests++
    lastAt = now()
    try {
      const res = await io.fetch(io.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ApiKey: io.apiKey },
        body: JSON.stringify({ query: text, variables }),
        // never follow a redirect with the key, never send cookies or the
        // address of the Stash page
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401 || res.status === 403) {
        refused = true
        throw new Error(`HTTP ${res.status}`)
      }
      if (res.status === 429 || res.status >= 500) {
        const after = Number(res.headers?.get?.('Retry-After')) * 1000
        rest(Math.max(REST_MS, after || 0), `HTTP ${res.status}`)
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (body.errors?.length) {
        const msg = body.errors.map((e) => e.message).join('; ')
        if (/not authori[sz]ed|unauthori[sz]ed|signature|api key/i.test(msg))
          refused = true
        throw new Error(msg)
      }
      return body.data ?? null
    } catch (e) {
      stats.failed++
      if (!refused && now() >= restUntil) rest(NETWORK_REST_MS, String(e))
      log(`StashDB request failed: ${e?.message || e}`)
      return null
    } finally {
      lastAt = now()
    }
  }

  return {
    stats,

    // A new page view: the per-view count starts again, and requests still
    // queued for the page before are dropped.
    newView() {
      view++
      sent = 0
      later.clear()
    },

    // One GraphQL request, queued behind the others. Resolves to the
    // answer's data, or null (skipped or failed).
    request(text, variables) {
      const forView = view
      const p = chain.then(() => send(text, variables, forView))
      chain = p.catch(() => null)
      return p
    },

    // The cached entry for a lookup if it can be used: { at, data, stale },
    // or null. stale: old enough or in an older format to ask for again.
    async peek(key) {
      const hit = await io.cache.get(CACHE_PREFIX + key)
      if (!hit || typeof hit.at !== 'number') return null
      const age = now() - hit.at
      if (age >= maxAgeMs) return null
      stats.hits++
      return { ...hit, stale: age >= ttlMs || hit.v !== CACHE_FORMAT }
    },

    async put(key, data) {
      const entry = { at: now(), v: CACHE_FORMAT, data }
      await io.cache.set(CACHE_PREFIX + key, entry)
      return entry
    },

    // Ask for a stale lookup again once this view's own lookups are done:
    // job sends the requests and keeps the answer. One job per key.
    refresh(key, job) {
      if (!later.has(key) && !refreshing.has(key)) later.set(key, job)
    },

    // The refreshes queued for this view, one after another, through the
    // same queue and per-view budget as every request. A new view drops
    // the rest; a refresh that fails leaves the stale entry for next time.
    async revalidate() {
      const forView = view
      for (const [key, job] of later) {
        if (forView !== view) return
        later.delete(key)
        refreshing.add(key)
        try {
          await job()
        } finally {
          refreshing.delete(key)
        }
      }
    },

    // A lookup through the cache: load() runs on a miss, and later for a
    // stale entry, and resolves to the data to keep (null is kept too:
    // "StashDB has no such scene"), or undefined when the request did not
    // happen or failed (nothing is kept). Two calls for one key share one
    // load. Resolves to the entry { at, data, stale? }, or null.
    cached(key, load) {
      if (inflight.has(key)) return inflight.get(key)
      const keep = async () => {
        const data = await load()
        return data === undefined ? null : this.put(key, data)
      }
      const p = (async () => {
        const hit = await this.peek(key)
        if (hit?.stale) this.refresh(key, keep)
        return hit || keep()
      })().finally(() => inflight.delete(key))
      inflight.set(key, p)
      return p
    },
  }
}
