/**
 * Head-to-head comparison - the broadcast match-stats card.
 *
 * Two modes, chosen with options.mode:
 *   'teams'   (default) both squads aggregated
 *   'players' two named players, options.player and options.playerB
 *
 * Only international competitions carry per-player stats on ESPN's rugby feed,
 * so this throws a plain-language error rather than drawing a card full of
 * dashes when the data is not there.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, truncateText, withAlpha, fillRoundRect, crestFallback,
  luminance,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import {
  compareTeams, comparePlayers, formatComparisonValue, hasComparableSquads,
  TEAM_STAT_KEYS, PLAYER_STAT_KEYS, BETTER,
} from '../../analysis/comparison.js'
import { formatMatchDate } from '../format.js'
import { seriesColours } from '../series.js'

export const meta = Object.freeze({
  id: 'comparison',
  label: 'Match stats',
  description: 'Team or player head-to-head.',
  needs: 'match',
  // Player mode lists one side's squad; team mode aggregates both and draws
  // the same thing whichever is picked.
  usesSide: (options = {}) => options.mode === 'players',
  requiresSquad: true,
  requiresStats: true,
})

/** Width reserved in the middle for the stat label. */
const LABEL_ZONE = 330
const VALUE_ZONE = 96

/** "1 - P" reads as a shirt number and a position; "1P" reads as neither. */
const playerSubtitle = (player) => [player?.jersey, player?.position]
  .filter((part) => part !== null && part !== undefined && part !== '')
  .join(' - ')

const surnameOf = (name) => {
  const parts = String(name || '').split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || ''
}

function drawRow(ctx, size, theme, { row, y, height, box, colours }) {
  const centerX = box.centerX
  const labelHalf = scale(size, LABEL_ZONE) / 2
  const valueZone = scale(size, VALUE_ZONE)
  const barGap = scale(size, 14)

  const leftBarRight = centerX - labelHalf
  const leftBarLeft = box.left + valueZone
  const rightBarLeft = centerX + labelHalf
  const zoneWidth = Math.max(0, leftBarRight - leftBarLeft - barGap)

  const values = formatComparisonValue(row)
  const barHeight = Math.min(scale(size, 22), height * 0.34)
  const barY = y + height / 2 - barHeight / 2
  const valueSize = Math.min(scale(size, 34), height * 0.5)
  const labelSize = Math.min(scale(size, 22), height * 0.32)

  // Bars meet in the middle and grow outward, so the longer bar is the winner
  // of that row - except where lower is better, which the leader flag handles.
  const leftWidth = zoneWidth * row.leftBar
  const rightWidth = zoneWidth * row.rightBar
  // The losing bar must still read. Fading toward the page works on a dark
  // theme but not a light one - a 45% yellow measured 1.14:1 against its own
  // row band. On light themes the loser keeps full opacity and is distinguished
  // by height instead.
  // 0.24 was too far: the loser measured 1.51:1 against its own row band on
  // every dark theme, readable only because the winner sat beside it. Height
  // now carries the difference on BOTH themes, so opacity does not have to.
  const isLightTheme = luminance(theme.bg) > 0.5
  const dim = (colour, isLeader) => withAlpha(colour, isLeader ? 0.95 : 0.6)
  const barScale = (isLeader) => (isLeader ? 1 : 0.62)

  const leftLeads = row.leader !== 'right'
  const rightLeads = row.leader !== 'left'
  const leftHeight = barHeight * barScale(leftLeads)
  const rightHeight = barHeight * barScale(rightLeads)

  fillRoundRect(ctx, leftBarRight - barGap - leftWidth, y + height / 2 - leftHeight / 2,
    leftWidth, leftHeight, leftHeight / 2, dim(colours.left, leftLeads))
  fillRoundRect(ctx, rightBarLeft + barGap, y + height / 2 - rightHeight / 2,
    rightWidth, rightHeight, rightHeight / 2, dim(colours.right, rightLeads))

  const isTie = row.leader === null && row.left !== null && row.right !== null
  drawText(ctx, values.left, box.left + valueZone - scale(size, 18), y + height / 2, {
    size: valueSize,
    weight: 700,
    color: row.leader === 'left' || isTie ? theme.ink : theme.inkMuted,
    align: 'right',
    baseline: 'middle',
  })
  drawText(ctx, values.right, box.right - valueZone + scale(size, 18), y + height / 2, {
    size: valueSize,
    weight: 700,
    color: row.leader === 'right' || isTie ? theme.ink : theme.inkMuted,
    align: 'left',
    baseline: 'middle',
  })

  const label = row.betterWhen === BETTER.LOWER ? `${row.label} ↓` : row.label
  drawText(ctx, truncateText(ctx, label, scale(size, LABEL_ZONE) - scale(size, 12), {
    size: labelSize, family: FONTS.body, weight: 600, uppercase: true, tracking: 2,
  }), centerX, y + height / 2, {
    size: labelSize,
    weight: 600,
    family: FONTS.body,
    color: theme.inkMuted,
    align: 'center',
    baseline: 'middle',
    tracking: 2,
    uppercase: true,
  })
}

/** Identity block: crest and name for a team, jersey and surname for a player. */
function drawIdentity(ctx, size, theme, {
  crest, title, subtitle, colour, align, y, box, badgeLabel, compact,
}) {
  // In players mode the crest is an attribute of the player, not the subject of
  // the card, so it is smaller - otherwise the layout is identical to the team
  // card and reads as two teams at a glance.
  const crestBox = scale(size, compact ? 58 : 84)
  const crestX = align === 'right' ? box.right - crestBox / 2 : box.left + crestBox / 2
  // The monogram must be a badge, not the subtitle: passing "10 - FH" drew a
  // disc reading "10 ".
  drawCrest(ctx, crest, crestX, y, crestBox, crestFallback(theme, colour, badgeLabel || title))

  const textX = align === 'right' ? box.right - crestBox - scale(size, 22) : box.left + crestBox + scale(size, 22)
  const titleOptions = { size: scale(size, 40), weight: 700, uppercase: true, tracking: 1 }
  drawText(ctx, truncateText(ctx, title, scale(size, 300), titleOptions), textX, y - scale(size, 6), {
    ...titleOptions, color: theme.ink, align, baseline: 'middle',
  })
  if (subtitle) {
    drawText(ctx, subtitle, textX, y + scale(size, 26), {
      size: scale(size, 24), weight: 600, family: FONTS.body, color: theme.inkMuted,
      align, baseline: 'middle',
    })
  }

  const swatchX = align === 'right' ? textX - scale(size, 34) : textX
  fillRoundRect(ctx, swatchX, y + scale(size, 46), scale(size, 34), scale(size, 8), 999, colour)
}

export async function draw(ctx, { match, size, theme, options = {} }) {
  const isPlayers = options.mode === 'players'
  const box = contentBox(size)
  const isStory = size.height > size.width

  if (!hasComparableSquads(match)) {
    throw new Error('That match has no squad data to compare.')
  }

  const rows = isPlayers
    ? comparePlayers(options.player, options.playerB, options.statKeys || PLAYER_STAT_KEYS)
    : compareTeams(match, options.statKeys || TEAM_STAT_KEYS)

  if (!rows.some((row) => row.left !== null || row.right !== null)) {
    throw new Error('No player stats recorded for that match - ESPN only publishes them for internationals.')
  }

  const accent = resolveAccent(theme, { accent: options.accent })
  const colours = seriesColours(theme, { home: match.home, away: match.away })

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: options.dateText || formatMatchDate(match.kickoff, { timeZone: options.timeZone }),
    accent,
  })

  const title = options.headline || (isPlayers ? 'Head to head' : 'Match stats')
  drawText(ctx, title, box.left, top + scale(size, 42), {
    size: scale(size, 58), weight: 700, color: theme.ink, uppercase: true, tracking: 1,
  })

  const played = match.home.score !== null && match.away.score !== null
  if (played) {
    // Labelled on the player card so it cannot read as the two players' own
    // scoring contest.
    const scoreline = `${match.home.score}-${match.away.score}`
    drawText(ctx, isPlayers ? `Match ${scoreline}` : scoreline, box.right, top + scale(size, 42), {
      size: scale(size, isPlayers ? 40 : 58), weight: 700, color: theme.ink, align: 'right',
    })
  }

  const [homeCrest, awayCrest] = await Promise.all([
    loadCrestImage(match.home.logo, scale(size, 84)),
    loadCrestImage(match.away.logo, scale(size, 84)),
  ])

  const identityY = top + scale(size, isStory ? 150 : 122)
  if (isPlayers) {
    const left = options.player
    const right = options.playerB
    drawIdentity(ctx, size, theme, {
      crest: homeCrest,
      title: surnameOf(left?.name),
      subtitle: [match.home.abbreviation, playerSubtitle(left)].filter(Boolean).join('  -  '),
      badgeLabel: match.home.abbreviation,
      compact: true,
      colour: colours.left, align: 'left', y: identityY, box,
    })
    drawIdentity(ctx, size, theme, {
      crest: awayCrest,
      title: surnameOf(right?.name),
      subtitle: [match.away.abbreviation, playerSubtitle(right)].filter(Boolean).join('  -  '),
      badgeLabel: match.away.abbreviation,
      compact: true,
      colour: colours.right, align: 'right', y: identityY, box,
    })
  } else {
    drawIdentity(ctx, size, theme, {
      crest: homeCrest, title: match.home.shortName, subtitle: match.home.abbreviation,
      badgeLabel: match.home.abbreviation,
      colour: colours.left, align: 'left', y: identityY, box,
    })
    drawIdentity(ctx, size, theme, {
      crest: awayCrest, title: match.away.shortName, subtitle: match.away.abbreviation,
      badgeLabel: match.away.abbreviation,
      colour: colours.right, align: 'right', y: identityY, box,
    })
  }

  const rowsTop = identityY + scale(size, isStory ? 130 : 108)
  const rowsBottom = box.bottom - scale(size, 110)
  const rowHeight = (rowsBottom - rowsTop) / rows.length

  rows.forEach((row, index) => {
    if (index % 2 === 0) {
      fillRoundRect(ctx, box.left - scale(size, 12), rowsTop + index * rowHeight,
        box.width + scale(size, 24), rowHeight, scale(size, 10), withAlpha(theme.ink, 0.04))
    }
    drawRow(ctx, size, theme, {
      row, y: rowsTop + index * rowHeight, height: rowHeight, box, colours,
    })
  })

  const hasLowerIsBetter = rows.some((row) => row.betterWhen === BETTER.LOWER)
  drawFooter(ctx, size, theme, {
    left: hasLowerIsBetter ? '↓ fewer is better' : match.venue.name || '',
    right: options.handle || match.competition.abbreviation || '',
  })
}
