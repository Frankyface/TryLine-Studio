/**
 * Which crests need a plate behind them, per theme.
 *
 * `drawCrest` used to decide this from the crest's MEAN luminance, and a mean
 * cannot see the case that matters: a crest can average bright while the part
 * carrying the club's name is invisible. Ulster is a bright red hand over a
 * near-black "ULSTER"; Edinburgh a red castle over a dark blue "EDINBURGH".
 * Both averaged clear of the bar, neither was plated, and on every dark theme
 * you could not read either club's name.
 *
 * The measure here is the AREA OF THE LARGEST CONNECTED BLANK REGION, which is
 * the thing a reader actually notices - a solid missing wordmark, not scattered
 * dark pixels. Four stages, each added because a specific crest demanded it:
 *
 *  - Only EXPOSED ink counts (within 6px of a transparent pixel). Without it
 *    the Sharks' black box scores 80% dead when it is a field behind white
 *    lettering that reads perfectly.
 *  - A cell is blank only when nothing legible survives in it, so Fiji's white
 *    "FIJI RUGBY" on its own dark band is not counted as lost.
 *  - Score by AREA, not by cell count, or a flag's one-cell dark rim outscores
 *    a missing wordmark.
 *  - A PLATE-GAIN GATE: never plate a crest that is no better plated. Ospreys
 *    measures worse on the plate than off it, and Connacht's white "CONNACHT"
 *    dies on a white plate.
 *
 * The 1.5:1 bar is the highest that leaves the crests CLAUDE.md says read fine
 * alone: at 2.0 Scotland goes 0.00 -> 0.59, Romania 0.02 -> 0.65 and Sale
 * Sharks 0.00 -> 0.95, all of which are legible in the rendered output.
 *
 * Computed against `pageSurface`, and at a FIXED reference size, for reasons
 * that are not cosmetic - see the two notes by SURFACE and REFERENCE below.
 *
 * Written to data/models/crest-plating.json.
 * Usage: node scripts/build-crest-plating.mjs [--check] [--threshold 0.15]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const crestDir = join(root, 'assets', 'crests')
const dataDir = join(root, 'data')
const NL = String.fromCharCode(10)

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const THRESHOLD = Number(arg('threshold', '0.15'))
const checkOnly = process.argv.includes('--check')

/** Team colours give each crest the accent its own card would use. */
const teamColours = existsSync(join(dataDir, 'models', 'team-colours.json'))
  ? JSON.parse(readFileSync(join(dataDir, 'models', 'team-colours.json'), 'utf8')).colours
  : {}

const crests = readdirSync(crestDir)
  .filter((name) => name.endsWith('@320.png'))
  .map((name) => name.replace('@320.png', ''))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 400, height: 400 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
await page.goto('http://localhost:4321/dev/preview?only=result', { waitUntil: 'networkidle' })

const rows = await page.evaluate(async ([files, colours, threshold]) => {
  const [{ pageSurface, contrastRatio, toRgb, composite }, themeModule] = await Promise.all([
    import('/src/render/primitives.js'), import('/src/render/theme.js'),
  ])

  /**
   * REFERENCE: one size for every decision.
   *
   * The same crest scores differently at different sizes - Ulster falls from
   * 0.202 at 300px to 0.149 at 120px, because thin wordmark strokes antialias
   * below the ink test. Deciding per drawn box would plate a club on one card
   * and not on another, so every score is taken at 300px from the @320 file.
   */
  const BOX = 300
  const ALPHA_INK = 0.75 * 255
  const EXPOSURE = 6
  const CELLS = 32
  const DEAD_CELL = 0.15
  const LIVE_CELL = 0.25
  const BAR = 1.5

  const load = (src) => new Promise((resolve) => {
    const image = new Image()
    image.onerror = () => resolve(null)
    image.onload = () => resolve(image)
    image.src = src
  })

  const canvas = document.createElement('canvas')
  canvas.width = BOX
  canvas.height = BOX
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  /** Composite a crest pixel over the page and ask if it survives. */
  const score = (image, surfaceRgb, plateFill) => {
    ctx.clearRect(0, 0, BOX, BOX)
    if (plateFill) {
      ctx.fillStyle = plateFill
      ctx.fillRect(0, 0, BOX, BOX)
    }
    const ratio = Math.min(BOX / image.width, BOX / image.height)
    const width = image.width * ratio
    const height = image.height * ratio
    ctx.drawImage(image, (BOX - width) / 2, (BOX - height) / 2, width, height)
    const { data } = ctx.getImageData(0, 0, BOX, BOX)

    const isInk = new Uint8Array(BOX * BOX)
    const isDead = new Uint8Array(BOX * BOX)
    let ink = 0
    for (let index = 0; index < BOX * BOX; index += 1) {
      const at = index * 4
      const alpha = data[at + 3]
      if (alpha < ALPHA_INK) continue
      isInk[index] = 1
      ink += 1
      // Composited over the page it lands on, never over a token.
      const mix = alpha / 255
      const over = [0, 1, 2].map((channel) =>
        data[at + channel] * mix + surfaceRgb[channel] * (1 - mix))
      if (contrastRatio(`rgb(${over.map(Math.round).join(',')})`, `rgb(${surfaceRgb.join(',')})`) < BAR) {
        isDead[index] = 1
      }
    }
    if (!ink) return { blankArea: 0, deadExposed: 0, ink: 0 }

    // EXPOSED ink only: ink near a transparent pixel, whose legibility depends
    // on the page rather than on the crest's own field behind it.
    const exposed = new Uint8Array(BOX * BOX)
    let deadExposed = 0
    let exposedCount = 0
    for (let y = 0; y < BOX; y += 1) {
      for (let x = 0; x < BOX; x += 1) {
        const index = y * BOX + x
        if (!isInk[index]) continue
        let near = false
        for (let dy = -EXPOSURE; dy <= EXPOSURE && !near; dy += EXPOSURE) {
          for (let dx = -EXPOSURE; dx <= EXPOSURE && !near; dx += EXPOSURE) {
            const ny = y + dy
            const nx = x + dx
            if (ny < 0 || nx < 0 || ny >= BOX || nx >= BOX) { near = true; break }
            if (!isInk[ny * BOX + nx]) near = true
          }
        }
        if (near) {
          exposed[index] = 1
          exposedCount += 1
          if (isDead[index]) deadExposed += 1
        }
      }
    }

    // Grid it, and mark a cell blank only where nothing legible survives.
    const step = BOX / CELLS
    const blank = new Uint8Array(CELLS * CELLS)
    const cellDeadArea = new Float64Array(CELLS * CELLS)
    for (let cy = 0; cy < CELLS; cy += 1) {
      for (let cx = 0; cx < CELLS; cx += 1) {
        let cellInk = 0
        let cellDead = 0
        let cellLive = 0
        for (let y = Math.floor(cy * step); y < Math.floor((cy + 1) * step); y += 1) {
          for (let x = Math.floor(cx * step); x < Math.floor((cx + 1) * step); x += 1) {
            const index = y * BOX + x
            if (!isInk[index]) continue
            cellInk += 1
            if (exposed[index] && isDead[index]) cellDead += 1
            else if (!isDead[index]) cellLive += 1
          }
        }
        if (!cellInk) continue
        const cell = cy * CELLS + cx
        cellDeadArea[cell] = cellDead
        if (cellDead / (step * step) >= DEAD_CELL && cellLive / cellInk < LIVE_CELL) blank[cell] = 1
      }
    }

    // Largest 8-connected run of blank cells, weighted by dead AREA - a rim of
    // single cells around a flag is not a missing wordmark.
    const seen = new Uint8Array(CELLS * CELLS)
    let largest = 0
    for (let start = 0; start < CELLS * CELLS; start += 1) {
      if (!blank[start] || seen[start]) continue
      const stack = [start]
      seen[start] = 1
      let area = 0
      while (stack.length) {
        const cell = stack.pop()
        area += cellDeadArea[cell]
        const cy = Math.floor(cell / CELLS)
        const cx = cell % CELLS
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ny = cy + dy
            const nx = cx + dx
            if (ny < 0 || nx < 0 || ny >= CELLS || nx >= CELLS) continue
            const next = ny * CELLS + nx
            if (blank[next] && !seen[next]) { seen[next] = 1; stack.push(next) }
          }
        }
      }
      if (area > largest) largest = area
    }
    /**
     * Against TOTAL ink. Dividing by exposed ink instead was tried, to stop a
     * large bright crest burying a small dead wordmark - and it plated 22% of
     * all pairs, with national flags scoring 0.77 to 0.98, which is the
     * "plates a third of all crests" outcome docs/decisions.md rejects. The
     * cost of this denominator is real and is paid knowingly: Edinburgh's
     * wordmark is a small share of a big crest and scores low.
     */
    return { blankArea: largest / ink, deadExposed: deadExposed / ink, ink }
  }

  const out = []
  for (const file of files) {
    const image = await load(file.src)
    if (!image) { out.push({ id: file.id, error: 'load failed' }); continue }

    for (const theme of Object.values(themeModule.THEMES)) {
      /**
       * SURFACE: the page as `pageSurface` composites it, not the pixel under
       * one particular card. The same crest is dead inside the accent glow and
       * alive 500px below it - Fijian Drua swings from 0.737 to 0.000 - so a
       * per-position answer plates a club on one graphic and not another.
       */
      const accent = file.accent || theme.accent
      const surface = pageSurface(theme, accent)
      const surfaceRgb = toRgb(surface)
      const light = surfaceRgb[0] * 0.299 + surfaceRgb[1] * 0.587 + surfaceRgb[2] * 0.114 > 128
      const plateFill = light ? 'rgba(11,18,32,0.42)' : 'rgba(255,255,255,0.92)'

      /**
       * DARK themes only.
       *
       * A plate on a light theme is a dark wash behind the crest, and on the
       * cards it is a grey box around a logo that was readable to begin with.
       * The light-theme plates were dropped on that basis, so nothing here
       * evaluates them.
       */
      if (light) {
        out.push({ id: file.id, theme: theme.id, blankArea: 0, platedDead: null, plate: false })
        continue
      }
      const bare = score(image, surfaceRgb, null)
      const needs = bare.blankArea >= threshold
      // The gate: only plate when the crest actually survives ON the plate.
      //
      // The plate is TRANSLUCENT, so the surface it presents is the fill
      // composited over the page - not the fill's own colour. Reading it as
      // solid made the light themes' 42% dark plate look like near-black, so
      // every dark crest scored dead on it and the gate rejected all of them:
      // 0 plated on chalk and slate where 2 and 3 are needed.
      const plateOver = light
        ? composite('#0B1220', 0.42, surface)
        : composite('#FFFFFF', 0.92, surface)
      const plated = needs ? score(image, toRgb(plateOver), plateFill) : null
      out.push({
        id: file.id,
        theme: theme.id,
        blankArea: Number(bare.blankArea.toFixed(4)),
        platedDead: plated ? Number(plated.deadExposed.toFixed(4)) : null,
        plate: Boolean(needs && plated && plated.deadExposed <= 0.10),
      })
    }
  }
  return out
}, [
  crests.map((id) => ({
    id,
    accent: teamColours[id]?.primary || '',
    src: `data:image/png;base64,${readFileSync(join(crestDir, `${id}@320.png`)).toString('base64')}`,
  })),
  teamColours,
  THRESHOLD,
])

await browser.close()

// Highest scorers per theme, so a run says WHICH crests it is deciding about.
const byTheme = new Map()
for (const row of rows) {
  if (row.error) continue
  if (!byTheme.has(row.theme)) byTheme.set(row.theme, [])
  byTheme.get(row.theme).push(row)
}
const names = existsSync(join(dataDir, 'models', 'team-colours.json'))
  ? JSON.parse(readFileSync(join(dataDir, 'models', 'team-colours.json'), 'utf8')).colours
  : {}
// Named crests, so a threshold can be argued about with numbers.
const WATCH = ['25926', '25951', '25932', '25920', '25907']
for (const id of WATCH) {
  const mine = rows.filter((row) => row.id === id && row.theme === 'midnight')[0]
  if (mine) {
    process.stdout.write(`  watch ${(names[id]?.name || id).padEnd(20)}`
      + `blankArea ${mine.blankArea.toFixed(3)}  platedDead `
      + `${mine.platedDead === null ? '-' : mine.platedDead.toFixed(3)}  plate ${mine.plate}${NL}`)
  }
}
process.stdout.write(NL)

for (const [theme, list] of [...byTheme.entries()].sort()) {
  const top = [...list].sort((a, b) => b.blankArea - a.blankArea).slice(0, 5)
  process.stdout.write(`${theme}: ` + top.map((row) =>
    `${(names[row.id]?.name || row.id).slice(0, 16)} ${row.blankArea.toFixed(3)}${row.plate ? '*' : ''}`).join('  |  ') + NL)
}
process.stdout.write(NL)

const plating = {}
const perTheme = new Map()
let pairs = 0
for (const row of rows) {
  if (row.error) continue
  pairs += 1
  if (!row.plate) continue
  plating[row.id] = plating[row.id] || []
  plating[row.id].push(row.theme)
  perTheme.set(row.theme, (perTheme.get(row.theme) || 0) + 1)
}

const payload = { threshold: THRESHOLD, crests: crests.length, plating }

process.stdout.write(`${crests.length} crests x ${perTheme.size || 7} themes = ${pairs} pairs, `
  + `threshold ${THRESHOLD}${NL}${NL}`)
for (const [theme, count] of [...perTheme.entries()].sort()) {
  process.stdout.write(`  ${theme.padEnd(11)}${String(count).padStart(3)} plated${NL}`)
}
const total = [...perTheme.values()].reduce((sum, count) => sum + count, 0)
process.stdout.write(`${NL}  ${String(total).padStart(14)} of ${pairs} pairs `
  + `(${((total / Math.max(1, pairs)) * 100).toFixed(1)}%)${NL}`)

if (checkOnly) {
  process.stdout.write(`${NL}nothing written${NL}`)
} else {
  mkdirSync(join(dataDir, 'models'), { recursive: true })
  writeFileSync(join(dataDir, 'models', 'crest-plating.json'), `${JSON.stringify(payload)}${NL}`)
  process.stdout.write(`${NL}wrote data/models/crest-plating.json${NL}`)
}
if (pageErrors.length) process.stdout.write(`page errors: ${pageErrors.slice(0, 3).join(' | ')}${NL}`)
