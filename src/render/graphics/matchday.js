/**
 * Matchday / fixture announcement.
 *
 * The stack is measured before it is drawn and then centred in the content box,
 * so the story format does not leave the poster crammed against the top edge.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, fitTextSize, withAlpha, drawPill, crestFallback,
  pageSurface, contrastAccent, composite, readableInk,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { formatMatchDate, formatKickoffTime } from '../format.js'

export const meta = Object.freeze({
  id: 'matchday',
  label: 'Matchday',
  description: 'Fixture announcement - date, time and venue.',
  needs: 'match',
  usesTeamColour: true,
  requiresSquad: false,
})

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
  // Both of these were the raw accent with no contrast check at all - and a
  // club colour now reaches them by default, so "VERSUS" measured 2.66:1 with
  // Connacht green. The pill has its own tint on top of that.
  const surface = pageSurface(theme, accent)
  const readableAccent = contrastAccent(accent, surface, { minRatio: 4.5, fallback: theme.ink })
  const pillFill = composite(accent, 0.16, surface)

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: match.competition.name || 'Rugby',
    meta: match.round || match.season.display,
    accent,
  })

  const [homeCrest, awayCrest] = await Promise.all([
    loadCrestImage(match.home.logo, scale(size, 300)),
    loadCrestImage(match.away.logo, scale(size, 300)),
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
  const measure = () => Object.values(blocks).reduce((sum, value) => sum + value, 0) + blocks.name
  // Drawn first so the stack is centred against where the footer ACTUALLY
  // starts. A guessed 120px reserve left the kick-off pill - one of the two
  // things a fixture poster exists to convey - overlapping the divider.
  const footerTop = drawFooter(ctx, size, theme, {
    left: [match.venue.name, match.venue.city].filter(Boolean).join(', '),
    // The competition is already the eyebrow pill at the top; repeating its
    // abbreviation here just printed the same thing twice.
    right: options.handle || '',
  })
  // Explicit air above the footer, and the GAPS absorb any overflow.
  //
  // Measured, the feed stack came to 778px in 746px of space, which is why the
  // kick-off pill sat on the divider. Hand-tuning the constants would have
  // fixed this fixture and broken on a longer team name, since the name block
  // is fitted to the text; shrinking the flexible gaps adapts to both.
  const stackBottom = footerTop - scale(size, 34)
  const available = stackBottom - top
  const overflow = measure() - available
  if (overflow > 0) {
    const flexible = blocks.gapAfterCrests + blocks.gapBeforeDate + blocks.versus
    const keep = Math.max(0.45, 1 - overflow / flexible)
    blocks.gapAfterCrests *= keep
    blocks.gapBeforeDate *= keep
    blocks.versus *= keep
    // Gaps alone cannot always cover it; the crests give up the rest.
    const remaining = measure() - available
    if (remaining > 0) blocks.crests = Math.max(crestBox * 0.7, blocks.crests - remaining)
  }

  let cursor = top + Math.max(0, (available - measure()) / 2)

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

  const crestY = cursor + blocks.crests / 2
  const crestOffset = scale(size, isStory ? 290 : 310)
  drawCrest(ctx, homeCrest, box.centerX - crestOffset, crestY, blocks.crests, {
    ...crestFallback(theme, match.home.color || accent, match.home.abbreviation),
  })
  drawCrest(ctx, awayCrest, box.centerX + crestOffset, crestY, blocks.crests, {
    ...crestFallback(theme, match.away.color || accent, match.away.abbreviation),
  })
  cursor += blocks.crests + blocks.gapAfterCrests

  drawText(ctx, match.home.name, box.centerX, cursor, {
    size: nameSize, weight: 700, color: theme.ink, align: 'center',
    baseline: 'top', uppercase: true, tracking: 1,
  })
  cursor += blocks.name

  drawText(ctx, 'versus', box.centerX, cursor + blocks.versus / 2, {
    size: scale(size, 23), weight: 600, family: FONTS.body, color: readableAccent,
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
      fill: withAlpha(accent, 0.16),
      color: contrastAccent(accent, pillFill, { minRatio: 4.5, fallback: readableInk(pillFill) }),
    })
  }

}
