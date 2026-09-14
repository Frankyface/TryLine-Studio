import { describe, it, expect } from 'vitest'
import { createMatch } from '../src/data/schema.js'
import { retainMatchDetail, assertCompleteScoreboard } from '../src/data/refresh-policy.js'

const current = createMatch({ id: '1', competition: { id: '2' }, status: 'final',
  home: { id: 'h', name: 'Home', score: 24 }, away: { id: 'a', name: 'Away', score: 21 } })
const previous = createMatch({ ...current, home: { ...current.home, squad: [{ name: 'Alex', stats: { tackles: 12 } }] } })

describe('refresh integrity', () => {
  it('keeps cached squads when a final score is unchanged without mutating either input', () => {
    expect(retainMatchDetail(current, previous).home.squad[0].name).toBe('Alex')
    expect(current.home.squad).toHaveLength(0)
    expect(retainMatchDetail(previous, current).home.squad[0].name).toBe('Alex')
  })
  it.each([null, { ...previous, status: 'live' }, { ...previous, id: 'other' },
    { ...previous, competition: { id: 'other' } }, { ...previous, home: { ...previous.home, score: 17 } },
    { ...previous, home: { ...previous.home, id: 'other' } }, { ...previous, away: { ...previous.away, id: 'other' } },
    { ...previous, away: { ...previous.away, score: 18 } }])('does not merge incompatible snapshots', (cached) => {
    expect(retainMatchDetail(current, cached)).toBe(current)
  })
  it('does not transfer final squads to scheduled fixtures', () => {
    const scheduled = { ...current, status: 'scheduled' }
    expect(retainMatchDetail(scheduled, previous)).toBe(scheduled)
  })
  it('refuses partial, capped or unexpectedly empty downloads before replacing the index', () => {
    const complete = { failedMonths: [], cappedMonths: [], matchCount: 2, previousCount: 3 }
    expect(() => assertCompleteScoreboard(complete)).not.toThrow()
    expect(() => assertCompleteScoreboard({ ...complete, failedMonths: ['20260901'] })).toThrow(/failed months/)
    expect(() => assertCompleteScoreboard({ ...complete, cappedMonths: ['20260901'] })).toThrow(/event cap/)
    expect(() => assertCompleteScoreboard({ ...complete, matchCount: 0 })).toThrow(/no matches/)
    expect(() => assertCompleteScoreboard({ ...complete, matchCount: 0, previousCount: 0 })).not.toThrow()
  })
})
