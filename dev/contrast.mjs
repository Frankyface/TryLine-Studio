/**
 * Contrast of every ink against the background a graphic ACTUALLY draws on.
 *
 * The theme file used to claim every ink cleared 4.5:1, and measured against
 * `bg` that was true. But nothing is ever drawn on flat `bg`: `drawBackdrop`
 * washes bgAlt-bg-bgAlt and lays a 16% accent glow across the middle of the
 * canvas, which is exactly where content sits. Measured where they land, the
 * inks were 2.93 to 3.52 - twelve drawText sites across nine graphics, all
 * failing, none of it visible from the token.
 *
 * So this renders the real backdrop and samples it, rather than trusting a
 * number computed against a colour nothing uses.
 *
 * Usage: node dev/contrast.mjs [--url http://localhost:4321/dev/preview]
 */
import { chromium } from 'playwright'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const baseUrl = arg('url', 'http://localhost:4321/dev/preview')
const NL = String.fromCharCode(10)

/** Body text. Large text may sit at 3:1, but these tokens label content. */
const MIN_RATIO = 4.5

/** Every ink must stay visibly quieter than the next one up. */
const MIN_STEP = 1.15

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(baseUrl, { waitUntil: 'networkidle' })

const results = await page.evaluate(async () => {
  const { THEMES, SIZES } = await import('/src/render/theme.js')
  const P = await import('/src/render/primitives.js')

  const rows = []
  for (const theme of Object.values(THEMES)) {
    for (const size of Object.values(SIZES)) {
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      // The backdrop as every graphic draws it, including the accent glow.
      P.drawBackdrop(ctx, size, theme, theme.accent)
      P.drawTexture(ctx, size, theme)
      const { data } = ctx.getImageData(0, 0, size.width, size.height)

      const worstFor = (ink) => {
        let worst = Infinity
        let at = ''
        for (let y = 0; y < size.height; y += 8) {
          for (let x = 0; x < size.width; x += 8) {
            const i = (y * size.width + x) * 4
            const hex = `#${[data[i], data[i + 1], data[i + 2]]
              .map((v) => v.toString(16).padStart(2, '0')).join('')}`
            const ratio = P.contrastRatio(ink, hex)
            if (ratio < worst) { worst = ratio; at = hex }
          }
        }
        return { worst, at }
      }

      const faint = worstFor(theme.inkFaint)
      const muted = worstFor(theme.inkMuted)
      const ink = worstFor(theme.ink)
      rows.push({
        theme: theme.id,
        size: size.id,
        faint: faint.worst,
        faintAt: faint.at,
        muted: muted.worst,
        ink: ink.worst,
      })
    }
  }
  return rows
})

/**
 * The data marks, measured against the surface each one actually lands on.
 *
 * The ink sweep above was the whole check for one pass, and three separate
 * mark faults shipped green underneath it: a comparison bar at 2.17:1, form
 * dots at 2.52:1, and an eyebrow pill missing the ratio its own code asks for.
 * A colour that carries a number has to be checked as carefully as one that
 * carries a word.
 */
const marks = await page.evaluate(async () => {
  const { THEMES } = await import('/src/render/theme.js')
  const P = await import('/src/render/primitives.js')
  const S = await import('/src/render/series.js')
  const rows = []

  for (const theme of Object.values(THEMES)) {
    // What a striped table row looks like once wash, glow and band composite.
    const band = P.composite(theme.ink, 0.04, P.pageSurface(theme))
    const accent = P.contrastAccent(theme.accent, theme.bg, { fallback: theme.accent })

    const add = (mark, colour, against, floor) => rows.push({
      theme: theme.id, mark, ratio: P.contrastRatio(colour, against), floor,
    })

    // League table form dots.
    add('form W', P.contrastAccent('#25D07A', band, { minRatio: 3.2, fallback: theme.ink }), band, 3)
    add('form L', P.contrastAccent('#E5344A', band, { minRatio: 3.2, fallback: theme.ink }), band, 3)

    // Comparison bars - both sides, because the loser carries a number too.
    const raw = S.seriesColours(theme, {})
    const readable = (c) => P.contrastAccent(c, band, { minRatio: 3.2, fallback: theme.ink })
    const barLeft = readable(raw.left)
    const barRight = readable(S.distinctFrom(raw.right, raw.left))
    add('bar left', P.withAlpha(barLeft, 0.95), band, 3)
    add('bar right', P.withAlpha(barRight, 0.95), band, 3)

    // Season chart bars, computed the way `teamseason.js` computes them.
    //
    // This modelled a version of that code which no longer exists: it lifted
    // against `theme.bg` - the reference CLAUDE.md says nothing is ever drawn
    // on - and then ran the result through `distinctFrom`, which can swap in a
    // palette colour nobody re-checks. The graphic stopped doing both (green
    // stays green and red stays red on every theme) and this did not, so it
    // failed a new theme at 1.26:1 for a mark the graphic actually draws at
    // 3.01. A guard that models the wrong code is worse than no guard.
    const surface = P.pageSurface(theme, accent)
    const win = P.contrastAccent('#25D07A', surface, { minRatio: 3, fallback: theme.ink })
    const loss = P.contrastAccent('#E5484D', surface, { minRatio: 3, fallback: theme.ink })
    add('season win', win, surface, 3)
    add('season loss', loss, surface, 3)
    add('season draw', P.contrastAccent(theme.inkMuted, surface, { minRatio: 3, fallback: theme.ink }), surface, 3)

    // The eyebrow pill's own label, on the pill rather than the page.
    const pill = P.composite(accent, 0.16, P.pageSurface(theme, accent))
    add('eyebrow pill', P.contrastAccent(accent, pill, {
      minRatio: 4.5, fallback: P.readableInk(pill),
    }), pill, 4.5)
  }
  return rows
})

await browser.close()

const failures = []
process.stdout.write(`worst-case ink contrast on the rendered backdrop (bar ${MIN_RATIO}:1)${NL}${NL}`)

for (const row of results) {
  const below = [
    ['inkFaint', row.faint], ['inkMuted', row.muted], ['ink', row.ink],
  ].filter(([, ratio]) => ratio < MIN_RATIO)

  // Faint must stay quieter than muted, and muted quieter than ink, or the
  // three tokens collapse into one and the design loses its hierarchy.
  const flat = !(row.ink > row.muted * MIN_STEP && row.muted > row.faint * MIN_STEP)

  for (const [token, ratio] of below) {
    failures.push(`${row.theme}/${row.size} ${token} ${ratio.toFixed(2)}:1 on ${row.faintAt}`)
  }
  if (flat) failures.push(`${row.theme}/${row.size} tokens are too close to tell apart`)

  process.stdout.write(`  ${row.theme.padEnd(10)}${row.size.padEnd(7)}`
    + `faint ${row.faint.toFixed(2).padStart(5)}  `
    + `muted ${row.muted.toFixed(2).padStart(5)}  `
    + `ink ${row.ink.toFixed(2).padStart(6)}`
    + `${below.length || flat ? '  FAIL' : ''}${NL}`)
}

process.stdout.write(`${NL}data marks, against the surface each one lands on${NL}${NL}`)
for (const row of marks) {
  const passed = row.ratio >= row.floor
  if (!passed) {
    failures.push(`${row.theme} ${row.mark} ${row.ratio.toFixed(2)}:1 (needs ${row.floor})`)
  }
  process.stdout.write(`  ${row.theme.padEnd(10)}${row.mark.padEnd(14)}`
    + `${row.ratio.toFixed(2).padStart(6)}:1${passed ? '' : '  FAIL'}${NL}`)
}

process.stdout.write(NL)
if (failures.length) {
  for (const failure of failures) process.stdout.write(`  FAIL  ${failure}${NL}`)
  process.stdout.write(`${NL}${failures.length} contrast failure(s)${NL}`)
  process.exit(1)
}
process.stdout.write(`All inks and data marks readable on every theme.${NL}`)
