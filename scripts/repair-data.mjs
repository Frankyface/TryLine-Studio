/**
 * Apply data corrections to files already on disk.
 *
 * The adapter fixes these at fetch time, but a full refresh is minutes of
 * network for a change that is a local rewrite. Safe to re-run; it only ever
 * removes bad values, never invents good ones.
 *
 * Currently repairs:
 *  - Country flags used as CLUB crests. ESPN falls back to a national flag when
 *    it has no club badge, matching on the abbreviation, so Perpignan ("Union
 *    Sportive Arlequins") are served the United States flag - on a French
 *    league chart. A flag is only ever right when the team is a country.
 *
 * Usage: node scripts/repair-data.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { COMPETITIONS, isCountryFlag } from '../src/data/espn.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

const nationalIds = new Set(
  COMPETITIONS.filter((competition) => competition.national).map((competition) => competition.id),
)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`skipped unreadable ${path}: ${error.message}${NL}`)
    return null
  }
}

const stripped = new Map()

/** Returns the side unchanged, or a copy with a wrongly-flagged crest removed. */
function repairSide(side, competitionId) {
  if (!side?.logo || !isCountryFlag(side.logo)) return side
  if (nationalIds.has(competitionId)) return side
  stripped.set(side.name, side.logo.split('/').pop())
  return { ...side, logo: '' }
}

let filesChanged = 0

for (const competitionId of readdirSync(dataDir)) {
  const competitionDir = join(dataDir, competitionId)
  if (!existsSync(join(competitionDir, 'matches'))) continue

  // Match files.
  const matchDir = join(competitionDir, 'matches')
  for (const file of readdirSync(matchDir).filter((f) => f.endsWith('.json'))) {
    const path = join(matchDir, file)
    const match = readJson(path)
    if (!match) continue

    const home = repairSide(match.home, competitionId)
    const away = repairSide(match.away, competitionId)
    if (home === match.home && away === match.away) continue

    if (!checkOnly) writeFileSync(path, `${JSON.stringify({ ...match, home, away })}${NL}`)
    filesChanged += 1
  }

  // Table and season files carry their own copies of the crest.
  for (const file of readdirSync(competitionDir).filter((f) => f.endsWith('.json'))) {
    const path = join(competitionDir, file)
    const payload = readJson(path)
    if (!payload) continue

    let touched = false
    const repairRows = (rows) => (rows || []).map((row) => {
      const team = repairSide(row.team, competitionId)
      if (team === row.team) return row
      touched = true
      return { ...row, team }
    })

    const next = { ...payload }
    if (Array.isArray(payload.rows)) next.rows = repairRows(payload.rows)
    if (Array.isArray(payload.teams)) next.teams = repairRows(payload.teams)

    if (touched) {
      if (!checkOnly) writeFileSync(path, `${JSON.stringify(next)}${NL}`)
      filesChanged += 1
    }
  }
}

if (stripped.size) {
  process.stdout.write(`Country flags removed from ${stripped.size} club team(s):${NL}`)
  for (const [name, flag] of stripped) process.stdout.write(`  ${name} was using ${flag}${NL}`)
} else {
  process.stdout.write(`No club team is using a country flag.${NL}`)
}
process.stdout.write(checkOnly
  ? `${filesChanged} file(s) would change - nothing written${NL}`
  : `${filesChanged} file(s) rewritten${NL}`)
