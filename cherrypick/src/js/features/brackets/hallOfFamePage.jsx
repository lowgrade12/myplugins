// The Hall of Fame on the plugin page: every finished bracket by gender,
// with its champion, finalist and semifinalists, size and date, and a mark
// for a champion who won the Challenge round; Champions rounds once a
// gender has four different champions; clip champions; and the
// applied-rating batches, each with Undo.
import {
  components,
  FontAwesomeSolid,
  ReactRouterDOM,
} from '../../runtime/api.js'
import * as BR from '../../model/brackets.js'
import { championsRoundPool } from '../../model/bracketSetup.js'
import { GENDERS } from '../../model/util.js'
import { useAppState } from '../../ui/hooks.js'
import { useStashRecords } from '../../ui/records.js'
import { useRowComponents } from '../../ui/Row.jsx'
import { SettingRow } from '../pluginPage.jsx'
import { startChampionsRound } from './actions.js'
import { Icon, plural, useEntrant } from './parts.jsx'
import { AppliedButton, keptText, WINNERS_URL } from './results.jsx'

const { Link } = ReactRouterDOM
const { faCrown, faTrophy } = FontAwesomeSolid

// "Beat your favorites", beside a bracket whose champion won the Challenge
// round
function ChallengeMark({ b }) {
  if (!BR.challengeWon(b)) return null
  return (
    <span className="badge badge-warning cherrypick-challenge-badge">
      <Icon icon={faTrophy || faCrown} /> Beat your favorites
    </span>
  )
}

const day = (iso) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
const when = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

// Distinct ids, first seen first
const distinct = (ids) => [...new Set(ids.filter(Boolean))]

const names = (list) =>
  list.length <= 1
    ? list.join('')
    : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`

// Stash's own cards for the champions
function Cards({ kind, ids }) {
  const ready = useRowComponents()
  const records = useStashRecords(kind, ids)
  const { PerformerCard, SceneCard } = components
  const Card = kind === 'performer' ? PerformerCard : SceneCard
  if (!ready || !records?.length || !Card) return null
  return (
    <div className="cherrypick-hof-grid">
      {records.map((r) =>
        kind === 'performer' ? (
          <Card key={r.id} performer={r} zoomIndex={0} cardWidth={200} />
        ) : (
          <Card key={r.id} scene={r} zoomIndex={0} cardWidth={280} />
        ),
      )}
    </div>
  )
}

function GenderGroup({ gender, label, runs }) {
  const M = useAppState((s) => s.M)
  const history = useAppState((s) => s.brackets.history)
  const active = useAppState((s) => !!s.brackets.active)
  const entrant = useEntrant('performer')
  const due = M ? championsRoundPool(M, history, gender) : { size: 0 }
  return (
    <div className="cherrypick-hof-group" data-gender={gender}>
      <div className="cherrypick-hof-head">
        <h5>
          {label}{' '}
          <span className="badge badge-secondary">
            {runs.length} {plural(runs.length, 'bracket')}
          </span>
        </h5>
        {due.size ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm cherrypick-champions-round"
            disabled={active}
            title={active ? 'Finish or abandon the paused bracket first' : ''}
            onClick={() => startChampionsRound(gender)}
          >
            <Icon icon={faCrown} />
            <span>Champions round ({due.size})</span>
          </button>
        ) : (
          <span className="small text-muted">
            Champions round at {BR.CHAMPIONS_MIN} different champions
          </span>
        )}
      </div>
      <Cards
        kind="performer"
        ids={distinct(runs.map((b) => b.result.champion))}
      />
      <ul className="list-unstyled small cherrypick-hof-list">
        {runs.map((b) => {
          const semis = (b.result.semifinalists || []).map(
            (x) => entrant(x).name,
          )
          return (
            <li key={b.id}>
              <span className="text-muted">{day(b.finishedAt)}:</span>{' '}
              <b>{entrant(b.result.champion).name}</b>{' '}
              <span className="text-muted">
                {b.champions ? '(Champions round) ' : ''}beat{' '}
                {entrant(b.result.finalist).name} in the final
                {semis.length ? `; semifinalists ${names(semis)}` : ''} ·{' '}
                {b.size}
              </span>{' '}
              <ChallengeMark b={b} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ClipGroup({ runs }) {
  const entrant = useEntrant('clip')
  return (
    <div className="cherrypick-hof-group" data-kind="clip">
      <div className="cherrypick-hof-head">
        <h5>
          Scenes{' '}
          <span className="badge badge-secondary">
            {runs.length} {plural(runs.length, 'bracket')}
          </span>
        </h5>
      </div>
      <Cards kind="scene" ids={distinct(runs.map((b) => b.result.champion))} />
      <ul className="list-unstyled small cherrypick-hof-list">
        {runs.map((b) => (
          <li key={b.id}>
            <span className="text-muted">{day(b.finishedAt)}:</span>{' '}
            <b>{entrant(b.result.champion).name}</b>{' '}
            <span className="text-muted">
              beat {entrant(b.result.finalist).name} in the final ·{' '}
              {b.poolLabel} · {b.seeds.length}
            </span>{' '}
            <ChallengeMark b={b} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function AppliedBatches() {
  const applied = useAppState((s) => s.applied)
  if (!applied.length) return null
  return (
    <div className="card setting-card cherrypick-applied-batches">
      {applied
        .slice()
        .reverse()
        .map((a) => (
          <SettingRow
            key={a.id}
            title={
              a.changes.length
                ? `Applied ${a.changes.length} ${a.kind === 'performer' ? 'performer ' : ''}${plural(a.changes.length, 'rating')}`
                : keptText(a)
            }
            sub={[
              when(a.at) + (a.poolLabel ? ` · ${a.poolLabel}` : ''),
              a.changes.length ? keptText(a) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <AppliedButton a={a} className="btn btn-secondary btn-sm" />
          </SettingRow>
        ))}
    </div>
  )
}

export function HallOfFameSection() {
  const history = useAppState((s) => s.brackets.history)
  const active = useAppState((s) => s.brackets.active)
  const done = history
    .filter((b) => b.result?.champion)
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))
  const perf = done.filter((b) => b.kind === 'performer')
  const clips = done.filter((b) => b.kind === 'clip')
  return (
    <>
      {perf.length ? (
        <p className="small">
          <Link to={WINNERS_URL}>Performers who have won a bracket</Link>{' '}
          <span className="text-muted">
            (a Performers filter on the {BR.FIELDS.titles} custom field)
          </span>
        </p>
      ) : null}
      {!done.length && !active ? (
        <div className="card setting-card">
          <SettingRow
            title="No brackets yet"
            sub="Start one with Bracket on the Performers page."
          />
        </div>
      ) : null}
      {GENDERS.map(([g, label]) => {
        const runs = perf.filter((b) => b.gender === g)
        return runs.length ? (
          <GenderGroup key={g} gender={g} label={label} runs={runs} />
        ) : null
      })}
      {clips.length ? <ClipGroup runs={clips} /> : null}
      <AppliedBatches />
    </>
  )
}
