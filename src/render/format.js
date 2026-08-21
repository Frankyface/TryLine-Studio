/**
 * Presentation formatting - dates, stat labels, timeline lines.
 * Pure string helpers, unit tested, no canvas involvement.
 */
import { SCORE_EVENTS } from '../data/schema.js'

/**
 * Dates and kick-off times can be rendered in any timezone.
 *
 * Feeds publish kick-off in UTC. Rendering it in the viewer's own zone is wrong
 * for a foreign fixture - a Top 14 match kicking off at 21:10 in Paris showed as
 * 15:10 to a viewer in Canada. Pass `timeZone` (an IANA name) to fix that;
 * omitting it keeps the viewer's local clock.
 */
const parse = (iso) => {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Intl rejects an unknown zone; fall back to local rather than throwing. */
function partsIn(date, timeZone, options) {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).formatToParts(date)
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).formatToParts(date)
  }
}

const partValue = (parts, type) => parts.find((part) => part.type === type)?.value || ''

/** "Saturday 7 Feb" - the way a matchday poster reads. */
export function formatMatchDate(iso, { withYear = false, timeZone } = {}) {
  const date = parse(iso)
  if (!date) return ''
  const parts = partsIn(date, timeZone, {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
  })
  const base = `${partValue(parts, 'weekday')} ${partValue(parts, 'day')} ${partValue(parts, 'month')}`
  return withYear ? `${base} ${partValue(parts, 'year')}` : base
}

/** Kick-off time, 24 hour, as "20:10". */
export function formatKickoffTime(iso, { timeZone } = {}) {
  const date = parse(iso)
  if (!date) return ''
  // ESPN writes T00:00Z when the time has not been announced. 90 of 1,147
  // matches carry it - 77 of them Top 14, where midnight UTC would be a 1am
  // kick-off - and the graphic was advertising them as "00:00". The manual
  // kick-off override is the way to state a time the feed does not have.
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) return ''
  const parts = partsIn(date, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false })
  const hour = partValue(parts, 'hour')
  const minute = partValue(parts, 'minute')
  if (!hour || !minute) return ''
  // Belt and braces: hourCycle h23 already yields "00" for midnight on current
  // engines, but an h24 locale resolution would give "24".
  return `${hour === '24' ? '00' : hour}:${minute}`
}

export const formatAttendance = (value) =>
  (value === null || value === undefined ? '' : value.toLocaleString('en-GB'))

/**
 * Human labels for the ESPN stat keys a card can show.
 *
 * `penaltyGoals` is deliberately "Penalties kicked", not "Penalties": the
 * comparison card has a "Pens conceded" row, and one word meaning both points
 * scored and an offence committed is a trap.
 */
export const STAT_LABELS = Object.freeze({
  points: 'Points',
  tries: 'Tries',
  tryAssists: 'Try assists',
  metres: 'Metres made',
  runs: 'Carries',
  passes: 'Passes',
  offload: 'Offloads',
  cleanBreaks: 'Clean breaks',
  defendersBeaten: 'Defenders beaten',
  tackles: 'Tackles',
  missedTackles: 'Missed tackles',
  turnoversConceded: 'Turnovers',
  rucksWon: 'Rucks won',
  lineoutsWon: 'Lineouts won',
  kicksFromHand: 'Kicks from hand',
  kickPercentSuccess: 'Kick success',
  conversionGoals: 'Conversions',
  penaltyGoals: 'Penalties kicked',
  penaltiesConceded: 'Pens conceded',
})

/** Preference order when auto-picking which stats a card shows. */
export const STAT_PRIORITY = Object.freeze([
  'points', 'tries', 'metres', 'runs', 'defendersBeaten', 'cleanBreaks',
  'tackles', 'offload', 'tryAssists', 'passes', 'kickPercentSuccess', 'turnoversConceded',
])

/** Percentages arrive as 0-1 and must not be rendered as "0.83". */
export function formatStatValue(key, value) {
  if (value === null || value === undefined) return '-'
  if (key === 'kickPercentSuccess') return `${Math.round(value * 100)}%`
  if (key === 'metres') return String(Math.round(value))
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

/**
 * The stats worth showing for one player, in priority order.
 *
 * Only numbers that actually happened. Padding to a fixed tile count meant 18%
 * of the 2,438 players with stats got a card where most tiles read "0" - a
 * replacement on for two minutes looked like a full performance rendered
 * badly. Half of all players have an odd count, so the grid has to cope with a
 * ragged last row either way; that is a layout problem, not a reason to invent
 * content.
 */
export function pickPlayerStats(player, limit = 6) {
  const stats = player?.stats || {}
  return STAT_PRIORITY
    .filter((key) => stats[key] !== undefined && stats[key] !== null && stats[key] !== 0)
    .slice(0, limit)
    .map((key) => ({ key, label: STAT_LABELS[key] || key, value: formatStatValue(key, stats[key]) }))
}

const TIMELINE_MARKS = Object.freeze({
  [SCORE_EVENTS.TRY]: 'TRY',
  [SCORE_EVENTS.PENALTY_TRY]: 'PEN TRY',
  [SCORE_EVENTS.CONVERSION]: 'CON',
  [SCORE_EVENTS.PENALTY]: 'PEN',
  [SCORE_EVENTS.DROP_GOAL]: 'DG',
  [SCORE_EVENTS.YELLOW_CARD]: 'YC',
  [SCORE_EVENTS.RED_CARD]: 'RC',
})

export const timelineMark = (type) => TIMELINE_MARKS[type] || ''

/** Only events worth a line on a result graphic. */
export const isScoringEvent = (event) => event.type === SCORE_EVENTS.TRY
  || event.type === SCORE_EVENTS.PENALTY_TRY
  || event.type === SCORE_EVENTS.PENALTY
  || event.type === SCORE_EVENTS.DROP_GOAL

/**
 * Group a side's scoring events into one line per scorer:
 * "L. Bielle-Biarrey 13, 47" reads better than two separate rows.
 */
export function summariseScorers(timeline = [], side) {
  const bySide = timeline.filter((e) => e.side === side && isScoringEvent(e))
  const order = []
  const byPlayer = new Map()

  for (const event of bySide) {
    const name = event.player.shortName || event.player.name || timelineMark(event.type)
    if (!byPlayer.has(name)) {
      byPlayer.set(name, [])
      order.push(name)
    }
    byPlayer.get(name).push({ minute: event.minute, type: event.type })
  }

  return order.map((name) => ({
    name,
    minutes: byPlayer.get(name).map((e) => e.minute).filter((m) => m !== null),
    types: byPlayer.get(name).map((e) => e.type),
  }))
}

/** Cards, for a discipline note under the scorers. */
export const cardEvents = (timeline = []) =>
  timeline.filter((e) => e.type === SCORE_EVENTS.YELLOW_CARD || e.type === SCORE_EVENTS.RED_CARD)

/** Words that carry no identity when telling two clubs apart. */
const GENERIC_WORDS = new Set([
  'RUGBY', 'CLUB', 'RFC', 'RUFC', 'FC', 'RC', 'THE', 'DE', 'LA', 'LE', 'US', 'SC', 'CA',
])

/** Three-letter candidates for a team, most to least preferred. */
function labelCandidates(team) {
  const words = String(team?.shortName || team?.name || '')
    .split(/[\s-]+/)
    .filter(Boolean)

  const meaningful = words.filter((word) => !GENERIC_WORDS.has(word.toUpperCase()))
  const ordered = [...meaningful, ...words]

  const candidates = []
  if (team?.abbreviation) candidates.push(team.abbreviation.toUpperCase())
  for (const word of ordered) {
    if (word.length >= 3) candidates.push(word.slice(0, 3).toUpperCase())
  }
  // Initials, for a club whose words are all short.
  if (ordered.length > 1) candidates.push(ordered.map((w) => w[0]).join('').slice(0, 3).toUpperCase())
  for (const word of ordered) candidates.push(word.slice(0, 4).toUpperCase())
  return candidates.filter(Boolean)
}

/**
 * Short labels that are unique within one set of teams.
 *
 * ESPN's abbreviations are not unique: Stade Toulousain, Stade Francais Paris
 * AND La Rochelle all abbreviate to "STA", so a Top 14 chart carried three
 * identical labels and no way to tell which team was which. Each team keeps its
 * own abbreviation where that is unambiguous and takes the next distinct
 * candidate from its name where it is not.
 *
 * Returns a Map keyed by the team name.
 */
export function uniqueTeamLabels(teams = []) {
  const counts = new Map()
  for (const team of teams) {
    const first = (team?.abbreviation || '').toUpperCase()
    if (first) counts.set(first, (counts.get(first) || 0) + 1)
  }

  const taken = new Set()
  const labels = new Map()

  for (const team of teams) {
    const key = team?.name ?? ''
    const abbreviation = (team?.abbreviation || '').toUpperCase()

    // An abbreviation shared with nobody else is kept as-is.
    if (abbreviation && counts.get(abbreviation) === 1) {
      taken.add(abbreviation)
      labels.set(key, abbreviation)
      continue
    }

    const candidate = labelCandidates(team).find((option) => !taken.has(option))
      || `${abbreviation || 'T'}${labels.size + 1}`
    taken.add(candidate)
    labels.set(key, candidate)
  }

  return labels
}

/** "W W L W L" from "WWLWL", so a form column has room to breathe. */
export const formLetters = (form) => String(form || '').toUpperCase().split('').filter(Boolean)
