/**
 * Replace ESPN's form strings with real ones computed from match results.
 *
 * WHY: the `form` column ESPN ships is a single global "current form" snapshot
 * per team, not that competition's results. Every one of the 52 teams appearing
 * in more than one table carries an IDENTICAL string in all of them - Stade
 * Toulousain reads WWLWL in a Champions Cup pool they won 4-0, and France reads
 * WWLWL in the 2025 Six Nations, the 2026 Six Nations and the Nations
 * Championship alike. Where the whole season fits in five characters and the
 * string is therefore checkable, it reconciles with the row's own W/D/L just
 * 10% of the time.
 *
 * A form column that looks populated but is wrong is worse than none, so this
 * recomputes it from the match archive and blanks it where the archive cannot
 * support it.
 *
 * Usage: node scripts/derive-form.mjs [--check]
 *   --check reports what would change without writing.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
const checkOnly = process.argv.includes('--check')

/** One malformed file should name itself, not abort with a bare stack trace. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`skipped unreadable ${path}: ${error.message}${String.fromCharCode(10)}`)
    return null
  }
}

/** Form shows the last five results. */
const FORM_LENGTH = 5

/** Fewer than this and a form run says nothing worth drawing. */
const MIN_MATCHES = 3

/**
 * Seasons are labelled by the year they END in, so season 2026 runs from
 * July 2025 to June 2026. Match `season.year` is unreliable (Top 14 files both
 * seasons under 2026), so the kickoff date is the authority.
 */
const seasonWindow = (season) => ({
  from: Date.UTC(season - 1, 6, 1),
  to: Date.UTC(season, 5, 30, 23, 59, 59),
})

function loadMatches(competitionId) {
  const matchDir = join(dataDir, competitionId, 'matches')
  if (!existsSync(matchDir)) return []
  return readdirSync(matchDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson(join(matchDir, file)))
    .filter((match) => match && match.status === 'final'
      && match.home?.score !== null && match.away?.score !== null)
}

/** Results for one team, oldest first, within the season window. */
function resultsFor(matches, teamName, window) {
  return matches
    .filter((match) => {
      const kickoff = new Date(match.kickoff).getTime()
      return Number.isFinite(kickoff) && kickoff >= window.from && kickoff <= window.to
        && (match.home.name === teamName || match.away.name === teamName)
    })
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
    .map((match) => {
      const isHome = match.home.name === teamName
      const own = isHome ? match.home.score : match.away.score
      const other = isHome ? match.away.score : match.home.score
      if (own > other) return 'W'
      if (own < other) return 'L'
      return 'D'
    })
}

let filesChanged = 0
let rowsFilled = 0
let rowsBlanked = 0

for (const competitionId of readdirSync(dataDir)) {
  const competitionDir = join(dataDir, competitionId)
  if (!existsSync(join(competitionDir, 'matches'))) continue

  const tableFiles = readdirSync(competitionDir).filter((f) => f.startsWith('table-'))
  if (!tableFiles.length) continue

  const matches = loadMatches(competitionId)

  for (const file of tableFiles) {
    const path = join(competitionDir, file)
    const table = JSON.parse(readFileSync(path, 'utf8'))
    const season = Number(file.replace('table-', '').replace('.json', ''))
    const window = seasonWindow(season)

    let verified = 0
    const rows = table.rows.map((row) => {
      const all = resultsFor(matches, row.team.name, window)

      // The table may cover fewer matches than the archive holds - a Champions
      // Cup table is one pool while the archive has the knockouts too, and a
      // league table stops at the regular season. Take the matches the table
      // itself accounts for.
      const played = Number.isFinite(row.played) ? row.played : all.length
      const results = all.slice(0, played)

      // Self-check: the derived results must reproduce the row's own record.
      // If they do not, the two are describing different things and the form
      // is not safe to draw next to that record.
      const won = results.filter((r) => r === 'W').length
      const lost = results.filter((r) => r === 'L').length
      const drawn = results.filter((r) => r === 'D').length
      const reconciles = won === row.won && lost === row.lost && drawn === (row.drawn ?? 0)

      if (results.length < MIN_MATCHES || !reconciles) return { ...row, form: '' }
      verified += 1
      return { ...row, form: results.slice(-FORM_LENGTH).join('') }
    })

    // All or nothing. Dots on four rows of sixteen looks like a rendering
    // fault, not a deliberate omission, so a table only carries form when
    // every one of its rows reconciles against the match archive.
    const everyRowVerified = verified === table.rows.length
    const finalRows = everyRowVerified ? rows : table.rows.map((row) => ({ ...row, form: '' }))

    // A pool table is not a competition table. The Champions Cup files hold one
    // pool of six out of twenty-four teams, so a graphic titled "Standings"
    // would silently omit three quarters of the competition.
    // Deliberately NOT windowed. The question is "does this table cover the
    // whole competition?", so the comparison is against how many teams the
    // competition has at all - every match on file. Windowing it would drop the
    // flag for a season whose matches are not in the archive, which is exactly
    // when a lone pool table is most misleading.
    const teamsInCompetition = new Set(matches.flatMap((m) => [m.home.name, m.away.name]))
    const partial = teamsInCompetition.size > table.rows.length * 1.5

    const label = `${table.competition?.name || competitionId} ${season}`
    const status = everyRowVerified
      ? `form verified for all ${verified}`
      : `form blanked (${verified}/${table.rows.length} reconciled)`
    process.stdout.write(`${label.padEnd(38)} ${status}${partial ? '  [POOL ONLY]' : ''}` + String.fromCharCode(10))

    if (everyRowVerified) rowsFilled += verified
    else rowsBlanked += table.rows.length
    if (!checkOnly) {
      writeFileSync(path, `${JSON.stringify({ ...table, partial, rows: finalRows })}\n`)
      filesChanged += 1
    }
  }
}

process.stdout.write(`\n${rowsFilled} rows given real form, ${rowsBlanked} blanked for lack of matches\n`)
process.stdout.write(checkOnly ? 'check only - nothing written\n' : `${filesChanged} table files rewritten\n`)
