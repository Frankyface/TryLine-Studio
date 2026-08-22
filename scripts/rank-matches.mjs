/**
 * Score every match for how worth posting it is, into the competition indexes.
 *
 * Computed here rather than in the browser because the score needs each
 * match's full scoring timeline, and the app only loads the index up front -
 * ranking client-side would mean fetching all 1,147 match files to populate a
 * dropdown.
 *
 * Writes two fields per match entry: `drama` (0-1, or absent when the match
 * cannot be scored) and `why` (the one-line reason, only for matches that
 * clear the bar). Absent is deliberate and different from zero: 125 finished
 * matches have no usable timeline, including every Major League Rugby match,
 * and they must read as UNRATED rather than as dull.
 *
 * Usage: node scripts/rank-matches.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createMatch } from '../src/data/schema.js'
import { matchDrama, dramaReason, WORTH_POSTING } from '../src/analysis/notable.js'

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

const model = readJson(join(dataDir, 'models', 'winprob.json'))
if (!model) {
  process.stderr.write(`No fitted model at data/models/winprob.json - run "npm run fit" first.${NL}`)
  process.exit(1)
}

let scored = 0
let unrated = 0
let notable = 0
let filesChanged = 0
const summary = []

for (const competitionId of readdirSync(dataDir)) {
  const competitionDir = join(dataDir, competitionId)
  if (!statSync(competitionDir).isDirectory()) continue
  const indexPath = join(competitionDir, 'index.json')
  const matchDir = join(competitionDir, 'matches')
  if (!existsSync(indexPath) || !existsSync(matchDir)) continue

  const index = readJson(indexPath)
  if (!index?.matches?.length) continue

  let competitionNotable = 0
  let competitionScored = 0

  const matches = index.matches.map((row) => {
    const { drama, why, ...rest } = row
    const payload = readJson(join(matchDir, `${row.id}.json`))
    if (!payload) return rest

    const result = matchDrama(createMatch(payload), model)
    if (!result) {
      // An unplayed fixture is not "unrated", it simply has not happened.
      if (payload.status === 'final') unrated += 1
      return rest
    }

    scored += 1
    competitionScored += 1
    // The threshold is applied to the ROUNDED score that gets written, so the
    // file cannot say 0.6 while withholding the reason for it.
    const rounded = Math.round(result.score * 100) / 100
    const next = { ...rest, drama: rounded }
    if (rounded >= WORTH_POSTING) {
      notable += 1
      competitionNotable += 1
      // The rounded score is what the file carries, so the reason is derived
      // from the same number - otherwise a match rounding UP to the bar was
      // written as notable with no reason attached to it.
      next.why = dramaReason(createMatch(payload), { ...result, score: rounded })
    }
    return next
  })

  summary.push(`${String(index.name || competitionId).padEnd(30)}`
    + `${String(competitionScored).padStart(4)} scored, `
    + `${String(competitionNotable).padStart(3)} worth posting`)

  if (!checkOnly) {
    writeFileSync(indexPath, `${JSON.stringify({ ...index, matches })}${NL}`)
    filesChanged += 1
  }
}

process.stdout.write(summary.join(NL) + NL + NL)
process.stdout.write(`${scored} played match(es) scored, ${unrated} finished `
  + `without a usable timeline, ${notable} clear the ${WORTH_POSTING} bar${NL}`)
process.stdout.write(checkOnly
  ? `nothing written${NL}`
  : `${filesChanged} index file(s) rewritten${NL}`)
