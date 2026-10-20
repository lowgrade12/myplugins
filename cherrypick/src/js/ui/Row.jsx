// A Cherry Pick row: Stash's RecommendationRow with the same slider and cards
// as Stash's own front-page rows, so themes style it with no extra work.
// Items are model rows ({ scene } or { performer }, plus a reason); the cards
// come from Stash by id (records.js).
import { components, hooks, ReactRouterDOM } from '../runtime/api.js'
import { useStashRecords } from './records.js'

const Slider = window.PluginApi.libraries.ReactSlick.default
const { Link } = ReactRouterDOM

// Stash's own slider settings (src/core/recommendations.ts), which plugins
// cannot import.
function slidesToScroll(cards, show, isTouch) {
  if (isTouch) return 1
  return cards > show ? show : cards
}
export function sliderSettings(cards, isTouch) {
  const at = (show) => ({
    infinite: !isTouch && cards > show,
    slidesToShow: cards > show ? show : cards,
    slidesToScroll: slidesToScroll(cards, show, isTouch),
  })
  return {
    dots: !isTouch,
    arrows: !isTouch,
    speed: 300,
    variableWidth: true,
    swipeToSlide: true,
    ...at(5),
    responsive: [
      { breakpoint: 1909, settings: at(4) },
      { breakpoint: 1542, settings: at(3) },
      { breakpoint: 1170, settings: at(2) },
      { breakpoint: 801, settings: at(1) },
    ],
  }
}

const isTouch = () => window.matchMedia('(pointer: coarse)').matches

// Stash registers RecommendationRow, SceneCard and PerformerCard only once
// their lazy modules load (the front page and the lists load them), so a
// row elsewhere loads them first.
const { loadableComponents } = window.PluginApi
const NEEDED = [
  loadableComponents.FrontPage,
  loadableComponents.SceneCard,
  loadableComponents.PerformerCard,
]
export const useRowComponents = () => !hooks.useLoadComponents(NEEDED)

export function Row({ id, title, className = '', link, extra, children }) {
  const ready = useRowComponents()
  const { RecommendationRow } = components
  if (!ready || !RecommendationRow) return null
  return (
    <RecommendationRow
      className={`cherrypick-row cherrypick-row-${id} ${className}`}
      header={title}
      link={
        <div className="recommendation-row-extra">
          {extra}
          {link ? <Link to={link.to}>{link.text}</Link> : null}
        </div>
      }
    >
      {children}
    </RecommendationRow>
  )
}

// A row of Stash cards for model items. renderCard(record, item, index)
// draws one card; while Stash's records load, the row shows Stash's own
// skeleton cards so nothing jumps when they arrive. kind 'stashdb-scene':
// scenes the user does not own, whose records are the model's own.
export function CardRow({
  kind,
  items,
  renderCard,
  skeleton = 12,
  empty,
  ...row
}) {
  const fromDb = kind === 'stashdb-scene'
  const ids = (items || []).map(
    (it) => (kind === 'performer' ? it.performer : it.scene).id,
  )
  const stashRecords = useStashRecords(
    fromDb ? 'scene' : kind,
    items && !fromDb ? ids : [],
  )
  const records = fromDb ? items && items.map((it) => it.scene) : stashRecords
  const loading = !items || !records
  const skeletonClass =
    kind === 'performer' ? 'performer-skeleton' : 'scene-skeleton'
  let body
  if (loading)
    body = (
      <Slider {...sliderSettings(skeleton, isTouch())}>
        {[...Array(skeleton)].map((_, i) => (
          <div key={i} className={`${skeletonClass} skeleton-card`} />
        ))}
      </Slider>
    )
  else if (!records.length)
    body = empty ? (
      <div className="cherrypick-row-empty text-muted">{empty}</div>
    ) : null
  else {
    const byId = new Map(records.map((r) => [r.id, r]))
    body = (
      <Slider {...sliderSettings(records.length, isTouch())}>
        {items
          .map((it, i) => {
            const rec = byId.get(ids[i])
            return rec ? renderCard(rec, it, i) : null
          })
          .filter(Boolean)}
      </Slider>
    )
  }
  if (!loading && !records.length && !empty) return null
  return <Row {...row}>{body}</Row>
}

// A card hidden with Not interested, in its place for the rest of the visit,
// with Undo. Stash's card classes, so it sits in the row like any card.
export function HiddenCard({ title, onUndo }) {
  return (
    <div className="card grid-card scene-card zoom-1 cherrypick-hidden-card cherrypick-ui">
      <div className="card-section text-muted">
        <p>Hidden. You&apos;ll see less like &ldquo;{title}&rdquo;.</p>
        <button className="btn btn-sm btn-secondary" onClick={onUndo}>
          Undo
        </button>
      </div>
    </div>
  )
}
