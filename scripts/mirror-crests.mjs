/**
 * Mirror team crests into the repo, at the sizes they are actually drawn.
 *
 * WHY: measured, ESPN's crest PNGs were 78% of a session's transfer - 765 KB,
 * and 597 KB to open a single league table. They are 500x500 originals drawn at
 * 40px in a table row. They also come from a third party with a 47-second cache
 * lifetime, sit on the mobile critical path (851ms of it), and are the one
 * resource that could taint the canvas and break PNG export.
 *
 * Two sizes are written because the graphics use two scales: table, scatter and
 * fortress marks are 36-52px, while the result and matchday crests reach 300px.
 *
 * Downscaling runs through headless Chromium rather than a native image
 * library, so this needs no dependency the project does not already have.
 *
 * Usage: node scripts/mirror-crests.mjs [--check]
 */
import { chromium } from 'playwright'
import { COMPETITIONS, isCountryFlag } from '../src/data/espn.js'
import { CREST_SIZES } from '../src/render/crest-sizes.js'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dataDir = join(root, 'data')
const crestDir = join(root, 'assets', 'crests')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`skipped unreadable ${path}: ${error.message}${NL}`)
    return null
  }
}

/** Every JSON file that might carry a crest url. */
function dataFiles() {
  const files = []
  for (const competitionId of readdirSync(dataDir)) {
    const competitionDir = join(dataDir, competitionId)
    if (!statSync(competitionDir).isDirectory()) continue
    for (const file of readdirSync(competitionDir)) {
      if (file.endsWith('.json')) files.push(join(competitionDir, file))
    }
    const matchDir = join(competitionDir, 'matches')
    if (!existsSync(matchDir)) continue
    for (const file of readdirSync(matchDir)) {
      if (file.endsWith('.json')) files.push(join(matchDir, file))
    }
  }
  return files
}

const REMOTE = /^https?:\/\//
const idOf = (url) => String(url).split('/').pop().replace(/\.[a-z]+$/i, '')

/** Walk any of our shapes and visit every object carrying a `logo`. */
function eachTeam(payload, visit) {
  if (!payload || typeof payload !== 'object') return
  if (typeof payload.logo === 'string') visit(payload)
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) value.forEach((entry) => eachTeam(entry, visit))
    else if (value && typeof value === 'object') eachTeam(value, visit)
  }
}

const files = dataFiles()
const remoteUrls = new Set()
for (const path of files) {
  eachTeam(readJson(path), (team) => {
    if (REMOTE.test(team.logo)) remoteUrls.add(team.logo)
  })
}

const nationalIds = new Set(
  COMPETITIONS.filter((competition) => competition.national).map((competition) => competition.id),
)

/**
 * repair-data spots a country-flag-as-club-crest by its ESPN url. Mirroring
 * rewrites that url to a local path the check can never match, and the
 * original is gone - so the flag is welded onto the club until a full refetch.
 * Refuse to run rather than destroy the evidence.
 */
const flagged = []
for (const path of files) {
  eachTeam(readJson(path), (team) => {
    if (REMOTE.test(team.logo) && isCountryFlag(team.logo)) flagged.push({ path, logo: team.logo })
  })
}
const clubFlags = flagged.filter(({ path }) => {
  const parts = path.split(/[\/]/)
  const competitionId = parts[parts.indexOf('data') + 1]
  return !nationalIds.has(competitionId)
})
if (clubFlags.length) {
  process.stderr.write(`${clubFlags.length} club team(s) are still using a country flag.${NL}`)
  process.stderr.write(`Run "npm run repair" FIRST - mirroring would make this permanent.${NL}`)
  process.exit(1)
}

process.stdout.write(`${files.length} data files, ${remoteUrls.size} distinct remote crest(s)${NL}`)
if (!remoteUrls.size) {
  process.stdout.write(`Nothing to mirror - all crests are already local.${NL}`)
  process.exit(0)
}
if (checkOnly) {
  process.stdout.write(`Would download and downscale ${remoteUrls.size} crest(s) - nothing written${NL}`)
  process.exit(0)
}

mkdirSync(crestDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('about:blank')

let saved = 0
let missing = 0
const localFor = new Map()

/** Crests ESPN no longer serves. Blanked so the monogram draws with no request. */
const dead = new Set()

for (const url of remoteUrls) {
  const id = idOf(url)
  const encoded = await page.evaluate(async ({ src, sizes }) => {
    const image = await new Promise((resolve) => {
      const element = new Image()
      element.crossOrigin = 'anonymous'
      element.onload = () => resolve(element)
      element.onerror = () => resolve(null)
      element.src = src
    })
    if (!image || !image.width) return null

    return sizes.map((size) => {
      const ratio = Math.min(1, size / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * ratio))
      canvas.height = Math.max(1, Math.round(image.height * ratio))
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return { size, dataUrl: canvas.toDataURL('image/png') }
    })
  }, { src: url, sizes: CREST_SIZES })

  if (!encoded) {
    // Measured: 13 of these are permanently 404 at ESPN. Keeping the URL made
    // the app retry them on every page view - a cross-origin request that
    // always fails, and a red 404 in the console of the live site.
    missing += 1
    dead.add(url)
    continue
  }

  for (const { size, dataUrl } of encoded) {
    writeFileSync(join(crestDir, `${id}@${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  }
  localFor.set(url, `assets/crests/${id}`)
  saved += 1
}

await browser.close()

// Point the data at the mirrored files. The stored path has no size suffix;
// the renderer appends the one it needs.
/**
 * A copy of `node` with every crest url replaced by its local path, or blanked
 * where the source 404s. Returns the node unchanged when nothing applies, so
 * the caller can tell whether the file needs rewriting at all.
 */
function repointed(node) {
  if (Array.isArray(node)) {
    const next = node.map(repointed)
    return next.some((entry, index) => entry !== node[index]) ? next : node
  }
  if (!node || typeof node !== 'object') return node

  let changed = false
  const next = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'logo' && typeof value === 'string' && value) {
      const replacement = dead.has(value) ? '' : localFor.get(value)
      if (replacement !== undefined && replacement !== value) {
        next[key] = replacement
        changed = true
        continue
      }
    }
    next[key] = repointed(value)
    if (next[key] !== value) changed = true
  }
  return changed ? next : node
}

let rewritten = 0
for (const path of files) {
  const payload = readJson(path)
  if (!payload) continue
  const next = repointed(payload)
  if (next !== payload) {
    writeFileSync(path, `${JSON.stringify(next)}${NL}`)
    rewritten += 1
  }
}

const bytes = readdirSync(crestDir)
  .reduce((total, file) => total + statSync(join(crestDir, file)).size, 0)

process.stdout.write(`${saved} crest(s) mirrored at ${CREST_SIZES.join(' and ')}px${NL}`)
if (missing) process.stdout.write(`${missing} crest(s) 404 at the source; their urls were blanked for the monogram fallback${NL}`)
process.stdout.write(`${rewritten} data file(s) repointed${NL}`)
process.stdout.write(`assets/crests is ${(bytes / 1024 / 1024).toFixed(2)} MB${NL}`)
