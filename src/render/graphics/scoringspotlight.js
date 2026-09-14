import { weeklyFrame } from './weekly-shared.js'
import { FONTS } from '../theme.js'
import { drawCrest, loadCrestImage, fitTextSize, fillRoundRect, withAlpha, truncateText, crestFallback } from '../primitives.js'

export const meta = Object.freeze({ id: 'scoringspotlight', label: 'Scoring spotlight', needs: 'week', description: 'A named player’s verified scoring contribution.' })
export async function draw(ctx, params) {
  const { week, size, theme, options = {} } = params
  const player = week.spotlights[options.spotlightIndex || 0]
  if (!player) throw new Error('No verified scoring spotlight.')
  const { box, s, text, top, accent } = weeklyFrame(ctx, params, 'Scoring spotlight')
  const team = player.match[player.side]
  const story = size.height > size.width
  const nameSize = fitTextSize(ctx, player.player.name, box.width, { max: s(83), min: s(30), weight: 700, family: FONTS.display })
  text(truncateText(ctx, player.player.name, box.width, { size: nameSize, weight: 700, family: FONTS.display }), box.left, top, nameSize, { family: FONTS.display, weight: 700 })
  text(team.name, box.left, top + s(100), 28, { color: theme.inkMuted })
  const heroY = top + s(story ? 225 : 164)
  const crestSize = s(story ? 230 : 148)
  drawCrest(ctx, await loadCrestImage(team.logo, crestSize), box.right - crestSize / 2, heroY + crestSize / 2, crestSize, crestFallback(theme, accent, team.abbreviation, { logo: team.logo }))
  text(String(player.points), box.left, heroY - s(30), story ? 250 : 192, { family: FONTS.display, weight: 700, color: accent })
  text('POINTS', box.left, heroY + s(story ? 234 : 175), 27)
  const tileY = heroY + s(story ? 360 : 236)
  ;[['TRIES', player.tries], ['CONVERSIONS', player.conversions], ['PEN / DROP', player.penalties + player.dropGoals]].forEach(([label, value], i) => {
    const width = (box.width - s(32)) / 3
    const x = box.left + i * (width + s(16))
    fillRoundRect(ctx, x, tileY, width, s(story ? 170 : 117), s(12), withAlpha(theme.ink, 0.055))
    text(String(value), x + s(20), tileY + s(13), 60, { family: FONTS.display, weight: 700 })
    text(label, x + s(20), tileY + s(83), 18, { color: theme.inkMuted })
  })
  const match = player.match
  text(`${match.home.shortName} ${match.home.score}–${match.away.score} ${match.away.shortName}`,
    box.left, box.bottom - s(132), 24)
  text('Recorded scoring events · editorial selection', box.left, box.bottom - s(96), 20, { color: theme.inkFaint })
}
