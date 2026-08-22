/**
 * Series colours for any two-sided chart.
 *
 * Club colours cannot be trusted to separate two series. Newcastle are #000000
 * and Sale #003366, which both resolve to near-identical blue-greys; Italy and
 * Scotland are both blue. A chart whose two areas look alike has failed at its
 * only job, so a near-neutral or too-close colour is swapped for whichever
 * palette entry sits furthest away.
 */
import { resolveAccent } from './frame.js'
import { toRgb } from './primitives.js'

const SERIES_PALETTE = Object.freeze(['#25D07A', '#F5C518', '#4FA8FF', '#FF6B7D', '#B388FF'])

/** Minimum channel spread before a colour counts as a colour rather than a grey. */
export const MIN_CHROMA = 95

/**
 * Two series must be obviously different, not merely measurably different.
 * A lower bar let theme-blue pass against navy (distance 61) and the two areas
 * still read as one colour.
 */
export const MIN_SEPARATION = 115

/** Shared parser, so a 3-digit hex expands the same way everywhere. */
const rgbOf = (hex) => toRgb(hex) || [0, 0, 0]

/** Rough perceptual distance - good enough to answer "do these look the same?". */
export function colourDistance(a, b) {
  const [r1, g1, b1] = rgbOf(a)
  const [r2, g2, b2] = rgbOf(b)
  return Math.sqrt((r1 - r2) ** 2 * 0.3 + (g1 - g2) ** 2 * 0.59 + (b1 - b2) ** 2 * 0.11)
}

/**
 * Absolute chroma - the spread between the strongest and weakest channel.
 *
 * HSV saturation is the wrong test: Sale's lifted navy (#5d7d9e) scores 0.41
 * saturation yet still reads as washed-out grey, because it is light and
 * low-chroma. Channel spread separates a real colour (#25D07A spreads 171)
 * from a tinted grey (#5d7d9e spreads 65).
 */
export function chroma(hex) {
  const [r, g, b] = rgbOf(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/**
 * A colour guaranteed to read as different from `reference`.
 *
 * The season chart drew wins in the user's accent and losses in a fixed red,
 * with a comment promising the loss colour "must survive a user-chosen accent"
 * and nothing implementing it. On the bloodwood theme the two measured 1.21:1
 * against each other, and picking a red accent made them literally the same
 * colour - an entire season in one shade, with bar direction the only thing
 * left to read it by.
 */
export function distinctFrom(colour, reference, fallbackPool = SERIES_PALETTE) {
  if (colourDistance(colour, reference) >= MIN_SEPARATION) return colour
  return fallbackPool
    .slice()
    .sort((a, b) => colourDistance(b, reference) - colourDistance(a, reference))[0]
}

/**
 * A distinguishable colour for each side of a two-series chart.
 * Keeps a team's own colour whenever it is vivid enough and far enough from
 * the other side; otherwise substitutes from the palette.
 */
export function seriesColours(theme, { home, away, accent } = {}) {
  const furthestFrom = (reference) => SERIES_PALETTE
    .slice()
    .sort((a, b) => colourDistance(b, reference) - colourDistance(a, reference))[0]

  let left = resolveAccent(theme, { accent, team: home })
  let right = resolveAccent(theme, { team: away })

  if (chroma(left) < MIN_CHROMA) left = theme.accent
  if (chroma(right) < MIN_CHROMA || colourDistance(left, right) < MIN_SEPARATION) {
    right = furthestFrom(left)
  }

  // Substituting once is not enough on its own: a colour can clear MIN_CHROMA
  // by a hair and still land within MIN_SEPARATION of the other side, so the
  // pair is re-checked and the FIRST side moved if the second could not escape.
  // NSW Waratahs (#003399) resolved to #5d7dbe - chroma 97, two above the bar -
  // and finished 114.1 from its partner, under the 115 threshold.
  if (colourDistance(left, right) < MIN_SEPARATION) {
    left = furthestFrom(right)
  }

  return { left, right, home: left, away: right }
}
