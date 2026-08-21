/**
 * Home advantage, team by team.
 *
 * Rugby's home advantage is large and unevenly distributed: across the leagues
 * in this dataset the home side wins 58-73% of the time, and within a league
 * one club can be near-unbeatable at home and hopeless away while another is
 * barely affected. That spread is the story.
 *
 * The season files this reads are built by scripts/build-season-stats.mjs,
 * which only writes a season where every team has a real sample at both venues.
 */

/** Fewest teams worth drawing a league-wide comparison for. */
export const MIN_TEAMS_FOR_FORTRESS = 6

export function canPlotFortress(season) {
  if (!season || !season.teams?.length) return 'No season data for that competition.'
  // Count what the chart can actually draw, not what the file happens to hold.
  // Gating on season.teams while fortressRows drops teams with no rate let six
  // rate-less teams through to a zero-row chart: an Infinity row height and a
  // footer reading "top 0 of 6 - home sides win NaN%".
  const drawable = fortressRows(season).length
  if (drawable < MIN_TEAMS_FOR_FORTRESS) {
    return `Only ${drawable} teams have enough home and away games to compare.`
  }
  return ''
}

/**
 * Rows ready to draw, widest gap first, plus the league baseline.
 * `gap` is positive for a genuine fortress and negative for the rarer side that
 * travels better than it hosts.
 */
export function fortressRows(season, { limit } = {}) {
  const teams = (season?.teams || [])
    .filter((entry) => entry.homeWinRate !== null && entry.awayWinRate !== null)
    .map((entry) => ({
      team: entry.team,
      home: entry.homeWinRate,
      away: entry.awayWinRate,
      gap: entry.homeWinRate - entry.awayWinRate,
      homePlayed: entry.home.played,
      awayPlayed: entry.away.played,
    }))
    .sort((a, b) => b.gap - a.gap)

  return limit ? teams.slice(0, limit) : teams
}

/** The one or two teams worth naming in a caption. */
export function fortressHighlights(season) {
  const rows = fortressRows(season)
  if (!rows.length) return { strongest: null, reversed: null, leagueHomeWinRate: null }
  const strongest = rows[0]
  const reversed = rows[rows.length - 1]
  return {
    strongest,
    // Only call it out when a side genuinely travels better than it hosts.
    reversed: reversed.gap < 0 ? reversed : null,
    leagueHomeWinRate: season.leagueHomeWinRate ?? null,
  }
}

export const formatRate = (rate) => `${Math.round(rate * 100)}%`
