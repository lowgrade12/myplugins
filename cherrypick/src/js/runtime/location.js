// Where the user is in Stash. Stash dispatches `stash:location` on
// PluginApi.Event whenever its router's location changes.
const listeners = new Set()
let current = { pathname: location.pathname, search: location.search }

window.PluginApi.Event.addEventListener('stash:location', (e) => {
  const loc = e.detail?.data?.location
  if (!loc) return
  const prev = current
  current = { pathname: loc.pathname, search: loc.search }
  if (prev.pathname === current.pathname && prev.search === current.search)
    return
  for (const l of listeners) l(current, prev)
})

export const onLocation = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const currentLocation = () => current

// Stash's Settings page, which loads every plugin's configuration when it
// opens and writes its copy back on any toggle.
export const inSettings = (loc = current) =>
  loc.pathname.startsWith('/settings')
export const onFrontPage = (loc = current) => loc.pathname === '/'
