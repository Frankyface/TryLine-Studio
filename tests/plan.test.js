/**
 * The posting plan.
 *
 * Pure logic, so it is testable in full - which is the reason this part exists
 * ahead of the part that talks to Instagram. What matters is that a plan never
 * lists a card the renderer would refuse, never repeats a theme back to back,
 * and comes out the same way twice.
 */
import { describe, it, expect } from 'vitest'
import { planFor, rotationThemes, plannableGraphics, knownGraphicIds } from '../src/publish/plan.js'
import { createMatch } from '../src/data/schema.js'

const MODEL = { k: 0.92, h: 0.81 }

const squad = () => Array.from({ length: 23 }, (_, index) => ({
  id: `p${index}`, name: `Player ${index}`, jersey: index + 1, position: 'FL', stats: {},
}))

const matchOf = (overrides = {}) => createMatch({
  id: '600123',
  competition: { id: '1', name: 'Test League' },
  home: { id: 'h', name: 'Home Club', shortName: 'Home', score: 24, squad: squad() },
  away: { id: 'a', name: 'Away Club', shortName: 'Away', score: 21, squad: squad() },
  status: 'final',
  venue: { name: 'The Rec' },
  timeline: [{ minute: 10, side: 'home', type: 'try', homeScore: 24, awayScore: 21 }],
  ...overrides,
})

describe('planFor', () => {
  it('plans nothing without a match', () => {
    expect(planFor({})).toEqual([])
    expect(planFor({ match: null })).toEqual([])
  })

  it('only lists graphics that actually exist', () => {
    for (const id of plannableGraphics) expect(knownGraphicIds).toContain(id)
  })

  it('never lists a card the app would refuse to draw', () => {
    // A match with no squads cannot produce a team sheet or a player card, and
    // a plan that includes one fails halfway through a posting run.
    const bare = matchOf({ home: { id: 'h', name: 'Home Club', shortName: 'Home', score: 24 } })
    const cards = planFor({ match: bare, source: 'espn' }, { model: MODEL })
    expect(cards.map((card) => card.graphicId)).not.toContain('teamsheet')
    expect(cards.map((card) => card.graphicId)).not.toContain('statcard')
  })

  it('gives a fixture different cards from a result', () => {
    const fixture = matchOf({
      status: 'scheduled',
      home: { id: 'h', name: 'Home Club', shortName: 'Home', score: null, squad: squad() },
      away: { id: 'a', name: 'Away Club', shortName: 'Away', score: null, squad: squad() },
      timeline: [],
    })
    const ids = planFor({ match: fixture, source: 'espn' }, { model: MODEL }).map((c) => c.graphicId)
    expect(ids).toContain('matchday')
    expect(ids).not.toContain('result')
  })

  it('rotates the theme so no two cards in a row match', () => {
    const cards = planFor({ match: matchOf(), source: 'espn' }, { model: MODEL })
    expect(cards.length).toBeGreaterThan(2)
    for (let index = 1; index < cards.length; index += 1) {
      expect(cards[index].themeId).not.toBe(cards[index - 1].themeId)
    }
  })

  it('rotates through every theme the app has, not a hardcoded few', () => {
    // A theme added to the app should join the rotation without a second edit.
    // This is the assertion that fails if someone pins the list here.
    expect(rotationThemes().length).toBeGreaterThanOrEqual(7)
  })

  it('is the same plan twice, so a retry repeats the run', () => {
    const snapshot = { match: matchOf(), source: 'espn' }
    const first = planFor(snapshot, { model: MODEL })
    const second = planFor(snapshot, { model: MODEL })
    expect(second).toEqual(first)
  })

  it('gives two different matches different theme runs', () => {
    const one = planFor({ match: matchOf({ id: '600123' }), source: 'espn' }, { model: MODEL })
    const two = planFor({ match: matchOf({ id: '900999' }), source: 'espn' }, { model: MODEL })
    expect(two.map((c) => c.themeId)).not.toEqual(one.map((c) => c.themeId))
  })

  it('captions every card with something true', () => {
    const cards = planFor({ match: matchOf(), source: 'espn' }, { model: MODEL })
    for (const card of cards) {
      expect(card.caption).toBeTruthy()
      // The scoreline is the one fact always available; nothing is invented.
      expect(card.caption).toMatch(/Home|Away/)
      expect(card.caption).not.toMatch(/undefined|NaN|null/)
    }
  })

  it('asks for both formats by default and honours a narrower ask', () => {
    const both = planFor({ match: matchOf(), source: 'espn' }, { model: MODEL })
    expect(new Set(both.map((c) => c.format))).toEqual(new Set(['feed', 'story']))
    const feedOnly = planFor({ match: matchOf(), source: 'espn' }, { model: MODEL, formats: ['feed'] })
    expect(feedOnly.every((c) => c.format === 'feed')).toBe(true)
  })

  it('numbers the cards in posting order', () => {
    const cards = planFor({ match: matchOf(), source: 'espn' }, { model: MODEL })
    expect(cards.map((c) => c.order)).toEqual(cards.map((_, index) => index + 1))
  })
})
