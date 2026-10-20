// Cherry Pick's dialogs (bracket setup and play, Set genders, Connect
// StashDB) render from one host so they survive page changes and never show
// twice. The host sits in the navbar's utility items, which every page
// renders, inside all of Stash's providers; Stash renders those items twice
// (desktop bar and phone menu), so the first host to mount claims the role.
// react-bootstrap's Modal portals to <body>, so the dialog's place in the
// navbar does not matter.
import { React } from '../runtime/api.js'
import { store } from '../runtime/app.js'
import { useAppState } from './hooks.js'

const views = new Map()

// A feature registers its dialog views by name.
export const registerDialog = (view, Component) => views.set(view, Component)

// dialog: { view, ...props } or null
export const openDialog = (dialog) => store.set({ dialog })
export const closeDialog = () => store.set({ dialog: null })

let owner = null

export function DialogHost() {
  const [me] = React.useState(() => ({}))
  const [, claim] = React.useState(0)
  React.useEffect(() => {
    if (!owner) {
      owner = me
      claim((n) => n + 1)
    }
    return () => {
      if (owner === me) owner = null
    }
  }, [me])
  const dialog = useAppState((s) => s.dialog)
  const watching = useAppState((s) => s.watching)
  if (owner !== me || !dialog || watching) return null
  const View = views.get(dialog.view)
  return View ? <View {...dialog} /> : null
}
