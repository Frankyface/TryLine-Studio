/**
 * Per-team home and away records for a competition season.
 *
 * Computed from match results because no feed publishes it. Written to
 * data/{competitionId}/season-{year}.json for the app to read directly.
 *
 * Only written where the archive can actually support it: a team needs enough
 * matches at each venue for a rate to mean anything, and a competition needs
 * enough teams to be worth plotting. Cup pools and international windows are
 * excluded by those thresholds rather than by name.
 *
 * Usage: node scripts/build-season-stats.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

/** A home or away win rate below this many games is noise. */
const MIN_PER_VENUE = 4

/** Fewer teams than this and there is no league to compare within. */
const MIN_TEAMS = 6

/** Seasons run July to June and are labelled by the year they end in. */
const seasonWindow = (season) => ({
  from: Date.UTC(season - 1, 6, 1),
  to: Date.UTC(season, 5, 30, 23, 59, 59),
})

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`skipped unreadable ${path}: ${error.message}${NL}`)
    return null
  }
}

function loadMatches(competitionId) {
  const matchDir = join(dataDir, competitionId, 'matches')
  if (!existsSync(matchDir)) return []
  return readdirSync(matchDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson(join(matchDir, file)))
    .filter((match) => match
      && match.status === 'final'
      && match.home?.score !== null && match.away?.score !== null
      && match.home?.name && match.away?.name)
}

const emptyRecord = () => ({
  played: 0, won: 0, drawn: 0, lost: 0, pointsFor: 0, pointsAgainst: 0,
})

function addResult(record, own, other) {
  record.played += 1
  record.pointsFor += own
  record.pointsAgainst += other
  if (own > other) record.won += 1
  else if (own < other) record.lost += 1
  else record.drawn += 1
}

/** A draw counts as half a win, the same convention the win model uses. */
const winRate = (record) => (record.played
  ? (record.won + record.drawn * 0.5) / record.played
  : null)

function buildSeason(competitionId, season, matches) {
  const window = seasonWindow(season)
  const inSeason = matches.filter((match) => {
    const kickoff = new Date(match.kickoff).getTime()
    return Number.isFinite(kickoff) && kickoff >= window.from && kickoff <= window.to
  })
  if (!inSeason.length) return null

  const byTeam = new Map()
  const teamOf = (side) => {
    if (!byTeam.has(side.name)) {
      byTeam.set(side.name, {
        team: {
          id: side.id,
          name: side.name,
          shortName: side.shortName || side.name,
          abbreviation: side.abbreviation,
          logo: side.logo,
        },
        home: emptyRecord(),
        away: emptyRecord(),
      })
    }
    return byTeam.get(side.name)
  }

  for (const match of inSeason) {
    addResult(teamOf(match.home).home, match.home.score, match.away.score)
    addResult(teamOf(match.away).away, match.away.score, match.home.score)
  }

  // A team needs a real sample at BOTH venues, or its dumbbell is a guess.
  const teams = [...byTeam.values()]
    .filter((entry) => entry.home.played >= MIN_PER_VENUE && entry.away.played >= MIN_PER_VENUE)
    .map((entry) => ({
      ...entry,
      homeWinRate: winRate(entry.home),
      awayWinRate: winRate(entry.away),
      gap: winRate(entry.home) - winRate(entry.away),
    }))
    .sort((a, b) => b.gap - a.gap)

  if (teams.length < MIN_TEAMS) return null

  const homeWins = inSeason.filter((m) => m.home.score > m.away.score).length
  const draws = inSeason.filter((m) => m.home.score === m.away.score).length
  const first = inSeason[0]

  return {
    competition: {
      id: first.competition?.id || competitionId,
      name: first.competition?.name || '',
      abbreviation: first.competition?.abbreviation || '',
    },
    season: { year: season, display: String(season) },
    matches: inSeason.length,
    leagueHomeWinRate: (homeWins + draws * 0.5) / inSeason.length,
    teams,
  }
}

const competitions = readdirSync(dataDir).filter((id) => existsSync(join(dataDir, id, 'matches')))
let written = 0
const summary = []

for (const competitionId of competitions) {
  const produced = []
  const matches = loadMatches(competitionId)
  if (!matches.length) continue

  // Which seasons does this competition actually have matches in?
  const seasons = new Set()
  for (const match of matches) {
    const date = new Date(match.kickoff)
    if (Number.isNaN(date.getTime())) continue
    seasons.add(date.getUTCMonth() >= 6 ? date.getUTCFullYear() + 1 : date.getUTCFullYear())
  }

  for (const season of [...seasons].sort()) {
    const path = join(dataDir, competitionId, `season-${season}.json`)
    const built = buildSeason(competitionId, season, matches)

    if (!built) {
      // Never leave a stale file behind when a season stops qualifying.
      if (!checkOnly && existsSync(path)) rmSync(path)
      continue
    }

    summary.push(`${(built.competition.name || competitionId).padEnd(32)} ${season}  `
      + `${String(built.teams.length).padStart(2)} teams, ${String(built.matches).padStart(3)} matches, `
      + `home win ${(built.leagueHomeWinRate * 100).toFixed(1)}%`)
    produced.push(season)
    if (!checkOnly) {
      writeFileSync(path, `${JSON.stringify(built)}${NL}`)
      written += 1
    }
  }

  // Record which seasons exist so the app never has to probe for a missing
  // file - a 404 the app handles is still a 404 in the console.
  const indexPath = join(dataDir, competitionId, 'index.json')
  if (!checkOnly && existsSync(indexPath)) {
    const index = readJson(indexPath)
    if (index) writeFileSync(indexPath, `${JSON.stringify({ ...index, seasons: produced })}${NL}`)
  }
}

process.stdout.write(summary.join(NL) + NL + NL)
process.stdout.write(checkOnly
  ? `${summary.length} season(s) qualify - nothing written${NL}`
  : `wrote ${written} season file(s)${NL}`)
