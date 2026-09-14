export function dateInZone(value, timeZone = 'America/Toronto') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const part = (type) => parts.find((p) => p.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** ESPN's scheduled midnight marker is a DATE, not a midnight UTC kick-off. */
export function kickoffIsTbc(match) {
  const date = new Date(match.kickoff)
  return match.status === 'scheduled' && date.getUTCHours() === 0 && date.getUTCMinutes() === 0
}

export function fixtureDate(match, timeZone = 'America/Toronto') {
  return kickoffIsTbc(match) ? match.kickoff.slice(0, 10) : dateInZone(match.kickoff, timeZone)
}
