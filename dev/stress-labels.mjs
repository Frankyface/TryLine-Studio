/**
 * Stress the win-probability label placement against every real match.
 *
 * A flattering demo fixture hid a defect present in 68% of real matches, so
 * this runs the actual placement code over the whole archive, in a browser so
 * text measurement is real, and reports collisions.
 *
 * Usage: node dev/stress-labels.mjs [--url http://localhost:4321]
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
const urlIndex = process.argv.indexOf('--url')
const baseUrl = urlIndex === -1 ? 'http://localhost:4321' : process.argv[urlIndex + 1]

const matches = []
for (const competitionId of readdirSync(dataDir)) {
  const matchDir = join(dataDir, competitionId, 'matches')
  if (!existsSync(matchDir)) continue
  for (const file of readdirSync(matchDir)) {
    const match = JSON.parse(readFileSync(join(matchDir, file), 'utf8'))
    if (match.status === 'final' && (match.timeline || []).length) {
      matches.push({ id: `${competitionId}/${file}`, match })
    }
  }
}

const model = JSON.parse(readFileSync(join(dataDir, 'models', 'winprob.json'), 'utf8'))

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${baseUrl}/dev/preview`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.body.dataset.renderState, null, { timeout: 30000 })

const report = await page.evaluate(async ({ entries, fittedModel }) => {
  const [
    { buildWinProbabilityCurve, keyMoments, FULL_TIME },
    { placeLabel, rectsOverlap, polylineHitsRect },
    { SIZES, FONTS },
    { winprobLayout },
  ] = await Promise.all([
    import('/src/analysis/winprob.js'),
    import('/src/render/labels.js'),
    import('/src/render/theme.js'),
    import('/src/render/graphics/winprob.js'),
  ])

  const timelineMarks = { try: 'TRY', penaltyTry: 'PEN TRY', conversion: 'CON', penalty: 'PEN', dropGoal: 'DG', yellowCard: 'YC', redCard: 'RC' }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  const totals = { instances: 0, curveHits: 0, labelOverlaps: 0, offPanel: 0, fallbacks: 0 }
  const worst = []

  for (const size of Object.values(SIZES)) {
    const scale = (v) => Math.round((v * size.width) / 1080)
    const isStory = size.height > size.width

    for (const entry of entries) {
      const curve = buildWinProbabilityCurve(entry.match, fittedModel)
      const moments = keyMoments(entry.match, fittedModel, isStory ? 4 : 3)
      if (!moments.length) continue
      totals.instances += 1

      // The caption changes the chart height, so the layout must be asked for
      // the same way the graphic asks for it.
      const match = entry.match
      const played = match.home.score !== null && match.away.score !== null
      const isDraw = played && match.home.score === match.away.score
      const homeWon = played && match.home.score > match.away.score
      const chanceAt = (p) => (homeWon ? p.homeWin : 1 - p.homeWin)
      const lowest = played && !isDraw
        ? curve.slice(1).reduce((worstPoint, p) => (chanceAt(p) < worstPoint.chance
          ? { chance: chanceAt(p), minute: p.minute } : worstPoint), { chance: 1, minute: 1 })
        : null
      const showCaption = Boolean(lowest) && lowest.chance < 0.45
        && lowest.chance < chanceAt(curve[0]) - 0.05

      const { plot, radius, labelSize, gap } = winprobLayout(size, { showCaption })
      ctx.font = `700 ${labelSize}px "${FONTS.body}", Arial, sans-serif`

      const points = curve.map((p) => ({
        x: plot.left + plot.width * (p.minute / FULL_TIME),
        y: plot.top + plot.height * (1 - p.homeWin),
      }))

      const placed = []
      let curveHit = false
      let overlap = false
      let off = false

      for (const moment of moments) {
        const rawX = plot.left + plot.width * (moment.minute / FULL_TIME)
        const x = Math.min(Math.max(rawX, plot.left + radius), plot.right - radius)
        const y = plot.top + plot.height * (1 - moment.homeWin)
        const marks = (moment.types || [moment.type]).map((t) => timelineMarks[t]).filter(Boolean)
        const label = `${[...new Set(marks)].join('+')} ${moment.minute}'`
        const width = ctx.measureText(label).width

        const spot = placeLabel({
          anchorX: x, anchorY: y, width, height: labelSize, gap,
          bounds: { left: plot.left, right: plot.right, top: plot.top - scale(4), bottom: plot.bottom },
          obstacles: placed, polyline: points,
        })

        if (spot.collisions) totals.fallbacks += 1
        if (polylineHitsRect(spot.rect, points)) curveHit = true
        if (placed.some((r) => rectsOverlap(spot.rect, r))) overlap = true
        if (spot.rect.left < plot.left - 1 || spot.rect.right > plot.right + 1) off = true
        placed.push(spot.rect)
      }

      if (curveHit) totals.curveHits += 1
      if (overlap) totals.labelOverlaps += 1
      if (off) totals.offPanel += 1
      if ((curveHit || overlap) && worst.length < 6) worst.push(`${entry.id} (${size.id})`)
    }
  }
  return { totals, worst }
}, { entries: matches, fittedModel: model })

await browser.close()

const { totals, worst } = report
const pct = (n) => `${((n / totals.instances) * 100).toFixed(1)}%`
process.stdout.write(`chart instances checked      ${totals.instances}\n`)
process.stdout.write(`label crosses the curve      ${totals.curveHits} (${pct(totals.curveHits)})   was 68.0%\n`)
process.stdout.write(`labels overlap each other    ${totals.labelOverlaps} (${pct(totals.labelOverlaps)})   was 12.0%\n`)
process.stdout.write(`label outside the panel      ${totals.offPanel} (${pct(totals.offPanel)})\n`)
process.stdout.write(`placements needing fallback  ${totals.fallbacks}\n`)
if (worst.length) process.stdout.write(`remaining cases: ${worst.join(', ')}\n`)

/**
 * Thresholds, not perfection. A label that crosses the curve still carries a
 * background halo and stays readable, so a small tail is acceptable; two labels
 * on top of each other, or one off the panel, never is.
 */
const MAX_CURVE_HIT_SHARE = 0.05

const failures = []
if (totals.curveHits / totals.instances > MAX_CURVE_HIT_SHARE) {
  failures.push(`curve crossings ${pct(totals.curveHits)} exceed ${MAX_CURVE_HIT_SHARE * 100}%`)
}
if (totals.labelOverlaps > 0) failures.push(`${totals.labelOverlaps} label overlaps`)
if (totals.offPanel > 0) failures.push(`${totals.offPanel} labels outside the panel`)

process.stdout.write(failures.length
  ? `FAIL: ${failures.join('; ')}\n`
  : 'label placement within thresholds\n')
