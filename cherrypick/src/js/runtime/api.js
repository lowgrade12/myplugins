// Stash's plugin API, in one place. Stash loads plugin scripts after it sets
// window.PluginApi, so these are safe to read at module load.
const api = window.PluginApi

export const { React, ReactDOM, GQL, patch, register, hooks, utils } = api
export const { Bootstrap, Apollo, ReactRouterDOM, FontAwesomeSolid } =
  api.libraries
export const components = api.components

// What React renders as something: text, an element or portal, or a list.
// React's second argument to a component (its legacy context, {}, or a ref)
// is none of these.
const rendersSomething = (x) =>
  typeof x === 'string' ||
  typeof x === 'number' ||
  Array.isArray(x) ||
  x?.$$typeof != null

// patch.after, with fn(props, result). Stash calls an after patch with the
// arguments the before patches left and then the result, appended with
// concat (docs/stash-seams.md). So the result is not always third: a before
// patch that returns [props] alone, as Stash Curator's do, leaves it second.
// And it is not always one argument: concat spreads an array, so when an
// earlier after patch returns one, as Xenith's on MainNavBar.UtilityItems
// does, each item arrives on its own. Everything after props that React can
// render is the result.
export const patchAfter = (name, fn) =>
  patch.after(name, (props, ...rest) => {
    const items = rest.filter(rendersSomething)
    const result =
      items.length > 1
        ? React.createElement(React.Fragment, null, ...items)
        : (items[0] ?? null)
    return fn(props, result)
  })

// Stash's own Apollo client: its auth, its cache. Mutations made through it
// update Stash's cached records, so Stash's pages show what the plugin wrote.
export const client = () => utils.StashService.getClient()
export const gql = Apollo.gql

export async function query(doc, variables, fetchPolicy = 'network-only') {
  const { data } = await client().query({ query: doc, variables, fetchPolicy })
  return data
}

export async function mutate(doc, variables) {
  const { data } = await client().mutate({ mutation: doc, variables })
  return data
}
