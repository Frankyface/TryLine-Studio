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
import {
  heroStat, heroRank, shirtGroup, squadPointsAgree, HERO_STATS,
} from '../src/analysis/hero.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const player = (jersey, stats) => ({ name: 'Test Player', jersey, position: 'P', stats })

/**
 * The real p90 per shirt, from the archive - unclamped, because the code
 * decides eligibility by comparing it against the stat's floor.
 */
const BENCHMARKS = {
  P: { metres: 18, tackles: 14, runs: 10, passes: 3 },
  W: { metres: 94, tackles: 8, runs: 11, passes: 7 },
  FL: { metres: 46, tackles: 19, runs: 13, passes: 9 },
  N8: { metres: 61, tackles: 18, runs: 16, passes: 9 },
}

describe('heroStat', () => {
  it('refuses a prop who made six metres', () => {
    // The design review's example, and the median prop card under the old rule.
    expect(heroStat(player(1, { metres: 6, runs: 3, tackles: 4 }), { benchmarks: BENCHMARKS })).toBeNull()
  })

  it('refuses metres for a prop at ANY value, because no prop makes them', () => {
    // Structural, not lucky: the prop p90 for metres is 18 against a floor of
    // 55, so metres is not a stat this shirt headlines with. Asserted at a
    // value well clear of the floor, which the old rule let straight through.
    expect(heroStat(player(1, { metres: 90, runs: 4 }), { benchmarks: BENCHMARKS })).toBeNull()
    expect(heroStat(player(11, { metres: 90, runs: 4 }), { benchmarks: BENCHMARKS }))
      .toMatchObject({ key: 'metres', value: 90 })
  })

  it('refuses a stat the shirt cannot headline with, even above its floor', () => {
    // A wing's p90 for tackles is 8, under the floor of 12: a wing making 14
    // tackles had a busy afternoon, but it is not the number to shout.
    expect(heroStat(player(11, { tackles: 14 }), { benchmarks: BENCHMARKS })).toBeNull()
    expect(heroStat(player(6, { tackles: 14 }), { benchmarks: BENCHMARKS }))
      .toMatchObject({ key: 'tackles', value: 14 })
  })

  it('picks a DIFFERENT stat for two shirts given identical numbers', () => {
    // The whole point of a per-shirt benchmark, and the assertion that fails
    // if it is deleted from the ranking. 19 tackles and 16 carries: for a
    // flanker the carries are the outlier (16/13), for a No 8 the tackles are
    // (19/18). Ranked against the floors alone, both read Carries.
    const stats = { tackles: 19, runs: 16 }
    expect(heroStat(player(7, stats), { benchmarks: BENCHMARKS })).toMatchObject({ key: 'runs' })
    expect(heroStat(player(8, stats), { benchmarks: BENCHMARKS })).toMatchObject({ key: 'tackles' })
  })

  it('never headlines a number that only its floor let through', () => {
    // Mauls, offloads, clean breaks and defenders beaten have no shirt whose
    // p90 reaches their floor, so the minimum qualifying value used to score a
    // perfect 1.0 and beat everything: Oscar Jegou headlined 3 MAULS WON in a
    // match where he made 15 tackles.
    const hero = heroStat(player(7, { maulsWon: 3, offload: 3, tackles: 15 }), { benchmarks: BENCHMARKS })
    expect(hero).toMatchObject({ key: 'tackles', value: 15 })
  })

  it('gives that same prop a headline for work that IS exceptional', () => {
    const hero = heroStat(player(1, { metres: 6, runs: 3, tackles: 25 }), { benchmarks: BENCHMARKS })
    expect(hero).toMatchObject({ key: 'tackles', value: 25, kind: 'volume' })
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

  it('reconciles a squad against its own scoreline', () => {
    const squad = [{ stats: { points: 15 } }, { stats: { points: 7 } }, { stats: {} }]
    expect(squadPointsAgree(squad, 22)).toBe(true)
    expect(squadPointsAgree(squad, 29)).toBe(false)
    expect(squadPointsAgree(squad, null)).toBe(false)
    expect(squadPointsAgree(null, 22)).toBe(false)
  })

  it('withholds a scoring headline when the squad points do not reconcile', () => {
    // ESPN drops a converted try in 4 of the 106 team-matches that carry
    // stats, so an unrecorded scorer exists in that squad and "most in the
    // match" cannot be checked. Eight cards were reachable on those squads.
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
    expect(heroRank(match([90, 40], [30, 20]), hero)).toBe('Most in the match')
  })

  it('says joint when it was equalled', () => {
    const hero = { key: 'metres', value: 90, kind: 'volume' }
    expect(heroRank(match([90, 90], [30, 20]), hero)).toBe('Joint most in the match')
  })

  it('counts the players it is actually comparing against', () => {
    // "of the 46" was a literal. Every squad in the archive is 23 a side, so
    // it was right by luck and would have stated a number of players that were
    // never on the pitch the first time a team sheet came up short.
    const hero = { key: 'metres', value: 70, kind: 'volume' }
    expect(heroRank(match([90, 80, 70, 60], [50, 40, 30, 20]), hero)).toBe('3rd most of the 8')
  })

  it('says JOINT at every rank, not only at the top', () => {
    // 59 of 209 "2nd most" cards and 44 of 101 "3rd most" cards had another
    // player on the identical number - two Italy players both printed "2nd
    // most of the 46" on 19 tackles, from the same match.
    const hero = { key: 'metres', value: 70, kind: 'volume' }
    expect(heroRank(match([90, 70, 70], [50, 40, 30]), hero)).toBe('Joint 2nd most of the 6')
  })

  it('says nothing rather than calling a mid-table number a rank', () => {
    const hero = { key: 'metres', value: 10, kind: 'volume' }
    expect(heroRank(match([90, 80, 70], [60, 50, 10]), hero)).toBe('')
  })

  it('says nothing when there is nothing to compare', () => {
    expect(heroRank(null, null)).toBe('')
    expect(heroRank({ home: {}, away: {} }, { key: 'metres', value: 5 })).toBe('')
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
      if (!hero) continue
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
    // A third or so: high enough to be a real second mode, low enough that the
    // grid is still the card most players get.
    expect(share).toBeGreaterThan(0.25)
    expect(share).toBeLessThan(0.45)
  })
})
