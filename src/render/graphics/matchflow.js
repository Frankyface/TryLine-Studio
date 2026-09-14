import { matchFlow, eventCounts } from '../../analysis/match-flow.js'
import { FONTS, scale } from '../theme.js'
import { drawText, drawCrest, loadCrestImage, truncateText, fillRoundRect, withAlpha, contrastAccent, pageSurface, crestFallback } from '../primitives.js'
import { drawFrame, drawEyebrow, drawFooter, contentBox, resolveAccent } from '../frame.js'
import { drawEventIcon } from '../event-icons.js'
import { seriesColours } from '../series.js'

export const meta = Object.freeze({ id: 'matchflow', label: 'Match timeline', needs: 'match',
  description: 'Scoring and card icons, with the running score every 20 minutes.', requiresMatchFlow: true })

export async function draw(ctx, { match, size, theme, options = {} }) {
  const flow = matchFlow(match)
  if (flow.reason) throw new Error(flow.reason)
  const box = contentBox(size)
  const s = (n) => scale(size, n)
  const story = size.height > size.width
  const accent = resolveAccent(theme)
  const colors = seriesColours(theme, match)
  const teamColors = { home: colors.home, away: colors.away }
  const text = (value, x, y, font = 26, extra = {}) => drawText(ctx, value, x, y,
    { size: s(font), family: FONTS.body, weight: 600, color: theme.ink, baseline: 'top', ...extra })
  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, { label: match.competition.abbreviation || match.competition.name, meta: 'Match timeline', accent })
  const title = `${match.home.score}–${match.away.score}`
  text(title, box.centerX, top, 82, { family: FONTS.display, weight: 700, align: 'center' })
  const crestY = top + s(8)
  const laneWidth = (box.width - s(190)) / 2
  const centers = { home: box.left + laneWidth / 2, away: box.right - laneWidth / 2 }
  for (const side of ['home', 'away']) {
    const crest = await loadCrestImage(match[side].logo, s(64))
    drawCrest(ctx, crest, centers[side], crestY + s(32), s(64), crestFallback(theme, teamColors[side], match[side].abbreviation, { logo: match[side].logo }))
    const name = truncateText(ctx, match[side].shortName || match[side].name, laneWidth, { size: s(28), weight: 700, family: FONTS.body })
    text(name, centers[side], top + s(90), 28, { weight: 700, align: 'center' })
  }
  text('FULL TIME', box.centerX, top + s(95), 17, { align: 'center', color: theme.inkFaint })
  const rowTop = top + s(story ? 215 : 175)
  const rowHeight = s(story ? 224 : 132)
  const laneLeft = { home: box.left + s(12), away: box.right - laneWidth + s(12) }
  const markColors = { try: null, kick: null,
    yellowCard: contrastAccent('#F5C518', pageSurface(theme), { minRatio: 3.5 }),
    redCard: contrastAccent('#E5344A', pageSurface(theme), { minRatio: 3.5 }) }
  flow.periods.forEach((period, index) => {
    const y = rowTop + index * rowHeight
    if (index % 2 === 0) fillRoundRect(ctx, box.left, y, box.width, rowHeight - s(8), s(12), withAlpha(theme.ink, 0.035))
    text(period.label, box.centerX, y + s(16), 20, { align: 'center', color: theme.inkFaint })
    text(`${period.home}–${period.away}`, box.centerX, y + s(story ? 70 : 49), 45,
      { align: 'center', family: FONTS.display, weight: 700 })
    if (index === 1 || index === 3) text(index === 1 ? '40 MINUTES' : 'FULL TIME', box.centerX, y + rowHeight - s(31), 14, { align: 'center', color: theme.inkFaint })
    for (const side of ['home', 'away']) {
      const counts = eventCounts(period.events, side)
      const marks = [ ['try', counts.try + counts.penaltyTry], ['kick', counts.conversion + counts.penalty + counts.dropGoal],
        ['yellowCard', counts.yellowCard], ['redCard', counts.redCard] ].filter(([, count]) => count)
      if (!marks.length) text('No recorded events', centers[side], y + s(story ? 83 : 47), 20, { align: 'center', color: theme.inkFaint })
      marks.forEach(([type, count], i) => {
        const x = laneLeft[side] + s(18) + i * s(79)
        drawEventIcon(ctx, type, x, y + s(story ? 88 : 48), s(30), markColors[type] || teamColors[side])
        text(String(count), x + s(23), y + s(story ? 72 : 32), 27)
      })
      const notes = [counts.penaltyTry ? `${counts.penaltyTry} PT` : '', counts.conversion ? `${counts.conversion} con` : '',
        counts.penalty ? `${counts.penalty} pen` : '', counts.dropGoal ? `${counts.dropGoal} DG` : ''].filter(Boolean).join(' · ')
      if (notes) text(notes, centers[side], y + s(story ? 140 : 90), 18, { align: 'center', color: theme.inkMuted })
    }
  })
  const legendY = box.bottom - s(105)
  ;[['try', 'Try / PT'], ['kick', 'Scoring kick'], ['yellowCard', 'Yellow'], ['redCard', 'Red']].forEach(([type, label], i) => {
    const x = box.left + i * box.width / 4 + s(17)
    drawEventIcon(ctx, type, x, legendY, s(26), markColors[type] || theme.ink)
    text(label, x + s(24), legendY - s(12), 19)
  })
  drawFooter(ctx, size, theme, { left: '20-minute groups · FT includes added time', right: options.handle || 'TryLine Studio' })
}
