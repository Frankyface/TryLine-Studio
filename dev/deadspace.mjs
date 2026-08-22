/**
 * How much of each graphic is dead canvas: the longest run of rows inside the
 * content box that nothing is drawn on.
 *
 * Two wrong versions preceded this one, and both wrongnesses are worth keeping
 * written down.
 *
 *  1. It drove `dev/preview.html`, which renders ONE match, and reported that
 *     fixture's numbers as the archive's. A scheduled fixture measures 244px
 *     where the demo match measures 124.
 *  2. It called a row empty when no pixel differed sharply from its neighbour
 *     four across. That measures EDGE DENSITY, not paint - so the inside of
 *     any large flat fill read as empty, and win-probability/story was
 *     reported with a 402px dead band of which all 402 rows were painted. It
 *     is the filled area under the curve.
 *
 * So coverage is now taken from what the canvas was actually ASKED to draw:
 * text ink boxes, crests, and fills that are not full-bleed. A row is dead if
 * no drawn element covers it. The backdrop, its texture and the frame's
 * hairline are excluded by being full-bleed - they are painted on every row of
 * every canvas and would otherwise make every graphic 100% inked.
 *
 * Usage: node dev/deadspace.mjs [--every N]   (needs the static server on :4321)
 *
 * The default sample is the one the numbers in CLAUDE.md were measured from.
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const NL = String.fromCharCode(10)
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const every = Number(arg('every', '8'))

const matches = []
const tables = []
const seasons = []
for (const competition of readdirSync('data')) {
  const dir = `data/${competition}`
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
  if (existsSync(`${dir}/matches`)) {
    for (const file of readdirSync(`${dir}/matches`)) {
      matches.push(JSON.parse(readFileSync(`${dir}/matches/${file}`, 'utf8')))
    }
  }
  for (const file of readdirSync(dir)) {
    if (file.startsWith('table-')) tables.push(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')))
    if (file.startsWith('season-')) seasons.push(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')))
  }
}
const sample = matches.filter((_, index) => index % every === 0)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
await page.goto('http://localhost:4321/dev/preview?only=result', { waitUntil: 'networkidle' })

const rows = await page.evaluate(async ([raws, tableRaws, seasonRaws]) => {
  const [{ GRAPHICS, renderGraphic }, { createMatch, createTable }, theme, { contentBox },
    { blockingReason }] = await Promise.all([
    import('/src/render/index.js'), import('/src/data/schema.js'),
    import('/src/render/theme.js'), import('/src/render/frame.js'),
    import('/src/render/availability.js'),
  ])
  const canvas = document.createElement('canvas')

  /**
   * Every element the graphic draws, as a vertical span.
   * Full-bleed fills are the backdrop, its texture and the row stripes; they
   * cover every row by design and say nothing about whether a row is used.
   */
  let spans = []
  const realFillText = CanvasRenderingContext2D.prototype.fillText
  const realDrawImage = CanvasRenderingContext2D.prototype.drawImage
  const realBeginPath = CanvasRenderingContext2D.prototype.beginPath
  const realMoveTo = CanvasRenderingContext2D.prototype.moveTo
  const realLineTo = CanvasRenderingContext2D.prototype.lineTo
  const realArcTo = CanvasRenderingContext2D.prototype.arcTo
  const realArc = CanvasRenderingContext2D.prototype.arc
  const realFill = CanvasRenderingContext2D.prototype.fill
  const realStroke = CanvasRenderingContext2D.prototype.stroke
  const realFillRect = CanvasRenderingContext2D.prototype.fillRect

  const add = (top, bottom, width) => {
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return
    // Full-bleed in EITHER direction is furniture, not content: the backdrop
    // is a full-width fill, and the texture is a set of diagonal strokes whose
    // bounding boxes run the whole height of the canvas. Counting those made
    // every graphic 100% covered, which is the same non-answer as counting
    // none of them.
    if (width >= canvas.width * 0.95) return
    if (bottom - top >= canvas.height * 0.9) return
    spans.push({ top, bottom })
  }

  let path = null
  const extend = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (!path) path = { left: x, right: x, top: y, bottom: y }
    else {
      path.left = Math.min(path.left, x)
      path.right = Math.max(path.right, x)
      path.top = Math.min(path.top, y)
      path.bottom = Math.max(path.bottom, y)
    }
  }
  const closePath = () => {
    if (path) add(path.top, path.bottom, path.right - path.left)
    path = null
  }

  CanvasRenderingContext2D.prototype.fillText = function patched(text, x, y, ...rest) {
    const metrics = this.measureText(text)
    const size = Number(String(this.font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : size
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : 0
    add(y - ascent, y + descent, metrics.width)
    return realFillText.call(this, text, x, y, ...rest)
  }
  CanvasRenderingContext2D.prototype.drawImage = function patched(image, ...rest) {
    const geometry = rest.length >= 8 ? rest.slice(4) : rest
    const [, y, w, h] = geometry
    if (w >= 60) add(y, y + h, w)
    return realDrawImage.call(this, image, ...rest)
  }
  CanvasRenderingContext2D.prototype.fillRect = function patched(x, y, w, h) {
    add(y, y + h, w)
    return realFillRect.call(this, x, y, w, h)
  }
  CanvasRenderingContext2D.prototype.beginPath = function patched() {
    path = null
    return realBeginPath.call(this)
  }
  CanvasRenderingContext2D.prototype.moveTo = function patched(x, y) {
    extend(x, y)
    return realMoveTo.call(this, x, y)
  }
  CanvasRenderingContext2D.prototype.lineTo = function patched(x, y) {
    extend(x, y)
    return realLineTo.call(this, x, y)
  }
  CanvasRenderingContext2D.prototype.arcTo = function patched(x1, y1, x2, y2, r) {
    extend(x1, y1)
    extend(x2, y2)
    return realArcTo.call(this, x1, y1, x2, y2, r)
  }
  CanvasRenderingContext2D.prototype.arc = function patched(x, y, r, ...rest) {
    extend(x - r, y - r)
    extend(x + r, y + r)
    return realArc.call(this, x, y, r, ...rest)
  }
  CanvasRenderingContext2D.prototype.fill = function patched(...rest) {
    closePath()
    return realFill.apply(this, rest)
  }
  CanvasRenderingContext2D.prototype.stroke = function patched(...rest) {
    closePath()
    return realStroke.apply(this, rest)
  }

  /** Longest run of rows nothing covers, and the covered share. */
  const measure = (size) => {
    const box = contentBox(size)
    const top = Math.round(box.top)
    const bottom = Math.round(box.bottom)
    const covered = new Uint8Array(bottom - top)
    for (const span of spans) {
      const from = Math.max(top, Math.floor(span.top))
      const to = Math.min(bottom, Math.ceil(span.bottom))
      for (let y = from; y < to; y += 1) covered[y - top] = 1
    }
    let longest = 0
    let run = 0
    let inked = 0
    for (let y = 0; y < covered.length; y += 1) {
      if (covered[y]) { inked += 1; run = 0 } else { run += 1; if (run > longest) longest = run }
    }
    return { gap: longest, inked: inked / covered.length, height: bottom - top }
  }

  const out = []
  for (const raw of raws) {
    const match = createMatch(raw)
    const played = raw.home?.score !== null && raw.away?.score !== null
    const squad = match.home?.squad || []
    for (const graphic of GRAPHICS) {
      // Every graphic that works from a match. The tables and seasons do not
      // vary with the fixture, so they are swept separately below.
      if (graphic.meta.needs !== 'match') continue
      const options = {
        handle: '@tryline',
        side: 'home',
        player: squad.find((entry) => Object.keys(entry.stats || {}).length) || squad[0],
        playerB: (match.away?.squad || [])[0],
      }
      // The app's own gate: without it a team sheet with no squad renders a
      // header over an empty card and reports a 1,079px dead band.
      if (blockingReason(graphic, { match, source: 'espn' }, options)) continue
      for (const key of ['feed', 'story']) {
        const size = theme.SIZES[key]
        spans = []
        try {
          await renderGraphic(canvas, graphic.meta.id, {
            match,
            size,
            theme: theme.THEMES.midnight,
            options,
          })
        } catch (error) {
          continue // refused by its own gate, which is not a dead-space question
        }
        out.push({
          graphic: graphic.meta.id,
          format: key,
          kind: played ? 'played' : 'scheduled',
          ...measure(size),
        })
      }
    }
  }
  for (const [items, needs] of [[tableRaws, 'table'], [seasonRaws, 'season']]) {
    for (const raw of items) {
      const made = needs === 'table' ? { table: createTable(raw) } : { season: raw }
      for (const graphic of GRAPHICS) {
        if (graphic.meta.needs !== needs) continue
        if (blockingReason(graphic, { ...made, source: 'espn' }, {})) continue
        for (const key of ['feed', 'story']) {
          const size = theme.SIZES[key]
          spans = []
          try {
            await renderGraphic(canvas, graphic.meta.id, {
              ...made, size, theme: theme.THEMES.midnight, options: { handle: '@tryline' },
            })
          } catch (error) {
            continue
          }
          out.push({ graphic: graphic.meta.id, format: key, kind: needs, ...measure(size) })
        }
      }
    }
  }
  CanvasRenderingContext2D.prototype.fillText = realFillText
  CanvasRenderingContext2D.prototype.drawImage = realDrawImage
  CanvasRenderingContext2D.prototype.fillRect = realFillRect
  CanvasRenderingContext2D.prototype.beginPath = realBeginPath
  CanvasRenderingContext2D.prototype.moveTo = realMoveTo
  CanvasRenderingContext2D.prototype.lineTo = realLineTo
  CanvasRenderingContext2D.prototype.arcTo = realArcTo
  CanvasRenderingContext2D.prototype.arc = realArc
  CanvasRenderingContext2D.prototype.fill = realFill
  CanvasRenderingContext2D.prototype.stroke = realStroke
  return out
}, [sample, tables, seasons])

await browser.close()

const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

const groups = new Map()
for (const row of rows) {
  const key = `${row.graphic}|${row.format}|${row.kind}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(row)
}

process.stdout.write(`${sample.length} matches sampled (every ${every} of ${matches.length})${NL}${NL}`)
process.stdout.write(`${'graphic'.padEnd(11)}${'fmt'.padEnd(7)}${'kind'.padEnd(11)}`
  + `${'n'.padStart(4)}${'inked'.padStart(8)}${'gap p50'.padStart(9)}${'p90'.padStart(7)}${'max'.padStart(7)}${'worst%'.padStart(8)}${NL}`)

const ordered = [...groups.entries()].sort((a, b) => {
  const worst = (rows_) => Math.max(...rows_[1].map((row) => row.gap / row.height))
  return worst(b) - worst(a)
})
for (const [key, group] of ordered) {
  const [graphic, format, kind] = key.split('|')
  const gaps = group.map((row) => row.gap)
  const worstShare = Math.max(...group.map((row) => row.gap / row.height))
  process.stdout.write(`${graphic.padEnd(11)}${format.padEnd(7)}${kind.padEnd(11)}`
    + `${String(group.length).padStart(4)}`
    + `${`${Math.round((group.reduce((sum, row) => sum + row.inked, 0) / group.length) * 100)}%`.padStart(8)}`
    + `${`${quantile(gaps, 0.5)}px`.padStart(9)}`
    + `${`${quantile(gaps, 0.9)}px`.padStart(7)}`
    + `${`${Math.max(...gaps)}px`.padStart(7)}`
    + `${`${Math.round(worstShare * 100)}%`.padStart(8)}${NL}`)
}
if (errors.length) process.stdout.write(`${NL}page errors: ${errors.slice(0, 3).join(' | ')}${NL}`)
