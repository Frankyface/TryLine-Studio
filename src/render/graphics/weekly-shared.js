import { FONTS, scale } from '../theme.js'
import { drawText, truncateText, fitTextSize, drawCrest, loadCrestImage, fillRoundRect, withAlpha, crestFallback } from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, drawHeadline, resolveAccent } from '../frame.js'
import { formatKickoffTime } from '../format.js'
import { fixtureDate } from '../../data/fixture-time.js'

export function weeklyFrame(ctx, { week, size, theme, options = {} }, title, subtitle = week.label) {
  const box = contentBox(size)
  const s = (n) => scale(size, n)
  const text = (value, x, y, font = 26, extra = {}) => drawText(ctx, value, x, y,
    { size: s(font), family: FONTS.body, weight: 600, color: theme.ink, baseline: 'top', ...extra })
  const accent = resolveAccent(theme)
  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, { label: week.league.short, meta: 'Weekly edition', accent })
  const body = drawHeadline(ctx, size, theme, { category: title, top })
  text(subtitle, box.left, body + s(6), 23, { color: theme.inkMuted })
  drawFooter(ctx, size, theme, { left: options.footer || `Week of ${week.start}`, right: options.handle || 'TryLine Studio' })
  return { box, s, text, top: body + s(65), accent }
}

export async function drawFixtureRows(ctx, params, preview) {
  const { week, size, theme, options = {} } = params
  const title = preview ? 'The week ahead' : 'The results'
  const subtitle = `${week.label}${options.pages > 1 ? ` · ${options.page} / ${options.pages}` : ''}`
  const { box, s, text, top } = weeklyFrame(ctx, params, title, subtitle)
  const rows = (preview ? week.upcoming : week.finals).slice(options.offset || 0, (options.offset || 0) + 6)
  const story = size.height > size.width
  const height = Math.min(s(story ? 175 : 104), (box.bottom - s(110) - top) / Math.max(rows.length, 1))
  if (!rows.length) throw new Error('No fixtures for this page.')
  for (const [index, match] of rows.entries()) {
    const y = top + height * index
    fillRoundRect(ctx, box.left, y, box.width, height - s(10), s(10), withAlpha(theme.ink, 0.04))
    const centerY = y + s(story ? 74 : 54)
    const crest = s(40)
    for (const side of ['home', 'away']) {
      const x = side === 'home' ? box.left + s(30) : box.right - s(30)
      drawCrest(ctx, await loadCrestImage(match[side].logo, crest), x, centerY, crest, crestFallback(theme, theme.accent, match[side].abbreviation, { logo: match[side].logo }))
      const label = match[side].shortName || match[side].name
      const nameWidth = box.width * 0.32 - s(55)
      const fontSize = fitTextSize(ctx, label, nameWidth, { max: s(26), min: s(18), weight: 600, family: FONTS.body })
      const name = truncateText(ctx, label, nameWidth, { size: fontSize, weight: 600, family: FONTS.body })
      text(name, side === 'home' ? x + s(32) : x - s(32), centerY - s(16), fontSize / s(1), { align: side === 'home' ? 'left' : 'right' })
    }
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(`${fixtureDate(match, week.timeZone)}T12:00:00Z`))
    text(date.toUpperCase(), box.centerX, y + s(8), 16, { align: 'center', color: theme.inkFaint })
    text(preview ? (formatKickoffTime(match.kickoff, { timeZone: week.timeZone }) || 'TBC') : `${match.home.score}–${match.away.score}`,
      box.centerX, centerY - s(23), preview ? 30 : 42, { align: 'center', family: FONTS.display, weight: 700 })
  }
  text(preview ? `Kick-offs: ${week.timeZone} · times may change` : `${week.finals.length} completed matches${week.unresolved.length ? ` · ${week.unresolved.length} awaiting results` : ''}`,
    box.left, box.bottom - s(104), 22, { color: theme.inkFaint })
}
