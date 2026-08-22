/**
 * Season-level analysis from a league table.
 *
 * Attack against defence, per game, is the one season chart the data supports
 * honestly across several competitions: points for and against are populated in
 * every table file, and rugby leagues genuinely fan out along both axes.
 *
 * It is NOT valid everywhere. A cup "table" is one pool of four games, and a
 * conference table merges two groups, so `canPlotSeason` gates on both.
 */

/** Below this, a per-game rate is noise rather than a season's shape. */
export const MIN_GAMES_FOR_SEASON = 8

/** Fewer teams than this and there is no cloud to read. */
export const MIN_TEAMS_FOR_SEASON = 6

export const QUADRANTS = Object.freeze({
  ELITE: 'elite',
  ATTACKING: 'attacking',
  DEFENSIVE: 'defensive',
  STRUGGLING: 'struggling',
})

/**
 * Can this table honestly support a season scatter?
 * Returns a reason string when it cannot, so the UI can say why.
 */
export function canPlotSeason(table) {
  if (!table || !table.rows?.length) return 'No table loaded.'
  if (table.partial) {
    return 'That table is a single pool, not the whole competition, so a season plot would mislead.'
  }
  // Worded so it does not read as "come back later". A Six Nations is five
  // games and four teams short by design - waiting will not change it, and
  // the old wording implied it would.
  if (table.rows.length < MIN_TEAMS_FOR_SEASON) {
    return `Only ${table.rows.length} teams in this competition - a season plot `
      + 'needs a league, not a tournament pool.'
  }
  const fewest = Math.min(...table.rows.map((row) => row.played ?? 0))
  if (fewest < MIN_GAMES_FOR_SEASON) {
    return `Just ${fewest} games each here - a per-game rate needs a longer `
      + 'league season than this competition plays.'
  }
  if (table.rows.some((row) => row.pointsFor === null || row.pointsAgainst === null)) {
    return 'That table has no points for/against.'
  }
  return ''
}

const mean = (values) => (values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : 0)

function quadrantOf(attack, defence, averages) {
  const scoresMore = attack >= averages.attack
  const concedesLess = defence <= averages.defence
  if (scoresMore && concedesLess) return QUADRANTS.ELITE
  if (scoresMore) return QUADRANTS.ATTACKING
  if (concedesLess) return QUADRANTS.DEFENSIVE
  return QUADRANTS.STRUGGLING
}

/**
 * Per-game attack and defence for every team, plus the league averages the
 * quadrants are drawn against.
 */
export function seasonProfile(table) {
  const rows = (table?.rows || []).filter((row) => (row.played ?? 0) > 0)

  const teams = rows.map((row) => ({
    team: row.team,
    rank: row.rank,
    played: row.played,
    points: row.points,
    attack: row.pointsFor / row.played,
    defence: row.pointsAgainst / row.played,
    triesPerGame: row.triesFor === null ? null : row.triesFor / row.played,
    pointsDifference: row.pointsDifference,
  }))

  const averages = {
    attack: mean(teams.map((t) => t.attack)),
    defence: mean(teams.map((t) => t.defence)),
  }

  return {
    competition: table?.competition || {},
    season: table?.season || {},
    averages,
    teams: teams.map((team) => ({
      ...team,
      quadrant: quadrantOf(team.attack, team.defence, averages),
    })),
  }
}

/** Axis bounds with a little breathing room, never a zero-width range. */
export function seasonBounds(profile, padding = 0.12) {
  const attacks = profile.teams.map((t) => t.attack)
  const defences = profile.teams.map((t) => t.defence)

  const span = (values) => {
    const low = Math.min(...values)
    const high = Math.max(...values)
    const range = Math.max(high - low, 1)
    return { low: low - range * padding, high: high + range * padding }
  }

  return { attack: span(attacks), defence: span(defences) }
}

/**
 * The one line worth putting at the top of an attack-v-defence chart.
 *
 * Uses BOTH axes, so the headline is the chart's own claim rather than a side
 * fact. Measured across every drawable table, the leader's attack-minus-
 * defence runs 8.9 to 18.9 points a game - no season produces a mundane one.
 *
 * The tiebreak is not decorative, and it compares to a TOLERANCE rather than
 * exactly: URC 2026's two leading clubs are 8.8888888888888893 and
 * 8.8888888888888857 - a difference of 3.6e-15, which is division noise and
 * not a lead. Compared exactly the first key never returns zero, so the rule
 * never ran and the club was picked by the last bit of a float.
 */
const TIED = 1e-9

/** Ordered comparison that treats a difference below the tolerance as a tie. */
const by = (value) => (a, b) => {
  const difference = value(a) - value(b)
  return Math.abs(difference) < TIED ? 0 : difference
}

export function seasonHeadline(table) {
  const profile = seasonProfile(table)
  const best = [...profile.teams].sort((a, b) => by((team) => team.defence - team.attack)(a, b)
    || by((team) => -team.attack)(a, b)
    || by((team) => team.defence)(a, b)
    || (a.rank ?? 99) - (b.rank ?? 99))[0]
  if (!best) return ''
  const name = best.team?.shortName || best.team?.name || ''
  return `${name} scored ${Math.round(best.attack)}, conceded ${Math.round(best.defence)}`
}

/**
 * The teams worth naming in a caption: the best attack, the best defence, and
 * the most extreme team in the weakest quadrant.
 */
export function seasonHighlights(profile) {
  if (!profile.teams.length) return {}
  const byAttack = [...profile.teams].sort((a, b) => b.attack - a.attack)
  const byDefence = [...profile.teams].sort((a, b) => a.defence - b.defence)
  const struggling = profile.teams
    .filter((t) => t.quadrant === QUADRANTS.STRUGGLING)
    .sort((a, b) => (a.attack - a.defence) - (b.attack - b.defence))

  return {
    bestAttack: byAttack[0],
    bestDefence: byDefence[0],
    worst: struggling[0] || null,
  }
}
