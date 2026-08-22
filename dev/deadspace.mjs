/**
 * How much of each graphic is dead canvas: the largest run of consecutive
 * near-empty pixel rows inside the area the format is allowed to use.
 *
 * "The story format is the feed layout letterboxed into 9:16" sat in the notes
 * as an opinion for weeks. Measured, it was true of two graphics and not of
 * the format - but the FIRST version of this harness drove `dev/preview.html`,
 * which renders exactly one match, and so reported one fixture's numbers as if
 * they were the archive's. They were not: a scheduled fixture measured 319px
 * where the demo match measured 124. That is the trap CLAUDE.md names as a
 * non-negotiable, walked straight into by the tool built to avoid it. It now
 * sweeps real matches and reports a distribution.
 *
 * Two constants decide the answer, and the load-bearing one is the second:
 *
 *  - THRESHOLD (90) separates ink from the backdrop's diagonal texture, which
 *    is drawn across every row of every canvas. At 24 the whole canvas scores
 *    as inked. Anything from 45 to 160 gives the same answer, so this is not a
 *    cliff.
 *  - EMPTY_ROW (3) is how many sharp pixels a row may carry and still count as
 *    empty. At 0 or 1 every gap collapses to zero, because the accent hairline
 *    the frame paints at x <= 10 puts a step on every row.
 *
 * The default sample is the one the numbers in CLAUDE.md were measured from.
 * Change it and those numbers stop reproducing from the documented command,
 * which is how they came to be quoted against a sample nobody could re-run.
 *
 * Usage: node dev/deadspace.mjs [--every N]   (needs the static server on :4321)
 */
import { chromium } from 'playwright'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'

const NL = String.fromCharCode(10)
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const every = Number(arg('every', '8'))

const matches = []
const tables = []
const seasons = []
for (const competition of readdirSync('data')) {
  const dir = `data/${competition}`
  if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
  if (existsSync(`${dir}/matches`)) {
    for (const file of readdirSync(`${dir}/matches`)) {
      matches.push(JSON.parse(readFileSync(`${dir}/matches/${file}`, 'utf8')))
    }
  }
  for (const file of readdirSync(dir)) {
    if (file.startsWith('table-')) tables.push(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')))
    if (file.startsWith('season-')) seasons.push(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')))
  }
}
const sample = matches.filter((_, index) => index % every === 0)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
await page.goto('http://localhost:4321/dev/preview?only=result', { waitUntil: 'networkidle' })

const rows = await page.evaluate(async ([raws, tableRaws, seasonRaws]) => {
  const [{ GRAPHICS, renderGraphic }, { createMatch, createTable }, theme, { contentBox },
    { blockingReason }] = await Promise.all([
    import('/src/render/index.js'), import('/src/data/schema.js'),
    import('/src/render/theme.js'), import('/src/render/frame.js'),
    import('/src/render/availability.js'),
  ])
  const THRESHOLD = 90
  const EMPTY_ROW = 3
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  /** Largest run of empty rows, and the inked share, inside the content box. */
  const measure = (size) => {
    const box = contentBox(size)
    const { width } = canvas
    const data = ctx.getImageData(0, 0, width, canvas.height).data
    let longest = 0
    let run = 0
    let inked = 0
    for (let y = Math.round(box.top); y < Math.round(box.bottom); y += 1) {
      let ink = 0
      for (let x = 4; x < width - 4; x += 2) {
        const i = (y * width + x) * 4
        const j = (y * width + x - 4) * 4
        if (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1])
          + Math.abs(data[i + 2] - data[j + 2]) > THRESHOLD) ink += 1
      }
      if (ink <= EMPTY_ROW) {
        run += 1
        if (run > longest) longest = run
      } else {
        run = 0
        inked += 1
      }
    }
    return { gap: longest, inked: inked / (box.bottom - box.top), height: box.bottom - box.top }
  }

  const out = []
  for (const raw of raws) {
    const match = createMatch(raw)
    const played = raw.home?.score !== null && raw.away?.score !== null
    const squad = match.home?.squad || []
    for (const graphic of GRAPHICS) {
      // Every graphic that works from a match. The tables and seasons do not
      // vary with the fixture, so they are swept separately below.
      if (graphic.meta.needs !== 'match') continue
      const options = {
        handle: '@tryline',
        side: 'home',
        player: squad.find((entry) => Object.keys(entry.stats || {}).length) || squad[0],
        playerB: (match.away?.squad || [])[0],
      }
      // The app's own gate: without it a team sheet with no squad renders a
      // header over an empty card and reports a 1,079px dead band.
      if (blockingReason(graphic, { match, source: 'espn' }, options)) continue
      for (const key of ['feed', 'story']) {
        const size = theme.SIZES[key]
        try {
          await renderGraphic(canvas, graphic.meta.id, {
            match,
            size,
            theme: theme.THEMES.midnight,
            options,
          })
        } catch (error) {
          continue // refused by its own gate, which is not a dead-space question
        }
        out.push({
          graphic: graphic.meta.id,
          format: key,
          kind: played ? 'played' : 'scheduled',
          ...measure(size),
        })
      }
    }
  }
  for (const [items, needs] of [[tableRaws, 'table'], [seasonRaws, 'season']]) {
    for (const raw of items) {
      const made = needs === 'table' ? { table: createTable(raw) } : { season: raw }
      for (const graphic of GRAPHICS) {
        if (graphic.meta.needs !== needs) continue
        if (blockingReason(graphic, { ...made, source: 'espn' }, {})) continue
        for (const key of ['feed', 'story']) {
          const size = theme.SIZES[key]
          try {
            await renderGraphic(canvas, graphic.meta.id, {
              ...made, size, theme: theme.THEMES.midnight, options: { handle: '@tryline' },
            })
          } catch (error) {
            continue
          }
          out.push({ graphic: graphic.meta.id, format: key, kind: needs, ...measure(size) })
        }
      }
    }
  }
  return out
}, [sample, tables, seasons])

await browser.close()

const quantile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

const groups = new Map()
for (const row of rows) {
  const key = `${row.graphic}|${row.format}|${row.kind}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(row)
}

process.stdout.write(`${sample.length} matches sampled (every ${every} of ${matches.length})${NL}${NL}`)
process.stdout.write(`${'graphic'.padEnd(11)}${'fmt'.padEnd(7)}${'kind'.padEnd(11)}`
  + `${'n'.padStart(4)}${'inked'.padStart(8)}${'gap p50'.padStart(9)}${'p90'.padStart(7)}${'max'.padStart(7)}${'worst%'.padStart(8)}${NL}`)

const ordered = [...groups.entries()].sort((a, b) => {
  const worst = (rows_) => Math.max(...rows_[1].map((row) => row.gap / row.height))
  return worst(b) - worst(a)
})
for (const [key, group] of ordered) {
  const [graphic, format, kind] = key.split('|')
  const gaps = group.map((row) => row.gap)
  const worstShare = Math.max(...group.map((row) => row.gap / row.height))
  process.stdout.write(`${graphic.padEnd(11)}${format.padEnd(7)}${kind.padEnd(11)}`
    + `${String(group.length).padStart(4)}`
    + `${`${Math.round((group.reduce((sum, row) => sum + row.inked, 0) / group.length) * 100)}%`.padStart(8)}`
    + `${`${quantile(gaps, 0.5)}px`.padStart(9)}`
    + `${`${quantile(gaps, 0.9)}px`.padStart(7)}`
    + `${`${Math.max(...gaps)}px`.padStart(7)}`
    + `${`${Math.round(worstShare * 100)}%`.padStart(8)}${NL}`)
}
if (errors.length) process.stdout.write(`${NL}page errors: ${errors.slice(0, 3).join(' | ')}${NL}`)
