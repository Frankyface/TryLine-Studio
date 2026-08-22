/**
 * Player stat card - one player, their shirt number, and the numbers that
 * actually happened. options.player is a player object from a squad.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, fitTextSize, withAlpha, fillRoundRect, readableInk,
  luminance, crestFallback,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { pickPlayerStats, formatMatchDate } from '../format.js'

export const meta = Object.freeze({
  id: 'statcard',
  label: 'Player card',
  description: 'One player and their match numbers.',
  needs: 'match',
  usesTeamColour: true,
  usesSide: true,
  requiresSquad: true,
  requiresPlayer: true,
  // Without stats this drew a crest, a name and 45% empty canvas, reported it
  // as fine, and let it be exported.
  requiresStats: true,
})

const COLUMNS = 2

function drawStatGrid(ctx, size, theme, { stats, x, y, width, height, accent }) {
  const rows = Math.ceil(stats.length / COLUMNS)
  const gap = scale(size, 16)
  const cellWidth = (width - gap * (COLUMNS - 1)) / COLUMNS
  const cellHeight = (height - gap * (rows - 1)) / rows

  stats.forEach((stat, index) => {
    const column = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    const cellX = x + column * (cellWidth + gap)
    const cellY = y + row * (cellHeight + gap)

    fillRoundRect(ctx, cellX, cellY, cellWidth, cellHeight, scale(size, 18), withAlpha(theme.ink, 0.05))
    fillRoundRect(ctx, cellX, cellY, scale(size, 5), cellHeight, scale(size, 4), withAlpha(accent, 0.7))

    const valueSize = Math.min(scale(size, 68), cellHeight * 0.52)
    drawText(ctx, stat.value, cellX + scale(size, 26), cellY + cellHeight * 0.56, {
      size: valueSize, weight: 700, color: theme.ink, baseline: 'middle',
    })
    drawText(ctx, stat.label, cellX + scale(size, 26), cellY + cellHeight * 0.84, {
      size: Math.min(scale(size, 21), cellHeight * 0.2),
      weight: 600,
      family: FONTS.body,
      color: theme.inkMuted,
      baseline: 'middle',
      tracking: 2,
      uppercase: true,
    })
  })
}

export async function draw(ctx, { match, size, theme, options = {} }) {
  const tz = { timeZone: options.timeZone }
  const side = options.side === 'away' ? 'away' : 'home'
  const team = match[side]
  const player = options.player || team.squad[0]
  if (!player) throw new Error('No player selected for the stat card')

  const accent = resolveAccent(theme, { accent: options.accent, team })
  const box = contentBox(size)
  const isStory = size.height > size.width

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: `${match.home.abbreviation || match.home.shortName} ${match.home.score ?? ''} - ${match.away.score ?? ''} ${match.away.abbreviation || match.away.shortName}`.replace(/\s+/g, ' '),
    accent,
  })

  const crest = await loadCrestImage(team.logo, scale(size, 130))

  // Shirt number as a watermark - the card's visual anchor.
  // Story used to run 560px, whose descender was clipped by the first stat tile.
  // The alpha is theme-aware: on a light background the accent stays saturated
  // (it already passes contrast), so 13% reads as a solid block, not a whisper.
  if (player.jersey !== null) {
    const numberSize = scale(size, isStory ? 470 : 460)
    const isLightTheme = luminance(theme.bg) > 0.5
    drawText(ctx, String(player.jersey), box.right + scale(size, 30), top + numberSize * 0.72, {
      size: numberSize,
      weight: 700,
      color: withAlpha(accent, isLightTheme ? 0.16 : 0.13),
      align: 'right',
    })
  }

  const crestBox = scale(size, isStory ? 130 : 108)
  drawCrest(ctx, crest, box.left + crestBox / 2, top + crestBox / 2, crestBox, {
    ...crestFallback(theme, accent, team.abbreviation),
  })

  // Name, split so the surname carries the weight.
  const parts = String(player.name).split(' ')
  const surname = parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
  const forename = parts.length > 1 ? parts[0] : ''
  const nameTop = top + crestBox + scale(size, isStory ? 90 : 56)

  if (forename) {
    drawText(ctx, forename, box.left, nameTop, {
      size: scale(size, 42), weight: 500, color: theme.inkMuted, uppercase: true, tracking: 4,
    })
  }
  const surnameSize = fitTextSize(ctx, surname, box.width, {
    max: scale(size, 108), min: scale(size, 44), weight: 700, uppercase: true,
  })
  // Leading set from the surname's own size rather than a fixed 74: at the
  // largest fitted size the two names' boxes overlapped by 3px, which is tight
  // leading rather than an ink collision, but it varies with the name.
  drawText(ctx, surname, box.left, nameTop + scale(size, 52) + surnameSize * 0.32, {
    size: surnameSize, weight: 700, color: theme.ink, uppercase: true, tracking: 1,
  })

  // Position chip in the team colour.
  if (player.position) {
    const chipY = nameTop + scale(size, 96)
    const chipInk = readableInk(accent, '#FFFFFF', '#0B1220')
    const label = player.position
    const chipWidth = scale(size, 40) + label.length * scale(size, 20)
    fillRoundRect(ctx, box.left, chipY, chipWidth, scale(size, 48), scale(size, 10), accent)
    drawText(ctx, label, box.left + chipWidth / 2, chipY + scale(size, 25), {
      size: scale(size, 24), weight: 700, family: FONTS.body, color: chipInk,
      align: 'center', baseline: 'middle', tracking: 3, uppercase: true,
    })
  }

  const stats = pickPlayerStats(player, isStory ? 8 : 6)
  const gridTop = nameTop + scale(size, 180)
  const gridBottom = box.bottom - scale(size, 110)
  if (stats.length) {
    drawStatGrid(ctx, size, theme, {
      stats, x: box.left, y: gridTop, width: box.width, height: gridBottom - gridTop, accent,
    })
  } else {
    drawText(ctx, 'No stats recorded', box.left, gridTop + scale(size, 40), {
      size: scale(size, 28), weight: 500, family: FONTS.body, color: theme.inkFaint,
    })
  }

  drawFooter(ctx, size, theme, {
    left: [team.name, options.dateText || formatMatchDate(match.kickoff, tz)].filter(Boolean).join('  -  '),
    right: options.handle || match.competition.abbreviation || '',
  })
}
