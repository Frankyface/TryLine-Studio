/**
 * Build a posting plan for a match, and render its cards.
 *
 * This is the half of auto-posting that can exist without a server: decide
 * what to post and produce the files. Publishing needs a token, a public image
 * host and Meta's approval - see docs/instagram.md.
 *
 * The plan is written alongside the PNGs so a job that gets halfway through can
 * be resumed from it, and re-planning the same match gives the same cards in
 * the same order on the same themes.
 *
 * Usage:
 *   node scripts/build-post-plan.mjs --match 602502
 *   node scripts/build-post-plan.mjs --match 602502 --out dev/posts --no-render
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dataDir = join(root, 'data')
const NL = String.fromCharCode(10)

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const wantedId = arg('match', '')
const outDir = join(root, arg('out', 'dev/posts'))
const render = !process.argv.includes('--no-render')

if (!wantedId) {
  process.stderr.write(`Give a match: --match <id>${NL}`)
  process.exit(1)
}

/** Find the match, and whatever table and season go with its competition. */
function locate(id) {
  for (const competition of readdirSync(dataDir)) {
    const dir = join(dataDir, competition)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    const file = join(dir, 'matches', `${id}.json`)
    if (!existsSync(file)) continue
    const tables = readdirSync(dir).filter((name) => name.startsWith('table-')).sort()
    const seasons = readdirSync(dir).filter((name) => name.startsWith('season-')).sort()
    return {
      competition,
      match: JSON.parse(readFileSync(file, 'utf8')),
      table: tables.length ? JSON.parse(readFileSync(join(dir, tables.at(-1)), 'utf8')) : null,
      season: seasons.length ? JSON.parse(readFileSync(join(dir, seasons.at(-1)), 'utf8')) : null,
    }
  }
  return null
}

const found = locate(wantedId)
if (!found) {
  process.stderr.write(`No match ${wantedId} in data/${NL}`)
  process.exit(1)
}

const model = existsSync(join(dataDir, 'models', 'winprob.json'))
  ? JSON.parse(readFileSync(join(dataDir, 'models', 'winprob.json'), 'utf8'))
  : null
const heroStats = existsSync(join(dataDir, 'models', 'hero-stats.json'))
  ? JSON.parse(readFileSync(join(dataDir, 'models', 'hero-stats.json'), 'utf8'))
  : null

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
await page.goto('http://localhost:4321/dev/preview?only=result', { waitUntil: 'networkidle' })

const result = await page.evaluate(async ([raw, rawTable, rawSeason, fittedModel, hero, shouldRender]) => {
  const [{ planFor }, { renderGraphic }, schema, theme] = await Promise.all([
    import('/src/publish/plan.js'), import('/src/render/index.js'),
    import('/src/data/schema.js'), import('/src/render/theme.js'),
  ])
  const match = schema.createMatch(raw)
  const table = rawTable ? schema.createTable(rawTable) : null
  const squad = match.home?.squad || []
  const options = {
    side: 'home',
    player: squad.find((entry) => Object.keys(entry.stats || {}).length) || squad[0],
    playerB: (match.away?.squad || [])[0],
    mode: 'teams',
    model: fittedModel,
    heroStats: hero,
    handle: '',
  }

  const cards = planFor({ match, table, season: rawSeason, source: 'espn' }, { model: fittedModel, options })
  if (!shouldRender) return { cards, images: [] }

  const canvas = document.createElement('canvas')
  const images = []
  for (const card of cards) {
    await renderGraphic(canvas, card.graphicId, {
      match,
      table,
      season: rawSeason,
      size: theme.SIZES[card.format],
      theme: theme.THEMES[card.themeId],
      options,
    })
    images.push(canvas.toDataURL('image/png'))
  }
  return { cards, images }
}, [found.match, found.table, found.season, model, heroStats, render])

await browser.close()

const files = []
result.cards.forEach((card, index) => {
  const name = `${String(card.order).padStart(2, '0')}-${card.graphicId}-${card.format}-${card.themeId}.png`
  if (result.images[index]) {
    writeFileSync(join(outDir, name), Buffer.from(result.images[index].split(',')[1], 'base64'))
  }
  files.push({ ...card, file: name })
})

writeFileSync(join(outDir, `plan-${wantedId}.json`), `${JSON.stringify({
  match: wantedId,
  competition: found.competition,
  // No timestamp: the plan has to be byte-identical on a rerun so a
  // half-finished posting job can be resumed against it.
  cards: files,
}, null, 2)}${NL}`)

process.stdout.write(`${files.length} card(s) planned for ${found.match.home?.name} v ${found.match.away?.name}${NL}${NL}`)
for (const card of files) {
  process.stdout.write(`  ${String(card.order).padStart(2)}  ${card.graphicId.padEnd(11)}`
    + `${card.format.padEnd(7)}${card.themeId.padEnd(11)}${card.caption}${NL}`)
}
process.stdout.write(`${NL}${render ? `PNGs and plan written to ${outDir}` : `plan written to ${outDir}`}${NL}`)
if (pageErrors.length) process.stdout.write(`page errors: ${pageErrors.slice(0, 3).join(' | ')}${NL}`)
