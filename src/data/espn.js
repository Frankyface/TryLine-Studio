/**
 * ESPN adapter - pure mapping from ESPN's undocumented rugby JSON into the
 * internal schema. No network calls live here, so every branch is testable
 * against the real captured responses in tests/fixtures/.
 *
 * ESPN quirks encoded here, all confirmed against live responses:
 *  - Roster blocks carry no logo, so crests are rebuilt from the team id.
 *  - The standings group label is stale ("2023/24") even when the season param
 *    returns the right table. Never render that label.
 *  - attendance 0 means "not reported", not "nobody came".
 */
import {
  MATCH_STATUS, SCORE_EVENTS, STARTING_XV, createMatch, createTable, num,
} from './schema.js'

const API_ROOT = 'https://site.api.espn.com/apis'
const TEAM_LOGO = (teamId) => `https://a.espncdn.com/i/teamlogos/rugby/teams/500/${teamId}.png`

/**
 * Competition ids, every one verified against a live scoreboard response that
 * returned actual events. ESPN also serves ids that resolve with the right name
 * but carry no fixtures at all - Women's Six Nations (289258) and Currie Cup
 * (270555, dead since 2022) are the notable traps, so they are omitted.
 * Premiership Women's Rugby and Japan Rugby League One do not exist on ESPN.
 */
export const COMPETITIONS = Object.freeze([
  Object.freeze({ id: '180659', name: 'Six Nations', short: '6N', national: true }),
  Object.freeze({ id: '289234', name: 'International Tests', short: 'TESTS', national: true }),
  Object.freeze({ id: '267979', name: 'Gallagher Premiership', short: 'PREM' }),
  Object.freeze({ id: '270557', name: 'United Rugby Championship', short: 'URC' }),
  Object.freeze({ id: '270559', name: 'Top 14', short: 'TOP14' }),
  Object.freeze({ id: '271937', name: 'Champions Cup', short: 'CC' }),
  Object.freeze({ id: '272073', name: 'Challenge Cup', short: 'ECC' }),
  Object.freeze({ id: '242041', name: 'Super Rugby Pacific', short: 'SRP' }),
  Object.freeze({ id: '244293', name: 'The Rugby Championship', short: 'TRC', national: true }),
  Object.freeze({ id: '289262', name: 'Major League Rugby', short: 'MLR' }),
  Object.freeze({ id: '268565', name: 'British & Irish Lions', short: 'LIONS', national: true }),
  Object.freeze({ id: '164205', name: 'Rugby World Cup', short: 'RWC', national: true }),
  Object.freeze({ id: '289237', name: "Women's Rugby World Cup", short: 'WRWC', national: true }),
  Object.freeze({ id: '17567', name: 'Nations Championship', short: 'NC', national: true }),
])

/** Which competitions are between countries, where a flag IS the crest. */
const NATIONAL_COMPETITIONS = new Set(
  COMPETITIONS.filter((competition) => competition.national).map((competition) => competition.id),
)

/**
 * ESPN falls back to a COUNTRY FLAG when it has no club crest, matching on the
 * club's abbreviation. Perpignan abbreviate to "USA" (Union Sportive Arlequins)
 * and are served the United States flag - on a French league chart. A flag is
 * only ever right when the team actually is a country.
 */
export const isCountryFlag = (logo) => /\/teamlogos\/countries\//.test(String(logo || ''))

const crestFor = (logo, competitionId) => (
  isCountryFlag(logo) && !NATIONAL_COMPETITIONS.has(String(competitionId)) ? '' : logo
)

/** ESPN detail-type id to internal event type. Ids are stabler than the text. */
const EVENT_TYPE_BY_ID = Object.freeze({
  1: SCORE_EVENTS.TRY,
  2: SCORE_EVENTS.CONVERSION,
  3: SCORE_EVENTS.PENALTY,
  4: SCORE_EVENTS.DROP_GOAL,
  5: SCORE_EVENTS.YELLOW_CARD,
  6: SCORE_EVENTS.RED_CARD,
})

const EVENT_TYPE_BY_TEXT = Object.freeze({
  try: SCORE_EVENTS.TRY,
  'penalty try': SCORE_EVENTS.PENALTY_TRY,
  conversion: SCORE_EVENTS.CONVERSION,
  'penalty goal': SCORE_EVENTS.PENALTY,
  'drop goal': SCORE_EVENTS.DROP_GOAL,
  'yellow card': SCORE_EVENTS.YELLOW_CARD,
  'red card': SCORE_EVENTS.RED_CARD,
})

export function buildScoreboardUrl(leagueId, { from, to } = {}) {
  const base = `${API_ROOT}/site/v2/sports/rugby/${leagueId}/scoreboard`
  if (!from) return base
  return `${base}?dates=${from}${to ? `-${to}` : ''}`
}

export const buildSummaryUrl = (leagueId, eventId) =>
  `${API_ROOT}/site/v2/sports/rugby/${leagueId}/summary?event=${eventId}`

export function buildStandingsUrl(leagueId, season) {
  const base = `${API_ROOT}/v2/sports/rugby/${leagueId}/standings`
  return season ? `${base}?season=${season}` : base
}

/** ESPN dates want YYYYMMDD; accept a Date or an ISO-ish string. */
export function toEspnDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

const statusFrom = (statusType = {}) => {
  if (statusType.completed) return MATCH_STATUS.FINAL
  if (statusType.state === 'in') return MATCH_STATUS.LIVE
  return MATCH_STATUS.SCHEDULED
}

const logoFrom = (team = {}) =>
  team.logo || team.logos?.[0]?.href || (team.id ? TEAM_LOGO(team.id) : '')

const teamFrom = (competitor = {}, competitionId = '') => {
  const team = competitor.team || {}
  return {
    id: String(team.id ?? ''),
    name: team.displayName || team.name || '',
    shortName: team.shortDisplayName || team.name || team.displayName || '',
    abbreviation: team.abbreviation || '',
    logo: crestFor(logoFrom(team), competitionId),
    color: team.color ? `#${String(team.color).replace(/^#/, '')}` : '',
    score: num(competitor.score),
    isWinner: Boolean(competitor.winner),
  }
}

const sideOf = (competitors, teamId) => {
  const found = competitors.find((c) => String(c.team?.id ?? c.id) === String(teamId))
  if (found?.homeAway === 'away') return 'away'
  if (found?.homeAway === 'home') return 'home'
  return ''
}

/** Minutes come as "13" with a tick, or as a seconds value. Both appear live. */
const minuteFrom = (clock = {}) => {
  const display = String(clock.displayValue ?? '').replace(/[^0-9]/g, '')
  if (display) return Number(display)
  const seconds = num(clock.value)
  return seconds === null ? null : Math.floor(seconds / 60)
}

function timelineFrom(details = [], competitors = []) {
  return (details || [])
    .map((detail) => {
      const type = EVENT_TYPE_BY_ID[Number(detail?.type?.id)]
        || EVENT_TYPE_BY_TEXT[String(detail?.type?.text || '').toLowerCase()]
      if (!type) return null
      const athlete = detail.participants?.[0]?.athlete || detail.athletesInvolved?.[0] || {}
      return {
        minute: minuteFrom(detail.clock),
        type,
        side: sideOf(competitors, detail.team?.id),
        player: {
          id: String(athlete.id ?? ''),
          name: athlete.displayName || athlete.fullName || '',
          shortName: athlete.shortName || '',
        },
        homeScore: num(detail.homeScore),
        awayScore: num(detail.awayScore),
      }
    })
    .filter(Boolean)
}

const statsFrom = (stats = []) =>
  (stats || []).reduce((acc, stat) => {
    if (!stat?.name) return acc
    return { ...acc, [stat.name]: num(stat.value) ?? num(stat.displayValue) }
  }, {})

/**
 * ESPN ships `starter`, `active`, `captain`, `subbedIn` and `subbedOut` on every
 * rugby roster entry but leaves them all false - they are populated for other
 * sports, not this feed. Verified across both fixture matches: zero true values.
 * So the starting XV is derived the way rugby actually works: shirts 1-15 start,
 * 16-23 are the bench, and ESPN marks bench positions with the code "R".
 * Captaincy is genuinely absent from this source; only manual entry can set it.
 */
const playerFrom = (entry = {}) => {
  const athlete = entry.athlete || {}
  const jersey = num(entry.jersey)
  const isReplacement = String(entry.position?.abbreviation || '').toUpperCase() === 'R'
  return {
    id: String(athlete.id ?? ''),
    name: athlete.displayName || athlete.fullName || '',
    shortName: athlete.shortName || '',
    jersey,
    position: entry.position?.abbreviation || entry.position?.displayName || '',
    isStarter: entry.starter === true
      || (jersey !== null && jersey <= STARTING_XV && !isReplacement),
    isCaptain: Boolean(entry.captain),
    subbedIn: Boolean(entry.subbedIn),
    subbedOut: Boolean(entry.subbedOut),
    stats: statsFrom(entry.stats),
  }
}

/** Squads live in a sibling rosters block keyed by homeAway, not on the competitor. */
function squadsFrom(rosters = []) {
  const bySide = { home: [], away: [] }
  for (const block of rosters || []) {
    const side = block.homeAway === 'away' ? 'away' : 'home'
    bySide[side] = (block.roster || [])
      .map(playerFrom)
      .sort((a, b) => (a.jersey ?? 99) - (b.jersey ?? 99))
  }
  return bySide
}

/** One event from a scoreboard response - no squads, no per-player stats. */
export function adaptEvent(event = {}, league = {}, season = {}) {
  const leagueId = league.slug || league.midsizeName || String(league.id ?? '')
  const competition = event.competitions?.[0] || {}
  const competitors = competition.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {}
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {}
  const attendance = num(competition.attendance)

  return createMatch({
    id: String(event.id ?? ''),
    source: 'espn',
    competition: {
      id: leagueId,
      name: league.name || '',
      abbreviation: league.abbreviation || '',
      logo: league.logos?.[0]?.href || '',
    },
    season: { year: season.year, display: season.displayName || '' },
    round: event.notes?.[0]?.headline || competition.notes?.[0]?.headline || '',
    kickoff: event.date || competition.date || '',
    status: statusFrom(competition.status?.type || event.status?.type),
    statusDetail: competition.status?.type?.detail || event.status?.type?.detail || '',
    venue: {
      name: competition.venue?.fullName || '',
      city: competition.venue?.address?.city || '',
      attendance: attendance === 0 ? null : attendance,
    },
    home: teamFrom(home, leagueId),
    away: teamFrom(away, leagueId),
    timeline: timelineFrom(competition.details, competitors),
  })
}

/**
 * A whole scoreboard response to every match it contains.
 *
 * Major League Rugby mixes empty `{}` objects into its events array - 6 of 41
 * in one sampled month. Without this filter they become blank rows in the match
 * picker, so anything without two named teams is dropped.
 */
export function adaptScoreboard(payload = {}) {
  const league = payload.leagues?.[0] || {}
  const season = league.season || {}
  return (payload.events || [])
    .filter((event) => event && event.competitions?.length)
    .map((event) => adaptEvent(event, league, season))
    .filter((match) => match.home.name && match.away.name)
}

/** A summary response to one match with full squads, stats and timeline. */
export function adaptSummary(payload = {}) {
  const header = payload.header || {}
  const competition = header.competitions?.[0] || {}
  const competitors = competition.competitors || []
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {}
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {}
  const squads = squadsFrom(payload.rosters)
  const attendance = num(payload.gameInfo?.attendance)
  const leagueId = header.league?.slug || header.league?.midsizeName || ''

  return createMatch({
    id: String(header.id ?? ''),
    source: 'espn',
    competition: {
      id: leagueId,
      name: header.league?.name || '',
      abbreviation: header.league?.abbreviation || '',
      logo: header.league?.logos?.[0]?.href || '',
    },
    // The summary header carries only a season year, no display name.
    season: {
      year: header.season?.year,
      display: header.season?.displayName || String(header.season?.year ?? ''),
    },
    kickoff: competition.date || '',
    status: statusFrom(competition.status?.type),
    statusDetail: competition.status?.type?.detail || '',
    venue: {
      name: payload.gameInfo?.venue?.fullName || '',
      city: payload.gameInfo?.venue?.address?.city || '',
      attendance: attendance === 0 ? null : attendance,
    },
    home: { ...teamFrom(home, leagueId), squad: squads.home },
    away: { ...teamFrom(away, leagueId), squad: squads.away },
    timeline: timelineFrom(competition.details, competitors),
  })
}

const statValue = (stats = [], name) => (stats || []).find((s) => s.name === name)?.displayValue

/** A standings response to a league table. */
export function adaptStandings(payload = {}, { season, competitionId } = {}) {
  const group = payload.children?.[0] || {}
  const entries = group.standings?.entries || []

  const rows = entries.map((entry) => {
    const stats = entry.stats || []
    const team = typeof entry.team === 'string' ? { displayName: entry.team } : entry.team || {}
    return {
      rank: num(statValue(stats, 'rank')),
      team: {
        id: String(team.id ?? ''),
        name: team.displayName || team.name || String(entry.team ?? ''),
        shortName: team.shortDisplayName || team.displayName || String(entry.team ?? ''),
        abbreviation: team.abbreviation || '',
        logo: crestFor(logoFrom(team), competitionId),
      },
      played: num(statValue(stats, 'gamesPlayed')),
      won: num(statValue(stats, 'gamesWon')),
      drawn: num(statValue(stats, 'gamesDrawn')),
      lost: num(statValue(stats, 'gamesLost')),
      pointsFor: num(statValue(stats, 'pointsFor')),
      pointsAgainst: num(statValue(stats, 'pointsAgainst')),
      pointsDifference: num(String(statValue(stats, 'pointsDifference') ?? '').replace('+', '')),
      triesFor: num(statValue(stats, 'triesFor')),
      bonusPoints: num(statValue(stats, 'bonusPoints')),
      points: num(statValue(stats, 'points')),
      form: statValue(stats, 'overall') || '',
    }
  })

  return createTable({
    competition: {
      id: String(payload.id ?? ''),
      name: payload.name || '',
      abbreviation: payload.abbreviation || '',
    },
    // Deliberately ignores group.abbreviation - ESPN leaves it stale.
    season: { year: num(season), display: season ? String(season) : '' },
    rows: [...rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
  })
}
