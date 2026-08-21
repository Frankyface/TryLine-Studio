/**
 * Attack against defence - a whole season in one frame.
 *
 * Every team plotted by points scored per game against points conceded per
 * game, with the defence axis inverted so "up and to the right" is unambiguously
 * good. The quadrant lines are the league's own averages, not round numbers, so
 * the split means something for that competition.
 *
 * Refuses to draw where the shape would mislead: a cup pool of four games or a
 * merged conference table (see canPlotSeason).
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, withAlpha, fillRoundRect, measureText, crestFallback,
  luminance,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { placeLabel } from '../labels.js'
import {
  seasonProfile, seasonBounds, seasonHighlights, canPlotSeason, QUADRANTS,
} from '../../analysis/season.js'
import { uniqueTeamLabels } from '../format.js'

export const meta = Object.freeze({
  id: 'scatter',
  label: 'Attack v defence',
  description: 'Every team in a season, plotted by what they score and concede.',
  needs: 'table',
  requiresSquad: false,
})

/** Corner captions, positioned by quadrant. */
const CORNERS = Object.freeze([
  { quadrant: QUADRANTS.DEFENSIVE, text: 'Tight but blunt', at: 'top-left' },
  { quadrant: QUADRANTS.ELITE, text: 'Score more, concede less', at: 'top-right' },
  { quadrant: QUADRANTS.STRUGGLING, text: 'Outscored, outdefended', at: 'bottom-left' },
  { quadrant: QUADRANTS.ATTACKING, text: 'All-out attack', at: 'bottom-right' },
])

function drawQuadrants(ctx, size, theme, plot, position, averages) {
  const midX = position.x(averages.attack)
  const midY = position.y(averages.defence)

  ctx.save()
  ctx.strokeStyle = withAlpha(theme.ink, 0.18)
  ctx.lineWidth = 2
  ctx.setLineDash([6, 8])
  ctx.beginPath()
  ctx.moveTo(midX, plot.top)
  ctx.lineTo(midX, plot.bottom)
  ctx.moveTo(plot.left, midY)
  ctx.lineTo(plot.right, midY)
  ctx.stroke()
  ctx.restore()

  const labelOptions = {
    size: scale(size, 20),
    weight: 700,
    family: FONTS.body,
    color: theme.inkFaint,
    tracking: 2,
    uppercase: true,
  }

  // Captions sit OUTSIDE the plot, above and below it. Inside, they were
  // overprinted by a crest every time - the bottom-left corner is where the
  // league's worst team lives, so something always lands on it.
  const above = plot.top - scale(size, 16)
  const below = plot.bottom + scale(size, 88)
  for (const corner of CORNERS) {
    const isTop = corner.at.startsWith('top')
    const isLeft = corner.at.endsWith('left')
    drawText(ctx, corner.text,
      isLeft ? plot.left : plot.right,
      isTop ? above : below, {
        ...labelOptions,
        align: isLeft ? 'left' : 'right',
        baseline: isTop ? 'bottom' : 'top',
      })
  }

  // Both averages are named; only the vertical one used to be.
  drawText(ctx, `avg ${averages.attack.toFixed(1)}`, midX, plot.bottom + scale(size, 26), {
    ...labelOptions, size: scale(size, 17), align: 'center', baseline: 'top', tracking: 1,
  })
  // Inside the plot, hard against the left edge: outside it collided with the
  // rotated axis title.
  drawText(ctx, `avg ${averages.defence.toFixed(1)}`, plot.left + scale(size, 10), midY - scale(size, 12), {
    ...labelOptions, size: scale(size, 17), align: 'left', baseline: 'bottom', tracking: 1,
  })
}

function drawAxes(ctx, size, theme, plot) {
  fillRoundRect(ctx, plot.left, plot.top, plot.width, plot.height,
    scale(size, 8), withAlpha(theme.ink, 0.03))

  drawText(ctx, 'Points scored per game', plot.left + plot.width / 2, plot.bottom + scale(size, 60), {
    size: scale(size, 22),
    weight: 700,
    family: FONTS.body,
    color: theme.inkMuted,
    align: 'center',
    tracking: 2,
    uppercase: true,
  })

  ctx.save()
  ctx.translate(plot.left - scale(size, 44), plot.top + plot.height / 2)
  ctx.rotate(-Math.PI / 2)
  drawText(ctx, 'Fewer conceded', 0, 0, {
    size: scale(size, 22),
    weight: 700,
    family: FONTS.body,
    color: theme.inkMuted,
    align: 'center',
    baseline: 'middle',
    tracking: 2,
    uppercase: true,
  })
  ctx.restore()
}

/**
 * Nudge overlapping marks apart, remembering where each one truly belongs.
 *
 * Teams genuinely cluster - in Top 14 five clubs sat within one marker of each
 * other and the discs became unreadable. Positions must stay honest, so a
 * displaced mark keeps a leader line back to its real point and never moves
 * further than `maxShift`.
 */
function relaxMarks(points, { radius, maxShift, bounds, rounds = 60 }) {
  const marks = points.map((point) => ({ ...point, x: point.trueX, y: point.trueY }))
  const spacing = radius * 2.05

  for (let round = 0; round < rounds; round += 1) {
    let moved = false

    for (let i = 0; i < marks.length; i += 1) {
      for (let j = i + 1; j < marks.length; j += 1) {
        const a = marks[i]
        const b = marks[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.hypot(dx, dy)

        if (distance >= spacing) continue

        // Exactly coincident: pick a deterministic direction from the index so
        // the same data always produces the same chart.
        if (distance === 0) {
          const angle = (i * 2.399) % (Math.PI * 2)
          dx = Math.cos(angle)
          dy = Math.sin(angle)
          distance = 1
        }

        const push = (spacing - distance) / 2
        const ux = (dx / distance) * push
        const uy = (dy / distance) * push
        a.x -= ux
        a.y -= uy
        b.x += ux
        b.y += uy
        moved = true
      }
    }

    // Keep every mark inside the plot and within maxShift of the truth.
    for (const mark of marks) {
      const offsetX = mark.x - mark.trueX
      const offsetY = mark.y - mark.trueY
      const drift = Math.hypot(offsetX, offsetY)
      if (drift > maxShift) {
        mark.x = mark.trueX + (offsetX / drift) * maxShift
        mark.y = mark.trueY + (offsetY / drift) * maxShift
      }
      mark.x = Math.min(Math.max(mark.x, bounds.left + radius), bounds.right - radius)
      mark.y = Math.min(Math.max(mark.y, bounds.top + radius), bounds.bottom - radius)
    }

    if (!moved) break
  }

  return marks.map((mark) => ({
    ...mark,
    displaced: Math.hypot(mark.x - mark.trueX, mark.y - mark.trueY) > radius * 0.35,
  }))
}

export async function draw(ctx, { table, size, theme, options = {} }) {
  const blocked = canPlotSeason(table)
  if (blocked) throw new Error(blocked)

  const profile = seasonProfile(table)
  const bounds = seasonBounds(profile)
  const highlights = seasonHighlights(profile)
  const accent = resolveAccent(theme, { accent: options.accent })
  const box = contentBox(size)
  const isStory = size.height > size.width

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: table.competition.name || 'Season',
    meta: table.season.display ? `Season ${table.season.display}` : '',
    accent,
  })

  drawText(ctx, options.headline || 'Attack v defence', box.left, top + scale(size, 42), {
    size: scale(size, 54), weight: 700, color: theme.ink, uppercase: true, tracking: 1,
  })

  const plotTop = top + scale(size, isStory ? 150 : 118)
  const gutter = scale(size, 72)
  const bottomSpace = scale(size, isStory ? 320 : 262)
  const plot = {
    left: box.left + gutter,
    right: box.right,
    top: plotTop,
    bottom: box.bottom - bottomSpace,
    get width() { return this.right - this.left },
    get height() { return this.bottom - this.top },
  }

  // Defence is inverted: fewer conceded sits higher up the chart.
  const position = {
    x: (attack) => plot.left
      + ((attack - bounds.attack.low) / (bounds.attack.high - bounds.attack.low)) * plot.width,
    y: (defence) => plot.top
      + ((defence - bounds.defence.low) / (bounds.defence.high - bounds.defence.low)) * plot.height,
  }

  drawAxes(ctx, size, theme, plot)
  drawQuadrants(ctx, size, theme, plot, position, profile.averages)

  const labels = uniqueTeamLabels(profile.teams.map((entry) => entry.team))

  /**
   * Above this many teams the marks crowd, and a crest at ~50px stops being
   * identifiable exactly when its label stops being clearly attached to it.
   * Lettered discs solve both at once: the label IS the mark, so there is
   * nothing to mis-attach and nothing to squint at.
   */
  const useMonogram = profile.teams.length > 12
  const crests = useMonogram
    ? profile.teams.map(() => null)
    : await Promise.all(profile.teams.map((team) => loadCrestImage(team.team.logo, scale(size, 60))))
  const crestBox = scale(size, isStory ? 60 : 52)
  const labelSize = scale(size, 20)
  const placed = []

  const radius = crestBox * (useMonogram ? 0.56 : 0.62)
  const marks = relaxMarks(
    profile.teams.map((team, index) => ({
      team,
      index,
      trueX: position.x(team.attack),
      trueY: position.y(team.defence),
    })),
    { radius, maxShift: radius * 1.6, bounds: plot },
  )

  // Leader lines first, so nothing is drawn over a mark.
  for (const mark of marks) {
    if (!mark.displaced) continue
    ctx.save()
    ctx.strokeStyle = withAlpha(theme.ink, 0.35)
    ctx.lineWidth = Math.max(1, scale(size, 2))
    ctx.beginPath()
    ctx.moveTo(mark.trueX, mark.trueY)
    ctx.lineTo(mark.x, mark.y)
    ctx.stroke()
    // A dot at the true position, so the real reading is still on the chart.
    ctx.beginPath()
    ctx.arc(mark.trueX, mark.trueY, Math.max(2, scale(size, 3)), 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(theme.ink, 0.5)
    ctx.fill()
    ctx.restore()
  }

  for (const mark of marks) {
    const { x, y } = mark
    const label = labels.get(mark.team.team.name) || mark.team.team.abbreviation || '?'

    // Uniform backing behind every mark, so the set reads as one system.
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = luminance(theme.bg) > 0.5 ? 'rgba(255,255,255,0.96)' : 'rgba(240,244,252,0.94)'
    ctx.fill()
    ctx.strokeStyle = withAlpha(theme.ink, 0.16)
    ctx.lineWidth = Math.max(1, scale(size, 2))
    ctx.stroke()
    ctx.restore()

    if (useMonogram) {
      drawText(ctx, label, x, y, {
        size: radius * (label.length > 3 ? 0.62 : 0.78),
        weight: 700,
        family: FONTS.body,
        color: '#0B1220',
        align: 'center',
        baseline: 'middle',
      })
    } else {
      drawCrest(ctx, crests[mark.index], x, y, crestBox * 0.86, {
        ...crestFallback(theme, accent, label),
        plate: null,
        solid: 'rgba(0,0,0,0)',
        ring: 'rgba(0,0,0,0)',
        ink: '#0B1220',
      })
    }

    placed.push({ left: x - radius, right: x + radius, top: y - radius, bottom: y + radius })
  }

  if (!useMonogram) marks.forEach((mark) => {
    const { x, y } = mark
    const label = labels.get(mark.team.team.name) || mark.team.team.abbreviation || '?'
    const labelOptions = { size: labelSize, weight: 700, family: FONTS.body, tracking: 1 }
    const width = measureText(ctx, label, labelOptions)

    const spot = placeLabel({
      anchorX: x,
      anchorY: y,
      width,
      height: labelSize,
      gap: crestBox * 0.52,
      bounds: { left: plot.left, right: plot.right, top: plot.top, bottom: plot.bottom },
      obstacles: placed,
    })
    placed.push(spot.rect)

    ctx.save()
    ctx.font = `700 ${labelSize}px "${FONTS.body}", Arial, sans-serif`
    ctx.textAlign = spot.align
    ctx.textBaseline = 'middle'
    ctx.lineWidth = scale(size, 5)
    ctx.strokeStyle = withAlpha(theme.bg, 0.85)
    ctx.strokeText(label, spot.x, spot.y)
    ctx.fillStyle = theme.ink
    ctx.fillText(label, spot.x, spot.y)
    ctx.restore()
  })

  // Anchored up from the footer rather than down from the plot, so the two
  // lines cannot run underneath it.
  const lineHeight = scale(size, 36)
  const captionY = box.bottom - scale(size, 78) - lineHeight
  if (highlights.bestAttack && highlights.bestDefence) {
    const lines = [
      `Best attack: ${highlights.bestAttack.team.shortName} ${highlights.bestAttack.attack.toFixed(1)} a game`,
      `Best defence: ${highlights.bestDefence.team.shortName} ${highlights.bestDefence.defence.toFixed(1)} a game`,
    ]
    lines.forEach((line, index) => {
      drawText(ctx, line, box.left, captionY + index * scale(size, 36), {
        size: scale(size, 26),
        weight: 600,
        family: FONTS.body,
        color: theme.inkMuted,
        baseline: 'middle',
      })
    })
  }

  drawFooter(ctx, size, theme, {
    left: [
      `${profile.teams.length} teams`,
      `${profile.teams[0]?.played ?? 0} games each`,
      useMonogram ? 'shown by initials' : '',
    ].filter(Boolean).join('  -  '),
    right: options.handle || table.competition.abbreviation || '',
  })
}
