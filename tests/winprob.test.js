/**
 * Win-probability tests, including against a real match: Newcastle Falcons
 * 45-42 Sale Sharks, where Newcastle scored a converted try at 80' to win.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  scoreSteps, scoreAtMinute, timelineIsComplete, winProbability,
  buildWinProbabilityCurve, keyMoments, FULL_TIME, DEFAULT_MODEL,
} from '../src/analysis/winprob.js'
import { createMatch, SCORE_EVENTS, MATCH_STATUS } from '../src/data/schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const comebackPath = join(here, 'fixtures', 'match-comeback.json')

const event = (minute, side, type, extra = {}) => ({ minute, side, type, ...extra })

const matchWith = (timeline, homeScore, awayScore) => createMatch({
  status: MATCH_STATUS.FINAL,
  home: { name: 'Home', score: homeScore },
  away: { name: 'Away', score: awayScore },
  timeline,
})

describe('scoreSteps', () => {
  it('adds up event values when the feed gives no running score', () => {
    const match = matchWith([
      event(10, 'home', SCORE_EVENTS.TRY),
      event(11, 'home', SCORE_EVENTS.CONVERSION),
      event(25, 'away', SCORE_EVENTS.PENALTY),
    ], 7, 3)
    expect(scoreSteps(match).map((s) => [s.home, s.away])).toEqual([[5, 0], [7, 0], [7, 3]])
  })

  it('prefers the running score the feed supplied', () => {
    const match = matchWith([
      event(10, 'home', SCORE_EVENTS.TRY, { homeScore: 5, awayScore: 0 }),
      // Deliberately inconsistent with the event value: the feed wins.
      event(20, 'home', SCORE_EVENTS.TRY, { homeScore: 17, awayScore: 0 }),
    ], 17, 0)
    expect(scoreSteps(match).map((s) => s.home)).toEqual([5, 17])
  })

  it('sorts out-of-order events and ignores those with no minute', () => {
    const match = matchWith([
      event(40, 'away', SCORE_EVENTS.PENALTY),
      event(10, 'home', SCORE_EVENTS.TRY),
      event(null, 'home', SCORE_EVENTS.TRY),
    ], 5, 3)
    expect(scoreSteps(match).map((s) => s.minute)).toEqual([10, 40])
  })

  it('ignores non-scoring events', () => {
    const match = matchWith([
      event(20, 'home', SCORE_EVENTS.YELLOW_CARD),
      event(30, 'home', SCORE_EVENTS.TRY),
    ], 5, 0)
    expect(scoreSteps(match)).toHaveLength(1)
  })

  it('clamps a late score to full time', () => {
    const match = matchWith([event(83, 'home', SCORE_EVENTS.TRY)], 5, 0)
    expect(scoreSteps(match)[0].minute).toBe(FULL_TIME)
  })

  it('handles a match with no timeline', () => {
    expect(scoreSteps(matchWith([], 0, 0))).toEqual([])
    expect(scoreSteps(null)).toEqual([])
  })
})

describe('timelineIsComplete', () => {
  it('accepts a timeline that adds up to the final score', () => {
    const match = matchWith([
      event(10, 'home', SCORE_EVENTS.TRY),
      event(11, 'home', SCORE_EVENTS.CONVERSION),
    ], 7, 0)
    expect(timelineIsComplete(match)).toBe(true)
  })

  it('rejects one that does not - the real ESPN failure mode', () => {
    // England 48-7 Wales reconstructed as 41-7: a converted try is missing.
    const match = matchWith([event(10, 'home', SCORE_EVENTS.TRY)], 48, 7)
    expect(timelineIsComplete(match)).toBe(false)
  })

  it('accepts a genuine nil-nil with no events', () => {
    expect(timelineIsComplete(matchWith([], 0, 0))).toBe(true)
  })

  it('rejects a match with no final score', () => {
    expect(timelineIsComplete(createMatch({ home: { name: 'A' }, away: { name: 'B' } }))).toBe(false)
  })
})

describe('scoreAtMinute', () => {
  const steps = scoreSteps(matchWith([
    event(10, 'home', SCORE_EVENTS.TRY),
    event(50, 'away', SCORE_EVENTS.TRY),
  ], 5, 5))

  it('reports nil-nil before anything has happened', () => {
    expect(scoreAtMinute(steps, 0)).toEqual({ home: 0, away: 0 })
  })

  it('reports the score as it stood at that minute', () => {
    expect(scoreAtMinute(steps, 20)).toEqual({ home: 5, away: 0 })
    expect(scoreAtMinute(steps, 60)).toEqual({ home: 5, away: 5 })
  })

  it('includes an event happening exactly on the minute asked for', () => {
    expect(scoreAtMinute(steps, 10)).toEqual({ home: 5, away: 0 })
  })
})

describe('winProbability', () => {
  it('is a coin toss at nil-nil at full time', () => {
    expect(winProbability(0, FULL_TIME)).toBeCloseTo(0.5, 5)
  })

  it('favours the home side at kick-off, before anything has happened', () => {
    expect(winProbability(0, 0)).toBeGreaterThan(0.5)
  })

  it('rises with the lead and falls with the deficit', () => {
    expect(winProbability(10, 40)).toBeGreaterThan(winProbability(3, 40))
    expect(winProbability(-10, 40)).toBeLessThan(winProbability(-3, 40))
  })

  it('values the same lead more the less time is left', () => {
    expect(winProbability(7, 70)).toBeGreaterThan(winProbability(7, 20))
  })

  it('stays inside 0 and 1 for absurd margins', () => {
    expect(winProbability(200, 79)).toBeLessThanOrEqual(1)
    expect(winProbability(-200, 79)).toBeGreaterThanOrEqual(0)
  })
})

describe('buildWinProbabilityCurve', () => {
  const match = matchWith([
    event(10, 'home', SCORE_EVENTS.TRY),
    event(70, 'away', SCORE_EVENTS.TRY),
    event(71, 'away', SCORE_EVENTS.CONVERSION),
  ], 5, 7)

  it('returns one point per minute including both ends', () => {
    const curve = buildWinProbabilityCurve(match)
    expect(curve).toHaveLength(FULL_TIME + 1)
    expect(curve[0].minute).toBe(0)
    expect(curve.at(-1).minute).toBe(FULL_TIME)
  })

  it('carries the score alongside each probability', () => {
    const curve = buildWinProbabilityCurve(match)
    expect(curve[20]).toMatchObject({ home: 5, away: 0 })
    expect(curve.at(-1)).toMatchObject({ home: 5, away: 7 })
  })

  it('ends below half after the home side is overtaken', () => {
    expect(buildWinProbabilityCurve(match).at(-1).homeWin).toBeLessThan(0.5)
  })
})

describe('keyMoments', () => {
  it('picks the biggest swings and returns them in match order', () => {
    const match = matchWith([
      event(5, 'home', SCORE_EVENTS.PENALTY),
      event(78, 'away', SCORE_EVENTS.TRY),
      event(79, 'away', SCORE_EVENTS.CONVERSION),
    ], 3, 7)
    const moments = keyMoments(match, DEFAULT_MODEL, 2)
    expect(moments).toHaveLength(2)
    expect(moments.map((m) => m.minute)).toEqual([...moments.map((m) => m.minute)].sort((a, b) => a - b))
    // A late try that flips the lead outweighs an early penalty.
    expect(moments.some((m) => m.minute === 78)).toBe(true)
  })

  it('returns nothing for a scoreless match', () => {
    expect(keyMoments(matchWith([], 0, 0))).toEqual([])
  })

  it('measures a swing at the minute it happened, not against a stale baseline', () => {
    // A single away try at 60' in a 0-0 match. Comparing against the kick-off
    // probability would fold in 60 minutes of home-advantage decay and report
    // roughly -0.38 instead of the true -0.24.
    const match = matchWith([event(60, 'away', SCORE_EVENTS.TRY)], 0, 5)
    const [moment] = keyMoments(match)
    const expected = winProbability(-5, 60) - winProbability(0, 60)
    expect(moment.swing).toBeCloseTo(expected, 10)
  })

  it('does not credit a score with time that merely passed', () => {
    // Two identical tries, early and late. The early one changes more, because
    // there is more rugby left for it to matter in - but neither should absorb
    // the decay between them.
    const match = matchWith([
      event(10, 'home', SCORE_EVENTS.TRY),
      event(70, 'home', SCORE_EVENTS.TRY),
    ], 10, 0)
    const moments = keyMoments(match, DEFAULT_MODEL, 2)
    for (const moment of moments) {
      expect(Math.abs(moment.swing)).toBeLessThan(0.5)
    }
  })
})

describe('a malformed model', () => {
  it('falls back per coefficient rather than producing NaN', () => {
    // loadModel() returns whatever JSON is on disk; a partial file used to flow
    // straight through, and canvas silently declines to draw NaN coordinates,
    // so the chart lost its curve with no error anywhere.
    const curve = buildWinProbabilityCurve(
      matchWith([event(10, 'home', SCORE_EVENTS.TRY)], 5, 0),
      { source: 'fitted', matches: 658 },
    )
    expect(curve.every((point) => Number.isFinite(point.homeWin))).toBe(true)
  })

  it('ignores a non-numeric coefficient', () => {
    expect(Number.isFinite(winProbability(7, 40, { k: 'nonsense', h: null }))).toBe(true)
  })
})

describe('a real comeback', () => {
  const available = existsSync(comebackPath)
  const match = available ? createMatch(JSON.parse(readFileSync(comebackPath, 'utf8'))) : null

  it.skipIf(!available)('has a complete, consistent timeline', () => {
    expect(timelineIsComplete(match)).toBe(true)
  })

  it.skipIf(!available)('shows the winner far behind before they win', () => {
    const curve = buildWinProbabilityCurve(match)
    const homeWon = match.home.score > match.away.score
    const lowest = Math.min(...curve.map((p) => (homeWon ? p.homeWin : 1 - p.homeWin)))
    expect(lowest).toBeLessThan(0.15)
  })

  it.skipIf(!available)('ends with the winner above half', () => {
    const final = buildWinProbabilityCurve(match).at(-1)
    const homeWon = match.home.score > match.away.score
    expect(homeWon ? final.homeWin : 1 - final.homeWin).toBeGreaterThan(0.5)
  })
})
