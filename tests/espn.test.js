/**
 * Adapter tests run against real captured ESPN responses, not synthetic stubs.
 * Fixtures: 2026 Six Nations round 1 (France 36-14 Ireland), 2026 URC.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  adaptScoreboard, adaptSummary, adaptStandings,
  buildScoreboardUrl, buildSummaryUrl, buildStandingsUrl, toEspnDate,
} from '../src/data/espn.js'
import { MATCH_STATUS, SCORE_EVENTS, validateMatch, MATCHDAY_SQUAD } from '../src/data/schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'))

const sixNations = fixture('espn-scoreboard-six-nations-2026.json')
const urc = fixture('espn-scoreboard-urc-2026.json')
const franceIreland = fixture('espn-summary-fra-ire-2026.json')
const ulsterLeinster = fixture('espn-summary-uls-lei-2026.json')
const urcStandings = fixture('espn-standings-urc-2026.json')

describe('url builders', () => {
  it('builds a scoreboard url with a date range', () => {
    expect(buildScoreboardUrl('180659', { from: '20260201', to: '20260320' }))
      .toBe('https://site.api.espn.com/apis/site/v2/sports/rugby/180659/scoreboard?dates=20260201-20260320')
  })

  it('omits the date param when no range is given', () => {
    expect(buildScoreboardUrl('180659')).not.toContain('?')
  })

  it('builds summary and standings urls', () => {
    expect(buildSummaryUrl('180659', '602502')).toContain('summary?event=602502')
    expect(buildStandingsUrl('270557', 2026)).toContain('standings?season=2026')
  })

  it('formats dates as YYYYMMDD in UTC', () => {
    expect(toEspnDate('2026-02-05T20:10Z')).toBe('20260205')
    expect(toEspnDate(new Date(Date.UTC(2026, 0, 9)))).toBe('20260109')
  })

  it('throws on an unparseable date rather than emitting NaN', () => {
    expect(() => toEspnDate('not a date')).toThrow(/Invalid date/)
  })
})

describe('adaptScoreboard', () => {
  const matches = adaptScoreboard(sixNations)

  it('returns every event in the response', () => {
    expect(matches).toHaveLength(15)
  })

  it('maps the opening fixture with the correct home and away sides', () => {
    const opener = matches.find((m) => m.id === '602502')
    expect(opener.home.name).toBe('France')
    expect(opener.away.name).toBe('Ireland')
    expect(opener.home.score).toBe(36)
    expect(opener.away.score).toBe(14)
    expect(opener.home.isWinner).toBe(true)
  })

  it('carries competition, venue and status through', () => {
    const opener = matches.find((m) => m.id === '602502')
    expect(opener.competition.name).toBe('Six Nations')
    expect(opener.venue.name).toBe('Stade de France')
    expect(opener.status).toBe(MATCH_STATUS.FINAL)
    expect(opener.season.year).toBe(2026)
  })

  it('builds a usable crest url for every team', () => {
    for (const match of matches) {
      expect(match.home.logo).toMatch(/^https:\/\/a\.espncdn\.com\//)
      expect(match.away.logo).toMatch(/^https:\/\/a\.espncdn\.com\//)
    }
  })

  it('normalises team colours to hex', () => {
    const opener = matches.find((m) => m.id === '602502')
    expect(opener.home.color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('reports unreported attendance as null, never zero', () => {
    for (const match of matches) {
      expect(match.venue.attendance).not.toBe(0)
    }
  })

  it('handles a second competition with the same code path', () => {
    const urcMatches = adaptScoreboard(urc)
    expect(urcMatches.length).toBeGreaterThan(0)
    expect(urcMatches[0].competition.name).toBe('United Rugby Championship')
    expect(urcMatches.every((m) => m.home.name && m.away.name)).toBe(true)
  })

  it('returns an empty list for a response with no events', () => {
    expect(adaptScoreboard({})).toEqual([])
    expect(adaptScoreboard({ events: [] })).toEqual([])
  })
})

describe('adaptSummary', () => {
  const match = adaptSummary(franceIreland)

  it('produces a renderable match', () => {
    expect(validateMatch(match)).toEqual([])
  })

  it('reads a full matchday squad for both sides', () => {
    expect(match.home.squad).toHaveLength(MATCHDAY_SQUAD)
    expect(match.away.squad).toHaveLength(MATCHDAY_SQUAD)
  })

  it('orders the squad by shirt number', () => {
    const jerseys = match.home.squad.map((p) => p.jersey)
    expect(jerseys).toEqual([...jerseys].sort((a, b) => a - b))
    expect(jerseys[0]).toBe(1)
  })

  it('marks exactly fifteen starters per side', () => {
    expect(match.home.squad.filter((p) => p.isStarter)).toHaveLength(15)
    expect(match.away.squad.filter((p) => p.isStarter)).toHaveLength(15)
  })

  it('keeps per-player stats as numbers', () => {
    const ramos = match.home.squad.find((p) => p.name === 'Thomas Ramos')
    expect(ramos.position).toBe('FB')
    expect(ramos.stats.metres).toBe(95)
    expect(ramos.stats.passes).toBe(21)
    expect(ramos.stats.conversionGoals).toBe(4)
  })

  it('builds a scoring timeline with minute, side and scorer', () => {
    const tries = match.timeline.filter((e) => e.type === SCORE_EVENTS.TRY)
    expect(tries.length).toBeGreaterThan(0)
    const first = tries[0]
    expect(first.minute).toBe(13)
    expect(first.side).toBe('home')
    expect(first.player.name).toBe('Louis Bielle-Biarrey')
  })

  it('drops non-scoring noise like substitutions from the timeline', () => {
    const types = new Set(match.timeline.map((e) => e.type))
    expect(types.has('player substituted')).toBe(false)
    expect(types.has('substitute on')).toBe(false)
  })

  it('assigns every timeline event to a side', () => {
    expect(match.timeline.every((e) => e.side === 'home' || e.side === 'away')).toBe(true)
  })

  it('adapts a different competition identically', () => {
    const other = adaptSummary(ulsterLeinster)
    expect(validateMatch(other)).toEqual([])
    expect(other.home.squad.length).toBeGreaterThan(0)
    expect(other.competition.name).toBe('United Rugby Championship')
  })

  it('falls back to the season year when the header has no display name', () => {
    expect(adaptSummary(franceIreland).season.display).toBe('2026')
  })

  it('does not throw on an empty payload', () => {
    expect(() => adaptSummary({})).not.toThrow()
  })
})

describe('adaptStandings', () => {
  const table = adaptStandings(urcStandings, { season: 2026 })

  it('reads every team in the league', () => {
    expect(table.rows).toHaveLength(16)
  })

  it('sorts by rank', () => {
    expect(table.rows.map((r) => r.rank)).toEqual([...table.rows.map((r) => r.rank)].sort((a, b) => a - b))
  })

  it('maps the rugby-specific columns', () => {
    const top = table.rows[0]
    expect(top.team.name).toBeTruthy()
    expect(top.played).toBeGreaterThan(0)
    expect(top.points).toBeGreaterThan(0)
    expect(top.bonusPoints).not.toBeNull()
    expect(top.triesFor).not.toBeNull()
    expect(top.form).toMatch(/^[WLTD]+$/)
  })

  it('keeps points difference signed and numeric', () => {
    for (const row of table.rows) {
      expect(typeof row.pointsDifference === 'number' || row.pointsDifference === null).toBe(true)
    }
  })

  it('ignores the stale ESPN season label and uses the requested season', () => {
    expect(table.season.year).toBe(2026)
    expect(JSON.stringify(table)).not.toContain('2023/24')
  })

  it('survives a payload with no children', () => {
    expect(adaptStandings({}).rows).toEqual([])
  })
})
