// Beside Stash Curator, whose Appeal pill also scores scene cards: an offer
// to hide Your score on cards, on Cherry Pick's page (pluginPage.jsx) and
// under its settings in Settings › Plugins (settingsExtras.jsx). It shows
// while Curator is installed and enabled, the badges switch is on and the
// user has not answered. Hide on cards turns the switch off and leaves Your
// score on scene pages; Keep both leaves it on. Either answer is kept in the
// plugin's configuration, so the offer never returns, and the switch still
// works by hand.
import { React } from '../runtime/api.js'
import { run } from '../runtime/app.js'
import { PLUGINS } from '../data/queries.js'
import { curatorEnabled, offersToHide } from '../model/curator.js'
import { useAppState } from '../ui/hooks.js'

export const OFFER = {
  title: 'Stash Curator also scores your cards',
  sub: 'Hide Your score on cards? It stays beside the stars on scene pages.',
  hide: 'Hide on cards',
  keep: 'Keep both',
}

// Whether Curator is installed and enabled, asked of Stash once `wanted`
// (null until it answers)
function useCuratorEnabled(wanted) {
  const [on, setOn] = React.useState(null)
  React.useEffect(() => {
    if (!wanted) return
    let live = true
    run(PLUGINS).then(
      ({ plugins }) => live && setOn(curatorEnabled(plugins)),
      () => live && setOn(false),
    )
    return () => {
      live = false
    }
  }, [wanted])
  return on
}

// Whether to show the offer, with the badges switch as the page shows it:
// the store's copy on Cherry Pick's page, Stash's on its Settings page.
export function useCuratorOffer(badges) {
  const loaded = useAppState((s) => s.configLoaded)
  const answer = useAppState((s) => s.curatorOffer)
  const wanted = loaded && answer == null && !!badges
  const curator = useCuratorEnabled(wanted)
  return wanted && offersToHide({ curator, badges, answer })
}
