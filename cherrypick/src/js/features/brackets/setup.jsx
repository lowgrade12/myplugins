// The setup sheets: Options beside the Performers list's Bracket (gender,
// size, pool, and the fixes when a pool can't fill 16), the Set genders
// grid, and the clip sheet beside "Bracket her scenes" and the Scenes list's
// Bracket. Each starts on 16; a size is never remembered.
import { React, ReactRouterDOM } from '../../runtime/api.js'
import * as BR from '../../model/brackets.js'
import { prefs, genderWhy, sheetChoice } from '../../model/bracketSetup.js'
import { GENDERS, genderLabel } from '../../model/util.js'
import { noGenderUrl, taggerUrl } from '../../data/listFilter.js'
import { closeDialog, openDialog } from '../../ui/dialogs.jsx'
import { useAppState } from '../../ui/hooks.js'
import {
  dominantNow,
  forgetBracketGender,
  genderOf,
  resolvePool,
  setPerformerGender,
  startClipBracket,
  startPerformerBracket,
  VIEWS,
} from './actions.js'
import { ByesNote, Dialog, lc, plural, SizePicker } from './parts.jsx'

const { Link } = ReactRouterDOM

function PausedNote() {
  const active = useAppState((s) => s.brackets.active)
  if (!active) return null
  return (
    <p className="small text-muted mt-3 mb-0">
      Starting replaces your paused bracket ({active.poolLabel},{' '}
      {lc(BR.bracketState(active).roundLabel)}).
    </p>
  )
}

// ------------------------------------------------------------ performer sheet

const POOLS = [
  ['library', 'My library', 'Everyone with a photo and a scene'],
  ['favorites', 'Favorites', 'Only your favorite performers'],
  ['filter', 'Current filter', null],
]

export function SetupSheet({ listFilter, choice: given, picked: wasPicked }) {
  const M = useAppState((s) => s.M)
  const saved = useAppState((s) => s.bracketPrefs)
  useAppState((s) => s.genderEdits)
  const lf = listFilter?.active ? listFilter : null
  const [choice, setChoice] = React.useState(() =>
    M ? sheetChoice(saved, dominantNow(), lf, given) : null,
  )
  // a gender is remembered only when the user taps a chip
  const [picked, setPicked] = React.useState(!!wasPicked)
  if (!M || !choice) return null
  const set = (p) => {
    if (p.gender) setPicked(true)
    setChoice({ ...choice, ...p })
  }
  const dominant = dominantNow()
  const r = resolvePool(choice, lf)
  const n = r.ids.length
  const size = BR.resolveSize(choice.size, n)
  const counts = Object.fromEntries(
    GENDERS.map(([g]) => [
      g,
      resolvePool({ ...choice, gender: g }, lf).ids.length,
    ]),
  )
  const noGender = BR.genderless(M, genderOf).filter(BR.eligible)
  const why = genderWhy({ choice, picked, dominant, saved, listFilter: lf })
  const start = () => startPerformerBracket({ ...choice, size }, lf, { picked })
  const toGenders = () =>
    openDialog({ view: VIEWS.genders, listFilter: lf, choice, picked })
  return (
    <Dialog
      title="Bracket options"
      onHide={closeDialog}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={closeDialog}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary cherrypick-start"
            disabled={!size}
            onClick={start}
          >
            {size ? `Start a ${size}-performer bracket` : 'Start bracket'}
          </button>
        </>
      }
    >
      <div className="cherrypick-setup">
        <h6 className="text-muted">Gender</h6>
        <div className="cherrypick-chips">
          {GENDERS.map(([g, label]) => (
            <button
              key={g}
              type="button"
              className={`btn btn-sm ${choice.gender === g ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={choice.gender === g}
              onClick={() => set({ gender: g })}
            >
              {label} <span className="badge badge-light">{counts[g]}</span>
            </button>
          ))}
        </div>
        <p className="small text-muted cherrypick-gender-why">
          {why.text}
          {why.forget ? (
            <>
              .{' '}
              <button
                type="button"
                className="btn btn-link btn-sm cherrypick-inline-link"
                onClick={() => {
                  forgetBracketGender()
                  setChoice({ ...choice, gender: dominant })
                }}
              >
                Use your largest pool ({genderLabel(dominant)})
              </button>
            </>
          ) : null}
        </p>
        {noGender.length ? (
          <p className="small text-muted cherrypick-nogender">
            {noGender.length}{' '}
            {plural(noGender.length, 'performer has', 'performers have')} no
            gender set, so brackets leave them out.{' '}
            <button
              type="button"
              className="btn btn-link btn-sm cherrypick-inline-link"
              onClick={toGenders}
            >
              Set their genders
            </button>{' '}
            or{' '}
            <Link to={noGenderUrl()} onClick={closeDialog}>
              see them in Performers
            </Link>
            .
          </p>
        ) : null}

        <SizePicker n={n} shown={size} onPick={(s) => set({ size: s })} />

        <h6 className="text-muted">Pool</h6>
        <div className="cherrypick-pools">
          {POOLS.map(([k, label, sub]) => (
            <div key={k} className="custom-control custom-radio">
              <input
                type="radio"
                className="custom-control-input"
                id={'cherrypick-pool-' + k}
                name="cherrypick-pool"
                checked={choice.pool === k}
                disabled={k === 'filter' && !lf}
                onChange={() => set({ pool: k })}
              />
              <label
                className="custom-control-label"
                htmlFor={'cherrypick-pool-' + k}
              >
                {label}{' '}
                <span className="small text-muted">
                  {k === 'filter'
                    ? lf
                      ? lf.fullLabel
                      : 'Filter the Performers list first'
                    : sub}
                </span>
              </label>
            </div>
          ))}
        </div>

        <p className="small text-muted cherrypick-new-faces">
          Performers you haven&apos;t rated play first. The ones you&apos;ve
          rated wait for the champion&apos;s optional Challenge round.
        </p>

        {!size ? (
          <PoolFixes gender={choice.gender} n={n} onSetGenders={toGenders} />
        ) : null}
        <PausedNote />
      </div>
    </Dialog>
  )
}

// When the chosen pool can't fill 16: set genders here, or fill them from
// StashDB through Stash's own performer Tagger
function PoolFixes({ gender, n, onSetGenders }) {
  const stashdb = useAppState((s) => !!s.stashdb)
  return (
    <div className="card cherrypick-fixes">
      <p className="mb-2">
        <b>
          {genderLabel(gender)} pool: {n} of {BR.DEFAULT_SIZE} needed.
        </b>{' '}
        A bracket needs {BR.DEFAULT_SIZE} performers with a photo.
      </p>
      <div className="cherrypick-fix-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSetGenders}
        >
          Set genders
        </button>
        {stashdb ? (
          <span className="cherrypick-fix-tagger">
            <Link
              className="btn btn-link"
              to={taggerUrl()}
              onClick={closeDialog}
            >
              Fill from StashDB
            </Link>
            <span className="small text-muted">
              Stash&apos;s Performer Tagger matches performers to StashDB in
              batches and fills in their gender.
            </span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ Set genders

const SHOWN = 24
const scenesOf = (p) => p.local?.scene_count ?? p.ownedSceneIds.length

export function GenderGrid({ listFilter, choice: given, picked }) {
  const M = useAppState((s) => s.M)
  const saved = useAppState((s) => s.bracketPrefs)
  useAppState((s) => s.genderEdits)
  // Who had no gender when the grid opened: cards stay put while you tap,
  // so nothing jumps under your finger
  const [ids] = React.useState(() =>
    M
      ? BR.genderless(M, genderOf)
          .slice()
          .sort((a, b) => !!b.image - !!a.image || scenesOf(b) - scenesOf(a))
          .map((p) => p.id)
      : [],
  )
  const [skipped, setSkipped] = React.useState(() => new Set())
  const [shown, setShown] = React.useState(SHOWN)
  if (!M) return null
  const choice = { ...prefs(saved, dominantNow()), ...(given || {}) }
  const r = resolvePool(choice, listFilter)
  const size = BR.resolveSize(choice.size, r.ids.length)
  const label = genderLabel(choice.gender)
  const back = () =>
    openDialog({ view: VIEWS.setup, listFilter, choice, picked })
  return (
    <Dialog
      title="Set genders"
      size="xl"
      onHide={closeDialog}
      className="cherrypick-genders"
      headerExtra={
        <span
          className={`cherrypick-pool-count badge ${size ? 'badge-success' : 'badge-secondary'}`}
          aria-live="polite"
        >
          {label} pool: {r.ids.length}
          {size ? ` · ready for ${size}` : ` of ${BR.DEFAULT_SIZE} needed`}
        </span>
      }
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={back}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary cherrypick-start"
            disabled={!size}
            onClick={() =>
              startPerformerBracket({ ...choice, size }, listFilter, {
                picked: !!picked,
              })
            }
          >
            {size ? `Start a ${size}-performer bracket` : 'Start bracket'}
          </button>
        </>
      }
    >
      <p className="text-muted small">
        Stash has no gender for these performers, so brackets leave them out.
        Tap a chip to set it in Stash. Nothing is guessed.
      </p>
      <div className="cherrypick-gender-grid">
        {ids.slice(0, shown).map((id) => {
          const p = M.db.performers.get(id)
          if (!p) return null
          const g = genderOf(p)
          const n = scenesOf(p)
          return (
            <div
              key={id}
              className={`card cherrypick-gender-card ${skipped.has(id) ? 'cherrypick-skipped' : ''}`}
            >
              <div className="cherrypick-gender-img">
                {p.local?.image_path ? (
                  <img src={p.local.image_path} alt="" loading="lazy" />
                ) : null}
              </div>
              <div className="cherrypick-gender-body">
                <div className="cherrypick-gender-name">{p.name}</div>
                <div className="small text-muted">
                  {n} {plural(n, 'scene')}
                  {p.image ? '' : ' · no photo, so not in brackets'}
                </div>
                <div className="cherrypick-gender-chips">
                  {GENDERS.map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      className={`btn btn-sm ${g === k ? 'btn-primary' : 'btn-secondary'}`}
                      aria-pressed={g === k}
                      onClick={() => {
                        if (g !== k) setPerformerGender(id, k)
                        if (skipped.has(id))
                          setSkipped(
                            new Set([...skipped].filter((x) => x !== id)),
                          )
                      }}
                    >
                      {l}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm btn-link"
                    onClick={() => setSkipped(new Set([...skipped, id]))}
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {ids.length > shown ? (
        <div className="text-center mt-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShown(shown + SHOWN)}
          >
            Show {Math.min(SHOWN, ids.length - shown)} more of{' '}
            {ids.length - shown}
          </button>
        </div>
      ) : null}
      {!ids.length ? (
        <p className="text-muted">Everyone has a gender. Nice and tidy.</p>
      ) : null}
    </Dialog>
  )
}

// ------------------------------------------------------------ clip sheet

const an = (n) => ([8, 11, 18].includes(n) ? 'an' : 'a')

// Size and pool, laid out like the performer sheet. The pool's rated
// scenes wait for the Challenge round while 4 unrated ones can play
// (clipEntrants). Fewer than 16 that play keeps 16 on and plays every one,
// some taking byes; a pool under 4 turns every size off and a card says why.
export function ClipSetup({ ids, poolLabel, poolNote, short, origin }) {
  const M = useAppState((s) => s.M)
  const [pref, setPref] = React.useState(BR.DEFAULT_SIZE)
  const n = ids.length
  const e = M ? BR.clipEntrants(M, ids).length : n
  const rated = M
    ? ids.filter((id) => BR.entrantRole(M, 'clip', id) === 'anchor').length
    : 0
  const tooFew = n < BR.MIN_CLIP_POOL
  const all = e < BR.DEFAULT_SIZE
  const shown = tooFew ? null : all ? BR.DEFAULT_SIZE : BR.resolveSize(pref, e)
  const plays = all ? e : shown
  const start = () => startClipBracket({ ids, poolLabel, origin, size: shown })
  return (
    <Dialog
      title="Bracket options"
      onHide={closeDialog}
      className="cherrypick-clip-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={closeDialog}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary cherrypick-start"
            disabled={tooFew}
            onClick={start}
          >
            {tooFew
              ? 'Start bracket'
              : `Start ${an(plays)} ${plays}-scene bracket`}
          </button>
        </>
      }
    >
      <div className="cherrypick-setup cherrypick-clip-setup">
        <SizePicker
          n={e}
          shown={shown}
          floor={BR.MIN_CLIP_POOL}
          onPick={setPref}
        />
        {all && !tooFew ? <ByesNote n={e} /> : null}

        <h6 className="text-muted">Pool</h6>
        <p className="cherrypick-clip-pool mb-0">
          {poolLabel} <span className="small text-muted">{poolNote}</span>
        </p>
        {rated ? (
          <p className="small text-muted cherrypick-new-faces">
            {e < n
              ? `${rated} ${plural(rated, "scene you've rated sits", "scenes you've rated sit")} out, and the champion can meet ${rated > BR.CHALLENGE_RUNGS ? `up to ${BR.CHALLENGE_RUNGS} of them` : rated === 1 ? 'it' : 'them'} in an optional Challenge round.`
              : `Fewer than ${BR.MIN_CLIP_POOL} scenes here have no rating of yours, so the ones you've rated play too.`}
          </p>
        ) : null}

        {tooFew ? (
          <div className="card cherrypick-fixes cherrypick-clip-short">
            <p className="mb-0">
              <b>
                {n} of {BR.MIN_CLIP_POOL} needed.
              </b>{' '}
              A scene bracket needs {BR.MIN_CLIP_POOL} scenes.
              {short ? ' ' + short : ''}
            </p>
          </div>
        ) : (
          <PausedNote />
        )}
      </div>
    </Dialog>
  )
}
