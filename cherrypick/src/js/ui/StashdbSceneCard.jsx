// A StashDB scene the user does not own, as a card in Stash's own SceneCard
// markup (card grid-card scene-card, thumbnail section, card section,
// popover buttons), so themes style it like any scene card. Stash's
// SceneCard needs a scene from the user's library, so this one is drawn
// here: the StashDB cover, title, date and studio, the reason it is shown,
// a "Not in your library" badge, and links to where to get the scene (a
// store or its studio's site) and to StashDB. Its menu has Not interested
// only.
import { components, FontAwesomeSolid, ReactRouterDOM } from '../runtime/api.js'
import { fetchedScene } from '../stashdb/layer.js'
import { stashdbPage, storeOf } from '../stashdb/queries.js'
import { CardMenu } from './CardMenu.jsx'
import { useAppState } from './hooks.js'

const { Link } = ReactRouterDOM
const { faDatabase, faExternalLinkAlt } = FontAwesomeSolid

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' }

// Stash's timestamp style: 1:02:03, 12:34
export function fmtDuration(seconds) {
  if (!seconds || seconds < 0) return null
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// scene: the model's scene (db.scenes), item: { scene, reason, key }.
// width: the grid's card width, as Stash's grids set it (none in rows).
export function StashdbSceneCard({ scene, item, rowId, width, zoom = 1 }) {
  const { Icon, TruncatedText } = components
  const endpoint = useAppState((s) => s.stashdb?.endpoint)
  const studioLocal = useAppState(
    (s) =>
      (scene.studio && s.db?.studios.get(scene.studio.id)?.localId) || null,
  )
  const store = storeOf(useAppState((s) => fetchedScene(s, scene.stashId)))
  const studioSite = store && /^studio$/i.test(store.site)
  const url = stashdbPage(endpoint, 'scenes', scene.stashId)
  const duration = fmtDuration(scene.duration)
  const icon = (i) => (Icon ? <Icon icon={i} /> : null)
  return (
    <div
      className={`card grid-card scene-card zoom-${zoom} cherrypick-card cherrypick-missing cherrypick-ui`}
      style={width ? { width: `${width}px` } : undefined}
    >
      <div className="thumbnail-section video-section">
        <a href={url} className="scene-card-link" {...EXTERNAL}>
          <div className="scene-card-preview">
            {scene.image ? (
              <img
                className="scene-card-preview-image"
                loading="lazy"
                src={scene.image}
                alt=""
              />
            ) : null}
          </div>
        </a>
        {duration ? (
          <div className="scene-specs-overlay">
            <span className="overlay-duration">{duration}</span>
          </div>
        ) : null}
        {scene.studio ? (
          <div className="studio-overlay">
            {studioLocal ? (
              <Link to={`/studios/${studioLocal}`}>{scene.studio.name}</Link>
            ) : (
              <span>{scene.studio.name}</span>
            )}
          </div>
        ) : null}
        <span className="badge badge-secondary cherrypick-missing-badge">
          Not in your library
        </span>
      </div>
      <div className="card-section">
        <a href={url} {...EXTERNAL}>
          <h5 className="card-section-title flex-aligned">
            {TruncatedText ? (
              <TruncatedText text={scene.title} lineCount={2} />
            ) : (
              scene.title
            )}
          </h5>
        </a>
        <div className="scene-card__details">
          <span className="scene-card__date">{scene.date}</span>
          {item?.reason ? (
            <div className="scene-card__description cherrypick-reason">
              {item.reason}
            </div>
          ) : null}
        </div>
      </div>
      <hr />
      <div className="card-popovers btn-group">
        {store ? (
          <a
            className="minimal btn btn-primary cherrypick-store-link"
            href={store.url}
            title={
              studioSite
                ? "The scene on its studio's site"
                : `The scene on ${store.site}`
            }
            {...EXTERNAL}
          >
            {icon(faExternalLinkAlt)}
            <span>{store.site}</span>
          </a>
        ) : null}
        <a
          className="minimal btn btn-primary cherrypick-stashdb-link"
          href={url}
          title="Open on StashDB"
          {...EXTERNAL}
        >
          {icon(faDatabase)}
          <span>StashDB</span>
        </a>
        {item ? <CardMenu item={item} rowId={rowId} /> : null}
      </div>
    </div>
  )
}
