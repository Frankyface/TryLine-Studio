/**
 * Availability is what stands between a club and a finished-looking empty PNG.
 *
 * These walk every real graphic against degenerate data rather than testing a
 * handful by hand: the two faults that shipped were both a `meta` flag that
 * did not match what `draw` actually dereferences, and only a sweep catches
 * that class.
 */
import { describe, it, expect } from 'vitest'
import { blockingReason, squadHasStats, usesSide } from '../src/render/availability.js'
import { GRAPHICS, GRAPHIC_BY_ID } from '../src/render/index.js'

const player = (stats = {}) => ({ name: 'A Player', jersey: 1, stats })
const squad = (stats) => Array.from({ length: 23 }, () => player(stats))

const matchWith = (overrides = {}) => ({
  home: { name: 'Home', shortName: 'Home', score: 20, squad: [], ...overrides.home },
  away: { name: 'Away', shortName: 'Away', score: 10, squad: [], ...overrides.away },
  timeline: overrides.timeline ?? [],
  competition: { name: 'Test' },
  season: { display: '2026' },
})

const full = matchWith({
  home: { squad: squad({ metres: 40 }) },
  away: { squad: squad({ metres: 30 }) },
  timeline: [{ minute: 10, side: 'home', points: 5 }],
})

describe('every graphic declares what it actually needs', () => {
  it.each(GRAPHICS.map((g) => [g.meta.id, g]))('%s blocks on no data at all', (_id, graphic) => {
    expect(blockingReason(graphic, {})).not.toBe('')
  })

  it.each(GRAPHICS.filter((g) => g.meta.needs === 'match').map((g) => [g.meta.id, g]))(
    '%s draws from a complete match', (_id, graphic) => {
      const options = { side: 'home', mode: 'players' }
      expect(blockingReason(graphic, { match: full }, options)).toBe('')
    },
  )

  it.each(GRAPHICS.filter((g) => g.meta.requiresSquad).map((g) => [g.meta.id, g]))(
    '%s blocks when the squad is empty', (_id, graphic) => {
      expect(blockingReason(graphic, { match: matchWith() }, { side: 'home' }))
        .toMatch(/squad|team sheet/i)
    },
  )

  it.each(GRAPHICS.filter((g) => g.meta.requiresStats).map((g) => [g.meta.id, g]))(
    '%s blocks on team sheets with no stats', (_id, graphic) => {
      const noStats = matchWith({ home: { squad: squad({}) }, away: { squad: squad({}) } })
      expect(blockingReason(graphic, { match: noStats }, { side: 'home', mode: 'players' }))
        .toMatch(/stats/i)
    },
  )

  it.each(GRAPHICS.filter((g) => g.meta.requiresTimeline).map((g) => [g.meta.id, g]))(
    '%s blocks without a scoring timeline', (_id, graphic) => {
      expect(blockingReason(graphic, { match: matchWith({ timeline: [] }) }))
        .toMatch(/timeline/i)
    },
  )
})

describe('the side only gates what the side changes', () => {
  it('checks one side for a graphic that draws one side', () => {
    const homeOnly = matchWith({ home: { squad: squad({ metres: 1 }) }, away: { squad: [] } })
    const teamsheet = GRAPHIC_BY_ID.teamsheet
    expect(usesSide(teamsheet, {})).toBe(true)
    expect(blockingReason(teamsheet, { match: homeOnly }, { side: 'home' })).toBe('')
    expect(blockingReason(teamsheet, { match: homeOnly }, { side: 'away' })).not.toBe('')
  })

  it('checks both sides for a comparison that aggregates both', () => {
    const homeOnly = matchWith({
      home: { squad: squad({ metres: 1 }) },
      away: { squad: [] },
    })
    const comparison = GRAPHIC_BY_ID.comparison
    expect(usesSide(comparison, { mode: 'teams' })).toBe(false)
    // Team mode reads both squads, so one side alone must not report ok.
    expect(blockingReason(comparison, { match: homeOnly }, { mode: 'teams', side: 'home' }))
      .not.toBe('')
  })

  it('does not let the side flip a graphic that ignores it', () => {
    const options = (side) => ({ mode: 'teams', side })
    const comparison = GRAPHIC_BY_ID.comparison
    expect(blockingReason(comparison, { match: full }, options('home')))
      .toBe(blockingReason(comparison, { match: full }, options('away')))
  })

  it('lets the side matter again in player mode', () => {
    const homeOnly = matchWith({ home: { squad: squad({ metres: 1 }) }, away: { squad: [] } })
    const comparison = GRAPHIC_BY_ID.comparison
    expect(usesSide(comparison, { mode: 'players' })).toBe(true)
    expect(blockingReason(comparison, { match: homeOnly }, { mode: 'players', side: 'home' }))
      .toBe('')
  })
})

describe('table and season graphics', () => {
  const table = { rows: [{ team: { name: 'A' } }], competition: {}, season: {} }
  const season = { teams: [], competition: {}, season: {} }

  it('blocks a table graphic with no table, and names manual mode differently', () => {
    const graphic = GRAPHIC_BY_ID.table
    expect(blockingReason(graphic, { source: 'live' })).toMatch(/no league table/i)
    expect(blockingReason(graphic, { source: 'manual' })).toMatch(/paste/i)
    expect(blockingReason(graphic, { table })).toBe('')
  })

  it('never offers season records from manual entry', () => {
    const graphic = GRAPHIC_BY_ID.fortress
    expect(blockingReason(graphic, { source: 'manual', season })).toMatch(/manual entry/i)
    expect(blockingReason(graphic, { season })).toBe('')
  })
})

describe('squadHasStats', () => {
  it('is false for a team sheet of names', () => {
    expect(squadHasStats(squad({}))).toBe(false)
    expect(squadHasStats([])).toBe(false)
  })

  it('is true when any player carries a number', () => {
    expect(squadHasStats([player({}), player({ tries: 1 })])).toBe(true)
  })
})
