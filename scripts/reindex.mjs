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
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
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
    return { ...row, hasDetail: Boolean(match.home?.squad?.length), hasStats: stats }
  })

  index.withStats = withStats
  writeFileSync(indexPath, `${JSON.stringify(index)}\n`)
  competitions += 1
  updated += withStats
  process.stdout.write(`${String(index.name || competitionId).padEnd(32)} ${withStats} with player stats\n`)
}

// Mirror the counts into the top-level catalogue.
const catalogPath = join(dataDir, 'index.json')
if (existsSync(catalogPath)) {
  const catalog = readJson(catalogPath) || { competitions: [] }
  catalog.competitions = catalog.competitions.map((competition) => {
    const indexPath = join(dataDir, competition.id, 'index.json')
    if (!existsSync(indexPath)) return competition
    const index = readJson(indexPath)
    return { ...competition, withStats: index?.withStats ?? 0 }
  })
  writeFileSync(catalogPath, `${JSON.stringify(catalog)}\n`)
}

process.stdout.write(`\nReindexed ${competitions} competitions, ${updated} matches with player stats\n`)
