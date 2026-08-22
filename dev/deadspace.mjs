/**
 * How much of each graphic is dead canvas: the largest run of consecutive
 * near-empty pixel rows inside the area the format actually uses.
 *
 * "The story format is the feed layout letterboxed into 9:16" sat in the notes
 * as an opinion for weeks. Measured, it was true of exactly two graphics -
 * result (37% inked, a 290px dead band) and matchday (37%, 263px) - while the
 * other nine sat at 6-10%, which is ordinary spacing between sections. Two
 * graphics got fixed and nine did not need touching.
 *
 * A row counts as inked when some pixel on it differs sharply from its
 * neighbour four across. The threshold has to clear the backdrop's own
 * diagonal texture, which otherwise scores every row on the canvas as drawn.
 *
 * Usage: node dev/deadspace.mjs   (needs the static server on :4321)
 */
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
page.on('pageerror', (error) => console.error('PAGE ERROR', String(error)))
await page.goto('http://localhost:4321/dev/preview?theme=midnight', { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.body.dataset.renderState, null, { timeout: 30000 })

const report = await page.evaluate(async () => {
  const { STORY_SAFE_TOP, STORY_SAFE_BOTTOM } = await import('/src/render/theme.js')
  const rows = []
  for (const canvas of document.querySelectorAll('canvas')) {
    const { width, height } = canvas
    if (!width || !height) continue
    const isStory = height > width
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, width, height).data

    // Above the texture, below real ink: at 24 every row on every graphic
    // scored as drawn, which is the answer you get for measuring the wash.
    const THRESHOLD = 90
    const inkPerRow = []
    for (let y = 0; y < height; y += 1) {
      let ink = 0
      for (let x = 4; x < width - 4; x += 2) {
        const i = (y * width + x) * 4
        const j = (y * width + x - 4) * 4
        if (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1])
          + Math.abs(data[i + 2] - data[j + 2]) > THRESHOLD) ink += 1
      }
      inkPerRow.push(ink)
    }

    // Only the area the format is allowed to use: a story reserves 250px top
    // and bottom for Instagram's own chrome, and that is not dead canvas.
    const from = isStory ? STORY_SAFE_TOP : 0
    const to = isStory ? height - STORY_SAFE_BOTTOM : height
    let longest = 0
    let run = 0
    let at = 0
    for (let y = from; y < to; y += 1) {
      if (inkPerRow[y] <= 3) {
        run += 1
        if (run > longest) { longest = run; at = y - run }
      } else run = 0
    }
    const used = inkPerRow.slice(from, to).filter((ink) => ink > 3).length
    rows.push({
      id: canvas.id || canvas.dataset.graphic || '?',
      format: isStory ? 'story' : 'feed',
      usableRows: to - from,
      inkedRows: used,
      largestGap: longest,
      gapAt: at,
      gapShare: +(longest / (to - from)).toFixed(3),
    })
  }
  return rows
})

await browser.close()

const NL = String.fromCharCode(10)
report.sort((a, b) => b.gapShare - a.gapShare)
process.stdout.write(`${'graphic'.padEnd(26)}${'fmt'.padEnd(7)}inked  largest-gap  share${NL}`)
for (const row of report) {
  process.stdout.write(`${row.id.padEnd(26)}${row.format.padEnd(7)}`
    + `${String(Math.round((row.inkedRows / row.usableRows) * 100) + '%').padStart(5)}`
    + `${String(row.largestGap + 'px').padStart(13)}`
    + `${String(Math.round(row.gapShare * 100) + '%').padStart(7)}${NL}`)
}
