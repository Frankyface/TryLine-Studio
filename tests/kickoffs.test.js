/**
 * One kick-off told in several places.
 *
 * The rules that matter: the main time is where the match IS, the extra zones
 * never repeat it, and a day that rolls over says so - a Sydney reader looking
 * at a Friday night in Europe is looking at Saturday morning.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { worldKickoffs, worldKickoffLine, WORLD_ZONES } from '../src/render/kickoffs.js'
import { zoneForVenue } from '../src/data/venue-zones.js'

describe('worldKickoffs', () => {
  it('tells a European evening kick-off in three places', () => {
    const rows = worldKickoffs('2026-03-13T19:45Z', 'Europe/London')
    expect(rows.map((row) => row.label)).toEqual(['EST', 'SYD'])
    expect(rows.find((row) => row.label === 'EST').time).toBe('15:45')
    expect(rows.find((row) => row.label === 'SYD').time).toBe('06:45')
  })

  it('marks the day when it rolls over', () => {
    const sydney = worldKickoffs('2026-03-13T19:45Z', 'Europe/London')
      .find((row) => row.label === 'SYD')
    // Friday night in Britain is Saturday morning in Australia, and a time
    // with no day sends the reader to the wrong morning.
    expect(sydney.day).toBe('+1')
  })

  it('never repeats the time already on the pill', () => {
    // The main zone is often `local`, which resolves to a real zone that can
    // be one of these three - so the match is on the CLOCK, not the zone id.
    const asLocal = worldKickoffs('2026-02-05T19:10Z', 'America/New_York')
    expect(asLocal.map((row) => row.label)).not.toContain('EST')
    expect(asLocal.every((row) => row.time !== '14:10')).toBe(true)
  })

  it('drops the zone that IS the main one', () => {
    const rows = worldKickoffs('2026-03-13T19:45Z', 'Australia/Sydney')
    expect(rows.map((row) => row.label)).toEqual(['EST', 'LON'])
  })

  it('says nothing when the kick-off has not been announced', () => {
    // T00:00Z means "not announced", on 90 of the 1,147 archived matches.
    expect(worldKickoffs('2026-05-15T00:00Z', 'Europe/Paris')).toEqual([])
    expect(worldKickoffLine('2026-05-15T00:00Z', 'Europe/Paris')).toBe('')
  })

  it('says nothing without a kick-off at all', () => {
    expect(worldKickoffs('', 'Europe/London')).toEqual([])
    expect(worldKickoffs(null, 'Europe/London')).toEqual([])
  })

  it('formats a line a card can print', () => {
    const line = worldKickoffLine('2026-03-13T19:45Z', 'Europe/London')
    expect(line).toMatch(/EST 15:45/)
    expect(line).toMatch(/SYD 06:45 \+1/)
    expect(line).not.toMatch(/undefined|NaN/)
  })

  it('offers exactly the three zones asked for', () => {
    expect(WORLD_ZONES.map((zone) => zone.label)).toEqual(['EST', 'LON', 'SYD'])
  })
})

describe('zoneForVenue', () => {
  it('reads the city, which the feed carries', () => {
    expect(zoneForVenue({ city: 'Cape Town' })).toBe('Africa/Johannesburg')
    expect(zoneForVenue({ city: 'Parma' })).toBe('Europe/Rome')
    expect(zoneForVenue({ city: 'Dublin' })).toBe('Europe/Dublin')
  })

  it('is not fooled by case or padding', () => {
    expect(zoneForVenue({ city: '  cape town ' })).toBe('Africa/Johannesburg')
  })

  it('returns nothing rather than guessing', () => {
    // A wrong kick-off time is worse than a coarse one, so an unknown city
    // falls back to the competition default instead of being approximated.
    expect(zoneForVenue({ city: 'Nowhere-on-Sea' })).toBe('')
    expect(zoneForVenue({})).toBe('')
    expect(zoneForVenue(null)).toBe('')
  })
})

/* ---------- against the real archive ---------- */

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

function venuesInArchive() {
  if (!existsSync(dataDir)) return []
  const found = []
  for (const competition of readdirSync(dataDir)) {
    const dir = join(dataDir, competition)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    const matchDir = join(dir, 'matches')
    if (!existsSync(matchDir)) continue
    for (const file of readdirSync(matchDir)) {
      const match = JSON.parse(readFileSync(join(matchDir, file), 'utf8'))
      if (match.venue?.city) found.push(match.venue)
    }
  }
  return found
}

const venues = venuesInArchive()

describe('every venue in the archive', () => {
  it.skipIf(!venues.length)('maps to a timezone', () => {
    const unmapped = venues.filter((venue) => !zoneForVenue(venue))
    expect(venues.length).toBeGreaterThan(1000)
    // A city the map does not know is not a crash, but it silently downgrades
    // the card to the competition default, so it should be visible here.
    expect(unmapped.map((venue) => venue.city)).toEqual([])
  })
})
