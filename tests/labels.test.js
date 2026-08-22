/**
 * Label placement. A fixed offset looked fine on the demo fixture and crossed
 * the curve on 68% of real matches, so the rules here are load-bearing.
 */
import { describe, it, expect } from 'vitest'
import { composite, contrastRatio, toRgb, withAlpha } from '../src/render/primitives.js'
import {
  placeLabel, rectsOverlap, segmentHitsRect, polylineHitsRect,
} from '../src/render/labels.js'

const rect = (left, top, right, bottom) => ({ left, top, right, bottom })
const bounds = { left: 0, top: 0, right: 1000, bottom: 1000 }

describe('geometry', () => {
  it('detects overlapping rects', () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(5, 5, 15, 15))) .toBe(true)
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(false)
  })

  it('treats touching edges as not overlapping', () => {
    expect(rectsOverlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false)
  })

  it('detects a segment crossing a rect edge', () => {
    expect(segmentHitsRect(rect(10, 10, 20, 20), 0, 15, 30, 15)).toBe(true)
  })

  it('detects a segment that ends inside a rect', () => {
    expect(segmentHitsRect(rect(10, 10, 20, 20), 0, 0, 15, 15)).toBe(true)
  })

  it('ignores a segment that misses entirely', () => {
    expect(segmentHitsRect(rect(10, 10, 20, 20), 0, 0, 5, 5)).toBe(false)
    expect(segmentHitsRect(rect(10, 10, 20, 20), 0, 100, 100, 100)).toBe(false)
  })

  it('detects a polyline touching a rect on any segment', () => {
    const line = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 30, y: 15 }]
    expect(polylineHitsRect(rect(10, 10, 20, 20), line)).toBe(true)
    expect(polylineHitsRect(rect(100, 100, 120, 120), line)).toBe(false)
  })

  it('handles a polyline too short to have a segment', () => {
    expect(polylineHitsRect(rect(0, 0, 10, 10), [{ x: 5, y: 5 }])).toBe(false)
    expect(polylineHitsRect(rect(0, 0, 10, 10), [])).toBe(false)
  })
})

describe('segmentHitsRect against an independent oracle', () => {
  /**
   * Separating-axis test, written independently of the implementation. The
   * stress harness scores placements using the module's own geometry, so a
   * detector blind spot would be scored as a clean placement - this is the
   * check that the geometry itself is right.
   */
  const exact = (r, x1, y1, x2, y2) => {
    if (Math.max(x1, x2) < r.left || Math.min(x1, x2) > r.right) return false
    if (Math.max(y1, y2) < r.top || Math.min(y1, y2) > r.bottom) return false
    const dx = x2 - x1
    const dy = y2 - y1
    const cross = (px, py) => dx * (py - y1) - dy * (px - x1)
    const corners = [
      cross(r.left, r.top), cross(r.right, r.top),
      cross(r.right, r.bottom), cross(r.left, r.bottom),
    ]
    return (corners.some((v) => v > 0) && corners.some((v) => v < 0))
      || corners.some((v) => v === 0)
  }

  it('agrees with the oracle across many integer cases', () => {
    // Integers surface the degenerate cases floats hide: collinear edges,
    // corner grazes and zero-area rects.
    let seed = 12345
    const rnd = (min, max) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return min + (seed % (max - min + 1))
    }
    const disagreements = []
    for (let i = 0; i < 20000; i += 1) {
      const left = rnd(0, 15)
      const top = rnd(0, 15)
      const r = { left, top, right: left + rnd(0, 6), bottom: top + rnd(0, 6) }
      const pts = [rnd(-2, 20), rnd(-2, 20), rnd(-2, 20), rnd(-2, 20)]
      if (segmentHitsRect(r, ...pts) !== exact(r, ...pts)) disagreements.push({ r, pts })
    }
    expect(disagreements.slice(0, 3)).toEqual([])
  })

  it('detects a segment running along an edge', () => {
    expect(segmentHitsRect({ left: 1, right: 2, top: 7, bottom: 8 }, 5, 7, 0, 7)).toBe(true)
    expect(segmentHitsRect({ left: 3, right: 6, top: 3, bottom: 6 }, 3, 11, 3, 2)).toBe(true)
  })

  it('detects a segment grazing only a corner', () => {
    expect(segmentHitsRect({ left: 11, right: 13, top: 9, bottom: 10 }, 13, 12, 3, 2)).toBe(true)
  })

  it('handles a zero-area rect', () => {
    expect(segmentHitsRect({ left: 5, right: 5, top: 5, bottom: 5 }, 0, 5, 10, 5)).toBe(true)
    expect(segmentHitsRect({ left: 5, right: 5, top: 5, bottom: 5 }, 0, 9, 10, 9)).toBe(false)
  })

  it('handles a zero-length segment', () => {
    expect(segmentHitsRect({ left: 0, right: 10, top: 0, bottom: 10 }, 5, 5, 5, 5)).toBe(true)
    expect(segmentHitsRect({ left: 0, right: 10, top: 0, bottom: 10 }, 50, 50, 50, 50)).toBe(false)
  })
})

describe('placeLabel', () => {
  it('places a label near the anchor when nothing is in the way', () => {
    const spot = placeLabel({ anchorX: 500, anchorY: 500, width: 80, height: 20, bounds })
    expect(spot.rect.left).toBeGreaterThan(400)
    expect(spot.rect.right).toBeLessThan(700)
    expect(spot.collisions).toBeUndefined()
  })

  it('moves away from an existing label rather than overlapping it', () => {
    const taken = rect(510, 460, 610, 490)
    const spot = placeLabel({
      anchorX: 500, anchorY: 500, width: 80, height: 20, bounds, obstacles: [taken],
    })
    expect(rectsOverlap(spot.rect, taken)).toBe(false)
  })

  it('moves off a line rather than sitting across it', () => {
    // A horizontal line right where the default anchor would land.
    const line = [{ x: 0, y: 486 }, { x: 1000, y: 486 }]
    const spot = placeLabel({
      anchorX: 500, anchorY: 500, width: 80, height: 20, bounds, polyline: line,
    })
    expect(polylineHitsRect(spot.rect, line)).toBe(false)
  })

  it('stays inside the bounds at the right-hand edge', () => {
    const spot = placeLabel({ anchorX: 995, anchorY: 500, width: 120, height: 20, bounds })
    expect(spot.rect.right).toBeLessThanOrEqual(bounds.right)
    expect(spot.rect.left).toBeGreaterThanOrEqual(bounds.left)
  })

  it('stays inside the bounds at the top edge', () => {
    const spot = placeLabel({ anchorX: 500, anchorY: 4, width: 80, height: 20, bounds })
    expect(spot.rect.top).toBeGreaterThanOrEqual(bounds.top)
  })

  it('still returns a position when every candidate collides', () => {
    // Obstacles covering the whole canvas: something must still be drawn,
    // because a missing label is worse than a slightly overlapping one.
    const spot = placeLabel({
      anchorX: 500, anchorY: 500, width: 80, height: 20, bounds,
      obstacles: [rect(0, 0, 1000, 1000)],
    })
    expect(Number.isFinite(spot.x)).toBe(true)
    expect(Number.isFinite(spot.y)).toBe(true)
    expect(spot.collisions).toBeGreaterThan(0)
  })

  it('reports an alignment the caller can pass to textAlign', () => {
    const spot = placeLabel({ anchorX: 500, anchorY: 500, width: 80, height: 20, bounds })
    expect(['left', 'right']).toContain(spot.align)
  })

  it('works with no bounds given', () => {
    expect(() => placeLabel({ anchorX: 0, anchorY: 0, width: 10, height: 10 })).not.toThrow()
  })
})

/**
 * Translucent fills have to be measured against what they land on, not against
 * the token. The eyebrow pill is the accent at 16% over the page: measured
 * against the PAGE it passed, while its text read 2.56:1 against the pill it
 * was actually sitting on - on all ten graphics.
 */
describe('composite', () => {
  it('returns the backdrop at zero alpha', () => {
    expect(composite('#FFFFFF', 0, '#000000')).toBe('#000000')
  })

  it('returns the colour at full alpha', () => {
    expect(composite('#FFFFFF', 1, '#000000').toLowerCase()).toBe('#ffffff')
  })

  it('lands halfway at half alpha', () => {
    expect(composite('#FFFFFF', 0.5, '#000000')).toBe('#808080')
  })

  it('is what makes the pill measurable', () => {
    // A 16% white tint over black is nowhere near white, so text measured
    // against white would be wrong by a mile.
    const fill = composite('#FFFFFF', 0.16, '#000000')
    expect(contrastRatio('#FFFFFF', fill)).toBeLessThan(contrastRatio('#FFFFFF', '#000000'))
  })

  it('falls back to the backdrop for an unreadable colour', () => {
    expect(composite('not-a-colour', 0.5, '#123456')).toBe('#123456')
  })
})

/**
 * toRgb has to read what withAlpha writes.
 *
 * It did not: every contrast measurement of a translucent colour returned a
 * number that looked plausible and meant nothing, because toRgb returned null
 * and luminance fell back to 1. That is how a comparison bar at 1.19:1 passed
 * a contrast check that was measuring garbage.
 */
describe('toRgb', () => {
  it('reads hex, long and short', () => {
    expect(toRgb('#25D07A')).toEqual([37, 208, 122])
    expect(toRgb('#fff')).toEqual([255, 255, 255])
  })

  it('reads what withAlpha produces', () => {
    expect(toRgb(withAlpha('#25D07A', 0.95))).toEqual([37, 208, 122])
    expect(toRgb('rgb(37,208,122)')).toEqual([37, 208, 122])
  })

  it('measures a translucent colour as its own colour, not as nothing', () => {
    expect(contrastRatio(withAlpha('#25D07A', 0.95), '#FFFFFF'))
      .toBeCloseTo(contrastRatio('#25D07A', '#FFFFFF'), 5)
  })

  it('still rejects what it cannot read', () => {
    expect(toRgb('rgba(nope)')).toBeNull()
    expect(toRgb('not-a-colour')).toBeNull()
    expect(toRgb('')).toBeNull()
    expect(toRgb(null)).toBeNull()
  })
})
