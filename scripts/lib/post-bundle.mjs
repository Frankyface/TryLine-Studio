/** File boundaries for the posting CLI. No browser or network at import time. */
import { readFile, readdir, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { createMatch, createTable, createSeason } from '../../src/data/schema.js'
import { planFor, planningReason, postingTimeZone } from '../../src/publish/plan.js'
import { GRAPHIC_BY_ID } from '../../src/render/index.js'
import { SIZES } from '../../src/render/theme.js'
import { heroStat, squadPointsAgree } from '../../src/analysis/hero.js'

export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`

export async function readJson(path, optional = false) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (optional && error.code === 'ENOENT') return null
    throw new Error(`Cannot read ${path}: ${error.message}`)
  }
}

export async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, content)
    await rename(temp, path)
  } finally { await unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error }) }
}

export async function competitionIds(dataDir) {
  return (await readdir(dataDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => entry.name).sort()
}

export async function loadSnapshot(dataDir, competitionId, matchId) {
  if (!/^\d+$/.test(competitionId) || !/^\d+$/.test(matchId)) throw new Error('Competition and match IDs must be numeric.')
  const dir = join(dataDir, competitionId)
  const raw = await readJson(join(dir, 'matches', `${matchId}.json`), true)
  if (!raw) return null
  const match = createMatch(raw)
  if (match.id !== matchId || match.competition.id !== competitionId) throw new Error(`Match ${matchId} has mismatched IDs.`)
  // A 2025 match must never pick up the latest (2027) table on disk.
  const year = match.season.year
  const rawTable = year ? await readJson(join(dir, `table-${year}.json`), true) : null
  const rawSeason = year ? await readJson(join(dir, `season-${year}.json`), true) : null
  const index = await readJson(join(dir, 'index.json'))
  return { match, table: rawTable ? createTable(rawTable) : null,
    season: rawSeason ? createSeason(rawSeason) : null, source: 'espn', updated: index.updated }
}

/** Prefer a player with a supported headline over the first shirt in the XV. */
export function renderOptions(match, { model, heroStats, side = 'home', handle = '', timeZone } = {}) {
  const team = match[side]
  const squad = team.squad
  const candidates = squad.map((player, index) => ({ player, index,
    hero: heroStat(player, { benchmarks: heroStats, squadPointsReconcile: squadPointsAgree(squad, team.score) }),
  })).filter(({ player }) => Object.keys(player.stats).length)
  candidates.sort((a, b) => {
    const priority = ({ hero }) => hero?.kind === 'scoring' ? 2 : hero ? 1 : 0
    return priority(b) - priority(a) || a.index - b.index
  })
  return { side, handle, timeZone: postingTimeZone(match, timeZone),
    player: candidates[0]?.player || squad[0] || null,
    playerB: match[side === 'home' ? 'away' : 'home'].squad[0] || null,
    mode: 'teams', model, heroStats }
}

export function makeBundle(snapshot, options, formats) {
  const reason = planningReason(snapshot.match)
  if (reason) throw new Error(reason)
  const { match } = snapshot
  const phase = match.status
  const cards = planFor(snapshot, { model: options.model, options, formats }).map((card) => {
    const sideSpecific = ['teamsheet', 'statcard'].includes(card.graphicId)
    const subject = card.graphicId === 'statcard'
      ? `${options.side}-${options.player?.id || options.player?.name}` : sideSpecific ? options.side : 'match'
    const id = ['tryline', match.competition.id, match.id, phase, card.graphicId, subject, card.format]
      .map(encodeURIComponent).join(':')
    if ([...card.caption].length > 2200) throw new Error('Caption exceeds 2,200 characters.')
    return { ...card, id, destination: card.format === 'story' ? 'STORIES' : 'FEED',
      altText: `${GRAPHIC_BY_ID[card.graphicId].meta.label}: ${card.caption}`,
      width: SIZES[card.format].width, height: SIZES[card.format].height,
      mimeType: 'image/jpeg', file: null, sha256: null, bytes: null }
  })
  return { schemaVersion: 1, status: 'planned', match: match.id, competition: match.competition.id,
    phase, kickoff: match.kickoff, dataUpdated: snapshot.updated,
    timeZone: options.timeZone, handle: options.handle, side: options.side, cards }
}

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** An offline contact sheet shipped alongside the files for human review. */
export function previewHtml(bundle, title) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · TryLine Studio</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#edf2f8;font:15px/1.6 system-ui,sans-serif}
main{max-width:1380px;margin:auto;padding:40px 24px}header{border-bottom:1px solid #334155;margin-bottom:32px;padding-bottom:24px}
small{color:#54e49c;letter-spacing:.12em;text-transform:uppercase}h1{font-size:clamp(24px,4vw,40px);margin:8px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:24px;align-items:start}
article{background:#151f30;border:1px solid #334155;border-radius:12px;overflow:hidden}img{display:block;width:100%;height:auto}
.details{padding:18px}h2{font-size:16px;margin:0 0 8px}p{color:#b8c5d8}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
a{color:#54e49c}details{font-size:12px;color:#b8c5d8;overflow-wrap:anywhere}</style><main>
<header><small>TryLine Studio · Posting preview</small><h1>${escape(title)}</h1>
<p>${bundle.cards.length} graphics · ${escape(bundle.timeZone)} · ${escape(bundle.status)}. Review captions and images before publishing.</p>
${bundle.state ? `<p>Readiness: ${escape(bundle.state)} · Planned slot: ${escape(bundle.publishAt)}. Publishing is not connected.</p>` : ''}
${bundle.warnings?.length ? `<ul>${bundle.warnings.map((warning) => `<li>${escape(warning)}</li>`).join('')}</ul>` : ''}
<a href="plan.json">Download posting manifest</a></header><section class="grid">${bundle.cards.map((card) => `
<article><a href="${escape(card.file)}"><img src="${escape(card.file)}" width="${card.width}" height="${card.height}" alt="${escape(card.altText)}" loading="lazy"></a>
<div class="details"><small>${escape(card.format)} · ${card.width} × ${card.height}${card.carousel ? ` · Carousel ${card.carousel}, slide ${card.slide}` : ''}</small><h2>${card.order}. ${escape(GRAPHIC_BY_ID[card.graphicId].meta.label)}</h2>
<pre>${escape(card.caption)}</pre><a href="${escape(card.file)}" download>Download JPEG</a>
<details><summary>Post details</summary>${escape(card.id)}<br>${escape(card.sha256)}</details></div></article>`).join('')}
</section></main></html>`
}
