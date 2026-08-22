/**
 * End-to-end check of the real app against the live data source.
 *
 * Drives the actual UI: loads a competition, picks a match, cycles every
 * graphic, switches to manual entry, and exports a PNG - failing on any
 * console error or empty canvas along the way.
 *
 * Usage: node tests/app.e2e.mjs [--url http://localhost:4321/]
 */
import { chromium } from 'playwright'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const shotDir = join(here, '..', 'dev', 'app-shots')
const downloadDir = join(here, '..', 'dev', 'downloads')

const urlIndex = process.argv.indexOf('--url')
const baseUrl = urlIndex === -1 ? 'http://localhost:4321/' : process.argv[urlIndex + 1]

rmSync(shotDir, { recursive: true, force: true })
rmSync(downloadDir, { recursive: true, force: true })
mkdirSync(shotDir, { recursive: true })
mkdirSync(downloadDir, { recursive: true })

const failures = []
const check = (label, condition, detail = '') => {
  if (condition) process.stdout.write(`  PASS  ${label}\n`)
  else {
    process.stdout.write(`  FAIL  ${label} ${detail}\n`)
    failures.push(label)
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  acceptDownloads: true,
})
const page = await context.newPage()

const consoleErrors = []
const assetFailures = []

/**
 * Not every club has a crest on ESPN's CDN, so a 404 there is an expected data
 * gap that the monogram fallback handles by design. Those are tracked but not
 * failed on; anything else is a real error.
 */
const isMissingCrest = (url) => /a\.espncdn\.com\/i\/teamlogos/.test(url)

page.on('response', (response) => {
  if (response.status() >= 400 && isMissingCrest(response.url())) assetFailures.push(response.url())
})
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  // Chrome logs a bare "Failed to load resource" for the crest 404s above.
  if (/Failed to load resource/.test(text) && assetFailures.length) return
  consoleErrors.push(text)
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

const statusText = () => page.locator('#status').textContent()
const statusTone = () => page.locator('#status').getAttribute('data-tone')
const waitForOk = async (timeout = 30000) => {
  await page.waitForFunction(
    () => document.getElementById('status').dataset.tone === 'ok',
    null,
    { timeout },
  )
}

/**
 * A canvas is "drawn" when several bands carry varied pixels. One band is too
 * brittle - graphics differ in where their content sits, and a cleared canvas
 * must be distinguishable from a sparse one.
 */
const canvasHasContent = (id) => page.evaluate((canvasId) => {
  const canvas = document.getElementById(canvasId)
  const ctx = canvas.getContext('2d')
  let richest = 0
  for (const fraction of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const band = ctx.getImageData(0, Math.floor(canvas.height * fraction), canvas.width, 30).data
    const seen = new Set()
    for (let i = 0; i < band.length; i += 4) seen.add(`${band[i]},${band[i + 1]},${band[i + 2]}`)
    richest = Math.max(richest, seen.size)
  }
  return richest > 12
}, id)

process.stdout.write('App end-to-end\n')

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await waitForOk()
check('loads a match from live data on start', true)
check('feed canvas is drawn', await canvasHasContent('canvas-feed'))
check('story canvas is drawn', await canvasHasContent('canvas-story'))
await page.screenshot({ path: join(shotDir, 'app-start.png') })

// Only matches with player stats, so every stat-based graphic has data.
// ESPN publishes stat lines for internationals only, never for club rugby.
await page.check('#only-stats')
await page.waitForTimeout(300)
await page.selectOption('#match', { index: 0 })
await waitForOk()
const statMatches = await page.locator('#match option').count()
check('stats filter finds matches', statMatches > 0, `${statMatches} matches with stats`)

// The win-probability curve needs a timeline that reaches the final score, and
// 80 of the 738 archived timelines do not - ESPN drops the occasional converted
// try. Pick a match that can actually carry the curve rather than assuming the
// first one can.
await page.click('[data-graphic="winprob"]')
const matchCount = await page.locator('#match option').count()
let curveIndex = -1
for (let index = 0; index < Math.min(matchCount, 12); index += 1) {
  await page.selectOption('#match', { index })
  await page.waitForTimeout(900)
  if (await statusTone() === 'ok') { curveIndex = index; break }
}
check('finds a match whose timeline reaches the final score', curveIndex >= 0,
  `scanned ${Math.min(matchCount, 12)} matches`)
if (curveIndex >= 0) await page.selectOption('#match', { index: curveIndex })
await page.waitForTimeout(900)

// Every graphic that works from a match.
for (const graphicId of ['result', 'matchday', 'teamsheet', 'statcard', 'winprob', 'comparison']) {
  await page.click(`[data-graphic="${graphicId}"]`)
  await waitForOk()
  check(`renders ${graphicId}`, await canvasHasContent('canvas-feed'), await statusText())
}

// Away side and player switching feed the squad-based graphics.
await page.click('[data-graphic="statcard"]')
await page.selectOption('#side', 'away')
await waitForOk()
check('switches to the away squad', await canvasHasContent('canvas-feed'))
const playerCount = await page.locator('#player option').count()
check('player list is populated', playerCount > 10, `got ${playerCount}`)
if (playerCount > 3) {
  await page.selectOption('#player', { index: 3 })
  await waitForOk()
  check('switches player', await canvasHasContent('canvas-feed'))
}
await page.selectOption('#side', 'home')
await waitForOk()

// Player-versus-player mode needs a squad member from each side.
await page.click('[data-graphic="comparison"]')
await page.selectOption('#mode', 'players')
await waitForOk()
check('compares two players', await canvasHasContent('canvas-feed'), await statusText())
await page.screenshot({ path: join(shotDir, 'app-comparison.png') })
await page.selectOption('#mode', 'teams')
await waitForOk()

// The league table comes from a separate file.
// Choose the table graphic BEFORE switching competition: changing competition
// clears the previous one's match, so a stats-only graphic would correctly have
// nothing to draw mid-transition.
await page.click('[data-graphic="table"]')
await page.selectOption('#competition', { index: 2 })
await waitForOk()
check('renders the league table', await canvasHasContent('canvas-feed'), await statusText())
await page.screenshot({ path: join(shotDir, 'app-table.png') })

// The season scatter needs a full league table, and must refuse a cup pool
// rather than drawing a confident chart of six teams out of twenty-four.
const competitions = await page.$$eval('#competition option', (o) => o.map((x) => x.textContent))
const leagueIndex = competitions.findIndex((t) => /Gallagher|Top 14|United Rugby/.test(t))
if (leagueIndex >= 0) {
  await page.selectOption('#competition', { index: leagueIndex })
  await page.waitForTimeout(2000)
  await page.click('[data-graphic="scatter"]')
  await waitForOk()
  check('renders the season scatter', await canvasHasContent('canvas-feed'), await statusText())
  await page.screenshot({ path: join(shotDir, 'app-scatter.png') })
}

const poolIndex = competitions.findIndex((t) => /Champions Cup|Challenge Cup/.test(t))
if (poolIndex >= 0) {
  await page.selectOption('#competition', { index: poolIndex })
  await page.waitForTimeout(2200)
  const poolStatus = await statusText()
  const poolTone = await page.locator('#status').getAttribute('data-tone')
  check('refuses to plot a cup pool as a season',
    poolTone === 'error' && /pool/i.test(poolStatus), `${poolTone}: ${poolStatus}`)
  // Back to a plottable competition for the remaining checks.
  if (leagueIndex >= 0) {
    await page.selectOption('#competition', { index: leagueIndex })
    await page.waitForTimeout(2000)
  }
  await page.click('[data-graphic="table"]')
  await waitForOk()
}

// Home advantage needs per-team home/away records, which only leagues have.
if (leagueIndex >= 0) {
  await page.selectOption('#competition', { index: leagueIndex })
  await page.waitForTimeout(2000)
  await page.click('[data-graphic="fortress"]')
  await waitForOk()
  check('renders home advantage', await canvasHasContent('canvas-feed'), await statusText())
}

// A single club season, and the club picker that drives it.
if (leagueIndex >= 0) {
  await page.selectOption('#competition', { index: leagueIndex })
  await page.waitForTimeout(2000)
  await page.click('[data-graphic="teamseason"]')
  await waitForOk()
  check('renders a single club season', await canvasHasContent('canvas-feed'), await statusText())
  await page.screenshot({ path: join(shotDir, 'app-teamseason.png') })

  const clubVisible = await page.evaluate(() =>
    !document.querySelector('[data-option="season-team"]').hidden)
  const clubs = await page.$$eval('#season-team option', (o) => o.map((x) => x.value))
  check('offers a club picker with real clubs', clubVisible && clubs.length >= 6,
    `visible=${clubVisible} clubs=${clubs.length}`)

  // Switching club must actually redraw, not leave the previous club's chart.
  if (clubs.length > 1) {
    const before = await statusText()
    await page.selectOption('#season-team', clubs[1])
    await page.waitForTimeout(1500)
    check('switching club redraws', await canvasHasContent('canvas-feed'),
      `${before} -> ${await statusText()}`)
  }

  // Two clubs in one league must not export to the same filename.
  if (clubs.length > 1) {
    const names = []
    for (const club of clubs.slice(0, 2)) {
      await page.selectOption('#season-team', club)
      await page.waitForTimeout(1400)
      const status = await statusText()
      if (/error|only|no /i.test(status) === false) {
        const [file] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }),
          page.click('[data-export="feed"]'),
        ])
        names.push(file.suggestedFilename())
      }
    }
    if (names.length === 2) {
      check('two clubs export to different filenames', names[0] !== names[1], names.join(' vs '))
    }
  }

  // Every club offered must actually draw. The picker used to filter on match
  // count while the gate also checked the league table, so it offered clubs it
  // then refused - 16 URC clubs of which 7 drew.
  await page.click('[data-graphic="teamseason"]')
  await page.waitForTimeout(1200)
  const refusedButOffered = []
  for (const club of clubs) {
    await page.selectOption('#season-team', club)
    await page.waitForTimeout(1100)
    if (await statusTone() !== 'ok') refusedButOffered.push(club)
  }
  check('every club the picker offers actually draws',
    refusedButOffered.length === 0, refusedButOffered.join(', ') || 'all drew')
}

// Switching to a competition WITHOUT season records must not leave the previous
// competition's chart on screen labelled as the new one.
const noSeasonIndex = competitions.findIndex((t) => /Six Nations/.test(t))
if (noSeasonIndex >= 0 && leagueIndex >= 0) {
  await page.selectOption('#competition', { index: noSeasonIndex })
  await page.waitForTimeout(2400)
  const staleStatus = await statusText()
  const staleTone = await page.locator('#status').getAttribute('data-tone')
  check('does not show a stale season chart under a new competition',
    staleTone === 'error' && !/Top 14|United Rugby/.test(staleStatus), `${staleTone}: ${staleStatus}`)

  // And it must recover.
  await page.selectOption('#competition', { index: leagueIndex })
  await page.waitForTimeout(2400)
  await waitForOk()
  check('recovers after an unavailable competition', await canvasHasContent('canvas-feed'))
  await page.click('[data-graphic="table"]')
  await waitForOk()
}

// Themes.
await page.selectOption('#theme', 'chalk')
await waitForOk()
check('switches theme', await canvasHasContent('canvas-feed'))
await page.selectOption('#theme', 'midnight')
await waitForOk()

// Export writes real files.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.click('[data-export="feed"]'),
])
const savedPath = join(downloadDir, download.suggestedFilename())
await download.saveAs(savedPath)
check('exports a feed PNG', existsSync(savedPath), download.suggestedFilename())
check('export filename describes the graphic', /-table-feed\.png$/.test(download.suggestedFilename()),
  download.suggestedFilename())

// Manual entry: no API involved.
await page.click('[data-source="manual"]')
await page.fill('#m-competition', 'Saturday League')
await page.fill('#m-home', 'Old Boys RFC')
await page.fill('#m-away', 'City Rugby Club')
await page.fill('#m-home-score', '27')
await page.fill('#m-away-score', '22')
await page.fill('#m-venue', 'The Rec')
await page.fill('#m-home-squad', ['1 Dan Hooper', '2 Alex Jones (c)', '3 Sam Taylor', '4 Ben Ward',
  '5 Chris Doyle', '6 Rob Finn', '7 Nick Bailey', '8 Tom Rees', '9 Joe Marsh', '10 Will Carter',
  '11 Ash Boyd', '12 Ed Frost', '13 Leo Gill', '14 Max Reid', '15 Owen Platt', '16 Jack Nash',
  '17 Cal Peters', '18 Ryan Lowe'].join('\n'))
await page.fill('#m-home-tries', 'Carter 12, Platt 34')
await page.click('[data-graphic="teamsheet"]')
await waitForOk()
check('renders a manual team sheet', await canvasHasContent('canvas-feed'), await statusText())
await page.screenshot({ path: join(shotDir, 'app-manual.png') })

await page.click('[data-graphic="result"]')
await waitForOk()
const manualStatus = await statusText()
check('renders a manual result', /Old Boys/.test(manualStatus), manualStatus)

// Tries alone never reach a real scoreline, so the swing chart is refused until
// the club enters its kicks too. This is the only way a club gets that chart.
await page.click('[data-graphic="winprob"]')
await page.waitForTimeout(1200)
const triesOnly = await statusText()
// The message must name BOTH numbers - a club has no other way to find the
// discrepancy, and the old generic wording sent them looking for an app fault.
check('refuses a club swing chart from tries alone, and says by how much',
  /adds up to \d+-\d+/.test(triesOnly) && /score says \d+-\d+/.test(triesOnly), triesOnly)

// 27 = 2 tries(10) + 1 conversion(2) + 5 penalties(15)
// 22 = 3 tries(15) + 2 conversions(4) + 1 penalty(3)
await page.fill('#m-home-scores', 'C 13, P 20, P 40, P 55, P 62, P 70')
await page.fill('#m-away-tries', 'Reid 25, Vaughan 60, Ellis 74')
await page.fill('#m-away-scores', 'C 26, C 61, P 45')
await page.waitForTimeout(1400)
const withKicks = await statusText()
check('draws a club swing chart once the kicks add up',
  await canvasHasContent('canvas-feed') && !/adds up to/i.test(withKicks), withKicks)

// Leave the panel on a match graphic - the crest check below reads one.
await page.click('[data-graphic="result"]')
await waitForOk()

// A club has a badge; the monogram is a stand-in, not the destination.
const crestPath = join(here, 'fixtures', 'club-crest.png')
if (existsSync(crestPath)) {
  await page.setInputFiles('#m-home-crest', crestPath)
  await page.waitForTimeout(900)
  const crestPixels = await page.evaluate(() => {
    const canvas = document.getElementById('canvas-feed')
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let red = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 170 && data[i + 1] < 90 && data[i + 2] < 90) red += 1
    }
    return red
  })
  check('an uploaded crest reaches the canvas', crestPixels > 500, `${crestPixels} crest pixels`)

  // Reload: the club should not retype its details every Saturday.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const remembered = await page.evaluate(() => ({
    home: document.getElementById('m-home').value,
    note: document.getElementById('manual-note').textContent,
  }))
  check('club details survive a reload', remembered.home === 'Old Boys RFC', remembered.home)
  check('the crest survives a reload', /crest/.test(remembered.note), remembered.note)

  // And can be forgotten on request.
  await page.click('[data-source="manual"]')
  await page.click('#m-clear')
  await page.waitForTimeout(600)
  const cleared = await page.evaluate(() => document.getElementById('m-home').value)
  check('saved details can be cleared', cleared === '', `got "${cleared}"`)
}

// Export must refuse exactly what the preview refuses. It previously had no
// checks at all and would save a finished-looking but empty PNG.
await page.click('[data-source="live"]')
await page.waitForTimeout(1200)
await page.uncheck('#only-stats').catch(() => {})
await page.uncheck('#only-squads').catch(() => {})
// A club competition never has player stats, so Match stats is reliably blocked.
const clubIndex = competitions.findIndex((t) => /Gallagher|Top 14|United Rugby/.test(t))
if (clubIndex >= 0) {
  await page.selectOption('#competition', { index: clubIndex })
  await page.waitForTimeout(2400)
}
await page.click('[data-graphic="comparison"]')
await page.waitForTimeout(1200)
const blockedTone = await page.locator('#status').getAttribute('data-tone')
if (blockedTone === 'error') {
  let downloaded = false
  const listener = () => { downloaded = true }
  page.on('download', listener)
  await page.click('#export-set')
  await page.waitForTimeout(2500)
  page.off('download', listener)
  const exportStatus = await statusText()
  check('export refuses what the preview refuses',
    !downloaded && /nothing was saved/i.test(exportStatus), exportStatus)
} else {
  process.stdout.write('  note  no blocked state available to test the export guard\n')
}

// Person-level settings. Retyping a club handle every session was the single
// most-repeated action in the app.
await page.fill('#handle', '@testclubrfc')
await page.selectOption('#theme', 'chalk')
await page.waitForTimeout(700)   // the handle write is debounced 400ms
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => document.getElementById('theme').options.length > 0)
const restoredPrefs = await page.evaluate(() => ({
  handle: document.getElementById('handle').value,
  theme: document.getElementById('theme').value,
}))
check('handle and theme survive a reload',
  restoredPrefs.handle === '@testclubrfc' && restoredPrefs.theme === 'chalk',
  JSON.stringify(restoredPrefs))

await page.check('#accent-auto')
const accentOff = await page.isDisabled('#accent')
await page.uncheck('#accent-auto')
const accentOn = await page.isDisabled('#accent')
check('the accent picker is disabled only while team colour is on',
  accentOff && !accentOn, `ticked=${accentOff} unticked=${accentOn}`)

// A club that works from its own team should land on its own team, not have to
// click through to it every visit.
await page.click('[data-source="manual"]')
await page.waitForTimeout(700)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const restoredSource = await page.evaluate(() => ({
  active: document.querySelector('[data-source].is-active')?.dataset.source,
  manualVisible: !document.querySelector('[data-panel="manual"]').hidden,
}))
check('the chosen source survives a reload',
  restoredSource.active === 'manual' && restoredSource.manualVisible,
  JSON.stringify(restoredSource))

// The preview is sticky on desktop and must NOT be on a phone: taller than the
// viewport, it pins over the whole control rail and every chip, select and
// button stops responding. This shipped, because the override was written
// above the rule it overrides and silently lost the source-order tie.
const phone = await browser.newPage({ viewport: { width: 390, height: 664 } })
await phone.goto(baseUrl, { waitUntil: 'networkidle' })
await phone.waitForTimeout(1500)
const reach = await phone.evaluate(() => {
  const probe = (selector) => {
    const el = document.querySelector(selector)
    if (!el) return 'missing'
    el.scrollIntoView({ block: 'center' })
    const box = el.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return el === hit || el.contains(hit) ? 'ok' : 'blocked'
  }
  return {
    position: getComputedStyle(document.querySelector('.stage')).position,
    chip: probe('[data-graphic="table"]'),
    exportButton: probe('#export-set'),
    matchList: probe('#match'),
  }
})
check('every control is reachable at phone width',
  reach.position === 'static' && reach.chip === 'ok'
    && reach.exportButton === 'ok' && reach.matchList === 'ok',
  JSON.stringify(reach))

const beforeTap = await phone.textContent('#status')
await phone.click('[data-graphic="table"]')
await phone.waitForTimeout(1200)
const afterTap = await phone.textContent('#status')
check('tapping a chip on a phone actually changes the graphic',
  afterTap !== beforeTap && /table/i.test(afterTap), `${beforeTap} -> ${afterTap}`)
await phone.close()

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
// A missing crest must not break a render. The "no console errors" check above
// already proves nothing threw during the whole run, including every render
// that loaded a 404 crest; the monogram fallback itself is verified visually
// by dev/shots.mjs. Reported here rather than asserted, because asserting on
// canvas contents at the end of the run tests the final state, not the crest.
if (assetFailures.length) {
  process.stdout.write(`  note  ${new Set(assetFailures).size} club crest(s) missing from the CDN; monogram fallback used
`)
}

await browser.close()

process.stdout.write(failures.length
  ? `\n${failures.length} check(s) failed\n`
  : '\nAll checks passed\n')
process.exit(failures.length ? 1 : 0)
