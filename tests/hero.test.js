/**
 * The one number worth putting on a player's card.
 *
 * The rule this replaces chose the first non-zero stat in a fixed priority
 * order, which put METRES on 149 of the 212 props in the archive at a median
 * value of SIX. These pin the three things that fix it: benchmarks are per
 * shirt, scoring outranks volume, and it refuses rather than guesses.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { heroStat, heroRank, shirtGroup, HERO_STATS } from '../src/analysis/hero.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const player = (jersey, stats) => ({ name: 'Test Player', jersey, position: 'P', stats })

/** Prop metres p90 is 18 in the archive; wing is 94. */
const BENCHMARKS = {
  P: { metres: 55, tackles: 14, runs: 10, passes: 34 },
  W: { metres: 94, tackles: 12, runs: 14, passes: 34 },
  FL: { metres: 55, tackles: 18, runs: 13, passes: 34 },
}

describe('heroStat', () => {
  it('refuses a prop who made six metres', () => {
    // The design review's example, and the median prop card under the old rule.
    expect(heroStat(player(1, { metres: 6, runs: 3, tackles: 4 }), { benchmarks: BENCHMARKS })).toBeNull()
  })

  it('gives that same prop a headline for work that IS exceptional', () => {
    const hero = heroStat(player(1, { metres: 6, runs: 3, tackles: 25 }), { benchmarks: BENCHMARKS })
    expect(hero).toMatchObject({ key: 'tackles', value: 25, kind: 'volume' })
  })

  it('judges a stat against the same shirt, not against the pitch', () => {
    // 40 metres and 13 carries: the wing is a carrier having a quiet run day,
    // the flanker is carrying more than nine flankers in ten. Same numbers,
    // different headline, because the benchmark is the shirt's own.
    const stats = { metres: 40, runs: 13, tackles: 4 }
    expect(heroStat(player(11, stats), { benchmarks: BENCHMARKS })).toMatchObject({ key: 'runs' })
    expect(heroStat(player(6, stats), { benchmarks: BENCHMARKS })).toMatchObject({ key: 'runs' })
    // The prop floor sits above every prop's p90 for metres, so no prop can
    // ever reach a metres headline however the rest of the card reads.
    expect(heroStat(player(1, { metres: 40, runs: 4 }), { benchmarks: BENCHMARKS })).toBeNull()
  })

  it('puts a brace ahead of a tackle count', () => {
    // Ranking on benchmark ratio alone loses every two-try performance to a
    // busy forward, which is not how anybody reads a rugby match.
    const hero = heroStat(player(11, { tries: 2, tackles: 20, metres: 40 }), { benchmarks: BENCHMARKS })
    expect(hero).toMatchObject({ key: 'tries', value: 2, kind: 'scoring' })
  })

  it('does not headline a single try', () => {
    expect(heroStat(player(11, { tries: 1, metres: 20 }), { benchmarks: BENCHMARKS })).toBeNull()
  })

  it('withholds a scoring headline when the squad points do not reconcile', () => {
    // ESPN drops a converted try often enough that the tries/points row is
    // already gated on this; a hero number is a bigger claim, not a smaller one.
    const stats = { tries: 2, tackles: 3 }
    expect(heroStat(player(11, stats), { benchmarks: BENCHMARKS, squadPointsReconcile: false }))
      .not.toMatchObject({ key: 'tries' })
  })

  it('headlines the concrete number, not the percentage beside it', () => {
    // A perfect rate can only be reached by a player who already cleared the
    // volume floor, so a rate tier was unreachable - 0 of 2,438 players - and
    // "25 tackles" is the better line than "100%" in any case.
    const hero = heroStat(player(1, { tackleSuccess: 1, tackles: 25 }), { benchmarks: BENCHMARKS })
    expect(hero).toMatchObject({ key: 'tackles', value: 25 })
  })

  it('degrades to scoring only when there are no benchmarks at all', () => {
    // Safe rather than wrong: without the file the app still headlines a brace
    // and refuses everything it cannot judge.
    expect(heroStat(player(11, { tries: 2 }), {})).toMatchObject({ key: 'tries' })
    expect(heroStat(player(11, { metres: 200 }), {})).toBeNull()
  })

  it('refuses a player with no stats at all', () => {
    expect(heroStat(player(1, {}), { benchmarks: BENCHMARKS })).toBeNull()
    expect(heroStat(null, { benchmarks: BENCHMARKS })).toBeNull()
    expect(heroStat({ name: 'No shirt', jersey: null, stats: { metres: 200 } }, { benchmarks: BENCHMARKS }))
      .toBeNull()
  })

  it('never headlines a stat where more is worse', () => {
    const keys = HERO_STATS.map((stat) => stat.key)
    expect(keys).not.toContain('missedTackles')
    expect(keys).not.toContain('penaltiesConceded')
    expect(keys).not.toContain('turnoversConceded')
  })
})

describe('shirtGroup', () => {
  it('maps both props onto one group and both wings onto another', () => {
    expect(shirtGroup(1)).toBe(shirtGroup(3))
    expect(shirtGroup(11)).toBe(shirtGroup(14))
    expect(shirtGroup(1)).not.toBe(shirtGroup(11))
  })

  it('keeps replacements apart from the starters in the same shirt', () => {
    // A 20-minute cameo and 80 minutes are not the same sample.
    expect(shirtGroup(17)).not.toBe(shirtGroup(1))
    expect(shirtGroup(24)).toBeNull()
    expect(shirtGroup(null)).toBeNull()
  })
})

describe('heroRank', () => {
  const squadOf = (values) => values.map((metres, index) => player(index + 1, { metres }))
  const match = (home, away) => ({ home: { squad: squadOf(home) }, away: { squad: squadOf(away) } })

  it('says most in the match when nobody bettered it', () => {
    const hero = { key: 'metres', value: 90, kind: 'volume' }
    expect(heroRank(match([90, 40], [30, 20]), null, hero)).toBe('Most in the match')
  })

  it('says joint when it was equalled', () => {
    const hero = { key: 'metres', value: 90, kind: 'volume' }
    expect(heroRank(match([90, 90], [30, 20]), null, hero)).toBe('Joint most in the match')
  })

  it('counts the players it is actually comparing against', () => {
    // "of the 46" was a literal. Every squad in the archive is 23 a side, so
    // it was right by luck and would have stated a number of players that were
    // never on the pitch the first time a team sheet came up short.
    const hero = { key: 'metres', value: 70, kind: 'volume' }
    expect(heroRank(match([90, 80, 70, 60], [50, 40, 30, 20]), null, hero)).toBe('3rd most of the 8')
  })

  it('says nothing rather than calling a mid-table number a rank', () => {
    const hero = { key: 'metres', value: 10, kind: 'volume' }
    expect(heroRank(match([90, 80, 70], [60, 50, 10]), null, hero)).toBe('')
  })

  it('says nothing when there is nothing to compare', () => {
    expect(heroRank(null, null, null)).toBe('')
    expect(heroRank({ home: {}, away: {} }, null, { key: 'metres', value: 5 })).toBe('')
  })
})

/* ---------- against the real archive ---------- */

const benchmarkPath = join(root, 'data', 'models', 'hero-stats.json')
const benchmarks = existsSync(benchmarkPath)
  ? JSON.parse(readFileSync(benchmarkPath, 'utf8')).benchmarks
  : null

function realPlayers() {
  const dataDir = join(root, 'data')
  if (!existsSync(dataDir)) return []
  const found = []
  for (const competition of readdirSync(dataDir)) {
    const matchDir = join(dataDir, competition, 'matches')
    if (!existsSync(join(dataDir, competition))
      || !statSync(join(dataDir, competition)).isDirectory()
      || !existsSync(matchDir)) continue
    for (const file of readdirSync(matchDir)) {
      const match = JSON.parse(readFileSync(join(matchDir, file), 'utf8'))
      for (const side of ['home', 'away']) {
        for (const entry of match[side]?.squad || []) {
          if (Object.keys(entry.stats || {}).length) found.push({ player: entry, match })
        }
      }
    }
  }
  return found
}

const archive = benchmarks ? realPlayers() : []

describe('the rule over every player in the archive', () => {
  it.skipIf(!archive.length)('never headlines metres for a prop', () => {
    const props = archive.filter((entry) => shirtGroup(entry.player.jersey) === 'P')
    const onMetres = props.filter((entry) =>
      heroStat(entry.player, { benchmarks })?.key === 'metres')
    expect(props.length).toBeGreaterThan(100)
    expect(onMetres).toHaveLength(0)
  })

  it.skipIf(!archive.length)('never picks a number in the bottom half of its own match', () => {
    // The measured failure of the old rule: its chosen number sat at the 58th
    // percentile of the match, a coin flip dressed up as a headline.
    let worst = 1
    for (const { player: subject, match } of archive) {
      const hero = heroStat(subject, { benchmarks })
      if (!hero || hero.kind === 'rate') continue
      const values = [...match.home.squad, ...match.away.squad]
        .map((entry) => entry.stats?.[hero.key])
        .filter((value) => Number.isFinite(value))
      const below = values.filter((value) => value < hero.value).length
      worst = Math.min(worst, below / values.length)
    }
    expect(worst).toBeGreaterThan(0.6)
  })

  it.skipIf(!archive.length)('refuses most players, and says so rather than guessing', () => {
    const accepted = archive.filter((entry) => heroStat(entry.player, { benchmarks })).length
    const share = accepted / archive.length
    // A third to a half: high enough to be a real second mode, low enough that
    // the grid is still the card most players get.
    expect(share).toBeGreaterThan(0.3)
    expect(share).toBeLessThan(0.5)
  })
})
