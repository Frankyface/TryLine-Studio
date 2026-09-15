import { startStaticServer } from './static-server.mjs'

/** No external requests: every font, module and crest must be reproducible locally. */
export async function createPostRenderer(root, plating) {
  const { chromium } = await import('playwright')
  const server = await startStaticServer(root)
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ locale: 'en-GB', timezoneId: 'UTC' })
    const failures = []
    page.on('pageerror', (error) => failures.push(error.message))
    page.on('requestfailed', (request) => failures.push(`Asset failed: ${request.url()}`))
    page.on('response', (response) => { if (response.status() >= 400) failures.push(`Missing asset: ${response.url()}`) })
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      return url.origin === server.url || url.protocol === 'data:' ? route.continue() : route.abort()
    })
    await page.goto(`${server.url}/scripts/render.html`)
    return {
      async render(snapshot, options, cards) {
        const images = await page.evaluate(async ({ snapshot, options, cards, plating }) => {
          const [{ renderGraphic }, { SIZES, THEMES }, { setCrestPlating }] = await Promise.all([
            import('/src/render/index.js'), import('/src/render/theme.js'), import('/src/render/primitives.js'),
          ])
          setCrestPlating(plating)
          // Include the real names so accented subsets load before canvas measurement.
          const sample = JSON.stringify(snapshot)
          for (const family of ['Barlow Condensed', 'Inter']) {
            for (const weight of [400, 500, 600, 700]) {
              const loaded = await document.fonts.load(`${weight} 32px "${family}"`, sample)
              if (!loaded.length) throw new Error(`Missing font: ${family} ${weight}`)
            }
          }
          await document.fonts.ready
          const canvas = document.createElement('canvas')
          // Keep canvas on the CPU. Chromium may otherwise switch from GPU to
          // CPU after a readback, producing different image hashes on a retry.
          canvas.getContext('2d', { willReadFrequently: true })
          const output = []
          for (const card of cards) {
            await renderGraphic(canvas, card.graphicId, { ...snapshot, match: card.match || snapshot.match,
              options: { ...options, ...card.options },
              size: SIZES[card.format], theme: THEMES[card.themeId] })
            output.push(canvas.toDataURL('image/jpeg', 0.94))
          }
          return output
        }, { snapshot, options, cards, plating })
        if (failures.length) throw new Error(`Render failed: ${[...new Set(failures)].join('; ')}`)
        return images.map((url) => {
          if (!url.startsWith('data:image/jpeg;base64,')) throw new Error('Renderer did not produce a JPEG.')
          const bytes = Buffer.from(url.split(',')[1], 'base64')
          if (bytes.length > 8 * 1024 * 1024) throw new Error('JPEG exceeds 8 MB.')
          return bytes
        })
      },
      async close() { try { await browser.close() } finally { await server.close() } },
    }
  } catch (error) {
    try { await browser?.close() } finally { await server.close() }
    throw error
  }
}
