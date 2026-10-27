// Restash on Stash's performer pages: "Not in your library", the
// performer's StashDB scenes the library doesn't have, ranked by the score
// Restash would give each one, with a link to where to get it, a link to
// StashDB and, with the Whisparr Update plugin enabled, a Whisparr button.
//
// The scenes come from Restash's "missing" plugin operation (missing.py),
// which asks StashDB on the server, so the StashDB key never reaches the
// browser. The Whisparr button asks Whisparr Update's "status" and "add"
// operations, so Whisparr's key stays on the server too.
;(function () {
  'use strict'
  // Load once per page: Stash's plugin loader re-adds plugin scripts when its
  // Apollo store resets (every finished scan), and a second run would add a
  // second row to every performer page.
  if (window.__restashUiLoaded__) return
  window.__restashUiLoaded__ = true

  const api = window.PluginApi
  const { React, patch, utils, libraries } = api
  const h = React.createElement
  const gql = libraries.Apollo.gql

  const PLUGIN_ID = 'restash' // the manifest's file name
  const WHISPARR_PLUGIN = 'whisparrUpdate'
  const PAGE = 24 // scenes per Show more
  const RESET_RETRY_MS = 5000

  // ---------- Stash's GraphQL, through its own client ----------

  const client = () => utils.StashService.getClient()
  const docs = new Map()
  const doc = (text) => {
    if (!docs.has(text)) docs.set(text, gql(text))
    return docs.get(text)
  }
  const query = (text, variables) =>
    client()
      .query({ query: doc(text), variables, fetchPolicy: 'no-cache' })
      .then((r) => r.data)
  const mutate = (text, variables) =>
    client()
      .mutate({ mutation: doc(text), variables })
      .then((r) => r.data)

  // Apollo 3 rejects every request in flight when Stash resets its store
  // (code 42 in production builds): not a failure, ask again shortly.
  function isStoreReset(e) {
    const text = String((e && e.message) || e || '')
    if (text.includes('Store reset while query was in flight')) return true
    if (!text.includes('go.apollo.dev/c/err')) return false
    try {
      return /"message"\s*:\s*42\b/.test(decodeURIComponent(text))
    } catch (_) {
      return false
    }
  }
  const later = (ms) => new Promise((r) => setTimeout(r, ms))
  async function retryResets(fn) {
    for (;;) {
      try {
        return await fn()
      } catch (e) {
        if (!isStoreReset(e)) throw e
        await later(RESET_RETRY_MS)
      }
    }
  }

  // A plugin operation's answer: {ok, result} or {ok: false, error}
  const OPERATION = (id) => `
    mutation RestashOp_${id.replace(/\W/g, '_')}($args: Map) {
      runPluginOperation(plugin_id: "${id}", args: $args)
    }`
  async function operation(pluginId, args) {
    const data = await retryResets(() => mutate(OPERATION(pluginId), { args }))
    const out = data && data.runPluginOperation
    if (!out || typeof out !== 'object') throw new Error('No answer from ' + pluginId)
    if (!out.ok) throw new Error(out.error || pluginId + ' failed')
    return out.result
  }

  // ---------- a tiny store, for state shared across components ----------

  function createStore(initial) {
    let state = initial
    const listeners = new Set()
    return {
      get: () => state,
      set(patch) {
        state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
        listeners.forEach((l) => l())
      },
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
    }
  }
  function useStore(store, select) {
    const [, force] = React.useState(0)
    const value = select(store.get())
    const last = React.useRef(value)
    last.current = value
    const selRef = React.useRef(select)
    selRef.current = select
    React.useEffect(
      () =>
        store.subscribe(() => {
          if (!Object.is(selRef.current(store.get()), last.current)) force((n) => n + 1)
        }),
      [store],
    )
    return value
  }

  // ---------- settings and installed plugins ----------

  const env = createStore({ hidden: null, whisparr: null })
  let envAsked = false
  function loadEnv() {
    if (envAsked) return
    envAsked = true
    retryResets(() =>
      query(`query RestashUiEnv {
        configuration { plugins(include: ["${PLUGIN_ID}"]) }
        plugins { id enabled }
      }`),
    )
      .then((d) => {
        const cfg = (d.configuration.plugins || {})[PLUGIN_ID] || {}
        env.set({
          // a setting nobody touched is unset: the row shows
          hidden: cfg.hideMissingRow === true,
          whisparr: (d.plugins || []).some((p) => p.id === WHISPARR_PLUGIN && p.enabled),
        })
      })
      .catch(() => env.set({ hidden: false, whisparr: false }))
  }

  // ---------- the performer's missing scenes ----------

  // {[performerId]: {limit, loading, result, error}} for this page load
  const rows = createStore({})
  function loadMissing(performerId, limit) {
    const cur = rows.get()[performerId]
    if (cur && cur.loading) return
    if (cur && cur.result && cur.limit >= limit) return
    rows.set((s) => ({ [performerId]: { ...(s[performerId] || {}), limit, loading: true, error: null } }))
    operation(PLUGIN_ID, { mode: 'missing', performer_id: performerId, limit })
      .then((result) =>
        rows.set({ [performerId]: { limit, loading: false, result, error: null } }),
      )
      .catch((e) =>
        rows.set((s) => ({
          [performerId]: { ...(s[performerId] || {}), loading: false, error: String(e.message || e) },
        })),
      )
  }

  // ---------- Whisparr, through Whisparr Update ----------

  // {[stashId]: {kind: loading|none|have|adding|error, monitored, hasFile, error}}
  const whisparr = createStore({})
  let queue = new Set()
  let timer = null
  const toState = (m) => (m ? { kind: 'have', monitored: !!m.monitored, hasFile: !!m.hasFile } : { kind: 'none' })
  function flushStatus() {
    timer = null
    const ids = [...queue].slice(0, 50)
    ids.forEach((id) => queue.delete(id))
    if (queue.size) timer = setTimeout(flushStatus, 0)
    operation(WHISPARR_PLUGIN, { mode: 'status', stash_ids: ids })
      .then((res) => whisparr.set(Object.fromEntries(ids.map((id) => [id, toState(res && res[id])]))))
      .catch((e) =>
        whisparr.set(Object.fromEntries(ids.map((id) => [id, { kind: 'error', error: String(e.message || e) }]))),
      )
  }
  function requestStatus(id) {
    if (whisparr.get()[id]) return
    whisparr.set({ [id]: { kind: 'loading' } })
    queue.add(id)
    if (timer == null) timer = setTimeout(flushStatus, 60)
  }
  function addToWhisparr(id, title) {
    whisparr.set({ [id]: { kind: 'adding' } })
    operation(WHISPARR_PLUGIN, { mode: 'add', stash_id: id, title })
      .then((res) => whisparr.set({ [id]: toState(res) }))
      .catch((e) => whisparr.set({ [id]: { kind: 'error', error: String(e.message || e) } }))
  }

  // ---------- pieces ----------

  class Safe extends React.Component {
    constructor(props) {
      super(props)
      this.state = { failed: false }
    }
    static getDerivedStateFromError() {
      return { failed: true }
    }
    componentDidCatch(e) {
      console.error('Restash: Not in your library failed and was removed', e)
    }
    render() {
      return this.state.failed ? null : this.props.children
    }
  }

  const icons = libraries.FontAwesomeSolid || {}
  function Icon({ icon, spin }) {
    const C = api.components.Icon
    return C && icon ? h(C, { icon, className: spin ? 'fa-spin' : undefined }) : null
  }

  function fmtDuration(seconds) {
    if (!seconds || seconds < 0) return null
    const s = Math.round(seconds)
    const hh = Math.floor(s / 3600)
    const mm = Math.floor((s % 3600) / 60)
    const pad = (n) => String(n).padStart(2, '0')
    return hh ? `${hh}:${pad(mm)}:${pad(s % 60)}` : `${mm}:${pad(s % 60)}`
  }

  function whisparrView(st) {
    switch (st.kind) {
      case 'loading':
        return { icon: icons.faSpinner, label: 'Whisparr', title: 'Asking Whisparr…', click: false, spin: true }
      case 'adding':
        return { icon: icons.faSpinner, label: 'Adding…', title: 'Adding to Whisparr and searching', click: false, spin: true }
      case 'none':
        return { icon: icons.faDownload, label: 'Whisparr', title: 'Add to Whisparr, monitored, and search for it', click: true }
      case 'have':
        if (st.hasFile) return { icon: icons.faCheck, label: 'Downloaded', title: 'Whisparr has this scene. Stash picks it up at its next scan.', click: false, done: true }
        if (st.monitored) return { icon: icons.faHourglassHalf, label: 'Wanted', title: 'Monitored in Whisparr. Click to search again.', click: true }
        return { icon: icons.faSearch, label: 'In Whisparr', title: 'In Whisparr, not monitored. Click to monitor it and search.', click: true }
      default:
        return { icon: icons.faExclamationTriangle, label: 'Whisparr', title: `Whisparr Update: ${st.error || 'failed'}. Click to try adding again.`, click: true, warn: true }
    }
  }

  function WhisparrButton({ scene }) {
    const on = useStore(env, (s) => s.whisparr)
    const st = useStore(whisparr, (s) => s[scene.id] || null)
    React.useEffect(() => {
      if (on) requestStatus(scene.id)
    }, [on, scene.id])
    if (!on) return null
    const v = whisparrView(st || { kind: 'loading' })
    return h(
      'button',
      {
        type: 'button',
        className: `minimal btn btn-primary restash-whisparr restash-whisparr-${(st || {}).kind || 'loading'}${v.warn ? ' text-warning' : ''}${v.done ? ' text-success' : ''}`,
        title: v.title,
        disabled: !v.click,
        onClick: () => addToWhisparr(scene.id, scene.title),
      },
      h(Icon, { icon: v.icon, spin: v.spin }),
      h('span', null, v.label),
    )
  }

  const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' }

  // The store link's label: the store's name (ManyVids, Clips4Sale, ...),
  // or for a studio's own site, which StashDB names "Studio", the studio's
  const studioSite = (scene) => /^studio$/i.test((scene.store && scene.store.site) || '')
  const storeLabel = (scene) =>
    studioSite(scene) && scene.studio ? scene.studio : scene.store.site

  function MissingCard({ scene, site }) {
    const url = `${site}/scenes/${encodeURIComponent(scene.id)}`
    const duration = fmtDuration(scene.duration)
    const TruncatedText = api.components.TruncatedText
    return h(
      'div',
      { className: 'card grid-card scene-card zoom-1 restash-missing-card' },
      h(
        'div',
        { className: 'thumbnail-section video-section' },
        h(
          'a',
          { href: url, className: 'scene-card-link', ...EXTERNAL },
          h(
            'div',
            { className: 'scene-card-preview' },
            scene.image
              ? h('img', { className: 'scene-card-preview-image', loading: 'lazy', src: scene.image, alt: '' })
              : null,
          ),
        ),
        scene.score != null
          ? h(
              'span',
              {
                className: 'badge badge-primary restash-score-badge',
                title: `Restash would score this ${scene.score} (0–100)`,
              },
              `Restash ${scene.score}`,
            )
          : null,
        duration
          ? h('div', { className: 'scene-specs-overlay' }, h('span', { className: 'overlay-duration' }, duration))
          : null,
        scene.studio ? h('div', { className: 'studio-overlay' }, h('span', null, scene.studio)) : null,
        h('span', { className: 'badge badge-secondary restash-missing-badge' }, 'Not in your library'),
      ),
      h(
        'div',
        { className: 'card-section' },
        h(
          'a',
          { href: url, ...EXTERNAL },
          h(
            'h5',
            { className: 'card-section-title flex-aligned' },
            TruncatedText ? h(TruncatedText, { text: scene.title, lineCount: 2 }) : scene.title,
          ),
        ),
        h(
          'div',
          { className: 'scene-card__details' },
          h('span', { className: 'scene-card__date' }, scene.date),
          scene.reason ? h('div', { className: 'scene-card__description restash-reason' }, scene.reason) : null,
        ),
      ),
      h('hr'),
      h(
        'div',
        { className: 'card-popovers btn-group' },
        scene.store
          ? h(
              'a',
              {
                className: 'minimal btn btn-primary restash-store-link',
                href: scene.store.url,
                title: studioSite(scene)
                  ? `The scene on ${scene.studio || "its studio"}'s site`
                  : `The scene on ${scene.store.site}`,
                ...EXTERNAL,
              },
              h(Icon, { icon: icons.faExternalLinkAlt }),
              // StashDB calls every studio's own site "Studio": name the studio
              h('span', { className: 'restash-store-name' }, storeLabel(scene)),
            )
          : null,
        h(
          'a',
          { className: 'minimal btn btn-primary restash-stashdb-link', href: url, title: 'Open on StashDB', ...EXTERNAL },
          h(Icon, { icon: icons.faDatabase }),
          h('span', null, 'StashDB'),
        ),
        h(WhisparrButton, { scene }),
      ),
    )
  }

  function NotInYourLibrary({ performer }) {
    const hidden = useStore(env, (s) => s.hidden)
    const entry = useStore(rows, (s) => s[performer.id] || null)
    React.useEffect(loadEnv, [])
    const linked = (performer.stash_ids || []).some((x) => /stashdb\.org/i.test(x.endpoint || ''))
    React.useEffect(() => {
      if (hidden === false && linked) loadMissing(performer.id, PAGE)
    }, [hidden, linked, performer.id])
    if (hidden !== false || !linked) return null
    const result = entry && entry.result
    const scenes = (result && result.scenes) || []
    let note = null
    if (!entry || (entry.loading && !result)) note = 'Asking StashDB for their scenes…'
    else if (entry.error && !result) note = entry.error
    else if (result && !result.linked) return null
    else if (result && !scenes.length) return null
    const header = h(
      'div',
      { className: 'restash-missing-head' },
      h('h4', { className: 'restash-missing-title' }, 'Not in your library'),
      result
        ? h(
            'div',
            { className: 'text-muted small' },
            `${result.missing} of the ${result.looked_at} most popular of their ${result.total} StashDB scenes` +
              (result.scored ? ', ranked by Restash' : ' (run Recompute All to rank them)') +
              (result.hidden ? ` · ${result.hidden} hidden by tag` : ''),
          )
        : null,
    )
    if (note) return h('div', { className: 'restash-missing' }, header, h('div', { className: 'text-muted restash-missing-note' }, note))
    const more = result.missing > scenes.length
    return h(
      'div',
      { className: 'restash-missing' },
      header,
      h(
        'div',
        { className: 'restash-missing-grid' },
        scenes.map((sc) => h(MissingCard, { key: sc.id, scene: sc, site: result.site || 'https://stashdb.org' })),
      ),
      more || entry.loading
        ? h(
            'div',
            { className: 'restash-missing-more' },
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn-secondary',
                disabled: entry.loading,
                onClick: () => loadMissing(performer.id, entry.limit + PAGE),
              },
              entry.loading ? 'Loading…' : 'Show more',
            ),
          )
        : null,
    )
  }

  // ---------- into Stash's performer page ----------

  // Stash calls an after patch with the props and then the result; other
  // plugins' patches can leave the result elsewhere among the arguments.
  const renders = (x) =>
    typeof x === 'string' || typeof x === 'number' || Array.isArray(x) || (x && x.$$typeof != null)
  patch.after('PerformerScenesPanel', function (props, ...rest) {
    const items = rest.filter(renders)
    const result = items.length > 1 ? h(React.Fragment, null, ...items) : items[0] || null
    if (!props || !props.performer) return result
    return h(
      React.Fragment,
      null,
      result,
      h(Safe, null, h(NotInYourLibrary, { performer: props.performer })),
    )
  })
})()
