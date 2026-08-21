/**
 * Win probability for a rugby union match.
 *
 * ESPN publishes a win-probability feed for basketball but NOT for rugby, so
 * this is computed rather than fetched. The model is fitted from real completed
 * matches by scripts/fit-winprob.mjs; see data/models/winprob.json for the
 * coefficients, the sample size and the measured fit quality.
 *
 * The model is deliberately tiny and legible - two parameters:
 *
 *   z = k * margin / sqrt(remaining + 1)  +  h * (remaining / FULL_TIME)
 *   P(home win) = 1 / (1 + e^-z)
 *
 * The first term says a lead is worth more the less time is left to overturn
 * it (score change scales with the square root of remaining time). The second
 * is home advantage, which matters more the more rugby is left to play.
 */
import { EVENT_POINTS } from '../data/schema.js'

export const FULL_TIME = 80

/**
 * Fallback when the fitted model has not been loaded. These are the last
 * fitted values (658 matches, 2026-08-21), so an unfitted install still draws
 * a sane curve rather than a visibly flat one.
 */
export const DEFAULT_MODEL = Object.freeze({
  k: 0.92,
  h: 0.81,
  source: 'default',
})

const isScoringEvent = (event) => (EVENT_POINTS[event?.type] ?? 0) > 0

/**
 * Running score after each scoring event, oldest first.
 * Uses the running score the feed supplied when it has one, and otherwise adds
 * up the event values - which is why timelineIsComplete() exists.
 */
export function scoreSteps(match) {
  const events = (match?.timeline || [])
    .filter(isScoringEvent)
    .filter((event) => event.minute !== null && event.minute !== undefined)
    .slice()
    .sort((a, b) => a.minute - b.minute)

  let home = 0
  let away = 0
  return events.map((event) => {
    const points = EVENT_POINTS[event.type] ?? 0
    if (event.homeScore !== null && event.homeScore !== undefined
      && event.awayScore !== null && event.awayScore !== undefined) {
      home = event.homeScore
      away = event.awayScore
    } else if (event.side === 'away') {
      away += points
    } else {
      home += points
    }
    return {
      minute: Math.min(event.minute, FULL_TIME),
      home,
      away,
      side: event.side,
      type: event.type,
      player: event.player,
    }
  })
}

/**
 * Does the timeline actually add up to the final score?
 * Some ESPN scoreboard timelines are missing events; a curve drawn from an
 * incomplete timeline would be quietly wrong, so callers should say so.
 */
export function timelineIsComplete(match) {
  const steps = scoreSteps(match)
  const finalHome = match?.home?.score
  const finalAway = match?.away?.score
  if (finalHome === null || finalHome === undefined) return false
  if (!steps.length) return finalHome === 0 && finalAway === 0
  const last = steps[steps.length - 1]
  return last.home === finalHome && last.away === finalAway
}

/** Score after `minute` minutes have been played. */
export function scoreAtMinute(steps, minute) {
  let home = 0
  let away = 0
  for (const step of steps) {
    if (step.minute > minute) break
    home = step.home
    away = step.away
  }
  return { home, away }
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z))

/**
 * Probability the home side wins, given the margin and how much is left.
 * A draw counts as half a win, which is how the model was fitted.
 */
export function winProbability(margin, minute, model = DEFAULT_MODEL) {
  // Coefficients are coerced individually: `model || DEFAULT_MODEL` only
  // catches a falsy model, so a partial or older file on disk would flow
  // through and produce NaN, which canvas silently declines to draw.
  const k = Number.isFinite(model?.k) ? model.k : DEFAULT_MODEL.k
  const h = Number.isFinite(model?.h) ? model.h : DEFAULT_MODEL.h
  const remaining = Math.max(0, FULL_TIME - minute)
  const z = (k * margin) / Math.sqrt(remaining + 1) + h * (remaining / FULL_TIME)
  return sigmoid(z)
}

/**
 * The full curve for a match: one point per minute, plus the score at that
 * point so a renderer can annotate swings.
 */
export function buildWinProbabilityCurve(match, model = DEFAULT_MODEL) {
  const steps = scoreSteps(match)
  const points = []
  for (let minute = 0; minute <= FULL_TIME; minute += 1) {
    const { home, away } = scoreAtMinute(steps, minute)
    points.push({
      minute,
      home,
      away,
      homeWin: winProbability(home - away, minute, model),
    })
  }
  return points
}

/**
 * Minutes apart two annotated moments must be. Rugby scores in clusters - a try
 * and its conversion, or three tries inside ten minutes - and annotating all of
 * them puts the labels on top of each other.
 */
export const MIN_MOMENT_GAP = 6

/**
 * The moments that actually moved the match - the scoring events with the
 * biggest jump in win probability. Used to annotate the curve.
 *
 * Events sharing a minute and a side are merged (a try and its conversion are
 * one moment, not two), and the selection enforces a minimum spacing so the
 * labels have somewhere to go.
 */
export function keyMoments(match, model = DEFAULT_MODEL, limit = 3) {
  const steps = scoreSteps(match)
  let previousHome = 0
  let previousAway = 0

  const moments = steps.map((step) => {
    // Both sides of the swing are evaluated at the SAME minute. Comparing
    // against the probability at the previous score would fold in the
    // continuous decay of the home-advantage term between events, crediting a
    // try with time that had simply passed.
    const before = winProbability(previousHome - previousAway, step.minute, model)
    const after = winProbability(step.home - step.away, step.minute, model)
    previousHome = step.home
    previousAway = step.away
    return { ...step, homeWin: after, swing: after - before }
  })

  // Merge events that happened at the same minute for the same side.
  const merged = []
  for (const moment of moments) {
    const previous = merged[merged.length - 1]
    if (previous && previous.minute === moment.minute && previous.side === moment.side) {
      merged[merged.length - 1] = {
        ...moment,
        types: [...previous.types, moment.type],
        swing: previous.swing + moment.swing,
      }
    } else {
      merged.push({ ...moment, types: [moment.type] })
    }
  }

  // Greedy by swing, but never two labels within MIN_MOMENT_GAP minutes.
  const chosen = []
  for (const moment of [...merged].sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))) {
    if (chosen.length >= limit) break
    if (chosen.some((picked) => Math.abs(picked.minute - moment.minute) < MIN_MOMENT_GAP)) continue
    chosen.push(moment)
  }

  return chosen.sort((a, b) => a.minute - b.minute)
}
