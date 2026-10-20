// Stash Curator puts its own Appeal score on Stash's scene cards. When it is
// installed and enabled, Cherry Pick offers once to hide Your score on
// cards, so a card carries one predicted score (features/curatorOffer.js).

// Stash takes a plugin's id from its manifest's file name: Curator 0.36.0
// ships stash-curator.yml. The name covers a fork that renames the file.
const CURATOR = /^stash[\s_-]*curator\b/i

// Whether Stash Curator is installed and enabled, from Stash's `plugins`
// query.
export const curatorEnabled = (plugins) =>
  (plugins || []).some(
    (p) => p.enabled && (CURATOR.test(p.id) || CURATOR.test(p.name || '')),
  )

// The answers the offer takes, as the plugin's configuration keeps them:
// Hide on cards turns the badges switch off, Keep both leaves it on.
export const ANSWERS = ['hide', 'keep']

// Whether to offer: Curator installed and enabled (null while Stash is
// asked), Your score on cards, and no answer yet. With the switch already
// off there is nothing to hide.
export const offersToHide = ({ curator, badges, answer }) =>
  curator === true && !!badges && answer == null

// The settings an answer changes.
export const answerSettings = (answer) =>
  answer === 'hide' ? { badges: false } : {}
