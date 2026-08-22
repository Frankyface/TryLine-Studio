import { defineConfig } from 'vitest/config'

/**
 * The coverage gate applies to the pure logic - adapters, schema, manual entry
 * and formatting - which is where a regression would silently produce a wrong
 * graphic.
 *
 * The canvas renderers, the DOM app and the PNG export are deliberately outside
 * this gate: asserting on pixels is brittle and proves little. They are covered
 * instead by tests/app.e2e.mjs, which drives the real app in Chromium through
 * every graphic and downloads a real PNG, and by dev/shots.mjs for visual review.
 * Run all five with `npm run verify`.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/data/**/*.js', 'src/render/format.js', 'src/render/labels.js', 'src/render/series.js',
        'src/render/availability.js', 'src/render/crest-sizes.js', 'src/analysis/**/*.js',
        // frame.js is in the gate for its GEOMETRY, which is pure measurement
        // and takes no theme: it decides how much room a headline reserves,
        // and an unbreakable word once drew 1075px into 762px of space.
        'src/render/frame.js'],
      // Excluded because they are browser-only shells rather than logic, and
      // the e2e suite drives both against a real browser:
      //   client.js - a thin fetch wrapper over the static data files
      //   crest.js  - FileReader/Image/canvas decoding of an uploaded badge
      exclude: ['src/data/client.js', 'src/data/crest.js'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
})
