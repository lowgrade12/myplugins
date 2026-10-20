// The watch journey: once the scene player starts playing, every Cherry Pick
// piece on the page steps out until the user leaves the page, so nothing
// appears while someone watches or finishes a scene. Media events do not
// bubble, so this listens in the capture phase, and only to the scene
// player and Watch This's player on the front page (cards' hover previews
// are videos too). Watch This keeps its player on the page while watching
// is set and drops only the line under it (features/watchThis.jsx).
// A play in Watch This's player also marks its pick as started, so leaving
// the page does not count it ignored, and the player's playing and stopping
// give the pick's play time (runtime/watchThis.js).
import { store } from './app.js'
import { pickPlaying, pickStarted } from './watchThis.js'

const PLAYER = '.scene-player-container, .cherrypick-watch-player'
const WATCH_THIS = '.cherrypick-watch-player'

export function watchPlayback() {
  document.addEventListener(
    'play',
    (e) => {
      if (!(e.target instanceof HTMLMediaElement)) return
      if (!e.target.closest(PLAYER)) return
      if (e.target.closest(WATCH_THIS)) pickStarted()
      if (!store.get().watching) store.set({ watching: true })
    },
    true,
  )
  const playing = (on) => (e) => {
    if (e.target instanceof HTMLMediaElement && e.target.closest(WATCH_THIS))
      pickPlaying(on)
  }
  document.addEventListener('playing', playing(true), true)
  for (const type of ['pause', 'waiting', 'ended', 'emptied'])
    document.addEventListener(type, playing(false), true)
  store.subscribe((next, prev) => {
    if (next.watching !== prev.watching)
      document.body.classList.toggle('cherrypick-watching', next.watching)
  })
}
