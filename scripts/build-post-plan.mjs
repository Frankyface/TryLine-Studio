/** Build reviewable Instagram assets. This command never publishes anything. */
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { mkdir, rmdir } from 'node:fs/promises'
import { selectMatches, freshnessReason } from '../src/publish/queue.js'
import { readJson, writeAtomic, competitionIds, loadSnapshot, renderOptions,
  makeBundle, jsonText, digest, previewHtml } from './lib/post-bundle.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = join(root, 'data')
const HELP = `TryLine Studio posting bundles (no Instagram calls)

  npm run plan -- --match 602502
  npm run plan -- --match 602502,602503 --formats feed --handle @myclub
  npm run plan -- --recent --competition 180659 --phase final --limit 3
  npm run plan -- --recent --phase scheduled --lookahead-hours 48
  npm run plan -- --match 602502 --no-render

Options:
  --match <ids>             One or more comma-separated match IDs
  --recent                  Select matches by kickoff window (not finish time)
  --competition <id>        Restrict to one competition
  --phase final|scheduled   Batch selection; default final (never live)
  --lookback-hours <n>      Final matches kicked off within n hours; default 24
  --lookahead-hours <n>     Scheduled matches in the next n hours; default 24
  --limit <n>               Maximum matches in a batch, 1–100; default 5
  --max-age-hours <n>       Batch data freshness limit; default 48
  --allow-stale             Explicitly allow archive data for batch previews
  --now <ISO timestamp>     Fixed clock for reproducible archive selection
  --formats feed,story      Formats to render; default both
  --side home|away          Team sheet and featured player's team; default home
  --handle <handle>         Printed on the graphic
  --timezone <IANA zone>    Override venue/competition time (fallback UTC)
  --out <directory>         Output directory; default dev/posts
  --no-render              JSON draft only: no browser, server, or image files
  --help                    Show this help

Rendered bundles contain JPEGs, captions, preview.html, and plan.json.
queue.json references immutable manifests for the complete batch.
Drafts use separate filenames and cannot be mistaken for rendered bundles.
`

async function main() {
  const { values: args } = parseArgs({ options: {
    match: { type: 'string' }, recent: { type: 'boolean' }, competition: { type: 'string' },
    phase: { type: 'string', default: 'final' }, limit: { type: 'string', default: '5' },
    'lookback-hours': { type: 'string', default: '24' }, 'lookahead-hours': { type: 'string', default: '24' },
    'max-age-hours': { type: 'string', default: '48' }, 'allow-stale': { type: 'boolean' },
    now: { type: 'string' }, formats: { type: 'string', default: 'feed,story' },
    side: { type: 'string', default: 'home' }, handle: { type: 'string', default: '' },
    timezone: { type: 'string' }, out: { type: 'string', default: 'dev/posts' },
    'no-render': { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (args.help) { console.log(HELP); return }
  if (Boolean(args.match) === Boolean(args.recent)) throw new Error('Choose either --match <ids> or --recent. Use --help for examples.')
  if (!['home', 'away'].includes(args.side)) throw new Error('Side must be home or away.')
  const formats = [...new Set(args.formats.split(',').map((s) => s.trim()))]
  if (formats.some((s) => !['feed', 'story'].includes(s))) throw new Error('Formats must contain feed and/or story.')
  if (args.handle && !/^@?[\w.]{1,30}$/.test(args.handle)) throw new Error('Handle must contain 1–30 letters, digits, periods or underscores.')
  const now = args.now || new Date().toISOString()
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(now) || !Number.isFinite(Date.parse(now))) throw new Error('--now must be an ISO timestamp with a timezone.')
  const selection = { now, phase: args.phase, lookbackHours: Number(args['lookback-hours']),
    lookaheadHours: Number(args['lookahead-hours']), limit: Number(args.limit) }
  selectMatches([], selection)
  const maxAge = Number(args['max-age-hours'])
  freshnessReason(now, now, maxAge)
  const available = await competitionIds(dataDir)
  if (args.competition && !available.includes(args.competition)) throw new Error(`Unknown competition: ${args.competition}`)
  const competitions = args.competition ? [args.competition] : available
  const snapshots = []
  const warnings = []
  if (args.match) {
    const ids = [...new Set(args.match.split(',').map((s) => s.trim()))]
    if (ids.some((id) => !/^\d+$/.test(id))) throw new Error('Match IDs must be numeric.')
    for (const id of ids) {
      let found
      for (const competition of competitions) {
        const snapshot = await loadSnapshot(dataDir, competition, id)
        if (snapshot) {
          if (found) throw new Error(`Match ${id} exists in multiple competitions; use --competition.`)
          found = snapshot
        }
      }
      if (!found) throw new Error(`No match ${id} in data/.`)
      snapshots.push(found)
      const reason = freshnessReason(found.updated, now, maxAge)
      if (reason) warnings.push(`${id}: ${reason} Explicit match selection is an archive preview.`)
    }
  } else {
    const candidates = []
    for (const competition of competitions) {
      const index = await readJson(join(dataDir, competition, 'index.json'))
      const reason = freshnessReason(index.updated, now, maxAge)
      if (reason && !args['allow-stale']) throw new Error(`${index.name || competition}: ${reason}`)
      if (reason) warnings.push(`${competition}: ${reason}`)
      for (const match of index.matches || []) candidates.push({ ...match, competition: { id: competition } })
    }
    for (const match of selectMatches(candidates, selection)) {
      const snapshot = await loadSnapshot(dataDir, match.competition.id, match.id)
      if (!snapshot) throw new Error(`Index lists missing match ${match.id}. Run npm run refresh.`)
      if (!selectMatches([snapshot.match], { ...selection, limit: 1 }).length) {
        throw new Error(`Match ${match.id} disagrees with its index. Run npm run refresh.`)
      }
      snapshots.push(snapshot)
    }
  }

  const model = await readJson(join(dataDir, 'models', 'winprob.json'), true)
  const heroStats = await readJson(join(dataDir, 'models', 'hero-stats.json'), true)
  const jobs = snapshots.map((snapshot) => {
    const options = renderOptions(snapshot.match, { model, heroStats, side: args.side,
      handle: args.handle, timeZone: args.timezone })
    return { snapshot, options, bundle: makeBundle(snapshot, options, formats) }
  })
  const out = resolve(root, args.out)
  await mkdir(out, { recursive: true })
  const lock = join(out, '.render-lock')
  try { await mkdir(lock) } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another run owns ${lock}. If it crashed, remove that empty lock directory before retrying.`)
    throw error
  }
  let renderer
  try {
    const render = !args['no-render']
    if (render && jobs.length) {
      const { createPostRenderer } = await import('./lib/render-posts.mjs')
      renderer = await createPostRenderer(root)
    }
    const queue = { schemaVersion: 1, status: render ? 'rendered' : 'planned', warnings, bundles: [] }
    for (const { snapshot, options, bundle } of jobs) {
      const directory = `${bundle.competition}-${bundle.match}-${bundle.phase}`
      const bundleDir = join(out, directory)
      if (render) {
        const images = await renderer.render(snapshot, options, bundle.cards)
        for (const [index, card] of bundle.cards.entries()) {
          const bytes = images[index]
          const sha256 = digest(bytes)
          const name = `${card.graphicId}-${card.format}-${card.themeId}-${sha256.slice(0, 16)}.jpg`
          await writeAtomic(join(bundleDir, name), bytes)
          Object.assign(card, { file: name, sha256, bytes: bytes.length })
        }
        bundle.status = 'rendered'
      }
      const body = jsonText(bundle)
      const manifest = `${render ? 'plan' : 'draft'}-${digest(body).slice(0, 16)}.json`
      await writeAtomic(join(bundleDir, manifest), body)
      await writeAtomic(join(bundleDir, render ? 'plan.json' : 'draft.json'), body)
      if (render) {
        await writeAtomic(join(bundleDir, 'captions.txt'), bundle.cards.map((card) => `${card.file}\n${card.caption}`).join('\n\n'))
        await writeAtomic(join(bundleDir, 'preview.html'), previewHtml(bundle, `${snapshot.match.home.name} v ${snapshot.match.away.name}`))
      }
      queue.bundles.push({ match: bundle.match, competition: bundle.competition, manifest: `${directory}/${manifest}`,
        cards: bundle.cards.length, ...(render ? { preview: `${directory}/preview.html` } : {}) })
      console.log(`${bundle.match}: ${bundle.cards.length} ${render ? 'JPEGs' : 'planned cards'} → ${bundleDir}`)
    }
    await writeAtomic(join(out, render ? 'queue.json' : 'queue-draft.json'), jsonText(queue))
    for (const warning of warnings) console.warn(`Warning: ${warning}`)
    console.log(`${jobs.length} bundle(s) ${render ? 'rendered' : 'planned'}. Nothing published. Output: ${out}`)
  } finally {
    try { await renderer?.close() } finally { await rmdir(lock) }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
