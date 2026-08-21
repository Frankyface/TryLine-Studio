/**
 * Team sheet - the matchday 23 the way rugby reads it: 1-15, then the bench.
 *
 * Layout differs by format on purpose. A square canvas cannot hold 23 legible
 * rows in one column, so feed splits into two columns (XV | replacements)
 * while story, which has the vertical room, runs a single list.
 */
import { STARTING_XV } from '../../data/schema.js'
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, truncateText, withAlpha, fillRoundRect, drawDivider, crestFallback,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { formatMatchDate } from '../format.js'

export const meta = Object.freeze({
  id: 'teamsheet',
  label: 'Team sheet',
  description: 'The matchday 23 by shirt number.',
  needs: 'match',
  requiresSquad: true,
})

const NUMBER_COLUMN = 54

function drawSectionLabel(ctx, size, theme, text, x, y) {
  drawText(ctx, text, x, y, {
    size: scale(size, 20),
    weight: 700,
    family: FONTS.body,
    color: theme.inkFaint,
    tracking: 4,
    uppercase: true,
    baseline: 'middle',
  })
}

function drawSquadRows(ctx, size, theme, { players, x, y, width, rowHeight, accent, showPosition }) {
  const numberWidth = scale(size, NUMBER_COLUMN)
  const nameSize = Math.min(scale(size, 31), rowHeight * 0.58)
  const positionWidth = showPosition ? scale(size, 62) : 0
  let cursor = y

  for (const player of players) {
    const middle = cursor + rowHeight / 2

    drawText(ctx, player.jersey ?? '-', x + numberWidth, middle, {
      size: nameSize * 1.18,
      weight: 700,
      color: accent,
      align: 'right',
      baseline: 'middle',
    })

    const nameOptions = { size: nameSize, weight: 600, family: FONTS.body }
    const label = `${player.name}${player.isCaptain ? ' (c)' : ''}`
    const nameWidth = width - numberWidth - scale(size, 20) - positionWidth
    drawText(ctx, truncateText(ctx, label, nameWidth, nameOptions), x + numberWidth + scale(size, 20), middle, {
      ...nameOptions, color: theme.ink, baseline: 'middle',
    })

    // ESPN codes every replacement as "R", which tells the reader nothing.
    const showThisPosition = showPosition && player.position
      && player.position.toUpperCase() !== 'R'
    if (showThisPosition) {
      // Anchor the position to the name column, not the far content edge -
      // on the wide story row it would otherwise float ~700px from its name.
      const positionX = Math.min(x + width, x + numberWidth + scale(size, 520))
      drawText(ctx, player.position, positionX, middle, {
        size: nameSize * 0.74,
        weight: 700,
        family: FONTS.body,
        color: theme.inkMuted,
        align: 'right',
        baseline: 'middle',
        tracking: 1,
        uppercase: true,
      })
    }
    cursor += rowHeight
  }

  // Hairline down the number column ties the rows together.
  fillRoundRect(ctx, x + numberWidth + scale(size, 9), y + rowHeight * 0.2,
    scale(size, 2), cursor - y - rowHeight * 0.4, 999, withAlpha(accent, 0.3))
  return cursor
}

export async function draw(ctx, { match, size, theme, options = {} }) {
  const tz = { timeZone: options.timeZone }
  const side = options.side === 'away' ? 'away' : 'home'
  const team = match[side]
  const opponent = match[side === 'home' ? 'away' : 'home']
  const accent = resolveAccent(theme, { accent: options.accent, team })
  const box = contentBox(size)
  const isStory = size.height > size.width

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: options.dateText || formatMatchDate(match.kickoff, tz),
    accent,
  })

  const crest = await loadCrestImage(team.logo, scale(size, 150))
  const crestBox = scale(size, isStory ? 150 : 128)
  drawCrest(ctx, crest, box.left + crestBox / 2, top + crestBox / 2, crestBox, {
    ...crestFallback(theme, accent, team.abbreviation),
  })

  const headX = box.left + crestBox + scale(size, 30)
  drawText(ctx, team.name, headX, top + crestBox * 0.42, {
    size: scale(size, 54), weight: 700, color: theme.ink, baseline: 'middle', uppercase: true, tracking: 1,
  })
  drawText(ctx, `${options.headline || 'v'} ${opponent.name}`, headX, top + crestBox * 0.8, {
    size: scale(size, 27), weight: 600, family: FONTS.body, color: theme.inkMuted, baseline: 'middle',
  })

  const starters = team.squad.filter((p) => p.isStarter).slice(0, STARTING_XV)
  const bench = team.squad.filter((p) => !p.isStarter)

  const listTop = top + crestBox + scale(size, 62)
  const listBottom = box.bottom - scale(size, 104)
  const labelGap = scale(size, 30)

  if (isStory) {
    // One column, both sections, with a divider between them.
    const dividerSpace = scale(size, 74)
    const rowHeight = (listBottom - listTop - labelGap * 2 - dividerSpace)
      / (starters.length + bench.length)

    drawSectionLabel(ctx, size, theme, 'Starting XV', box.left, listTop)
    let cursor = drawSquadRows(ctx, size, theme, {
      players: starters, x: box.left, y: listTop + labelGap, width: box.width, rowHeight, accent,
      showPosition: true,
    })

    if (bench.length) {
      cursor += scale(size, 22)
      drawDivider(ctx, box.left, cursor, box.width, withAlpha(theme.line, 1), 2)
      cursor += scale(size, 30)
      drawSectionLabel(ctx, size, theme, 'Replacements', box.left, cursor)
      drawSquadRows(ctx, size, theme, {
        players: bench, x: box.left, y: cursor + labelGap, width: box.width, rowHeight, accent,
        showPosition: true,
      })
    }
  } else {
    // Two columns: the XV on the left, the bench on the right.
    const gap = scale(size, 44)
    const columnWidth = (box.width - gap) / 2
    const rightX = box.left + columnWidth + gap
    const rowHeight = (listBottom - listTop - labelGap) / starters.length

    drawSectionLabel(ctx, size, theme, 'Starting XV', box.left, listTop)
    drawSquadRows(ctx, size, theme, {
      players: starters, x: box.left, y: listTop + labelGap, width: columnWidth, rowHeight, accent,
      showPosition: true,
    })

    if (bench.length) {
      drawSectionLabel(ctx, size, theme, 'Replacements', rightX, listTop)
      drawSquadRows(ctx, size, theme, {
        players: bench, x: rightX, y: listTop + labelGap, width: columnWidth, rowHeight, accent,
        showPosition: true,
      })
    }
  }

  drawFooter(ctx, size, theme, {
    left: match.venue.name || '',
    right: options.handle || `${team.abbreviation || team.shortName} team news`.trim(),
  })
}
