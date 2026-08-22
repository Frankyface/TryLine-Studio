/**
 * One club's season as a run of margins - a bar per match, up for a win and
 * down for a loss, in the order they were played.
 *
 * This is the graphic a club posts about itself. The league-wide charts answer
 * questions about a competition; this answers "how has our season gone", which
 * is the question a club's own followers are actually asking.
 *
 * The axis is symmetric on purpose: a 20-point win and a 20-point defeat draw
 * the same length in opposite directions, so the shape of the season is read
 * from the bars rather than from a scale that flatters one side.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, withAlpha, fillRoundRect, crestFallback,
  contrastAccent, truncateText, measureText,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { uniqueTeamLabels } from '../format.js'
import { distinctFrom, chroma, MIN_CHROMA } from '../series.js'
import {
  canPlotTeamSeason, teamSeasonTimeline, teamSeasonHeadline, marginBounds, seasonScope, RESULTS,
} from '../../analysis/team-season.js'

export const meta = Object.freeze({
  id: 'teamseason',
  label: 'Season so far',
  description: 'One club, every result in order, by winning margin.',
  needs: 'season',
  requiresTeam: true,
})

/**
 * Substitutes for the loss colour when the accent is too close to red.
 *
 * Green is deliberately absent: on the bloodwood theme the accent IS red, so
 * the furthest colour from it is green - and green defeats, red wins reads
 * backwards to anyone glancing at it.
 */
const LOSS_PALETTE = Object.freeze(['#4FA8FF', '#B388FF', '#F5C518', '#FF6B7D'])

/** A drawn match has a zero margin, so it needs a visible stub of its own. */
const DRAW_STUB = 6

/** Below this many matches the bars get wide and the labels get silly. */
const WIDE_BAR_LIMIT = 14

const signed = (value) => (value > 0 ? `+${value}` : String(value))

function drawAxis(ctx, size, theme, track) {
  ctx.save()
  ctx.strokeStyle = withAlpha(theme.ink, 0.22)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(track.left, track.zero)
  ctx.lineTo(track.right, track.zero)
  ctx.stroke()
  ctx.restore()
}

export async function draw(ctx, { season, table, size, theme, options = {} }) {
  const teamName = options.team || ''
  const blocked = canPlotTeamSeason(season, teamName, { table })
  if (blocked) throw new Error(blocked)

  const timeline = teamSeasonTimeline(season, teamName)
  const headline = teamSeasonHeadline(timeline)
  const bounds = marginBounds(timeline)

  const accent = resolveAccent(theme, {
    accent: options.accent,
    team: options.useTeamColour ? timeline.team : null,
  })
  const box = contentBox(size)
  const isStory = size.height > size.width

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: timeline.competition.name || 'Season',
    meta: timeline.season.display || '',
    accent,
  })

  /* ---------- identity ---------- */

  const crest = await loadCrestImage(timeline.team.logo, scale(size, 96))
  const crestBox = scale(size, isStory ? 112 : 96)
  const nameLeft = box.left + crestBox + scale(size, 26)

  drawCrest(ctx, crest, box.left + crestBox / 2, top + crestBox / 2, crestBox,
    crestFallback(theme, accent, timeline.team.abbreviation || timeline.team.name))

  drawText(ctx, timeline.team.name, nameLeft, top + scale(size, isStory ? 44 : 38), {
    size: scale(size, isStory ? 62 : 54), weight: 700, family: FONTS.display,
    uppercase: true, color: theme.ink,
  })
  const scope = seasonScope(timeline, table)
  const record = `PLAYED ${headline.played}   WON ${headline.won}   DRAWN ${headline.drawn}   LOST ${headline.lost}`
  drawText(ctx, record, nameLeft, top + scale(size, isStory ? 96 : 82), {
    size: scale(size, isStory ? 26 : 23), weight: 600, family: FONTS.body,
    tracking: 2, uppercase: true, color: theme.inkMuted,
  })
  // Only ever drawn when the record genuinely exceeds the league table's, so
  // it states a fact rather than hedging.
  if (scope) {
    drawText(ctx, scope, nameLeft, top + scale(size, isStory ? 126 : 108), {
      size: scale(size, isStory ? 19 : 16), weight: 600, family: FONTS.body,
      tracking: 3, uppercase: true, color: theme.inkFaint,
    })
  }

  /* ---------- the run of margins ---------- */

  // Drawn first so everything above it can be anchored to the room that is
  // actually left. Offsets measured downward from the chart put the caption
  // straight through the footer on both formats.
  const footerTop = drawFooter(ctx, size, theme, {
    left: `${timeline.competition.name || ''} ${timeline.season.display || ''}`.trim(),
    right: options.handle || timeline.competition.abbreviation || '',
  })

  const captionBaseline = footerTop - scale(size, 10)
  const labelBaseline = captionBaseline - scale(size, isStory ? 44 : 36)
  const valueBaseline = labelBaseline - scale(size, isStory ? 30 : 26)
  const cellTop = valueBaseline - scale(size, isStory ? 48 : 42)

  const chartTop = top + crestBox + scale(size, isStory ? 96 : 56)
  const chartBottom = cellTop - scale(size, isStory ? 44 : 30)
  // Room for the margin number and the opponent label at each extreme.
  const gutter = scale(size, isStory ? 44 : 38)
  const plotTop = chartTop + gutter
  const plotBottom = chartBottom - gutter
  const perPoint = (plotBottom - plotTop) / (bounds.high - bounds.low)

  const track = {
    left: box.left,
    right: box.right,
    top: chartTop,
    bottom: chartBottom,
    get width() { return this.right - this.left },
    get height() { return this.bottom - this.top },
    // The zero line floats: one scale covers both directions, but centring it
    // wasted half the chart on a club that hardly ever won.
    zero: plotTop + bounds.high * perPoint,
  }

  drawAxis(ctx, size, theme, track)

  const matches = timeline.matches
  const slot = track.width / matches.length
  const barWidth = Math.min(slot * 0.62, scale(size, matches.length <= WIDE_BAR_LIMIT ? 46 : 30))

  // Losses need a colour of their own, and it has to survive a user-chosen
  // accent. Measured: on bloodwood the two read 1.21:1 against each other, and
  // a red accent made them the same colour outright - a whole season in one
  // shade. distinctFrom substitutes only when they are genuinely too close.
  // An achromatic accent (grey, white, near-black) cannot be separated from
  // anything by hue, so nothing in the palette gets far enough away from it.
  // The same rule the two-series charts use applies: too little colour to be a
  // series colour means fall back to the theme's own.
  const winColour = chroma(accent) < MIN_CHROMA ? theme.accent : accent
  const lossColour = distinctFrom(
    contrastAccent('#E5484D', theme.bg, { fallback: theme.inkMuted }),
    winColour,
    LOSS_PALETTE,
  )
  const drawColour = withAlpha(theme.ink, 0.45)

  // Deduped first: a club plays most opponents twice, and counting the same
  // abbreviation once per fixture would make every one of them look shared and
  // trigger needless disambiguation.
  const opponents = [...new Map(matches.map((match) => [match.opponent?.name, match.opponent])).values()]
  const labels = uniqueTeamLabels(opponents)

  // Measured, not guessed at a match count: whether the labels fit depends on
  // the format, the season length and how long the abbreviations turned out.
  const labelOptions = {
    size: scale(size, isStory ? 20 : 17), weight: 600, family: FONTS.body,
    tracking: 1, uppercase: true,
  }
  const widestLabel = Math.max(...[...labels.values()]
    .map((label) => measureText(ctx, label, labelOptions)))
  const rotateLabels = widestLabel > slot * 0.86

  matches.forEach((match, index) => {
    const centreX = track.left + slot * index + slot / 2
    // A draw has a zero margin and would draw nothing at all, so every bar
    // gets a floor - the same rule the comparison bars follow.
    const height = Math.max(scale(size, DRAW_STUB), Math.abs(match.margin) * perPoint)
    const isWin = match.result === RESULTS.WIN
    const isLoss = match.result === RESULTS.LOSS
    const colour = isWin ? winColour : (isLoss ? lossColour : drawColour)
    const y = isLoss ? track.zero : track.zero - height

    fillRoundRect(ctx, centreX - barWidth / 2, y, barWidth, height, scale(size, 5), colour)

    // The margin, outside the bar so a short bar never hides its own number.
    drawText(ctx, signed(match.margin), centreX,
      isLoss ? track.zero + height + scale(size, 26) : track.zero - height - scale(size, 12), {
        size: scale(size, isStory ? 22 : 19), weight: 700, family: FONTS.body,
        align: 'center', color: theme.inkMuted,
      })

    // Opponent on the opposite side of the axis from the bar, so the two never
    // collide however long the bar runs.
    const label = labels.get(match.opponent?.name) || ''
    const venue = match.venue === 'away' ? 'A' : 'H'

    if (rotateLabels) {
      // A 26-match Top 14 season leaves about 36px per slot, and adjacent
      // labels ran into each other as unreadable compounds ("CASSTA",
      // "RACBAY"). Turned on their side they always fit, and nothing is
      // dropped to make room.
      ctx.save()
      ctx.translate(centreX, isLoss ? track.zero - scale(size, 14) : track.zero + scale(size, 14))
      ctx.rotate(-Math.PI / 2)
      drawText(ctx, `${label} ${venue}`, 0, 0, {
        ...labelOptions,
        align: isLoss ? 'left' : 'right',
        baseline: 'middle',
        color: theme.inkFaint,
      })
      ctx.restore()
      return
    }

    drawText(ctx, label, centreX,
      isLoss ? track.zero - scale(size, 16) : track.zero + scale(size, 34), {
        ...labelOptions, align: 'center', color: theme.inkFaint,
      })

    // Home or away, quieter still.
    drawText(ctx, venue, centreX,
      isLoss ? track.zero - scale(size, 40) : track.zero + scale(size, 58), {
        size: scale(size, isStory ? 17 : 14), weight: 600, family: FONTS.body,
        align: 'center', color: theme.inkFaint,
      })
  })

  /* ---------- what the season adds up to ---------- */

  const cells = [
    { label: 'Points for', value: String(headline.pointsFor) },
    { label: 'Against', value: String(headline.pointsAgainst) },
    { label: 'Difference', value: signed(headline.difference) },
    { label: 'Best run', value: `${headline.longestWinStreak}W` },
  ]
  const cellWidth = box.width / cells.length

  cells.forEach((cell, index) => {
    const x = box.left + cellWidth * index
    if (index > 0) {
      ctx.save()
      ctx.strokeStyle = withAlpha(theme.ink, 0.12)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, cellTop)
      ctx.lineTo(x, labelBaseline + scale(size, 6))
      ctx.stroke()
      ctx.restore()
    }
    drawText(ctx, cell.value, x + cellWidth / 2, valueBaseline, {
      size: scale(size, isStory ? 48 : 42), weight: 700, family: FONTS.display,
      align: 'center', color: theme.ink,
    })
    drawText(ctx, cell.label, x + cellWidth / 2, labelBaseline, {
      size: scale(size, isStory ? 20 : 17), weight: 600, family: FONTS.body,
      align: 'center', tracking: 2, uppercase: true, color: theme.inkFaint,
    })
  })

  // The single most quotable line of the season, when there is one.
  if (headline.biggestWin) {
    const win = headline.biggestWin
    const caption = `BIGGEST WIN  ${win.for}-${win.against} v ${win.opponent.shortName || win.opponent.name}`
    const captionOptions = {
      size: scale(size, isStory ? 22 : 20), weight: 600, family: FONTS.body,
      tracking: 2, uppercase: true,
    }
    drawText(ctx, truncateText(ctx, caption, box.width, captionOptions),
      box.centerX, captionBaseline, {
        ...captionOptions,
        align: 'center',
        // At 0.9 alpha over a 3.5:1 accent this landed at 3.01:1. It is 20px
        // body text, so it needs the body-text bar.
        color: contrastAccent(accent, theme.bg, { minRatio: 4.5, fallback: theme.ink }),
      })
  }
}
