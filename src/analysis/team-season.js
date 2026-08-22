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

/** The teams in a season file that have a usable match list. */
export function teamsWithTimeline(season) {
  return (season?.teams || [])
    .filter((entry) => (entry.matches || []).length >= MIN_MATCHES_FOR_TEAM_SEASON)
    .map((entry) => entry.team)
}

const entryFor = (season, teamName) =>
  (season?.teams || []).find((entry) => entry.team?.name === teamName) || null

/** That team's row in the official league table, if we hold one. */
const tableRowFor = (table, teamName) =>
  (table?.rows || []).find((row) => row.team?.name === teamName) || null

/**
 * Can this team's season be drawn honestly?
 * Returns a reason string when it cannot, so the UI can say why.
 *
 * The league table is the cross-check. The archive holds one Gallagher
 * Premiership fixture fewer than the table records for Saracens, and a
 * timeline missing a match it does not know is missing is exactly the silent
 * gap this graphic must never draw.
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

  const row = tableRowFor(table, teamName)
  if (row && Number.isFinite(row.played) && row.played > played) {
    return `Only ${played} of that team's ${row.played} matches are in the archive, `
      + 'so the season would have a gap in it.'
  }
  return ''
}

/**
 * How the drawn record relates to the league table's.
 *
 * A club's own timeline covers every match it played; a league table covers
 * the regular season. Northampton's 2026 timeline is 20 played to the table's
 * 18. Both are true, and posted side by side without a word they read as an
 * error - so the graphic says which it is showing.
 */
export function seasonScope(timeline, table) {
  const played = timeline?.matches?.length ?? 0
  const row = tableRowFor(table, timeline?.team?.name)
  if (!row || !Number.isFinite(row.played) || played <= row.played) return ''
  return 'INCLUDING PLAY-OFFS'
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
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
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
