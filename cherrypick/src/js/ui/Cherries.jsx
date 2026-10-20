// Cherry Pick's mark: a pair of cherries on stems, with a leaf, filled with
// currentColor so it takes the theme's text colour. No colour of its own:
// a red variant would ignore the theme.
const PATHS = [
  'M4 8.4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7ZM12 7.6a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7Z',
  'M3.61 8.56Q4.58 3.73 8.98 1.48L9.62 2.72Q5.82 4.67 4.99 8.84ZM11.01 8.03Q10.44 4.88 8.73 2.51L9.87 1.69Q11.76 4.32 12.39 7.77ZM9 2.4C10.3.5 12.8.2 14.8 1.3 13.4 3 10.9 3.6 9 2.4Z',
]

export function Cherries({ className = '', title }) {
  return (
    <svg
      className={`cherrypick-mark ${className}`}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {PATHS.map((d) => (
        <path key={d} fill="currentColor" d={d} />
      ))}
    </svg>
  )
}
