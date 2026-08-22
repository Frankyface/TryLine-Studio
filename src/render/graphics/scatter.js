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
import {
  contentBox, drawFrame, drawEyebrow, drawFooter, drawHeadline, resolveAccent,
} from '../frame.js'
import { placeLabel } from '../labels.js'
import {
  seasonProfile, seasonBounds, seasonHighlights, seasonHeadline, canPlotSeason, QUADRANTS,
} from '../../analysis/season.js'
import { uniqueTeamLabels } from '../format.js'

export const meta = Object.freeze({
  id: 'scatter',
  label: 'Attack v defence',
  description: 'Every team in a season, plotted by what they score and concede.',
  needs: 'table',
  requiresSquad: false,
  // The table has to be a whole league, not a cup pool or a half-season.
  // canPlotSeason knew that from the first commit but nothing asked it before
  // drawing, so the chip looked available on five competitions and the graphic
  // threw instead. The app caught it, but a chip that lies is the exact fault
  // blockingReason exists to prevent.
  requiresFullTable: true,
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

  // The horizontal one is safe where it is: below the plot, clear of the marks.
  // Both are NAMED because in a closed league the two averages are always
  // equal - every point scored is a point conceded - so two bare "avg 29.5"
  // labels read as a copy-paste fault rather than as two different axes.
  drawText(ctx, `avg scored ${averages.attack.toFixed(1)}`, midX, plot.bottom + scale(size, 26), {
    ...labelOptions, size: scale(size, 17), align: 'center', baseline: 'top', tracking: 1,
  })
}

/**
 * The "avg conceded" label, drawn AFTER the marks so it can dodge them.
 *
 * It sits inside the plot, because outside it collided with the rotated axis
 * title - and it used to sit blindly at the left edge, where a club level with
 * the league average printed its initials straight through it on 4 of the 28
 * real charts. Tried along the line left to right and dropped if nowhere is
 * clear: the dashed line is the average whether or not this label is drawn.
 */
function drawConcededAverage(ctx, size, theme, plot, position, averages, taken) {
  const options = {
    size: scale(size, 17), weight: 700, family: FONTS.body,
    color: theme.inkFaint, tracking: 1, uppercase: true, baseline: 'bottom',
  }
  const text = `avg conceded ${averages.defence.toFixed(1)}`
  const width = measureText(ctx, text, options)
  const y = position.y(averages.defence) - scale(size, 12)
  // Against every box already on the plot - the discs AND the outside labels
  // tethered to them, which is what it actually collided with.
  const clear = (left) => !taken.some((rect) => rect.right > left - scale(size, 6)
    && rect.left < left + width + scale(size, 6)
    && rect.bottom > y - scale(size, 20)
    && rect.top < y + scale(size, 4))

  const left = [
    plot.left + scale(size, 10),
    plot.left + plot.width / 2 - width / 2,
    plot.right - width - scale(size, 10),
  ].find(clear)
  if (left === undefined) return
  drawText(ctx, text, left, y, { ...options, align: 'left' })
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
  // 2.05 leaves the discs edge to edge - technically not overlapping, but with
  // no visible gap they read as one blob in a cluster. 2.3 gives a gap you can
  // see without pushing marks materially further from their true positions.
  const spacing = radius * 2.3

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
    // Annotated only when the mark has moved further than its own radius.
    // Below that the true point is INSIDE the disc, so a leader line has
    // nowhere to go and the anchor punches a hole through the mark - or worse,
    // through a neighbour's label. A sub-radius nudge is not a distortion
    // worth annotating; the mark is still sitting on its own reading.
    displaced: Math.hypot(mark.x - mark.trueX, mark.y - mark.trueY) > radius,
  }))
}

/** A dot at the true position, drawn last so a nudged mark cannot hide it. */
function drawAnchors(ctx, size, theme, marks) {
  for (const mark of marks) {
    if (!mark.displaced) continue
    ctx.save()
    ctx.beginPath()
    ctx.arc(mark.trueX, mark.trueY, Math.max(2, scale(size, 3)), 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(theme.ink, 0.62)
    ctx.strokeStyle = luminance(theme.bg) > 0.5 ? 'rgba(255,255,255,0.9)' : 'rgba(11,18,32,0.9)'
    ctx.lineWidth = Math.max(1, scale(size, 1.5))
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
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

  const headline = { finding: seasonHeadline(table), category: options.headline || 'Attack v defence' }
  const headlineBottom = drawHeadline(ctx, size, theme, { ...headline, top: top + scale(size, 6) })

  const plotTop = Math.max(headlineBottom + scale(size, 26), top + scale(size, isStory ? 150 : 118))
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
  const crowded = profile.teams.length > 12
  const loaded = crowded
    ? profile.teams.map(() => null)
    : await Promise.all(profile.teams.map((team) => loadCrestImage(team.team.logo, scale(size, 60))))

  // ONE mark type per chart. A crest-less club in crest mode fell back to a
  // lettered disc AND still took an outside label, so its initials appeared
  // twice within 150px, attached to two different things - and the chart drew
  // real badges beside typographic placeholders, which reads as unfinished.
  const useMonogram = crowded || loaded.some((crest) => !crest)
  const crests = useMonogram ? profile.teams.map(() => null) : loaded
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
    { radius, maxShift: radius * 1.75, bounds: plot },
  )

  // Leader lines run UNDER the discs, so they read as tethers rather than as
  // lines crossing the marks.
  for (const mark of marks) {
    if (!mark.displaced) continue
    ctx.save()
    ctx.strokeStyle = withAlpha(theme.ink, 0.35)
    ctx.lineWidth = Math.max(1, scale(size, 2))
    ctx.beginPath()
    ctx.moveTo(mark.trueX, mark.trueY)
    ctx.lineTo(mark.x, mark.y)
    ctx.stroke()
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

  // Drawn LAST, so it can step aside from the discs and from the labels
  // tethered to them - it was the tethered labels it collided with.
  drawConcededAverage(ctx, size, theme, plot, position, profile.averages, placed)

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

  // Last of all: a displaced mark sits only 1.6 radii from where it belongs,
  // so an anchor drawn before the discs was covered by its own mark 25 times
  // out of 30. Drawn last, the true reading is genuinely on the chart.
  drawAnchors(ctx, size, theme, marks)

  drawFooter(ctx, size, theme, {
    left: [
      `${profile.teams.length} teams`,
      `${profile.teams[0]?.played ?? 0} games each`,
      useMonogram ? 'shown by initials' : '',
    ].filter(Boolean).join('  -  '),
    right: options.handle || table.competition.abbreviation || '',
  })
}
