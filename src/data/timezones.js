/**
 * Kick-off times are the one field where "correct" depends on the audience.
 *
 * ESPN publishes kick-off in UTC. Rendering it in the viewer's own timezone is
 * wrong for a foreign fixture - a Top 14 match kicking off at 21:10 in Paris
 * showed as 15:10 to a viewer in Canada. So each competition carries the zone
 * its audience actually watches in, and the user can override it.
 */

export const LOCAL_ZONE = 'local'

/** Zones offered in the app, covering the rugby-playing world. */
export const TIME_ZONES = Object.freeze([
  Object.freeze({ id: LOCAL_ZONE, label: 'My local time' }),
  Object.freeze({ id: 'UTC', label: 'UTC' }),
  Object.freeze({ id: 'Europe/London', label: 'UK (London)' }),
  Object.freeze({ id: 'Europe/Dublin', label: 'Ireland (Dublin)' }),
  Object.freeze({ id: 'Europe/Paris', label: 'France (Paris)' }),
  Object.freeze({ id: 'Europe/Rome', label: 'Italy (Rome)' }),
  Object.freeze({ id: 'Africa/Johannesburg', label: 'South Africa' }),
  Object.freeze({ id: 'Australia/Sydney', label: 'Australia (Sydney)' }),
  Object.freeze({ id: 'Pacific/Auckland', label: 'New Zealand' }),
  Object.freeze({ id: 'America/Argentina/Buenos_Aires', label: 'Argentina' }),
  Object.freeze({ id: 'America/New_York', label: 'US Eastern' }),
  Object.freeze({ id: 'Asia/Tokyo', label: 'Japan (Tokyo)' }),
])

/**
 * Default zone per competition - where most of its audience is.
 * The URC spans Ireland, Wales, Scotland, Italy and South Africa; London is the
 * least-wrong single default for it.
 */
export const COMPETITION_ZONES = Object.freeze({
  180659: 'Europe/London', // Six Nations
  267979: 'Europe/London', // Gallagher Premiership
  270557: 'Europe/London', // United Rugby Championship
  270559: 'Europe/Paris', // Top 14
  271937: 'Europe/London', // Champions Cup
  272073: 'Europe/London', // Challenge Cup
  242041: 'Pacific/Auckland', // Super Rugby Pacific
  289262: 'America/New_York', // Major League Rugby
  // Competitions that roam between hemispheres have no sensible fixed default,
  // so they fall back to the viewer's own clock and the manual override.
  289234: LOCAL_ZONE, // International Tests
  244293: LOCAL_ZONE, // The Rugby Championship
  268565: LOCAL_ZONE, // British & Irish Lions
  164205: LOCAL_ZONE, // Rugby World Cup
  289237: LOCAL_ZONE, // Women's Rugby World Cup
  17567: LOCAL_ZONE, // Nations Championship
})

export const zoneForCompetition = (competitionId) =>
  COMPETITION_ZONES[competitionId] || LOCAL_ZONE

/** Intl throws on an unknown zone; treat anything unusable as local time. */
export function resolveZone(zoneId) {
  if (!zoneId || zoneId === LOCAL_ZONE) return undefined
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zoneId })
    return zoneId
  } catch {
    return undefined
  }
}
