// The cherries in the navbar's utility area, linking to the plugin page, and
// the host for Cherry Pick's dialogs. During playback the icon keeps its
// space but hides (watching.css).
import { patchAfter, ReactRouterDOM } from '../runtime/api.js'
import { PLUGIN_NAME, PLUGIN_ROUTE } from '../name.js'
import { Cherries } from '../ui/Cherries.jsx'
import { DialogHost } from '../ui/dialogs.jsx'
import { Safe } from '../ui/Safe.jsx'

function NavIcon() {
  const { NavLink } = ReactRouterDOM
  return (
    <NavLink
      className="nav-utility cherrypick-ui cherrypick-nav-icon"
      exact
      to={PLUGIN_ROUTE}
    >
      <button
        type="button"
        className="btn minimal d-flex align-items-center h-100"
        title={PLUGIN_NAME}
      >
        <Cherries />
      </button>
    </NavLink>
  )
}

export function registerNavbar() {
  patchAfter('MainNavBar.UtilityItems', (props, result) => (
    <>
      <Safe name="navbar icon">
        <NavIcon />
      </Safe>
      {result}
      <Safe name="dialogs">
        <DialogHost />
      </Safe>
    </>
  ))
}
