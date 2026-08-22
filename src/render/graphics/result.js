/**
 * Full-time / live score graphic.
 * Crest, score, crest across the middle; try and goal scorers underneath.
 */
import { MATCH_STATUS } from '../../data/schema.js'
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, fitTextSize, inkHeight, truncateText,
  withAlpha, fillRoundRect, drawPill, crestFallback, composite, readableInk, PLATE_HALF,
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

function drawScorerColumn(ctx, size, theme, { x, y, width, align, timeline, side, maxRows, lineHeight }) {
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

  const played = match.home.score !== null && match.away.score !== null

  // Crests are sized to the room BESIDE the score, not to a number that looked
  // generous: 380 put both of them 50px outside the content box on all 364
  // scheduled fixtures, and their plates 72.8px out, over the accent hairline
  // the frame paints down the left edge. A plate is the crest box plus 6% of
  // padding each side, so that is what has to fit.
  const crestOffsetFor = (columns) => scale(size, columns ? 232 : (isStory ? 316 : 348))
  const crestRoom = (box.right - box.centerX - crestOffsetFor(isStory && played)) / PLATE_HALF
  const crestBox = Math.min(scale(size, isStory ? (played ? 300 : 380) : 210), crestRoom)

  const [homeCrest, awayCrest] = await Promise.all([
    loadCrestImage(match.home.logo, crestBox),
    loadCrestImage(match.away.logo, crestBox),
  ])

  // The kick-off text is needed BEFORE the block can be placed, because on a
  // story it sits below the crests and its height is part of what is centred.
  const scoreText = played
    ? `${match.home.score}-${match.away.score}`
    : options.timeText || formatKickoffTime(match.kickoff, tz) || 'v'
  // 85 of the 364 scheduled fixtures carry `T00:00Z` - kick-off not announced.
  // Blowing a lone lowercase "v" up to 200px made a placeholder the biggest
  // thing on the card, so the fallback stays small.
  const announced = played || scoreText !== 'v'
  const timeSize = fitTextSize(ctx, scoreText, box.width, {
    max: scale(size, announced ? 200 : 96), min: scale(size, 60), weight: 700,
  })
  const timeInk = inkHeight(ctx, scoreText, { size: timeSize, weight: 700 })

  // An unplayed fixture has no scorers, so the band reserved for them is dead
  // canvas - 48% of the content box once scheduled matches started carrying a
  // null score instead of 0-0. A fixed drop of 190/300px covered that on the
  // feed and made the story worse. The block is centred instead.
  //
  // Its height is DERIVED from the drawing below rather than modelled: the
  // first attempt counted the whole pill (drawPill anchors on its top, so only
  // the part below `pillY` is inside the block) and a name block that hangs
  // ABOVE its baseline, and it missed the kick-off line the story now draws.
  // Measured, that over-counted the feed by 96px and under-counted the story
  // by 80 - and pushed the feed's largest dead band from 283px to 319.
  const pillTop = top + scale(size, isStory ? 96 : 8)
  let pillY = pillTop
  const kickoffDate = played ? '' : (options.dateText || formatMatchDate(match.kickoff, tz))
  const dateSize = scale(size, isStory ? 34 : 28)
  const dateDrop = kickoffDate ? scale(size, isStory ? 76 : 60) : 0

  if (!played) {
    const blockHeight = scale(size, 60) + crestBox + dateDrop + (isStory
      ? scale(size, 40) + timeInk + scale(size, 84)
      : scale(size, 62))
    // Centred from `top`, not from `pillTop`: the story's 96px indent is there
    // to sit the pill under the eyebrow on a played card, and banking it first
    // put 96px of the surplus above the block before centring even began.
    const room = (box.bottom - scale(size, 110)) - top
    pillY = top + Math.max(0, (room - blockHeight) / 2)
  }
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

  // A story is not a wide graphic with bars of nothing at each end. Measured,
  // the 9:16 result was 37% inked with a 290px dead band, because the score
  // has to fit BETWEEN the crests - 262px of room, which caps "36-14" at
  // roughly a 100px face on a canvas 1920 tall. Story therefore stacks into
  // two columns, one per team, so each number owns its own width.
  const isColumns = isStory && played
  const crestY = pillY + scale(size, 60) + crestBox / 2
  const crestOffset = crestOffsetFor(isColumns)

  drawCrest(ctx, homeCrest, box.centerX - crestOffset, crestY, crestBox, {
    ...crestFallback(theme, match.home.color || accent, match.home.abbreviation),
  })
  drawCrest(ctx, awayCrest, box.centerX + crestOffset, crestY, crestBox, {
    ...crestFallback(theme, match.away.color || accent, match.away.abbreviation),
  })

  const columnWidth = scale(size, 372)
  let nameY = crestY + crestBox / 2 + scale(size, isStory ? 92 : 62)


  if (isColumns) {
    // ONE size for both numbers, taken from the wider of the two: a 7 sized to
    // its own column beside a 36 sized to its would print the losing score
    // larger than the winning one.
    const scores = [String(match.home.score), String(match.away.score)]
    const scoreSize = Math.min(...scores.map((text) => fitTextSize(ctx, text, columnWidth, {
      max: scale(size, 300), min: scale(size, 96), weight: 700,
    })))
    // Anchored on the BASELINE, not the top of the em box: digits carry no
    // descender, so the baseline IS the bottom of the ink and the name below
    // can be placed against it. Measured from a top origin instead, the names
    // printed through the bottom of the numbers.
    const scoreInk = Math.max(...scores.map((text) =>
      inkHeight(ctx, text, { size: scoreSize, weight: 700 })))
    const scoreBaseline = crestY + crestBox / 2 + scale(size, 52) + scoreInk

    for (const [side, x] of [['home', box.centerX - crestOffset], ['away', box.centerX + crestOffset]]) {
      drawText(ctx, String(match[side].score), x, scoreBaseline, {
        size: scoreSize, weight: 700, color: theme.ink, align: 'center', baseline: 'alphabetic',
      })
    }

    nameY = scoreBaseline + scale(size, 54)
    for (const [side, x] of [['home', box.centerX - crestOffset], ['away', box.centerX + crestOffset]]) {
      const team = match[side]
      const nameOptions = {
        max: scale(size, 48), min: scale(size, 24), weight: 700, uppercase: true, tracking: 1,
      }
      const nameSize = fitTextSize(ctx, team.name, columnWidth, nameOptions)
      // Ellipsed at the floor, like every other text site here. Real club
      // names clear the column by 1.7px at worst ("Newcastle Falcons", 370.3
      // of 372); a manually entered one does not, and two of them met in the
      // middle of the card.
      const name = truncateText(ctx, team.name, columnWidth,
        { ...nameOptions, size: nameSize })
      drawText(ctx, name, x, nameY, {
        size: nameSize, weight: 700, color: theme.ink, align: 'center', uppercase: true, tracking: 1,
      })
      if (team.isWinner) {
        fillRoundRect(ctx, x - scale(size, 32), nameY + scale(size, 16),
          scale(size, 64), scale(size, 6), 999, accent)
      }
    }
  } else {
    if (isStory) {
      // Below the crests, not between them. A kick-off time squeezed into the
      // 212px between two story crests draws at about a 90px face, which is
      // small for the one thing a fixture card exists to say.
      const timeBaseline = crestY + crestBox / 2 + scale(size, 40) + timeInk
      drawText(ctx, scoreText, box.centerX, timeBaseline, {
        size: timeSize, weight: 700, color: theme.ink, align: 'center', baseline: 'alphabetic',
      })
      nameY = timeBaseline + scale(size, 84)
    } else {
      const scoreSize = fitTextSize(ctx, scoreText, crestOffset * 2 - crestBox - scale(size, 40), {
        max: scale(size, played ? 150 : 110), min: scale(size, 48), weight: 700,
      })
      drawText(ctx, scoreText, box.centerX, crestY + scoreSize * 0.36, {
        size: scoreSize, weight: 700, color: theme.ink, align: 'center',
      })
    }

    // Team names, sized down individually so a long club name never overflows.
    const nameWidth = scale(size, 400)
    for (const [side, x, align] of [['home', box.left, 'left'], ['away', box.right, 'right']]) {
      const team = match[side]
      const nameSize = fitTextSize(ctx, team.name, nameWidth, {
        max: scale(size, 52), min: scale(size, 26), weight: 700, uppercase: true, tracking: 1,
      })
      drawText(ctx, team.name, x, nameY, {
        size: nameSize, weight: 700, color: theme.ink, align, uppercase: true, tracking: 1,
      })
      if (team.isWinner && played) {
        fillRoundRect(ctx, align === 'left' ? x : x - scale(size, 64), nameY + scale(size, 16),
          scale(size, 64), scale(size, 6), 999, accent)
      }
    }
  }

  // A fixture card that does not say WHEN is missing the other half of its
  // job, and the date was only in the footer at 20px. Putting it in the block
  // fills space that was otherwise air: the scheduled story measured a 387px
  // dead band against 182 for matchday, which is the graphic designed for a
  // fixture and carries its date in the stack.
  if (kickoffDate) {
    drawText(ctx, kickoffDate, box.centerX, nameY + dateDrop, {
      size: dateSize, weight: 700, family: FONTS.body, color: theme.inkMuted,
      align: 'center', uppercase: true, tracking: 3,
    })
  }

  // Scorers, one column per side, centred in whatever space is left so the
  // graphic does not end with a band of dead canvas above the footer.
  const baseLineHeight = scale(size, 34)
  const cards = played ? cardEvents(match.timeline) : []
  const blockBottom = box.bottom - scale(size, cards.length ? 150 : 110)
  // NO room is reserved for the SCORERS header, and reserving some was a
  // mistake worth recording. The header is centred - ink x 481-595 in both
  // formats, always - and the winner's underline is drawn at the box edges or
  // under a column centre, x 72-136 / 944-1008 / 276-340 / 740-804. Those
  // cannot intersect at any size or score; what looked like an overlap on
  // Northampton 94-33 Bristol was a shared y-band 140px apart horizontally.
  // Reserving 34px cost exactly one row of scorers, and 16 real cards that
  // had listed every scorer stopped doing so.
  const blockTop = nameY + scale(size, 54)
  const rowsNeeded = Math.max(
    summariseScorers(match.timeline, 'home').length,
    summariseScorers(match.timeline, 'away').length,
  )
  const maxRows = Math.max(2, Math.floor((blockBottom - blockTop) / baseLineHeight))
  // Rows breathe into space they would otherwise leave under themselves. Five
  // scorers in room for eight used to centre and bank the difference as a
  // 167px band above the footer - 15% of a feed canvas - which reads as an
  // unfinished graphic rather than as deliberate air.
  const lineHeight = rowsNeeded
    ? Math.min(baseLineHeight * 1.5, Math.max(baseLineHeight, (blockBottom - blockTop) / rowsNeeded))
    : baseLineHeight
  const shownRows = Math.min(rowsNeeded, maxRows)
  const blockHeight = shownRows * lineHeight
  // Both formats centre the block. Story used to top-align it, which simply
  // moved a third of the canvas from above the scorers to below them; the
  // bigger hero block above is what actually fills the space.
  const scorersTop = blockTop + Math.max(0, (blockBottom - blockTop - blockHeight) / 2)

  // 45 of the 783 finished matches in the archive have no timeline at all, and
  // the band reserved for scorers was simply left blank - 448px, 48% of the
  // content height, on a card that otherwise looks finished. Say why it is
  // empty, the way the player card already does.
  if (played && !rowsNeeded) {
    drawText(ctx, 'Scorers not recorded', box.centerX, (blockTop + blockBottom) / 2, {
      size: scale(size, 24), weight: 600, family: FONTS.body,
      color: theme.inkFaint, align: 'center', baseline: 'middle',
      tracking: 2, uppercase: true,
    })
  }

  // `rowsNeeded`, not `timeline.length`: a timeline can carry cards and no
  // scorers - reachable from manual entry, where a club types a yellow card
  // and no try - and that drew the heading over an empty block.
  if (played && rowsNeeded) {
    // A card headed SCORERS that omits a man who scored is exactly the silent
    // gap this project refuses everywhere else: 14 scorers in room for 13 used
    // to drop the last name with nothing to show for it. Say how many are
    // missing, per side, because the two columns truncate independently.
    const missing = ['home', 'away']
      .map((side) => Math.max(0, summariseScorers(match.timeline, side).length - shownRows))
      .reduce((most, count) => Math.max(most, count), 0)
    const heading = missing ? `Scorers  -  ${missing} more not shown` : 'Scorers'

    drawText(ctx, heading, box.centerX, scorersTop - scale(size, 26), {
      size: scale(size, 19), weight: 700, family: FONTS.body,
      color: theme.inkFaint, align: 'center', tracking: 4, uppercase: true,
    })
    const columnWidth = scale(size, 420)
    drawScorerColumn(ctx, size, theme, {
      x: box.left, y: scorersTop, width: columnWidth, align: 'left',
      timeline: match.timeline, side: 'home', maxRows, lineHeight,
    })
    drawScorerColumn(ctx, size, theme, {
      x: box.right, y: scorersTop, width: columnWidth, align: 'right',
      timeline: match.timeline, side: 'away', maxRows, lineHeight,
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

  // The date is only in the footer when the block above is not already
  // carrying it, which it is on an unplayed fixture.
  const venueParts = [match.venue.name, kickoffDate ? '' : formatMatchDate(match.kickoff, tz)]
    .filter(Boolean)
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
