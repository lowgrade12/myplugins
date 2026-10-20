// Judging a scene the user may never have watched, inside a scene bracket.
// Each side of a match is a contact sheet: the cover and eight frames over
// the runtime, title, studio, year, length, resolution, up to four
// performers' faces and a row of tags, with no rating, seed or reason. The
// cover picks, as a performer card's photo does. A frame under it opens the
// inspector at that frame, and Look closer on the cover: one scene large, a
// frame viewer with a scrub bar, sixteen tiles, Stash's preview clip, every
// performer, the description and every tag.
//
// Nothing here plays the scene's own file or uses Stash's scene player,
// which records a play and saves activity as it plays. The frames come
// from the sprite sheet Stash generates (JPEG, whatever the scene's codec),
// drawn with CSS background-position, and the preview is the clip Stash
// generates (H.264), in a plain <video>. So judging works for every file
// and records no play.
import { FontAwesomeSolid, React } from '../../runtime/api.js'
import { run } from '../../runtime/app.js'
import { createStore, useStoreValue } from '../../runtime/store.js'
import { PREVIEW_SETTINGS, SCENE_LOOK } from '../../data/queries.js'
import { useAppState } from '../../ui/hooks.js'
import { fmtDuration } from '../../ui/StashdbSceneCard.jsx'
import { Icon } from './parts.jsx'
import { NONE, cardTags, evenly, parseSprites, resolution } from './sheet.js'

const {
  faChevronLeft,
  faChevronRight,
  faMagnifyingGlass,
  faSearch,
  faPlay,
  faStop,
  faUser,
} = FontAwesomeSolid

// A scene-bracket pick within this long of the last is ignored: a double
// tap on a picture would otherwise also pick in the next match, which
// renders under the finger
export const PICK_SETTLE_MS = 400
let lastPickAt = 0
export function settled() {
  const now = Date.now()
  if (now - lastPickAt < PICK_SETTLE_MS) return false
  lastPickAt = now
  return true
}

// ------------------------------------------------------------ data

// What the match shows beyond the library copy, kept for the session:
// looks (SCENE_LOOK: description, tags with parents, sprite list and
// preview paths), sheets (the parsed sprite list) and previews (whether
// Stash made the clip), each by scene id. `undefined`: not known yet.
const looks = new Map()
const sheets = new Map()
const previews = new Map()
const asked = new Set()
const changes = createStore({ n: 0 })
const changed = () => changes.set((s) => ({ n: s.n + 1 }))
const useJudgeData = () => useStoreValue(changes, (s) => s.n)

async function loadSheet(id, vtt) {
  let sheet = NONE
  try {
    const res = await fetch(vtt)
    if (res.ok) sheet = parseSprites(await res.text(), vtt)
  } catch (e) {
    console.warn('CherryPick: sprite list', e)
  }
  sheets.set(id, sheet)
  // the sheet itself, so the frames are there when the match is
  if (sheet.url) new Image().src = sheet.url
  changed()
}

// Fetches what a match needs for these scenes, once each: the look, then
// the sprite list and whether Stash made the preview clip. The match on
// screen asks for its two scenes and the next match's, so the inspector
// opens with Play the preview in place: it sits under the scrub bar, and
// arriving later moved the centred dialog up under the mouse.
export function prepareScenes(ids) {
  const missing = ids.filter((id) => id && !asked.has(id))
  if (!missing.length) return
  for (const id of missing) asked.add(id)
  run(SCENE_LOOK, { ids: missing }).then(
    ({ findScenes }) => {
      const byId = new Map(findScenes.scenes.map((s) => [s.id, s]))
      for (const id of missing) {
        const look = byId.get(id) || null
        looks.set(id, look)
        if (look?.paths?.vtt) loadSheet(id, look.paths.vtt)
        else sheets.set(id, NONE)
        if (look?.paths?.preview) probePreview(id, look.paths.preview)
      }
      changed()
    },
    (e) => {
      console.warn('CherryPick: scene details', e)
      for (const id of missing) {
        looks.set(id, null)
        sheets.set(id, NONE)
      }
      changed()
    },
  )
}

// Whether Stash generated the scene's preview clip. Stash answers HEAD with
// 405, so this asks for its first byte.
function probePreview(id, url) {
  if (previews.has(id)) return
  previews.set(id, undefined)
  fetch(url, { headers: { Range: 'bytes=0-0' } })
    .then((res) => {
      res.body?.cancel().catch(() => {})
      return res.ok
    })
    .catch(() => false)
    .then((ok) => {
      previews.set(id, ok)
      changed()
    })
}

// Stash's preview settings: sound on or off, and the clip's length
let previewSettings = null
function loadPreviewSettings() {
  previewSettings ||= run(PREVIEW_SETTINGS).then(
    ({ configuration: c }) => ({
      sound: !!c.interface?.soundOnPreview,
      seconds:
        (c.general?.previewSegments || 0) *
        (c.general?.previewSegmentDuration || 0),
    }),
    () => ({ sound: false, seconds: 0 }),
  )
  return previewSettings
}
function usePreviewSettings() {
  const [s, setS] = React.useState(null)
  React.useEffect(() => {
    let live = true
    loadPreviewSettings().then((v) => live && setS(v))
    return () => {
      live = false
    }
  }, [])
  return s
}

// The frame count of a scene's sheet, for the inspector's keys
export const frameCount = (id) => sheets.get(id)?.frames.length || 0

// ------------------------------------------------------------ pieces

// One sprite cell, scaled to fill its box
function cellStyle(sheet, f) {
  const pos = (at, size, whole) =>
    whole === size ? 0 : (at / (whole - size)) * 100
  return {
    backgroundImage: `url("${sheet.url}")`,
    backgroundSize: `${(sheet.width / f.w) * 100}% ${(sheet.height / f.h) * 100}%`,
    backgroundPosition: `${pos(f.x, f.w, sheet.width)}% ${pos(f.y, f.h, sheet.height)}%`,
  }
}
const ratioOf = (sheet) =>
  sheet?.frames.length
    ? {
        '--cherrypick-frame-ratio': `${sheet.frames[0].w} / ${sheet.frames[0].h}`,
      }
    : undefined

const meta = (s) =>
  [
    s.studio?.name,
    s.date ? s.date.slice(0, 4) : null,
    fmtDuration(s.duration),
    resolution(s),
  ]
    .filter(Boolean)
    .join(' · ')

// A scene of the bracket, or a stand-in for one deleted from Stash since
// the bracket started, which can still be picked
const sceneOf = (M, id) =>
  M.db.scenes.get(id) || {
    id,
    title: 'A removed scene',
    performers: [],
    tags: [],
    image: null,
    duration: null,
    studio: null,
    date: null,
  }

function Faces({ db, performers, max, big = false }) {
  const shown = performers.slice(0, max)
  const more = performers.length - shown.length
  return (
    <div className={`cherrypick-faces${big ? ' big' : ''}`}>
      {shown.map((p) => {
        const image = db.performers.get(p.id)?.image
        return (
          <span className="cherrypick-face" key={p.id} title={p.name}>
            {image ? (
              <img src={image} alt="" loading="lazy" />
            ) : (
              <span className="cherrypick-face-none">
                {faUser ? <Icon icon={faUser} /> : null}
              </span>
            )}
            <span className="cherrypick-face-name">{p.name}</span>
          </span>
        )
      })}
      {more > 0 ? (
        <span className="cherrypick-face-more small text-muted">+{more}</span>
      ) : null}
    </div>
  )
}

/**
 * One side of a scene match. The cover picks, as a performer card's photo
 * does; onLook(frame) opens the inspector, at a frame under the cover or
 * (-1) on the cover from Look closer.
 */
export function SceneContender({ id, side, onPick, onLook }) {
  const M = useAppState((s) => s.M)
  useJudgeData()
  if (!M) return null
  const s = sceneOf(M, id)
  const sheet = sheets.get(id)
  const title = s.title || 'Untitled scene'
  const n = sheet?.frames.length || 0
  return (
    <div
      className={`card cherrypick-contender clip cherrypick-judge side-${side}`}
      data-scene={id}
    >
      <button
        type="button"
        className="cherrypick-cont-img cherrypick-cover-pick"
        onClick={onPick}
        aria-label={`Pick ${title}`}
      >
        {s.image ? <img src={s.image} alt="" /> : null}
        <span className="cherrypick-key badge badge-dark">
          {side === 'left' ? '←' : '→'}
        </span>
        {s.duration ? (
          <span className="cherrypick-runtime badge badge-dark">
            {fmtDuration(s.duration)}
          </span>
        ) : null}
      </button>
      {sheet === NONE ? null : (
        <div className="cherrypick-sheet" style={ratioOf(sheet)}>
          {n
            ? evenly(8, n).map((i) => {
                const t = fmtDuration(sheet.frames[i].t) || '0:00'
                return (
                  <button
                    type="button"
                    className="cherrypick-frame"
                    key={i}
                    aria-label={`Look closer from ${t}`}
                    onClick={() => onLook(i)}
                  >
                    <span
                      className="cherrypick-frame-img"
                      style={cellStyle(sheet, sheet.frames[i])}
                    />
                    <span className="cherrypick-frame-t badge badge-dark">
                      {t}
                    </span>
                  </button>
                )
              })
            : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <span className="cherrypick-frame" key={i} />
              ))}
        </div>
      )}
      {sheet === NONE ? (
        <p className="cherrypick-sheet-none small text-muted">
          No frames: Stash hasn&apos;t generated previews for this scene.
        </p>
      ) : null}
      <div className="cherrypick-cont-body">
        <div className="cherrypick-cont-title" title={title}>
          {title}
        </div>
        <div className="small text-muted cherrypick-cont-meta">{meta(s)}</div>
        <div className="cherrypick-cont-faces">
          <Faces db={M.db} performers={s.performers} max={4} />
        </div>
        <div className="small cherrypick-face-names">
          {s.performers.map((p) => p.name).join(', ')}
        </div>
        <div className="cherrypick-cont-tags">
          {cardTags(M.db, s).map((t) => (
            <span className="tag-item badge badge-secondary" key={t.id}>
              {t.name}
            </span>
          ))}
        </div>
        <div className="cherrypick-cont-actions">
          <Faces db={M.db} performers={s.performers} max={4} />
          <button
            type="button"
            className="btn btn-secondary cherrypick-look-btn"
            onClick={() => onLook(-1)}
          >
            <Icon icon={faMagnifyingGlass || faSearch} />
            <span>Look closer</span>
          </button>
          <button
            type="button"
            className="btn btn-primary cherrypick-pick"
            onClick={onPick}
          >
            Pick this
          </button>
        </div>
      </div>
    </div>
  )
}

// The scrub bar: drag along it (or, with a mouse, hover) to move through
// the frames. Touch scrolling is off on the bar alone, so the dialog still
// scrolls from anywhere else.
function Scrubber({ sheet, frame, setFrame }) {
  const ref = React.useRef(null)
  const down = React.useRef(false)
  const n = sheet.frames.length
  const at = (e) => {
    const r = ref.current.getBoundingClientRect()
    return Math.max(
      0,
      Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)),
    )
  }
  const cur = Math.max(0, frame)
  const pct = ((cur + 0.5) / n) * 100
  return (
    <div
      ref={ref}
      className="cherrypick-scrub"
      role="slider"
      tabIndex={0}
      aria-label="Scrub through the scene"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={cur}
      aria-valuetext={fmtDuration(sheet.frames[cur].t) || '0:00'}
      onPointerDown={(e) => {
        down.current = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
        setFrame(at(e))
      }}
      onPointerMove={(e) => {
        if (down.current || e.pointerType === 'mouse') setFrame(at(e))
      }}
      onPointerUp={() => (down.current = false)}
      onPointerCancel={() => (down.current = false)}
    >
      <div className="progress cherrypick-scrub-track">
        <div
          className="progress-bar"
          style={{ width: frame < 0 ? '0%' : pct + '%' }}
        />
      </div>
      {frame >= 0 ? (
        <div className="cherrypick-scrub-thumb" style={{ left: pct + '%' }} />
      ) : null}
    </div>
  )
}

function Details({ text }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="cherrypick-insp-details">
      <p className={`small${open ? '' : ' cherrypick-clamp'}`}>{text}</p>
      {text.length > 260 ? (
        <button
          type="button"
          className="btn btn-link btn-sm p-0"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Less' : 'More'}
        </button>
      ) : null}
    </div>
  )
}

// Every tag, grouped under its parent tag when the library has parents;
// tags with none go last, under Other. A library without parent tags gets
// one list.
function TagGroups({ tags }) {
  if (!tags.length) return null
  const groups = new Map()
  for (const t of tags) {
    const k = t.parents?.[0]?.name || ''
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }
  const named = [...groups.keys()]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
  const order = groups.has('') ? [...named, ''] : named
  const badge = (t) => (
    <span className="tag-item badge badge-secondary" key={t.id}>
      {t.name}
    </span>
  )
  return (
    <div className="cherrypick-insp-tags">
      {named.length
        ? order.map((k) => (
            <div className="cherrypick-insp-taggroup" key={k || ' other'}>
              <div className="small text-muted">{k || 'Other'}</div>
              <div>{groups.get(k).map(badge)}</div>
            </div>
          ))
        : tags.map(badge)}
    </div>
  )
}

/**
 * One scene, large. frame: -1 shows the cover; setFrame moves through the
 * sprite frames.
 */
export function SceneInspector({ id, frame, setFrame }) {
  const M = useAppState((s) => s.M)
  useJudgeData()
  const settings = usePreviewSettings()
  const [playing, setPlaying] = React.useState(false)
  const look = looks.get(id)
  const previewUrl = look?.paths?.preview
  // moving through the frames stops the preview
  React.useEffect(() => setPlaying(false), [frame])
  if (!M) return null
  const s = sceneOf(M, id)
  const sheet = sheets.get(id)
  const n = sheet?.frames.length || 0
  const f = frame >= 0 && n ? sheet.frames[Math.min(frame, n - 1)] : null
  const hasPreview = !!previewUrl && previews.get(id) === true
  const step = (d) => setFrame(Math.max(-1, Math.min(n - 1, frame + d)))
  const seconds = Math.round(settings?.seconds || 0)
  return (
    <div className="cherrypick-inspector" data-scene={id}>
      <div className="cherrypick-insp-media">
        <div className="cherrypick-insp-view">
          {playing && hasPreview ? (
            <video
              className="cherrypick-insp-video"
              src={previewUrl}
              autoPlay
              playsInline
              muted={!settings?.sound}
              onEnded={() => setPlaying(false)}
            />
          ) : f ? (
            <span
              className="cherrypick-insp-frame"
              style={cellStyle(sheet, f)}
            />
          ) : s.image ? (
            <img src={s.image} alt="" />
          ) : null}
          {n && !playing ? (
            <>
              <button
                type="button"
                className="btn btn-dark rounded-circle cherrypick-insp-step prev"
                aria-label="Previous frame"
                disabled={frame < 0}
                onClick={() => step(-1)}
              >
                <Icon icon={faChevronLeft} />
              </button>
              <button
                type="button"
                className="btn btn-dark rounded-circle cherrypick-insp-step next"
                aria-label="Next frame"
                disabled={frame >= n - 1}
                onClick={() => step(1)}
              >
                <Icon icon={faChevronRight} />
              </button>
            </>
          ) : null}
          {playing ? null : (
            <span className="cherrypick-insp-time badge badge-dark">
              {f
                ? `${fmtDuration(f.t) || '0:00'} / ${fmtDuration(s.duration) || '0:00'}`
                : ['Cover', fmtDuration(s.duration)]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          )}
        </div>
        {n ? (
          <Scrubber sheet={sheet} frame={frame} setFrame={setFrame} />
        ) : sheet === NONE ? (
          <p className="small text-muted cherrypick-insp-none">
            No frames: Stash hasn&apos;t generated previews for this scene. The
            cover and details are all there is to go on.
          </p>
        ) : null}
        {hasPreview ? (
          <div className="cherrypick-insp-preview">
            <button
              type="button"
              className="btn btn-secondary btn-sm cherrypick-preview-btn"
              onClick={() => setPlaying(!playing)}
            >
              <Icon icon={playing ? faStop : faPlay} />
              <span>
                {playing
                  ? 'Stop the preview'
                  : `Play the ${seconds ? `${seconds} s ` : ''}preview`}
              </span>
            </button>
          </div>
        ) : null}
        {n ? (
          <div className="cherrypick-insp-grid" style={ratioOf(sheet)}>
            <button
              type="button"
              className={`cherrypick-frame cherrypick-frame-cover${frame < 0 ? ' active' : ''}`}
              onClick={() => setFrame(-1)}
              aria-label="Cover"
              aria-pressed={frame < 0}
            >
              {s.image ? (
                <img className="cherrypick-frame-img" src={s.image} alt="" />
              ) : null}
              <span className="cherrypick-frame-t badge badge-dark">Cover</span>
            </button>
            {evenly(15, n).map((i) => (
              <button
                type="button"
                key={i}
                className={`cherrypick-frame${i === frame ? ' active' : ''}`}
                onClick={() => setFrame(i)}
                aria-label={`Frame at ${fmtDuration(sheet.frames[i].t) || '0:00'}`}
                aria-pressed={i === frame}
              >
                <span
                  className="cherrypick-frame-img"
                  style={cellStyle(sheet, sheet.frames[i])}
                />
                <span className="cherrypick-frame-t badge badge-dark">
                  {fmtDuration(sheet.frames[i].t) || '0:00'}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="cherrypick-insp-info">
        <h4 className="cherrypick-insp-title">{s.title || 'Untitled scene'}</h4>
        <div className="small text-muted">{meta(s)}</div>
        <Faces db={M.db} performers={s.performers} max={Infinity} big />
        {look?.details ? <Details text={look.details} /> : null}
        <TagGroups tags={look?.tags || s.tags} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------ the dialogs' side

/**
 * The inspector's state for a match: { id, frame } or null. It belongs to
 * the pair on screen and closes when the match moves on.
 */
export function useLook(pair) {
  const [look, setLook] = React.useState(null)
  const looking =
    look && pair && (look.id === pair[0] || look.id === pair[1]) ? look : null
  return [looking, setLook]
}

const otherOf = (pair, id) => (id === pair[0] ? pair[1] : pair[0])
const stepFrame = (look, d) => ({
  ...look,
  frame: Math.max(-1, Math.min(frameCount(look.id) - 1, look.frame + d)),
})

// Keys the inspector takes from the dialog: Esc goes back to the match
// where it would pause, and Enter picks unless it presses a button
export const lookClaims = (e) =>
  e.key === 'Escape' ||
  (e.key === 'Enter' &&
    !e.target?.closest?.('button, a, input, select, textarea'))

// The inspector's keys: ←/→ frames (Shift for 10, Home and End to the ends),
// Enter picks, O the other scene, Esc back. Returns whether it took the key.
export function lookKey(key, e, { look, setLook, pair, pick }) {
  const d = e.shiftKey ? 10 : 1
  if (key === 'Escape') setLook(null)
  else if (key === 'ArrowLeft') setLook((x) => x && stepFrame(x, -d))
  else if (key === 'ArrowRight') setLook((x) => x && stepFrame(x, d))
  else if (key === 'Home') setLook((x) => x && { ...x, frame: -1 })
  else if (key === 'End') setLook((x) => x && stepFrame(x, Infinity))
  else if (key === 'Enter') pick(look.id)
  else if (key === 'o' || key === 'O')
    setLook({ id: otherOf(pair, look.id), frame: -1 })
  else return false
  return true
}

export function LookFooter({ look, setLook, pair, pick, titleOf }) {
  const other = otherOf(pair, look.id)
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary cherrypick-insp-back"
        onClick={() => setLook(null)}
      >
        <Icon icon={faChevronLeft} />
        <span>Back to the match</span>
      </button>
      <button
        type="button"
        className="btn btn-secondary cherrypick-insp-other"
        title={titleOf(other)}
        onClick={() => setLook({ id: other, frame: -1 })}
      >
        <span className="d-none d-sm-inline">The other scene</span>
        <span className="d-sm-none">Other scene</span>
      </button>
      <span className="cherrypick-footer-spacer" />
      <button
        type="button"
        className="btn btn-primary cherrypick-insp-pick"
        onClick={() => pick(look.id)}
      >
        Pick this one
      </button>
    </>
  )
}

export function LookHints({ id }) {
  useJudgeData()
  const frames = frameCount(id) > 0
  return (
    <p className="cherrypick-hints small text-muted">
      <span className="cherrypick-hints-keys">
        {frames ? (
          <>
            <kbd>←</kbd> <kbd>→</kbd> frames (<kbd>Shift</kbd> for 10) ·{' '}
          </>
        ) : null}
        <kbd>Enter</kbd> pick this one · <kbd>O</kbd> the other scene ·{' '}
        <kbd>Esc</kbd> back
      </span>
      <span className="cherrypick-hints-touch">
        {frames ? 'Drag along the bar to scrub.' : ''}
      </span>
    </p>
  )
}

export function MatchHints({ esc }) {
  return (
    <p className="cherrypick-hints small text-muted">
      <span className="cherrypick-hints-keys">
        <kbd>←</kbd> <kbd>→</kbd> pick · <kbd>1</kbd> <kbd>2</kbd> look closer ·{' '}
        <kbd>U</kbd> undo · <kbd>Esc</kbd> {esc}
      </span>
      <span className="cherrypick-hints-touch">
        Tap a cover to pick it, or a frame to look closer. Close to{' '}
        {esc === 'pause' ? 'pause' : 'go back'}.
      </span>
    </p>
  )
}
