/**
 * Home advantage, team by team - a dumbbell per club joining its away win rate
 * to its home win rate, ordered by the size of the gap.
 *
 * The whole league is shown at once on purpose. A single club's rate rests on
 * six to thirteen games and carries a wide band, so no one team is worth a
 * headline; it is the collective slope that makes the point.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadImageOrNull, withAlpha, fillRoundRect, truncateText, crestFallback,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { canPlotFortress, fortressRows, fortressHighlights, formatRate } from '../../analysis/fortress.js'

export const meta = Object.freeze({
  id: 'fortress',
  label: 'Home advantage',
  description: 'Every club, home win rate against away win rate.',
  needs: 'season',
  requiresSquad: false,
})

const AWAY_TINT = 0.3

function drawScale(ctx, size, theme, track, rows) {
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    const x = track.left + track.width * level
    const isEnd = level === 0 || level === 1
    ctx.save()
    ctx.strokeStyle = withAlpha(theme.ink, isEnd ? 0.16 : 0.08)
    ctx.lineWidth = 1
    if (!isEnd) ctx.setLineDash([4, 8])
    ctx.beginPath()
    ctx.moveTo(x, track.top)
    ctx.lineTo(x, track.bottom)
    ctx.stroke()
    ctx.restore()

    drawText(ctx, `${level * 100}%`, x, track.top - scale(size, 18), {
      size: scale(size, 18),
      weight: 600,
      family: FONTS.body,
      color: theme.inkFaint,
      align: 'center',
      baseline: 'bottom',
    })
  }
  return rows
}

export async function draw(ctx, { season, size, theme, options = {} }) {
  const blocked = canPlotFortress(season)
  if (blocked) throw new Error(blocked)

  const box = contentBox(size)
  const isStory = size.height > size.width
  const accent = resolveAccent(theme, { accent: options.accent })
  const rows = fortressRows(season, { limit: options.limit || (isStory ? 16 : 14) })
  const highlights = fortressHighlights(season)

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: season.competition.name || 'Season',
    meta: season.season.display ? `Season ${season.season.display}` : '',
    accent,
  })

  drawText(ctx, options.headline || 'Home advantage', box.left, top + scale(size, 42), {
    size: scale(size, 54), weight: 700, color: theme.ink, uppercase: true, tracking: 1,
  })

  // Key, so the two ends of every dumbbell are never ambiguous.
  const keyY = top + scale(size, 74)
  const keyGap = scale(size, 150)
  const dot = scale(size, 13)
  for (const [index, [label, colour]] of [['Away', withAlpha(accent, AWAY_TINT)], ['Home', accent]].entries()) {
    const x = box.right - keyGap * (2 - index) + scale(size, 40)
    ctx.beginPath()
    ctx.arc(x, keyY, dot, 0, Math.PI * 2)
    ctx.fillStyle = colour
    ctx.fill()
    drawText(ctx, label, x + scale(size, 22), keyY + scale(size, 1), {
      size: scale(size, 21),
      weight: 700,
      family: FONTS.body,
      color: theme.inkMuted,
      baseline: 'middle',
      tracking: 2,
      uppercase: true,
    })
  }

  // Wide enough for the long ones - "Stade Francais Paris", "Montpellier
  // Herault" - rather than truncating half the league.
  const nameWidth = scale(size, 292)
  const listTop = top + scale(size, isStory ? 170 : 138)
  const listBottom = box.bottom - scale(size, isStory ? 150 : 128)
  const rowHeight = (listBottom - listTop) / rows.length

  const track = {
    left: box.left + nameWidth,
    right: box.right - scale(size, 68),
    top: listTop,
    bottom: listBottom,
    get width() { return this.right - this.left },
  }

  drawScale(ctx, size, theme, track, rows)

  // The league's own average, so a club's gap is read against its peers.
  if (highlights.leagueHomeWinRate !== null) {
    const x = track.left + track.width * highlights.leagueHomeWinRate
    ctx.save()
    ctx.strokeStyle = withAlpha(accent, 0.55)
    ctx.lineWidth = 2
    ctx.setLineDash([2, 6])
    ctx.beginPath()
    ctx.moveTo(x, track.top)
    ctx.lineTo(x, track.bottom)
    ctx.stroke()
    ctx.restore()
  }

  const crests = await Promise.all(rows.map((row) => loadImageOrNull(row.team.logo)))
  const crestBox = Math.min(scale(size, 36), rowHeight * 0.72)
  const valueSize = Math.min(scale(size, 22), rowHeight * 0.42)

  rows.forEach((row, index) => {
    const y = listTop + index * rowHeight + rowHeight / 2

    if (index % 2 === 0) {
      fillRoundRect(ctx, box.left - scale(size, 12), y - rowHeight / 2,
        box.width + scale(size, 24), rowHeight, scale(size, 8), withAlpha(theme.ink, 0.04))
    }

    drawCrest(ctx, crests[index], box.left + crestBox / 2, y, crestBox,
      crestFallback(theme, accent, row.team.abbreviation))

    const nameOptions = { size: valueSize, weight: 600, family: FONTS.body }
    const name = truncateText(ctx, row.team.shortName, nameWidth - crestBox - scale(size, 34), nameOptions)
    drawText(ctx, name, box.left + crestBox + scale(size, 16), y, {
      ...nameOptions, color: theme.ink, baseline: 'middle',
    })

    const awayX = track.left + track.width * row.away
    const homeX = track.left + track.width * row.home
    const barHeight = Math.min(scale(size, 8), rowHeight * 0.18)

    // The connector carries the gap; a reversed gap is drawn just the same,
    // because a club that travels better is exactly the interesting case.
    fillRoundRect(ctx, Math.min(awayX, homeX), y - barHeight / 2,
      Math.abs(homeX - awayX), barHeight, barHeight / 2, withAlpha(accent, 0.35))

    for (const [x, colour] of [[awayX, withAlpha(accent, AWAY_TINT)], [homeX, accent]]) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(x, y, dot, 0, Math.PI * 2)
      ctx.fillStyle = colour
      ctx.fill()
      ctx.strokeStyle = theme.bg
      ctx.lineWidth = scale(size, 3)
      ctx.stroke()
      ctx.restore()
    }

    const gapLabel = `${row.gap >= 0 ? '+' : ''}${Math.round(row.gap * 100)}`
    drawText(ctx, gapLabel, box.right, y, {
      size: valueSize,
      weight: 700,
      color: row.gap >= 0 ? theme.ink : theme.inkMuted,
      align: 'right',
      baseline: 'middle',
    })
  })

  const captionY = box.bottom - scale(size, isStory ? 108 : 92)
  if (highlights.strongest) {
    const strongest = highlights.strongest
    const line = `${strongest.team.shortName} win ${formatRate(strongest.home)} at home and `
      + `${formatRate(strongest.away)} away`
    drawText(ctx, line, box.left, captionY, {
      size: scale(size, 25),
      weight: 600,
      family: FONTS.body,
      color: theme.inkMuted,
      baseline: 'middle',
    })
  }

  const leagueRate = highlights.leagueHomeWinRate === null
    ? ''
    : `home sides win ${formatRate(highlights.leagueHomeWinRate)}`
  drawFooter(ctx, size, theme, {
    left: [`${season.matches} matches`, leagueRate, 'gap in points'].filter(Boolean).join('  -  '),
    right: options.handle || season.competition.abbreviation || '',
  })
}
