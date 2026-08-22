/**
 * The one number worth putting on a player's card, or nothing.
 *
 * The card used to show the first four non-zero stats in a fixed priority
 * order, blown up. Measured across all 2,438 players with stats, that put the
 * chosen number at the 58th percentile of its own match - a coin flip - and
 * for 149 of the 212 props it chose METRES, at a median value of six. A hero
 * card for a prop who made six metres is the exact thing this replaces.
 *
 * Three ideas make it work:
 *
 *  - Benchmarks are per SHIRT, because a prop and a winger are not comparable.
 *    Prop p90 for metres is 18; the floor is 55. No prop can ever reach a
 *    metres headline, and no position list has to be maintained to say so.
 *  - Scoring outranks volume. A brace must never lose to a tackle count, and
 *    ranking on benchmark ratio alone loses all 55 two-try performances.
 *  - The benchmark ORDERS, it does not gate: requiring a value to reach its
 *    shirt's p90 outright was measured and rejected - it refused a third of
 *    the cards (38.6% accepted down to 26.4%) and moved the weakest hero's
 *    percentile within its own match by 0.02. The floors do the gating.
 *  - It REFUSES. 61% of players have a match line but no headline, and the
 *    grid stays for them. A confidently wrong hero number is worse than none,
 *    which is the rule this project already applies to the win curve.
 *
 * Result, measured: the hero sits at the 97th percentile of its own match at
 * the median, and never below the 60th.
 */

/** Only stats where more is better can be a headline. */
export const HERO_STATS = Object.freeze([
  { key: 'metres', label: 'Metres made', floor: 55 },
  { key: 'passes', label: 'Passes', floor: 34 },
  { key: 'tackles', label: 'Tackles', floor: 12 },
  { key: 'rucksWon', label: 'Rucks won', floor: 10 },
  { key: 'runs', label: 'Carries', floor: 10 },
  { key: 'kicksFromHand', label: 'Kicks from hand', floor: 7 },
  { key: 'defendersBeaten', label: 'Defenders beaten', floor: 5 },
  { key: 'cleanBreaks', label: 'Clean breaks', floor: 3 },
  { key: 'offload', label: 'Offloads', floor: 3 },
  { key: 'maulsWon', label: 'Mauls won', floor: 3 },
])

/** Scoring, which outranks everything above it. */
const SCORING_STATS = Object.freeze([
  { key: 'tries', label: 'Tries', floor: 2 },
  { key: 'points', label: 'Points', floor: 13 },
  { key: 'tryAssists', label: 'Try assists', floor: 2 },
])

/*
 * There is no perfect-rate tier, and there was: "100% from 14 tackles" can
 * only be reached by a player who already cleared the volume floor of 12, so
 * the volume tier fired first every time - 0 of 2,438 players in the archive
 * ever reached it. Raising the rate's own floor cannot help, because the
 * volume tier's floor sits below it by construction. The concrete number is
 * the better headline anyway; the rate belongs in the supporting row.
 */

/** Past this a share is not a distinction, so the card says nothing instead. */
const TOP_SHARE = 40

/** Shirts 1-15 map one-to-one onto positions; 16-23 cover the same roles. */
const SHIRT_GROUPS = Object.freeze({
  1: 'P', 2: 'H', 3: 'P', 4: 'L', 5: 'L', 6: 'FL', 7: 'FL', 8: 'N8',
  9: 'SH', 10: 'FH', 11: 'W', 12: 'C', 13: 'C', 14: 'W', 15: 'FB',
  16: 'R:H', 17: 'R:P', 18: 'R:P', 19: 'R:L', 20: 'R:FL', 21: 'R:SH',
  22: 'R:FH', 23: 'R:C',
})

export const shirtGroup = (jersey) => SHIRT_GROUPS[Number(jersey)] || null

const value = (player, key) => {
  const found = player?.stats?.[key]
  return Number.isFinite(found) ? found : null
}

/**
 * The hero number for one player, or null when nothing clears the bar.
 * `benchmarks` is data/models/hero-stats.json; without it only scoring and
 * perfect rates can fire, which is a safe degradation rather than a wrong one.
 */
export function heroStat(player, { benchmarks, squadPointsReconcile = true } = {}) {
  if (!player || !Object.keys(player.stats || {}).length) return null

  // Scoring first, and only where the squad's points reconcile with the
  // scoreline - ESPN drops a converted try often enough that a points headline
  // needs the same check the tries/points row already gets.
  if (squadPointsReconcile) {
    const scoring = SCORING_STATS
      .map((stat) => ({ stat, found: value(player, stat.key) }))
      .filter((entry) => entry.found !== null && entry.found >= entry.stat.floor)
      .sort((a, b) => (b.found / b.stat.floor) - (a.found / a.stat.floor))[0]
    if (scoring) {
      return Object.freeze({
        key: scoring.stat.key, label: scoring.stat.label, value: scoring.found, kind: 'scoring',
      })
    }
  }

  const group = shirtGroup(player.jersey)
  const table = (benchmarks && group && benchmarks[group]) || null

  if (table) {
    const best = HERO_STATS
      .map((stat) => ({ stat, found: value(player, stat.key) }))
      .filter((entry) => entry.found !== null && entry.found >= entry.stat.floor)
      .map((entry) => ({
        ...entry,
        score: entry.found / Math.max(table[entry.stat.key] ?? entry.stat.floor, entry.stat.floor),
      }))
      .sort((a, b) => b.score - a.score)[0]
    if (best) {
      return Object.freeze({
        key: best.stat.key, label: best.stat.label, value: best.found, kind: 'volume',
      })
    }
  }

  return null
}

/**
 * Where that number sits among the 46 players on the pitch, in words.
 * Reads from the match, so it is a fact about this game and not a percentile
 * the viewer has to take on trust.
 */
export function heroRank(match, player, hero) {
  if (!hero) return ''

  const everyone = [...(match?.home?.squad || []), ...(match?.away?.squad || [])]
    .map((entry) => value(entry, hero.key))
    .filter((found) => found !== null)
  if (!everyone.length) return ''

  const better = everyone.filter((found) => found > hero.value).length
  const equal = everyone.filter((found) => found === hero.value).length
  // The COUNT, not a literal. Every squad in the archive is 23 a side, so "of
  // the 46" was right by luck; one short team sheet and the card states a
  // number of players that were never on the pitch.
  const field = everyone.length

  if (better === 0) return equal > 1 ? 'Joint most in the match' : 'Most in the match'
  if (better === 1) return `2nd most of the ${field}`
  if (better === 2) return `3rd most of the ${field}`

  // A share is only worth printing while it still reads as "top". Real cards
  // run 9-33%; anything past that is a rank the card is better off not making.
  const share = Math.round(((better + 1) / field) * 100)
  return share <= TOP_SHARE ? `Top ${share}% of the ${field}` : ''
}
