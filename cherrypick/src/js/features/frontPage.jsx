// Cherry Pick's rows on Stash's front page, above Stash's own: For you (or,
// for libraries under 30 scenes, New in your library), 0 to 2 rows that
// follow recent watching, then the Hall of Fame. Stash's FrontPage is kept
// whole: the rows are added before its .recommendations-container, so its
// rows, its Customise button and other plugins' patches stay. With Watch
// This on, one scene in Stash's player takes the rows' place
// (watchThis.jsx), and the rows' switches keep their values.
//
// The rows are computed once per visit to the front page and then hold
// still: Not interested turns a card into an Undo card in place, and nothing
// reorders while the page is open.
import { patchAfter, ReactRouterDOM } from '../runtime/api.js'
import { store } from '../runtime/app.js'
import { recordOpen, undoNotInterested } from '../runtime/actions.js'
import {
  computeForYou,
  context,
  followRows,
  newInLibrary,
  shownSignals,
  tooSmall,
  visitSignals,
} from '../model/foryou.js'
import { BuildingLine } from '../ui/BuildingLine.jsx'
import { CardRow, HiddenCard } from '../ui/Row.jsx'
import { RowSceneCard } from '../ui/rowCards.jsx'
import { Safe } from '../ui/Safe.jsx'
import { useAppState } from '../ui/hooks.js'
import { HallOfFameRow } from './hallOfFame.jsx'
import { ResumePill } from './brackets/index.jsx'
import { quickStartPerformers, resumeBracket } from './brackets/actions.js'
import { rateMore } from '../model/index.js'
import { toRateUrl } from '../data/listFilter.js'
import { useFallbackLookups } from '../stashdb/layer.js'
import { KEYS, local } from '../storage/tier3.js'
import { WatchThis } from './watchThis.jsx'

// ------------------------------------------------------------ the visit's rows

let snap = null

// The rows for this visit: computed when the front page opens with a model
// (and again within the visit only if the settings or the StashDB data
// change). Cards shown last visit and not opened count as passed over,
// once, here.
function snapshot(s) {
  if (!s.M) return null
  const key = [s.visit, JSON.stringify(s.settings), s.M.db.hasStashdb].join('|')
  if (snap?.key === key) return snap
  const sameVisit = snap?.visit === s.visit
  const skip = new Set(s.dontLearn.map((d) => d.sceneId))
  const signals = sameVisit ? snap.signals : visitSignals(s.signals, skip)
  const ctx = context(s.M, s)
  const small = tooSmall(s.db)
  let forYou = null
  let fallback = null
  let follow = []
  if (s.settings.showForYou) {
    if (small) fallback = newInLibrary(ctx)
    else forYou = computeForYou(ctx, signals)
  }
  if (!small && s.settings.showFollowRows)
    follow = followRows(
      ctx,
      signals,
      forYou ? forYou.map((it) => it.scene.id) : [],
    )
  snap = {
    key,
    visit: s.visit,
    signals,
    forYou,
    fallback,
    follow,
    next: shownSignals(
      signals,
      forYou ? forYou.map((it) => it.scene.id) : [],
      sameVisit ? s.signals.lastShownOpened : [],
    ),
    stored: false,
  }
  return snap
}

// One row of the visit. Hidden cards stay in place as Undo cards; scenes
// hidden since the visit began never show again in it.
function SceneRow({ id, title, items, className, onOpen, extra }) {
  const hidden = useAppState((s) => s.notInterested)
  const recent = useAppState((s) => s.recentHidden)
  const isHidden = new Set(hidden.map((n) => n.sceneId))
  const shown = (items || []).filter(
    (it) =>
      !isHidden.has(it.scene.id) ||
      recent.some((h) => h.sceneId === it.scene.id && h.rowId === id),
  )
  return (
    <CardRow
      id={id}
      title={title}
      className={`cherrypick-ui ${className || ''}`}
      kind="scene"
      extra={extra}
      items={items ? shown : null}
      renderCard={(scene, it, i) =>
        isHidden.has(it.scene.id) ? (
          <HiddenCard
            key={'h' + scene.id}
            title={scene.title}
            onUndo={() => undoNotInterested(scene.id)}
          />
        ) : (
          <RowSceneCard
            key={scene.id}
            scene={scene}
            item={it}
            rowId={id}
            index={i}
            onOpen={onOpen}
          />
        )
      }
    />
  )
}

const { Link } = ReactRouterDOM

// One line in For you's header while Your score has too few ratings to
// check itself: the two quickest ways to sharpen the row, each one click.
// The ratings link opens your unrated scenes, most played first; a bracket
// starts (or resumes) here.
function SharpenLine() {
  const M = useAppState((s) => s.M)
  const active = useAppState((s) => !!s.brackets.active)
  const rate = rateMore(M)
  if (!rate) return null
  return (
    <span className="text-muted small cherrypick-sharpen">
      <Link to={toRateUrl()}>{rate}</Link> or{' '}
      <button
        type="button"
        className="btn btn-link cherrypick-sharpen-bracket"
        onClick={() => (active ? resumeBracket() : quickStartPerformers(null))}
      >
        {active ? 'finish your bracket' : 'play a bracket'}
      </button>{' '}
      to sharpen these picks
    </span>
  )
}

function CherryPickRows() {
  // Only what the rows show: the visit's snapshot (the same object for the
  // whole visit), whether a scene plays and the For you switch. Reading the
  // whole state redrew every card on any change (a lookup's progress, a
  // signal, the library's check).
  const v = useAppState(snapshot)
  const watching = useAppState((x) => x.watching)
  const showForYou = useAppState((x) => x.settings.showForYou)
  // StashDB popularity for New in your library's order and reasons
  useFallbackLookups(v?.fallback)
  // Store this visit's row once, for the next visit to count passes against.
  if (v && !v.stored) {
    v.stored = true
    setTimeout(() => store.set({ signals: v.next }), 0)
  }
  if (watching) return null
  // Until the library and model are in, a For you row of Stash's skeleton
  // cards keeps the place, so Stash's rows do not jump when it fills.
  if (!v)
    return showForYou ? (
      <div className="recommendations-container cherrypick-front">
        <SceneRow
          id="foryou"
          title="For you"
          items={null}
          className="cherrypick-for-you-building"
          extra={<BuildingLine />}
        />
      </div>
    ) : null
  return (
    <div className="recommendations-container cherrypick-front">
      {v.forYou ? (
        <SceneRow
          id="foryou"
          title="For you"
          items={v.forYou}
          className="cherrypick-for-you"
          onOpen={recordOpen}
          extra={<SharpenLine />}
        />
      ) : null}
      {v.fallback ? (
        <SceneRow
          id="fallback"
          title="New in your library"
          items={v.fallback}
          className="cherrypick-fallback"
        />
      ) : null}
      {v.follow.map((r) => (
        <SceneRow
          key={r.id}
          id={r.id}
          title={r.title}
          items={r.items}
          className="cherrypick-follow"
        />
      ))}
      <HallOfFameRow extra={<ResumePill />} />
    </div>
  )
}

// Watch This, until the plugin's configuration arrives: the value this
// browser last saw, so the front page starts with the right skeleton.
const mirroredWatchThis = local.get(KEYS.mirror)?.watchThis === true

// Cherry Pick's rows, or with Watch This on, one scene in their place.
function FrontPiece() {
  const watchThis = useAppState((s) =>
    s.configLoaded ? s.settings.watchThis === true : mirroredWatchThis,
  )
  return watchThis ? (
    <Safe name="Watch This">
      <WatchThis />
    </Safe>
  ) : (
    <Safe name="front page rows">
      <CherryPickRows />
    </Safe>
  )
}

// Stash's FrontPage renders a loading indicator, the Customise editor or the
// rows' .recommendations-container; Cherry Pick's rows join only the last.
const isRows = (el) =>
  String(el?.props?.className || '').includes('recommendations-container')

export function registerFrontPage() {
  patchAfter('FrontPage', (props, result) =>
    isRows(result) ? (
      <>
        <FrontPiece />
        {result}
      </>
    ) : (
      result
    ),
  )
}
