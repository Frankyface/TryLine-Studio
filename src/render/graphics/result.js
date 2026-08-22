/**
 * Full-time / live score graphic.
 * Crest, score, crest across the middle; try and goal scorers underneath.
 */
import { MATCH_STATUS } from '../../data/schema.js'
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, fitTextSize, truncateText,
  withAlpha, fillRoundRect, drawPill, crestFallback, composite, readableInk,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import {
  formatMatchDate, formatKickoffTime, summariseScorers, timelineMark,
  cardEvents, formatAttendance,
} from '../format.js'

export const meta = Object.freeze({
  id: 'result',
  label: 'Result',
  description: 'Final or live score with the scorers.',
  needs: 'match',
  usesTeamColour: true,
  requiresSquad: false,
})

const statusLabel = (match) => {
  if (match.status === MATCH_STATUS.FINAL) return 'Full time'
  if (match.status === MATCH_STATUS.LIVE) return match.statusDetail || 'Live'
  return 'Kick off'
}

function drawScorerColumn(ctx, size, theme, { x, y, width, align, timeline, side, maxRows }) {
  const lineHeight = scale(size, 34)
  const rows = summariseScorers(timeline, side).slice(0, maxRows)
  let cursor = y

  for (const row of rows) {
    const minutes = row.minutes.length ? ` ${row.minutes.join(', ')}` : ''
    const text = truncateText(ctx, `${row.name}${minutes}`, width, {
      size: scale(size, 25), family: FONTS.body, weight: 500,
    })
    // Every scorer reads the same. Greying the goal-kickers looked like a
    // rendering fault, since nothing on the graphic explained the difference.
    drawText(ctx, text, x, cursor, {
      size: scale(size, 25),
      weight: 500,
      family: FONTS.body,
      color: theme.ink,
      align,
      baseline: 'top',
    })
    cursor += lineHeight
  }
  return cursor
}

export async function draw(ctx, { match, size, theme, options = {} }) {
  const tz = { timeZone: options.timeZone }
  // The club's own colour, from whichever side they picked. Without a team
  // passed here "Use team colour" was silently inert - it is on by default and
  // was doing nothing on seven of the ten graphics, including this one.
  const accent = resolveAccent(theme, {
    accent: options.accent,
    team: match[options.side === 'away' ? 'away' : 'home'],
  })
  const box = contentBox(size)
  const isStory = size.height > size.width

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: match.round || match.season.display || formatMatchDate(match.kickoff, tz),
    accent,
  })

  const [homeCrest, awayCrest] = await Promise.all([
    loadCrestImage(match.home.logo, scale(size, 250)),
    loadCrestImage(match.away.logo, scale(size, 250)),
  ])

  // Status pill, centred above the score. The ink is chosen against the pill
  // it lands on, not assumed: white on the 90% live red measured 3.86:1 on the
  // light theme, and a live pill is the one a fan stares at.
  // An unplayed fixture has no scorers, so the band reserved for them is dead
  // canvas - 48% of the content box once scheduled matches started carrying a
  // null score instead of 0-0. With nothing to sit below it, the hero block
  // drops to the middle of the space instead.
  const hasScorers = match.home.score !== null && match.away.score !== null
  const pillY = top + scale(size, isStory ? 96 : 8)
    + (hasScorers ? 0 : scale(size, isStory ? 300 : 190))
  const isLive = match.status === MATCH_STATUS.LIVE
  const pillFill = isLive
    ? composite('#E5344A', 0.9, theme.bg)
    : composite(theme.ink, 0.08, theme.bg)
  drawPill(ctx, statusLabel(match), box.centerX, pillY, {
    size: scale(size, 21),
    height: scale(size, 44),
    align: 'center',
    fill: isLive ? withAlpha('#E5344A', 0.9) : withAlpha(theme.ink, 0.08),
    color: isLive ? readableInk(pillFill) : theme.inkMuted,
  })

  const crestBox = scale(size, isStory ? 330 : 210)
  const crestY = pillY + scale(size, 60) + crestBox / 2
  const crestOffset = scale(size, isStory ? 316 : 348)

  drawCrest(ctx, homeCrest, box.centerX - crestOffset, crestY, crestBox, {
    ...crestFallback(theme, match.home.color || accent, match.home.abbreviation),
  })
  drawCrest(ctx, awayCrest, box.centerX + crestOffset, crestY, crestBox, {
    ...crestFallback(theme, match.away.color || accent, match.away.abbreviation),
  })

  // Score, or the kick-off time when the match has not been played.
  const played = match.home.score !== null && match.away.score !== null
  const scoreText = played
    ? `${match.home.score}-${match.away.score}`
    : options.timeText || formatKickoffTime(match.kickoff, tz) || 'v'
  const scoreSize = fitTextSize(ctx, scoreText, crestOffset * 2 - crestBox - scale(size, 40), {
    max: scale(size, played ? (isStory ? 190 : 150) : 110), min: scale(size, 48), weight: 700,
  })
  drawText(ctx, scoreText, box.centerX, crestY + scoreSize * 0.36, {
    size: scoreSize, weight: 700, color: theme.ink, align: 'center',
  })

  // Team names, sized down individually so a long club name never overflows.
  const nameY = crestY + crestBox / 2 + scale(size, isStory ? 92 : 62)
  const nameWidth = scale(size, 400)
  for (const [side, x, align] of [['home', box.left, 'left'], ['away', box.right, 'right']]) {
    const team = match[side]
    const nameSize = fitTextSize(ctx, team.name, nameWidth, {
      max: scale(size, 52), min: scale(size, 26), weight: 700, uppercase: true,
    })
    drawText(ctx, team.name, x, nameY, {
      size: nameSize, weight: 700, color: theme.ink, align, uppercase: true, tracking: 1,
    })
    if (team.isWinner && played) {
      fillRoundRect(ctx, align === 'left' ? x : x - scale(size, 64), nameY + scale(size, 16),
        scale(size, 64), scale(size, 6), 999, accent)
    }
  }

  // Scorers, one column per side, centred in whatever space is left so the
  // graphic does not end with a band of dead canvas above the footer.
  const lineHeight = scale(size, 34)
  const cards = played ? cardEvents(match.timeline) : []
  const blockBottom = box.bottom - scale(size, cards.length ? 150 : 110)
  const blockTop = nameY + scale(size, 54)
  const rowsNeeded = Math.max(
    summariseScorers(match.timeline, 'home').length,
    summariseScorers(match.timeline, 'away').length,
  )
  const maxRows = Math.max(2, Math.floor((blockBottom - blockTop) / lineHeight))
  const blockHeight = Math.min(rowsNeeded, maxRows) * lineHeight
  // Both formats centre the block. Story used to top-align it, which simply
  // moved a third of the canvas from above the scorers to below them; the
  // bigger hero block above is what actually fills the space.
  const scorersTop = blockTop + Math.max(0, (blockBottom - blockTop - blockHeight) / 2)

  // 45 of the 783 finished matches in the archive have no timeline at all, and
  // the band reserved for scorers was simply left blank - 448px, 48% of the
  // content height, on a card that otherwise looks finished. Say why it is
  // empty, the way the player card already does.
  if (played && !match.timeline.length) {
    drawText(ctx, 'Scorers not recorded', box.centerX, (blockTop + blockBottom) / 2, {
      size: scale(size, 24), weight: 600, family: FONTS.body,
      color: theme.inkFaint, align: 'center', baseline: 'middle',
      tracking: 2, uppercase: true,
    })
  }

  if (played && match.timeline.length) {
    drawText(ctx, 'Scorers', box.centerX, scorersTop - scale(size, 26), {
      size: scale(size, 19), weight: 700, family: FONTS.body,
      color: theme.inkFaint, align: 'center', tracking: 4, uppercase: true,
    })
    const columnWidth = scale(size, 420)
    drawScorerColumn(ctx, size, theme, {
      x: box.left, y: scorersTop, width: columnWidth, align: 'left',
      timeline: match.timeline, side: 'home', maxRows,
    })
    drawScorerColumn(ctx, size, theme, {
      x: box.right, y: scorersTop, width: columnWidth, align: 'right',
      timeline: match.timeline, side: 'away', maxRows,
    })

    if (cards.length) {
      // Truncated like every other long string here. Unbounded, a seven-card
      // match measured 1,991px inside a 936px box - 455px lost off EACH edge,
      // on 18 matches across ten competitions.
      const cardOptions = {
        size: scale(size, 20), weight: 600, family: FONTS.body, uppercase: true, tracking: 1,
      }
      const summary = cards
        .map((c) => `${timelineMark(c.type)} ${c.player.shortName || c.player.name} ${c.minute ?? ''}`.trim())
        .join('   ')
      drawText(ctx, truncateText(ctx, summary, box.width, cardOptions),
        box.centerX, box.bottom - scale(size, 118), {
          ...cardOptions, color: theme.inkFaint, align: 'center',
        })
    }
  }

  const venueParts = [match.venue.name, formatMatchDate(match.kickoff, tz)].filter(Boolean)
  const attendance = formatAttendance(match.venue.attendance)
  drawFooter(ctx, size, theme, {
    left: venueParts.join('  -  '),
    // The handle wins the right-hand slot when there is one. This is the most
    // reshared post of the week and it was the one graphic carrying no
    // attribution at all, even with the slot otherwise empty.
    right: options.handle
      || (attendance ? `${attendance} in` : match.season.display || ''),
  })
}
