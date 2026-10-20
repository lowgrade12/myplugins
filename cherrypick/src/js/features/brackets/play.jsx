// The play dialog: two big cards, pick one. ←/→ or a tap picks, U or
// Backspace undoes, Esc or × pauses. Every pick needs an answer: there is no
// "Can't decide". A card shows no rating, seed or rating-based reason, so a
// pick is not pulled toward past ratings, and an anchor looks like any
// other entrant. A scene match shows contact sheets; a frame, Look closer
// or 1 and 2 open an inspector (judge.jsx), and no scene's own file plays.
import { FontAwesomeSolid, React } from '../../runtime/api.js'
import { store } from '../../runtime/app.js'
import * as BR from '../../model/brackets.js'
import { useAppState } from '../../ui/hooks.js'
import {
  abandonBracket,
  pauseBracket,
  pickWinner,
  undoPick,
  VIEWS,
} from './actions.js'
import {
  LookFooter,
  LookHints,
  MatchHints,
  SceneContender,
  SceneInspector,
  lookClaims,
  lookKey,
  prepareScenes,
  settled,
  useLook,
} from './judge.jsx'
import {
  BracketIcon,
  BracketTree,
  ByesNote,
  Dialog,
  Icon,
  plural,
} from './parts.jsx'
import { nextPair } from './sheet.js'

const { faRotateLeft, faUndo } = FontAwesomeSolid

// One side of a match, as a big card. Also the Challenge round's. A scene
// is a contact sheet (SceneContender), with Look closer.
export function Contender({ b, id, side, onPick, onLook }) {
  const M = useAppState((s) => s.M)
  if (!M) return null
  const key = (
    <span className="cherrypick-key badge badge-dark">
      {side === 'left' ? '←' : '→'}
    </span>
  )
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPick()
    }
  }
  if (b.kind === 'clip')
    return (
      <SceneContender id={id} side={side} onPick={onPick} onLook={onLook} />
    )
  const p = M.db.performers.get(id)
  const n = p?.local?.scene_count ?? p?.ownedSceneIds.length ?? 0
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card cherrypick-contender performer side-${side}`}
      onClick={onPick}
      onKeyDown={onKeyDown}
    >
      <div className="cherrypick-cont-img">
        {p?.image ? <img src={p.image} alt="" /> : null}
        {key}
      </div>
      <div className="cherrypick-cont-body">
        <div className="cherrypick-cont-title">
          {p?.name || 'A removed performer'}
        </div>
        <div className="small text-muted">
          {n} {plural(n, 'scene')}
        </div>
      </div>
    </div>
  )
}

// Keys while a dialog of `view` is up. They go no further, so Stash's own
// shortcuts (page keys, "e" to edit) don't act on the page behind. Esc is
// left to the Modal, which pauses; Tab, Enter and Space to the focused
// control, unless claims(event) takes them (the scene inspector takes Esc
// and Enter). onKey(key, event) acts on the store as it is now and returns
// whether it took the key.
const PASS = new Set(['Escape', 'Tab', 'Enter', ' '])

export function usePickKeys(view, onKey, claims) {
  const latest = React.useRef({ onKey, claims })
  latest.current = { onKey, claims }
  React.useEffect(() => {
    const listener = (e) => {
      if (store.get().dialog?.view !== view) return
      if (PASS.has(e.key) && !latest.current.claims?.(e)) return
      e.stopPropagation()
      if (e.type !== 'keydown' || e.altKey || e.ctrlKey || e.metaKey) return
      if (latest.current.onKey(e.key, e)) e.preventDefault()
    }
    window.addEventListener('keydown', listener, true)
    window.addEventListener('keypress', listener, true)
    return () => {
      window.removeEventListener('keydown', listener, true)
      window.removeEventListener('keypress', listener, true)
    }
  }, [view])
}

export const isUndoKey = (k) => k === 'Backspace' || k === 'u' || k === 'U'

// A scene match: the inspector's state, and a pick that takes only a side
// of the match on screen and, in a scene bracket, not within 400 ms of the
// last pick. Fetches what the two scenes and the next pair show.
export function useSceneMatch(kind, pair, next, onPick) {
  const [look, setLook] = useLook(kind === 'clip' ? pair : null)
  const pick = (id) => {
    if (!pair || (id !== pair[0] && id !== pair[1])) return
    if (kind === 'clip' && !settled()) return
    setLook(null)
    onPick(id)
  }
  const ids = kind === 'clip' && pair ? [...pair, ...next] : []
  React.useEffect(() => {
    if (ids.length) prepareScenes(ids)
    // the ids say it all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()])
  // the keys a scene match adds: 1 and 2 look closer, and the inspector's
  const onKey = (k, e) => {
    if (look) return lookKey(k, e, { look, setLook, pair, pick })
    if (kind === 'clip' && pair && (k === '1' || k === '2')) {
      setLook({ id: k === '1' ? pair[0] : pair[1], frame: -1 })
      return true
    }
    return null
  }
  const claims = (e) => !!look && lookClaims(e)
  return { look, setLook, pick, onKey, claims }
}

const titleOf = (id) =>
  store.get().M?.db.scenes.get(id)?.title || 'the other scene'

export function PlayDialog() {
  const b = useAppState((s) => s.brackets.active)
  const [tree, setTree] = React.useState(false)
  const [abandoning, setAbandoning] = React.useState(false)
  const st = b ? BR.bracketState(b) : null
  const cur = st?.current
  const pair = cur && !tree ? [cur.a, cur.b] : null
  const match = useSceneMatch(
    b?.kind,
    pair,
    st && cur ? nextPair(st) : [],
    pickWinner,
  )
  const undo = () => {
    match.setLook(null)
    undoPick()
  }
  usePickKeys(
    VIEWS.play,
    (k, e) => {
      const taken = match.onKey(k, e)
      if (taken != null) return taken
      const a = store.get().brackets.active
      const now = a ? BR.bracketState(a).current : null
      if (!now) return false
      if (k === 'ArrowLeft') match.pick(now.a)
      else if (k === 'ArrowRight') match.pick(now.b)
      else if (isUndoKey(k)) undo()
      else if (k === 't' || k === 'T') setTree((x) => !x)
      else return false
      return true
    },
    match.claims,
  )
  if (!b || !cur) return null
  const kind = b.kind === 'performer' ? 'performers' : 'scenes'
  const look = match.look
  const footer = look ? (
    <LookFooter
      look={look}
      setLook={match.setLook}
      pair={pair}
      pick={match.pick}
      titleOf={titleOf}
    />
  ) : abandoning ? (
    <>
      <span className="cherrypick-abandon-ask">
        Abandon this bracket? Its picks are dropped and nothing is recorded.
      </span>
      <span className="cherrypick-footer-spacer" />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setAbandoning(false)}
      >
        Keep playing
      </button>
      <button type="button" className="btn btn-danger" onClick={abandonBracket}>
        Abandon
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={!b.decisions.length}
        onClick={undo}
      >
        <Icon icon={faRotateLeft || faUndo} />
        <span>Undo</span>
      </button>
      <button
        type="button"
        className={`btn ${tree ? 'btn-primary' : 'btn-secondary'}`}
        onClick={() => setTree(!tree)}
      >
        <BracketIcon />
        <span>{tree ? 'Back to the match' : 'Show bracket'}</span>
      </button>
      <span className="cherrypick-footer-spacer" />
      <button
        type="button"
        className="btn btn-link btn-sm text-muted"
        onClick={() => setAbandoning(true)}
      >
        Abandon
      </button>
    </>
  )
  return (
    <Dialog
      title={`${b.poolLabel} · ${b.seeds.length} ${kind}`}
      size="xl"
      onHide={pauseBracket}
      className={`cherrypick-play-modal${look ? ' cherrypick-looking' : ''}`}
      headerExtra={
        <span className="cherrypick-round text-muted">{st.label}</span>
      }
      footer={footer}
    >
      <div
        className="progress cherrypick-progress"
        title={`${st.played} of ${st.totalMatches} picks`}
      >
        <div
          className="progress-bar"
          style={{ width: (100 * st.played) / st.totalMatches + '%' }}
        />
      </div>
      {b.kind === 'clip' &&
      b.seeds.length < BR.DEFAULT_SIZE &&
      cur.round === 0 &&
      !look ? (
        <ByesNote n={b.seeds.length} className="cherrypick-play-byes" />
      ) : null}
      {tree ? (
        <BracketTree b={b} st={st} />
      ) : look ? (
        <>
          <SceneInspector
            key={look.id}
            id={look.id}
            frame={look.frame}
            setFrame={(frame) => match.setLook({ ...look, frame })}
          />
          <LookHints id={look.id} />
        </>
      ) : (
        <>
          <div className={`cherrypick-match ${b.kind}`}>
            <Contender
              key={'a' + cur.a}
              b={b}
              id={cur.a}
              side="left"
              onPick={() => match.pick(cur.a)}
              onLook={(frame) => match.setLook({ id: cur.a, frame })}
            />
            <Contender
              key={'b' + cur.b}
              b={b}
              id={cur.b}
              side="right"
              onPick={() => match.pick(cur.b)}
              onLook={(frame) => match.setLook({ id: cur.b, frame })}
            />
          </div>
          {b.kind === 'clip' ? (
            <MatchHints esc="pause" />
          ) : (
            <p className="cherrypick-hints small text-muted">
              <span className="cherrypick-hints-keys">
                <kbd>←</kbd> <kbd>→</kbd> pick · <kbd>U</kbd> undo ·{' '}
                <kbd>Esc</kbd> pause
              </span>
              <span className="cherrypick-hints-touch">
                Tap a side to pick it. Close to pause.
              </span>
            </p>
          )}
        </>
      )}
    </Dialog>
  )
}
