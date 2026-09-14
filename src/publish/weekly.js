import { planningReason } from './plan.js'
import { matchFlow, scoringSpotlights } from '../analysis/match-flow.js'
import { dateInZone, fixtureDate, kickoffIsTbc } from '../data/fixture-time.js'
import { formatKickoffTime } from '../render/format.js'
export { dateInZone } from '../data/fixture-time.js'

export const DOMESTIC_LEAGUES = Object.freeze([
  { id: '242041', name: 'Super Rugby Pacific', short: 'Super Rugby', themeId: 'ocean', hour: 9 },
  { id: '270557', name: 'United Rugby Championship', short: 'URC', themeId: 'turf', hour: 10 },
  { id: '267979', name: 'Gallagher Premiership', short: 'Premiership', themeId: 'midnight', hour: 11 },
  { id: '270559', name: 'Top 14', short: 'Top 14', themeId: 'bloodwood', hour: 12 },
  { id: '289262', name: 'Major League Rugby', short: 'MLR', themeId: 'slate', hour: 13 },
])
export const POSTING_ZONE = 'America/Toronto'
const DAY = 86400000
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
  && new Date(date).toISOString().slice(0, 10) === date

export function mondayOf(date) {
  if (!validDate(date)) throw new Error('Use a valid date in YYYY-MM-DD format.')
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7)
  return d.toISOString().slice(0, 10)
}
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

/** Convert a local editorial slot to UTC, including DST. Slots are never in the 02:00 gap. */
export function slotInstant(date, hour, timeZone = POSTING_ZONE) {
  if (!validDate(date) || !Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Invalid posting slot.')
  const target = Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`)
  let value = target
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(value)
    const get = (type) => parts.find((p) => p.type === type).value
    const local = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`)
    value += target - local
  }
  return new Date(value).toISOString()
}

export function weeklyStats(matches) {
  const finals = matches.filter((m) => m.status === 'final' && !planningReason(m))
  const totalPoints = finals.reduce((n, m) => n + m.home.score + m.away.score, 0)
  const ranked = finals.slice().sort((a, b) => Math.abs(b.home.score - b.away.score) - Math.abs(a.home.score - a.away.score) || a.id.localeCompare(b.id))
  const teams = finals.flatMap((m) => ['home', 'away'].map((side) => ({ team: m[side], points: m[side].score, matchId: m.id })))
    .sort((a, b) => b.points - a.points || a.team.name.localeCompare(b.team.name))
  return { played: finals.length, totalPoints, averagePoints: finals.length ? (totalPoints / finals.length).toFixed(1) : '0.0',
    homeWins: finals.filter((m) => m.home.score > m.away.score).length,
    awayWins: finals.filter((m) => m.away.score > m.home.score).length,
    draws: finals.filter((m) => m.home.score === m.away.score).length,
    biggestWin: ranked.find((m) => m.home.score !== m.away.score) || null,
    closest: ranked.at(-1) || null, attacks: teams.slice(0, 4) }
}

/** A week follows the account's timezone; cross-border leagues share one cutoff. */
export function buildWeek({ league, matches, table, updated, week, timeZone = POSTING_ZONE, now = new Date().toISOString() }) {
  if (!DOMESTIC_LEAGUES.some((l) => l.id === league?.id)) throw new Error('Choose one of the five domestic leagues.')
  const start = mondayOf(week)
  const end = addDays(start, 7)
  const unique = new Map()
  for (const match of matches) {
    if (match.competition?.id !== league.id || !Number.isFinite(Date.parse(match.kickoff))) continue
    const date = fixtureDate(match, timeZone)
    if (date >= start && date < end) unique.set(match.id, match)
  }
  const fixtures = [...unique.values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff) || a.id.localeCompare(b.id))
  const finals = fixtures.filter((m) => m.status === 'final' && !planningReason(m) && Date.parse(m.kickoff) <= Date.parse(now))
  const upcoming = fixtures.filter((m) => m.status === 'scheduled' && !planningReason(m)
    && (kickoffIsTbc(m) ? fixtureDate(m, timeZone) >= dateInZone(now, timeZone) : Date.parse(m.kickoff) > Date.parse(now)))
  const unresolved = fixtures.filter((m) => !finals.includes(m) && !/postponed|cancelled|canceled|abandoned/i.test(m.statusDetail || ''))
  const warnings = []
  const stale = !Number.isFinite(Date.parse(updated)) || Date.parse(now) - Date.parse(updated) > 48 * 3600000 || Date.parse(updated) > Date.parse(now) + 300000
  if (stale) warnings.push('Refresh the data before posting: this snapshot is stale or has an invalid timestamp.')
  if (!fixtures.length) warnings.push('No fixtures recorded for this week. Check the source calendar before treating this as a bye week.')
  if (unresolved.length) warnings.push(`${unresolved.length} fixture(s) are not final. The completed-results roundup is held until they are resolved.`)
  // A latest-season table cannot be passed off as the table after an archive round.
  const years = new Set(finals.map((m) => m.season.year))
  const datedForWeek = Number.isFinite(Date.parse(updated)) && dateInZone(updated, timeZone) >= start && dateInZone(updated, timeZone) <= addDays(start, 8)
  const standings = table?.rows?.length && !table.partial && table.competition.id === league.id
    && years.size === 1 && years.has(table.season.year) && datedForWeek ? table : null
  if (!standings) warnings.push('Standings for this week are unavailable; no table or league points have been reconstructed.')
  const spotlights = scoringSpotlights(finals)
  if (!spotlights.length && finals.length) warnings.push('No verified named scoring events for player spotlights.')
  const stories = finals.map((match) => ({ match, reason: matchFlow(match).reason }))
  const label = `${start} – ${addDays(start, 6)}`
  return { league, start, end, label, timeZone, updated, stale, fixtures, finals, upcoming, unresolved,
    standings, spotlights, stories, warnings, stats: weeklyStats(finals) }
}

/** Editorial schedule, not a claim about optimal engagement or a publishing ledger. */
export function scheduleFor(week) {
  const { start, league, timeZone } = week
  const previewSlot = slotInstant(addDays(start, 2), league.hour, timeZone)
  const firstMatch = week.fixtures.filter((m) => !/postponed|cancelled|canceled|abandoned/i.test(m.statusDetail || ''))[0]
  const firstKickoff = firstMatch && (kickoffIsTbc(firstMatch)
    ? slotInstant(fixtureDate(firstMatch, timeZone), 0, timeZone) : firstMatch.kickoff)
  const previewAt = firstKickoff
    ? new Date(Math.min(Date.parse(previewSlot), Date.parse(firstKickoff) - DAY)).toISOString() : previewSlot
  return [
    { kind: 'preview', title: 'Weekly fixtures', publishAt: previewAt, description: 'Every upcoming fixture, with date and kick-off time.' },
    { kind: 'review', title: 'Results & analysis', publishAt: slotInstant(addDays(start, 7), league.hour, timeZone),
      description: 'Every result → standings → team analysis → up to two scoring spotlights.' },
    { kind: 'stories', title: 'How the matches unfolded', publishAt: slotInstant(addDays(start, 8), league.hour, timeZone),
      description: 'Every completed match: scoring and card timeline, or a result when event data is missing.' },
  ].map((slot) => ({ ...slot, id: `tryline:${league.id}:${start}:${slot.kind}`,
    timeZone, state: week.stale ? 'needs-refresh' : !week.fixtures.length ? 'no-fixtures'
      : slot.kind === 'preview' ? (week.upcoming.length ? 'ready' : 'no-upcoming-fixtures')
        : week.unresolved.length ? 'waiting-for-results' : week.finals.length ? 'ready' : 'no-results' }))
}

/** Page every fixture; never silently trim a league to fit one square. */
export function weeklyCards(week, kind) {
  if (!['preview', 'review', 'stories'].includes(kind)) throw new Error('Pack must be preview, review or stories.')
  const cards = []
  const add = (graphicId, key, options = {}, match = null, caption = '') => cards.push({ graphicId,
    id: `tryline:${week.league.id}:${week.start}:${kind}:${key}`, themeId: week.league.themeId,
    format: 'feed', options, match, caption, order: cards.length + 1 })
  const pages = (rows, graphicId) => {
    for (let i = 0; i < rows.length; i += 6) add(graphicId, `${graphicId}-${i / 6 + 1}`,
      { offset: i, page: i / 6 + 1, pages: Math.ceil(rows.length / 6) }, null,
      rows.slice(i, i + 6).map((m) => `${m.home.name} ${kind === 'preview' ? 'v' : `${m.home.score}–${m.away.score}`} ${m.away.name}${kind === 'preview' ? ` · ${fixtureDate(m, week.timeZone)} · ${formatKickoffTime(m.kickoff, { timeZone: week.timeZone }) || 'Time TBC'} (${week.timeZone})` : ''}`).join('\n'))
  }
  if (kind === 'preview') pages(week.upcoming, 'weeklyfixtures')
  if (kind === 'review' && week.finals.length) {
    pages(week.finals, 'weeklyresults')
    if (week.standings) add('table', 'standings', { headline: 'Standings', limit: 20 }, null, `Standings snapshot: ${week.updated}.`)
    add('weeklyanalysis', 'analysis', {}, null, `${week.stats.played} completed matches · ${week.stats.totalPoints} points · ${week.stats.averagePoints} points per game. Home wins ${week.stats.homeWins}, away wins ${week.stats.awayWins}, draws ${week.stats.draws}.`)
    week.spotlights.forEach((spotlight, i) => add('scoringspotlight', `player-${encodeURIComponent(spotlight.player.id || spotlight.player.name)}-${spotlight.match.id}`,
      { spotlightIndex: i }, spotlight.match, `${spotlight.player.name}: ${spotlight.points} points (${spotlight.tries} tries, ${spotlight.conversions} conversions, ${spotlight.penalties} penalties, ${spotlight.dropGoals} drop goals). Scoring spotlight from recorded events; not an official player-of-the-match award.`))
  }
  if (kind === 'stories') for (const story of week.stories) add(story.reason ? 'result' : 'matchflow', story.match.id, {}, story.match,
    `${story.match.home.name} ${story.match.home.score}–${story.match.away.score} ${story.match.away.name}.${story.reason ? ` Event timeline unavailable: ${story.reason}` : ' Scoring and cards, grouped into 20-minute periods.'}`)
  return cards.map((card, i) => ({ ...card, carousel: Math.floor(i / 10) + 1, slide: i % 10 + 1 }))
}
