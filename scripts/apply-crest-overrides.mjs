/**
 * Hand-supplied crests, rendered into assets/crests at the sizes the app draws.
 *
 * WHY: ESPN has no crest at all for some clubs (Vannes, Bayonne and Perpignan
 * are permanent 404s, so they drew as monograms) and its "500px" originals
 * measure 160px wide for the rest, drawn at up to 300px on a result card. A
 * club's own vector badge renders crisp at every size. But a file simply
 * dropped into assets/crests does not survive the week: `npm run refresh`
 * re-downloads every crest ESPN serves and blanks every one it does not, so
 * the file would be overwritten or orphaned on the next run. This step runs
 * AFTER mirror-crests in the chain and wins.
 *
 * scripts/crest-overrides.json:
 *   sources - team id -> file under assets/crest-sources (svg or png)
 *   aliases - team id -> another team id whose crest it shares. ESPN gives one
 *             club different ids in the standings and the scoreboard: Pau is
 *             270567 in match files and 289553 in the Top 14 table. An alias
 *             points the second id at the first's files rather than shipping a
 *             copy.
 *
 * A raster source is never upscaled - the file for a size larger than the
 * source is written at the source's own size, as mirror-crests does - so a
 * 96px badge is reported for what it is rather than blurred into a 320px file.
 *
 * Usage: node scripts/apply-crest-overrides.mjs [--check]
 */
import { chromium } from 'playwright'
import { CREST_SIZES } from '../src/render/crest-sizes.js'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dataDir = join(root, 'data')
const crestDir = join(root, 'assets', 'crests')
const sourceDir = join(root, 'assets', 'crest-sources')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

const { sources = {}, aliases = {} } = JSON.parse(readFileSync(join(here, 'crest-overrides.json'), 'utf8'))

/** Where an id's crest files live: its own, or the id it is an alias of. */
const targetOf = (id) => aliases[id] ?? (sources[id] ? id : null)

/** Every JSON file that might carry a team. Same sweep as the crests test. */
function dataFiles() {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.json')) files.push(path)
    }
  }
  if (existsSync(dataDir)) walk(dataDir)
  return files
}

const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * The shape of an SVG, from its viewBox or its width and height attributes.
 * A browser Image reports 300x150 for an SVG that declares neither, which
 * would silently squash the badge - so refuse rather than guess.
 */
function svgBox(text) {
  const viewBox = text.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1]?.trim().split(/[\s,]+/).map(Number)
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) return { width: viewBox[2], height: viewBox[3] }
  const width = parseFloat(text.match(/<svg[^>]*\swidth\s*=\s*"([^"]+)"/i)?.[1])
  const height = parseFloat(text.match(/<svg[^>]*\sheight\s*=\s*"([^"]+)"/i)?.[1])
  if (width > 0 && height > 0) return { width, height }
  throw new Error('SVG has no viewBox and no width/height - nothing says its shape')
}

const fail = (message) => {
  process.stderr.write(`crest-overrides: ${message}${NL}`)
  process.exit(1)
}

for (const [id, file] of Object.entries(sources)) {
  if (!existsSync(join(sourceDir, file))) fail(`source for ${id} is missing: assets/crest-sources/${file}`)
  if (!MIME[extname(file).toLowerCase()]) fail(`${file} is not an svg, png, webp or jpg`)
}
for (const [id, target] of Object.entries(aliases)) {
  const onDisk = CREST_SIZES.every((size) => existsSync(join(crestDir, `${target}@${size}.png`)))
  if (!sources[target] && !onDisk) fail(`alias ${id} -> ${target}, but ${target} has no crest on disk`)
}

process.stdout.write(`${Object.keys(sources).length} hand-supplied crest(s), ${Object.keys(aliases).length} alias(es)${NL}`)
if (checkOnly) {
  process.stdout.write(`Would render ${Object.keys(sources).length} crest(s) and repoint the data - nothing written${NL}`)
  process.exit(0)
}

mkdirSync(crestDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')

for (const [id, file] of Object.entries(sources)) {
  const ext = extname(file).toLowerCase()
  const bytes = readFileSync(join(sourceDir, file))
  const src = `data:${MIME[ext]};base64,${bytes.toString('base64')}`
  const box = ext === '.svg' ? svgBox(bytes.toString('utf8')) : null

  const encoded = await page.evaluate(async ({ src, sizes, box }) => {
    const image = await new Promise((resolve) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => resolve(null)
      element.src = src
    })
    if (!image) return null
    const width = box?.width || image.naturalWidth
    const height = box?.height || image.naturalHeight
    if (!width || !height) return null
    const vector = Boolean(box)

    return sizes.map((size) => {
      // A vector scales to any size; a raster is never grown past itself.
      const longest = Math.max(width, height)
      const ratio = vector ? size / longest : Math.min(1, size / longest)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return { size, width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL('image/png') }
    })
  }, { src, sizes: CREST_SIZES, box })

  if (!encoded) fail(`Chromium could not decode assets/crest-sources/${file}`)

  const written = []
  for (const { size, width, height, dataUrl } of encoded) {
    writeFileSync(join(crestDir, `${id}@${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
    const longest = Math.max(width, height)
    written.push(`@${size} ${width}x${height}${longest < size ? ` (source is only ${longest}px)` : ''}`)
  }
  process.stdout.write(`${id} <- ${file}: ${written.join(', ')}${NL}`)
}

await browser.close()

/**
 * A copy of `node` with every overridden team's logo repointed at its crest,
 * or the node itself when nothing applies - so the caller can tell whether the
 * file needs rewriting at all.
 */
function repointed(node) {
  if (Array.isArray(node)) {
    const next = node.map(repointed)
    return next.some((entry, index) => entry !== node[index]) ? next : node
  }
  if (!node || typeof node !== 'object') return node

  const target = typeof node.logo === 'string' && node.id != null ? targetOf(String(node.id)) : null
  let changed = false
  const next = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'logo' && target) {
      next[key] = `assets/crests/${target}`
      if (next[key] !== value) changed = true
      continue
    }
    next[key] = repointed(value)
    if (next[key] !== value) changed = true
  }
  return changed ? next : node
}

let rewritten = 0
for (const path of dataFiles()) {
  let payload
  try { payload = JSON.parse(readFileSync(path, 'utf8')) } catch { continue }
  const next = repointed(payload)
  if (next !== payload) {
    writeFileSync(path, `${JSON.stringify(next)}${NL}`)
    rewritten += 1
  }
}
process.stdout.write(`${rewritten} data file(s) repointed${NL}`)
