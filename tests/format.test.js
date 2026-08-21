import { describe, it, expect } from 'vitest'
import {
  formatMatchDate, formatKickoffTime, formatAttendance, formatStatValue,
  pickPlayerStats, summariseScorers, timelineMark, isScoringEvent, cardEvents, formLetters,
} from '../src/render/format.js'
import { SCORE_EVENTS } from '../src/data/schema.js'
import {
  TIME_ZONES, LOCAL_ZONE, COMPETITION_ZONES, zoneForCompetition, resolveZone,
} from '../src/data/timezones.js'

describe('date and number formatting', () => {
  it('formats a match date the way a poster reads', () => {
    expect(formatMatchDate('2026-02-07T14:10Z')).toBe('Saturday 7 Feb')
    expect(formatMatchDate('2026-02-07T14:10Z', { withYear: true })).toBe('Saturday 7 Feb 2026')
  })

  it('returns empty rather than "Invalid Date" for bad input', () => {
    expect(formatMatchDate('')).toBe('')
    expect(formatMatchDate('not a date')).toBe('')
    expect(formatKickoffTime('nonsense')).toBe('')
  })

  it('formats kick-off as zero-padded 24 hour', () => {
    expect(formatKickoffTime('2026-02-07T14:05Z')).toMatch(/^\d{2}:\d{2}$/)
  })

  it('formats attendance with separators and keeps null empty', () => {
    expect(formatAttendance(67519)).toBe('67,519')
    expect(formatAttendance(null)).toBe('')
  })
})

describe('timezones', () => {
  it('renders a kick-off in the competition zone rather than the viewer zone', () => {
    // 20:10 UTC is 21:10 in Paris - the Top 14 case that made this necessary.
    const iso = '2026-02-05T20:10Z'
    expect(formatKickoffTime(iso, { timeZone: 'Europe/Paris' })).toBe('21:10')
    expect(formatKickoffTime(iso, { timeZone: 'UTC' })).toBe('20:10')
  })

  it('rolls the date over when the zone pushes past midnight', () => {
    const iso = '2026-02-05T20:10Z'
    expect(formatKickoffTime(iso, { timeZone: 'Pacific/Auckland' })).toBe('09:10')
    expect(formatMatchDate(iso, { timeZone: 'Pacific/Auckland' })).toBe('Friday 6 Feb')
    expect(formatMatchDate(iso, { timeZone: 'UTC' })).toBe('Thursday 5 Feb')
  })

  it('falls back to local time rather than throwing on a bad zone', () => {
    expect(() => formatKickoffTime('2026-02-05T20:10Z', { timeZone: 'Not/AZone' })).not.toThrow()
    expect(formatKickoffTime('2026-02-05T20:10Z', { timeZone: 'Not/AZone' })).toMatch(/^\d{2}:\d{2}$/)
  })

  it('maps competitions to a sensible default zone', () => {
    expect(zoneForCompetition('270559')).toBe('Europe/Paris')
    expect(zoneForCompetition('242041')).toBe('Pacific/Auckland')
    expect(zoneForCompetition('unknown-id')).toBe(LOCAL_ZONE)
  })

  it('leaves roaming competitions on the viewer clock', () => {
    // Lions tours and world cups move hemisphere; no fixed default is honest.
    expect(zoneForCompetition('268565')).toBe(LOCAL_ZONE)
    expect(zoneForCompetition('164205')).toBe(LOCAL_ZONE)
  })

  it('resolves only usable zone names', () => {
    expect(resolveZone('Europe/London')).toBe('Europe/London')
    expect(resolveZone(LOCAL_ZONE)).toBeUndefined()
    expect(resolveZone('')).toBeUndefined()
    expect(resolveZone('Not/AZone')).toBeUndefined()
  })

  it('offers every mapped zone in the picker', () => {
    const offered = new Set(TIME_ZONES.map((zone) => zone.id))
    for (const zone of Object.values(COMPETITION_ZONES)) {
      expect(offered.has(zone)).toBe(true)
    }
  })
})

describe('stat values', () => {
  it('renders kick success as a percentage, not a fraction', () => {
    expect(formatStatValue('kickPercentSuccess', 0.83)).toBe('83%')
  })

  it('rounds metres to whole numbers', () => {
    expect(formatStatValue('metres', 95.4)).toBe('95')
  })

  it('shows a dash for a missing value', () => {
    expect(formatStatValue('tries', null)).toBe('-')
  })

  it('prefers stats that actually happened over zeroes', () => {
    const player = { stats: { points: 0, tries: 0, metres: 95, runs: 13, tackles: 7 } }
    const picked = pickPlayerStats(player, 3)
    expect(picked.map((s) => s.key)).toEqual(['metres', 'runs', 'tackles'])
  })

  it('never pads a sparse card with zeroes', () => {
    // This previously returned three tiles, two of them "0". 18% of the 2,438
    // players with stats have fewer than four real numbers, so the padded card
    // was the normal case for anyone off the bench.
    const player = { stats: { points: 0, tries: 0, metres: 4 } }
    expect(pickPlayerStats(player, 3)).toEqual([
      { key: 'metres', label: 'Metres made', value: '4' },
    ])
  })

  it('honours the limit rather than a fixed tile count', () => {
    const player = { stats: { points: 5, tries: 1, metres: 40, runs: 8, tackles: 3 } }
    expect(pickPlayerStats(player, 2)).toHaveLength(2)
    expect(pickPlayerStats(player, 4)).toHaveLength(4)
  })

  it('returns nothing for a player with no stats', () => {
    expect(pickPlayerStats({ stats: {} }, 6)).toEqual([])
    expect(pickPlayerStats(null, 6)).toEqual([])
  })
})

describe('scorer summaries', () => {
  const timeline = [
    { side: 'home', type: SCORE_EVENTS.TRY, minute: 13, player: { shortName: 'L. Bielle-Biarrey' } },
    { side: 'home', type: SCORE_EVENTS.CONVERSION, minute: 14, player: { shortName: 'T. Ramos' } },
    { side: 'home', type: SCORE_EVENTS.TRY, minute: 47, player: { shortName: 'L. Bielle-Biarrey' } },
    { side: 'away', type: SCORE_EVENTS.PENALTY, minute: 22, player: { shortName: 'S. Prendergast' } },
    { side: 'home', type: SCORE_EVENTS.YELLOW_CARD, minute: 42, player: { shortName: 'E. Genge' } },
  ]

  it('groups repeat scorers onto one line', () => {
    const home = summariseScorers(timeline, 'home')
    expect(home).toHaveLength(1)
    expect(home[0].name).toBe('L. Bielle-Biarrey')
    expect(home[0].minutes).toEqual([13, 47])
  })

  it('excludes conversions and cards from the scorer list', () => {
    const names = summariseScorers(timeline, 'home').map((r) => r.name)
    expect(names).not.toContain('T. Ramos')
    expect(names).not.toContain('E. Genge')
  })

  it('keeps penalties, which are worth points', () => {
    expect(summariseScorers(timeline, 'away')[0].name).toBe('S. Prendergast')
  })

  it('classifies scoring events', () => {
    expect(isScoringEvent({ type: SCORE_EVENTS.TRY })).toBe(true)
    expect(isScoringEvent({ type: SCORE_EVENTS.DROP_GOAL })).toBe(true)
    expect(isScoringEvent({ type: SCORE_EVENTS.CONVERSION })).toBe(false)
  })

  it('picks out cards for the discipline line', () => {
    expect(cardEvents(timeline)).toHaveLength(1)
  })

  it('labels events with rugby shorthand', () => {
    expect(timelineMark(SCORE_EVENTS.TRY)).toBe('TRY')
    expect(timelineMark(SCORE_EVENTS.YELLOW_CARD)).toBe('YC')
    expect(timelineMark('nonsense')).toBe('')
  })

  it('handles an empty timeline', () => {
    expect(summariseScorers([], 'home')).toEqual([])
    expect(cardEvents()).toEqual([])
  })
})

describe('form strings', () => {
  it('splits a form run into letters', () => {
    expect(formLetters('WWLWL')).toEqual(['W', 'W', 'L', 'W', 'L'])
  })

  it('tolerates missing form', () => {
    expect(formLetters('')).toEqual([])
    expect(formLetters(null)).toEqual([])
  })
})
