/**
 * Home-advantage analysis. The gate matters as much as the arithmetic: a rate
 * built on two home games says nothing, and drawing it anyway would invent a
 * fortress out of noise.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  canPlotFortress, fortressRows, fortressHighlights, formatRate, MIN_TEAMS_FOR_FORTRESS,
} from '../src/analysis/fortress.js'

const here = dirname(fileURLToPath(import.meta.url))
const top14Path = join(here, '..', 'data', '270559', 'season-2026.json')
const haveTop14 = existsSync(top14Path)
const top14 = haveTop14 ? JSON.parse(readFileSync(top14Path, 'utf8')) : null

const entry = (name, homeWinRate, awayWinRate, played = 9) => ({
  team: { name, shortName: name, abbreviation: name.slice(0, 3).toUpperCase() },
  home: { played, won: Math.round(homeWinRate * played), drawn: 0, lost: 0 },
  away: { played, won: Math.round(awayWinRate * played), drawn: 0, lost: 0 },
  homeWinRate,
  awayWinRate,
})

const seasonOf = (teams, extra = {}) => ({
  competition: { name: 'Test League' },
  season: { display: '2026' },
  matches: 100,
  leagueHomeWinRate: 0.65,
  teams,
  ...extra,
})

const league = (count = 8) => seasonOf(
  Array.from({ length: count }, (_, i) => entry(`Team ${i}`, 0.9 - i * 0.05, 0.4 - i * 0.02)),
)

describe('canPlotFortress', () => {
  it('accepts a full league', () => {
    expect(canPlotFortress(league())).toBe('')
  })

  it('refuses too few teams', () => {
    expect(canPlotFortress(league(3))).toMatch(/only 3 teams/i)
    expect(MIN_TEAMS_FOR_FORTRESS).toBeGreaterThan(3)
  })

  it('refuses nothing at all', () => {
    expect(canPlotFortress(null)).toMatch(/no season data/i)
    expect(canPlotFortress({ teams: [] })).toMatch(/no season data/i)
  })
})

describe('fortressRows', () => {
  it('orders by the size of the gap, widest first', () => {
    const rows = fortressRows(seasonOf([
      entry('Even', 0.5, 0.45),
      entry('Fortress', 0.9, 0.1),
      entry('Middling', 0.6, 0.4),
    ]))
    expect(rows.map((r) => r.team.name)).toEqual(['Fortress', 'Middling', 'Even'])
  })

  it('computes the gap as home minus away', () => {
    const [row] = fortressRows(seasonOf([entry('Alpha', 0.875, 0.143)]))
    expect(row.gap).toBeCloseTo(0.732, 3)
  })

  it('keeps a negative gap rather than hiding it', () => {
    // A side that travels better than it hosts is the interesting case.
    const [row] = fortressRows(seasonOf([entry('Travellers', 0.2, 0.5)]))
    expect(row.gap).toBeCloseTo(-0.3, 5)
  })

  it('skips teams with no rate on either side', () => {
    const rows = fortressRows(seasonOf([
      entry('Alpha', 0.5, 0.5),
      { team: { name: 'Ghost' }, home: { played: 0 }, away: { played: 0 }, homeWinRate: null, awayWinRate: null },
    ]))
    expect(rows).toHaveLength(1)
  })

  it('honours a limit', () => {
    expect(fortressRows(league(12), { limit: 5 })).toHaveLength(5)
  })

  it('handles no season at all', () => {
    expect(fortressRows(null)).toEqual([])
  })
})

describe('fortressHighlights', () => {
  it('names the strongest fortress', () => {
    const highlights = fortressHighlights(seasonOf([
      entry('Even', 0.5, 0.45), entry('Fortress', 0.9, 0.1),
    ]))
    expect(highlights.strongest.team.name).toBe('Fortress')
  })

  it('only reports a reversed side when the gap is genuinely negative', () => {
    expect(fortressHighlights(league()).reversed).toBeNull()
    const withReversed = fortressHighlights(seasonOf([
      entry('Fortress', 0.9, 0.1), entry('Travellers', 0.2, 0.6),
    ]))
    expect(withReversed.reversed.team.name).toBe('Travellers')
  })

  it('returns an empty object for no teams', () => {
    expect(fortressHighlights({ teams: [] })).toEqual({})
  })
})

describe('formatRate', () => {
  it('renders a rate as a whole percentage', () => {
    expect(formatRate(0.875)).toBe('88%')
    expect(formatRate(0)).toBe('0%')
    expect(formatRate(1)).toBe('100%')
  })
})

describe('against the real Top 14 season', () => {
  it.skipIf(!haveTop14)('is plottable', () => {
    expect(canPlotFortress(top14)).toBe('')
  })

  it.skipIf(!haveTop14)('gives every team a real sample at both venues', () => {
    for (const row of fortressRows(top14)) {
      expect(row.homePlayed).toBeGreaterThanOrEqual(4)
      expect(row.awayPlayed).toBeGreaterThanOrEqual(4)
    }
  })

  it.skipIf(!haveTop14)('reproduces the known league home-win rate', () => {
    // Independently measured at 72.7% across 172 matches.
    expect(top14.leagueHomeWinRate).toBeCloseTo(0.727, 2)
    expect(top14.matches).toBe(172)
  })

  it.skipIf(!haveTop14)('finds a genuine fortress at the top', () => {
    const [strongest] = fortressRows(top14)
    expect(strongest.gap).toBeGreaterThan(0.4)
    expect(strongest.home).toBeGreaterThan(strongest.away)
  })
})
