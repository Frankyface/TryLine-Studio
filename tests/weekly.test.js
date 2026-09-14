import { describe, it, expect } from 'vitest'
import { createMatch, createTable } from '../src/data/schema.js'
import { matchFlow, eventCounts, scoringSpotlights } from '../src/analysis/match-flow.js'
import { DOMESTIC_LEAGUES, buildWeek, weeklyCards, scheduleFor, weeklyStats, slotInstant, mondayOf, dateInZone } from '../src/publish/weekly.js'
import { GRAPHIC_BY_ID } from '../src/render/index.js'
import { blockingReason } from '../src/render/availability.js'
import { captionFor, planFor } from '../src/publish/plan.js'

const league = DOMESTIC_LEAGUES[2]
const event = (minute, type, side = 'home', name = 'Ada Try') => ({ minute, type, side, player: { id: name, name } })
const match = (overrides = {}) => createMatch({ id: '101', competition: league, season: { year: 2026 }, status: 'final',
  kickoff: '2026-04-25T14:00:00Z', home: { id: 'h', name: 'Home Club', score: 10 }, away: { id: 'a', name: 'Away Club', score: 5 },
  timeline: [event(20, 'try'), event(40, 'try', 'away', 'Ben Try'), event(81, 'try')], ...overrides })
const table = () => createTable({ competition: league, season: { year: 2026 }, rows: [{ rank: 1, team: { name: 'Home Club' }, points: 5 }] })
const make = (overrides = {}) => buildWeek({ league, matches: [match()], week: '2026-04-20', updated: '2026-04-27T08:00:00Z', now: '2026-04-27T12:00:00Z', table: table(), ...overrides })

describe('honest event timelines', () => {
  it('preserves added time and puts boundary events in one period only', () => {
    const result = matchFlow(match())
    expect(result.reason).toBe('')
    expect(result.end).toBe(81)
    expect(result.periods.map((p) => [p.home, p.away])).toEqual([[5, 0], [5, 5], [5, 5], [10, 5]])
    expect(result.periods.flatMap((p) => p.events)).toHaveLength(3)
    expect(eventCounts(result.steps, 'home').try).toBe(2)
  })
  it('refuses a cumulative-score jump even when the last supplied score matches', () => {
    const m = match({ timeline: [{ ...event(80, 'try'), homeScore: 10, awayScore: 5 }] })
    expect(matchFlow(m).reason).toMatch(/5-0/)
    expect(blockingReason(GRAPHIC_BY_ID.matchflow, { match: m })).toMatch(/5-0/)
    expect(planFor({ match: m }).some((c) => c.graphicId === 'matchflow')).toBe(false)
  })
  it.each([event(null, 'try'), event(-1, 'try'), event(121, 'try'), event(2, 'unknown'), event(2, 'try', '')])('refuses malformed events: %j', (bad) => {
    expect(matchFlow(match({ timeline: [bad] })).reason).toMatch(/unknown/)
  })
  it('requires final scores and an event feed even for 0–0', () => {
    expect(matchFlow(null).reason).toBeTruthy()
    expect(matchFlow(match({ status: 'live' })).reason).toMatch(/final/)
    expect(matchFlow(match({ timeline: [] })).reason).toMatch(/No event/)
  })
  it('keeps cards separate from points, including penalty tries and drop goals', () => {
    const m = match({ home: { name: 'Home', score: 17 }, away: { name: 'Away', score: 0 },
      timeline: [event(0, 'penaltyTry'), event(3, 'try'), event(4, 'conversion'), event(8, 'dropGoal'), event(20, 'yellowCard'), event(40, 'redCard')] })
    expect(matchFlow(m).reason).toBe('')
    expect(eventCounts(matchFlow(m).steps, 'home')).toMatchObject({ yellowCard: 1, redCard: 1, penaltyTry: 1 })
    expect(scoringSpotlights([m])[0]).toMatchObject({ points: 10, tries: 1, conversions: 1, dropGoals: 1 })
  })
  it('selects a try scorer and a different scoring contributor without implying an award', () => {
    const m = match({ home: { id: 'h', name: 'Home', score: 15 }, away: { name: 'Away', score: 0 },
      timeline: [event(1, 'try'), event(2, 'conversion', 'home', 'Kit Kick'), event(12, 'penalty', 'home', 'Kit Kick'), event(22, 'try')] })
    const picks = scoringSpotlights([m, { ...m, id: '102' }])
    expect(picks.map((p) => p.player.name)).toEqual(['Ada Try', 'Kit Kick'])
    expect(picks.map((p) => p.points)).toEqual([10, 5])
    expect(scoringSpotlights([match({ timeline: [] })])).toEqual([])
    const unnamed = match({ timeline: [event(1, 'try', 'home', ''), event(2, 'try', 'home', ''), event(3, 'try', 'away', '')] })
    expect(scoringSpotlights([unnamed])).toEqual([])
  })
  it('includes a verified timeline in the existing match bundle', () => {
    expect(planFor({ match: match() }).some((c) => c.graphicId === 'matchflow')).toBe(true)
    expect(captionFor('matchflow', match())).toMatch(/20-minute/)
  })
})

describe('weekly coverage and schedule', () => {
  it('uses Monday weeks and timezone boundaries, including DST', () => {
    expect(mondayOf('2026-04-26')).toBe('2026-04-20')
    expect(mondayOf('2027-01-01')).toBe('2026-12-28')
    expect(dateInZone('2026-04-27T02:00Z')).toBe('2026-04-26')
    expect(slotInstant('2026-01-07', 11)).toBe('2026-01-07T16:00:00.000Z')
    expect(slotInstant('2026-04-22', 11)).toBe('2026-04-22T15:00:00.000Z')
    expect(slotInstant('2026-03-08', 11)).toBe('2026-03-08T15:00:00.000Z')
    expect(slotInstant('2026-11-01', 11)).toBe('2026-11-01T16:00:00.000Z')
    expect(() => mondayOf('2026-02-30')).toThrow(/valid date/)
    expect(() => slotInstant('bad', 11)).toThrow(/Invalid/)
    expect(() => slotInstant('2026-01-01', 24)).toThrow(/Invalid/)
    expect(() => dateInZone('2026-01-01', 'bad')).toThrow()
  })
  it('keeps TBC midnight markers on their supplied date and out of the previous week', () => {
    const upcoming = match({ status: 'scheduled', kickoff: '2026-04-20T00:00Z' })
    const w = make({ matches: [upcoming], now: '2026-04-20T12:00:00Z', updated: '2026-04-20T10:00Z' })
    expect(w.upcoming).toHaveLength(1)
    expect(weeklyCards(w, 'preview')[0].caption).toContain('2026-04-20 · Time TBC')
    expect(scheduleFor(w)[0].publishAt).toBe('2026-04-19T04:00:00.000Z')
    expect(make({ matches: [upcoming], week: '2026-04-13' }).fixtures).toHaveLength(0)
  })
  it('deduplicates, keeps late Sunday games, and rejects other leagues and invalid dates', () => {
    const late = match({ id: '102', kickoff: '2026-04-27T02:00Z' })
    const excluded = [match({ id: '103', kickoff: '2026-04-27T14:00Z' }), match({ id: '104', kickoff: '' }), match({ id: '105', competition: { id: '1' } })]
    const w = make({ matches: [match(), match(), late, ...excluded] })
    expect(w.finals.map((m) => m.id)).toEqual(['101', '102'])
    expect(() => make({ league: { id: '1' } })).toThrow(/five/)
  })
  it('never treats cancelled, live, malformed or future final scores as completed', () => {
    const fixtures = [match(), match({ id: '102', statusDetail: 'Cancelled' }), match({ id: '103', status: 'live' }),
      match({ id: '104', home: { name: 'Home', score: null } }), match({ id: '105', kickoff: '2026-04-26T18:00Z' })]
    const w = make({ matches: fixtures, now: '2026-04-26T12:00:00Z', updated: '2026-04-26T10:00Z' })
    expect(w.finals).toHaveLength(1)
    expect(w.unresolved).toHaveLength(3)
    expect(scheduleFor(w).find((s) => s.kind === 'review').state).toBe('waiting-for-results')
  })
  it('lists all fixtures across pages and ten-slide carousel boundaries', () => {
    const matches = Array.from({ length: 23 }, (_, i) => match({ id: String(100 + i) }))
    const w = make({ matches })
    const cards = weeklyCards(w, 'review')
    expect(cards.filter((c) => c.graphicId === 'weeklyresults').map((c) => c.options.offset)).toEqual([0, 6, 12, 18])
    expect(cards.map((c) => c.graphicId).slice(4, 6)).toEqual(['table', 'weeklyanalysis'])
    const stories = weeklyCards(w, 'stories')
    expect(stories).toHaveLength(23)
    expect(stories.at(-1)).toMatchObject({ carousel: 3, slide: 3 })
    expect(new Set(stories.map((c) => c.id)).size).toBe(23)
    expect(weeklyCards(w, 'stories')).toEqual(stories)
    expect(() => weeklyCards(w, 'bogus')).toThrow(/Pack/)
  })
  it('advances the preview before an early fixture, with five distinct posting slots', () => {
    const w = make({ matches: [match({ status: 'scheduled', kickoff: '2026-04-21T15:00Z' })], now: '2026-04-20T10:00Z', updated: '2026-04-20T09:00Z' })
    expect(scheduleFor(w)[0]).toMatchObject({ publishAt: '2026-04-20T15:00:00.000Z', state: 'ready' })
    expect(scheduleFor(w)[1].publishAt).toBe('2026-04-27T15:00:00.000Z')
    expect(scheduleFor(w)[2].publishAt).toBe('2026-04-28T15:00:00.000Z')
    expect(new Set(DOMESTIC_LEAGUES.map((l) => scheduleFor({ ...w, league: l })[1].publishAt)).size).toBe(5)
    expect(weeklyCards(w, 'preview')[0].caption).toContain('Home Club v Away Club')
  })
  it('does not mislabel a current table as historical round standings', () => {
    expect(make().standings).toBeTruthy()
    expect(make({ updated: '2026-08-21T10:00Z' }).standings).toBeNull()
    expect(make({ table: createTable({ ...table(), season: { year: 2025 } }) }).standings).toBeNull()
    expect(make({ table: createTable({ ...table(), partial: true }) }).standings).toBeNull()
    expect(make({ table: createTable({ ...table(), competition: { id: 'wrong' } }) }).standings).toBeNull()
  })
  it('holds stale or missing data, including an invalid future timestamp', () => {
    for (const updated of ['2026-04-01T00:00Z', 'bad', null, '2027-01-01T00:00Z']) {
      const w = make({ updated })
      expect(w.stale).toBe(true)
      expect(scheduleFor(w).every((s) => s.state === 'needs-refresh')).toBe(true)
    }
    const empty = make({ matches: [] })
    expect(empty.warnings.join(' ')).toMatch(/Check the source calendar/)
    expect(scheduleFor(empty).every((s) => s.state === 'no-fixtures')).toBe(true)
    expect(weeklyCards(empty, 'review')).toEqual([])
    expect(scheduleFor(make())[0].state).toBe('no-upcoming-fixtures')
  })
  it('falls back to a result for missing events without losing the match', () => {
    const w = make({ matches: [match({ timeline: [] })], table: null })
    expect(weeklyCards(w, 'stories')[0].graphicId).toBe('result')
    expect(w.warnings.join(' ')).toMatch(/No verified named scoring/)
    expect(weeklyCards(w, 'review').map((c) => c.graphicId)).toEqual(['weeklyresults', 'weeklyanalysis'])
  })
  it('computes the whole week from final scores, with ties and 0–0 represented', () => {
    const games = [match(), match({ id: '102', home: { name: 'Home', score: 0 }, away: { name: 'Away', score: 0 } }),
      match({ id: '103', home: { name: 'Home', score: 1 }, away: { name: 'Away', score: 4 } })]
    expect(weeklyStats(games)).toMatchObject({ played: 3, totalPoints: 20, averagePoints: '6.7', homeWins: 1, awayWins: 1, draws: 1 })
    expect(weeklyStats([])).toMatchObject({ played: 0, biggestWin: null, closest: null })
    expect(weeklyStats([games[1]]).biggestWin).toBeNull()
  })
  it('shares availability gates between weekly rendering and planning', () => {
    const w = make()
    for (const card of weeklyCards(w, 'review')) expect(blockingReason(GRAPHIC_BY_ID[card.graphicId], { week: w, table: w.standings }, card.options)).toBe('')
    expect(blockingReason(GRAPHIC_BY_ID.weeklyfixtures, { week: w })).toMatch(/No upcoming/)
    expect(blockingReason(GRAPHIC_BY_ID.weeklyfixtures, { week: { upcoming: [match()] } })).toBe('')
    expect(blockingReason(GRAPHIC_BY_ID.weeklyanalysis, { week: {} })).toMatch(/No completed/)
    expect(blockingReason(GRAPHIC_BY_ID.scoringspotlight, { week: w }, { spotlightIndex: 30 })).toMatch(/No verified/)
  })
})
