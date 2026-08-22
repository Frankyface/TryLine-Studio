/**
 * What a good match looks like for each shirt number.
 *
 * A prop and a winger are not comparable on metres - median 5 against 39, p90
 * 18 against 94 - so "best stat" measured flat picks metres for 149 of the 212
 * props in the archive, at a median value of SIX. That is the card the design
 * review complained about, and it is the median prop card, not an edge case.
 *
 * Benchmarking each stat against the same SHIRT fixes it structurally: a prop
 * can never reach a metres headline because the floor sits above every prop's
 * p90. No special cases, no position list to maintain.
 *
 * Written to data/models/hero-stats.json, alongside the win model, because the
 * browser cannot see the archive these are derived from.
 *
 * Usage: node scripts/build-hero-benchmarks.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { HERO_STATS, shirtGroup } from '../src/analysis/hero.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    process.stderr.write(`skipped unreadable ${path}: ${error.message}${NL}`)
    return null
  }
}

/** Every player in every match that carries per-player stats. */
function eachPlayer(visit) {
  for (const competitionId of readdirSync(dataDir)) {
    const matchDir = join(dataDir, competitionId, 'matches')
    if (!existsSync(join(dataDir, competitionId)) || !statSync(join(dataDir, competitionId)).isDirectory()) continue
    if (!existsSync(matchDir)) continue
    for (const file of readdirSync(matchDir).filter((name) => name.endsWith('.json'))) {
      const match = readJson(join(matchDir, file))
      if (!match) continue
      for (const side of ['home', 'away']) {
        for (const player of match[side]?.squad || []) {
          if (Object.keys(player.stats || {}).length) visit(player)
        }
      }
    }
  }
}

const percentile = (values, fraction) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

const samples = new Map()
let players = 0

eachPlayer((player) => {
  players += 1
  const group = shirtGroup(player.jersey)
  if (!group) return
  for (const stat of HERO_STATS) {
    const value = player.stats?.[stat.key]
    if (!Number.isFinite(value)) continue
    const key = `${group}|${stat.key}`
    if (!samples.has(key)) samples.set(key, [])
    samples.get(key).push(value)
  }
})

const benchmarks = {}
for (const [key, values] of samples) {
  const [group, stat] = key.split('|')
  benchmarks[group] = benchmarks[group] || {}
  // p90 for the shirt, never below the stat's own floor - a benchmark under
  // the floor would let a weak number through on a quiet position.
  const floor = HERO_STATS.find((entry) => entry.key === stat)?.floor ?? 0
  benchmarks[group][stat] = Math.max(floor, percentile(values, 0.9))
}

const payload = {
  players,
  groups: Object.keys(benchmarks).length,
  benchmarks,
}

process.stdout.write(`${players} player performances across ${Object.keys(benchmarks).length} shirt groups${NL}`)
for (const group of Object.keys(benchmarks).sort()) {
  const shown = ['metres', 'tackles', 'carries', 'passes']
    .map((stat) => `${stat} ${benchmarks[group][stat] ?? '-'}`)
    .join('  ')
  process.stdout.write(`  ${group.padEnd(6)}${shown}${NL}`)
}

if (checkOnly) {
  process.stdout.write(`${NL}nothing written${NL}`)
} else {
  mkdirSync(join(dataDir, 'models'), { recursive: true })
  writeFileSync(join(dataDir, 'models', 'hero-stats.json'), `${JSON.stringify(payload)}${NL}`)
  process.stdout.write(`${NL}wrote data/models/hero-stats.json${NL}`)
}
