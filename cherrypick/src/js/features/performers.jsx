// Cherry Pick on Stash's performer pages and cards: the For you line among
// the performer's details, and a trophy, crown or medal on the photo of
// bracket champions who won a Challenge round, other champions and
// finalists.
//
// PerformerDetailsPanel renders one DetailGroup, a .detail-group holding
// every detail item, so the line goes inside it, last, in Stash's own
// detail-item markup. PerformerCard.Overlays holds the favourite heart (top
// right), the rating banner (top left), the country flag (bottom right) and,
// when Stash's "show links on performer cards" is on, the links (bottom
// left); the crown sits bottom left and steps aside for the links (CSS).
import {
  components,
  FontAwesomeSolid,
  patchAfter,
  React,
} from '../runtime/api.js'
import { Cherries } from '../ui/Cherries.jsx'
import { useAppState } from '../ui/hooks.js'
import { Safe } from '../ui/Safe.jsx'
import { honoursMark, honoursOf, performerLineFor } from './performerLine.js'

function ForYouLine({ performer, fullWidth }) {
  const show = useAppState((s) => s.settings.performerLine)
  const watching = useAppState((s) => s.watching)
  const M = useAppState((s) => s.M)
  const history = useAppState((s) => s.brackets.history)
  if (!show || watching) return null
  const text = performerLineFor(M, history, performer)
  if (!text) return null
  // Stash's DetailItem: the label, then a colon in the full-width layout.
  return (
    <div className="detail-item cherrypick-performer-line cherrypick-ui">
      <span className="detail-item-title cherrypick-performer-line">
        For you <Cherries />
        {fullWidth ? ':' : ''}
      </span>
      <span className="detail-item-value cherrypick-performer-line">
        {text}
      </span>
    </div>
  )
}

function Honours({ performer }) {
  const show = useAppState((s) => s.settings.medals)
  const history = useAppState((s) => s.brackets.history)
  if (!show) return null
  const mark = honoursMark(honoursOf(history)[performer.id])
  if (!mark) return null
  const { Icon } = components
  const { faCrown, faMedal, faTrophy } = FontAwesomeSolid
  const icon = { challenger: faTrophy || faCrown, champion: faCrown }[mark.kind]
  return (
    <div
      className={`cherrypick-honours cherrypick-ui ${icon ? 'text-warning' : 'text-light'} ${mark.kind}`}
      title={mark.title}
    >
      <Icon icon={icon || faMedal} />
      {mark.count ? <small>{mark.count}</small> : null}
    </div>
  )
}

export function registerPerformers() {
  patchAfter('PerformerDetailsPanel.DetailGroup', (props, result) => {
    if (!props.performer) return result
    const line = (
      <Safe key="cherrypick-performer-line" name="For you line">
        <ForYouLine performer={props.performer} fullWidth={props.fullWidth} />
      </Safe>
    )
    // Inside Stash's .detail-group, after its last item; beside it if
    // another plugin changed what the group renders.
    if (React.isValidElement(result) && result.type === 'div')
      return React.cloneElement(
        result,
        undefined,
        ...React.Children.toArray(result.props.children),
        line,
      )
    return (
      <>
        {result}
        {line}
      </>
    )
  })

  patchAfter('PerformerCard.Overlays', (props, result) => (
    <>
      {result}
      <Safe name="crowns and medals">
        <Honours performer={props.performer} />
      </Safe>
    </>
  ))
}
