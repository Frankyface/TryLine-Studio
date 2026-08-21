/**
 * Comparison aggregation. The behaviours that matter here are the ones that
 * would silently produce a wrong graphic: rates must not be summed, missing
 * data must not become zero, and "lower is better" stats must pick the right
 * winner.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  aggregateStat, aggregateSquad, buildComparison, compareTeams, comparePlayers,
  hasComparableSquads, formatComparisonValue, COMPARISON_STATS,
  TEAM_STAT_KEYS, PLAYER_STAT_KEYS, BETTER,
} from '../src/analysis/comparison.js'
import { adaptSummary } from '../src/data/espn.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(here, 'fixtures', 'espn-summary-fra-ire-2026.json')
const available = existsSync(fixturePath)
const realMatch = available ? adaptSummary(JSON.parse(readFileSync(fixturePath, 'utf8'))) : null

const player = (stats) => ({ name: 'A Player', stats })

describe('aggregateStat', () => {
  it('sums counting stats across the squad', () => {
    const squad = [player({ metres: 40 }), player({ metres: 55 }), player({ metres: 5 })]
    expect(aggregateStat(squad, 'metres')).toBe(100)
  })

  it('averages a rate instead of summing it', () => {
    // Summing three players on 80% would report 240% kick success.
    const squad = [
      player({ kickPercentSuccess: 0.8 }),
      player({ kickPercentSuccess: 0.8 }),
      player({ kickPercentSuccess: 0.8 }),
    ]
    expect(aggregateStat(squad, 'kickPercentSuccess')).toBeCloseTo(0.8, 5)
  })

  it('averages a rate only over the players who attempted it', () => {
    const squad = [
      player({ kickPercentSuccess: 0.8 }),
      player({ kickPercentSuccess: 0.8 }),
      ...Array.from({ length: 21 }, () => player({ kickPercentSuccess: 0 })),
    ]
    expect(aggregateStat(squad, 'kickPercentSuccess')).toBeCloseTo(0.8, 5)
  })

  it('returns null when nobody recorded the stat, never zero', () => {
    expect(aggregateStat([player({}), player({})], 'metres')).toBeNull()
    expect(aggregateStat([], 'metres')).toBeNull()
  })

  it('ignores non-numeric values', () => {
    const squad = [player({ metres: 40 }), player({ metres: null }), player({ metres: undefined })]
    expect(aggregateStat(squad, 'metres')).toBe(40)
  })

  it('handles every declared comparison stat without throwing', () => {
    const squad = [player({ metres: 10 })]
    for (const key of Object.keys(COMPARISON_STATS)) {
      expect(() => aggregateStat(squad, key)).not.toThrow()
    }
  })
})

describe('buildComparison', () => {
  it('picks the higher value as leader for a normal stat', () => {
    const [row] = buildComparison({ metres: 588 }, { metres: 388 }, ['metres'])
    expect(row.leader).toBe('left')
  })

  it('picks the LOWER value as leader where fewer is better', () => {
    const [row] = buildComparison({ missedTackles: 21 }, { missedTackles: 35 }, ['missedTackles'])
    expect(row.betterWhen).toBe(BETTER.LOWER)
    expect(row.leader).toBe('left')
  })

  it('reports no leader on a tie', () => {
    const [row] = buildComparison({ metres: 100 }, { metres: 100 }, ['metres'])
    expect(row.leader).toBeNull()
  })

  it('gives the LONGER bar to the leader on a fewer-is-better row', () => {
    // 18 turnovers vs 11: drawing 18 as a full bar read as an emphatic win for
    // the side that actually lost that row. The printed values are unchanged.
    const [row] = buildComparison({ turnoversConceded: 18 }, { turnoversConceded: 11 }, ['turnoversConceded'])
    expect(row.leader).toBe('right')
    expect(row.rightBar).toBe(1)
    expect(row.leftBar).toBeLessThan(1)
    expect(formatComparisonValue(row)).toEqual({ left: '18', right: '11' })
  })

  it('scales bars so the larger value fills its track', () => {
    const [row] = buildComparison({ metres: 588 }, { metres: 388 }, ['metres'])
    expect(row.leftBar).toBe(1)
    expect(row.rightBar).toBeCloseTo(388 / 588, 5)
  })

  it('gives a full bar to a ZERO on a fewer-is-better row', () => {
    // Zero missed tackles is the best possible score, and 42% of players record
    // it. Treating zero as "nothing to draw" left the winner blank.
    const [row] = buildComparison({ missedTackles: 0 }, { missedTackles: 3 }, ['missedTackles'])
    expect(row.leader).toBe('left')
    expect(row.leftBar).toBe(1)
    expect(row.rightBar).toBeGreaterThan(0)
  })

  it('draws both bars when a fewer-is-better row is tied at zero', () => {
    const [row] = buildComparison({ missedTackles: 0 }, { missedTackles: 0 }, ['missedTackles'])
    expect(row.leftBar).toBeGreaterThan(0)
    expect(row.leftBar).toBe(row.rightBar)
  })

  it('draws no bar at all when both sides are zero', () => {
    const [row] = buildComparison({ tries: 0 }, { tries: 0 }, ['tries'])
    expect(row.leftBar).toBe(0)
    expect(row.rightBar).toBe(0)
  })

  it('keeps a missing value null rather than turning it into zero', () => {
    const [row] = buildComparison({}, { metres: 200 }, ['metres'])
    expect(row.left).toBeNull()
    expect(row.leader).toBeNull()
    expect(formatComparisonValue(row).left).toBe('-')
  })

  it('formats a rate as a percentage', () => {
    const [row] = buildComparison(
      { kickPercentSuccess: 0.83 }, { kickPercentSuccess: 0.5 }, ['kickPercentSuccess'],
    )
    expect(formatComparisonValue(row)).toEqual({ left: '83%', right: '50%' })
  })

  it('rounds counting values for display', () => {
    const [row] = buildComparison({ metres: 587.6 }, { metres: 388.2 }, ['metres'])
    expect(formatComparisonValue(row)).toEqual({ left: '588', right: '388' })
  })

  it('labels an unknown stat key rather than throwing', () => {
    const [row] = buildComparison({ madeUp: 3 }, { madeUp: 1 }, ['madeUp'])
    expect(row.label).toBe('madeUp')
    expect(row.leader).toBe('left')
  })
})

describe('derived stats', () => {
  it('computes tackle success from tackles and misses', () => {
    const squad = [player({ tackles: 80, missedTackles: 20 })]
    expect(aggregateSquad(squad).tackleSuccess).toBeCloseTo(0.8, 5)
  })

  it('computes lineout success from won and thrown', () => {
    const squad = [player({ lineoutsWon: 9, totalLineouts: 10 })]
    expect(aggregateSquad(squad).lineoutSuccess).toBeCloseTo(0.9, 5)
  })

  it('returns null rather than dividing by zero', () => {
    const squad = [player({ tackles: 0, missedTackles: 0, lineoutsWon: 0, totalLineouts: 0 })]
    const stats = aggregateSquad(squad)
    expect(stats.tackleSuccess).toBeNull()
    expect(stats.lineoutSuccess).toBeNull()
  })

  it('returns null when the inputs are missing entirely', () => {
    expect(aggregateSquad([player({})]).tackleSuccess).toBeNull()
  })

  it('derives for individual players too, so a rate means the same thing', () => {
    const rows = comparePlayers(
      player({ tackles: 9, missedTackles: 1 }),
      player({ tackles: 6, missedTackles: 4 }),
      ['tackleSuccess'],
    )
    expect(rows[0].left).toBeCloseTo(0.9, 5)
    expect(rows[0].leader).toBe('left')
    expect(formatComparisonValue(rows[0])).toEqual({ left: '90%', right: '60%' })
  })
})

describe('default stat selections', () => {
  it('never shows defendersBeaten alongside missedTackles', () => {
    // They are one event counted from both ends - 99.1% mirror images across
    // the dataset - so a card containing both duplicates a row.
    const hasBoth = (keys) => keys.includes('defendersBeaten') && keys.includes('missedTackles')
    expect(hasBoth(TEAM_STAT_KEYS)).toBe(false)
    expect(hasBoth(PLAYER_STAT_KEYS)).toBe(false)
  })

  it('keeps stats that are almost always zero off the default cards', () => {
    const banned = ['redCards', 'dropGoalsConverted', 'totalFreeKicksConceded', 'penaltyGoals', 'yellowCards']
    for (const key of banned) {
      expect(TEAM_STAT_KEYS).not.toContain(key)
      expect(PLAYER_STAT_KEYS).not.toContain(key)
    }
  })

  it('keeps cleanBreaks and offload off the PLAYER card', () => {
    // Fine per team, but 0-0 in roughly half of like-for-like player pairings.
    expect(PLAYER_STAT_KEYS).not.toContain('cleanBreaks')
    expect(PLAYER_STAT_KEYS).not.toContain('offload')
  })
})

describe('hasComparableSquads', () => {
  it('needs a squad on both sides', () => {
    expect(hasComparableSquads({ home: { squad: [1] }, away: { squad: [1] } })).toBe(true)
    expect(hasComparableSquads({ home: { squad: [1] }, away: { squad: [] } })).toBe(false)
    expect(hasComparableSquads(null)).toBe(false)
  })
})

describe('comparePlayers', () => {
  it('compares two stat lines directly', () => {
    expect(comparePlayers(player({ metres: 95 }), player({ metres: 40 }), ['metres'])[0].leader).toBe('left')
  })

  it('survives a missing player', () => {
    expect(() => comparePlayers(null, null, ['metres'])).not.toThrow()
    expect(comparePlayers(null, null, ['metres'])[0].left).toBeNull()
  })
})

describe('against a real international', () => {
  it.skipIf(!available)('produces team totals in plausible rugby ranges', () => {
    const home = aggregateSquad(realMatch.home.squad)
    expect(home.metres).toBeGreaterThan(150)
    expect(home.metres).toBeLessThan(1200)
    expect(home.tackles).toBeGreaterThan(40)
    expect(home.tackles).toBeLessThan(300)
    expect(home.runs).toBeGreaterThan(40)
  })

  it.skipIf(!available)('reconciles summed points with the actual final score', () => {
    // If this drifts, the aggregate is not trustworthy and must not be shown.
    expect(aggregateSquad(realMatch.home.squad).points).toBe(realMatch.home.score)
    expect(aggregateSquad(realMatch.away.squad).points).toBe(realMatch.away.score)
  })

  it.skipIf(!available)('fills every default team row', () => {
    const rows = compareTeams(realMatch, TEAM_STAT_KEYS)
    expect(rows).toHaveLength(TEAM_STAT_KEYS.length)
    expect(rows.every((row) => row.left !== null && row.right !== null)).toBe(true)
  })
})
