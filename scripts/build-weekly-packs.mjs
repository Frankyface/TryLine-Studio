import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { mkdir, rmdir } from 'node:fs/promises'
import { createMatch, createTable } from '../src/data/schema.js'
import { DOMESTIC_LEAGUES, buildWeek, weeklyCards, scheduleFor, dateInZone, mondayOf, addDays, POSTING_ZONE } from '../src/publish/weekly.js'
import { readJson, writeAtomic, digest, jsonText, previewHtml } from './lib/post-bundle.mjs'
import { createPostRenderer } from './lib/render-posts.mjs'
import { weeklyPreview } from './lib/weekly-preview.mjs'
import { fixtureDate } from '../src/data/fixture-time.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const { values: args } = parseArgs({ options: {
  week: { type: 'string' }, competition: { type: 'string' }, pack: { type: 'string', default: 'all' },
  timezone: { type: 'string', default: POSTING_ZONE }, previous: { type: 'boolean' },
  formats: { type: 'string', default: 'feed' }, handle: { type: 'string', default: '@trylinestudio' },
  out: { type: 'string', default: 'dev/posts/weekly' }, now: { type: 'string' },
  'allow-stale': { type: 'boolean' }, 'no-render': { type: 'boolean' }, help: { type: 'boolean' },
} })

if (args.help) {
  console.log(`Build domestic league carousel packs and a posting calendar.
  npm run weekly -- --week 2026-09-14 --pack preview
  npm run weekly -- --previous --pack review
  npm run weekly -- --week 2026-04-20 --allow-stale

--competition 267979,270559   Default: all five domestic leagues
--pack preview|review|stories|all   Default: all
--week YYYY-MM-DD            Any day in the Monday–Sunday coverage week
--previous                   Previous week (cannot combine with --week)
--timezone America/Toronto   Posting slots AND fixture dates; DST aware
--formats feed,story         Default: feed; separate carousel per format
--no-render                  Write a separate draft calendar; no browser needed
--allow-stale                Archive/review export only; never marks stale packs ready
--out PATH --handle TEXT --now ISO_TIMESTAMP

Wednesday preview / following Monday roundup / Tuesday match timelines.
No Instagram calls are made. Missing standings/events are reported in each pack.`)
  process.exit(0)
}

let renderer
let lock
try {
  const now = args.now || new Date().toISOString()
  if (!Number.isFinite(Date.parse(now)) || (args.now && !/(Z|[+-]\d{2}:\d{2})$/.test(now))) throw new Error('--now needs a timestamp with a timezone.')
  if (args.week && args.previous) throw new Error('Choose --week or --previous.')
  if (!['all', 'preview', 'review', 'stories'].includes(args.pack)) throw new Error('Unknown pack type.')
  const formats = [...new Set(args.formats.split(','))]
  if (!formats.length || formats.some((f) => !['feed', 'story'].includes(f))) throw new Error('Formats must be feed and/or story.')
  const ids = args.competition?.split(',') || DOMESTIC_LEAGUES.map((league) => league.id)
  if (ids.some((id) => !DOMESTIC_LEAGUES.some((league) => league.id === id))) throw new Error('Unknown domestic competition ID.')
  const leagues = DOMESTIC_LEAGUES.filter((league) => ids.includes(league.id))
  const start = args.week ? mondayOf(args.week) : addDays(mondayOf(dateInZone(now, args.timezone)), args.previous ? -7 : 0)
  const end = addDays(start, 7)
  const weeks = []
  // Validate the entire input batch before writing anything.
  for (const league of leagues) {
    const directory = join(root, 'data', league.id)
    const index = await readJson(join(directory, 'index.json'))
    const chosen = index.matches.filter((match) => {
      if (!Number.isFinite(Date.parse(match.kickoff))) throw new Error(`Fixture ${match.id} has an invalid date.`)
      const date = fixtureDate(match, args.timezone)
      return date >= start && date < end
    })
    const matches = await Promise.all(chosen.map(async (row) => {
      if (!/^\d+$/.test(row.id)) throw new Error('Match IDs must be numeric.')
      const match = createMatch(await readJson(join(directory, 'matches', `${row.id}.json`)))
      if (match.id !== row.id || match.competition.id !== league.id) throw new Error(`Mismatched fixture: ${row.id}`)
      if (match.kickoff !== row.kickoff || match.status !== row.status) throw new Error(`Index/detail mismatch for ${row.id}; refresh before exporting.`)
      return match
    }))
    const year = matches.find((m) => m.status === 'final')?.season.year
    const rawTable = year && index.tables.includes(year) ? await readJson(join(directory, `table-${year}.json`)) : null
    const week = buildWeek({ league, matches, table: rawTable ? createTable(rawTable) : null,
      updated: index.updated, week: start, timeZone: args.timezone, now })
    if (week.stale && !args['allow-stale']) throw new Error(`${league.short}: stale data. Refresh first, or use --allow-stale for an archive preview.`)
    weeks.push(week)
  }
  const out = resolve(root, args.out)
  await mkdir(out, { recursive: true })
  lock = join(out, '.weekly-lock')
  try { await mkdir(lock) } catch (error) { lock = null; throw new Error(`Weekly output is locked: ${error.message}`) }
  if (!args['no-render']) renderer = await createPostRenderer(root, await readJson(join(root, 'data/models/crest-plating.json'), true))
  const calendar = { schemaVersion: 1, week: start, timeZone: args.timezone,
    status: args['no-render'] ? 'draft' : 'rendered', publishingEnabled: false, leagues: [], packs: [] }
  for (const week of weeks) {
    const slots = scheduleFor(week)
    calendar.leagues.push({ id: week.league.id, name: week.league.name, warnings: week.warnings,
      recordedFixtures: week.fixtures.length, completedMatches: week.finals.length, slots })
    for (const slot of slots.filter((s) => args.pack === 'all' || args.pack === s.kind)) {
      const planned = weeklyCards(week, slot.kind)
      for (const format of formats) {
        const cards = planned.map((card) => ({ ...card, format, id: `${card.id}:${format}`,
          caption: `${week.league.name} · ${week.label}\n${card.caption}`, destination: format === 'feed' ? 'FEED' : 'STORIES',
          altText: card.caption, width: 1080, height: format === 'feed' ? 1080 : 1920, mimeType: 'image/jpeg', file: null, sha256: null, bytes: null }))
        if (cards.some((c) => [...c.caption].length > 2200)) throw new Error('Caption exceeds 2,200 characters.')
        const name = `${week.league.id}-${start}-${slot.kind}-${format}`
        const directory = join(out, name)
        const bundle = { schemaVersion: 1, status: args['no-render'] ? 'draft' : 'rendered',
          ...slot, warnings: week.warnings, dataUpdated: week.updated, handle: args.handle,
          publishingEnabled: false, cards: [] }
        if (renderer && cards.length) {
          const images = await renderer.render({ week, table: week.standings }, { handle: args.handle, timeZone: week.timeZone }, cards)
          for (const [i, bytes] of images.entries()) {
            const sha256 = digest(bytes)
            const file = `${String(i + 1).padStart(2, '0')}-${cards[i].graphicId}-${sha256.slice(0, 16)}.jpg`
            await writeAtomic(join(directory, file), bytes)
            Object.assign(cards[i], { file, sha256, bytes: bytes.length })
          }
        }
        // Match objects are renderer inputs, not publication metadata.
        bundle.cards = cards.map(({ match, ...card }) => ({ ...card, matchId: match?.id || null }))
        const manifest = args['no-render'] ? 'draft.json' : `plan-${digest(jsonText(bundle)).slice(0, 16)}.json`
        await writeAtomic(join(directory, manifest), jsonText(bundle))
        if (!args['no-render']) {
          await writeAtomic(join(directory, 'plan.json'), jsonText(bundle))
          await writeAtomic(join(directory, 'preview.html'), previewHtml(bundle, `${week.league.short} · ${slot.title} · ${week.label}`))
          await writeAtomic(join(directory, 'captions.txt'), cards.map((card) => `Carousel ${card.carousel} / slide ${card.slide}\n${card.caption}`).join('\n\n'))
        }
        calendar.packs.push({ id: `${slot.id}:${format}`, league: week.league.id, kind: slot.kind, format,
          publishAt: slot.publishAt, state: slot.state, slides: cards.length, carousels: Math.ceil(cards.length / 10), manifest: `${name}/${manifest}` })
      }
    }
  }
  const prefix = args['no-render'] ? 'draft-' : ''
  await writeAtomic(join(out, `${prefix}calendar.json`), jsonText(calendar))
  if (!args['no-render']) await writeAtomic(join(out, 'index.html'), weeklyPreview(calendar))
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`
  const rows = [['League', 'Pack', 'Publish UTC', 'Posting timezone', 'State', 'Slides', 'Format', 'Manifest'],
    ...calendar.packs.map((pack) => [DOMESTIC_LEAGUES.find((l) => l.id === pack.league).name,
      pack.kind, pack.publishAt, args.timezone, pack.state, pack.slides, pack.format, pack.manifest])]
  await writeAtomic(join(out, `${prefix}calendar.csv`), rows.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n')
  console.log(`${calendar.packs.reduce((n, p) => n + p.slides, 0)} graphics across ${calendar.packs.length} packs. Calendar: ${join(out, `${prefix}calendar.json`)}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  try { await renderer?.close() } finally { if (lock) await rmdir(lock) }
}
