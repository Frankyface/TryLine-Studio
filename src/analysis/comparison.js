/**
 * Head-to-head comparison: two teams, or two players.
 *
 * Team figures are built by aggregating the squad's individual stat lines,
 * because ESPN's rugby feed has no team-level statistics block - `boxscore.teams`
 * carries only an empty `general` entry.
 *
 * Aggregation is per-stat, not one-size-fits-all. Counting stats (metres,
 * tackles) sum. Rates do NOT: adding four players' kick success of 80% each
 * would report 320%, so rates are averaged over the players who actually
 * attempted the thing.
 */

export const AGGREGATE = Object.freeze({
  SUM: 'sum',
  MEAN_OF_ACTIVE: 'meanOfActive',
  DERIVED: 'derived',
})

export const BETTER = Object.freeze({
  HIGHER: 'higher',
  LOWER: 'lower',
})

/**
 * The stats a comparison can show, with how each one aggregates and which
 * direction is good. `betterWhen: LOWER` matters for discipline stats - a team
 * with fewer missed tackles is the one winning that row.
 *
 * Measured over the 53 matches that carry player stats:
 *  - `defendersBeaten` for one side equals the other side's `missedTackles` in
 *    99.1% of matches. They are one event counted from both ends, so a card
 *    must not show both or two rows become mirror images.
 *  - `redCards` and `dropGoalsConverted` are 0-0 in 96%+ of matches; never put
 *    them on a fixed row.
 *  - `cleanBreaks` and `offload` are fine per team but read 0-0 in ~half of
 *    like-for-like player pairings, so they stay off the player card.
 */
export const COMPARISON_STATS = Object.freeze({
  metres: { label: 'Metres made', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  runs: { label: 'Carries', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  tackles: { label: 'Tackles', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  cleanBreaks: { label: 'Clean breaks', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  defendersBeaten: { label: 'Defenders beaten', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  offload: { label: 'Offloads', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  passes: { label: 'Passes', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  tries: { label: 'Tries', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  points: { label: 'Points', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  tryAssists: { label: 'Try assists', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  rucksWon: { label: 'Rucks won', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  lineoutsWon: { label: 'Lineouts won', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  maulsWon: { label: 'Mauls won', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  kicksFromHand: { label: 'Kicks from hand', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
  missedTackles: { label: 'Missed tackles', aggregate: AGGREGATE.SUM, betterWhen: BETTER.LOWER },
  turnoversConceded: { label: 'Turnovers', aggregate: AGGREGATE.SUM, betterWhen: BETTER.LOWER },
  penaltiesConceded: { label: 'Pens conceded', aggregate: AGGREGATE.SUM, betterWhen: BETTER.LOWER },
  kickPercentSuccess: {
    label: 'Kick success',
    aggregate: AGGREGATE.MEAN_OF_ACTIVE,
    betterWhen: BETTER.HIGHER,
    unit: 'percent',
  },
  // Derived rows carry more meaning than the raw counts they come from, and
  // both are defined for every match in the dataset.
  tackleSuccess: {
    label: 'Tackle success',
    aggregate: AGGREGATE.DERIVED,
    betterWhen: BETTER.HIGHER,
    unit: 'percent',
    derive: (stats) => {
      const made = stats.tackles
      const missed = stats.missedTackles
      if (!Number.isFinite(made) || !Number.isFinite(missed)) return null
      const attempts = made + missed
      return attempts > 0 ? made / attempts : null
    },
  },
  lineoutSuccess: {
    label: 'Lineout success',
    aggregate: AGGREGATE.DERIVED,
    betterWhen: BETTER.HIGHER,
    unit: 'percent',
    derive: (stats) => {
      const won = stats.lineoutsWon
      const total = stats.totalLineouts
      if (!Number.isFinite(won) || !Number.isFinite(total) || total <= 0) return null
      return won / total
    },
  },
  totalLineouts: { label: 'Lineouts thrown', aggregate: AGGREGATE.SUM, betterWhen: BETTER.HIGHER },
})

/** Default rows for a team comparison - the shape of a broadcast match-stats card. */
export const TEAM_STAT_KEYS = Object.freeze([
  'metres', 'runs', 'cleanBreaks', 'passes', 'rucksWon', 'tackles', 'tackleSuccess', 'turnoversConceded',
])

/** Default rows for a player comparison. */
export const PLAYER_STAT_KEYS = Object.freeze([
  'runs', 'metres', 'tackles', 'rucksWon', 'passes', 'missedTackles',
])

const definitionFor = (key) => COMPARISON_STATS[key] || {
  label: key,
  aggregate: AGGREGATE.SUM,
  betterWhen: BETTER.HIGHER,
}

/**
 * Aggregate one stat across a squad.
 * Returns null when nobody recorded the stat, so a missing value can be drawn
 * as "-" rather than a misleading zero.
 */
export function aggregateStat(squad = [], key) {
  const definition = definitionFor(key)
  if (definition.aggregate === AGGREGATE.DERIVED) return null
  const values = squad
    .map((player) => player?.stats?.[key])
    .filter((value) => value !== undefined && value !== null && Number.isFinite(value))

  if (!values.length) return null

  if (definition.aggregate === AGGREGATE.MEAN_OF_ACTIVE) {
    // Average only over players who attempted it - a squad of 23 where two
    // players kicked should not have their success rate divided by 23.
    const active = values.filter((value) => value > 0)
    if (!active.length) return null
    return active.reduce((total, value) => total + value, 0) / active.length
  }

  return values.reduce((total, value) => total + value, 0)
}

/**
 * Add the derived stats to a set of raw ones. Applied to both team aggregates
 * and individual player lines, so a rate means the same thing on either card.
 */
export function withDerivedStats(stats = {}) {
  const derived = {}
  for (const [key, definition] of Object.entries(COMPARISON_STATS)) {
    if (definition.aggregate !== AGGREGATE.DERIVED) continue
    derived[key] = definition.derive({ ...stats, ...derived })
  }
  return { ...stats, ...derived }
}

/** Every comparison stat for one squad, as a plain object. */
export function aggregateSquad(squad = []) {
  const raw = Object.fromEntries(
    Object.entries(COMPARISON_STATS)
      .filter(([, definition]) => definition.aggregate !== AGGREGATE.DERIVED)
      .map(([key]) => [key, aggregateStat(squad, key)]),
  )
  return withDerivedStats(raw)
}

/**
 * Smallest bar that still reads as a bar rather than an absent one.
 * A real value must never draw nothing: on a "fewer is better" row where the
 * winner recorded 0, the loser's proportional bar collapses to zero width, so
 * 5 missed tackles drew an empty track next to a full one for 0. That happened
 * on 565 rows of the real data, on a default player-card stat.
 */
const MIN_VISIBLE_BAR = 0.12

/** Bar length for `value` relative to the larger of the pair, 0-1. */
function barShare(value, other) {
  // A missing value has no bar at all - that is different from a value of zero.
  if (value === null || value === undefined) return 0
  const largest = Math.max(value, other ?? 0)
  if (largest <= 0) return 0
  return value / largest
}

/**
 * Bar for a side, floored so a real number is never drawn as nothing.
 *
 * The zero case depends on direction. On a normal row, zero tries genuinely
 * means no bar. On a "fewer is better" row zero is the BEST possible score, so
 * treating it as nothing left the winner blank next to the loser's stub -
 * and 42% of players record zero missed tackles, a default row.
 */
function visibleBar(value, share, betterWhen) {
  if (value === null || value === undefined) return 0
  if (value === 0 && betterWhen !== BETTER.LOWER) return 0
  return Math.max(MIN_VISIBLE_BAR, share)
}

/** Which side wins a row, honouring stats where lower is better. */
function leaderOf(left, right, betterWhen) {
  if (left === null || right === null || left === right) return null
  const leftWins = betterWhen === BETTER.LOWER ? left < right : left > right
  return leftWins ? 'left' : 'right'
}

/**
 * Build comparison rows from two stat sources.
 * `bar` is each side's share of the row, for drawing proportional bars; when
 * both are zero the bar is split evenly rather than dividing by zero.
 */
export function buildComparison(leftStats, rightStats, keys) {
  return keys.map((key) => {
    const definition = definitionFor(key)
    const left = leftStats?.[key] ?? null
    const right = rightStats?.[key] ?? null

    return {
      key,
      label: definition.label,
      unit: definition.unit || 'count',
      betterWhen: definition.betterWhen,
      left,
      right,
      // Bars are scaled so the larger value fills its track. Share-of-total
      // would cap the winning bar at its percentage - 588 vs 388 would draw at
      // 60% of the space and read as timid.
      //
      // On a "fewer is better" row the bars are SWAPPED, so the longer bar
      // always belongs to the side winning that row. Drawing 18 turnovers as a
      // full bar and 11 as a stub read as an emphatic win for the side that
      // actually lost it. The values themselves are printed unchanged.
      leftBar: visibleBar(left, definition.betterWhen === BETTER.LOWER
        ? barShare(right, left) : barShare(left, right), definition.betterWhen),
      rightBar: visibleBar(right, definition.betterWhen === BETTER.LOWER
        ? barShare(left, right) : barShare(right, left), definition.betterWhen),
      leader: leaderOf(left, right, definition.betterWhen),
    }
  })
}

/** Team versus team, aggregated from both squads. */
export function compareTeams(match, keys = TEAM_STAT_KEYS) {
  return buildComparison(
    aggregateSquad(match?.home?.squad || []),
    aggregateSquad(match?.away?.squad || []),
    keys,
  )
}

/** Player versus player, straight from their own stat lines. */
export function comparePlayers(left, right, keys = PLAYER_STAT_KEYS) {
  const lineOf = (player) => (player?.stats ? withDerivedStats(normaliseNulls(player.stats)) : {})
  return buildComparison(lineOf(left), lineOf(right), keys)
}

/** A player's absent stat is undefined; derivation needs an explicit null. */
const normaliseNulls = (stats) => Object.fromEntries(
  Object.keys(COMPARISON_STATS).map((key) => [key, stats[key] ?? null]),
)

/** Can this match support a team comparison at all? */
export const hasComparableSquads = (match) =>
  Boolean(match?.home?.squad?.length && match?.away?.squad?.length)

/** Format a comparison value for display. */
export function formatComparisonValue(row) {
  if (row.left === null && row.right === null) return { left: '-', right: '-' }
  const format = (value) => {
    if (value === null) return '-'
    if (row.unit === 'percent') return `${Math.round(value * 100)}%`
    return String(Math.round(value))
  }
  return { left: format(row.left), right: format(row.right) }
}
