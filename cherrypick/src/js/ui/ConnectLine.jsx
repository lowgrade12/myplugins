// The one line shown where scenes you don't have would be, when Cherry Pick
// cannot look them up: Stash has no StashDB key (Connect StashDB opens the
// dialog), or the user turned StashDB off on Cherry Pick's page.
import { allowLookups } from '../stashdb/connect.js'
import { openDialog } from './dialogs.jsx'
import { useAppState } from './hooks.js'

export function ConnectLine() {
  const hasKey = useAppState((s) => !!s.stashdb?.apiKey)
  return (
    <div className="cherrypick-connect-line cherrypick-ui">
      <span className="text-muted">
        {hasKey
          ? "StashDB lookups are off, so the scenes you're missing don't show."
          : "Connect StashDB to see what you're missing."}
      </span>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() =>
          hasKey ? allowLookups() : openDialog({ view: 'connect' })
        }
      >
        {hasKey ? 'Use StashDB' : 'Connect StashDB'}
      </button>
    </div>
  )
}
