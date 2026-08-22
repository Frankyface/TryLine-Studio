/**
 * The one line at the top of each chart.
 *
 * What these pin down is COVERAGE and honesty, not wording: a headline that is
 * sometimes blank sends the chart back to a generic title, and a headline
 * derived from a probability rather than the scoreboard reports the venue.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { winprobHeadline, timelineIsComplete } from '../src/analysis/winprob.js'
import { seasonHeadline, canPlotSeason } from '../src/analysis/season.js'
import { fortressHeadline } from '../src/analysis/fortress.js'
import { teamSeasonHeadlineLine, teamSeasonTimeline, teamsWithTimeline } from '../src/analysis/team-season.js'
import { createMatch, createTable, createSeason } from '../src/data/schema.js'

const MODEL = { k: 0.92, h: 0.81 }
const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

const score = (minute, homeScore, awayScore) => ({
  minute, side: 'home', type: 'try', homeScore, awayScore,
})

const matchOf = (events, home, away) => createMatch({
  home: { name: 'Home', shortName: 'Home', score: home },
  away: { name: 'Away', shortName: 'Away', score: away },
  status: 'final',
  timeline: events,
})

describe('winprobHeadline', () => {
  it('never says a wire-to-wire winner was behind', () => {
    // The trap: the model gives an away side 0.31 at kick-off, so 71 matches
    // whose winner led throughout would read "down to 31% at 1'" - the
    // measure reporting the venue rather than the match.
    const awayLedThroughout = matchOf([score(5, 0, 7), score(60, 0, 28)], 0, 28)
    expect(winprobHeadline(awayLedThroughout, MODEL)).toBe('Away never trailed')
  })

  it('names the low point when the winner was genuinely in trouble', () => {
    const comeback = matchOf([score(20, 0, 21), score(78, 24, 21)], 24, 21)
    expect(winprobHeadline(comeback, MODEL)).toMatch(/^Home down to \d+% at \d+'$/)
  })

  it('falls back to the deficit when the low point was not dramatic', () => {
    const slight = matchOf([score(10, 0, 3), score(40, 24, 3)], 24, 3)
    expect(winprobHeadline(slight, MODEL)).toBe('Home came from 3 down')
  })

  it('has something to say about a draw', () => {
    expect(winprobHeadline(matchOf([score(40, 17, 17)], 17, 17), MODEL))
      .toBe('17-17 and nothing in it')
  })

  it('says nothing for a match with no score', () => {
    expect(winprobHeadline(matchOf([], null, null), MODEL)).toBe('')
  })
})

describe('seasonHeadline', () => {
  it('breaks a tie deterministically', () => {
    // Two clubs on exactly the same net figure is real: URC 2026 has one.
    // Without a tiebreak the headline changes between renders of one data set.
    const tied = createTable({
      rows: [
        { team: { name: 'Alpha', shortName: 'Alpha' }, rank: 2, played: 10, pointsFor: 300, pointsAgainst: 200 },
        { team: { name: 'Bravo', shortName: 'Bravo' }, rank: 1, played: 10, pointsFor: 300, pointsAgainst: 200 },
      ],
    })
    expect(seasonHeadline(tied)).toBe(seasonHeadline(tied))
    expect(seasonHeadline(tied)).toMatch(/^Bravo scored 30, conceded 20$/)
  })
})

describe('fortressHeadline', () => {
  it('states the league rate, not one club', () => {
    expect(fortressHeadline({ leagueHomeWinRate: 0.727, teams: [] }))
      .toBe('The home side wins 73% of the time')
  })

  it('falls back to the rows when the rate is missing', () => {
    const season = {
      teams: Array.from({ length: 6 }, (_, i) => ({
        team: { name: `T${i}` },
        home: { played: 9 }, away: { played: 9 },
        homeWinRate: i < 5 ? 0.8 : 0.2, awayWinRate: 0.3,
      })),
    }
    expect(fortressHeadline(season)).toBe('5 of 6 clubs are better at home')
  })
})

describe('every real subject gets a headline', () => {
  const seasons = []
  const tables = []
  const matches = []
  if (existsSync(dataDir)) {
    for (const id of readdirSync(dataDir)) {
      const dir = join(dataDir, id)
      if (!statSync(dir).isDirectory()) continue
      for (const file of readdirSync(dir)) {
        const path = join(dir, file)
        if (file.startsWith('season-')) seasons.push(createSeason(JSON.parse(readFileSync(path, 'utf8'))))
        if (file.startsWith('table-')) tables.push(createTable(JSON.parse(readFileSync(path, 'utf8'))))
      }
      const matchDir = join(dir, 'matches')
      if (!existsSync(matchDir)) continue
      for (const file of readdirSync(matchDir)) {
        matches.push(createMatch(JSON.parse(readFileSync(join(matchDir, file), 'utf8'))))
      }
    }
  }

  it.skipIf(!matches.length)('winprob, on every drawable match', () => {
    const drawable = matches.filter((match) => match.status === 'final' && timelineIsComplete(match))
    expect(drawable.length).toBeGreaterThan(500)
    expect(drawable.filter((match) => !winprobHeadline(match, MODEL))).toEqual([])
  })

  it.skipIf(!tables.length)('scatter, on every table it will draw', () => {
    const drawable = tables.filter((table) => !canPlotSeason(table))
    expect(drawable.length).toBeGreaterThan(0)
    expect(drawable.filter((table) => !seasonHeadline(table))).toEqual([])
  })

  it.skipIf(!seasons.length)('fortress, on every season', () => {
    expect(seasons.filter((season) => !fortressHeadline(season))).toEqual([])
  })

  it.skipIf(!seasons.length)('teamseason, on every drawable club', () => {
    let checked = 0
    for (const season of seasons) {
      for (const team of teamsWithTimeline(season)) {
        checked += 1
        expect(teamSeasonHeadlineLine(teamSeasonTimeline(season, team.name))).not.toBe('')
      }
    }
    expect(checked).toBeGreaterThan(40)
  })
})
