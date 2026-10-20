// Connecting StashDB: the key lives in Stash's own stash-box settings
// (Settings › Metadata Providers), where Stash's Tagger uses it too. Tier 1
// records only whether the user turned Cherry Pick's lookups off
// (consent.stashdbOff) and when they connected through Cherry Pick.
import { client, GQL, utils } from '../runtime/api.js'
import { run, runMutation, store } from '../runtime/app.js'
import { STASHBOX_NAME, STASHDB_ENDPOINT, withStashdbKey } from './queries.js'

const STASH_BOXES = `
  query CherryPickStashBoxes {
    configuration {
      general { stashBoxes { endpoint api_key name max_requests_per_minute } }
    }
  }
`

const VALIDATE = `
  query CherryPickValidateStashBox($input: StashBoxInput!) {
    validateStashBoxCredentials(input: $input) { valid status }
  }
`

const CONFIGURE_STASH_BOXES = `
  mutation CherryPickConfigureStashBoxes($input: ConfigGeneralInput!) {
    configureGeneral(input: $input) { stashBoxes { endpoint name } }
  }
`

// Stash asks StashDB who the key belongs to: { valid, status }, where status
// is Stash's own message ("Invalid or expired API key.").
export async function validateKey(apiKey, endpoint = STASHDB_ENDPOINT) {
  const { validateStashBoxCredentials } = await run(VALIDATE, {
    input: { endpoint, api_key: apiKey.trim(), name: STASHBOX_NAME },
  })
  return validateStashBoxCredentials
}

// Adds the key to Stash's stash-boxes, then turns lookups on.
export async function saveKey(apiKey) {
  const key = apiKey.trim()
  const { configuration } = await run(STASH_BOXES)
  const { boxes, endpoint } = withStashdbKey(
    configuration.general.stashBoxes || [],
    key,
  )
  await runMutation(CONFIGURE_STASH_BOXES, { input: { stashBoxes: boxes } })
  // Stash's pages read its cached configuration: drop it, as Stash's own
  // settings page does after a save.
  utils.StashService.evictQueries(client().cache, [GQL.ConfigurationDocument])
  allowLookups({ endpoint, apiKey: key })
}

// Lookups on: after a key is added, or when the user turns them back on.
// consent.stashdb keeps the date they were first turned on by hand.
export function allowLookups(box) {
  store.set((s) => ({
    stashdb: box || s.stashdb,
    consent: {
      ...s.consent,
      stashdb: s.consent?.stashdb || new Date().toISOString(),
      stashdbOff: null,
    },
  }))
}

// Lookups off, from Cherry Pick's page: the key stays in Stash.
export function stopLookups() {
  store.set((s) => ({
    consent: { ...s.consent, stashdbOff: new Date().toISOString() },
  }))
}
