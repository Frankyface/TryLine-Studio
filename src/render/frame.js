/**
 * The chrome every graphic shares: backdrop, top eyebrow, footer credit, and
 * the content box each layout draws inside.
 */
import { STORY_SAFE_TOP, STORY_SAFE_BOTTOM, FONTS, scale } from './theme.js'
import {
  drawBackdrop, drawTexture, drawText, drawPill, drawDivider, withAlpha, contrastAccent,
  measureText, truncateText, composite, readableInk, pageSurface,
} from './primitives.js'

/**
 * The accent a graphic should actually draw with: an explicit override, else the
 * team colour lifted until it is readable on this theme, else the theme accent.
 *
 * Resolved against the surface the accent is actually drawn on, in two passes.
 * One pass is not possible: the glow that changes the surface is painted IN the
 * accent, so the surface depends on the answer. Measured against flat `theme.bg`
 * instead, 13 of 104 club-colour and theme pairs cleared 3.5:1 on paper while
 * landing under 3:1 where they were drawn - Connacht green, France blue, and
 * every club whose colour is plain black among them.
 */
export function resolveAccent(theme, { accent, team } = {}) {
  const wanted = accent || team?.color || theme.accent
  const firstPass = contrastAccent(wanted, theme.bg, { fallback: theme.accent })
  return contrastAccent(wanted, pageSurface(theme, firstPass), { fallback: theme.accent })
}

/**
 * Usable content box. On story the box is inset from top and bottom so nothing
 * important sits under Instagram's own UI.
 */
export function contentBox(size) {
  const isStory = size.height > size.width
  const top = isStory ? STORY_SAFE_TOP : size.pad
  const bottom = isStory ? size.height - STORY_SAFE_BOTTOM : size.height - size.pad
  return {
    left: size.pad,
    right: size.width - size.pad,
    top,
    bottom,
    width: size.width - size.pad * 2,
    height: bottom - top,
    centerX: size.width / 2,
    centerY: (top + bottom) / 2,
  }
}

/** Backdrop plus texture plus the accent hairline down the left edge. */
export function drawFrame(ctx, size, theme, { accent } = {}) {
  const tint = accent || theme.accent
  drawBackdrop(ctx, size, theme, tint)
  drawTexture(ctx, size, theme)
  ctx.fillStyle = tint
  ctx.fillRect(0, 0, scale(size, 10), size.height)
}

/** How strongly the eyebrow pill tints the page behind its own label. */
const PILL_TINT = 0.16

/**
 * Eyebrow: competition pill on the left, optional round/status on the right.
 * Returns the y coordinate where content can start.
 */
export function drawEyebrow(ctx, size, theme, { label, meta, accent } = {}) {
  const box = contentBox(size)
  const height = scale(size, 48)
  if (label) {
    // The pill's own tint lifts the background under its text, so the accent
    // has to clear the bar against the PILL, not against the page. Measured
    // against the page it looked fine while reading 2.56:1 where it actually
    // sat - and this pill is on all ten graphics.
    const base = accent || theme.accent
    // Over the glowed surface, not over flat bg - the same correction the form
    // dots needed. Measured against bg, 19 of 40 theme/graphic combinations
    // missed the 4.5:1 this very call asks for.
    const pillFill = composite(base, PILL_TINT, pageSurface(theme, base))
    drawPill(ctx, label, box.left, box.top, {
      size: scale(size, 22),
      height,
      fill: withAlpha(base, PILL_TINT),
      color: contrastAccent(base, pillFill, { minRatio: 4.5, fallback: readableInk(pillFill) }),
    })
  }
  if (meta) {
    drawText(ctx, meta, box.right, box.top + height / 2 + 1, {
      size: scale(size, 22),
      weight: 600,
      family: FONTS.body,
      color: theme.inkMuted,
      align: 'right',
      baseline: 'middle',
      tracking: 3,
      uppercase: true,
    })
  }
  return box.top + height + scale(size, 34)
}

/**
 * The finding as the headline, with the chart's category demoted to a kicker.
 *
 * Every chart in this app computes its own finding - "Newcastle were down to
 * 2% at 66'", "Pau win 92% at home and 31% away" - and every one of them used
 * to set that in small muted type at the bottom, under a category name like
 * "WIN PROBABILITY" at 58px. Nobody stops scrolling for the words WIN
 * PROBABILITY. The chart's job is to prove a claim, so the claim goes first.
 *
 * Falls back to the category as the headline when there is no finding, which
 * is the old layout and still perfectly readable - a chart with nothing
 * remarkable to say should not pretend otherwise.
 *
 * Returns the y where the chart can start.
 */
const HEADLINE_MAX_LINES = 2

/**
 * Fit the headline without drawing it, so a layout can reserve the right
 * height before anything is painted. Both this and drawHeadline go through
 * here, so the space reserved is always the space used.
 */
export function headlineLayout(ctx, size, { finding, category, width } = {}) {
  const box = contentBox(size)
  const isStory = size.height > size.width
  const available = width || box.width
  const headline = finding || category || ''
  const kicker = finding && category ? scale(size, isStory ? 46 : 40) : 0

  if (!headline) return { height: kicker, lines: [], fontSize: 0, kicker }

  const fit = (fontSize) => {
    const options = {
      size: fontSize, weight: 700, family: FONTS.display, uppercase: true, tracking: 1,
    }
    const lines = ['']
    for (const word of headline.split(' ')) {
      const candidate = lines.at(-1) ? `${lines.at(-1)} ${word}` : word
      if (measureText(ctx, candidate, options) > available && lines.at(-1)) lines.push(word)
      else lines[lines.length - 1] = candidate
    }
    return lines
  }

  let fontSize = scale(size, isStory ? 74 : 62)
  let lines = fit(fontSize)
  while (lines.length > HEADLINE_MAX_LINES && fontSize > scale(size, 30)) {
    fontSize -= scale(size, 2)
    lines = fit(fontSize)
  }
  lines = lines.slice(0, HEADLINE_MAX_LINES)

  const lineHeight = fontSize * 1.06
  return { height: kicker + lines.length * lineHeight + scale(size, 16), lines, fontSize, kicker }
}

export function drawHeadline(ctx, size, theme, { finding, category, top, width } = {}) {
  const box = contentBox(size)
  const isStory = size.height > size.width
  const laid = headlineLayout(ctx, size, { finding, category, width })
  let cursor = top

  // Both drawn from the TOP, so the kicker cannot sit under the first line of
  // the headline - with a baseline origin a 62px headline reaches back up past
  // a kicker 20px above it, and the two overprinted.
  if (laid.kicker) {
    drawText(ctx, category, box.left, cursor, {
      size: scale(size, isStory ? 24 : 21), weight: 700, family: FONTS.body,
      color: theme.inkFaint, uppercase: true, tracking: 4, baseline: 'top',
    })
    cursor += laid.kicker
  }

  const lineHeight = laid.fontSize * 1.06
  laid.lines.forEach((line, index) => {
    drawText(ctx, line, box.left, cursor + index * lineHeight, {
      size: laid.fontSize, weight: 700, family: FONTS.display,
      uppercase: true, tracking: 1, color: theme.ink, baseline: 'top',
    })
  })
  return top + laid.height
}

/**
 * Footer: hairline, left credit, right handle.
 * The right-hand text wins the space; the left is truncated to fit beside it,
 * because a long venue name or column legend would otherwise run underneath it.
 */
export function drawFooter(ctx, size, theme, { left, right } = {}) {
  const box = contentBox(size)
  const y = box.bottom - scale(size, 34)
  drawDivider(ctx, box.left, y - scale(size, 26), box.width, withAlpha(theme.line, 0.9), 2)

  const rightOptions = {
    size: scale(size, 20), weight: 700, family: FONTS.body, tracking: 2, uppercase: true,
  }
  const rightWidth = right ? measureText(ctx, right, rightOptions) : 0

  if (left) {
    const leftOptions = {
      size: scale(size, 20), weight: 600, family: FONTS.body, tracking: 2, uppercase: true,
    }
    const available = box.width - rightWidth - scale(size, 40)
    drawText(ctx, truncateText(ctx, left, available, leftOptions), box.left, y + scale(size, 8), {
      ...leftOptions, color: theme.inkFaint,
    })
  }
  if (right) {
    drawText(ctx, right, box.right, y + scale(size, 8), {
      ...rightOptions, color: theme.inkMuted, align: 'right',
    })
  }
  return y - scale(size, 40)
}
