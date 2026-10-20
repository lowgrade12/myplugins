// Brackets: single-elimination games that feed the taste model. Bracket and
// Options beside the Performers and Scenes lists, the dialogs (setup, Set
// genders, play, Challenge round, champion, Apply), the Hall of Fame section on the plugin
// page, and the resume pill.
import { store } from '../../runtime/app.js'
import { registerDialog } from '../../ui/dialogs.jsx'
import { registerPageSection } from '../pluginPage.jsx'
import { autoApplyBracket, pauseBracket, VIEWS } from './actions.js'
import { registerListOps } from './listOps.jsx'
import { PlayDialog } from './play.jsx'
import { ChallengeDialog } from './challenge.jsx'
import { ApplyDialog, ResultDialog } from './results.jsx'
import { ClipSetup, GenderGrid, SetupSheet } from './setup.jsx'
import { HallOfFameSection } from './hallOfFamePage.jsx'

export { ResumePill } from './parts.jsx'

const OURS = new Set(Object.values(VIEWS))

export function registerBrackets() {
  registerDialog(VIEWS.setup, SetupSheet)
  registerDialog(VIEWS.clipSetup, ClipSetup)
  registerDialog(VIEWS.genders, GenderGrid)
  registerDialog(VIEWS.play, PlayDialog)
  registerDialog(VIEWS.challenge, ChallengeDialog)
  registerDialog(VIEWS.result, ResultDialog)
  registerDialog(VIEWS.apply, ApplyDialog)
  registerPageSection('hall-of-fame', 20, 'Hall of Fame', HallOfFameSection)
  registerListOps()
  // Apply bracket ratings automatically: a champion screen dismissed in any
  // way (closed, a link followed, a Champions round started, playback) but
  // for its own Challenge round or Apply sets its bracket's ratings. Undo
  // of the final pick takes the bracket out of the Hall of Fame first.
  const STAYS = new Set([VIEWS.result, VIEWS.challenge, VIEWS.apply])
  store.subscribe((next, prev) => {
    const was = prev.dialog
    if (was?.view !== VIEWS.result || next.dialog === was) return
    if (next.dialog?.id === was.id && STAYS.has(next.dialog.view)) return
    autoApplyBracket(was.id)
  })
  // Nothing during playback: a bracket dialog still open when the player
  // starts closes, and a bracket in play pauses
  store.subscribe((next, prev) => {
    if (!next.watching || prev.watching || !OURS.has(next.dialog?.view)) return
    if (next.dialog.view === VIEWS.play) pauseBracket()
    else store.set({ dialog: null })
  })
}
