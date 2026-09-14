/** Real renderer smoke test: offline assets, immutable batches and retry safety. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { digest, readJson, loadSnapshot, renderOptions, makeBundle } from '../scripts/lib/post-bundle.mjs'
import { createPostRenderer } from '../scripts/lib/render-posts.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = join(root, 'dev', 'posts', 'verification')
const args = ['scripts/build-post-plan.mjs', '--match', '602502,602503', '--out', out, '--handle', '@tryline']
const run = (extra = []) => promisify(execFile)(process.execPath, [...args, ...extra], { cwd: root, timeout: 120000 })
await run()
const before = await readFile(join(out, 'queue.json'), 'utf8')
const queue = JSON.parse(before)
assert.equal(queue.bundles.length, 2)
const manifests = await Promise.all(queue.bundles.map((entry) => readJson(join(out, entry.manifest))))
const allIds = manifests.flatMap((bundle) => bundle.cards.map((card) => card.id))
assert.equal(new Set(allIds).size, allIds.length)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const [index, bundle] of manifests.entries()) {
    assert.equal(bundle.status, 'rendered')
    assert.equal(bundle.timeZone, index === 0 ? 'Europe/Paris' : 'Europe/Rome')
    const directory = join(out, queue.bundles[index].manifest, '..')
    for (const card of bundle.cards) {
      const bytes = await readFile(join(directory, card.file))
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff])
      assert.equal(digest(bytes), card.sha256)
      assert.equal(bytes.length, card.bytes)
      assert.ok(bytes.length < 8 * 1024 * 1024)
      const size = await page.evaluate(async (data) => {
        const img = new Image()
        img.src = data
        await img.decode()
        return [img.naturalWidth, img.naturalHeight]
      }, `data:image/jpeg;base64,${bytes.toString('base64')}`)
      assert.deepEqual(size, [1080, card.format === 'feed' ? 1080 : 1920])
    }
  }
} finally { await browser.close() }

await run()
assert.equal(await readFile(join(out, 'queue.json'), 'utf8'), before, 'A rerun must be byte-identical')
await run(['--no-render'])
assert.equal(await readFile(join(out, 'queue.json'), 'utf8'), before, 'A draft must not overwrite a rendered queue')
assert.ok(!(await readdir(out)).includes('.render-lock'))

const snapshot = await loadSnapshot(join(root, 'data'), '180659', '602502')
const broken = { ...snapshot, match: { ...snapshot.match, home: { ...snapshot.match.home, logo: 'assets/crests/missing-test-crest.png' } } }
const options = renderOptions(broken.match)
const cards = makeBundle(broken, options, ['feed']).cards.slice(0, 1)
const renderer = await createPostRenderer(root)
try {
  await assert.rejects(renderer.render(broken, options, cards), /Missing asset|Asset failed/)
} finally { await renderer.close() }
console.log(`PASS posting pipeline: ${allIds.length} JPEGs, dimensions, hashes, unique IDs, byte-identical rerun, isolated drafts, missing-asset failure`)
