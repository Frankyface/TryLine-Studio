import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { DOMESTIC_LEAGUES } from '../src/publish/weekly.js'
import { readJson, digest } from '../scripts/lib/post-bundle.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'dev/posts/weekly-verification')
await mkdir(out, { recursive: true })
const args = ['scripts/build-weekly-packs.mjs', '--week', '2026-04-20', '--pack', 'review', '--competition', '267979', '--formats', 'feed,story',
  '--allow-stale', '--out', out, '--now', '2026-09-14T12:00:00Z']
const run = () => promisify(execFile)(process.execPath, args, { cwd: root, timeout: 120000 })
await run()
const before = await readFile(join(out, 'calendar.json'), 'utf8')
const calendar = JSON.parse(before)
const browser = await chromium.launch()
const errors = []
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
  for (const pack of calendar.packs) {
    const bundle = await readJson(join(out, pack.manifest))
    const directory = join(out, pack.manifest, '..')
    for (const card of bundle.cards) {
      const bytes = await readFile(join(directory, card.file))
      assert.equal(digest(bytes), card.sha256)
      assert.equal(bytes.length, card.bytes)
      const dimensions = await page.evaluate(async (data) => {
        const img = new Image(); img.src = data; await img.decode(); return [img.width, img.height]
      }, `data:image/jpeg;base64,${bytes.toString('base64')}`)
      assert.deepEqual(dimensions, [1080, card.format === 'feed' ? 1080 : 1920])
    }
  }
  await run()
  assert.equal(await readFile(join(out, 'calendar.json'), 'utf8'), before, 'Weekly bundle retry must be byte-identical')
  for (const league of DOMESTIC_LEAGUES) {
    for (const kind of ['review', 'stories']) {
      await page.goto(`http://127.0.0.1:4321/weekly.html?league=${league.id}&week=2026-04-20&pack=${kind}`)
      await page.waitForFunction(() => ['done', 'error'].includes(document.body.dataset.renderState))
      assert.equal(await page.getAttribute('body', 'data-render-state'), 'done', await page.locator('#status').innerText())
      const count = await page.locator('#cards canvas').count()
      assert.ok(count >= 2, `${league.short} ${kind} must produce graphics`)
      assert.match(await page.locator('#status').innerText(), /Archive preview/)
      await page.screenshot({ path: join(out, `${league.id}-${kind}.png`), fullPage: true })
    }
  }
  await page.goto('http://127.0.0.1:4321/weekly.html?league=267979&week=2026-09-21&pack=preview')
  await page.waitForFunction(() => document.body.dataset.renderState === 'done')
  assert.ok(await page.locator('#cards canvas').count())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('#pack').selectOption('review')
  await page.locator('#week').fill('2026-04-20')
  await page.locator('#controls button').click()
  await page.waitForFunction(() => document.body.dataset.renderState === 'done')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile must not overflow horizontally')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download JPEG' }).first().click()])
  assert.match(download.suggestedFilename(), /267979-2026-04-20-review-1-feed\.jpg/)
  await download.saveAs(join(out, 'mobile-download.jpg'))
  assert.deepEqual([...(await readFile(join(out, 'mobile-download.jpg'))).subarray(0, 3)], [0xff, 0xd8, 0xff])
  const [schedule] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download schedule' }).click()])
  assert.match(schedule.suggestedFilename(), /schedule\.json/)
  await page.screenshot({ path: join(out, 'mobile.png'), fullPage: true })
  await page.locator('#week').fill('2040-01-02')
  await page.locator('#controls button').click()
  await page.waitForFunction(() => document.body.dataset.renderState === 'done')
  assert.equal(await page.locator('#cards canvas').count(), 0)
  assert.equal(await page.locator('#empty').isVisible(), true)
  assert.deepEqual(errors, [])
} finally { await browser.close() }
console.log('PASS weekly packs: all five leagues, preview/review/timelines, deterministic JPEGs, mobile controls and downloads, empty weeks, zero browser errors')
