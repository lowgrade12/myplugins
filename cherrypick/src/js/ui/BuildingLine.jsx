// One line during For you's (or Watch This's) first build in a browser: the
// library read page by page, then the model fitting, which takes several
// seconds on a library of tens of thousands of scenes. Later visits start
// from the browser's copy and show the skeleton alone.
import { useAppState } from './hooks.js'

const count = (n) => n.toLocaleString('en-US')

export function BuildingLine() {
  const progress = useAppState((s) => s.loadProgress)
  const library = useAppState((s) => s.library)
  if (!progress) return null
  return (
    <span className="text-muted small cherrypick-building">
      {library
        ? `Learning your taste from ${count(library.scenes.length)} scenes…`
        : `Reading your library: ${count(progress.n)} of ${count(progress.of)} ${progress.kind}…`}
    </span>
  )
}
