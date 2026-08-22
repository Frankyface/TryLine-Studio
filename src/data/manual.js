/**
 * Manual entry - the path for club and amateur rugby, where no API exists.
 *
 * Produces exactly the same Match objects the ESPN adapter does, so every
 * graphic works identically whether the data came from a pro feed or from
 * someone typing out Saturday's team sheet.
 */
import {
  MATCH_STATUS, SCORE_EVENTS, STARTING_XV, MATCHDAY_SQUAD, POSITION_NAMES,
  createMatch, createTable,
} from './schema.js'

/** Shirt-number to position code, used when a manual sheet omits positions. */
const POSITION_CODES = Object.freeze([
  'LHP', 'HK', 'THP', 'LK', 'LK', 'BF', 'OF', 'N8',
  'SH', 'FH', 'LW', 'IC', 'OC', 'RW', 'FB',
])

export const positionForJersey = (jersey) =>
  (jersey >= 1 && jersey <= STARTING_XV ? POSITION_CODES[jersey - 1] : '')

export const positionNameForJersey = (jersey) =>
  (jersey >= 1 && jersey <= STARTING_XV ? POSITION_NAMES[jersey - 1] : 'Replacement')

/**
 * Parse a pasted squad list. One player per line, in shirt order:
 *   "1 Jonny Smith"        - explicit number
 *   "Jonny Smith"          - number inferred from position in the list
 *   "10 Jonny Smith (c)"   - captain
 * Blank lines are skipped so a sheet copied out of an email still works.
 */
export function parseSquadText(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean)

  return lines.slice(0, MATCHDAY_SQUAD).map((line, index) => {
    const numbered = line.match(/^(\d{1,2})[.)\s]+(.*)$/)
    const jersey = numbered ? Number(numbered[1]) : index + 1
    let name = (numbered ? numbered[2] : line).trim()

    const isCaptain = /\((c|capt|captain)\)/i.test(name)
    name = name.replace(/\((c|capt|captain)\)/i, '').trim()

    return {
      id: `manual-${jersey}-${index}`,
      name,
      shortName: name,
      jersey,
      position: positionForJersey(jersey),
      isStarter: jersey <= STARTING_XV,
      isCaptain,
      stats: {},
    }
  })
}

/** Parse "12 J Smith, 34 A Jones" style scorer notes into timeline events. */
export function parseScorersText(text, side, type = SCORE_EVENTS.TRY) {
  return String(text || '')
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const withMinute = entry.match(/^(.*?)[\s-]+(\d{1,3})'?$/) || entry.match(/^(\d{1,3})'?\s+(.*)$/)
      const name = withMinute ? (withMinute[2].match(/^\d+$/) ? withMinute[1] : withMinute[2]) : entry
      const minute = withMinute
        ? Number(withMinute[2].match(/^\d+$/) ? withMinute[2] : withMinute[1])
        : null
      return { minute, type, side, player: { name: name.trim(), shortName: name.trim() } }
    })
}

/**
 * The kinds of score a club can enter besides a try, and the words they are
 * likely to type. Order matters: the longest alias has to match first, or
 * "pen try" is read as a penalty.
 */
const SCORE_ALIASES = Object.freeze([
  [SCORE_EVENTS.PENALTY_TRY, ['penalty try', 'pen try', 'pt']],
  [SCORE_EVENTS.DROP_GOAL, ['drop goal', 'dropgoal', 'drop', 'dg', 'd']],
  [SCORE_EVENTS.CONVERSION, ['conversion', 'convert', 'con', 'c']],
  [SCORE_EVENTS.PENALTY, ['penalty', 'pen', 'p']],
])

/**
 * Kicks and other scores, so a club's timeline can add up to its own score.
 *
 * Tries alone never reconcile - a 34-22 match is not a whole number of
 * five-point tries - and a win-probability curve is refused unless the
 * timeline reaches the final score. This is the field that lets a club get
 * one.
 *
 * Accepts "P 20", "pen 20", "C 13", "DG 60", "penalty try 44", in any order,
 * comma or newline separated, minute first or last.
 */
export function parseScoreEventsText(text, side) {
  return String(text || '')
    .split(/[,\n]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const minuteMatch = entry.match(/(\d{1,3})/)
      const minute = minuteMatch ? Number(minuteMatch[1]) : null
      const words = entry.replace(/\d+'?/g, ' ').replace(/\s+/g, ' ').trim()

      const found = SCORE_ALIASES.find(([, aliases]) => aliases.includes(words))
      if (!found || minute === null) return null
      return { minute, type: found[0], side, player: null }
    })
    .filter(Boolean)
}

/** Club suffixes that carry no identity in a three-letter badge. */
const CLUB_SUFFIXES = new Set(['RFC', 'RUFC', 'RC', 'FC', 'CLUB'])

/**
 * A short badge label: initials for a multi-word club ("Old Boys RFC" -> "OB"),
 * the opening letters for a single-word one ("Bath" -> "BATH").
 */
export function abbreviate(name) {
  const words = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !CLUB_SUFFIXES.has(word.toUpperCase().replace(/[^A-Z]/g, '')))
  if (!words.length) return ''
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase()
  return words.map((word) => word[0]).join('').slice(0, 3).toUpperCase()
}

const teamFromForm = (input = {}) => ({
  id: input.id || '',
  name: input.name || '',
  shortName: input.shortName || input.name || '',
  abbreviation: input.abbreviation || abbreviate(input.name),
  logo: input.logo || '',
  color: input.color || '',
  score: input.score === '' || input.score === undefined ? null : Number(input.score),
  squad: input.squad || [],
})

/**
 * Build a Match from the manual entry form. Scores decide the status unless one
 * is given explicitly, so a filled-in scoreline renders as a result and an empty
 * one renders as a fixture.
 */
export function buildManualMatch(form = {}) {
  const home = teamFromForm(form.home)
  const away = teamFromForm(form.away)
  const hasScores = home.score !== null && away.score !== null && !Number.isNaN(home.score)

  const timeline = [
    ...parseScorersText(form.homeTries, 'home', SCORE_EVENTS.TRY),
    ...parseScorersText(form.awayTries, 'away', SCORE_EVENTS.TRY),
    ...parseScoreEventsText(form.homeScores, 'home'),
    ...parseScoreEventsText(form.awayScores, 'away'),
  ].sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))

  return createMatch({
    id: form.id || 'manual',
    source: 'manual',
    competition: { name: form.competition || '', abbreviation: form.competitionShort || '' },
    season: { display: form.season || '' },
    round: form.round || '',
    kickoff: form.kickoff || '',
    status: form.status || (hasScores ? MATCH_STATUS.FINAL : MATCH_STATUS.SCHEDULED),
    venue: { name: form.venue || '', city: form.city || '' },
    home: {
      ...home,
      isWinner: hasScores && home.score > away.score,
    },
    away: {
      ...away,
      isWinner: hasScores && away.score > home.score,
    },
    timeline,
  })
}

/**
 * Parse a pasted league table. One row per line, whitespace or comma separated:
 *   "Team, P, W, D, L, PF, PA, BP, PTS"
 * Points difference is computed when it is not supplied.
 */
export function parseTableText(text, { competition = '', season = '' } = {}) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean)

  const rows = lines.map((line, index) => {
    const parts = line.split(/[,\t]|\s{2,}/).map((part) => part.trim()).filter(Boolean)
    const name = parts[0] || `Team ${index + 1}`
    const numbers = parts.slice(1).map((value) => {
      const parsed = Number(String(value).replace('+', ''))
      return Number.isFinite(parsed) ? parsed : null
    })
    const [played, won, drawn, lost, pointsFor, pointsAgainst, bonusPoints, points] = numbers

    return {
      rank: index + 1,
      team: { name, shortName: name, abbreviation: abbreviate(name) },
      played: played ?? null,
      won: won ?? null,
      drawn: drawn ?? null,
      lost: lost ?? null,
      pointsFor: pointsFor ?? null,
      pointsAgainst: pointsAgainst ?? null,
      pointsDifference: pointsFor !== null && pointsFor !== undefined
        && pointsAgainst !== null && pointsAgainst !== undefined
        ? pointsFor - pointsAgainst
        : null,
      triesFor: null,
      bonusPoints: bonusPoints ?? null,
      points: points ?? null,
      form: '',
    }
  })

  return createTable({ competition: { name: competition }, season: { display: season }, rows })
}
