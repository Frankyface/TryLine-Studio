/**
 * Series colours. Two hand-tuned thresholds decide whether a chart's two areas
 * are distinguishable, so they need holding in place: a colour can clear the
 * chroma bar by a hair and still land inside the separation bar, which is
 * exactly what shipped for 1,074 real colour pairs.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { seriesColours, colourDistance, chroma, distinctFrom, MIN_SEPARATION,
} from '../src/render/series.js'
import { THEME_LIST, THEMES } from '../src/render/theme.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')

/** Must match the module's own bar. */
const MIN_SEPARATION = 115

describe('chroma', () => {
  it('scores a vivid colour far above a tinted grey', () => {
    expect(chroma('#25D07A')).toBe(171)
    expect(chroma('#5d7d9e')).toBe(65)
  })

  it('scores a pure grey as zero, whatever its lightness', () => {
    expect(chroma('#000000')).toBe(0)
    expect(chroma('#FFFFFF')).toBe(0)
    expect(chroma('#747474')).toBe(0)
  })

  it('expands three-digit hex like the rest of the codebase', () => {
    expect(chroma('#fff')).toBe(0)
  })

  it('does not throw on nonsense', () => {
    expect(() => chroma('not-a-colour')).not.toThrow()
  })
})

describe('colourDistance', () => {
  it('is zero for identical colours and symmetric', () => {
    expect(colourDistance('#25D07A', '#25D07A')).toBe(0)
    expect(colourDistance('#25D07A', '#FF6B7D'))
      .toBeCloseTo(colourDistance('#FF6B7D', '#25D07A'), 9)
  })

  it('separates colours a person would call different', () => {
    expect(colourDistance('#25D07A', '#FF6B7D')).toBeGreaterThan(MIN_SEPARATION)
  })

  it('reports two blues as close, which is the whole problem', () => {
    expect(colourDistance('#0B5FFF', '#003366')).toBeLessThan(MIN_SEPARATION)
  })
})

describe('seriesColours', () => {
  it('keeps two genuinely distinct team colours', () => {
    const { left, right } = seriesColours(THEMES.midnight, {
      home: { color: '#25D07A' }, away: { color: '#FF6B7D' },
    })
    expect(colourDistance(left, right)).toBeGreaterThanOrEqual(MIN_SEPARATION)
  })

  it('replaces a near-neutral colour that carries no identity', () => {
    // Newcastle are #000000; black is not a series colour.
    const { left } = seriesColours(THEMES.midnight, { home: { color: '#000000' } })
    expect(chroma(left)).toBeGreaterThan(90)
  })

  it('separates two teams that both play in blue', () => {
    const { left, right } = seriesColours(THEMES.midnight, {
      home: { color: '#0000CC' }, away: { color: '#003366' },
    })
    expect(colourDistance(left, right)).toBeGreaterThanOrEqual(MIN_SEPARATION)
  })

  it('rescues the case that slipped between the two thresholds', () => {
    // NSW Waratahs #003399 lifted to chroma 97 - two above the bar - and then
    // finished 114.1 from its partner, just under the separation bar.
    for (const theme of THEME_LIST) {
      const { left, right } = seriesColours(theme, {
        home: { color: '#003399' }, away: { color: '#F5C518' },
      })
      expect(colourDistance(left, right)).toBeGreaterThanOrEqual(MIN_SEPARATION)
    }
  })

  it('survives missing teams entirely', () => {
    for (const theme of THEME_LIST) {
      const { left, right } = seriesColours(theme, {})
      expect(colourDistance(left, right)).toBeGreaterThanOrEqual(MIN_SEPARATION)
    }
  })

  it('exposes home/away aliases matching left/right', () => {
    const result = seriesColours(THEMES.turf, {
      home: { color: '#25D07A' }, away: { color: '#0000CC' },
    })
    expect(result.home).toBe(result.left)
    expect(result.away).toBe(result.right)
  })
})

describe('every real team colour, on every theme', () => {
  const colours = new Set()
  if (existsSync(dataDir)) {
    for (const competitionId of readdirSync(dataDir)) {
      const matchDir = join(dataDir, competitionId, 'matches')
      if (!existsSync(matchDir)) continue
      for (const file of readdirSync(matchDir).slice(0, 120)) {
        const match = JSON.parse(readFileSync(join(matchDir, file), 'utf8'))
        if (match.home?.color) colours.add(match.home.color)
        if (match.away?.color) colours.add(match.away.color)
      }
    }
  }
  const list = [...colours]

  it.skipIf(!list.length)('always produces a separable pair', () => {
    const failures = []
    for (const theme of THEME_LIST) {
      for (const a of list) {
        for (const b of list) {
          const { left, right } = seriesColours(theme, { home: { color: a }, away: { color: b } })
          if (colourDistance(left, right) < MIN_SEPARATION) {
            failures.push({ theme: theme.id, a, b })
          }
        }
      }
    }
    expect(failures.slice(0, 3)).toEqual([])
  })
})

describe('distinctFrom', () => {
  it('keeps a colour that is already far enough away', () => {
    expect(distinctFrom('#25D07A', '#FF4D5E')).toBe('#25D07A')
  })

  it('substitutes when two colours are the same', () => {
    // The real case: a red accent beside a red loss bar drew a whole season in
    // one shade, with bar direction the only thing left to read it by.
    const substitute = distinctFrom('#E5484D', '#E5484D')
    expect(substitute).not.toBe('#E5484D')
    expect(colourDistance(substitute, '#E5484D')).toBeGreaterThanOrEqual(MIN_SEPARATION)
  })

  it('substitutes when two colours are merely close', () => {
    // bloodwood's accent against the loss red measured 16 apart.
    const substitute = distinctFrom('#E5484D', '#FF4D5E')
    expect(colourDistance(substitute, '#FF4D5E')).toBeGreaterThan(colourDistance('#E5484D', '#FF4D5E'))
  })

  it('honours a caller-supplied pool', () => {
    const pool = ['#4FA8FF', '#B388FF']
    expect(pool).toContain(distinctFrom('#E5484D', '#E5484D', pool))
  })

  it('picks the furthest option in the pool, not just any', () => {
    const pool = ['#FF5560', '#0000FF']
    expect(distinctFrom('#E5484D', '#E5484D', pool)).toBe('#0000FF')
  })
})
