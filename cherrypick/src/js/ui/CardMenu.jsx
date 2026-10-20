// The ⋯ menu on cards in Cherry Pick's own rows: Not interested, and for
// scenes the user owns, Don't learn from this. Bootstrap's Dropdown, so
// themes style it as they style Stash's own menus.
import { Bootstrap, components, FontAwesomeSolid } from '../runtime/api.js'
import {
  isDontLearn,
  markNotInterested,
  toggleDontLearn,
} from '../runtime/actions.js'
import { useAppState } from './hooks.js'

const { Dropdown } = Bootstrap
const { faEllipsisH, faEyeSlash, faShieldAlt, faCheck } = FontAwesomeSolid

export function CardMenu({ item, rowId }) {
  const { Icon } = components
  const dontLearn = useAppState((s) => isDontLearn(s, item.scene.id))
  return (
    <Dropdown className="cherrypick-card-menu cherrypick-ui" drop="up">
      <Dropdown.Toggle
        variant="secondary"
        className="minimal"
        title="More"
        bsPrefix="btn"
      >
        <Icon icon={faEllipsisH} />
      </Dropdown.Toggle>
      <Dropdown.Menu align="right">
        <Dropdown.Item
          className="cherrypick-ni"
          onClick={() => markNotInterested(item, rowId)}
        >
          <Icon icon={faEyeSlash} /> Not interested
        </Dropdown.Item>
        {item.scene.owned ? (
          <Dropdown.Item
            className="cherrypick-dl"
            onClick={() => toggleDontLearn(item.scene)}
          >
            <Icon icon={dontLearn ? faCheck : faShieldAlt} />{' '}
            {dontLearn
              ? 'Not learning from this (undo)'
              : "Don't learn from this"}
          </Dropdown.Item>
        ) : null}
      </Dropdown.Menu>
    </Dropdown>
  )
}
