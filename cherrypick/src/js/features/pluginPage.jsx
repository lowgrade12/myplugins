// The plugin's one page, at /plugins/cherrypick, reached from the navbar's
// cherries and from Settings › Plugins. A plain Stash settings page: setting
// sections and cards. Features add their own sections (registerPageSection);
// this file holds Your score (with the offer beside Stash Curator), Not
// interested, Don't learn and Remove.
import { Bootstrap, React, ReactRouterDOM, register } from '../runtime/api.js'
import {
  answerCuratorOffer,
  toggleDontLearn,
  undoNotInterested,
} from '../runtime/actions.js'
import { allDecisions } from '../runtime/engine.js'
import { rateMore } from '../model/index.js'
import { sourcesText } from '../model/matches.js'
import { andList } from '../model/util.js'
import { MIN_RATED } from '../model/taste.js'
import { toRateUrl } from '../data/listFilter.js'
import { NAME_S, PLUGIN_NAME, PLUGIN_ROUTE } from '../name.js'
import { Cherries } from '../ui/Cherries.jsx'
import { closeDialog, openDialog, registerDialog } from '../ui/dialogs.jsx'
import { useAppState } from '../ui/hooks.js'
import { Safe } from '../ui/Safe.jsx'
import { removePluginData, removalCounts } from './remove.js'
import { OFFER, useCuratorOffer } from './curatorOffer.js'

const { Button, Modal } = Bootstrap
const { Link } = ReactRouterDOM

const shortDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

// ------------------------------------------------------------ sections

const sections = []

// order: where the section sits (Your score 10, Hall of Fame 20, StashDB 30,
// Not interested 40, Don't learn 50, Remove 90).
export function registerPageSection(id, order, title, Component) {
  sections.push({ id, order, title, Component })
  sections.sort((a, b) => a.order - b.order)
}

export function Section({ id, title, children }) {
  return (
    <div className="setting-section cherrypick-section" id={id}>
      <h1>{title}</h1>
      {children}
    </div>
  )
}

// One row of a settings card: a heading, a line under it, and an action.
export function SettingRow({ title, sub, children }) {
  return (
    <div className="setting">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="sub-heading">{sub}</div> : null}
      </div>
      {/* Stash's .setting lays out two columns; keep the second even when empty. */}
      <div>{children}</div>
    </div>
  )
}

// Beside Stash Curator, the offer to hide Your score on cards
// (curatorOffer.js). After Hide on cards, the card says where to undo it
// for the rest of the visit.
function CuratorOffer() {
  const badges = useAppState((s) => s.settings.badges)
  const answer = useAppState((s) => s.curatorOffer)
  const show = useCuratorOffer(badges)
  const [hid, setHid] = React.useState(false)
  if (hid && answer === 'hide')
    return (
      <div className="card setting-card cherrypick-curator-offer">
        <SettingRow
          title="Your score is off on cards"
          sub="It stays beside the stars on scene pages. Score badges on cards, in Settings › Plugins, brings it back."
        />
      </div>
    )
  if (!show) return null
  return (
    <div className="card setting-card cherrypick-curator-offer">
      <SettingRow title={OFFER.title} sub={OFFER.sub}>
        <Button
          variant="secondary"
          size="sm"
          className="cherrypick-curator-hide"
          onClick={() => {
            setHid(true)
            answerCuratorOffer('hide')
          }}
        >
          {OFFER.hide}
        </Button>{' '}
        <Button
          variant="secondary"
          size="sm"
          className="cherrypick-curator-keep"
          onClick={() => answerCuratorOffer('keep')}
        >
          {OFFER.keep}
        </Button>
      </SettingRow>
    </div>
  )
}

function YourScore() {
  const M = useAppState((s) => s.M)
  const library = useAppState((s) => s.library)
  const brackets = useAppState((s) => s.brackets)
  const cv = M?.cv
  // "412 matches in Ascension and Xenith", when the switch is on and found any
  const matches = M?.matches.count
    ? `${M.matches.count} match${M.matches.count === 1 ? '' : 'es'} in ${sourcesText(M.matches.sources)}`
    : null
  let body
  if (!M)
    body = (
      <SettingRow
        title="Learning your taste…"
        sub={
          library
            ? `${PLUGIN_NAME} is building its model from your Stash ratings and plays.`
            : `${PLUGIN_NAME} is reading your library from Stash.`
        }
      />
    )
  else if (!cv)
    body = (
      <SettingRow
        title={`${rateMore(M)} to start`}
        sub={`Your score needs ${MIN_RATED} rated scenes to check its guesses against. Until then, For you goes by your favorites, performer ratings, brackets and plays.${matches ? ` It also learns from ${matches}.` : ''}`}
      >
        <Link
          className="btn btn-secondary btn-sm cherrypick-rate-link"
          to={toRateUrl()}
        >
          Scenes to rate
        </Link>
      </SettingRow>
    )
  else {
    const decisions = allDecisions({ brackets }).length
    const from = [
      `${M.fits.rated.length} rated scenes`,
      `${M.fits.watchedUnrated.length} watched but unrated`,
      'your performer ratings',
    ]
    if (decisions) from.push(`${decisions} bracket picks`)
    if (matches) from.push(matches)
    body = (
      <>
        <SettingRow
          title={`${M.gate ? 'On' : 'Waiting'}: within half a star ${Math.round(cv.withinModel * 10)} times in 10`}
          sub={`On ${cv.n} ratings it hadn't seen, Your score missed by ${cv.maeModel.toFixed(2)}★ on average; your average alone missed by ${cv.maeBase.toFixed(2)}★ (${Math.round(cv.withinBase * 10)} in 10 within half a star). ${M.gate ? 'It beats your average, so it shows on cards.' : 'It stays hidden until it beats your average.'}`}
        />
        <SettingRow
          title="Learning from"
          sub={`${andList(from)}. Display only: it never writes your Stash ratings.`}
        />
      </>
    )
  }
  return (
    <>
      <CuratorOffer />
      <div className="card setting-card">{body}</div>
    </>
  )
}

function NotInterested() {
  const list = useAppState((s) => s.notInterested)
  return (
    <div className="card setting-card">
      {list.length ? (
        list
          .slice()
          .reverse()
          .map((n) => (
            <SettingRow
              key={n.sceneId}
              title={
                <>
                  {n.title}
                  {n.owned ? null : (
                    <>
                      {' '}
                      <span className="badge badge-secondary">
                        Not in your library
                      </span>
                    </>
                  )}
                </>
              }
              sub={`${n.label ? `Shows less of ${n.label}` : 'Hidden'} · ${shortDate(n.at)}`}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => undoNotInterested(n.sceneId)}
              >
                Undo
              </Button>
            </SettingRow>
          ))
      ) : (
        <SettingRow
          title="Nothing hidden"
          sub={`Not interested, in the menu on a ${PLUGIN_NAME} pick, hides it and shows less of what made it appear.`}
        />
      )}
    </div>
  )
}

function DontLearnList() {
  const list = useAppState((s) => s.dontLearn)
  return (
    <div className="card setting-card">
      {list.length ? (
        list
          .slice()
          .reverse()
          .map((n) => (
            <SettingRow
              key={n.sceneId}
              title={n.title}
              sub={`Its plays, rating and picks stay out of your picks · ${shortDate(n.at)}`}
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  toggleDontLearn({ id: n.sceneId, title: n.title })
                }
              >
                Learn from it again
              </Button>
            </SettingRow>
          ))
      ) : (
        <SettingRow
          title="Learning from everything you watch"
          sub={`"Don't learn from this", beside a scene's stars or in a pick's menu, keeps a scene out of what ${PLUGIN_NAME} learns.`}
        />
      )}
    </div>
  )
}

function Remove() {
  return (
    <div className="card setting-card cherrypick-remove-card">
      <SettingRow
        title="Start over"
        sub={`Removes ${NAME_S} settings and history from Stash's configuration, its custom fields from your performers, and its cache in this browser.`}
      >
        <Button
          variant="danger"
          size="sm"
          onClick={() => openDialog({ view: 'remove' })}
        >
          Remove {PLUGIN_NAME} data…
        </Button>
      </SettingRow>
    </div>
  )
}

function RemoveDialog() {
  const [counts, setCounts] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    removalCounts().then(setCounts, () => setCounts({}))
  }, [])
  const applied = useAppState((s) => s.applied.length)
  return (
    <Modal show onHide={closeDialog} className="cherrypick-ui">
      <Modal.Header closeButton>
        <Modal.Title>Remove {PLUGIN_NAME} data?</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {counts ? (
          <ul>
            <li>
              Settings, the Hall of Fame ({counts.brackets ?? 0} brackets), Not
              interested and Don&apos;t learn, from Stash&apos;s configuration
            </li>
            <li>
              Bracket results and provisional marks from{' '}
              {counts.performers ?? 0} performer
              {counts.performers === 1 ? '' : 's'} and {counts.scenes ?? 0}{' '}
              scene{counts.scenes === 1 ? '' : 's'} (custom fields)
            </li>
            <li>
              The library copy, the StashDB cache and row history in this
              browser
            </li>
          </ul>
        ) : (
          <p className="text-muted">Counting…</p>
        )}
        {applied ? (
          <p className="text-warning">
            Ratings {PLUGIN_NAME} applied stay. Undo them on this page first if
            you want them gone.
          </p>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={closeDialog}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={busy || !counts}
          onClick={async () => {
            setBusy(true)
            await removePluginData()
            closeDialog()
          }}
        >
          {busy ? 'Removing…' : 'Remove'}
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function PluginPage() {
  const notice = useAppState((s) => s.notice)
  React.useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])
  return (
    <div className="container cherrypick-page cherrypick-ui">
      <h1 className="cherrypick-page-title">
        {PLUGIN_NAME} <Cherries />
      </h1>
      <p className="text-muted">
        Settings are in Settings › Plugins › {PLUGIN_NAME}.
      </p>
      {notice?.kind === 'removed' ? (
        <div className="alert alert-info">
          {PLUGIN_NAME}&apos;s data is gone. It starts over as if just
          installed.
        </div>
      ) : null}
      {sections.map(({ id, title, Component }) => (
        <Section key={id} id={id} title={title}>
          <Safe name={`${title} section`}>
            <Component />
          </Safe>
        </Section>
      ))}
    </div>
  )
}

export function registerPluginPage() {
  registerPageSection('your-score', 10, 'Your score', YourScore)
  registerPageSection('not-interested', 40, 'Not interested', NotInterested)
  registerPageSection('dont-learn', 50, "Don't learn", DontLearnList)
  registerPageSection('remove', 90, `Remove ${PLUGIN_NAME} data`, Remove)
  registerDialog('remove', RemoveDialog)
  register.route(PLUGIN_ROUTE, () => (
    <Safe name="plugin page">
      <PluginPage />
    </Safe>
  ))
}
