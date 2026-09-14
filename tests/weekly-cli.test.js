import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, sep } from 'node:path'

const run = (args) => promisify(execFile)(process.execPath, ['scripts/build-weekly-packs.mjs', ...args], { timeout: 30000 })

describe('weekly preparation CLI', () => {
  it.each([['--unknown'], ['--pack', 'wrong'], ['--week', '2026-02-30'], ['--competition', '1'],
    ['--week', '2026-04-20', '--previous'], ['--formats', 'png'], ['--now', '2026-01-01']])('rejects invalid input: %j', async (args) => {
    await expect(run(args)).rejects.toBeTruthy()
  })
  it('fails closed on the stale archive without requiring a browser', async () => {
    await expect(run(['--week', '2026-04-20', '--no-render', '--now', '2030-01-01T00:00:00Z'])).rejects.toMatchObject({ stderr: expect.stringMatching(/stale data/) })
  })
  it('writes stable draft calendars with all five leagues and every completed match, without overwriting rendered output', async () => {
    const out = await mkdtemp(join(tmpdir(), 'tryline-weekly-'))
    try {
      await writeFile(join(out, 'calendar.json'), 'rendered sentinel')
      const args = ['--week', '2026-04-20', '--allow-stale', '--no-render', '--out', out, '--now', '2026-09-14T12:00:00Z']
      await run(args)
      const original = await readFile(join(out, 'draft-calendar.json'), 'utf8')
      const calendar = JSON.parse(original)
      expect(calendar.leagues).toHaveLength(5)
      expect(calendar.publishingEnabled).toBe(false)
      const stories = calendar.packs.filter((p) => p.kind === 'stories')
      expect(stories.reduce((n, p) => n + p.slides, 0)).toBe(calendar.leagues.reduce((n, l) => n + l.completedMatches, 0))
      for (const pack of calendar.packs) {
        const bundle = JSON.parse(await readFile(join(out, pack.manifest), 'utf8'))
        expect(bundle.state).toBe('needs-refresh')
        expect(bundle.cards.every((c) => c.file === null && c.sha256 === null)).toBe(true)
      }
      await run(args)
      expect(await readFile(join(out, 'draft-calendar.json'), 'utf8')).toBe(original)
      expect(await readFile(join(out, 'calendar.json'), 'utf8')).toBe('rendered sentinel')
      expect(await readFile(join(out, 'draft-calendar.csv'), 'utf8')).toContain('Publish UTC')
    } finally {
      if (!resolve(out).startsWith(resolve(tmpdir()) + sep) || !out.includes('tryline-weekly-')) throw new Error('Unsafe cleanup path')
      await rm(out, { recursive: true, force: true })
    }
  })
})
