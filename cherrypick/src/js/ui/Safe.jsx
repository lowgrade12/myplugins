// Every piece Cherry Pick adds to Stash's pages renders inside Safe, so an
// error in the plugin removes only that piece and never takes Stash's page
// down with it.
import { React } from '../runtime/api.js'
import { PLUGIN_ID } from '../name.js'

export class Safe extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error(
      `${PLUGIN_ID}: ${this.props.name || 'a piece'} failed and was removed`,
      error,
      info?.componentStack,
    )
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
