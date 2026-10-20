// StashDB in Stash's pages: the Connect StashDB dialog, the StashDB section
// of the plugin page, and "Not in your library" after a performer's scenes.
// The lookups themselves are in stashdb/layer.js.
import {
  Bootstrap,
  FontAwesomeSolid,
  components,
  patchAfter,
  React,
  ReactRouterDOM,
} from '../runtime/api.js'
import { theirScenesYouDontHave } from '../model/recs.js'
import { PLUGIN_NAME } from '../name.js'
import {
  allowLookups,
  saveKey,
  stopLookups,
  validateKey,
} from '../stashdb/connect.js'
import {
  cacheStats,
  clearStashdbCache,
  lookupState,
  performerKey,
  stashdbReady,
  usePerformerLookups,
} from '../stashdb/layer.js'
import { STASHDB_ENDPOINT, stashdbIdOf } from '../stashdb/queries.js'
import { ConnectLine } from '../ui/ConnectLine.jsx'
import { closeDialog, openDialog, registerDialog } from '../ui/dialogs.jsx'
import { useAppState } from '../ui/hooks.js'
import { Safe } from '../ui/Safe.jsx'
import { StashdbSceneCard } from '../ui/StashdbSceneCard.jsx'
import { registerPageSection, SettingRow } from './pluginPage.jsx'

const { Button, Modal } = Bootstrap
const { Link } = ReactRouterDOM
const { faCheck, faExternalLinkAlt } = FontAwesomeSolid

const GUIDELINES =
  'https://guidelines.stashdb.org/docs/faq_getting-started/stashdb/accessing-stashdb/'
const REGISTER = 'https://stashdb.org/register'
const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' }

function Icon({ icon, className }) {
  const { Icon: StashIcon } = components
  return StashIcon ? <StashIcon icon={icon} className={className} /> : null
}

// ------------------------------------------------------------ the dialog

const STEPS = ['Get a key', 'Paste it', 'Done']

function Steps({ step }) {
  return (
    <ol className="cherrypick-steps">
      {STEPS.map((t, i) => (
        <li
          key={t}
          className={
            step === i + 1
              ? 'active border-primary'
              : step > i + 1
                ? 'done'
                : ''
          }
        >
          {t}
        </li>
      ))}
    </ol>
  )
}

// Three steps, as v1's connect flow: what connecting adds and where to get a
// key (StashDB's guidelines page publishes the invite key registration
// needs; StashDB emails an activation key and issues API keys to logged-in
// users only, so this part stays in the user's hands), the pasted key,
// validated by Stash and added to its stash-boxes, then done. It opens only
// when Stash has no StashDB key: with one, lookups are already on.
function ConnectDialog() {
  const [step, setStep] = React.useState(1)
  const [key, setKey] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState(null)

  const attempt = async (fn) => {
    setBusy(true)
    setProblem(null)
    try {
      await fn()
    } catch (e) {
      setProblem(`Stash could not check the key: ${e?.message || e}`)
    }
    setBusy(false)
  }

  const validate = () =>
    attempt(async () => {
      const r = await validateKey(key, STASHDB_ENDPOINT)
      if (!r.valid) {
        setProblem(r.status)
        return
      }
      await saveKey(key)
      setStep(3)
    })

  let body, footer
  if (step === 1) {
    body = (
      <>
        <p>
          StashDB is the community database behind Stash&apos;s scene matching.
          With a free account, {PLUGIN_NAME} can show how widely a scene is held
          and find the ones you don&apos;t have.
        </p>
        <p className="text-muted small">
          Registration needs an invite key, which StashDB&apos;s guidelines page
          publishes.
        </p>
        <div className="cherrypick-connect-buttons">
          <a className="btn btn-secondary" href={GUIDELINES} {...EXTERNAL}>
            StashDB guidelines (invite key) <Icon icon={faExternalLinkAlt} />
          </a>
          <a className="btn btn-secondary" href={REGISTER} {...EXTERNAL}>
            Register on StashDB <Icon icon={faExternalLinkAlt} />
          </a>
        </div>
      </>
    )
    footer = (
      <>
        <Button variant="secondary" onClick={closeDialog}>
          Later
        </Button>
        <Button variant="primary" onClick={() => setStep(2)}>
          I have a key
        </Button>
      </>
    )
  } else if (step === 2) {
    body = (
      <>
        <p>
          On StashDB, open your profile and copy your API key. Paste it here.
        </p>
        <input
          className="form-control text-monospace cherrypick-key-input"
          placeholder="eyJhbGciOi…"
          aria-label="StashDB API key"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && key.trim() && !busy) validate()
          }}
        />
        {problem ? (
          <p className="text-danger mt-2 cherrypick-key-problem">{problem}</p>
        ) : null}
        <p className="small text-muted mt-2">
          The key goes into Stash&apos;s own settings, like any stash-box.
        </p>
      </>
    )
    footer = (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            setProblem(null)
            setStep(1)
          }}
        >
          Back
        </Button>
        <Button
          variant="primary"
          disabled={!key.trim() || busy}
          onClick={validate}
        >
          {busy ? 'Validating…' : 'Validate'}
        </Button>
      </>
    )
  } else {
    body = (
      <div className="cherrypick-connected">
        <Icon icon={faCheck} className="text-success" />
        <div>
          <b>Added StashDB to your Stash settings.</b>
          <div className="small text-muted">
            You&apos;ll find it in Settings › Metadata Providers. Stash&apos;s
            Tagger can use it too.
          </div>
        </div>
      </div>
    )
    footer = (
      <Button variant="primary" onClick={closeDialog}>
        Done
      </Button>
    )
  }

  return (
    <Modal
      show
      onHide={closeDialog}
      className="cherrypick-ui cherrypick-connect"
    >
      <Modal.Header closeButton>
        <Modal.Title>Connect StashDB</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Steps step={step} />
        {body}
      </Modal.Body>
      <Modal.Footer>{footer}</Modal.Footer>
    </Modal>
  )
}

// ------------------------------------------------------------ plugin page

function age(ms) {
  const days = Math.floor((Date.now() - ms) / 86400000)
  return days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

function StashdbSection() {
  const stashdb = useAppState((s) => s.stashdb)
  const off = useAppState((s) => s.consent?.stashdbOff)
  const lookups = useAppState((s) => s.stashdbLookups)
  const [stats, setStats] = React.useState(null)
  const [clearing, setClearing] = React.useState(false)
  React.useEffect(() => {
    let live = true
    cacheStats().then((x) => live && setStats(x))
    return () => {
      live = false
    }
  }, [lookups])
  const ready = !!(stashdb?.apiKey && !off)
  const count = stats?.count || 0
  let status
  if (ready)
    status = (
      <SettingRow
        title="Connected"
        sub={`Using the StashDB key in Settings › Metadata Providers, for popularity and the scenes you don't have. ${PLUGIN_NAME} sends StashDB the ids of the performers and scenes on the pages you open, with that key.`}
      >
        <Link
          className="btn btn-secondary btn-sm"
          to="/settings?tab=metadata-providers"
        >
          Manage
        </Link>{' '}
        <Button
          variant="secondary"
          size="sm"
          className="cherrypick-stashdb-off"
          onClick={stopLookups}
        >
          Stop using StashDB
        </Button>
      </SettingRow>
    )
  else if (stashdb?.apiKey)
    status = (
      <SettingRow
        title="Off"
        sub={`Stash has a StashDB key, and ${PLUGIN_NAME} leaves it alone until you turn StashDB back on.`}
      >
        <Button
          variant="primary"
          size="sm"
          className="cherrypick-stashdb-on"
          onClick={() => allowLookups()}
        >
          Use StashDB
        </Button>
      </SettingRow>
    )
  else
    status = (
      <SettingRow
        title="Not connected"
        sub="Your score and brackets work without it. A free StashDB account adds popularity and the scenes you're missing."
      >
        <Button
          variant="primary"
          size="sm"
          onClick={() => openDialog({ view: 'connect' })}
        >
          Connect StashDB
        </Button>
      </SettingRow>
    )
  return (
    <div className="card setting-card">
      {status}
      {ready || count ? (
        <SettingRow
          title="Cache"
          sub={`${
            count
              ? `${count} lookup${count === 1 ? '' : 's'}, the oldest from ${age(stats.oldest)}.`
              : 'Nothing looked up yet.'
          } Lookups are kept in this browser for 30 days, and asked for again in the background after 7.`}
        >
          <Button
            variant="secondary"
            size="sm"
            className="cherrypick-clear-stashdb"
            disabled={!count || clearing}
            onClick={async () => {
              setClearing(true)
              await clearStashdbCache()
              setStats(await cacheStats())
              setClearing(false)
            }}
          >
            {clearing ? 'Clearing…' : 'Clear StashDB cache'}
          </Button>
        </SettingRow>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------ performer page

// Stash's SceneCardGrid: preferred card widths per zoom level, and how it
// fits cards to the row (GridCard's calculateCardWidth).
const ZOOM_WIDTHS = [280, 340, 480, 640]
const isPhone = () =>
  window.matchMedia('only screen and (max-width: 576px)').matches
function cardWidth(container, zoom) {
  if (isPhone()) return undefined
  const preferred = ZOOM_WIDTHS[zoom] ?? ZOOM_WIDTHS[1]
  if (!container) return preferred
  const usable = container - 30
  return usable / Math.ceil(usable / preferred) - 10
}

// The grid's width, and the zoom of the performer's scene grid above it.
function useGrid() {
  const [el, setEl] = React.useState(null)
  const [size, setSize] = React.useState({ width: 0, zoom: 1 })
  React.useEffect(() => {
    if (!el) return
    const measure = () => {
      const card = el
        .closest('.tab-pane, .tab-content')
        ?.querySelector('.scene-card:not(.cherrypick-missing)')
      const zoom = Number(/\bzoom-(\d)\b/.exec(card?.className || '')?.[1] ?? 1)
      const width = el.getBoundingClientRect().width
      setSize((s) =>
        Math.abs(s.width - width) > 20 || s.zoom !== zoom ? { width, zoom } : s,
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}

const SHOWN = 12

// After the performer's scenes, in the same grid: their scenes on StashDB
// that the user does not own, most popular first. Only for performers
// linked to StashDB; without a key, the connect line.
// theirScenesYouDontHave, worked out again only when what it reads changes
function useTheirScenes(s, rec, enabled) {
  const { M } = s
  return React.useMemo(
    () => (enabled && rec ? theirScenesYouDontHave(M, s, rec).slice(0, SHOWN) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, M, rec, s.settings.excludedTags, s.notInterested],
  )
}

function NotInYourLibrary({ performer }) {
  const stashId = stashdbIdOf(performer.stash_ids)
  const on = useAppState((s) => s.settings.outOfLibrary)
  usePerformerLookups(stashId, on)
  const s = useAppState((x) => x)
  const [gridRef, grid] = useGrid()
  const ready = stashdbReady(s)
  const state =
    stashId && ready ? lookupState(s, performerKey(stashId)) : 'idle'
  const rec = s.M ? s.db.performers.get(performer.id) : null
  const loading = state === 'idle' || state === 'loading' || !s.M
  const items = useTheirScenes(
    s,
    rec,
    !!stashId && on && ready && !loading && state !== 'failed',
  )
  if (!stashId || !on || s.watching) return null
  if (state === 'failed') return null
  if (s.M && !rec) return null
  if (ready && !loading && !items.length) return null
  const rowId = 'missing-' + performer.id
  const width = cardWidth(grid.width, grid.zoom)
  return (
    <div className="cherrypick-not-in-library cherrypick-ui">
      <h5 className="cherrypick-section-title">Not in your library</h5>
      {!ready ? (
        <ConnectLine />
      ) : loading ? (
        <div className="cherrypick-row-empty text-muted">
          Looking {performer.name} up on StashDB…
        </div>
      ) : (
        <div className="row justify-content-center" ref={gridRef}>
          {items.map((it) => (
            <StashdbSceneCard
              key={it.scene.id}
              scene={it.scene}
              item={it}
              rowId={rowId}
              width={width}
              zoom={grid.zoom}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ registration

export function registerStashdb() {
  registerDialog('connect', ConnectDialog)
  registerPageSection('stashdb', 30, 'StashDB', StashdbSection)
  patchAfter('PerformerScenesPanel', (props, result) => (
    <>
      {result}
      <Safe name="Not in your library">
        <NotInYourLibrary performer={props.performer} />
      </Safe>
    </>
  ))
}
