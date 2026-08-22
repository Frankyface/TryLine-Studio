/**
 * One club's season, match by match.
 *
 * The league-wide charts (attack v defence, home advantage) answer questions
 * about a competition. A club posting to its own followers wants the opposite:
 * its own season, in order, with the results its supporters actually watched.
 *
 * Everything here comes from final scores alone. No league points, no bonus
 * points: rugby's bonus-point rules vary by competition and depend on try
 * counts the archive does not carry for every match, so a computed table would
 * contradict the official one. A margin is just a subtraction and is always
 * right.
 */

/** Below this a "season" is a handful of fixtures, not a story. */
export const MIN_MATCHES_FOR_TEAM_SEASON = 6

export const RESULTS = Object.freeze({ WIN: 'W', DRAW: 'D', LOSS: 'L' })

const resultOf = (own, other) => {
  if (own > other) return RESULTS.WIN
  if (own < other) return RESULTS.LOSS
  return RESULTS.DRAW
}

/**
 * The teams whose season can actually be drawn.
 *
 * Asks the same question the gate asks, rather than a looser one of its own.
 * Filtering only on match count offered 16 URC clubs of which 7 drew, and left
 * the app opening on a club it immediately refused - the user had to hunt
 * through the list to find one that worked.
 */
export function teamsWithTimeline(season, { table } = {}) {
  return (season?.teams || [])
    .filter((entry) => canPlotTeamSeason(season, entry.team?.name, { table }) === '')
    .map((entry) => entry.team)
}

const entryFor = (season, teamName) =>
  (season?.teams || []).find((entry) => entry.team?.name === teamName) || null

/**
 * That team's row in the official league table, if we hold one.
 *
 * Matched on a normalised name: an exact-string compare fails OPEN - a
 * feed-side rename or a case change would silently turn a stated gap into an
 * unstated one, which is the failure this whole check exists to prevent.
 */
const normalise = (name) => String(name || '').trim().toLowerCase()
const tableRowFor = (table, teamName) => {
  const key = normalise(teamName)
  if (!key) return null
  return (table?.rows || []).find((row) => normalise(row.team?.name) === key) || null
}

/**
 * Can this team's season be drawn at all?
 * Returns a reason string when it cannot, so the UI can say why.
 *
 * This refuses only what cannot be drawn honestly under any label: no team, too
 * few matches, or a match with no score. An archive that is merely SHORT still
 * draws - seasonScope states the gap on the graphic instead, because refusing
 * cost 10 of 14 Top 14 clubs and 9 of 16 in the URC.
 */
export function canPlotTeamSeason(season, teamName, { table } = {}) {
  if (!season || !season.teams?.length) return 'No season data for that competition.'
  if (!teamName) return 'Pick a team to draw.'

  const entry = entryFor(season, teamName)
  if (!entry) return 'That team has no record in this season.'

  const played = (entry.matches || []).length
  if (played < MIN_MATCHES_FOR_TEAM_SEASON) {
    return `Only ${played} matches recorded for that team - too few to plot a season.`
  }
  // A match with no score is not a nil-all draw. Left to reach the chart it
  // draws as one, which is a fabricated result rather than a missing number.
  if ((entry.matches || []).some((match) => !Number.isFinite(match.for) || !Number.isFinite(match.against))) {
    return 'Some matches for that team have no score recorded, so the season would invent results.'
  }
  return ''
}

/**
 * What the archive holds against what the season actually contained.
 *
 * Two sources, because neither is always there: the official league table, and
 * the count of fixtures the competition itself lists (which is the only one
 * Major League Rugby has). The larger wins - a team that reached a final has
 * more fixtures than the table's regular-season count, and a team the archive
 * is short of has fewer matches than either.
 */
export function seasonCoverage(timeline, table) {
  const recorded = timeline?.matches?.length ?? 0
  const row = tableRowFor(table, timeline?.team?.name)
  const fromTable = row && Number.isFinite(row.played) ? row.played : 0
  const fromFixtures = Number.isFinite(timeline?.fixtures) ? timeline.fixtures : 0
  const expected = Math.max(fromTable, fromFixtures, recorded)
  return { recorded, expected, tablePlayed: fromTable }
}

/**
 * The one line that stops the chart being read as something it is not.
 *
 * A club's own timeline covers every match it played; a league table covers
 * the regular season. Northampton's 2026 timeline is 20 played to the table's
 * 18, and side by side without a word they read as an error.
 *
 * The archive is also short sometimes - ESPN simply does not hold 10 of the
 * Top 14's results, and Major League Rugby is several fixtures light. Refusing
 * those outright cost 10 of 14 Top 14 clubs and 9 of 16 in the URC, which is
 * most of two leagues. A gap that is STATED is not misleading; only a silent
 * one is. So the chart draws and says what it is missing.
 */
export function seasonScope(timeline, table) {
  const { recorded, expected, tablePlayed } = seasonCoverage(timeline, table)
  if (expected > recorded) return `${recorded} OF ${expected} MATCHES RECORDED`
  if (tablePlayed && recorded > tablePlayed) return 'INCLUDING PLAY-OFFS'
  return ''
}

/**
 * The team's matches in date order, each with its margin and the running
 * points difference after it.
 */
export function teamSeasonTimeline(season, teamName) {
  const entry = entryFor(season, teamName)
  if (!entry) return null

  let running = 0
  const matches = [...(entry.matches || [])]
    .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)))
    .map((match) => {
      const margin = match.for - match.against
      running += margin
      return {
        date: match.date,
        opponent: match.opponent,
        venue: match.venue,
        for: match.for,
        against: match.against,
        margin,
        running,
        result: resultOf(match.for, match.against),
      }
    })

  return {
    competition: season.competition || {},
    season: season.season || {},
    team: entry.team,
    // What the competition lists for this team, so the chart can say what it
    // is missing even where there is no league table to ask.
    fixtures: Number.isFinite(entry.fixtures) ? entry.fixtures : matches.length,
    matches,
  }
}

/** Longest unbroken run of `result` anywhere in the sequence. */
function longestRun(matches, result) {
  let best = 0
  let current = 0
  for (const match of matches) {
    current = match.result === result ? current + 1 : 0
    if (current > best) best = current
  }
  return best
}

/**
 * The numbers worth putting in a caption: the record, the two extreme results
 * and the best run. `null` where there is nothing to say rather than a zero
 * that reads like a real measurement.
 */
export function teamSeasonHeadline(timeline) {
  const matches = timeline?.matches || []
  if (!matches.length) {
    return {
      played: 0, won: 0, drawn: 0, lost: 0,
      pointsFor: 0, pointsAgainst: 0, difference: 0,
      biggestWin: null, biggestLoss: null, longestWinStreak: 0,
    }
  }

  const wins = matches.filter((m) => m.result === RESULTS.WIN)
  const losses = matches.filter((m) => m.result === RESULTS.LOSS)
  const byMargin = (a, b) => b.margin - a.margin

  return {
    played: matches.length,
    won: wins.length,
    drawn: matches.filter((m) => m.result === RESULTS.DRAW).length,
    lost: losses.length,
    pointsFor: matches.reduce((total, m) => total + m.for, 0),
    pointsAgainst: matches.reduce((total, m) => total + m.against, 0),
    difference: matches[matches.length - 1].running,
    biggestWin: wins.length ? [...wins].sort(byMargin)[0] : null,
    biggestLoss: losses.length ? [...losses].sort(byMargin).at(-1) : null,
    longestWinStreak: longestRun(matches, RESULTS.WIN),
  }
}

/**
 * The margin range to draw, always including zero.
 *
 * What has to hold is that ONE scale covers both directions: a win by 20 and a
 * defeat by 20 must draw the same length, or the chart flatters one side. That
 * does not require the zero line to sit in the middle - forcing it there left
 * a club that lost almost every match with the top half of its chart empty,
 * because the scale was stretched to a winning margin it never achieved.
 *
 * So the span is the real one and the zero line floats within it.
 */
export function marginBounds(timeline, { minimum = 10 } = {}) {
  const margins = (timeline?.matches || []).map((m) => m.margin)
  const high = Math.max(0, ...margins)
  const low = Math.min(0, ...margins)

  // A season of nothing but draws would otherwise be a zero-height axis.
  if (high - low < minimum) {
    const pad = (minimum - (high - low)) / 2
    return { low: low - pad, high: high + pad }
  }
  return { low, high }
}
