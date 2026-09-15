import { EVENT_POINTS } from '../data/schema.js'

/** Event icons must reconcile by addition, not just trust a final cumulative score. */
export function matchFlow(match) {
  if (match?.status !== 'final' || ![match.home?.score, match.away?.score]
    .every((score) => Number.isInteger(score) && score >= 0)) {
    return { reason: 'A final result with two valid scores is needed.' }
  }
  const events = [...(match.timeline || [])].sort((a, b) => a.minute - b.minute)
  if (!events.length) return { reason: 'No event timeline was supplied.' }
  let home = 0
  let away = 0
  const steps = []
  for (const event of events) {
    if (!Object.hasOwn(EVENT_POINTS, event.type) || !['home', 'away'].includes(event.side)
      || !Number.isFinite(event.minute) || event.minute < 0 || event.minute > 120) {
      return { reason: 'The event timeline has an unknown event, team or minute.' }
    }
    const points = EVENT_POINTS[event.type]
    if (event.side === 'home') home += points
    else away += points
    // Some feeds only attach the score after BOTH a try and its conversion.
    // Counts and the final score are the reliable cross-check for icon totals.
    steps.push({ ...event, points, home, away })
  }
  if (home !== match.home.score || away !== match.away.score) {
    return { reason: `Recorded events total ${home}-${away}; the final score is ${match.home.score}-${match.away.score}.` }
  }
  const end = Math.max(80, ...events.map((event) => event.minute))
  const periods = [20, 40, 60, end].map((until, index) => {
    const from = index * 20
    const rows = steps.filter((event) => (index === 0 ? event.minute >= 0 : event.minute > from) && event.minute <= until)
    const last = steps.filter((event) => event.minute <= until).at(-1)
    return { from, until, label: index === 3 ? '60–FT' : `${from}–${until}′`,
      home: last?.home ?? 0, away: last?.away ?? 0, events: rows }
  })
  return { reason: '', steps, periods, end }
}

export function eventCounts(events, side) {
  const counts = { try: 0, penaltyTry: 0, conversion: 0, penalty: 0, dropGoal: 0, yellowCard: 0, redCard: 0 }
  for (const event of events) if (event.side === side) counts[event.type] += 1
  return counts
}

/** Named scoring contributions, with no invented player performance stats. */
export function scoringSpotlights(matches, limit = 2) {
  const candidates = []
  for (const match of matches) {
    const flow = matchFlow(match)
    if (flow.reason) continue
    const players = new Map()
    for (const event of flow.steps) {
      if (!event.points || event.type === 'penaltyTry' || !event.player?.name) continue
      const key = `${event.side}:${event.player.id || event.player.name}`
      if (!players.has(key)) players.set(key, { player: event.player, side: event.side, match,
        points: 0, tries: 0, conversions: 0, penalties: 0, dropGoals: 0, minutes: [] })
      const row = players.get(key)
      row.points += event.points
      row[{ try: 'tries', conversion: 'conversions', penalty: 'penalties', dropGoal: 'dropGoals' }[event.type]] += 1
      row.minutes.push(event.minute)
    }
    candidates.push(...players.values())
  }
  // Prefer a try scorer, then offer a different player's strongest contribution.
  candidates.sort((a, b) => b.tries - a.tries || b.points - a.points
    || a.player.name.localeCompare(b.player.name) || a.match.id.localeCompare(b.match.id))
  const picked = []
  const seen = new Set()
  while (picked.length < limit && candidates.length) {
    const next = candidates.shift()
    const key = `${next.match[next.side].id || next.match[next.side].name}:${next.player.id || next.player.name}`
    if (seen.has(key)) continue
    picked.push(next)
    seen.add(key)
    candidates.sort((a, b) => b.points - a.points || b.tries - a.tries
      || a.player.name.localeCompare(b.player.name) || a.match.id.localeCompare(b.match.id))
  }
  return picked
}
