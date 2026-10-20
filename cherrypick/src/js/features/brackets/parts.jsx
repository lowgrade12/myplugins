// Pieces the bracket dialogs and pages share: the dialog frame, the size
// picker, the byes line, the bracket tree and the resume pill.
import { Bootstrap, components, FontAwesomeSolid } from '../../runtime/api.js'
import * as BR from '../../model/brackets.js'
import { useAppState } from '../../ui/hooks.js'
import { resumeBracket } from './actions.js'

const { faPlay } = FontAwesomeSolid

export const lc = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)
export const plural = (n, one, many = one + 's') => (n === 1 ? one : many)

// The mockup's bracket mark, filled with currentColor, sized like Stash's
// own icons
const BRACKET =
  'M1 2h4v1.6H2.6v2.6H5v1.6H1Zm0 6.2h4v1.6H2.6v2.6H5V14H1ZM6.5 4.1h3v3.3h2.6V9H9.5v2.9h-3v-1.6h1.4V5.7H6.5Zm7 3.3h1.5V9h-1.5Z'
export function BracketIcon() {
  return (
    <svg
      className="svg-inline--fa fa-icon cherrypick-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path fill="currentColor" d={BRACKET} />
    </svg>
  )
}

// Stash's Icon with a FontAwesome icon
export function Icon({ icon, className }) {
  const StashIcon = components.Icon
  return StashIcon ? <StashIcon icon={icon} className={className} /> : null
}

// A react-bootstrap Modal: full screen at phone width, no fade, so moving
// between the bracket's dialogs never flashes the page behind
export function Dialog({
  title,
  onHide,
  footer,
  children,
  size = 'lg',
  className = '',
  headerExtra,
}) {
  const { Modal } = Bootstrap
  return (
    <Modal
      show
      onHide={onHide}
      size={size}
      centered
      scrollable
      animation={false}
      dialogClassName="cherrypick-modal-phone"
      className={`cherrypick-ui cherrypick-dialog ${className}`}
    >
      <Modal.Header closeButton>
        <Modal.Title as="h5">{title}</Modal.Title>
        {headerExtra}
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
    </Modal>
  )
}

// The 16/32/64 control both setup sheets share. n: the pool; shown: the
// size that's on. A size the pool can't fill is disabled ("Needs 32; 21
// available"). floor: the pool 16 needs: 16 performers, but only 4 scenes,
// since a clip pool of 4 to 15 plays every scene.
export function SizePicker({ n, shown, onPick, floor = BR.DEFAULT_SIZE }) {
  return (
    <>
      <h6 className="text-muted">Size</h6>
      <div className="cherrypick-sizes">
        {BR.SIZES.map((s) => {
          const need = s === BR.DEFAULT_SIZE ? floor : s
          const off = n < need
          return (
            <button
              key={s}
              type="button"
              className={`btn ${shown === s ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={shown === s}
              disabled={off}
              title={off ? `Needs ${need}; ${n} available` : undefined}
              onClick={() => onPick(s)}
            >
              {s}
            </button>
          )
        })}
        <span className="small text-muted cherrypick-available">
          {n} available
        </span>
      </div>
    </>
  )
}

// "Fewer than 16, so all 11 play; 5 get a bye in the first round." Under
// the clip sheet's sizes, and in the play dialog for a short pool's whole
// first round. Who gets the byes stays unsaid: it would hint at ratings.
export function ByesNote({ n, className = '' }) {
  const byes = BR.clipByes(n)
  return (
    <p className={`small text-muted cherrypick-byes ${className}`}>
      Fewer than {BR.DEFAULT_SIZE}, so all {n} play
      {byes
        ? `; ${byes} ${byes === 1 ? 'gets a bye' : 'get a bye'} in the first round.`
        : '.'}
    </p>
  )
}

// What a bracket's ids show as: name or title, and photo or screenshot
export function useEntrant(kind) {
  const db = useAppState((s) => s.db)
  return (id) => {
    if (!id || !db) return { name: '', image: null }
    if (kind === 'performer') {
      const p = db.performers.get(id)
      return { name: p?.name || 'A removed performer', image: p?.image, p }
    }
    const s = db.scenes.get(id)
    return { name: s?.title || 'A removed scene', image: s?.image, s }
  }
}

// The whole bracket, round by round, with byes marked and no seeds
export function BracketTree({ b, st }) {
  const entrant = useEntrant(b.kind)
  return (
    <div className="cherrypick-tree">
      {st.rounds.map((round, ri) => (
        <div className="cherrypick-tree-round" key={ri}>
          <div className="cherrypick-tree-round-name small text-muted">
            {BR.roundName(round.length * 2)}
          </div>
          <div className="cherrypick-tree-matches">
            {round.map((m, mi) => {
              const isCur =
                st.current && st.current.round === ri && st.current.index === mi
              return (
                <div
                  className={`card cherrypick-tree-match ${isCur ? 'border-primary' : ''}`}
                  key={mi}
                >
                  {[m.a, m.b].map((id, k) => {
                    const e = entrant(id)
                    const state =
                      m.winner && id
                        ? m.winner === id
                          ? 'font-weight-bold'
                          : 'cherrypick-lost'
                        : !id
                          ? 'text-muted'
                          : ''
                    return (
                      <div key={k} className={`cherrypick-tree-slot ${state}`}>
                        {e.image ? (
                          <img src={e.image} alt="" loading="lazy" />
                        ) : (
                          <span className="cherrypick-tree-noimg" />
                        )}
                        <span className="cherrypick-tree-label">
                          {id ? e.name : m.bye ? 'bye' : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// "Resume bracket · round of 16": under the list toolbars and in the Hall
// of Fame row's header while a bracket is paused
export function ResumePill() {
  const b = useAppState((s) => s.brackets.active)
  const dialog = useAppState((s) => s.dialog)
  if (!b || dialog) return null
  const st = BR.bracketState(b)
  if (!st.current) return null
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm rounded-pill cherrypick-resume-pill cherrypick-ui"
      onClick={resumeBracket}
      title={`${b.poolLabel} · ${st.played} of ${st.totalMatches} picks made`}
    >
      <Icon icon={faPlay} />
      <span>Resume bracket · {lc(st.roundLabel)}</span>
    </button>
  )
}
