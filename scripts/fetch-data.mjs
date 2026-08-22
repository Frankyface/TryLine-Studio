/**
 * Data refresh. Fetches rugby data server-side and writes it, already
 * normalised, into data/ for the browser app to read.
 *
 * WHY THIS EXISTS: the browser cannot call ESPN directly. ESPN returns 403 to
 * any browser User-Agent, and because the 403 body carries no CORS header the
 * browser reports it as a CORS failure, hiding the real cause. Requests from a
 * non-browser client (this script) are served normally. Verified 2026-08-21.
 *
 * Usage:
 *   node scripts/fetch-data.mjs                 # every competition
 *   node scripts/fetch-data.mjs --only 180659   # one competition
 *   node scripts/fetch-data.mjs --lookback 60 --lookahead 60
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  COMPETITIONS, adaptScoreboard, adaptSummary, adaptStandings,
  buildScoreboardUrl, buildSummaryUrl, buildStandingsUrl, toEspnDate,
} from '../src/data/espn.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

const DAY_MS = 86400000
const REQUEST_GAP_MS = 250
const MAX_RETRIES = 3
/**
 * ESPN caps a scoreboard response at 100 events and truncates silently - a
 * whole-season request for a big league comes back looking complete but stops
 * mid-January. Verified 2026-08-21. So requests are chunked by month, well
 * under the cap for any competition.
 */
const ESPN_EVENT_CAP = 100

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const lookahead = Number(arg('lookahead', 150))
/** How many recent completed matches per competition get squads and stats. */
const detailCount = Number(arg('details', 24))
const only = arg('only', '')
const now = Date.now()

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/**
 * Fetch JSON with retries. No User-Agent header is set on purpose - Node's
 * default is fine, a browser-looking one gets a 403.
 */
async function getJson(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.status === 403) {
        throw new Error('403 from ESPN - the request looked like a browser, or you are being throttled.')
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      if (attempt === MAX_RETRIES) throw new Error(`${url}\n  ${error.message}`)
      await wait(attempt * 800)
    }
  }
  return null
}

const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value)}\n`)
  return path
}

const isoDay = (offsetDays) => new Date(now + offsetDays * DAY_MS)

/** Season a campaign is filed under - ESPN uses the year the season ends in. */
const currentSeasonYear = () => {
  const date = new Date(now)
  // Northern-hemisphere seasons run Aug-Jun, so before July belongs to this year.
  return date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear()
}

/** Month-by-month so the 100-event cap is never reached. */
async function fetchMatchesByMonth(leagueId, from, to, log) {
  const byId = new Map()
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))

  while (cursor <= to) {
    const monthStart = new Date(cursor)
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0))
    try {
      const payload = await getJson(buildScoreboardUrl(leagueId, {
        from: toEspnDate(monthStart),
        to: toEspnDate(monthEnd),
      }))
      const found = adaptScoreboard(payload)
      if (found.length >= ESPN_EVENT_CAP) {
        log(`  WARNING ${toEspnDate(monthStart)} hit the ${ESPN_EVENT_CAP}-event cap - results may be truncated`)
      }
      for (const match of found) byId.set(match.id, match)
      await wait(REQUEST_GAP_MS)
    } catch (error) {
      log(`  month ${toEspnDate(monthStart)} failed: ${error.message.split(String.fromCharCode(10))[0]}`)
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  return [...byId.values()].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
}

/** Do both sides carry per-player stat lines, not just names? */
const hasPlayerStats = (match) => {
  const anyStats = (squad) => (squad || []).some((player) => Object.keys(player.stats || {}).length > 0)
  return anyStats(match.home.squad) && anyStats(match.away.squad)
}

async function refreshCompetition(competition) {
  const log = (message) => process.stdout.write(`  ${message}\n`)
  process.stdout.write(`${competition.name}\n`)

  // Covers the season that just finished as well as the one starting, because
  // in the off-season the current season alone has nothing played yet.
  const from = new Date(Date.UTC(currentSeasonYear() - 2, 6, 1))
  const to = isoDay(lookahead)
  const matches = await fetchMatchesByMonth(competition.id, from, to, log)
  log(`${matches.length} matches`)

  const summary = {
    id: competition.id,
    name: competition.name,
    short: competition.short,
    updated: new Date(now).toISOString(),
    matches: matches.map((match) => ({
      id: match.id,
      kickoff: match.kickoff,
      status: match.status,
      round: match.round,
      home: { name: match.home.name, shortName: match.home.shortName, score: match.home.score },
      away: { name: match.away.name, shortName: match.away.shortName, score: match.away.score },
      hasDetail: false,
      hasStats: false,
    })),
  }

  // Full match records, including the scoring timeline, for every match.
  for (const match of matches) {
    writeJson(join(dataDir, competition.id, 'matches', `${match.id}.json`), match)
  }

  // Squads and player stats for the most recent completed matches. Pulling
  // every match would be hundreds of requests for data nobody asks for.
  const detailWindow = matches
    .filter((match) => match.status === 'final')
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, detailCount)

  let detailed = 0
  let withStats = 0
  for (const match of detailWindow) {
    try {
      const detail = adaptSummary(await getJson(buildSummaryUrl(competition.id, match.id)))
      if (detail.home.squad.length || detail.away.squad.length) {
        writeJson(join(dataDir, competition.id, 'matches', `${match.id}.json`), detail)
        const row = summary.matches.find((m) => m.id === match.id)
        if (row) {
          row.hasDetail = true
          // Squads and per-player stats are separate things: ESPN publishes
          // team sheets for club rugby but stat lines only for internationals.
          row.hasStats = hasPlayerStats(detail)
        }
        detailed += 1
        if (hasPlayerStats(detail)) withStats += 1
      }
      await wait(REQUEST_GAP_MS)
    } catch (error) {
      log(`  skipped squads for ${match.id}: ${error.message.split('\n')[0]}`)
    }
  }
  log(`${detailed} with squads, ${withStats} with player stats`)

  // Standings for this season and the one before it.
  const seasons = [currentSeasonYear(), currentSeasonYear() - 1, currentSeasonYear() - 2]
  const tables = []
  for (const season of seasons) {
    try {
      const table = adaptStandings(await getJson(buildStandingsUrl(competition.id, season)), { season })
      if (table.rows.length && table.rows.some((row) => row.played > 0)) {
        writeJson(join(dataDir, competition.id, `table-${season}.json`), table)
        tables.push(season)
      }
      await wait(REQUEST_GAP_MS)
    } catch (error) {
      log(`  no table for ${season}: ${error.message.split('\n')[0]}`)
    }
  }
  log(`tables: ${tables.join(', ') || 'none'}`)

  summary.tables = tables
  writeJson(join(dataDir, competition.id, 'index.json'), summary)
  return {
    id: competition.id,
    name: competition.name,
    short: competition.short,
    matches: matches.length,
    detailed,
    withStats,
    tables,
  }
}

const wanted = only ? COMPETITIONS.filter((c) => c.id === only) : COMPETITIONS
if (!wanted.length) {
  process.stderr.write(`Unknown competition: ${only}\n`)
  process.exit(1)
}

const results = []
for (const competition of wanted) {
  try {
    results.push(await refreshCompetition(competition))
  } catch (error) {
    process.stderr.write(`FAILED ${competition.name}: ${error.message}\n`)
  }
}

// Merged, never replaced. `--only <id>` used to rewrite the catalogue with
// just that competition, so refreshing one league silently deleted the other
// twelve from the app - the data was all still on disk, but nothing offered it.
const catalogPath = join(dataDir, 'index.json')
const existing = existsSync(catalogPath)
  ? (JSON.parse(readFileSync(catalogPath, 'utf8')).competitions || [])
  : []
const merged = [...existing]
for (const competition of results) {
  const at = merged.findIndex((entry) => entry.id === competition.id)
  if (at === -1) merged.push(competition)
  else merged[at] = competition
}

writeJson(catalogPath, {
  updated: new Date(now).toISOString(),
  window: { seasonStartMonth: 'July', lookahead },
  competitions: merged,
})

process.stdout.write(`\nWrote data for ${results.length}/${wanted.length} competitions\n`)
process.exit(results.length ? 0 : 1)
