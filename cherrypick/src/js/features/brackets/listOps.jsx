// Bracket and Options beside the list toolbars, and the resume pill under
// them. Stash has no supported slot for either (docs/stash-seams.md), so a
// component added after FilteredPerformerList / FilteredSceneList renders
// them through portals: the pair as the first group inside the toolbar's
// .list-operations, next to Stash's own ⋯ menu, and the pill right under
// the toolbar. That component lives as long as the list does, so the
// buttons stay put while the list reloads. The list's filter comes from
// PerformerList / SceneList, whose props carry it.
//
// Where: the Performers page gets the performer pair; the Scenes page and
// the scenes of a tag, studio or group get the scene pair; a performer's
// Scenes tab gets "Bracket her scenes". No toolbar, no buttons.
import {
  patch,
  patchAfter,
  React,
  ReactDOM,
  ReactRouterDOM,
} from '../../runtime/api.js'
import { createStore, useStoreValue } from '../../runtime/store.js'
import { run, store } from '../../runtime/app.js'
import * as BR from '../../model/brackets.js'
import { scenePool } from '../../model/bracketSetup.js'
import { pronoun } from '../../model/util.js'
import { describeFilter, listPlace } from '../../data/listFilter.js'
import { useAppState } from '../../ui/hooks.js'
import { Safe } from '../../ui/Safe.jsx'
import {
  openClipSetup,
  openPerformerSetup,
  quickStartClip,
  quickStartPerformers,
} from './actions.js'
import { BracketIcon, ResumePill } from './parts.jsx'

// ------------------------------------------------------------ the list's filter

// The filter each kind of list last rendered with, numbered. Lists report
// during their render, so the store changes a moment later, outside it. A
// list's buttons take only filters reported after their list first
// rendered, never the previous page's.
const lists = createStore({ scene: null, performer: null })
const latest = { scene: null, performer: null }
let seq = 0
function report(kind, filter) {
  if (!filter || latest[kind]?.filter === filter) return
  latest[kind] = { filter, seq: ++seq }
  Promise.resolve().then(() => {
    if (lists.get()[kind] !== latest[kind]) lists.set({ [kind]: latest[kind] })
  })
}

function describe(filter, known) {
  try {
    return describeFilter(filter, known)
  } catch (e) {
    console.error('CherryPick: could not read the list filter', e)
    return null
  }
}

// ------------------------------------------------------------ what a filter may hold

// The input fields of Stash's filter types, read once per page load. Another
// plugin's criterion (Stash Curator's) puts a key of its own in the list's
// filter, and Stash rejects a whole query that carries it, so the ids query
// sends only these (describeFilter). null when Stash does not say: every
// key is sent, and a failure shows on the button.
const FILTER_FIELDS = `
  query CherryPickFilterFields($name: String!) {
    __type(name: $name) {
      inputFields { name }
    }
  }
`
const FILTER_TYPES = {
  scene: 'SceneFilterType',
  performer: 'PerformerFilterType',
}
const filterFields = {}
function knownFields(kind) {
  filterFields[kind] ??= run(FILTER_FIELDS, { name: FILTER_TYPES[kind] }).then(
    (d) => {
      const fields = d.__type?.inputFields
      return fields ? new Set(fields.map((f) => f.name)) : null
    },
    (e) => {
      console.error("CherryPick: could not read Stash's filter fields", e)
      return null
    },
  )
  return filterFields[kind]
}

// The fields above: undefined while they load
function useKnownFields(kind) {
  const [known, setKnown] = React.useState(undefined)
  React.useEffect(() => {
    let live = true
    knownFields(kind).then((k) => live && setKnown(k))
    return () => {
      live = false
    }
  }, [kind])
  return known
}

// ------------------------------------------------------------ what a filter matches

const PERFORMER_IDS = `
  query CherryPickListPerformers($filter: FindFilterType, $performer_filter: PerformerFilterType) {
    findPerformers(filter: $filter, performer_filter: $performer_filter) {
      performers { id }
    }
  }
`
const SCENE_IDS = `
  query CherryPickListScenes($filter: FindFilterType, $scene_filter: SceneFilterType) {
    findScenes(filter: $filter, scene_filter: $scene_filter) {
      scenes { id }
    }
  }
`
const FRESH_MS = 30 * 1000
const matches = new Map()

// The ids a list's filter matches, every page of it: a Set. Kept for a
// little while per filter, so a click right after the list loads is instant.
export function matchIds(kind, desc) {
  const key = kind + '|' + desc.key
  const hit = matches.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.ids
  if (matches.size > 20) matches.delete(matches.keys().next().value)
  const filter = { q: desc.q || undefined, per_page: -1 }
  const ids =
    kind === 'performer'
      ? run(PERFORMER_IDS, { filter, performer_filter: desc.criteria }).then(
          (d) => new Set(d.findPerformers.performers.map((p) => p.id)),
        )
      : run(SCENE_IDS, { filter, scene_filter: desc.criteria }).then(
          (d) => new Set(d.findScenes.scenes.map((s) => s.id)),
        )
  ids.catch(() => matches.delete(key))
  matches.set(key, { at: Date.now(), ids })
  return ids
}

function reportError(e) {
  console.error('CherryPick:', e)
  store.set({ error: String(e?.message || e) })
}

// What Stash said about a failed query, with where: "unknown field
// (scene_filter.curator_appeal)". Stash answers a query it rejects outright
// with a 400, whose body holds the reason.
function errorText(e) {
  const err = e?.networkError?.result?.errors?.[0] || e?.graphQLErrors?.[0]
  if (!err?.message) return String(e?.message || e)
  const where = (err.path || []).filter((p) => p !== 'variable').join('.')
  return where ? `${err.message} (${where})` : err.message
}

const failedTitle = (text) => `Can't bracket this list: ${text}`

// The buttons wait for the model, several seconds on a large library's
// first visit; the title says why they are greyed out.
const NOT_READY = 'Cherry Pick is still reading your library'

// A button's title, and the criteria the bracket leaves out
const withNotes = (title, desc) =>
  title && desc?.notApplied?.length
    ? [title, ...desc.notApplied].join(' · ')
    : title

// ------------------------------------------------------------ the pairs

// pending: the list reported its filter, but not yet what Stash can take
function PerformerOps({ desc, pending }) {
  const ready = useAppState((s) => !!s.M)
  const active = useAppState((s) => !!s.brackets.active)
  const key = desc?.key
  // The ids query's error for a filter: { key, text }
  const [failed, setFailed] = React.useState(null)
  React.useEffect(() => {
    if (!desc?.active) return
    let live = true
    matchIds('performer', desc).catch(
      (e) => live && setFailed({ key, text: errorText(e) }),
    )
    return () => {
      live = false
    }
    // desc is compared by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const error = failed && failed.key === key ? failed.text : null
  const withIds = async () =>
    desc?.active ? { ...desc, ids: await matchIds('performer', desc) } : desc
  const go = (fn) => () =>
    withIds()
      .then(fn)
      .catch((e) => {
        reportError(e)
        setFailed({ key, text: errorText(e) })
      })
  const off = !ready || pending || !!error
  return (
    // A disabled button shows no tooltip in some browsers, so the group
    // carries the not-ready title too.
    <div
      className="btn-group cherrypick-bracket-ops"
      title={ready ? undefined : NOT_READY}
    >
      {active ? null : (
        <button
          type="button"
          className="btn btn-secondary cherrypick-bracket-button"
          disabled={off}
          title={
            !ready
              ? NOT_READY
              : error
                ? failedTitle(error)
                : withNotes(
                    desc?.active
                      ? 'Bracket the performers in this list'
                      : 'Bracket your performers',
                    desc,
                  )
          }
          onClick={go(quickStartPerformers)}
        >
          <BracketIcon />
          <span>Bracket</span>
        </button>
      )}
      <button
        type="button"
        className="btn btn-link cherrypick-options-link"
        disabled={off}
        title={!ready ? NOT_READY : error ? failedTitle(error) : undefined}
        onClick={go(openPerformerSetup)}
      >
        Options
      </button>
    </div>
  )
}

// The scenes a scene list's filter matches: all of them when the list is
// unfiltered, a performer's own (known locally) on her Scenes tab, else
// what Stash returns for the filter. { ids, error }: ids null while unknown,
// error what Stash said when its query failed.
function useListScenes(where, desc, M) {
  const [fetched, setFetched] = React.useState(null)
  const local =
    where.place === 'performer-scenes' && desc && desc.count <= 1 && !desc.q
  const remote = !!desc?.active && !local
  const key = desc?.key
  React.useEffect(() => {
    setFetched(null)
    if (!remote) return
    let live = true
    matchIds('scene', desc).then(
      (ids) => live && setFetched({ key, ids }),
      (e) => {
        if (!live) return
        reportError(e)
        setFetched({ key, error: errorText(e) })
      },
    )
    return () => {
      live = false
    }
    // desc is compared by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, remote])
  const none = { ids: null, error: null }
  if (!desc || !M) return none
  if (!desc.active) return { ids: scenePool(M, null), error: null }
  if (local) {
    const p = M.db.performers.get(where.performerId)
    return {
      ids: scenePool(M, new Set(p?.ownedSceneIds || [])),
      error: null,
    }
  }
  if (!fetched || fetched.key !== key) return none
  return fetched.error
    ? { ids: null, error: fetched.error }
    : { ids: scenePool(M, fetched.ids), error: null }
}

const cap = (s) => s[0].toUpperCase() + s.slice(1)

function SceneOps({ where, desc, pathname }) {
  const M = useAppState((s) => s.M)
  const active = useAppState((s) => !!s.brackets.active)
  const { ids, error } = useListScenes(where, desc, M)
  const n = ids ? ids.length : null
  const ok = n != null && n >= BR.MIN_CLIP_POOL
  // what one click plays: the unrated ones, when 4 of them can play
  const plays = ids && M ? BR.clipEntrants(M, ids).length : n
  const unrated = plays != null && plays < n ? ' unrated' : ''
  let pool
  let label
  let title
  if (where.place === 'performer-scenes') {
    const p = M?.db.performers.get(where.performerId)
    // A performer with no scene a bracket can draw from shows no button
    if (!p || (!n && !error)) return null
    const her = pronoun(p)
    pool = {
      ids: ids || [],
      poolLabel: [`${p.name}'s scenes`, ...(desc?.notApplied || [])].join(
        ' · ',
      ),
      poolNote: `${cap(her)} scenes in your library`,
      short: '',
      origin: pathname,
    }
    label = `Bracket ${her} scenes`
    title = error
      ? failedTitle(error)
      : ok
        ? `A bracket of ${BR.clipPoolPhrase(plays)}${unrated} scenes of ${her}${BR.clipPoolSpread(plays)}`
        : `Needs ${BR.MIN_CLIP_POOL} scenes; your library has ${n} of ${her}`
  } else {
    pool = {
      ids: ids || [],
      poolLabel: desc?.active ? desc.fullLabel || 'This list' : 'All scenes',
      poolNote: 'The scenes in this list',
      short: "Widen this list's filter to take in more of them.",
      origin: pathname,
    }
    label = 'Bracket'
    title = error
      ? failedTitle(error)
      : !M
        ? NOT_READY
        : n == null
          ? undefined
          : ok
            ? `Bracket ${BR.clipPoolPhrase(plays)}${unrated} scenes in this list${BR.clipPoolSpread(plays)}`
            : `Needs ${BR.MIN_CLIP_POOL} scenes in this list`
  }
  const herTab = where.place === 'performer-scenes'
  return (
    <div
      className="btn-group cherrypick-bracket-ops"
      title={M ? undefined : NOT_READY}
    >
      {active && !herTab ? null : (
        <button
          type="button"
          className="btn btn-secondary cherrypick-bracket-button"
          disabled={n == null || (herTab && active)}
          title={error ? title : withNotes(title, desc)}
          onClick={() => quickStartClip(pool)}
        >
          <BracketIcon />
          <span>{label}</span>
        </button>
      )}
      <button
        type="button"
        className="btn btn-link cherrypick-options-link"
        disabled={n == null}
        title={!M ? NOT_READY : error ? failedTitle(error) : undefined}
        onClick={() => openClipSetup(pool)}
      >
        Options
      </button>
    </div>
  )
}

// ------------------------------------------------------------ the portals

const findRoot = (anchor) => {
  const prev = anchor?.previousElementSibling
  if (prev?.classList.contains('item-list-container')) return prev
  return anchor?.parentElement?.querySelector('.item-list-container') || null
}

// Two elements of Cherry Pick's own inside Stash's list: the pair's slot,
// first in the toolbar's .list-operations, and the pill's, right under the
// toolbar. Put back if Stash re-renders them away.
function useToolbarSlots(anchor, enabled) {
  const [slots, setSlots] = React.useState(null)
  React.useLayoutEffect(() => {
    const host = anchor.current?.parentElement
    if (!enabled || !host) return
    const ops = document.createElement('div')
    ops.className = 'cherrypick-bracket-slot cherrypick-ui'
    const pill = document.createElement('div')
    pill.className = 'cherrypick-pill-slot cherrypick-ui'
    const place = () => {
      const toolbar = findRoot(anchor.current)?.querySelector(
        '.filtered-list-toolbar',
      )
      const target = toolbar?.querySelector(':scope > .list-operations')
      if (!target) return
      if (target.firstChild !== ops) target.insertBefore(ops, target.firstChild)
      if (toolbar.nextElementSibling !== pill) toolbar.after(pill)
    }
    const inPlace = () =>
      ops.isConnected &&
      ops.parentElement.firstChild === ops &&
      pill.previousElementSibling?.classList.contains('filtered-list-toolbar')
    // Watch only what can move the slots: the host's and the list root's
    // own children (a list or toolbar re-rendered whole) and the toolbar's
    // subtree. Not the list's cards: their previews and images change all
    // the time, and the whole subtree would call this on every change.
    let root = null
    let toolbar = null
    const watch = new MutationObserver(() => {
      if (!inPlace()) place()
      observe()
    })
    const observe = () => {
      const r = findRoot(anchor.current)
      const t = r?.querySelector('.filtered-list-toolbar') || null
      if (r === root && t === toolbar) return
      root = r
      toolbar = t
      watch.disconnect()
      watch.observe(host, { childList: true })
      if (root) watch.observe(root, { childList: true })
      // the toolbar's own parent: the toolbar replaced, or the pill beside
      // it removed
      if (toolbar?.parentElement)
        watch.observe(toolbar.parentElement, { childList: true })
      if (toolbar) watch.observe(toolbar, { childList: true, subtree: true })
    }
    place()
    observe()
    setSlots({ ops, pill })
    return () => {
      watch.disconnect()
      ops.remove()
      pill.remove()
    }
  }, [anchor, enabled])
  return enabled ? slots : null
}

function ListBracket({ kind, since: listStart }) {
  const { pathname } = ReactRouterDOM.useLocation()
  const where = listPlace(kind, pathname)
  const [since] = React.useState(listStart)
  const entry = useStoreValue(lists, (s) => s[kind])
  const filter = entry && entry.seq > since ? entry.filter : null
  const known = useKnownFields(kind)
  const pending = !!filter && known === undefined
  const desc = React.useMemo(
    () => (filter && known !== undefined ? describe(filter, known) : null),
    [filter, known],
  )
  const anchor = React.useRef(null)
  const slots = useToolbarSlots(anchor, !!where)
  if (!where) return null
  return (
    <>
      <span ref={anchor} hidden />
      {slots
        ? ReactDOM.createPortal(
            <Safe name="bracket buttons">
              {kind === 'performer' ? (
                <PerformerOps desc={desc} pending={pending} />
              ) : (
                <SceneOps where={where} desc={desc} pathname={pathname} />
              )}
            </Safe>,
            slots.ops,
          )
        : null}
      {slots && where.place !== 'performer-scenes'
        ? ReactDOM.createPortal(
            <Safe name="resume pill">
              <ResumePill />
            </Safe>,
            slots.pill,
          )
        : null}
    </>
  )
}

export function registerListOps() {
  patch.before('PerformerList', (...args) => {
    report('performer', args[0]?.filter)
    return args
  })
  patch.before('SceneList', (...args) => {
    report('scene', args[0]?.filter)
    return args
  })
  patchAfter('FilteredPerformerList', (props, result) => (
    <>
      {result}
      <Safe name="performer bracket buttons">
        <ListBracket kind="performer" since={seq} />
      </Safe>
    </>
  ))
  patchAfter('FilteredSceneList', (props, result) => (
    <>
      {result}
      <Safe name="scene bracket buttons">
        <ListBracket kind="scene" since={seq} />
      </Safe>
    </>
  ))
}
