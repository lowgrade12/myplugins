// Everything a bracket changes: the bracket in progress and the Hall of Fame
// (tier 1, through the store), the custom fields on placed performers
// (tier 2, once per finished bracket), genders set from the grid and the
// ratings an Apply sets (Stash's own records; never on a record another
// plugin ranks or mirrors). After each Stash write the library copy is patched so the
// model sees it at once.
import {
  patchLibraryPerformer,
  patchLibraryPerformers,
  patchLibraryScenes,
  run,
  runMutation,
  store,
} from '../../runtime/app.js'
import { PLUGINS } from '../../data/queries.js'
import * as BR from '../../model/brackets.js'
import {
  championsRoundPool,
  dominantGender,
  liveGender,
  placedIds,
  poolCounts,
  quickChoice,
  rememberedPrefs,
  resolvePerformerPool,
  restoreFieldsInput,
} from '../../model/bracketSetup.js'
import { rankingPlugins } from '../../model/rankings.js'
import { genderLabel } from '../../model/util.js'
import { openDialog } from '../../ui/dialogs.jsx'

// Dialog views (ui/dialogs.jsx): one name each
export const VIEWS = {
  setup: 'bracket-setup',
  clipSetup: 'bracket-clip-setup',
  genders: 'bracket-genders',
  play: 'bracket-play',
  challenge: 'bracket-challenge',
  result: 'bracket-result',
  apply: 'bracket-apply',
}

const PERFORMER_GENDER = `
  mutation CherryPickSetGender($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) { id gender }
  }
`
const PERFORMER_FIELDS = `
  query CherryPickBracketFields($ids: [ID!]) {
    findPerformers(ids: $ids, filter: { per_page: -1 }) {
      performers { id custom_fields }
    }
  }
`
const PERFORMER_SET_FIELDS = `
  mutation CherryPickBracketSetFields($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) { id custom_fields }
  }
`
const PERFORMER_RATINGS = `
  query CherryPickPerformerRatings($ids: [ID!]) {
    findPerformers(ids: $ids, filter: { per_page: -1 }) {
      performers { id rating100 custom_fields }
    }
  }
`
const SCENE_RATINGS = `
  query CherryPickSceneRatings($ids: [ID!]) {
    findScenes(ids: $ids, filter: { per_page: -1 }) {
      scenes { id rating100 custom_fields }
    }
  }
`
const PERFORMER_RATE = `
  mutation CherryPickRatePerformer($input: PerformerUpdateInput!) {
    performerUpdate(input: $input) { id rating100 custom_fields }
  }
`
const SCENE_RATE = `
  mutation CherryPickRateScene($input: SceneUpdateInput!) {
    sceneUpdate(input: $input) { id rating100 custom_fields }
  }
`

function reportError(e) {
  console.error('CherryPick:', e)
  store.set({ error: String(e?.message || e) })
}

// ------------------------------------------------------------ genders and pools

// A performer's gender now, with Set genders taps made since the library was read
export const genderOf = (p) => liveGender(store.get().genderEdits, p)

export const poolCountsNow = () => poolCounts(store.get().M, genderOf)
export const dominantNow = () => dominantGender(poolCountsNow())

export const resolvePool = (choice, listFilter) =>
  resolvePerformerPool(store.get().M, choice, listFilter, genderOf)

// One tap in the Set genders grid: one performerUpdate, nothing guessed. The
// pool counts follow at once; the library copy once Stash has it.
export async function setPerformerGender(id, gender) {
  const before = store.get().genderEdits || {}
  store.set((s) => ({
    genderEdits: { ...(s.genderEdits || {}), [id]: gender },
  }))
  try {
    await runMutation(PERFORMER_GENDER, { input: { id, gender } })
    patchLibraryPerformer(id, { gender })
  } catch (e) {
    store.set((s) => {
      const edits = { ...(s.genderEdits || {}) }
      if (Object.prototype.hasOwnProperty.call(before, id))
        edits[id] = before[id]
      else delete edits[id]
      return { genderEdits: edits }
    })
    reportError(e)
  }
}

// "Use your largest pool": the bracket gender follows the library again
export const forgetBracketGender = () =>
  store.set((s) => ({
    bracketPrefs: { ...(s.bracketPrefs || {}), gender: null },
  }))

// ------------------------------------------------------------ starting

function begin(b) {
  store.set((s) => ({
    brackets: { ...s.brackets, active: b },
    dialog: { view: VIEWS.play },
    lastFinished: null,
  }))
}

// remember: { picked } when the choice comes from the setup sheet (picked:
// the user tapped a gender chip); null for one click, which remembers nothing
export function startPerformerBracket(choice, listFilter, remember, origin) {
  const s = store.get()
  if (!s.M) return false
  const r = resolvePool(choice, listFilter)
  if (!r.size) return false
  if (remember)
    store.set({
      bracketPrefs: rememberedPrefs(
        choice,
        remember.picked,
        s.bracketPrefs,
        dominantNow(),
      ),
    })
  begin(
    BR.createBracket(s.M, {
      kind: 'performer',
      gender: choice.gender,
      poolLabel: r.poolLabel,
      size: r.size,
      ids: r.ids,
      origin: origin || '/performers',
      recent: BR.recentEntrants(s.brackets.history, 'performer', choice.gender),
    }),
  )
  return true
}

// The Performers list's Bracket: one click starts 16 with the default
// gender; a filtered list is the pool. A pool that can't fill 16 opens the
// setup sheet with the fixes.
export function quickStartPerformers(listFilter) {
  if (!store.get().M) return
  const choice = quickChoice(
    store.get().bracketPrefs,
    dominantNow(),
    listFilter,
  )
  if (!startPerformerBracket(choice, listFilter, null))
    openDialog({ view: VIEWS.setup, listFilter, choice })
}

export const openPerformerSetup = (listFilter) =>
  openDialog({ view: VIEWS.setup, listFilter })

// pool: { ids, poolLabel, poolNote, short, origin }
export const openClipSetup = (pool) =>
  openDialog({ view: VIEWS.clipSetup, ...pool })

// size: the size picked in the sheet (16, 32 or 64). The pool's rated
// scenes wait for the Challenge round while 4 unrated ones can play
// (clipEntrants); under 16 every scene that plays gets in, with byes.
export function startClipBracket({ ids, poolLabel, origin, size }) {
  const { M, brackets } = store.get()
  const entrants = M ? BR.clipEntrants(M, ids) : []
  const slots = M ? BR.clipSize(entrants.length, size) : null
  if (!slots) return false
  begin(
    BR.createBracket(M, {
      kind: 'clip',
      poolLabel,
      size: slots,
      ids: entrants,
      pool: ids,
      origin: origin || null,
      recent: BR.recentEntrants(brackets.history, 'clip'),
    }),
  )
  return true
}

// "Bracket her scenes" and the Scenes list's Bracket: one click starts 16
// (every scene, with byes, under 16). Under 4 the sheet opens to say why.
export function quickStartClip(pool) {
  if (!startClipBracket({ ...pool, size: BR.DEFAULT_SIZE })) openClipSetup(pool)
}

export function startChampionsRound(gender) {
  const s = store.get()
  if (!s.M) return
  const { ids, size } = championsRoundPool(s.M, s.brackets.history, gender)
  if (!size) return
  begin(
    BR.createBracket(s.M, {
      kind: 'performer',
      gender,
      poolLabel: `${genderLabel(gender)} · Champions round`,
      size,
      ids,
      champions: true,
    }),
  )
}

// ------------------------------------------------------------ playing

// Custom-field writes of finished brackets, by bracket id: the fields each
// placed performer had before (so Undo of the final can put them back)
const fieldWrites = new Map()

function finish(next, result) {
  const done = {
    ...next,
    status: 'done',
    finishedAt: new Date().toISOString(),
    result,
  }
  const challenge = BR.challengeFor(store.get().M, done, genderOf)
  const finished = challenge ? { ...done, challenge } : done
  store.set((s) => ({
    brackets: { active: null, history: [...s.brackets.history, finished] },
    lastFinished: finished.id,
    dialog: { view: VIEWS.result, id: finished.id },
  }))
  if (finished.kind === 'performer')
    fieldWrites.set(finished.id, writeFields(finished))
}

// Tier 2: one performerUpdate with a partial custom_fields per placed
// performer (quarterfinals or better, at most 8), once, now. Each write fires
// other plugins' update hooks, so never per pick.
async function writeFields(b) {
  const written = {}
  const patches = new Map()
  try {
    const { findPerformers } = await run(PERFORMER_FIELDS, {
      ids: placedIds(b.result),
    })
    const current = Object.fromEntries(
      findPerformers.performers.map((p) => [p.id, p.custom_fields || {}]),
    )
    const updates = BR.bracketFieldUpdates(current, b)
    for (const [id, partial] of Object.entries(updates)) {
      if (!current[id]) continue // no longer in Stash
      const data = await runMutation(PERFORMER_SET_FIELDS, {
        input: { id, custom_fields: { partial } },
      })
      written[id] = Object.fromEntries(
        Object.keys(partial).map((k) => [k, current[id][k] ?? null]),
      )
      patches.set(id, { custom_fields: data.performerUpdate.custom_fields })
    }
  } catch (e) {
    reportError(e)
  }
  patchLibraryPerformers(patches)
  store.set((s) => ({
    brackets: {
      ...s.brackets,
      history: s.brackets.history.map((x) =>
        x.id === b.id ? { ...x, fieldWrites: written } : x,
      ),
    },
  }))
  return written
}

// Undo of the final pick: the fields go back as they were before it
async function restoreFields(b) {
  const written = (await fieldWrites.get(b.id)) || b.fieldWrites || {}
  fieldWrites.delete(b.id)
  const patches = new Map()
  for (const [id, prev] of Object.entries(written)) {
    try {
      const data = await runMutation(PERFORMER_SET_FIELDS, {
        input: { id, custom_fields: restoreFieldsInput(prev) },
      })
      patches.set(id, { custom_fields: data.performerUpdate.custom_fields })
    } catch (e) {
      reportError(e)
    }
  }
  patchLibraryPerformers(patches)
}

function updateActive(fn) {
  const a = store.get().brackets.active
  if (!a) return
  const next = fn(a)
  if (next === a) return
  const st = BR.bracketState(next)
  if (st.done) return finish(next, st.result)
  store.set((s) => ({
    brackets: { ...s.brackets, active: { ...next, status: 'active' } },
  }))
}

export const pickWinner = (id) => updateActive((b) => BR.pick(b, id))

export function undoPick() {
  const s = store.get()
  if (s.brackets.active) return updateActive((b) => BR.undo(b))
  // straight after the final: reopen it, and put the fields back
  const last = s.brackets.history[s.brackets.history.length - 1]
  if (!last || last.id !== s.lastFinished) return
  const reopened = { ...last, championRating: null }
  delete reopened.fieldWrites
  delete reopened.result
  delete reopened.challenge
  store.set((st) => ({
    brackets: {
      active: {
        ...BR.undo(reopened),
        status: 'active',
        finishedAt: null,
      },
      history: st.brackets.history.filter((x) => x.id !== last.id),
    },
    lastFinished: null,
    dialog: { view: VIEWS.play },
  }))
  if (last.kind === 'performer') restoreFields(last)
}

// Closing the play dialog pauses; nothing is lost
export function pauseBracket() {
  store.set((s) => ({
    dialog: null,
    brackets: s.brackets.active
      ? { ...s.brackets, active: { ...s.brackets.active, status: 'paused' } }
      : s.brackets,
  }))
}
export const resumeBracket = () => openDialog({ view: VIEWS.play })

// Ends the bracket without a result: its picks stop feeding the model
export const abandonBracket = () =>
  store.set((s) => ({
    brackets: { ...s.brackets, active: null },
    dialog: null,
  }))

// ------------------------------------------------------------ the Challenge round

// A finished bracket changed in place (tier 1 keeps the Hall of Fame)
function updateFinished(id, fn) {
  store.set((s) => ({
    brackets: {
      ...s.brackets,
      history: s.brackets.history.map((x) => (x.id === id ? fn(x) : x)),
    },
  }))
}

const finishedBracket = (id) =>
  store.get().brackets.history.find((x) => x.id === id)

// Plays (or goes on with) the champion's Challenge round. A rating the
// user gave the champion by hand gives way to what the round measures.
export function startChallenge(id) {
  updateFinished(id, (b) => ({
    ...BR.skipChallenge(b, false),
    championRating: null,
  }))
  openDialog({ view: VIEWS.challenge, id })
}

// against: the anchor on screen, so a late second click is dropped. The
// pick lands on the bracket as stored then, which the custom-field write of
// the final may have changed since. Once the round is over, the champion
// screen shows how it went.
export function pickChallenge(id, winner, against) {
  const before = finishedBracket(id)
  updateFinished(id, (b) => BR.challengePick(b, winner, against))
  const after = finishedBracket(id)
  if (after !== before && BR.challengeState(after)?.done)
    openDialog({ view: VIEWS.result, id })
}

export function undoChallengePick(id) {
  updateFinished(id, BR.challengeUndo)
  openDialog({ view: VIEWS.challenge, id })
}

// Rate the champion by hand instead of the optional Challenge round
export const skipChallenge = (id) =>
  updateFinished(id, (b) => BR.skipChallenge(b))

// Closing the round mid-way keeps its picks: the champion screen offers to
// go on
export const leaveChallenge = (id) => openDialog({ view: VIEWS.result, id })

// ------------------------------------------------------------ Apply to my ratings

// Ascension, HotOrNot and Xenith, when installed and enabled: they rank from
// Stash's ratings, so Apply says that what it sets feeds them.
export async function installedRankingPlugins() {
  const { plugins } = await run(PLUGINS)
  return rankingPlugins(plugins)
}

// The records as Stash has them now: id -> { rating100, custom_fields }
async function currentRecords(kind, ids) {
  const rows =
    kind === 'performer'
      ? (await run(PERFORMER_RATINGS, { ids })).findPerformers.performers
      : (await run(SCENE_RATINGS, { ids })).findScenes.scenes
  return new Map(rows.map((x) => [x.id, x]))
}

// One write: the rating, and the provisional mark when it changes (fields:
// a custom_fields input, or null). Returns the record's new fields for the
// library copy, which the caller patches once for the whole batch.
async function setRating(kind, id, rating100, fields) {
  const input = { id, rating100, ...(fields ? { custom_fields: fields } : {}) }
  const data =
    kind === 'performer'
      ? (await runMutation(PERFORMER_RATE, { input })).performerUpdate
      : (await runMutation(SCENE_RATE, { input })).sceneUpdate
  return { rating100, custom_fields: data.custom_fields }
}

const patchRated = (kind, patches) =>
  kind === 'performer'
    ? patchLibraryPerformers(patches)
    : patchLibraryScenes(patches)

// Apply bracket ratings automatically (the autoApply setting): every rating
// a finished bracket proposes, written once its champion screen is
// dismissed (features/brackets/index.jsx), once per bracket. The batch lands
// with the others, so Cherry Pick's page can undo it.
export async function autoApplyBracket(id) {
  const s = store.get()
  const b = s.brackets.history.find((x) => x.id === id)
  if (!b || b.autoApplied || !s.M || !s.settings.autoApply) return
  updateFinished(id, (x) => ({ ...x, autoApplied: true }))
  const changes = BR.ratingProposals(s.M, b)
    .rows.filter((x) => !x.skip && x.to != null)
    .map(BR.proposedChange)
  if (changes.length) await applyRatingChanges(b, changes)
}

// The champion's stars the user gave on the champion screen, after Rate
// them myself: they replace its rating from its finish, and the rest move
// with it. Apply writes it with them.
export const setChampionRating = (bracketId, rating100) =>
  updateFinished(bracketId, (x) => ({
    ...x,
    championRating: rating100 ?? null,
  }))

// changes: [{ id, from, to, provisional, fromProvisional }] from the
// preview (BR.proposedChange). Each record is read from Stash right before
// the write, so Undo puts back exactly what was there (unrated, and the
// provisional mark, included). One another plugin started ranking or
// mirroring since the preview is left alone (the batch counts it in
// `kept`), and so is one whose rating changed since the preview (counted
// in `stale`): Apply never writes over a rating the preview didn't show.
// The batch lands in tier 1.
export async function applyRatingChanges(bracket, changes) {
  if (!changes.length) return
  const kind = bracket.kind
  const ids = changes.map((c) => c.id)
  const { write, ranked, changed } = BR.writableChanges(
    changes,
    await currentRecords(kind, ids),
  )
  const done = []
  const patches = new Map()
  try {
    for (const c of write) {
      const provisional = !!c.provisional
      patches.set(
        c.id,
        await setRating(
          kind,
          c.id,
          c.to,
          BR.provisionalFieldsInput(c.to, provisional, c.fromProvisional),
        ),
      )
      done.push({
        id: c.id,
        from: c.from,
        to: c.to,
        provisional,
        fromProvisional: c.fromProvisional,
      })
    }
  } catch (e) {
    reportError(e)
  }
  patchRated(kind, patches)
  if (!done.length && !ranked.length && !changed.length) return
  const batch = {
    id: 'a' + Date.now().toString(36),
    at: new Date().toISOString(),
    bracketId: bracket.id,
    kind,
    poolLabel: bracket.poolLabel,
    changes: done,
    kept: ranked.length,
    stale: changed.length,
  }
  store.set((s) => ({ applied: [...s.applied, batch] }))
}

// Puts each rating, and its provisional mark, back. A record another plugin
// has ranked or mirrored since keeps its rating, which is that plugin's
// score now, and so does one whose rating changed since Apply (counted in
// `changed`): Undo never writes over a rating it didn't set. The batch then
// stays, with nothing left to undo, to say so until it is dismissed.
export async function undoApplied(batchId) {
  const batch = store.get().applied.find((b) => b.id === batchId)
  if (!batch) return
  let undo = batch.changes
  let kept = batch.kept || 0
  let changed = batch.changed || 0
  if (undo.length) {
    try {
      const now = await currentRecords(
        batch.kind,
        undo.map((c) => c.id),
      )
      const still = BR.undoableChanges(undo, now)
      undo = still.write
      kept += still.ranked.length
      changed += still.changed.length
    } catch (e) {
      reportError(e)
      return
    }
  }
  const left = []
  const patches = new Map()
  for (const c of undo) {
    try {
      patches.set(
        c.id,
        await setRating(
          batch.kind,
          c.id,
          c.from ?? null,
          BR.restoreProvisionalInput(c),
        ),
      )
    } catch (e) {
      left.push(c)
      reportError(e)
    }
  }
  patchRated(batch.kind, patches)
  const stays =
    left.length || kept > (batch.kept || 0) || changed > (batch.changed || 0)
  store.set((s) => ({
    applied: stays
      ? s.applied.map((b) =>
          b.id === batchId ? { ...b, changes: left, kept, changed } : b,
        )
      : s.applied.filter((b) => b.id !== batchId),
  }))
}

// Drops a batch with nothing left to undo
export const dismissApplied = (batchId) =>
  store.set((s) => ({ applied: s.applied.filter((b) => b.id !== batchId) }))
