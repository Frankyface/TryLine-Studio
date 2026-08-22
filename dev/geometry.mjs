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
 *   3. No two pieces of text overlap each other, and no text is printed over
 *      a filled bar such as the winner's underline.
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
/**
 * Every Nth match PLUS the extremes of everything that drives layout.
 *
 * Uniform sampling is the wrong instrument here. The heading that bit a notch
 * out of the winner's accent bar did so on two matches in 1,147 - both of them
 * scorer-heavy - and `--every 30` sailed past it twice. Layout faults live at
 * the ends of distributions, so the ends are always in the sample: the longest
 * names, the most scorers, the biggest scores, the fixtures with no kick-off
 * time, the finished matches with no timeline.
 */
const extremesOf = (list, score, count = 3) => [...list]
  .map((match) => ({ match, key: score(match) }))
  .filter((entry) => Number.isFinite(entry.key))
  .sort((a, b) => b.key - a.key)
  .slice(0, count)
  .map((entry) => entry.match)

const scorerCount = (match) => (match.timeline || [])
  .filter((event) => event.player).length
const nameLength = (match) => Math.max(
  String(match.home?.name || '').length,
  String(match.away?.name || '').length,
)
const totalScore = (match) => (match.home?.score ?? 0) + (match.away?.score ?? 0)

const chosen = new Map()
for (const match of matches.filter((_, index) => index % every === 0)) chosen.set(match.id, match)
for (const match of [
  ...extremesOf(matches, scorerCount),
  ...extremesOf(matches, nameLength),
  ...extremesOf(matches, totalScore),
  ...extremesOf(matches, (match) => (match.home?.score === null ? 1 : 0), 3),
  ...extremesOf(matches, (match) => (match.home?.score !== null && !(match.timeline || []).length ? 1 : 0), 3),
]) chosen.set(match.id, match)
const sampled = [...chosen.values()]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
await page.goto('http://localhost:4321/dev/preview?only=result', { waitUntil: 'networkidle' })

const report = await page.evaluate(async ([matchRaws, tableRaws, seasonRaws, allowed, theme, TOLERANCE]) => {
  const [{ GRAPHICS, renderGraphic }, schema, themeModule, { contentBox },
    { blockingReason }, primitives] = await Promise.all([
    import('/src/render/index.js'), import('/src/data/schema.js'),
    import('/src/render/theme.js'), import('/src/render/frame.js'),
    import('/src/render/availability.js'), import('/src/render/primitives.js'),
  ])
  const canvas = document.createElement('canvas')

  let ink = []
  let bars = []
  const realFill = CanvasRenderingContext2D.prototype.fillText
  const realImage = CanvasRenderingContext2D.prototype.drawImage
  const realRect = CanvasRenderingContext2D.prototype.fillRect
  const realPathFill = CanvasRenderingContext2D.prototype.fill
  const restore = []

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

  /**
   * Filled bars, so that text drawn OVER one is visible to this harness.
   *
   * A review found the SCORERS heading biting a notch out of the winner's
   * accent bar - and the guard could not see it, because the bar is a filled
   * rounded rect and only text was being compared against text. Small fills
   * only: row stripes, panels and the backdrop are full-bleed by design.
   */
  // The path being built, tracked point by point: `roundRect` here is drawn
  // with moveTo/arcTo rather than the canvas primitive, so wrapping
  // `ctx.roundRect` sees nothing at all - which is why the first version of
  // this check reported zero bars on a card that visibly has one.
  let path = null
  const extend = (context, x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const point = mapped(context.getTransform(), x, y, x, y)
    if (!path) path = { left: point.left, right: point.right, top: point.top, bottom: point.bottom }
    else {
      path.left = Math.min(path.left, point.left)
      path.right = Math.max(path.right, point.right)
      path.top = Math.min(path.top, point.top)
      path.bottom = Math.max(path.bottom, point.bottom)
    }
  }
  const realBegin = CanvasRenderingContext2D.prototype.beginPath
  const realMove = CanvasRenderingContext2D.prototype.moveTo
  const realLine = CanvasRenderingContext2D.prototype.lineTo
  const realArcTo = CanvasRenderingContext2D.prototype.arcTo
  const realArc = CanvasRenderingContext2D.prototype.arc
  restore.push(() => {
    CanvasRenderingContext2D.prototype.beginPath = realBegin
    CanvasRenderingContext2D.prototype.moveTo = realMove
    CanvasRenderingContext2D.prototype.lineTo = realLine
    CanvasRenderingContext2D.prototype.arcTo = realArcTo
    CanvasRenderingContext2D.prototype.arc = realArc
  })
  CanvasRenderingContext2D.prototype.beginPath = function patched() {
    path = null
    return realBegin.call(this)
  }
  CanvasRenderingContext2D.prototype.moveTo = function patched(x, y) {
    extend(this, x, y)
    return realMove.call(this, x, y)
  }
  CanvasRenderingContext2D.prototype.lineTo = function patched(x, y) {
    extend(this, x, y)
    return realLine.call(this, x, y)
  }
  CanvasRenderingContext2D.prototype.arcTo = function patched(x1, y1, x2, y2, r) {
    extend(this, x1, y1)
    extend(this, x2, y2)
    return realArcTo.call(this, x1, y1, x2, y2, r)
  }
  CanvasRenderingContext2D.prototype.arc = function patched(x, y, r, ...rest) {
    extend(this, x - r, y - r)
    extend(this, x + r, y + r)
    return realArc.call(this, x, y, r, ...rest)
  }
  CanvasRenderingContext2D.prototype.fill = function patched(...rest) {
    if (path) {
      const width = path.right - path.left
      const height = path.bottom - path.top
      // A FLAT bar specifically - the winner's underline is 64x6. A monogram
      // disc is square and a pill is tall, and text sitting on either of those
      // is the whole point of drawing them, so both are excluded by shape
      // rather than by name.
      const flat = height <= 20 && width >= height * 3 && width <= 400
      if (flat) bars.push({ kind: 'bar', what: 'bar', size: width, ...path })
    }
    return realPathFill.apply(this, rest)
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

    // Text over a filled bar. The winner's underline on a result card is one,
    // and a heading printed a notch out of it on a real match.
    for (const text of ink.filter((item) => item.kind === 'text' && item.what.trim())) {
      for (const bar of bars) {
        const overlapX = Math.min(text.right, bar.right) - Math.max(text.left, bar.left)
        const overlapY = Math.min(text.bottom, bar.bottom) - Math.max(text.top, bar.top)
        if (overlapX > 1 && overlapY > 1) {
          violations.push({
            rule: 'text-on-bar',
            graphic,
            label,
            by: +Math.min(overlapX, overlapY).toFixed(1),
            what: `"${text.what}" on a bar`,
          })
        }
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
        // The APP's gate, not whether draw() happens to throw. Relying on the
        // throw rendered graphics in states the app never offers - a team
        // sheet with no squad draws a header over an empty card - and then
        // measured them as though they were real output.
        if (blockingReason(graphic, { ...item, source: 'espn' }, options)) continue
        ink = []
        bars = []
        try {
          await renderGraphic(canvas, graphic.meta.id, {
            ...item, size, theme: themeModule.THEMES[theme], options,
          })
        } catch (error) {
          continue
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
  CanvasRenderingContext2D.prototype.fill = realPathFill
  for (const undo of restore) undo()
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

for (const rule of ['off-canvas', 'outside-box', 'text-overlap', 'text-on-bar']) {
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
