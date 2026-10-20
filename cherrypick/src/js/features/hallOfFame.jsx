// The Hall of Fame row on the front page: performer cards of bracket
// champions, newest first, grouped by gender (each gender's brackets are
// separate contests). The full list lives on the plugin page.
import { components } from '../runtime/api.js'
import { CardRow } from '../ui/Row.jsx'
import { useAppState } from '../ui/hooks.js'
import { PLUGIN_ROUTE } from '../name.js'

// Distinct performer champions, grouped by gender in the order each gender
// last crowned one, newest first within a gender.
export function championIds(history) {
  const done = history
    .filter((b) => b.kind === 'performer' && b.result?.champion)
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))
  const genders = [...new Set(done.map((b) => b.gender || ''))]
  const seen = new Set()
  return genders.flatMap((g) =>
    done
      .filter((b) => (b.gender || '') === g)
      .map((b) => b.result.champion)
      .filter((id) => !seen.has(id) && seen.add(id)),
  )
}

export function HallOfFameRow({ extra }) {
  const show = useAppState((s) => s.settings.showHallOfFame)
  const history = useAppState((s) => s.brackets.history)
  const active = useAppState((s) => s.brackets.active)
  if (!show) return null
  const ids = championIds(history)
  if (!ids.length && !active) return null
  const { PerformerCard } = components
  return (
    <CardRow
      id="hall-of-fame"
      title="Hall of Fame"
      className="cherrypick-ui"
      kind="performer"
      items={ids.map((id) => ({ performer: { id } }))}
      empty="No champions yet. Settle it with a bracket on the Performers page."
      link={{ to: `${PLUGIN_ROUTE}#hall-of-fame`, text: 'View all' }}
      extra={extra}
      renderCard={(performer) => (
        <PerformerCard key={performer.id} performer={performer} />
      )}
    />
  )
}
