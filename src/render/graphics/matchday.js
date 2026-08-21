/**
 * Matchday / fixture announcement.
 *
 * The stack is measured before it is drawn and then centred in the content box,
 * so the story format does not leave the poster crammed against the top edge.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadImageOrNull, fitTextSize, withAlpha, drawPill, crestFallback,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { formatMatchDate, formatKickoffTime } from '../format.js'

export const meta = Object.freeze({
  id: 'matchday',
  label: 'Matchday',
  description: 'Fixture announcement - date, time and venue.',
  needs: 'match',
  requiresSquad: false,
})

export async function draw(ctx, { match, size, theme, options = {} }) {
  const tz = { timeZone: options.timeZone }
  const accent = resolveAccent(theme, { accent: options.accent })
  const box = contentBox(size)
  const isStory = size.height > size.width

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: match.round || match.season.display,
    accent,
  })

  const [homeCrest, awayCrest] = await Promise.all([
    loadImageOrNull(match.home.logo),
    loadImageOrNull(match.away.logo),
  ])

  const headline = options.headline || 'Matchday'
  const date = options.dateText || formatMatchDate(match.kickoff, tz)
  const time = options.timeText ?? formatKickoffTime(match.kickoff, tz)

  // Measure the stack first, then centre it in the space between eyebrow and footer.
  const crestBox = scale(size, isStory ? 300 : 240)
  const nameSize = Math.min(
    fitTextSize(ctx, match.home.name, box.width, { max: scale(size, 82), min: scale(size, 34), weight: 700, uppercase: true }),
    fitTextSize(ctx, match.away.name, box.width, { max: scale(size, 82), min: scale(size, 34), weight: 700, uppercase: true }),
  )
  const blocks = {
    headline: scale(size, 30) + scale(size, 46),
    crests: crestBox,
    gapAfterCrests: scale(size, 70),
    name: nameSize,
    versus: scale(size, 62),
    gapBeforeDate: scale(size, isStory ? 86 : 62),
    date: date ? scale(size, 46) : 0,
    time: time ? scale(size, 78) : 0,
  }
  const stackHeight = Object.values(blocks).reduce((sum, value) => sum + value, 0) + blocks.name
  const footerTop = box.bottom - scale(size, 120)
  let cursor = top + Math.max(0, (footerTop - top - stackHeight) / 2)

  drawText(ctx, headline, box.centerX, cursor, {
    size: scale(size, 30),
    weight: 700,
    family: FONTS.body,
    color: theme.inkFaint,
    align: 'center',
    baseline: 'top',
    tracking: 10,
    uppercase: true,
  })
  cursor += blocks.headline

  const crestY = cursor + crestBox / 2
  const crestOffset = scale(size, isStory ? 290 : 310)
  drawCrest(ctx, homeCrest, box.centerX - crestOffset, crestY, crestBox, {
    ...crestFallback(theme, match.home.color || accent, match.home.abbreviation),
  })
  drawCrest(ctx, awayCrest, box.centerX + crestOffset, crestY, crestBox, {
    ...crestFallback(theme, match.away.color || accent, match.away.abbreviation),
  })
  cursor += blocks.crests + blocks.gapAfterCrests

  drawText(ctx, match.home.name, box.centerX, cursor, {
    size: nameSize, weight: 700, color: theme.ink, align: 'center',
    baseline: 'top', uppercase: true, tracking: 1,
  })
  cursor += blocks.name

  drawText(ctx, 'versus', box.centerX, cursor + blocks.versus / 2, {
    size: scale(size, 23), weight: 600, family: FONTS.body, color: accent,
    align: 'center', baseline: 'middle', tracking: 6, uppercase: true,
  })
  cursor += blocks.versus

  drawText(ctx, match.away.name, box.centerX, cursor, {
    size: nameSize, weight: 700, color: theme.ink, align: 'center',
    baseline: 'top', uppercase: true, tracking: 1,
  })
  cursor += blocks.name + blocks.gapBeforeDate

  if (date) {
    drawText(ctx, date, box.centerX, cursor, {
      size: scale(size, 46), weight: 600, color: theme.ink, align: 'center',
      baseline: 'top', uppercase: true, tracking: 2,
    })
    cursor += blocks.date + scale(size, 20)
  }
  if (time) {
    drawPill(ctx, options.timeLabel || `${time} kick off`, box.centerX, cursor, {
      size: scale(size, 24), height: scale(size, 56), align: 'center',
      fill: withAlpha(accent, 0.16), color: accent,
    })
  }

  drawFooter(ctx, size, theme, {
    left: [match.venue.name, match.venue.city].filter(Boolean).join(', '),
    right: options.handle || match.competition.abbreviation || '',
  })
}
