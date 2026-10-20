// Whisparr on a "Not in your library" card, in the card's row of buttons:
// add the scene and search for it, or what Whisparr already has of it.
// Shows only while Whisparr Update is installed and enabled
// (whisparr/client.js).
import { components, FontAwesomeSolid } from '../runtime/api.js'
import { addToWhisparr, useWhisparrScene } from '../whisparr/client.js'

const {
  faCheck,
  faDownload,
  faExclamationTriangle,
  faHourglassHalf,
  faSearch,
  faSpinner,
} = FontAwesomeSolid

// What the button says and does for each state. click: whether a click
// adds (or monitors and searches again).
function view(state) {
  switch (state.kind) {
    case 'loading':
      return { icon: faSpinner, label: 'Whisparr', title: 'Asking Whisparr…', click: false, spin: true }
    case 'adding':
      return { icon: faSpinner, label: 'Adding…', title: 'Adding to Whisparr and searching', click: false, spin: true }
    case 'none':
      return { icon: faDownload, label: 'Whisparr', title: 'Add to Whisparr, monitored, and search for it', click: true }
    case 'have':
      if (state.hasFile)
        return { icon: faCheck, label: 'Downloaded', title: 'Whisparr has this scene. Stash picks it up at its next scan.', click: false, variant: 'success' }
      if (state.monitored)
        return { icon: faHourglassHalf, label: 'Wanted', title: 'Monitored in Whisparr. Click to search again.', click: true }
      return { icon: faSearch, label: 'In Whisparr', title: 'In Whisparr, not monitored. Click to monitor it and search.', click: true }
    case 'error':
    default:
      return { icon: faExclamationTriangle, label: 'Whisparr', title: `Whisparr Update: ${state.error || 'failed'}. Click to try adding again.`, click: true, variant: 'warning' }
  }
}

export function WhisparrButton({ scene }) {
  const { Icon } = components
  const state = useWhisparrScene(scene.stashId)
  if (!state) return null
  const v = view(state)
  const icon = v.icon || faDownload
  return (
    <button
      type="button"
      className={`minimal btn btn-primary cherrypick-whisparr cherrypick-whisparr-${state.kind}${v.variant ? ` text-${v.variant}` : ''}`}
      title={v.title}
      disabled={!v.click}
      onClick={() => addToWhisparr(scene.stashId, scene.title).catch(() => {})}
    >
      {Icon ? <Icon icon={icon} className={v.spin ? 'fa-spin' : undefined} /> : null}
      <span>{v.label}</span>
    </button>
  )
}
