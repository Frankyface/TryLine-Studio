import { describe, it, expect } from 'vitest'
import { selectMatches, freshnessReason } from '../src/publish/queue.js'

const now = '2026-09-14T12:00:00Z'
const match = (id, kickoff, status = 'final') => ({ id, kickoff, status, competition: { id: '1' },
  home: { name: 'Home', score: 24 }, away: { name: 'Away', score: 21 } })

describe('batch selection', () => {
  it('selects only recent finals, newest first, within the limit; never live or future results', () => {
    const matches = [match('old', '2026-09-12T12:00Z'), match('b', '2026-09-14T10:00Z'),
      match('live', '2026-09-14T11:00Z', 'live'), match('a', '2026-09-14T11:00Z'),
      match('future', '2026-09-14T13:00Z'), match('bad', 'nonsense')]
    expect(selectMatches(matches, { now, limit: 1 }).map((m) => m.id)).toEqual(['a'])
    expect(selectMatches(matches, { now }).map((m) => m.id)).toEqual(['a', 'b'])
    expect(matches[0].id).toBe('old')
  })
  it('selects upcoming fixtures closest first and excludes stale scheduled fixtures', () => {
    const matches = [match('later', '2026-09-15T10:00Z', 'scheduled'),
      match('old', '2026-09-14T11:00Z', 'scheduled'), match('soon', '2026-09-14T13:00Z', 'scheduled'),
      match('far', '2026-09-16T13:00Z', 'scheduled')]
    expect(selectMatches(matches, { now, phase: 'scheduled' }).map((m) => m.id)).toEqual(['soon', 'later'])
  })
  it('deduplicates by competition and ID and breaks kickoff ties deterministically', () => {
    const a = match('a', '2026-09-14T11:00Z'), b = match('b', a.kickoff)
    expect(selectMatches([b, a, a], { now }).map((m) => m.id)).toEqual(['a', 'b'])
  })
  it.each([{ now: 'bad' }, { phase: 'live' }, { limit: 0 }, { limit: 1.2 }, { limit: 101 },
    { lookbackHours: NaN }, { lookaheadHours: -1 }])('rejects invalid selection options %o', (options) => {
    expect(() => selectMatches([], { now, ...options })).toThrow()
  })
})

describe('competition freshness', () => {
  it('accepts fresh data including the boundary, rejects old, missing and future timestamps', () => {
    expect(freshnessReason('2026-09-12T12:00Z', now)).toBe('')
    expect(freshnessReason('2026-09-12T11:59Z', now)).toMatch(/old/)
    expect(freshnessReason(null, now)).toMatch(/timestamp/)
    expect(freshnessReason('2026-09-15T12:00Z', now)).toMatch(/future/)
    expect(() => freshnessReason(now, now, 0)).toThrow()
  })
})
