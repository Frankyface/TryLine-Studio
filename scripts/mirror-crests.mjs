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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dataDir = join(root, 'data')
const crestDir = join(root, 'assets', 'crests')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

/** The two scales the graphics actually draw at. */
export const CREST_SIZES = Object.freeze([96, 320])

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
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
    missing += 1
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
let rewritten = 0
for (const path of files) {
  const payload = readJson(path)
  if (!payload) continue
  let touched = false
  eachTeam(payload, (team) => {
    const local = localFor.get(team.logo)
    if (!local) return
    team.logo = local
    touched = true
  })
  if (touched) {
    writeFileSync(path, `${JSON.stringify(payload)}${NL}`)
    rewritten += 1
  }
}

const bytes = readdirSync(crestDir)
  .reduce((total, file) => total + statSync(join(crestDir, file)).size, 0)

process.stdout.write(`${saved} crest(s) mirrored at ${CREST_SIZES.join(' and ')}px${NL}`)
if (missing) process.stdout.write(`${missing} crest(s) could not be downloaded and keep the monogram fallback${NL}`)
process.stdout.write(`${rewritten} data file(s) repointed${NL}`)
process.stdout.write(`assets/crests is ${(bytes / 1024 / 1024).toFixed(2)} MB${NL}`)
