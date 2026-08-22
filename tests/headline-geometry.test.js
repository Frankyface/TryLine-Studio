/**
 * The headline block's geometry.
 *
 * This is pure measurement - it takes no theme and draws nothing - so it can
 * be tested against a stub context whose glyphs are exactly `size * 0.5` wide.
 * The rules it has to keep are the ones a real render cannot check cheaply:
 * the space RESERVED is the space used, nothing exceeds the width it was
 * given, and a word too long to break is shrunk and then ellipsed rather than
 * drawn off the canvas.
 */
import { describe, it, expect } from 'vitest'
import { headlineLayout, contentBox } from '../src/render/frame.js'
import { SIZES } from '../src/render/theme.js'

/** A context whose text width is a fixed fraction of the font size. */
function stubContext() {
  let current = 40
  return {
    save() {},
    restore() {},
    set font(value) {
      current = Number(String(value).match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 40)
    },
    get font() { return `${current}px` },
    measureText: (text) => ({ width: String(text).length * current * 0.5 }),
  }
}

// The real format constants: they carry the padding the content box is
// derived from, and a hand-made {width, height} makes every measurement NaN.
const FEED = SIZES.feed
const STORY = SIZES.story
const FEED_WIDTH = contentBox(FEED).width

const widest = (ctx, laid) => Math.max(0, ...laid.lines.map((line) =>
  line.toUpperCase().length * laid.fontSize * 0.5))

describe('headlineLayout', () => {
  it('reserves the height it uses', () => {
    const ctx = stubContext()
    const laid = headlineLayout(ctx, FEED, { finding: 'France came from 14 down', category: 'Win probability' })
    expect(laid.lines.length).toBeGreaterThan(0)
    expect(laid.height).toBeGreaterThan(laid.kicker + laid.fontSize)
    expect(laid.height).toBeCloseTo(laid.kicker + laid.lines.length * laid.fontSize * 1.06 + 16, 5)
  })

  it('reserves only the kicker when there is no headline at all', () => {
    const laid = headlineLayout(stubContext(), FEED, {})
    expect(laid.lines).toEqual([])
    expect(laid.height).toBe(0)
  })

  it('falls back to the category when there is no finding', () => {
    const laid = headlineLayout(stubContext(), FEED, { category: 'Home advantage' })
    expect(laid.lines.join(' ')).toBe('Home advantage')
    // No kicker: the category is the headline now, so printing it twice would
    // leave a chart captioned with the same words in two sizes.
    expect(laid.kicker).toBe(0)
  })

  it('wraps rather than overflowing, and never past two lines', () => {
    const ctx = stubContext()
    const laid = headlineLayout(ctx, FEED, {
      finding: 'Leinster came from twenty one points down with eleven minutes left on the clock',
    })
    expect(laid.lines.length).toBeLessThanOrEqual(2)
    expect(widest(ctx, laid)).toBeLessThanOrEqual(FEED_WIDTH)
  })

  it('shrinks a single unbreakable word instead of drawing it off the canvas', () => {
    // The real exposure is manual entry, which has no length cap: a one-token
    // club name could never make the line count exceed two - the fit only
    // breaks at spaces - so the shrink loop never ran and the line measured
    // 1075px into 762px of room, sliced by the frame edge.
    const ctx = stubContext()
    const long = headlineLayout(ctx, FEED, { finding: 'Ballynahinch-Rugby-Football-Club win again' })
    const short = headlineLayout(ctx, FEED, { finding: 'Bath win again' })
    expect(long.fontSize).toBeLessThan(short.fontSize)
    expect(widest(ctx, long)).toBeLessThanOrEqual(FEED_WIDTH)
  })

  it('ellipses a word that will not fit even at the smallest size', () => {
    const ctx = stubContext()
    const laid = headlineLayout(ctx, FEED, { finding: 'W'.repeat(400), width: 300 })
    expect(laid.lines.join('')).toMatch(/\.\.\.$/)
    expect(widest(ctx, laid)).toBeLessThanOrEqual(300)
  })

  it('honours a narrower width, so a reserved scoreline is not run under', () => {
    const ctx = stubContext()
    const sentence = 'South Africa scored 43 and conceded 16 a game'
    const full = headlineLayout(ctx, FEED, { finding: sentence })
    const narrow = headlineLayout(ctx, FEED, { finding: sentence, width: 500 })
    expect(widest(ctx, narrow)).toBeLessThanOrEqual(500)
    // Smaller type, not a taller block: the same sentence squeezed into 500px
    // shrinks to hold two lines rather than growing a third.
    expect(narrow.fontSize).toBeLessThan(full.fontSize)
    expect(narrow.lines.length).toBeLessThanOrEqual(2)
  })

  it('gives the story format a bigger headline than the feed', () => {
    const ctx = stubContext()
    const feed = headlineLayout(ctx, FEED, { finding: 'France never trailed', category: 'Win probability' })
    const story = headlineLayout(ctx, STORY, { finding: 'France never trailed', category: 'Win probability' })
    expect(story.fontSize).toBeGreaterThan(feed.fontSize)
    expect(story.kicker).toBeGreaterThan(feed.kicker)
  })

  it('never returns a NaN measurement for degenerate input', () => {
    for (const finding of ['', ' ', '   ', '7', 'a'.repeat(1000)]) {
      const laid = headlineLayout(stubContext(), FEED, { finding, category: 'Win probability' })
      expect(Number.isFinite(laid.height)).toBe(true)
      expect(Number.isFinite(laid.fontSize)).toBe(true)
      expect(laid.lines.every((line) => typeof line === 'string')).toBe(true)
    }
  })
})
