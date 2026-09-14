/** Selection only: no clock, files, browser, or publishing side effects. */
import { planningReason } from './plan.js'

const HOUR = 3600000

export function selectMatches(matches, {
  now, phase = 'final', lookbackHours = 24, lookaheadHours = 24, limit = 5,
} = {}) {
  const instant = Date.parse(now)
  if (!Number.isFinite(instant)) throw new Error('A valid --now timestamp is required.')
  if (!['final', 'scheduled'].includes(phase)) throw new Error('Phase must be final or scheduled.')
  if (![lookbackHours, lookaheadHours].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('Lookback and lookahead hours must be positive numbers.')
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100.')

  const seen = new Set()
  return matches.filter((match) => {
    if (match.status !== phase || planningReason(match)) return false
    const kickoff = Date.parse(match.kickoff)
    if (!Number.isFinite(kickoff)) return false
    if (phase === 'final' && (kickoff > instant || kickoff < instant - lookbackHours * HOUR)) return false
    if (phase === 'scheduled' && (kickoff <= instant || kickoff > instant + lookaheadHours * HOUR)) return false
    const key = `${match.competition?.id}:${match.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => {
    const difference = Date.parse(a.kickoff) - Date.parse(b.kickoff)
    return (phase === 'final' ? -difference : difference) || String(a.id).localeCompare(String(b.id), 'en')
  }).slice(0, limit)
}

/** Check each competition, not the global timestamp of a partial refresh. */
export function freshnessReason(updated, now, maxAgeHours = 48) {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('Maximum data age must be positive.')
  const age = Date.parse(now) - Date.parse(updated)
  if (!Number.isFinite(age)) return 'Data has no valid refresh timestamp.'
  if (age < -5 * 60000) return 'Data refresh timestamp is in the future.'
  if (age > maxAgeHours * HOUR) return `Data is more than ${maxAgeHours} hours old; run npm run refresh first.`
  return ''
}
