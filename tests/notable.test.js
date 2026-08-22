/**
 * Which matches are worth posting.
 *
 * The measure this replaces was reporting the VENUE: the fitted model gives
 * the home side 0.692 at kick-off, so an away team that led from the first
 * minute to the last still looked like it had come back from 0.308. These pin
 * the neutral baseline and the exact zero point that fixes it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { matchDrama, dramaReason, byDrama, WORTH_POSTING } from '../src/analysis/notable.js'
import { createMatch } from '../src/data/schema.js'

const MODEL = { k: 0.92, h: 0.81 }

/** A match whose timeline reaches the final score, so it can be scored. */
const matchOf = (events, home, away) => createMatch({
  home: { name: 'Home', shortName: 'Home', score: home },
  away: { name: 'Away', shortName: 'Away', score: away },
  status: 'final',
  timeline: events,
})

const score = (minute, side, homeScore, awayScore) => ({
  minute, side, type: 'try', homeScore, awayScore,
})

describe('matchDrama', () => {
  it('scores a one-sided win at zero', () => {
    const rout = matchOf([
      score(10, 'home', 21, 0), score(30, 'home', 42, 0), score(60, 'home', 63, 0),
    ], 63, 0)
    // Not exactly zero: win probability approaches 1 without reaching it, so
    // the late-doubt branch leaves a millionth behind. It rounds to 0.00.
    expect(matchDrama(rout, MODEL).score).toBeCloseTo(0, 5)
  })

  it('gives an away side that never trailed a comeback of exactly zero', () => {
    // This is the artefact the neutral baseline exists to remove: with the
    // fitted home advantage this match scored 0.31 and sat mid-table.
    const awayLedThroughout = matchOf([
      score(5, 'away', 0, 7), score(40, 'away', 0, 21), score(70, 'away', 0, 35),
    ], 0, 35)
    expect(matchDrama(awayLedThroughout, MODEL).comeback).toBe(0)
  })

  it('scores a genuine comeback highly', () => {
    const comeback = matchOf([
      score(10, 'away', 0, 21), score(65, 'home', 14, 21), score(78, 'home', 24, 21),
    ], 24, 21)
    const drama = matchDrama(comeback, MODEL)
    expect(drama.comeback).toBeGreaterThan(0.8)
    expect(drama.score).toBeGreaterThanOrEqual(WORTH_POSTING)
  })

  it('scores a match that stayed level to the end, with nobody behind', () => {
    const tense = matchOf([score(20, 'home', 10, 10), score(75, 'home', 17, 17)], 17, 17)
    const drama = matchDrama(tense, MODEL)
    expect(drama.comeback).toBe(0)
    expect(drama.lateDoubt).toBeGreaterThan(0.8)
    expect(drama.drawn).toBe(true)
  })

  it('refuses to score a match whose timeline does not reach the final score', () => {
    // 125 finished matches are like this, including France 48-46 England.
    const short = matchOf([score(10, 'home', 7, 0)], 48, 46)
    expect(matchDrama(short, MODEL)).toBeNull()
  })

  it('refuses a match with no scores at all', () => {
    expect(matchDrama(matchOf([], null, null), MODEL)).toBeNull()
    expect(matchDrama(null, MODEL)).toBeNull()
  })

  it('never returns a score outside 0-1', () => {
    for (const [h, a] of [[100, 0], [0, 100], [3, 3], [80, 79]]) {
      const drama = matchDrama(matchOf([score(40, 'home', h, a)], h, a), MODEL)
      if (!drama) continue
      expect(drama.score).toBeGreaterThanOrEqual(0)
      expect(drama.score).toBeLessThanOrEqual(1)
    }
  })
})

describe('dramaReason', () => {
  it('names the deficit the winner came back from', () => {
    const comeback = matchOf([
      score(10, 'away', 0, 21), score(65, 'home', 14, 21), score(78, 'home', 24, 21),
    ], 24, 21)
    expect(dramaReason(comeback, matchDrama(comeback, MODEL)))
      .toMatch(/Home came back from 0-21 at \d+'/)
  })

  it('says nothing for a match that is not worth posting', () => {
    const rout = matchOf([score(10, 'home', 40, 0)], 40, 0)
    expect(dramaReason(rout, matchDrama(rout, MODEL))).toBe('')
  })

  it('says nothing when the match could not be scored', () => {
    expect(dramaReason(matchOf([], 1, 0), null)).toBe('')
  })
})

describe('byDrama', () => {
  it('puts the dramatic first and the unrated last', () => {
    const ranked = [{ drama: 0.2 }, {}, { drama: 0.9 }, { drama: 0.5 }].sort(byDrama)
    expect(ranked.map((entry) => entry.drama)).toEqual([0.9, 0.5, 0.2, undefined])
  })
})

/* ---------- against the real archive ---------- */

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

function realIndexes() {
  if (!existsSync(dataDir)) return []
  return readdirSync(dataDir)
    .filter((entry) => statSync(join(dataDir, entry)).isDirectory())
    .map((id) => join(dataDir, id, 'index.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')))
}

const indexes = realIndexes()

describe('the scores written into the indexes', () => {
  it.skipIf(!indexes.length)('are all inside 0-1', () => {
    for (const index of indexes) {
      for (const match of index.matches || []) {
        if (!Number.isFinite(match.drama)) continue
        expect(match.drama).toBeGreaterThanOrEqual(0)
        expect(match.drama).toBeLessThanOrEqual(1)
      }
    }
  })

  it.skipIf(!indexes.length)('carry a reason exactly when they clear the bar', () => {
    for (const index of indexes) {
      for (const match of index.matches || []) {
        if (!Number.isFinite(match.drama)) {
          expect(match.why).toBeUndefined()
          continue
        }
        expect(Boolean(match.why)).toBe(match.drama >= WORTH_POSTING)
      }
    }
  })

  it.skipIf(!indexes.length)('never score an unplayed fixture', () => {
    for (const index of indexes) {
      for (const match of index.matches || []) {
        if (match.status !== 'final') expect(match.drama).toBeUndefined()
      }
    }
  })
})
