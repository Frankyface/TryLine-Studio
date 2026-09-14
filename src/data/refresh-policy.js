/** Keep completed-match squads when a scoreboard refresh has no roster block. */
export function retainMatchDetail(current, previous) {
  if (!previous || current.status !== 'final' || previous.status !== 'final'
    || current.id !== previous.id || current.competition?.id !== previous.competition?.id
    || current.home?.id !== previous.home?.id || current.away?.id !== previous.away?.id
    || current.home?.score !== previous.home?.score || current.away?.score !== previous.away?.score) return current
  const team = (side) => ({ ...current[side], squad: current[side].squad?.length
    ? current[side].squad : previous[side].squad || [] })
  return { ...current, home: team('home'), away: team('away') }
}

/** A partial download must never be stamped as a fresh, complete competition. */
export function assertCompleteScoreboard({ failedMonths, cappedMonths, matchCount, previousCount }) {
  if (failedMonths.length) throw new Error(`Scoreboard refresh incomplete: failed months ${failedMonths.join(', ')}. Previous data retained.`)
  if (cappedMonths.length) throw new Error(`Scoreboard reached the event cap in ${cappedMonths.join(', ')}. Previous data retained.`)
  if (!matchCount && previousCount > 0) throw new Error('Scoreboard unexpectedly returned no matches. Previous data retained.')
}
