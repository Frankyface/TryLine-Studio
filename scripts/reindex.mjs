/**
 * Re-annotate each competition index from the match files on disk.
 *
 * It refreshes the hasDetail/hasStats flags on rows the index already lists; it
 * does NOT discover matches missing from the index, so it cannot rebuild a
 * truncated one. Cheaper than a full refresh when only the flags have changed -
 * no network calls, so it cannot be rate limited or blocked.
 *
 * Usage: node scripts/reindex.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

const anyStats = (squad) => (squad || []).some((player) => Object.keys(player?.stats || {}).length > 0)

/** A malformed file should name itself rather than abort the run. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`skipped unreadable ${path}: ${error.message}${String.fromCharCode(10)}`)
    return null
  }
}
const hasPlayerStats = (match) => anyStats(match.home?.squad) && anyStats(match.away?.squad)

let competitions = 0
let updated = 0

for (const competitionId of readdirSync(dataDir)) {
  const indexPath = join(dataDir, competitionId, 'index.json')
  const matchDir = join(dataDir, competitionId, 'matches')
  if (!existsSync(indexPath) || !existsSync(matchDir)) continue

  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  let withStats = 0

  index.matches = index.matches.map((row) => {
    const matchPath = join(matchDir, `${row.id}.json`)
    if (!existsSync(matchPath)) return { ...row, hasStats: false }
    const match = JSON.parse(readFileSync(matchPath, 'utf8'))
    const stats = hasPlayerStats(match)
    if (stats) withStats += 1
    // The match file is the authority on the score and the status. Spreading
    // the old row carried a literal 0-0 on every unplayed fixture long after
    // the match files had been corrected to null, so the picker read
    // "Section Paloise 0-0 Bayonne" for a game in April and the app's own
    // null branch was unreachable.
    return {
      ...row,
      status: match.status ?? row.status,
      home: { ...row.home, score: match.home?.score ?? null },
      away: { ...row.away, score: match.away?.score ?? null },
      hasDetail: Boolean(match.home?.squad?.length),
      hasStats: stats,
    }
  })

  index.withStats = withStats
  writeFileSync(indexPath, `${JSON.stringify(index)}\n`)
  competitions += 1
  updated += withStats
  process.stdout.write(`${String(index.name || competitionId).padEnd(32)} ${withStats} with player stats\n`)
}

/**
 * Rebuild the top-level catalogue from whatever is on disk.
 *
 * Rebuilt rather than edited in place, because the catalogue is the one file
 * that can lose competitions: `fetch-data --only <id>` rewrites it with just
 * that competition, and the app then offers one league out of thirteen.
 * Rebuilding from the per-competition index files is the only way back from
 * that without a full re-download.
 */
const catalogPath = join(dataDir, 'index.json')
const previous = existsSync(catalogPath) ? readJson(catalogPath) : null

const rebuilt = readdirSync(dataDir)
  .filter((entry) => statSync(join(dataDir, entry)).isDirectory())
  .map((competitionId) => readJson(join(dataDir, competitionId, 'index.json')))
  .filter((index) => index && index.id)
  .map((index) => ({
    id: index.id,
    name: index.name,
    short: index.short,
    matches: (index.matches || []).length,
    detailed: (index.matches || []).filter((match) => match.hasDetail).length,
    withStats: index.withStats ?? 0,
    tables: index.tables || [],
    // The most recent match actually PLAYED. The app opens on the competition
    // with the newest one, because opening on a tour that finished a year ago
    // - which is what sorting by name gave - makes the whole archive look
    // stale before the user has touched anything.
    latest: (index.matches || [])
      .filter((match) => match.status === 'final')
      .map((match) => match.kickoff)
      .sort()
      .at(-1) || '',
  }))
  .sort((a, b) => String(a.name).localeCompare(String(b.name)))

writeFileSync(catalogPath, `${JSON.stringify({
  updated: previous?.updated || new Date().toISOString(),
  window: previous?.window || { seasonStartMonth: 'July', lookahead: 150 },
  competitions: rebuilt,
})}\n`)

const lost = previous ? (previous.competitions || []).length : 0
process.stdout.write(`\ncatalogue rebuilt with ${rebuilt.length} competition(s)`
  + `${lost ? ` (was ${lost})` : ''}\n`)

process.stdout.write(`\nReindexed ${competitions} competitions, ${updated} matches with player stats\n`)
