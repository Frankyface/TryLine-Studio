/**
 * The internal match schema.
 *
 * Every data source — the ESPN adapter, manual entry, a CSV import — produces
 * objects in these shapes. Renderers never see a source-specific field, which
 * is what keeps "pro API" and "my club on a Saturday" on one code path.
 *
 * All builders return frozen copies; nothing here mutates its input.
 */

export const MATCH_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  FINAL: 'final',
})

export const SCORE_EVENTS = Object.freeze({
  TRY: 'try',
  CONVERSION: 'conversion',
  PENALTY: 'penalty',
  DROP_GOAL: 'dropGoal',
  PENALTY_TRY: 'penaltyTry',
  YELLOW_CARD: 'yellowCard',
  RED_CARD: 'redCard',
})

/** Points each scoring event is worth, for deriving scores from a timeline. */
export const EVENT_POINTS = Object.freeze({
  [SCORE_EVENTS.TRY]: 5,
  [SCORE_EVENTS.CONVERSION]: 2,
  [SCORE_EVENTS.PENALTY]: 3,
  [SCORE_EVENTS.DROP_GOAL]: 3,
  [SCORE_EVENTS.PENALTY_TRY]: 7,
  [SCORE_EVENTS.YELLOW_CARD]: 0,
  [SCORE_EVENTS.RED_CARD]: 0,
})

/** Shirt numbers 1-15 in the order a team sheet is always read. */
export const POSITION_NAMES = Object.freeze([
  'Loosehead Prop', 'Hooker', 'Tighthead Prop', 'Lock', 'Lock',
  'Blindside Flanker', 'Openside Flanker', 'Number 8',
  'Scrum-half', 'Fly-half', 'Left Wing', 'Inside Centre',
  'Outside Centre', 'Right Wing', 'Fullback',
])

export const STARTING_XV = 15
export const MATCHDAY_SQUAD = 23

const SIDES = Object.freeze(['home', 'away'])

/** Trim a value to a string, treating null/undefined as empty. */
const str = (value) => (value === null || value === undefined ? '' : String(value).trim())

/** Coerce to a finite number, or null when the value is absent/unparseable. */
export const num = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function createPlayer(input = {}) {
  return Object.freeze({
    id: str(input.id),
    name: str(input.name),
    shortName: str(input.shortName) || str(input.name),
    jersey: num(input.jersey),
    position: str(input.position),
    isStarter: Boolean(input.isStarter),
    isCaptain: Boolean(input.isCaptain),
    subbedIn: Boolean(input.subbedIn),
    subbedOut: Boolean(input.subbedOut),
    stats: Object.freeze({ ...(input.stats || {}) }),
  })
}

export function createTeam(input = {}) {
  const squad = (input.squad || []).map(createPlayer)
  return Object.freeze({
    id: str(input.id),
    name: str(input.name),
    shortName: str(input.shortName) || str(input.name),
    abbreviation: str(input.abbreviation),
    logo: str(input.logo),
    color: str(input.color),
    score: num(input.score),
    isWinner: Boolean(input.isWinner),
    squad: Object.freeze(squad),
  })
}

export function createScoreEvent(input = {}) {
  return Object.freeze({
    minute: num(input.minute),
    type: str(input.type),
    side: SIDES.includes(input.side) ? input.side : '',
    player: Object.freeze({
      id: str(input.player?.id),
      name: str(input.player?.name),
      shortName: str(input.player?.shortName) || str(input.player?.name),
    }),
    homeScore: num(input.homeScore),
    awayScore: num(input.awayScore),
  })
}

export function createMatch(input = {}) {
  return Object.freeze({
    id: str(input.id),
    source: str(input.source) || 'manual',
    competition: Object.freeze({
      id: str(input.competition?.id),
      name: str(input.competition?.name),
      abbreviation: str(input.competition?.abbreviation),
    }),
    season: Object.freeze({
      year: num(input.season?.year),
      display: str(input.season?.display),
    }),
    round: str(input.round),
    kickoff: str(input.kickoff),
    status: str(input.status) || MATCH_STATUS.SCHEDULED,
    statusDetail: str(input.statusDetail),
    venue: Object.freeze({
      name: str(input.venue?.name),
      city: str(input.venue?.city),
      attendance: num(input.venue?.attendance),
    }),
    home: createTeam(input.home),
    away: createTeam(input.away),
    timeline: Object.freeze((input.timeline || []).map(createScoreEvent)),
  })
}

export function createTableRow(input = {}) {
  return Object.freeze({
    rank: num(input.rank),
    team: Object.freeze({
      id: str(input.team?.id),
      name: str(input.team?.name),
      shortName: str(input.team?.shortName) || str(input.team?.name),
      abbreviation: str(input.team?.abbreviation),
      logo: str(input.team?.logo),
    }),
    played: num(input.played),
    won: num(input.won),
    drawn: num(input.drawn),
    lost: num(input.lost),
    pointsFor: num(input.pointsFor),
    pointsAgainst: num(input.pointsAgainst),
    pointsDifference: num(input.pointsDifference),
    triesFor: num(input.triesFor),
    bonusPoints: num(input.bonusPoints),
    points: num(input.points),
    form: str(input.form),
  })
}

export function createTable(input = {}) {
  return Object.freeze({
    // A pool table is not a competition table: the Champions Cup files hold one
    // pool of six from twenty-four teams, so a graphic must not title it
    // "Standings" as though it were the whole competition.
    partial: Boolean(input.partial),
    competition: Object.freeze({
      id: str(input.competition?.id),
      name: str(input.competition?.name),
      abbreviation: str(input.competition?.abbreviation),
    }),
    season: Object.freeze({
      year: num(input.season?.year),
      display: str(input.season?.display),
    }),
    rows: Object.freeze((input.rows || []).map(createTableRow)),
  })
}

/**
 * Validate a match well enough to render it. Returns a list of human-readable
 * problems — empty means renderable. Callers decide whether to warn or block.
 */
export function validateMatch(match) {
  const problems = []
  if (!match || typeof match !== 'object') return ['Match is missing.']
  if (!match.home?.name) problems.push('Home team has no name.')
  if (!match.away?.name) problems.push('Away team has no name.')
  if (match.status === MATCH_STATUS.FINAL) {
    if (match.home?.score === null) problems.push('Final match has no home score.')
    if (match.away?.score === null) problems.push('Final match has no away score.')
  }
  for (const side of SIDES) {
    const squad = match[side]?.squad || []
    if (squad.length > MATCHDAY_SQUAD) {
      problems.push(`${match[side].name} has ${squad.length} players — a matchday squad is ${MATCHDAY_SQUAD}.`)
    }
  }
  return problems
}
