// The changes every piece shares: Not interested, Don't learn, For you's
// row signals and the answer to the offer beside Stash Curator. Each one is
// a store change; app.js persists it to its tier.
import { changeSettings, store } from './app.js'
import { blameKey, keyLabel } from '../model/index.js'
import { openSignals } from '../model/foryou.js'
import { answerSettings } from '../model/curator.js'

// ------------------------------------------------------------ Not interested

// item: { scene, key? } from a Cherry Pick row. key is the feature that put
// the card there (a performer, studio or tag); without one, the biggest plus
// in the scene's prediction takes the blame.
export function markNotInterested(item, rowId) {
  const { M, db } = store.get()
  const key = item.key || (M ? blameKey(M.prediction(item.scene.id)) : null)
  store.set((s) => ({
    notInterested: [
      ...s.notInterested.filter((n) => n.sceneId !== item.scene.id),
      {
        sceneId: item.scene.id,
        key,
        label: db ? keyLabel(db, key) : null,
        title: item.scene.title,
        owned: !!item.scene.owned,
        at: new Date().toISOString(),
      },
    ],
    recentHidden: [
      ...s.recentHidden,
      { sceneId: item.scene.id, rowId, title: item.scene.title },
    ],
  }))
}

export function undoNotInterested(sceneId) {
  store.set((s) => ({
    notInterested: s.notInterested.filter((n) => n.sceneId !== sceneId),
    recentHidden: s.recentHidden.filter((x) => x.sceneId !== sceneId),
  }))
}

// ------------------------------------------------------------ Don't learn

export const isDontLearn = (state, sceneId) =>
  state.dontLearn.some((d) => d.sceneId === sceneId)

// While on, the scene's plays, rating and bracket picks stay out of the
// model, and opening or passing it in For you teaches nothing.
export function toggleDontLearn(scene) {
  store.set((s) =>
    isDontLearn(s, scene.id)
      ? { dontLearn: s.dontLearn.filter((d) => d.sceneId !== scene.id) }
      : {
          dontLearn: [
            ...s.dontLearn,
            {
              sceneId: scene.id,
              title: scene.title,
              at: new Date().toISOString(),
            },
          ],
        },
  )
}

// ------------------------------------------------------------ row signals

// Opening a card from For you: a mild plus, and it no longer counts as
// passed over this visit.
export function recordOpen(sceneId) {
  const s = store.get()
  const skip = new Set(s.dontLearn.map((d) => d.sceneId))
  store.set({ signals: openSignals(s.signals, sceneId, skip) })
}

// ------------------------------------------------------------ Stash Curator

// The answer to the offer to hide Your score on cards ('hide' or 'keep'),
// kept in tier 1 so the offer never returns. Hide on cards turns the badges
// switch off. On Stash's Settings page, that page saves the switch and the
// answer (features/settingsExtras.jsx) and `stashSaves` says so; elsewhere
// Cherry Pick writes the switch over Stash's value.
export function answerCuratorOffer(answer, { stashSaves = false } = {}) {
  store.set({ curatorOffer: answer })
  const settings = answerSettings(answer)
  if (!Object.keys(settings).length) return
  if (stashSaves)
    store.set((s) => ({ settings: { ...s.settings, ...settings } }))
  else changeSettings(settings)
}
