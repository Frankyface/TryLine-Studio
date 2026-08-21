/**
 * Win probability curve - how the match swung, minute by minute.
 *
 * The probability is computed, not fetched (ESPN has no rugby win-probability
 * feed), so the footer always names the model and its sample size. A chart that
 * does not say where its numbers came from is not worth posting.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadImageOrNull, withAlpha, fillRoundRect, truncateText, crestFallback,
  contrastAccent, measureText,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import {
  buildWinProbabilityCurve, keyMoments, timelineIsComplete, FULL_TIME, DEFAULT_MODEL,
} from '../../analysis/winprob.js'
import { timelineMark } from '../format.js'
import { seriesColours } from '../series.js'
import { placeLabel } from '../labels.js'

export const meta = Object.freeze({
  id: 'winprob',
  label: 'Win probability',
  description: 'How the match swung, minute by minute.',
  needs: 'match',
  requiresSquad: false,
  // Without scoring events the curve is a flat line to 50% next to a real
  // scoreline - quietly wrong rather than absent.
  requiresTimeline: true,
})

const HALF_TIME = 40

function drawGrid(ctx, size, theme, plot) {
  // Horizontal guides at 25 / 50 / 75%.
  for (const level of [0.25, 0.5, 0.75]) {
    const y = plot.top + plot.height * (1 - level)
    const isMid = level === 0.5
    ctx.save()
    ctx.strokeStyle = withAlpha(theme.ink, isMid ? 0.28 : 0.1)
    ctx.lineWidth = isMid ? 2 : 1
    if (!isMid) ctx.setLineDash([6, 8])
    ctx.beginPath()
    ctx.moveTo(plot.left, y)
    ctx.lineTo(plot.right, y)
    ctx.stroke()
    ctx.restore()
  }

  // Half time marker.
  const halfX = plot.left + plot.width * (HALF_TIME / FULL_TIME)
  ctx.save()
  ctx.strokeStyle = withAlpha(theme.ink, 0.14)
  ctx.lineWidth = 1
  ctx.setLineDash([4, 8])
  ctx.beginPath()
  ctx.moveTo(halfX, plot.top)
  ctx.lineTo(halfX, plot.bottom)
  ctx.stroke()
  ctx.restore()

  for (const minute of [0, 20, 40, 60, 80]) {
    drawText(ctx, `${minute}'`, plot.left + plot.width * (minute / FULL_TIME), plot.bottom + scale(size, 30), {
      size: scale(size, 20),
      weight: 600,
      family: FONTS.body,
      color: theme.inkFaint,
      align: minute === 0 ? 'left' : minute === FULL_TIME ? 'right' : 'center',
    })
  }
}

/** Filled area between the curve and the 50% line, coloured by who is ahead. */
function drawCurve(ctx, curve, plot, colours, curveInk) {
  const pointAt = (point) => ({
    x: plot.left + plot.width * (point.minute / FULL_TIME),
    y: plot.top + plot.height * (1 - point.homeWin),
  })
  const midY = plot.top + plot.height * 0.5

  for (const [side, colour] of [['home', colours.home], ['away', colours.away]]) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(plot.left, side === 'home' ? plot.top : midY, plot.width - 1,
      side === 'home' ? midY - plot.top : plot.bottom - midY)
    ctx.clip()

    ctx.beginPath()
    ctx.moveTo(plot.left, midY)
    for (const point of curve) {
      const { x, y } = pointAt(point)
      ctx.lineTo(x, y)
    }
    ctx.lineTo(plot.right, midY)
    ctx.closePath()
    ctx.fillStyle = withAlpha(colour, 0.42)
    ctx.fill()
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath()
  curve.forEach((point, index) => {
    const { x, y } = pointAt(point)
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.strokeStyle = curveInk
  ctx.lineWidth = Math.max(3, plot.width * 0.004)
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.restore()
}

function drawMoments(ctx, size, theme, moments, plot, colours, curvePoints, metrics) {
  const { radius, labelSize, gap } = metrics
  const placed = []

  for (const moment of moments) {
    // Clamp to the panel: a moment at 80' otherwise hangs half outside it.
    const rawX = plot.left + plot.width * (moment.minute / FULL_TIME)
    const x = Math.min(Math.max(rawX, plot.left + radius), plot.right - radius)
    const y = plot.top + plot.height * (1 - moment.homeWin)
    const colour = moment.side === 'away' ? colours.away : colours.home

    // A try and its conversion are one moment, so the label names both.
    const marks = (moment.types || [moment.type]).map(timelineMark).filter(Boolean)
    const label = `${[...new Set(marks)].join('+')} ${moment.minute}'`
    const labelOptions = { size: labelSize, weight: 700, family: FONTS.body, tracking: 1 }
    const width = measureText(ctx, label, labelOptions)

    const spot = placeLabel({
      anchorX: x,
      anchorY: y,
      width,
      height: labelSize,
      gap,
      bounds: {
        left: plot.left, right: plot.right, top: plot.top - scale(size, 4), bottom: plot.bottom,
      },
      obstacles: placed,
      polyline: curvePoints,
    })
    placed.push(spot.rect)

    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = colour
    ctx.fill()
    ctx.strokeStyle = theme.bg
    ctx.lineWidth = scale(size, 4)
    ctx.stroke()
    ctx.restore()

    // A halo keeps the label readable wherever it had to land.
    ctx.save()
    ctx.font = `${labelOptions.weight} ${labelSize}px "${FONTS.body}", Arial, sans-serif`
    ctx.textAlign = spot.align
    ctx.textBaseline = 'middle'
    ctx.lineWidth = scale(size, 5)
    ctx.strokeStyle = withAlpha(theme.bg, 0.85)
    ctx.strokeText(label, spot.x, spot.y)
    ctx.fillStyle = theme.ink
    ctx.fillText(label, spot.x, spot.y)
    ctx.restore()
  }
}

/** Team row: crest, name, final score, and the colour key for the chart. */
function drawTeamRow(ctx, size, theme, { team, crest, colour, y, box, align }) {
  const crestBox = scale(size, 58)
  const x = align === 'right' ? box.right - crestBox / 2 : box.left + crestBox / 2
  drawCrest(ctx, crest, x, y, crestBox, {
    ...crestFallback(theme, colour, team.abbreviation),
  })

  const textX = align === 'right' ? box.right - crestBox - scale(size, 18) : box.left + crestBox + scale(size, 18)
  const nameOptions = { size: scale(size, 32), weight: 700, uppercase: true, tracking: 1 }
  const name = truncateText(ctx, team.name, scale(size, 300), nameOptions)
  drawText(ctx, name, textX, y - scale(size, 4), {
    ...nameOptions, color: theme.ink, align, baseline: 'middle',
  })

  const swatchX = align === 'right' ? textX - scale(size, 26) : textX
  fillRoundRect(ctx, swatchX, y + scale(size, 14), scale(size, 26), scale(size, 8), 999, colour)
}

/**
 * Plot geometry for the chart, exported so the stress harness measures the same
 * box the graphic draws. A second copy of these numbers silently drifts.
 *
 * The chart takes whatever is left once the fixed furniture below it is
 * accounted for; a constant height left a quarter of the story blank on the
 * 62% of matches that get no caption.
 */
export function winprobLayout(size, { showCaption = false } = {}) {
  const box = contentBox(size)
  const isStory = size.height > size.width
  const top = box.top + scale(size, 48) + scale(size, 34)

  const chartTop = top + scale(size, isStory ? 126 : 92)
  const captionSpace = scale(size, isStory ? 88 : 70)
  const footerTop = box.bottom - scale(size, 60)
  const teamRowSpace = scale(size, isStory ? 104 : 78) + scale(size, 74)
  const axisSpace = scale(size, 44)
  const chartHeight = Math.max(
    scale(size, 260),
    footerTop - chartTop - axisSpace - teamRowSpace - (showCaption ? captionSpace : 0),
  )
  const gutter = scale(size, 66)

  return {
    captionSpace,
    radius: scale(size, 11),
    labelSize: scale(size, 21),
    gap: scale(size, 15),
    plot: {
      left: box.left + gutter,
      right: box.right,
      top: chartTop,
      bottom: chartTop + chartHeight,
      width: box.right - box.left - gutter,
      height: chartHeight,
    },
  }
}

export async function draw(ctx, { match, size, theme, options = {} }) {
  const model = options.model || DEFAULT_MODEL
  const accent = resolveAccent(theme, { accent: options.accent })
  const colours = seriesColours(theme, { home: match.home, away: match.away, accent: options.accent })
  const box = contentBox(size)
  const isStory = size.height > size.width

  const curve = buildWinProbabilityCurve(match, model)
  const moments = keyMoments(match, model, isStory ? 4 : 3)
  const complete = timelineIsComplete(match)

  // Whether the comeback caption will be drawn has to be known BEFORE the plot
  // is sized, or the chart leaves a blank band wherever the caption is skipped.
  const played = match.home.score !== null && match.away.score !== null
  const isDraw = played && match.home.score === match.away.score
  const homeWon = played && match.home.score > match.away.score
  const chanceAt = (point) => (homeWon ? point.homeWin : 1 - point.homeWin)
  const lowest = played && !isDraw
    ? curve.slice(1).reduce(
      (worst, point) => (chanceAt(point) < worst.chance
        ? { chance: chanceAt(point), minute: point.minute }
        : worst),
      { chance: 1, minute: 1 },
    )
    : null
  const showCaption = Boolean(lowest)
    && lowest.chance < 0.45
    && lowest.chance < chanceAt(curve[0]) - 0.05


  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: match.round || match.season.display,
    accent,
  })

  drawText(ctx, options.headline || 'Win probability', box.left, top + scale(size, 42), {
    size: scale(size, 58), weight: 700, color: theme.ink, uppercase: true, tracking: 1,
  })

  const [homeCrest, awayCrest] = await Promise.all([
    loadImageOrNull(match.home.logo),
    loadImageOrNull(match.away.logo),
  ])

  // Final score, large, on the right of the title.
  if (played) {
    drawText(ctx, `${match.home.score}-${match.away.score}`, box.right, top + scale(size, 42), {
      size: scale(size, 58), weight: 700, color: theme.ink, align: 'right',
    })
  }

  const layout = winprobLayout(size, { showCaption })
  const { plot, captionSpace } = layout

  // Y axis: who the top and bottom of the chart belong to.
  for (const [label, y, colour] of [
    ['100%', plot.top, colours.home],
    ['50%', plot.top + plot.height / 2, theme.inkFaint],
    ['100%', plot.bottom, colours.away],
  ]) {
    drawText(ctx, label, plot.left - scale(size, 14), y, {
      size: scale(size, 19),
      weight: 700,
      family: FONTS.body,
      color: colour === theme.inkFaint ? theme.inkFaint : contrastAccent(colour, theme.bg, { fallback: theme.ink }),
      align: 'right',
      baseline: 'middle',
    })
  }

  fillRoundRect(ctx, plot.left, plot.top, plot.width, plot.height, scale(size, 8),
    withAlpha(theme.ink, 0.03))
  const curvePoints = curve.map((point) => ({
    x: plot.left + plot.width * (point.minute / FULL_TIME),
    y: plot.top + plot.height * (1 - point.homeWin),
  }))

  drawGrid(ctx, size, theme, plot)
  drawCurve(ctx, curve, plot, colours, theme.ink)
  drawMoments(ctx, size, theme, moments, plot, colours, curvePoints, layout)

  const rowsTop = plot.bottom + scale(size, isStory ? 104 : 78)
  drawTeamRow(ctx, size, theme, {
    team: match.home, crest: homeCrest, colour: colours.home, y: rowsTop, box, align: 'left',
  })
  drawTeamRow(ctx, size, theme, {
    team: match.away, crest: awayCrest, colour: colours.away, y: rowsTop, box, align: 'right',
  })

  if (showCaption) {
    const winner = homeWon ? match.home : match.away
    const line = `${winner.shortName} were down to ${Math.round(lowest.chance * 100)}% at ${lowest.minute}'`
    drawText(ctx, line, box.centerX, rowsTop + captionSpace, {
      size: scale(size, 26),
      weight: 600,
      family: FONTS.body,
      color: theme.inkMuted,
      align: 'center',
      baseline: 'middle',
    })
  }

  const provenance = model.matches
    ? `Model fitted on ${model.matches} matches`
    : 'Model: default coefficients'
  drawFooter(ctx, size, theme, {
    left: complete ? provenance : `${provenance} - timeline incomplete`,
    right: options.handle || match.competition.abbreviation || '',
  })
}
