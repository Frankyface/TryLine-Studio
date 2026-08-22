/**
 * Player stat card - one player, their shirt number, and the numbers that
 * actually happened. options.player is a player object from a squad.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, fitTextSize, inkHeight, measureText, withAlpha, fillRoundRect,
  readableInk,
  luminance, crestFallback,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { pickPlayerStats, formatMatchDate } from '../format.js'
import { heroStat, heroRank } from '../../analysis/hero.js'

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

  // ONE number on the card can be the biggest thing on it. With a hero stat
  // the watermark was a decorative 460px numeral competing with the 400px one
  // that carries the message - "10" beside "13", neither obviously the point.
  // The shirt then rides in the position chip, which loses nothing.
  const hero = heroStat(player, { benchmarks: options.heroStats?.benchmarks })

  // Shirt number as a watermark - the card's visual anchor.
  // Story used to run 560px, whose descender was clipped by the first stat tile.
  // The alpha is theme-aware: on a light background the accent stays saturated
  // (it already passes contrast), so 13% reads as a solid block, not a whisper.
  if (player.jersey !== null && !hero) {
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
    const label = hero && player.jersey !== null
      ? `${player.position} · ${player.jersey}`
      : player.position
    const chipWidth = scale(size, 40) + label.length * scale(size, 20)
    fillRoundRect(ctx, box.left, chipY, chipWidth, scale(size, 48), scale(size, 10), accent)
    drawText(ctx, label, box.left + chipWidth / 2, chipY + scale(size, 25), {
      size: scale(size, 24), weight: 700, family: FONTS.body, color: chipInk,
      align: 'center', baseline: 'middle', tracking: 3, uppercase: true,
    })
  }

  const gridTop = nameTop + scale(size, 180)
  const gridBottom = box.bottom - scale(size, 110)

  // ONE number when the player has one worth showing, the grid when they do
  // not. Four equal tiles gave equal billing to four non-events; measured, the
  // first tile sat at the 58th percentile of its own match and chose METRES
  // for 149 of 212 props at a median of six. 39% of players clear the bar.
  // A long name pushes the grid down; below this there is no room for a hero
  // number AND the three lines under it, and the grid degrades more gracefully.
  if (hero && gridBottom - gridTop > scale(size, 320)) {
    const heroValue = String(hero.value)
    const labelSize = scale(size, isStory ? 42 : 36)
    const rankSize = scale(size, isStory ? 32 : 27)
    const supportSize = scale(size, isStory ? 27 : 24)

    // Stacked from the BOTTOM up, so the number takes whatever height is left
    // rather than the three lines under it being pushed off the card.
    const support = pickPlayerStats(player, 4).filter((entry) => entry.key !== hero.key).slice(0, 3)
    const supportTop = gridBottom
    const rank = heroRank(match, player, hero)
    const rankTop = supportTop - (rank ? rankSize + scale(size, 22) : 0)
    const labelTop = rankTop - labelSize - scale(size, 16)

    // Sized to FILL the space that is left, measured as ink rather than as the
    // em box: adding the font size instead left the label sitting through the
    // row beneath it, and a fixed max left the story format with 300px of dead
    // canvas between the name and the number.
    const room = labelTop - gridTop - scale(size, 18)
    const probe = scale(size, 100)
    const inkRatio = inkHeight(ctx, heroValue, { size: probe, weight: 700, uppercase: true }) / probe
    // The number may take the width the support column does not, measured
    // rather than reserved - "102" and "3" are not the same card, and a fixed
    // cap left the story with 300px of dead canvas above the number.
    const supportWidth = support.reduce((widest, entry) => Math.max(widest,
      measureText(ctx, entry.label, { size: supportSize, family: FONTS.body, tracking: 2, uppercase: true }),
      measureText(ctx, String(entry.value), { size: supportSize * 1.9, weight: 700 })), 0)
    const byWidth = fitTextSize(ctx, heroValue, box.width - supportWidth - scale(size, 60), {
      max: scale(size, isStory ? 860 : 460), min: scale(size, 120), weight: 700, uppercase: true,
    })
    const valueSize = Math.max(scale(size, 120), Math.min(byWidth, room / (inkRatio || 1)))
    // Bottom-aligned to the label, so a two-digit and a three-digit number sit
    // on the same line rather than drifting with the em box.
    drawText(ctx, heroValue, box.left, labelTop - scale(size, 18), {
      size: valueSize, weight: 700, color: theme.ink, uppercase: true, baseline: 'alphabetic',
    })
    drawText(ctx, hero.label, box.left, labelTop, {
      size: labelSize, weight: 700, family: FONTS.body,
      color: accent, uppercase: true, tracking: 3, baseline: 'top',
    })

    // Where that number sits among the 46 on the pitch - a fact about this
    // match, not a percentile the viewer has to take on trust.
    if (rank) {
      drawText(ctx, rank, box.left, rankTop, {
        size: rankSize, weight: 600, family: FONTS.body,
        color: theme.inkMuted, baseline: 'top',
      })
    }

    // The rest of the line, in the column the watermark used to occupy, so the
    // card is a performance rather than one number on half an empty canvas.
    // Stacked UP from the hero's own baseline, which aligns the two blocks
    // without either needing to know the other's height.
    const rowGap = scale(size, isStory ? 34 : 28)
    const rowHeight = supportSize * 2 + rowGap
    support.forEach((entry, index) => {
      const rowBottom = labelTop - scale(size, 18) - (support.length - 1 - index) * rowHeight
      drawText(ctx, String(entry.value), box.right, rowBottom - supportSize - scale(size, 6), {
        size: supportSize * 1.9, weight: 700, color: theme.ink, align: 'right', baseline: 'alphabetic',
      })
      drawText(ctx, entry.label, box.right, rowBottom, {
        size: supportSize, weight: 600, family: FONTS.body, color: theme.inkFaint,
        align: 'right', uppercase: true, tracking: 2, baseline: 'alphabetic',
      })
    })
  } else if (pickPlayerStats(player, isStory ? 8 : 6).length) {
    drawStatGrid(ctx, size, theme, {
      stats: pickPlayerStats(player, isStory ? 8 : 6),
      x: box.left, y: gridTop, width: box.width, height: gridBottom - gridTop, accent,
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
