/**
 * The schema's fallback paths matter: real feeds drop fields constantly, and a
 * missing shortName or an unparseable score must degrade rather than throw.
 */
import { describe, it, expect } from 'vitest'
import {
  createPlayer, createTeam, createMatch, createScoreEvent, createTable, createTableRow,
  validateMatch, num, MATCH_STATUS, MATCHDAY_SQUAD, EVENT_POINTS, SCORE_EVENTS, POSITION_NAMES, createSeason,
} from '../src/data/schema.js'
import { adaptEvent, adaptSummary } from '../src/data/espn.js'

describe('num', () => {
  it('coerces numeric strings', () => {
    expect(num('36')).toBe(36)
    expect(num('0.83')).toBe(0.83)
    expect(num(0)).toBe(0)
  })

  it('returns null for anything unusable', () => {
    expect(num('')).toBeNull()
    expect(num(null)).toBeNull()
    expect(num(undefined)).toBeNull()
    expect(num('not a number')).toBeNull()
    expect(num(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('createPlayer', () => {
  it('falls back to the full name when there is no short name', () => {
    expect(createPlayer({ name: 'Thomas Ramos' }).shortName).toBe('Thomas Ramos')
  })

  it('defaults every flag to false and stats to an object', () => {
    const player = createPlayer({})
    expect(player).toMatchObject({ isStarter: false, isCaptain: false, subbedIn: false, subbedOut: false })
    expect(player.stats).toEqual({})
    expect(player.jersey).toBeNull()
  })

  it('freezes the result so a renderer cannot mutate shared data', () => {
    const player = createPlayer({ name: 'Test' })
    expect(Object.isFrozen(player)).toBe(true)
    expect(Object.isFrozen(player.stats)).toBe(true)
  })

  it('accepts no argument at all', () => {
    expect(() => createPlayer()).not.toThrow()
  })
})

describe('createTeam', () => {
  it('falls back through name fields', () => {
    expect(createTeam({ name: 'Leinster' }).shortName).toBe('Leinster')
  })

  it('normalises the squad through createPlayer', () => {
    const team = createTeam({ name: 'X', squad: [{ name: 'A' }, { name: 'B' }] })
    expect(team.squad).toHaveLength(2)
    expect(Object.isFrozen(team.squad)).toBe(true)
  })

  it('defaults an absent score to null, not zero', () => {
    expect(createTeam({ name: 'X' }).score).toBeNull()
  })
})

describe('createScoreEvent', () => {
  it('keeps only valid sides', () => {
    expect(createScoreEvent({ side: 'home' }).side).toBe('home')
    expect(createScoreEvent({ side: 'away' }).side).toBe('away')
    expect(createScoreEvent({ side: 'sideline' }).side).toBe('')
    expect(createScoreEvent({}).side).toBe('')
  })

  it('tolerates a missing player', () => {
    expect(createScoreEvent({ type: 'try' }).player.name).toBe('')
  })
})

describe('createMatch', () => {
  it('defaults to a scheduled match with empty teams', () => {
    const match = createMatch({})
    expect(match.status).toBe(MATCH_STATUS.SCHEDULED)
    expect(match.source).toBe('manual')
    expect(match.timeline).toEqual([])
  })

  it('accepts no argument at all', () => {
    expect(() => createMatch()).not.toThrow()
  })
})

describe('createTable', () => {
  it('normalises rows and tolerates an empty payload', () => {
    expect(createTable({}).rows).toEqual([])
    expect(createTable({ rows: [{ team: { name: 'X' } }] }).rows[0].team.name).toBe('X')
  })

  it('falls back to the full name for a row short name', () => {
    expect(createTableRow({ team: { name: 'Glasgow Warriors' } }).team.shortName).toBe('Glasgow Warriors')
  })
})

describe('validateMatch', () => {
  it('accepts a complete match', () => {
    const match = createMatch({
      status: MATCH_STATUS.FINAL,
      home: { name: 'A', score: 20 },
      away: { name: 'B', score: 15 },
    })
    expect(validateMatch(match)).toEqual([])
  })

  it('reports missing team names', () => {
    expect(validateMatch(createMatch({}))).toEqual([
      'Home team has no name.',
      'Away team has no name.',
    ])
  })

  it('reports a finished match with no scores', () => {
    const problems = validateMatch(createMatch({
      status: MATCH_STATUS.FINAL,
      home: { name: 'A' },
      away: { name: 'B' },
    }))
    expect(problems).toContain('Final match has no home score.')
    expect(problems).toContain('Final match has no away score.')
  })

  it('reports an oversized squad', () => {
    const squad = Array.from({ length: MATCHDAY_SQUAD + 1 }, (_, i) => ({ name: `P${i}` }))
    const problems = validateMatch(createMatch({
      home: { name: 'A', squad }, away: { name: 'B' },
    }))
    expect(problems.some((p) => p.includes('matchday squad is 23'))).toBe(true)
  })

  it('rejects a missing match outright', () => {
    expect(validateMatch(null)).toEqual(['Match is missing.'])
    expect(validateMatch('not a match')).toEqual(['Match is missing.'])
  })
})

describe('rugby constants', () => {
  it('scores events the way the laws do', () => {
    expect(EVENT_POINTS[SCORE_EVENTS.TRY]).toBe(5)
    expect(EVENT_POINTS[SCORE_EVENTS.CONVERSION]).toBe(2)
    expect(EVENT_POINTS[SCORE_EVENTS.PENALTY]).toBe(3)
    expect(EVENT_POINTS[SCORE_EVENTS.DROP_GOAL]).toBe(3)
    expect(EVENT_POINTS[SCORE_EVENTS.PENALTY_TRY]).toBe(7)
    expect(EVENT_POINTS[SCORE_EVENTS.YELLOW_CARD]).toBe(0)
  })

  it('names all fifteen starting positions', () => {
    expect(POSITION_NAMES).toHaveLength(15)
    expect(POSITION_NAMES[0]).toBe('Loosehead Prop')
    expect(POSITION_NAMES[14]).toBe('Fullback')
  })
})

describe('adapter fallbacks', () => {
  it('builds a crest url from the team id when no logo is supplied', () => {
    const match = adaptEvent({
      id: '1',
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { id: '9', displayName: 'France' } },
          { homeAway: 'away', team: { id: '20', displayName: 'Ireland' } },
        ],
      }],
    })
    expect(match.home.logo).toBe('https://a.espncdn.com/i/teamlogos/rugby/teams/500/9.png')
  })

  it('derives the minute from a seconds clock when there is no display value', () => {
    const match = adaptEvent({
      id: '1',
      competitions: [{
        competitors: [{ homeAway: 'home', team: { id: '9' } }, { homeAway: 'away', team: { id: '20' } }],
        details: [{ type: { id: 1 }, clock: { value: 752 }, team: { id: '9' }, participants: [] }],
      }],
    })
    expect(match.timeline[0].minute).toBe(12)
  })

  it('falls back to positional competitors when homeAway is missing', () => {
    const match = adaptEvent({
      id: '1',
      competitions: [{ competitors: [{ team: { displayName: 'First' } }, { team: { displayName: 'Second' } }] }],
    })
    expect(match.home.name).toBe('First')
    expect(match.away.name).toBe('Second')
  })

  it('reads a stat that only has a display value', () => {
    const summary = {
      header: { competitions: [{ competitors: [] }] },
      rosters: [{
        homeAway: 'home',
        team: { id: '9', displayName: 'France' },
        roster: [{ jersey: '10', athlete: { displayName: 'A Player' }, stats: [{ name: 'tries', displayValue: '2' }] }],
      }],
    }
    expect(adaptSummary(summary).home.squad[0].stats.tries).toBe(2)
  })

  it('ignores an unknown event type rather than rendering a blank line', () => {
    const match = adaptEvent({
      id: '1',
      competitions: [{
        competitors: [{ homeAway: 'home', team: { id: '9' } }],
        details: [
          { type: { id: 99, text: 'water break' }, team: { id: '9' } },
          { type: { id: 1 }, clock: { displayValue: "5'" }, team: { id: '9' } },
        ],
      }],
    })
    expect(match.timeline).toHaveLength(1)
  })
})

describe('createSeason', () => {
  const raw = {
    competition: { id: '1', name: 'Test', abbreviation: 'TST' },
    season: { year: 2026, display: '2026' },
    matches: 91,
    leagueHomeWinRate: 0.66,
    teams: [{
      team: { name: 'Alpha', abbreviation: 'ALP', logo: 'assets/crests/1' },
      home: { played: 9, won: 7, drawn: 0, lost: 2 },
      away: { played: 9, won: 3, drawn: 1, lost: 5 },
      homeWinRate: 0.777, awayWinRate: 0.388,
      matches: [
        { date: '2025-09-06T14:00Z', opponent: { name: 'Bravo', abbreviation: 'BRA' }, venue: 'home', for: 30, against: 10 },
        { date: '2025-09-13T14:00Z', opponent: { name: 'Charlie', abbreviation: 'CHA' }, venue: 'away', for: 12, against: 24 },
      ],
    }],
  }

  it('carries the per-team match list through', () => {
    // It did not, and the season chart reported "0 matches recorded" for teams
    // whose files held a full set.
    const season = createSeason(raw)
    expect(season.teams[0].matches).toHaveLength(2)
    expect(season.teams[0].matches[0]).toMatchObject({
      venue: 'home', for: 30, against: 10,
    })
    expect(season.teams[0].matches[0].opponent.name).toBe('Bravo')
  })

  it('normalises an unknown venue to home rather than passing it through', () => {
    const season = createSeason({ ...raw, teams: [{ ...raw.teams[0], matches: [{ venue: 'neutral', for: 1, against: 2 }] }] })
    expect(season.teams[0].matches[0].venue).toBe('home')
  })

  it('survives a season with no match lists at all', () => {
    const season = createSeason({ ...raw, teams: [{ team: { name: 'Alpha' } }] })
    expect(season.teams[0].matches).toEqual([])
  })

  it('keeps the competition and league rate', () => {
    const season = createSeason(raw)
    expect(season.competition.name).toBe('Test')
    expect(season.leagueHomeWinRate).toBeCloseTo(0.66, 3)
    expect(season.matches).toBe(91)
  })

  it('is frozen all the way down', () => {
    const season = createSeason(raw)
    expect(Object.isFrozen(season)).toBe(true)
    expect(Object.isFrozen(season.teams)).toBe(true)
    expect(Object.isFrozen(season.teams[0].matches)).toBe(true)
  })
})
