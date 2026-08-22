/**
 * One club's season. The arithmetic is simple; what these pin down is that the
 * chart never invents a story the scores do not support - a symmetric axis, a
 * running total that matches the final difference, and a gate that agrees with
 * what can actually be drawn.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  canPlotTeamSeason, teamSeasonTimeline, teamSeasonHeadline, marginBounds, seasonScope,
  seasonCoverage, teamsWithTimeline, MIN_MATCHES_FOR_TEAM_SEASON, RESULTS,
} from '../src/analysis/team-season.js'

const match = (date, opponent, own, other, venue = 'home') => ({
  date, opponent: { name: opponent, shortName: opponent, abbreviation: opponent.slice(0, 3).toUpperCase() },
  venue, for: own, against: other,
})

const seasonOf = (matches) => ({
  competition: { name: 'Test League' },
  season: { display: '2026' },
  teams: [{
    team: { name: 'Alpha', shortName: 'Alpha', abbreviation: 'ALP' },
    home: { played: 0 }, away: { played: 0 },
    homeWinRate: null, awayWinRate: null,
    matches,
  }],
})

const eight = [
  match('2025-09-06', 'Bravo', 30, 10),
  match('2025-09-13', 'Charlie', 12, 24, 'away'),
  match('2025-09-20', 'Delta', 18, 18),
  match('2025-09-27', 'Echo', 25, 20, 'away'),
  match('2025-10-04', 'Foxtrot', 40, 5),
  match('2025-10-11', 'Golf', 7, 35, 'away'),
  match('2025-10-18', 'Hotel', 22, 19),
  match('2025-10-25', 'India', 31, 14, 'away'),
]

describe('canPlotTeamSeason', () => {
  it('accepts a full season', () => {
    expect(canPlotTeamSeason(seasonOf(eight), 'Alpha')).toBe('')
  })

  it('refuses a team with too few matches', () => {
    expect(canPlotTeamSeason(seasonOf(eight.slice(0, 3)), 'Alpha')).toMatch(/only 3 matches/i)
    expect(MIN_MATCHES_FOR_TEAM_SEASON).toBeGreaterThan(3)
  })

  it('refuses a team that is not in the season', () => {
    expect(canPlotTeamSeason(seasonOf(eight), 'Nobody')).toMatch(/no record/i)
  })

  it('asks for a team when none is picked', () => {
    expect(canPlotTeamSeason(seasonOf(eight), '')).toMatch(/pick a team/i)
  })

  it('refuses nothing at all', () => {
    expect(canPlotTeamSeason(null, 'Alpha')).toMatch(/no season data/i)
  })
})

describe('what the chart says it is missing', () => {
  const tableOf = (played, name = 'Alpha') => ({ rows: [{ team: { name }, played }] })
  const timelineOf = (matches, extra = {}) => teamSeasonTimeline(
    { ...seasonOf(matches), teams: [{ ...seasonOf(matches).teams[0], ...extra }] },
    'Alpha',
  )

  it('states a gap rather than refusing to draw', () => {
    // The real case: the archive holds 17 Gallagher matches for Saracens where
    // the table records 18, and ESPN simply does not have 10 Top 14 results.
    // Refusing cost most of two leagues; a STATED gap is not misleading.
    expect(canPlotTeamSeason(seasonOf(eight), 'Alpha', { table: tableOf(9) })).toBe('')
    expect(seasonScope(teamSeasonTimeline(seasonOf(eight), 'Alpha'), tableOf(9)))
      .toBe('8 OF 9 MATCHES RECORDED')
  })

  it('says nothing when the archive is complete', () => {
    expect(seasonScope(teamSeasonTimeline(seasonOf(eight), 'Alpha'), tableOf(8))).toBe('')
  })

  it('calls a record longer than the table what it is', () => {
    expect(seasonScope(teamSeasonTimeline(seasonOf(eight), 'Alpha'), tableOf(6)))
      .toMatch(/play-offs/i)
  })

  it('finds a gap with no league table at all, from the fixture count', () => {
    // Major League Rugby has no table. Five of its six clubs were drawing a
    // season several fixtures short with nothing to say so - one of them a
    // perfect "12 from 12" that was 12 of 14.
    expect(seasonScope(timelineOf(eight, { fixtures: 11 }), null))
      .toBe('8 OF 11 MATCHES RECORDED')
  })

  it('prefers whichever source knows about more matches', () => {
    // Table says 9, fixtures say 12 - the chart is short by the larger.
    expect(seasonCoverage(timelineOf(eight, { fixtures: 12 }), tableOf(9)))
      .toMatchObject({ recorded: 8, expected: 12 })
  })

  it('never claims to be missing matches it actually has', () => {
    // Both sources undercount; the chart holds more than either knows about,
    // so there is no gap - it reads as the play-offs case instead.
    expect(seasonCoverage(timelineOf(eight, { fixtures: 2 }), tableOf(3)))
      .toMatchObject({ recorded: 8, expected: 8 })
    expect(seasonScope(timelineOf(eight, { fixtures: 2 }), tableOf(3)))
      .not.toMatch(/OF \d+ MATCHES/)
  })

  it('matches the table row whatever its case or padding', () => {
    // An exact-string compare fails OPEN: a rename would silently turn a
    // stated gap into an unstated one.
    expect(seasonScope(teamSeasonTimeline(seasonOf(eight), 'Alpha'), tableOf(9, 'ALPHA')))
      .toBe('8 OF 9 MATCHES RECORDED')
    expect(seasonScope(teamSeasonTimeline(seasonOf(eight), 'Alpha'), tableOf(9, '  alpha  ')))
      .toBe('8 OF 9 MATCHES RECORDED')
  })

  it('never mistakes a lagging league table for play-offs', () => {
    // A table one round behind the scoreboard feed exceeds nothing but its own
    // staleness, and claiming play-offs for every club would be plainly wrong.
    // The fixture count is what tells them apart: mid-season the competition
    // still lists more fixtures than the archive holds, so the gap note fires
    // first and the play-offs branch is never reached.
    const lagging = timelineOf(eight, { fixtures: 18 })
    expect(seasonScope(lagging, tableOf(3))).toBe('8 OF 18 MATCHES RECORDED')

    // The genuine article: the archive holds everything the competition lists,
    // and more than the table's regular-season count.
    const playoffs = timelineOf(eight, { fixtures: 8 })
    expect(seasonScope(playoffs, tableOf(6))).toMatch(/play-offs/i)
  })

  it('says nothing when there is no table and no fixture count', () => {
    expect(seasonScope(teamSeasonTimeline(seasonOf(eight), 'Alpha'), null)).toBe('')
  })
})

describe('a match with no score is not a nil-all draw', () => {
  it('refuses a timeline carrying one', () => {
    const withNull = [...eight.slice(0, 7), {
      date: '2025-11-01', opponent: { name: 'Zulu' }, venue: 'home', for: null, against: null,
    }]
    expect(canPlotTeamSeason(seasonOf(withNull), 'Alpha')).toMatch(/no score recorded/i)
  })

  it('and does not offer that team in the picker', () => {
    const withNull = [...eight.slice(0, 7), {
      date: '2025-11-01', opponent: { name: 'Zulu' }, venue: 'home', for: null, against: null,
    }]
    expect(teamsWithTimeline(seasonOf(withNull))).toEqual([])
  })
})

describe('teamSeasonTimeline', () => {
  const timeline = teamSeasonTimeline(seasonOf(eight), 'Alpha')

  it('orders by date regardless of the order in the file', () => {
    const shuffled = teamSeasonTimeline(seasonOf([...eight].reverse()), 'Alpha')
    expect(shuffled.matches.map((m) => m.date)).toEqual(eight.map((m) => m.date))
  })

  it('labels each result from the scores', () => {
    expect(timeline.matches.map((m) => m.result).join(''))
      .toBe([RESULTS.WIN, RESULTS.LOSS, RESULTS.DRAW, RESULTS.WIN,
        RESULTS.WIN, RESULTS.LOSS, RESULTS.WIN, RESULTS.WIN].join(''))
  })

  it('computes the margin as own score minus opponent', () => {
    expect(timeline.matches[0].margin).toBe(20)
    expect(timeline.matches[1].margin).toBe(-12)
    expect(timeline.matches[2].margin).toBe(0)
  })

  it('accumulates the running difference', () => {
    expect(timeline.matches.map((m) => m.running))
      .toEqual([20, 8, 8, 13, 48, 20, 23, 40])
  })

  it('returns null for a team it does not hold', () => {
    expect(teamSeasonTimeline(seasonOf(eight), 'Nobody')).toBeNull()
  })
})

describe('teamSeasonHeadline', () => {
  const headline = teamSeasonHeadline(teamSeasonTimeline(seasonOf(eight), 'Alpha'))

  it('reports the record', () => {
    expect(headline).toMatchObject({ played: 8, won: 5, drawn: 1, lost: 2 })
  })

  it('agrees with the running total', () => {
    expect(headline.pointsFor - headline.pointsAgainst).toBe(headline.difference)
  })

  it('names the extreme results', () => {
    expect(headline.biggestWin.margin).toBe(35)
    expect(headline.biggestLoss.margin).toBe(-28)
  })

  it('finds the longest winning run', () => {
    // Wins at index 0, 3, 4, 6, 7 - the longest unbroken run is two.
    expect(headline.longestWinStreak).toBe(2)
  })

  it('reports nothing rather than zero where there is nothing to say', () => {
    const unbeaten = teamSeasonHeadline(teamSeasonTimeline(seasonOf([
      match('2025-09-06', 'Bravo', 30, 10), match('2025-09-13', 'Charlie', 20, 10),
    ]), 'Alpha'))
    expect(unbeaten.biggestLoss).toBeNull()
    expect(unbeaten.biggestWin.margin).toBe(20)
  })

  it('survives an empty season', () => {
    const empty = teamSeasonHeadline({ matches: [] })
    expect(empty.played).toBe(0)
    expect(empty.biggestWin).toBeNull()
    expect(empty.longestWinStreak).toBe(0)
  })
})

describe('marginBounds', () => {
  it('spans the real range in both directions', () => {
    const bounds = marginBounds(teamSeasonTimeline(seasonOf(eight), 'Alpha'))
    expect(bounds.high).toBe(35)
    expect(bounds.low).toBe(-28)
  })

  it('always includes zero, so the axis is inside the chart', () => {
    const allWins = teamSeasonTimeline(seasonOf([
      match('2025-09-06', 'Bravo', 30, 10), match('2025-09-13', 'Charlie', 40, 12),
    ]), 'Alpha')
    const bounds = marginBounds(allWins)
    expect(bounds.low).toBeLessThanOrEqual(0)
    expect(bounds.high).toBeGreaterThanOrEqual(0)
  })

  it('uses one scale for both directions, so equal margins draw equal bars', () => {
    // The property that matters: a 20-point win and a 20-point defeat must map
    // to the same length. That is a single points-per-pixel over the whole
    // span, which is what a caller derives from these bounds.
    const bounds = marginBounds(teamSeasonTimeline(seasonOf([
      match('2025-09-06', 'Bravo', 30, 10), match('2025-09-13', 'Charlie', 10, 30),
      match('2025-09-20', 'Delta', 25, 20), match('2025-09-27', 'Echo', 20, 25),
      match('2025-10-04', 'Fox', 18, 18), match('2025-10-11', 'Golf', 22, 20),
    ]), 'Alpha'))
    const perPoint = 100 / (bounds.high - bounds.low)
    expect(Math.abs(20) * perPoint).toBe(Math.abs(-20) * perPoint)
  })

  it('never collapses to a zero-height axis', () => {
    const drawsOnly = teamSeasonTimeline(seasonOf([
      match('2025-09-06', 'Bravo', 10, 10), match('2025-09-13', 'Charlie', 12, 12),
    ]), 'Alpha')
    const bounds = marginBounds(drawsOnly)
    expect(bounds.high - bounds.low).toBeGreaterThan(0)
  })
})

describe('teamsWithTimeline', () => {
  it('offers only teams that can actually be drawn', () => {
    const season = {
      teams: [
        { team: { name: 'Full' }, matches: eight },
        { team: { name: 'Sparse' }, matches: eight.slice(0, 2) },
        { team: { name: 'None' } },
      ],
    }
    expect(teamsWithTimeline(season).map((t) => t.name)).toEqual(['Full'])
  })

  it('asks exactly the question the gate asks', () => {
    // The picker used to filter on match count alone while the gate also
    // checked the table, so it offered 16 URC clubs of which 7 drew and the
    // app opened on one it immediately refused.
    const season = {
      teams: [
        { team: { name: 'Full' }, matches: eight },
        { team: { name: 'Sparse' }, matches: eight.slice(0, 2) },
      ],
    }
    const table = { rows: [{ team: { name: 'Full' }, played: 40 }] }
    for (const team of teamsWithTimeline(season, { table })) {
      expect(canPlotTeamSeason(season, team.name, { table })).toBe('')
    }
  })
})

/* ---------- against the real archive ---------- */

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

function realSeasonWithTimelines() {
  if (!existsSync(dataDir)) return null
  for (const competitionId of readdirSync(dataDir)) {
    const dir = join(dataDir, competitionId)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    for (const file of readdirSync(dir).filter((f) => f.startsWith('season-'))) {
      const season = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      if (teamsWithTimeline(season).length) return season
    }
  }
  return null
}

const real = realSeasonWithTimelines()

describe('against a real season', () => {
  it.skipIf(!real)('every drawable team reconciles with its stored record', () => {
    for (const team of teamsWithTimeline(real)) {
      const timeline = teamSeasonTimeline(real, team.name)
      const headline = teamSeasonHeadline(timeline)
      const entry = real.teams.find((e) => e.team.name === team.name)

      // The timeline must agree with the home/away aggregates already in the
      // file, or the chart and the rest of the app disagree about the season.
      const stored = {
        played: entry.home.played + entry.away.played,
        won: entry.home.won + entry.away.won,
        drawn: entry.home.drawn + entry.away.drawn,
        lost: entry.home.lost + entry.away.lost,
      }
      expect({ team: team.name, ...stored })
        .toEqual({
          team: team.name,
          played: headline.played,
          won: headline.won,
          drawn: headline.drawn,
          lost: headline.lost,
        })
    }
  })

  it.skipIf(!real)('always brackets zero and every margin', () => {
    for (const team of teamsWithTimeline(real)) {
      const timeline = teamSeasonTimeline(real, team.name)
      const bounds = marginBounds(timeline)
      expect(bounds.low).toBeLessThanOrEqual(0)
      expect(bounds.high).toBeGreaterThanOrEqual(0)
      for (const m of timeline.matches) {
        expect(m.margin).toBeGreaterThanOrEqual(bounds.low)
        expect(m.margin).toBeLessThanOrEqual(bounds.high)
      }
    }
  })
})
