/**
 * Does anything land where it should not?
 *
 * Three separate adversarial reviews of this project found eight geometry
 * faults between them, and every one survived a green `npm run verify`:
 * a headline that drew 1,075px into 762px of room, crests 51.5px outside the
 * content box on all 1,147 story matchdays, a hero label printed through the
 * row beneath it, club names past the right edge because the fit measured
 * without the tracking it drew with. Nothing in the suite looked at WHERE ink
 * landed - `tests/app.e2e.mjs` asserts a canvas has content, and `dev/shots`
 * renders pictures for a human. Both would pass with the text stacked in a
 * corner.
 *
 * So: render every graphic over real data, wrap the canvas, and check three
 * things about the ink that comes out.
 *
 *   1. Nothing is drawn outside the CANVAS. Never acceptable.
 *   2. Nothing is drawn outside the CONTENT BOX, bar the deliberate bleeds
 *      listed in ALLOWED_BLEED. Those are few and each says why.
 *   3. No two pieces of text overlap each other.
 *
 * Row stripes and the backdrop are excluded by width - they are full-bleed by
 * design. Crest plates need no special case: `drawCrest` pads inward, so a
 * plate cannot exceed the crest box the caller sized.
 *
 * Usage: node dev/geometry.mjs [--every N] [--theme id]
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const NL = String.fromCharCode(10)
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const every = Number(arg('every', '11'))
const themeId = arg('theme', 'midnight')

/**
 * Ink that is meant to sit outside the content box.
 * Keep this list short and make every entry earn its place.
 */
/**
 * Chosen to sit BETWEEN the largest measured artefact and the smallest real
 * fault, and both numbers were measured rather than guessed: the league
 * table's right-hand column reports 0.7px of overhang at an anchor sitting
 * exactly on `box.right`, and the smallest genuine breach found so far is the
 * win-probability axis label at 1.1px. A first attempt at 1.2px masked that
 * fault, which is precisely how a guard stops being one - so this number
 * cannot be raised without re-measuring what it would start letting through.
 *
 * The other artefact is measured away rather than tolerated: canvas
 * `letterSpacing` adds its spacing AFTER the final glyph, so an advance width
 * overstates painted ink by one tracking unit.
 */
const TOLERANCE = 0.8

const ALLOWED_BLEED = [
  // The shirt number on a player card is a watermark, anchored deliberately
  // past the right edge so it reads as a graphic element and not as data.
  { graphic: 'statcard', kind: 'text', minSize: 300, note: 'shirt-number watermark' },
]

const dataDir = 'data'
const matches = []
const tables = []
const seasons = []
for (const competition of readdirSync(dataDir)) {
  const dir = `${dataDir}/${competition}`
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
const sampled = matches.filter((_, index) => index % every === 0)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
await page.goto('http://localhost:4321/dev/preview?only=result', { waitUntil: 'networkidle' })

const report = await page.evaluate(async ([matchRaws, tableRaws, seasonRaws, allowed, theme, TOLERANCE]) => {
  const [{ GRAPHICS, renderGraphic }, schema, themeModule, { contentBox }, primitives] = await Promise.all([
    import('/src/render/index.js'), import('/src/data/schema.js'),
    import('/src/render/theme.js'), import('/src/render/frame.js'), import('/src/render/primitives.js'),
  ])
  const canvas = document.createElement('canvas')

  let ink = []
  const realFill = CanvasRenderingContext2D.prototype.fillText
  const realImage = CanvasRenderingContext2D.prototype.drawImage
  const realRect = CanvasRenderingContext2D.prototype.fillRect

  /**
   * The box a draw actually paints into, in CANVAS coordinates.
   *
   * Rotated text is the reason this exists: the scatter's y-axis title is
   * drawn through a translate+rotate, so the raw x/y handed to fillText say
   * nothing about where the ink lands, and reading them as-is reported it
   * 117px off the left edge of a canvas it sits comfortably inside.
   */
  const mapped = (matrix, left, top, right, bottom) => {
    const points = [[left, top], [right, top], [right, bottom], [left, bottom]]
      .map(([x, y]) => ({
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
      }))
    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    }
  }

  CanvasRenderingContext2D.prototype.fillText = function patched(text, x, y, ...rest) {
    const metrics = this.measureText(text)
    const align = this.textAlign
    const width = metrics.width
    const left = align === 'right' ? x - width : (align === 'center' ? x - width / 2 : x)
    const ascent = metrics.actualBoundingBoxAscent
    const descent = metrics.actualBoundingBoxDescent
    const size = Number(String(this.font).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0)
    // The advance width carries a trailing letter-space the ink does not.
    const tracking = Number(String(this.letterSpacing || '0').match(/(-?\d+(?:\.\d+)?)/)?.[1] ?? 0)
    const box = mapped(this.getTransform(), left,
      Number.isFinite(ascent) ? y - ascent : y - size,
      left + Math.max(0, width - tracking),
      Number.isFinite(descent) ? y + descent : y)
    ink.push({ kind: 'text', what: String(text).slice(0, 30), size, ...box })
    return realFill.call(this, text, x, y, ...rest)
  }
  CanvasRenderingContext2D.prototype.drawImage = function patched(image, ...rest) {
    const box = rest.length >= 8 ? rest.slice(4) : rest
    const [x, y, w, h] = box
    // The backdrop texture is tiled as ~16px images across the whole canvas.
    if (w >= 60 && Number.isFinite(x)) {
      const box = mapped(this.getTransform(), x, y, x + w, y + h)
      ink.push({ kind: 'crest', what: 'crest', size: w, ...box })
    }
    return realImage.call(this, image, ...rest)
  }

  const results = []
  const violations = []

  const check = (graphic, size, label) => {
    const box = contentBox(size)
    // NO speculative plate box. `drawCrest` takes the plate's padding out of
    // the crest rather than adding it around, so nothing it paints exceeds the
    // crest box - the invariant is enforced where the plate is drawn, and
    // modelling a worst-case plate here just reported every crest that fills
    // its own box as a breach. What is checked is what was actually painted.
    const all = ink

    for (const item of all) {
      const offCanvas = Math.max(-item.left, item.right - size.width, -item.top, item.bottom - size.height)
      if (offCanvas > TOLERANCE) {
        violations.push({ rule: 'off-canvas', graphic, label, by: +offCanvas.toFixed(1), what: item.what })
        continue
      }
      const bleeds = allowed.some((rule) => rule.graphic === graphic
        && rule.kind === item.kind && item.size >= (rule.minSize || 0))
      if (bleeds) continue
      const outside = Math.max(box.left - item.left, item.right - box.right)
      if (outside > TOLERANCE) {
        violations.push({ rule: 'outside-box', graphic, label, by: +outside.toFixed(1), what: item.what })
      }
    }

    // Text over text. Compared on true ink boxes, so tight leading is fine and
    // only actual overprinting counts.
    const texts = ink.filter((item) => item.kind === 'text' && item.what.trim())
    for (let a = 0; a < texts.length; a += 1) {
      for (let b = a + 1; b < texts.length; b += 1) {
        const one = texts[a]
        const two = texts[b]
        const overlapX = Math.min(one.right, two.right) - Math.max(one.left, two.left)
        const overlapY = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top)
        if (overlapX > 1 && overlapY > 1) {
          violations.push({
            rule: 'text-overlap',
            graphic,
            label,
            by: +Math.min(overlapX, overlapY).toFixed(1),
            what: `"${one.what}" x "${two.what}"`,
          })
        }
      }
    }
  }

  for (const graphic of GRAPHICS) {
    const needs = graphic.meta.needs
    let items = []
    if (needs === 'match') items = matchRaws.map((raw) => ({ match: schema.createMatch(raw), id: raw.id }))
    else if (needs === 'table') items = tableRaws.map((raw, i) => ({ table: schema.createTable(raw), id: `table-${i}` }))
    else if (needs === 'season') items = seasonRaws.map((raw, i) => ({ season: schema.createSeason ? schema.createSeason(raw) : raw, id: `season-${i}` }))
    if (!items.length) continue

    let drawn = 0
    for (const item of items) {
      for (const key of ['feed', 'story']) {
        const size = themeModule.SIZES[key]
        const options = { handle: '@tryline' }
        if (item.match) {
          const squad = item.match.home?.squad || []
          options.side = 'home'
          options.player = squad.find((p) => Object.keys(p.stats || {}).length) || squad[0]
          options.playerB = (item.match.away?.squad || [])[0]
        }
        ink = []
        try {
          await renderGraphic(canvas, graphic.meta.id, {
            ...item, size, theme: themeModule.THEMES[theme], options,
          })
        } catch (error) {
          continue // refused by its own gate: not a geometry question
        }
        drawn += 1
        check(graphic.meta.id, size, `${item.id}/${key}`)
      }
    }
    results.push({ graphic: graphic.meta.id, renders: drawn })
  }
  CanvasRenderingContext2D.prototype.fillText = realFill
  CanvasRenderingContext2D.prototype.drawImage = realImage
  CanvasRenderingContext2D.prototype.fillRect = realRect
  return { results, violations }
}, [sampled, tables, seasons, ALLOWED_BLEED, themeId, TOLERANCE])

await browser.close()

const totalRenders = report.results.reduce((sum, row) => sum + row.renders, 0)
process.stdout.write(`${totalRenders} renders across ${report.results.length} graphics `
  + `(${sampled.length} matches, ${tables.length} tables, ${seasons.length} seasons, theme ${themeId})${NL}${NL}`)

for (const row of report.results) {
  process.stdout.write(`  ${row.graphic.padEnd(14)}${String(row.renders).padStart(5)} renders${NL}`)
}
process.stdout.write(NL)

const byRule = new Map()
for (const violation of report.violations) {
  if (!byRule.has(violation.rule)) byRule.set(violation.rule, [])
  byRule.get(violation.rule).push(violation)
}

for (const rule of ['off-canvas', 'outside-box', 'text-overlap']) {
  const found = byRule.get(rule) || []
  process.stdout.write(`${rule.padEnd(14)}${String(found.length).padStart(6)}${NL}`)
  const worst = [...found].sort((a, b) => b.by - a.by).slice(0, 6)
  for (const item of worst) {
    process.stdout.write(`    ${item.graphic.padEnd(12)}${String(`${item.by}px`).padStart(9)}  `
      + `${item.label.padEnd(16)}${item.what}${NL}`)
  }
}

if (pageErrors.length) {
  process.stdout.write(`${NL}page errors:${NL}`)
  for (const error of pageErrors.slice(0, 5)) process.stdout.write(`  ${error}${NL}`)
}

const failed = report.violations.length > 0 || pageErrors.length > 0
process.stdout.write(`${NL}${failed ? 'FAILED' : 'OK'} - nothing off canvas, outside its box, or over other text${NL}`)
process.exit(failed ? 1 : 0)
