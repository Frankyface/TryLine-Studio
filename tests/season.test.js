/**
 * Season analysis. The gate matters as much as the maths here: a cup pool of
 * four games and a merged conference table both look like league tables and
 * would produce a confident, meaningless chart.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  seasonProfile, seasonBounds, seasonHighlights, canPlotSeason,
  QUADRANTS, MIN_GAMES_FOR_SEASON, MIN_TEAMS_FOR_SEASON,
} from '../src/analysis/season.js'
import { createTable } from '../src/data/schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const premPath = join(here, '..', 'data', '267979', 'table-2026.json')
const havePrem = existsSync(premPath)
const prem = havePrem ? createTable(JSON.parse(readFileSync(premPath, 'utf8'))) : null

const team = (name, played, pointsFor, pointsAgainst, extra = {}) => ({
  team: { name, shortName: name, abbreviation: name.slice(0, 3).toUpperCase() },
  played,
  pointsFor,
  pointsAgainst,
  pointsDifference: pointsFor - pointsAgainst,
  triesFor: extra.triesFor ?? 40,
  points: extra.points ?? 50,
  rank: extra.rank ?? 1,
})

const tableOf = (rows, extra = {}) => createTable({ rows, ...extra })

const league = (count = 10) => tableOf(
  Array.from({ length: count }, (_, i) => team(`Team ${i}`, 18, 500 + i * 20, 500 - i * 10, { rank: i + 1 })),
)

describe('canPlotSeason', () => {
  it('accepts a full league season', () => {
    expect(canPlotSeason(league())).toBe('')
  })

  it('refuses a single cup pool', () => {
    const pool = tableOf(
      Array.from({ length: 6 }, (_, i) => team(`Team ${i}`, 18, 400, 400)),
      { partial: true },
    )
    expect(canPlotSeason(pool)).toMatch(/single pool/i)
  })

  it('refuses a table with too few games per team', () => {
    const short = tableOf(Array.from({ length: 10 }, (_, i) => team(`Team ${i}`, 4, 100, 100)))
    expect(canPlotSeason(short)).toMatch(/4 games each/i)
    expect(MIN_GAMES_FOR_SEASON).toBeGreaterThan(4)
  })

  it('refuses a table with too few teams', () => {
    const tiny = tableOf(Array.from({ length: 4 }, (_, i) => team(`Team ${i}`, 18, 400, 400)))
    expect(canPlotSeason(tiny)).toMatch(/needs a league/i)
    expect(MIN_TEAMS_FOR_SEASON).toBeGreaterThan(4)
  })

  it('refuses a table missing points for or against', () => {
    const rows = Array.from({ length: 10 }, (_, i) => team(`Team ${i}`, 18, 400, 400))
    rows[3].pointsFor = null
    expect(canPlotSeason(tableOf(rows))).toMatch(/no points for/i)
  })

  it('refuses nothing at all', () => {
    expect(canPlotSeason(null)).toMatch(/no table/i)
    expect(canPlotSeason({ rows: [] })).toMatch(/no table/i)
  })
})

describe('seasonProfile', () => {
  it('computes per-game rates', () => {
    const profile = seasonProfile(tableOf([team('Alpha', 10, 300, 200, { triesFor: 30 })]))
    expect(profile.teams[0].attack).toBe(30)
    expect(profile.teams[0].defence).toBe(20)
    expect(profile.teams[0].triesPerGame).toBe(3)
  })

  it('places teams in the right quadrant relative to the league average', () => {
    const profile = seasonProfile(tableOf([
      team('Best', 10, 400, 100), // high attack, low concede
      team('Attackers', 10, 400, 400), // high attack, high concede
      team('Grinders', 10, 100, 100), // low attack, low concede
      team('Worst', 10, 100, 400), // low attack, high concede
    ]))
    const byName = Object.fromEntries(profile.teams.map((t) => [t.team.name, t.quadrant]))
    expect(byName.Best).toBe(QUADRANTS.ELITE)
    expect(byName.Attackers).toBe(QUADRANTS.ATTACKING)
    expect(byName.Grinders).toBe(QUADRANTS.DEFENSIVE)
    expect(byName.Worst).toBe(QUADRANTS.STRUGGLING)
  })

  it('skips teams that have not played', () => {
    const profile = seasonProfile(tableOf([team('Alpha', 10, 300, 200), team('Ghost', 0, 0, 0)]))
    expect(profile.teams).toHaveLength(1)
  })

  it('leaves tries per game null when the column is empty', () => {
    const rows = [team('Alpha', 10, 300, 200)]
    rows[0].triesFor = null
    expect(seasonProfile(tableOf(rows)).teams[0].triesPerGame).toBeNull()
  })

  it('handles an empty table without throwing', () => {
    expect(() => seasonProfile(tableOf([]))).not.toThrow()
    expect(seasonProfile(null).teams).toEqual([])
  })
})

describe('seasonBounds', () => {
  it('pads the range so no dot sits on the frame', () => {
    const profile = seasonProfile(tableOf([team('A', 10, 200, 200), team('B', 10, 400, 100)]))
    const bounds = seasonBounds(profile)
    expect(bounds.attack.low).toBeLessThan(20)
    expect(bounds.attack.high).toBeGreaterThan(40)
  })

  it('never produces a zero-width range when every team is identical', () => {
    const profile = seasonProfile(tableOf([team('A', 10, 300, 200), team('B', 10, 300, 200)]))
    const bounds = seasonBounds(profile)
    expect(bounds.attack.high).toBeGreaterThan(bounds.attack.low)
    expect(bounds.defence.high).toBeGreaterThan(bounds.defence.low)
  })
})

describe('seasonHighlights', () => {
  it('names the best attack and the best defence', () => {
    const profile = seasonProfile(tableOf([
      team('Scorers', 10, 400, 300),
      team('Stoppers', 10, 200, 100),
    ]))
    const highlights = seasonHighlights(profile)
    expect(highlights.bestAttack.team.name).toBe('Scorers')
    expect(highlights.bestDefence.team.name).toBe('Stoppers')
  })

  it('returns an empty object for no teams', () => {
    expect(seasonHighlights({ teams: [] })).toEqual({})
  })
})

describe('against the real Premiership table', () => {
  it.skipIf(!havePrem)('is plottable', () => {
    expect(canPlotSeason(prem)).toBe('')
  })

  it.skipIf(!havePrem)('reproduces the known extremes', () => {
    const profile = seasonProfile(prem)
    const highlights = seasonHighlights(profile)
    // Northampton led the league on attack; Exeter had the best defence.
    expect(highlights.bestAttack.team.name).toMatch(/Northampton/)
    expect(highlights.bestAttack.attack).toBeCloseTo(38.5, 0)
    expect(highlights.bestDefence.team.name).toMatch(/Exeter/)
    expect(highlights.bestDefence.defence).toBeCloseTo(20.4, 0)
  })

  it.skipIf(!havePrem)('occupies all four quadrants', () => {
    const quadrants = new Set(seasonProfile(prem).teams.map((t) => t.quadrant))
    expect(quadrants.size).toBe(4)
  })
})
