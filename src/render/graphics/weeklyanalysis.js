import { weeklyFrame } from './weekly-shared.js'
import { FONTS } from '../theme.js'
import { drawCrest, loadCrestImage, truncateText, fillRoundRect, withAlpha, crestFallback } from '../primitives.js'

export const meta = Object.freeze({ id: 'weeklyanalysis', label: 'Weekly analysis', needs: 'week', description: 'Points, home and away wins, and the strongest scoring performances.' })
export async function draw(ctx, params) {
  const { week, size, theme } = params
  const { box, s, text, top, accent } = weeklyFrame(ctx, params, 'The week in numbers')
  const stats = week.stats
  const story = size.height > size.width
  const hero = top + s(story ? 45 : 0)
  text(String(stats.totalPoints), box.left, hero, 146, { family: FONTS.display, weight: 700, color: accent })
  text('POINTS SCORED', box.left, hero + s(147), 23)
  text(`${stats.averagePoints} per match`, box.right, hero + s(54), 42, { align: 'right', family: FONTS.display })
  text(`${stats.played} completed matches`, box.right, hero + s(108), 24, { align: 'right', color: theme.inkMuted })
  const stripY = hero + s(story ? 245 : 208)
  ;[['HOME WINS', stats.homeWins], ['AWAY WINS', stats.awayWins], ['DRAWS', stats.draws]].forEach(([label, value], i) => {
    const x = box.left + i * box.width / 3
    text(String(value), x, stripY, 54, { family: FONTS.display, weight: 700 })
    text(label, x, stripY + s(61), 19, { color: theme.inkMuted })
  })
  const chartTop = stripY + s(story ? 155 : 116)
  text('MOST POINTS IN A MATCH', box.left, chartTop, 22, { color: theme.inkFaint })
  const rowHeight = s(story ? 115 : 61)
  for (const [i, row] of stats.attacks.entries()) {
    const y = chartTop + s(48) + i * rowHeight
    const crest = s(32)
    drawCrest(ctx, await loadCrestImage(row.team.logo, crest), box.left + s(16), y + s(15), crest, crestFallback(theme, accent, row.team.abbreviation, { logo: row.team.logo }))
    const name = truncateText(ctx, row.team.shortName || row.team.name, s(330), { family: FONTS.body, size: s(24), weight: 600 })
    text(name, box.left + s(44), y, 24)
    const barX = box.left + box.width * 0.45
    const barRoom = box.width * 0.45
    fillRoundRect(ctx, barX, y + s(5), barRoom, s(22), s(4), withAlpha(theme.ink, 0.08))
    if (row.points) fillRoundRect(ctx, barX, y + s(5), Math.max(s(4), barRoom * row.points / Math.max(1, stats.attacks[0].points)), s(22), s(4), accent)
    text(String(row.points), box.right, y - s(2), 30, { align: 'right', family: FONTS.display, weight: 700 })
  }
}
