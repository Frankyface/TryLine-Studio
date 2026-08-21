/**
 * Fit the win-probability model from completed matches in data/.
 *
 * Two parameters, fitted by gradient ascent on the Bernoulli log-likelihood:
 *   z = k * margin / sqrt(remaining + 1) + h * (remaining / 80)
 *
 * Only matches whose scoring timeline adds up to the recorded final score are
 * used. Roughly one in nine ESPN scoreboard timelines is missing an event, and
 * training on those would teach the model that leads evaporate for no reason.
 *
 * Writes data/models/winprob.json with the coefficients, the sample size, and
 * the measured fit quality - log loss, accuracy and a calibration table.
 *
 * Usage: node scripts/fit-winprob.mjs [--iterations 4000] [--rate 0.05]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scoreSteps, scoreAtMinute, timelineIsComplete, FULL_TIME } from '../src/analysis/winprob.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

const fail = (message) => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/**
 * A flag with a missing or non-numeric value used to become NaN, which made the
 * training loop run zero times and wrote the untrained starting guess to disk
 * labelled "fitted". Refuse instead.
 */
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = Number(process.argv[index + 1])
  if (!Number.isFinite(value) || value <= 0) {
    fail(`--${name} needs a positive number, got: ${process.argv[index + 1] ?? '(nothing)'}`)
  }
  return value
}

const iterations = arg('iterations', 4000)
const learningRate = arg('rate', 0.05)

/** Every completed match on disk. */
function loadMatches() {
  const matches = []
  if (!existsSync(dataDir)) return matches
  for (const competitionId of readdirSync(dataDir)) {
    const matchDir = join(dataDir, competitionId, 'matches')
    if (!existsSync(matchDir)) continue
    for (const file of readdirSync(matchDir)) {
      const match = JSON.parse(readFileSync(join(matchDir, file), 'utf8'))
      if (match.status === 'final' && match.home?.score !== null) matches.push(match)
    }
  }
  return matches
}

/** One training row per minute of every usable match. */
function buildSamples(matches) {
  const samples = []
  let skipped = 0

  for (const match of matches) {
    if (!timelineIsComplete(match)) {
      skipped += 1
      continue
    }
    const steps = scoreSteps(match)
    const finalMargin = match.home.score - match.away.score
    // A draw is half a win: the model predicts "home does not lose".
    const outcome = finalMargin > 0 ? 1 : finalMargin < 0 ? 0 : 0.5

    for (let minute = 0; minute <= FULL_TIME; minute += 1) {
      const { home, away } = scoreAtMinute(steps, minute)
      samples.push({ margin: home - away, minute, outcome })
    }
  }
  return { samples, skipped }
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z))

const features = (sample) => {
  const remaining = Math.max(0, FULL_TIME - sample.minute)
  return {
    marginTerm: sample.margin / Math.sqrt(remaining + 1),
    homeTerm: remaining / FULL_TIME,
  }
}

function fit(samples) {
  let k = 0.3
  let h = 0.2

  for (let step = 0; step < iterations; step += 1) {
    let gradK = 0
    let gradH = 0
    for (const sample of samples) {
      const { marginTerm, homeTerm } = features(sample)
      const error = sample.outcome - sigmoid(k * marginTerm + h * homeTerm)
      gradK += error * marginTerm
      gradH += error * homeTerm
    }
    k += (learningRate * gradK) / samples.length
    h += (learningRate * gradH) / samples.length
  }
  return { k, h }
}

function evaluate(samples, model) {
  let logLoss = 0
  let correct = 0
  let decided = 0
  const buckets = Array.from({ length: 10 }, () => ({ predicted: 0, actual: 0, count: 0 }))

  for (const sample of samples) {
    const { marginTerm, homeTerm } = features(sample)
    const p = Math.min(0.9999, Math.max(0.0001, sigmoid(model.k * marginTerm + model.h * homeTerm)))
    logLoss += -(sample.outcome * Math.log(p) + (1 - sample.outcome) * Math.log(1 - p))

    if (sample.outcome !== 0.5) {
      decided += 1
      if ((p >= 0.5 && sample.outcome === 1) || (p < 0.5 && sample.outcome === 0)) correct += 1
    }

    const bucket = buckets[Math.min(9, Math.floor(p * 10))]
    bucket.predicted += p
    bucket.actual += sample.outcome
    bucket.count += 1
  }

  return {
    logLoss: logLoss / samples.length,
    accuracy: decided > 0 ? correct / decided : null,
    calibration: buckets
      .map((bucket, index) => ({
        band: `${index * 10}-${index * 10 + 10}%`,
        count: bucket.count,
        predicted: bucket.count ? Number((bucket.predicted / bucket.count).toFixed(3)) : null,
        actual: bucket.count ? Number((bucket.actual / bucket.count).toFixed(3)) : null,
      }))
      .filter((bucket) => bucket.count > 0),
  }
}

const matches = loadMatches()
const { samples, skipped } = buildSamples(matches)

if (samples.length < 1000) {
  process.stderr.write(`Not enough training data: ${samples.length} samples from ${matches.length} matches.\n`)
  process.stderr.write('Run "npm run refresh" first.\n')
  process.exit(1)
}

process.stdout.write(`Fitting on ${matches.length - skipped} matches (${samples.length} minute-samples)\n`)
process.stdout.write(`Skipped ${skipped} matches with incomplete timelines\n\n`)

const model = fit(samples)
if (!Number.isFinite(model.k) || !Number.isFinite(model.h)) {
  fail(`Fit did not converge to finite coefficients (k=${model.k}, h=${model.h}). Model not written.`)
}
const quality = evaluate(samples, model)

process.stdout.write(`k = ${model.k.toFixed(4)}   (value of a point of margin)\n`)
process.stdout.write(`h = ${model.h.toFixed(4)}   (home advantage)\n`)
process.stdout.write(`log loss  ${quality.logLoss.toFixed(4)}\n`)
process.stdout.write(quality.accuracy === null
  ? 'accuracy  n/a (no decided matches)\n\n'
  : `accuracy  ${(quality.accuracy * 100).toFixed(1)}%  (over all minutes, decided matches)\n\n`)
process.stdout.write('calibration (predicted vs actual home-win rate)\n')
for (const bucket of quality.calibration) {
  process.stdout.write(`  ${bucket.band.padStart(8)}  n=${String(bucket.count).padStart(6)}  predicted ${bucket.predicted}  actual ${bucket.actual}\n`)
}

const output = {
  ...model,
  source: 'fitted',
  fittedAt: new Date().toISOString(),
  matches: matches.length - skipped,
  skippedIncomplete: skipped,
  samples: samples.length,
  quality,
}

mkdirSync(join(dataDir, 'models'), { recursive: true })
writeFileSync(join(dataDir, 'models', 'winprob.json'), `${JSON.stringify(output, null, 2)}\n`)
process.stdout.write('\nWrote data/models/winprob.json\n')
