// Your score in the rating corner of scene cards you haven't rated,
// wherever Stash draws a scene card. Stash's own RatingBanner sits in
// SceneCard.Image, so the badge goes there too, in the same markup
// (.rating-banner) so themes style it, outlined to set it apart from a real
// rating.
import { patchAfter, React } from '../runtime/api.js'
import { badgeLabel, fmtStars, unratedByYou } from '../model/index.js'
import { NAME_S } from '../name.js'
import { useModel, useSettings } from '../ui/hooks.js'
import { Safe } from '../ui/Safe.jsx'

// A Your score for this scene right now, or null: scenes the user hasn't
// rated only (another plugin's rating counts as none), once the model is
// ready and beats the user's average on held-out ratings.
export function scoreFor(M, scene, relative) {
  if (!M?.gate || !unratedByYou(M, scene)) return null
  const p = M.prediction(scene.id)
  if (!p) return null
  return { value: p.value, label: badgeLabel(M, p.value, relative) }
}

// Ascension hides the first .rating-banner on each card with inline styles,
// to put its own score in place of Stash's rating. On an unrated scene the
// only one is this badge. It sets no inline style itself, so any that
// appears comes from another plugin and is dropped.
function useNoInlineStyle() {
  const [el, ref] = React.useState(null)
  React.useEffect(() => {
    if (!el) return
    const drop = () => el.hasAttribute('style') && el.removeAttribute('style')
    drop()
    const watch = new MutationObserver(drop)
    watch.observe(el, { attributes: true, attributeFilter: ['style'] })
    return () => watch.disconnect()
  }, [el])
  return ref
}

function ScoreCorner({ scene }) {
  const M = useModel()
  const settings = useSettings()
  const ref = useNoInlineStyle()
  if (!settings.badges) return null
  const s = scoreFor(M, scene, settings.relativeBadges)
  if (!s) return null
  const r = M.reason(scene.id)
  const title = `Your score ${fmtStars(s.value)}★${r ? ': ' + r.text : ''}. ${NAME_S} guess; never written to your rating.`
  return (
    <div
      ref={ref}
      className="rating-banner cherrypick-score-banner cherrypick-ui"
      title={title}
    >
      {s.label.corner}
      {s.label.relative ? null : <span className="cherrypick-star">★</span>}
    </div>
  )
}

export function registerScoreBadge() {
  patchAfter('SceneCard.Image', (props, result) => (
    <>
      {result}
      <Safe name="score badge">
        <ScoreCorner scene={props.scene} />
      </Safe>
    </>
  ))
}
