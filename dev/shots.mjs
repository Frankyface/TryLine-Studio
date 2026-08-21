/**
 * Visual verification: render every graphic in every format through a real
 * browser and write the PNGs to dev/shots/.
 *
 * This is the project's proof that a change looks right, not just that it ran.
 * Usage: node dev/shots.mjs [--theme midnight] [--only result] [--url ...]
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'shots')

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const theme = arg('theme', 'midnight')
const only = arg('only', '')
const baseUrl = arg('url', 'http://localhost:4321/dev/preview')
const scaleDown = Number(arg('scale', '0.5'))

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })

const consoleErrors = []
const missingCrests = new Set()

/**
 * Not every club has a crest on ESPN's CDN, so a 404 there is an expected data
 * gap the monogram fallback handles. Anything else is a real error.
 */
page.on('response', (response) => {
  if (response.status() >= 400 && /a\.espncdn\.com\/i\/teamlogos/.test(response.url())) {
    missingCrests.add(response.url())
  }
})
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const text = message.text()
  if (/Failed to load resource/.test(text) && missingCrests.size) return
  consoleErrors.push(text)
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

const url = `${baseUrl}?theme=${theme}${only ? `&only=${only}` : ''}`
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.body.dataset.renderState, null, { timeout: 30000 })

const state = await page.evaluate(() => ({
  state: document.body.dataset.renderState,
  status: document.getElementById('status').textContent,
  ids: [...document.querySelectorAll('canvas')].map((c) => c.id),
}))

if (state.state !== 'done') {
  process.stderr.write(`Render failed: ${state.status}\n`)
  await browser.close()
  process.exit(1)
}

/** Downscale in-page so the written files stay small enough to eyeball quickly. */
for (const id of state.ids) {
  const dataUrl = await page.evaluate(([canvasId, factor]) => {
    const source = document.getElementById(canvasId)
    const target = document.createElement('canvas')
    target.width = Math.round(source.width * factor)
    target.height = Math.round(source.height * factor)
    const ctx = target.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, target.width, target.height)
    return target.toDataURL('image/png')
  }, [id, scaleDown])

  const base64 = dataUrl.split(',')[1]
  writeFileSync(join(outDir, `${id}.png`), Buffer.from(base64, 'base64'))
}

await browser.close()

process.stdout.write(`${state.status}\n`)
process.stdout.write(`wrote ${state.ids.length} png(s) to dev/shots (theme: ${theme}, scale: ${scaleDown})\n`)
if (consoleErrors.length) {
  process.stdout.write(`console errors:\n  ${consoleErrors.join('\n  ')}\n`)
  process.exit(1)
}
