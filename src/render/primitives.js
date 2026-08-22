/**
 * Canvas drawing primitives shared by every graphic.
 *
 * Pure drawing helpers: they take a 2D context and never reach for the DOM
 * beyond image loading, so the same code runs in the browser tool and in any
 * headless canvas used for verification.
 */
import { CREST_SIZES } from './crest-sizes.js'
import { FONTS, font } from './theme.js'

/**
 * Load an image for canvas use. crossOrigin is mandatory: ESPN's CDN sends
 * Access-Control-Allow-Origin *, and without the attribute the canvas is
 * tainted and toBlob() throws a SecurityError on export.
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('No image source'))
      return
    }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load image: ${src}`))
    image.src = src
  })
}

/** Load a crest, returning null rather than throwing so one dead url can't kill a render. */
const loadImageOrNull = (src) => loadImage(src).catch(() => null)

/** Sizes mirrored into assets/crests, smallest first. */


/**
 * Load a crest at the smallest mirrored size that covers how big it will draw.
 *
 * Measured before mirroring: ESPN's 500x500 originals were 78% of a session's
 * transfer, and 597 KB to open one league table whose crests draw at 40px.
 * A stored path has no size suffix; the caller's target size picks the file.
 * Anything else - a remote url, or an uploaded club crest as a data URL - is
 * loaded unchanged.
 */
export function loadCrestImage(logo, targetPx = 320) {
  const path = String(logo || '')
  if (!path.startsWith('assets/crests/')) return loadImageOrNull(path)
  const size = CREST_SIZES.find((option) => option >= targetPx) ?? CREST_SIZES.at(-1)
  // Resolved against THIS MODULE, not the page. A page-relative path breaks the
  // dev harness at /dev/ while working in the app at /, and both must work -
  // as must a GitHub Pages subpath, which this also handles.
  const url = new URL(`../../${path}@${size}.png`, import.meta.url).href
  return loadImageOrNull(url)
}

export function roundRect(ctx, x, y, width, height, radius = 0) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
  return ctx
}

export function fillRoundRect(ctx, x, y, width, height, radius, fill) {
  roundRect(ctx, x, y, width, height, radius)
  ctx.fillStyle = fill
  ctx.fill()
}

/**
 * Draw text with the common options in one call.
 * Returns the measured width so callers can lay out inline runs.
 */
export function drawText(ctx, text, x, y, options = {}) {
  const {
    size = 40,
    weight = 600,
    family = FONTS.display,
    color = '#FFFFFF',
    align = 'left',
    baseline = 'alphabetic',
    tracking = 0,
    uppercase = false,
    alpha = 1,
  } = options

  const value = uppercase ? String(text).toUpperCase() : String(text)
  ctx.save()
  ctx.font = font(weight, size, family)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = baseline
  ctx.globalAlpha = alpha
  if (tracking && 'letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`
  ctx.fillText(value, x, y)
  const width = ctx.measureText(value).width
  ctx.restore()
  return width
}

/** Measure without drawing, honouring the same options. */
export function measureText(ctx, text, options = {}) {
  const { size = 40, weight = 600, family = FONTS.display, tracking = 0, uppercase = false } = options
  ctx.save()
  ctx.font = font(weight, size, family)
  if (tracking && 'letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`
  const width = ctx.measureText(uppercase ? String(text).toUpperCase() : String(text)).width
  ctx.restore()
  return width
}

/**
 * Largest font size at or below `max` that fits `text` into `maxWidth`.
 * Long club names get smaller rather than overflowing the canvas.
 */
export function fitTextSize(ctx, text, maxWidth, options = {}) {
  const { max = 80, min = 18, step = 2 } = options
  for (let size = max; size > min; size -= step) {
    if (measureText(ctx, text, { ...options, size }) <= maxWidth) return size
  }
  return min
}

/** Truncate with an ellipsis when even the minimum size will not fit. */
export function truncateText(ctx, text, maxWidth, options = {}) {
  const value = String(text)
  if (measureText(ctx, value, options) <= maxWidth) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = `${value.slice(0, mid).trim()}...`
    if (measureText(ctx, candidate, options) <= maxWidth) low = mid
    else high = mid - 1
  }
  return `${value.slice(0, low).trim()}...`
}

/** Fill the canvas with the theme base plus a soft directional wash. */
export function drawBackdrop(ctx, size, theme, accent) {
  const { width, height } = size
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)

  const wash = ctx.createLinearGradient(0, 0, width, height)
  wash.addColorStop(0, theme.bgAlt)
  wash.addColorStop(0.55, theme.bg)
  wash.addColorStop(1, theme.bgAlt)
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, width, height)

  if (accent) {
    const glow = ctx.createRadialGradient(
      width * 0.5, height * 0.34, 0,
      width * 0.5, height * 0.34, width * 0.72,
    )
    glow.addColorStop(0, withAlpha(accent, 0.16))
    glow.addColorStop(1, withAlpha(accent, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)
  }
}

/** Faint diagonal pitch lines - texture so the backdrop is not a flat slab. */
export function drawTexture(ctx, size, theme, spacing = 56) {
  ctx.save()
  ctx.globalAlpha = 0.05
  ctx.strokeStyle = theme.ink
  ctx.lineWidth = 2
  for (let x = -size.height; x < size.width; x += spacing) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + size.height, size.height)
    ctx.stroke()
  }
  ctx.restore()
}

/** Draw an image contained inside a square box, centred, preserving aspect. */
export function drawContained(ctx, image, centerX, centerY, box) {
  if (!image) return
  const ratio = Math.min(box / image.width, box / image.height)
  const width = image.width * ratio
  const height = image.height * ratio
  ctx.drawImage(image, centerX - width / 2, centerY - height / 2, width, height)
}

/**
 * When a crest needs a plate behind it.
 *
 * The test is DIRECTIONAL, not a plain contrast ratio. On a dark page only a
 * near-black crest disappears; a mid-tone one is fine. On a light page the
 * reverse. A symmetric ratio test gets this wrong in both directions at once -
 * at a 4.5 bar it plated most crests on the light theme, and at 3 it plated
 * Bath, Leicester and Exeter there while still missing near-black Newcastle on
 * dark. These thresholds are on the crest's own luminance.
 */
const CREST_TOO_DARK = 0.14
const CREST_TOO_PALE = 0.66

/**
 * Average luminance of an image's opaque pixels, 0-1.
 * Sampled at low resolution - enough to answer "is this crest dark?".
 */
export function imageLuminance(image, samples = 16) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = samples
    canvas.height = samples
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(image, 0, 0, samples, samples)
    const { data } = ctx.getImageData(0, 0, samples, samples)
    let total = 0
    let weight = 0
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255
      if (alpha < 0.1) continue
      const value = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
      total += value * alpha
      weight += alpha
    }
    return weight ? total / weight : 0.5
  } catch {
    // A tainted or unreadable image: assume it is fine rather than guessing.
    return 0.5
  }
}

/**
 * Crest, or a lettered monogram disc when it could not be loaded.
 *
 * Not every team has a crest on ESPN's CDN - Newcastle Falcons' URL 404s - so
 * the fallback has to be a deliberate design, not a faint ghost. It gets a
 * solid fill, a ring, and ink chosen for contrast against that fill.
 */
export function drawCrest(ctx, image, centerX, centerY, box, fallback = {}) {
  if (image) {
    // Newcastle Falcons' crest is essentially black, which disappears entirely
    // on a dark theme. When a crest and the page are both dark (or both light),
    // it gets a soft plate behind it so the shape still reads.
    if (fallback.plate) {
      // Directional, and deliberately so: on a dark page only a very dark
      // crest needs rescuing, and on a light page only a very pale one. A
      // symmetric test plated most crests on chalk while missing near-black
      // on midnight. The thresholds are tuned against the real crest set.
      const crestLuminance = imageLuminance(image)
      const pageIsDark = fallback.plate.pageLuminance < 0.5
      const tooDark = fallback.plate.tooDark ?? CREST_TOO_DARK
      const tooPale = fallback.plate.tooPale ?? CREST_TOO_PALE
      const vanishes = pageIsDark ? crestLuminance < tooDark : crestLuminance > tooPale
      if (vanishes) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(centerX, centerY, (box / 2) * 1.06, 0, Math.PI * 2)
        ctx.fillStyle = fallback.plate.fill
        ctx.fill()
        ctx.restore()
      }
    }
    drawContained(ctx, image, centerX, centerY, box)
    return
  }
  const radius = box / 2
  const fill = fallback.solid || 'rgba(255,255,255,0.14)'

  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = Math.max(2, radius * 0.06)
  ctx.strokeStyle = fallback.ring || 'rgba(255,255,255,0.35)'
  ctx.stroke()
  ctx.restore()

  const label = (fallback.label || '?').slice(0, 3)
  drawText(ctx, label, centerX, centerY, {
    size: radius * (label.length > 2 ? 0.62 : 0.78),
    weight: 700,
    color: fallback.ink || '#FFFFFF',
    align: 'center',
    baseline: 'middle',
    uppercase: true,
  })
}

/**
 * Fallback styling for a missing crest, tuned to the theme so the monogram is
 * visible on a light page as well as a dark one.
 */
export function crestFallback(theme, color, label, { tooDark, tooPale } = {}) {
  const pageLuminance = luminance(theme.bg)
  return {
    label,
    solid: withAlpha(color || theme.ink, 0.18),
    ring: withAlpha(color || theme.ink, 0.5),
    ink: theme.ink,
    plate: {
      pageLuminance,
      tooDark,
      tooPale,
      // The light-theme fill was too weak to rescue anything it was applied to.
      fill: pageLuminance < 0.5 ? 'rgba(255,255,255,0.92)' : 'rgba(11,18,32,0.42)',
    },
  }
}

/** Small uppercase pill used for competition names, rounds and status. */
export function drawPill(ctx, text, x, y, options = {}) {
  const {
    size = 22, weight = 700, tracking = 3, padX = 22, height = 46,
    fill = 'rgba(255,255,255,0.08)', color = '#FFFFFF', align = 'left', radius = 999,
  } = options
  const textOptions = { size, weight, tracking, uppercase: true, family: FONTS.body }
  const textWidth = measureText(ctx, text, textOptions)
  const width = textWidth + padX * 2
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
  fillRoundRect(ctx, left, y, width, height, radius, fill)
  drawText(ctx, text, left + padX, y + height / 2 + 1, {
    ...textOptions, color, baseline: 'middle',
  })
  return { width, left, right: left + width }
}

export function drawDivider(ctx, x, y, width, color, thickness = 2) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, width, thickness)
}

/** Convert #RRGGBB (or rgb()) to rgba with the given alpha. */
export function withAlpha(color, alpha) {
  const value = String(color || '').trim()
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const int = Number.parseInt(full, 16)
    if (Number.isNaN(int)) return `rgba(255,255,255,${alpha})`
    const r = (int >> 16) & 255
    const g = (int >> 8) & 255
    const b = int & 255
    return `rgba(${r},${g},${b},${alpha})`
  }
  if (value.startsWith('rgb(')) return value.replace('rgb(', 'rgba(').replace(')', `,${alpha})`)
  return `rgba(255,255,255,${alpha})`
}

/** Parse #RGB / #RRGGBB into [r, g, b] 0-255, or null when unparseable. */
export function toRgb(color) {
  const raw = String(color || '').trim()

  // rgb()/rgba() too, because withAlpha() produces them and every contrast
  // measurement of a translucent colour was silently meaningless without this
  // - toRgb returned null, luminance fell back to 1, and the ratio was a
  // number that looked plausible and meant nothing.
  const functional = raw.match(/^rgba?\(([^)]+)\)$/i)
  if (functional) {
    const parts = functional[1].split(',').map((part) => Number.parseFloat(part))
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null
    return parts.slice(0, 3).map((part) => Math.max(0, Math.min(255, part)))
  }

  const value = raw.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const int = Number.parseInt(full, 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

const toHex = (rgb) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`

/** WCAG relative luminance, 0-1. */
export function luminance(color) {
  const rgb = toRgb(color)
  if (!rgb) return 1
  const channel = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

export function contrastRatio(a, b) {
  const light = Math.max(luminance(a), luminance(b))
  const dark = Math.min(luminance(a), luminance(b))
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Team colours are chosen for shirts, not for our backdrop: France is #0000CC,
 * which is invisible on a navy canvas. Lift (or drop) the colour toward the
 * readable end until it clears `minRatio` against the background, keeping the
 * hue so it still reads as the team's colour. Falls back to the theme accent
 * when the colour cannot be rescued.
 */
export function contrastAccent(color, background, { minRatio = 3.5, fallback } = {}) {
  const rgb = toRgb(color)
  if (!rgb) return fallback || color
  if (contrastRatio(color, background) >= minRatio) return toHex(rgb)

  const bgIsDark = luminance(background) < 0.5
  let current = [...rgb]
  for (let step = 0; step < 24; step += 1) {
    current = bgIsDark
      ? current.map((c) => c + (255 - c) * 0.14)
      : current.map((c) => c * 0.86)
    const candidate = toHex(current)
    if (contrastRatio(candidate, background) >= minRatio) return candidate
  }
  return fallback || toHex(current)
}

/**
 * The colour a translucent fill actually ends up as, over a known backdrop.
 *
 * Needed because contrast has to be measured against what is on the canvas,
 * not against the token. The eyebrow pill is the accent at 16% over the page,
 * and measuring the accent against the PAGE said it passed while the text
 * measured 2.56:1 against the pill it was actually sitting on.
 */
export function composite(color, alpha, background) {
  const top = toRgb(color)
  const under = toRgb(background)
  if (!top || !under) return background
  return toHex(top.map((channel, index) => channel * alpha + under[index] * (1 - alpha)))
}

/**
 * Whichever ink actually reads better on this background.
 *
 * A fixed 0.55 flip point was wrong: white on white breaks even against dark
 * ink at about 0.20, so 15 team-colour chips were shipping white text at under
 * 3:1 - Benetton's green measured 2.15:1.
 */
export function readableInk(background, lightInk = '#FFFFFF', darkInk = '#0B1220') {
  return contrastRatio(darkInk, background) >= contrastRatio(lightInk, background) ? darkInk : lightInk
}
