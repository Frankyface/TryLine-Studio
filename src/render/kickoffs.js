/**
 * One kick-off, told in several places at once.
 *
 * A fixture card is read by people in different countries, and a single time
 * only serves one of them. The main time stays where the match IS - that is
 * the one a local reader wants and the one a club posts - and the rest are
 * listed underneath so nobody has to do the arithmetic.
 *
 * ESPN publishes kick-off in UTC and nothing else: there is no lat/long, no
 * country and no offset anywhere in the rugby payloads, and `venue.address`
 * is not a country (Stade de France returns "Reunion"). Every zone here is
 * therefore chosen by the caller, never inferred from the feed.
 */
import { formatKickoffTime } from './format.js'

/**
 * The three the brief asks for, in the order they are drawn.
 * Labels are short because they sit on one line under the pill.
 */
export const WORLD_ZONES = Object.freeze([
  Object.freeze({ id: 'America/New_York', label: 'EST' }),
  Object.freeze({ id: 'Europe/London', label: 'LON' }),
  Object.freeze({ id: 'Australia/Sydney', label: 'SYD' }),
])

/**
 * Does this zone show the match on a different DAY from the main one?
 *
 * A Sydney reader looking at a Friday night game in Europe sees it on
 * Saturday, and a time with no day attached sends them to the wrong morning.
 * Worth the extra two characters.
 */
function dayOffset(iso, zoneId, mainZoneId) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 0
  const dayIn = (zone) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone === 'local' ? undefined : zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date)
    const get = (type) => parts.find((part) => part.type === type)?.value
    return `${get('year')}-${get('month')}-${get('day')}`
  }
  try {
    const here = dayIn(zoneId)
    const there = dayIn(mainZoneId)
    if (here === there) return 0
    return here > there ? 1 : -1
  } catch {
    return 0
  }
}

/**
 * The other times to print, skipping any that duplicate the main one.
 *
 * A Premiership match shown in London time has no business printing "LON"
 * again underneath, and a card that repeats itself looks like a bug.
 */
export function worldKickoffs(iso, mainZoneId, zones = WORLD_ZONES) {
  if (!iso) return []
  const main = formatKickoffTime(iso, { timeZone: mainZoneId })
  // No announced time means nothing to convert. 90 of 1,147 matches.
  if (!main) return []

  const out = []
  for (const zone of zones) {
    if (zone.id === mainZoneId) continue
    const time = formatKickoffTime(iso, { timeZone: zone.id })
    if (!time) continue
    const shift = dayOffset(iso, zone.id, mainZoneId)
    /**
     * Skip a zone that shows the SAME CLOCK as the pill above it, matched on
     * the time rather than on the zone id.
     *
     * Comparing ids is not enough: the main zone is often `local`, which
     * resolves to a real zone that can be one of these three. Rendered from
     * Ontario the card printed "15:10 KICK OFF" and then "EST 15:10"
     * underneath it - the same moment, twice, looking like a fault.
     */
    if (time === main && shift === 0) continue
    out.push({
      id: zone.id,
      label: zone.label,
      time,
      // +1 / -1 only where the calendar day actually differs.
      day: shift > 0 ? '+1' : (shift < 0 ? '-1' : ''),
    })
  }
  return out
}

/** "EST 09:45  ·  LON 14:45  ·  SYD 00:45 +1" */
export function worldKickoffLine(iso, mainZoneId, zones = WORLD_ZONES) {
  return worldKickoffs(iso, mainZoneId, zones)
    .map((entry) => `${entry.label} ${entry.time}${entry.day ? ` ${entry.day}` : ''}`)
    .join('   ')
}
