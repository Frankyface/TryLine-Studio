import { describe, it, expect, afterAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadSnapshot, renderOptions, makeBundle, previewHtml, writeAtomic } from '../scripts/lib/post-bundle.mjs'
import { createMatch } from '../src/data/schema.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'tryline-post-tests-'))
const run = (args) => promisify(execFile)(process.execPath, ['scripts/build-post-plan.mjs', ...args], {
  cwd: root, timeout: 20000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(temp, 'no-browser') },
})
afterAll(async () => {
  if (!resolve(temp).startsWith(join(tmpdir(), 'tryline-post-tests-'))) throw new Error('Unexpected test directory')
  await rm(temp, { recursive: true, force: true })
})

describe('posting bundles', () => {
  it('loads the matching season rather than the latest table on disk', async () => {
    const dir = join(temp, 'data', '123')
    await mkdir(join(dir, 'matches'), { recursive: true })
    await writeFile(join(dir, 'index.json'), JSON.stringify({ updated: '2026-09-14T12:00Z' }))
    await writeFile(join(dir, 'matches', '456.json'), JSON.stringify({ id: '456', competition: { id: '123' }, season: { year: 2025 } }))
    await writeFile(join(dir, 'table-2025.json'), JSON.stringify({ season: { year: 2025 } }))
    await writeFile(join(dir, 'table-2027.json'), JSON.stringify({ season: { year: 2027 } }))
    expect((await loadSnapshot(join(temp, 'data'), '123', '456')).table.season.year).toBe(2025)
    await expect(loadSnapshot(join(temp, 'data'), '../', '456')).rejects.toThrow(/numeric/)
    expect(await loadSnapshot(join(temp, 'data'), '123', '999')).toBeNull()
    await writeFile(join(dir, 'matches', '457.json'), JSON.stringify({ id: 'different' }))
    await expect(loadSnapshot(join(temp, 'data'), '123', '457')).rejects.toThrow(/mismatched/)
    await writeFile(join(dir, 'table-2025.json'), '{bad')
    await expect(loadSnapshot(join(temp, 'data'), '123', '456')).rejects.toThrow(/Cannot read/)
  })

  it('gives stable post IDs across format choices but different IDs for different subjects', async () => {
    const snapshot = await loadSnapshot(join(root, 'data'), '180659', '602502')
    const options = renderOptions(snapshot.match)
    const both = makeBundle(snapshot, options, ['feed', 'story'])
    const feed = makeBundle(snapshot, options, ['feed'])
    expect(feed.cards.map((c) => c.id)).toEqual(both.cards.filter((c) => c.format === 'feed').map((c) => c.id))
    const away = makeBundle(snapshot, renderOptions(snapshot.match, { side: 'away' }), ['feed'])
    expect(away.cards.find((c) => c.graphicId === 'teamsheet').id).not.toBe(feed.cards.find((c) => c.graphicId === 'teamsheet').id)
    expect(both.cards.every((c) => c.file === null && c.sha256 === null)).toBe(true)
    expect(both.cards.find((c) => c.format === 'story').destination).toBe('STORIES')
    expect(new Set(both.cards.map((c) => c.id)).size).toBe(both.cards.length)
    expect(previewHtml(both, '<script>alert(1)</script>')).not.toContain('<script>')
  })

  it('selects a supported scoring headline instead of defaulting to the first prop', () => {
    const match = createMatch({ status: 'final', home: { score: 13, squad: [
      { id: 'prop', name: 'Prop', jersey: 1, stats: { tackles: 2, points: 0 } },
      { id: 'kicker', name: 'Kicker', jersey: 10, stats: { points: 13 } },
    ] } })
    expect(renderOptions(match).player.id).toBe('kicker')
  })

  it('writes draft plans without an installed browser and never overwrites rendered files', async () => {
    const out = join(temp, 'drafts')
    await writeAtomic(join(out, 'queue.json'), 'existing rendered queue')
    await run(['--match', '602502,602503', '--no-render', '--out', out])
    const queue = JSON.parse(await readFile(join(out, 'queue-draft.json'), 'utf8'))
    expect(queue.status).toBe('planned')
    expect(queue.bundles).toHaveLength(2)
    expect(await readFile(join(out, 'queue.json'), 'utf8')).toBe('existing rendered queue')
    const bundle = JSON.parse(await readFile(join(out, queue.bundles[0].manifest), 'utf8'))
    expect(bundle.cards.every((card) => card.file === null)).toBe(true)
    expect(await readdir(join(out, '180659-602502-final'))).not.toContain('plan.json')
    expect(await readdir(out)).not.toContain('.render-lock')
  })

  it('fails closed for stale batch data', async () => {
    await expect(run(['--recent', '--competition', '180659', '--now', '2099-01-01T00:00Z', '--no-render']))
      .rejects.toMatchObject({ stderr: expect.stringContaining('old') })
  })

  it.each([['--match'], ['--match', '../1'], ['--match', '602502', '--formats', 'portrait'],
      ['--recent', '--limit', '0'], ['--recent', '--now', '2026-09-14T12:00'],
      ['--match', '602502', '--timezone', 'Bogus/Zone'], ['--unknown']].map((args) => [args]))('rejects invalid CLI arguments %o', async (args) => {
      await expect(run(args)).rejects.toHaveProperty('code', 1)
  })

  it('selects an archive window reproducibly only with the explicit stale override', async () => {
    const out = join(temp, 'batch')
    const args = ['--recent', '--competition', '180659', '--now', '2026-02-08T00:00:00Z',
      '--allow-stale', '--no-render', '--limit', '2', '--out', out]
    await run(args)
    const first = await readFile(join(out, 'queue-draft.json'), 'utf8')
    await run(args)
    expect(await readFile(join(out, 'queue-draft.json'), 'utf8')).toBe(first)
    expect(JSON.parse(first).bundles.map((b) => b.match)).toEqual(['602504', '602503'])
  })
})
