import { describe, it, expect } from 'vitest'
import {
  parseSquadText, parseScorersText, buildManualMatch, parseTableText, positionForJersey, abbreviate,
} from '../src/data/manual.js'
import { MATCH_STATUS, SCORE_EVENTS, validateMatch, MATCHDAY_SQUAD } from '../src/data/schema.js'
import { contrastAccent, contrastRatio, withAlpha, readableInk } from '../src/render/primitives.js'

describe('parseSquadText', () => {
  it('reads numbered lines', () => {
    const squad = parseSquadText('1 Dan Hooper\n2 Alex Jones\n3 Sam Taylor')
    expect(squad).toHaveLength(3)
    expect(squad[0]).toMatchObject({ jersey: 1, name: 'Dan Hooper', isStarter: true })
  })

  it('infers shirt numbers when they are missing', () => {
    const squad = parseSquadText('Dan Hooper\nAlex Jones')
    expect(squad.map((p) => p.jersey)).toEqual([1, 2])
  })

  it('picks up the captain and strips the marker from the name', () => {
    const [player] = parseSquadText('2 Alex Jones (c)')
    expect(player.isCaptain).toBe(true)
    expect(player.name).toBe('Alex Jones')
  })

  it('treats 16 and up as replacements', () => {
    const squad = parseSquadText('15 Owen Platt\n16 Jack Nash')
    expect(squad[0].isStarter).toBe(true)
    expect(squad[1].isStarter).toBe(false)
  })

  it('assigns rugby positions from the shirt number', () => {
    expect(positionForJersey(1)).toBe('LHP')
    expect(positionForJersey(10)).toBe('FH')
    expect(positionForJersey(15)).toBe('FB')
    expect(positionForJersey(18)).toBe('')
  })

  it('skips blank lines and caps at a matchday squad', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Player ${i + 1}`).join('\n\n')
    expect(parseSquadText(lines)).toHaveLength(MATCHDAY_SQUAD)
  })

  it('returns nothing for empty input', () => {
    expect(parseSquadText('')).toEqual([])
    expect(parseSquadText(null)).toEqual([])
  })
})

describe('parseScorersText', () => {
  it('reads "Name minute" pairs separated by commas', () => {
    const events = parseScorersText('Carter 12, Platt 34', 'home')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ minute: 12, side: 'home', type: SCORE_EVENTS.TRY })
    expect(events[0].player.name).toBe('Carter')
  })

  it('reads "minute Name" the other way round', () => {
    const [event] = parseScorersText('12 Carter', 'away')
    expect(event.minute).toBe(12)
    expect(event.player.name).toBe('Carter')
  })

  it('keeps a name with no minute', () => {
    const [event] = parseScorersText('Carter', 'home')
    expect(event.player.name).toBe('Carter')
    expect(event.minute).toBeNull()
  })

  it('returns nothing for empty input', () => {
    expect(parseScorersText('', 'home')).toEqual([])
  })
})

describe('buildManualMatch', () => {
  const form = {
    competition: 'Saturday League',
    venue: 'The Rec',
    home: { name: 'Old Boys RFC', score: '27', squad: parseSquadText('1 Dan Hooper') },
    away: { name: 'City Rugby Club', score: '22', squad: [] },
    homeTries: 'Carter 12',
  }

  it('produces a renderable match', () => {
    expect(validateMatch(buildManualMatch(form))).toEqual([])
  })

  it('marks a filled-in scoreline as a finished match', () => {
    const match = buildManualMatch(form)
    expect(match.status).toBe(MATCH_STATUS.FINAL)
    expect(match.home.isWinner).toBe(true)
    expect(match.away.isWinner).toBe(false)
  })

  it('treats a match with no scores as an upcoming fixture', () => {
    const match = buildManualMatch({ ...form, home: { ...form.home, score: '' }, away: { ...form.away, score: '' } })
    expect(match.status).toBe(MATCH_STATUS.SCHEDULED)
    expect(match.home.score).toBeNull()
  })

  it('derives a badge abbreviation from the club name', () => {
    expect(buildManualMatch(form).home.abbreviation).toBe('OB')
    // "Club" is a stripped suffix, so City Rugby Club badges as CR.
    expect(buildManualMatch(form).away.abbreviation).toBe('CR')
  })

  it('carries manual try scorers into the timeline', () => {
    expect(buildManualMatch(form).timeline[0].player.name).toBe('Carter')
  })

  it('does not throw on a completely empty form', () => {
    expect(() => buildManualMatch({})).not.toThrow()
  })
})

describe('abbreviate', () => {
  it('uses initials for a multi-word club and drops the RFC suffix', () => {
    expect(abbreviate('Old Boys RFC')).toBe('OB')
    expect(abbreviate('Northampton Saints')).toBe('NS')
  })

  it('uses opening letters for a single-word club', () => {
    expect(abbreviate('Bath')).toBe('BATH')
  })

  it('returns empty for no name', () => {
    expect(abbreviate('')).toBe('')
    expect(abbreviate(null)).toBe('')
  })
})

describe('parseTableText', () => {
  it('reads a comma separated table and computes points difference', () => {
    const table = parseTableText('Old Boys RFC, 8, 7, 0, 1, 245, 96, 5, 33')
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toMatchObject({
      rank: 1, played: 8, won: 7, drawn: 0, lost: 1, points: 33, pointsDifference: 149,
    })
  })

  it('ranks rows in the order they were pasted', () => {
    const table = parseTableText('Alpha, 3, 3, 0, 0\nBeta, 3, 0, 0, 3')
    expect(table.rows.map((r) => r.rank)).toEqual([1, 2])
    expect(table.rows[1].team.name).toBe('Beta')
  })

  it('tolerates a name only', () => {
    const table = parseTableText('Old Boys RFC')
    expect(table.rows[0].played).toBeNull()
    expect(table.rows[0].pointsDifference).toBeNull()
  })

  it('returns an empty table for empty input', () => {
    expect(parseTableText('').rows).toEqual([])
  })
})

describe('colour helpers', () => {
  it('lifts a dark team colour until it is readable on a dark background', () => {
    const lifted = contrastAccent('#0000CC', '#0B1220')
    expect(contrastRatio(lifted, '#0B1220')).toBeGreaterThanOrEqual(3.5)
  })

  it('leaves an already-readable colour alone', () => {
    expect(contrastAccent('#25D07A', '#0B1220')).toBe('#25d07a')
  })

  it('darkens a pale colour on a light background', () => {
    const adjusted = contrastAccent('#FFFF00', '#FFFFFF')
    expect(contrastRatio(adjusted, '#FFFFFF')).toBeGreaterThanOrEqual(3.5)
  })

  it('falls back when the colour cannot be parsed', () => {
    expect(contrastAccent('not-a-colour', '#0B1220', { fallback: '#25D07A' })).toBe('#25D07A')
  })

  it('converts hex to rgba', () => {
    expect(withAlpha('#25D07A', 0.5)).toBe('rgba(37,208,122,0.5)')
    expect(withAlpha('#FFF', 1)).toBe('rgba(255,255,255,1)')
  })

  it('chooses dark ink on a bright background', () => {
    expect(readableInk('#F5C518')).toBe('#0B1220')
    expect(readableInk('#0000CC')).toBe('#FFFFFF')
  })
})
