/**
 * PNG export. The brief is "Instagram-ready set", so the primary action renders
 * every format for the chosen graphic and saves them one after another.
 */
import { SIZE_LIST } from '../render/theme.js'
import { renderGraphic, GRAPHIC_BY_ID } from '../render/index.js'

/** Space consecutive saves out - browsers throttle rapid programmatic downloads. */
const DOWNLOAD_GAP_MS = 350

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

const slug = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60)

/**
 * "six-nations-france-v-ireland-result-feed.png"
 *
 * Named after what the graphic is ABOUT, taken from its own `needs` - not from
 * whatever happens to be loaded. A match graphic must not be named after a
 * season simply because season data is in memory.
 */
export function fileNameFor({ match, table, season, graphicId, sizeId }) {
  const needs = GRAPHIC_BY_ID[graphicId]?.meta?.needs || 'match'
  const context = needs === 'season' ? season : table

  const subject = needs === 'match' && match
    ? [
      match.competition.abbreviation || match.competition.name,
      match.home.shortName, 'v', match.away.shortName,
    ]
    : [context?.competition?.name || 'rugby', context?.season?.display]

  return `${slug(subject.filter(Boolean).join('-'))}-${graphicId}-${sizeId}.png`
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      // A tainted canvas is the realistic failure here - a crest served without
      // CORS headers would poison the export.
      else reject(new Error('Could not encode the image. A crest may have blocked the export.'))
    }, 'image/png')
  })
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Render one graphic at one size and save it. */
export async function exportOne({ graphicId, size, match, table, season, theme, options }) {
  const canvas = document.createElement('canvas')
  await renderGraphic(canvas, graphicId, { match, table, season, size, theme, options })
  const blob = await canvasToBlob(canvas)
  const fileName = fileNameFor({ match, table, season, graphicId, sizeId: size.id })
  saveBlob(blob, fileName)
  return fileName
}

/** Render and save every format for one graphic - the "Instagram set" button. */
export async function exportSet({ graphicId, match, table, season, theme, options, sizes = SIZE_LIST }) {
  const saved = []
  for (const size of sizes) {
    saved.push(await exportOne({ graphicId, size, match, table, season, theme, options }))
    await wait(DOWNLOAD_GAP_MS)
  }
  return saved
}
