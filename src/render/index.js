/**
 * Graphic registry. The app UI and the preview harness both read from here,
 * so adding a graphic means adding one import and one entry.
 */
import * as result from './graphics/result.js'
import * as matchday from './graphics/matchday.js'
import * as teamsheet from './graphics/teamsheet.js'
import * as statcard from './graphics/statcard.js'
import * as table from './graphics/table.js'
import * as winprob from './graphics/winprob.js'
import * as comparison from './graphics/comparison.js'
import * as scatter from './graphics/scatter.js'
import * as fortress from './graphics/fortress.js'

export const GRAPHICS = Object.freeze([
  result, matchday, teamsheet, statcard, table, winprob, comparison, scatter, fortress,
])

export const GRAPHIC_BY_ID = Object.freeze(
  Object.fromEntries(GRAPHICS.map((graphic) => [graphic.meta.id, graphic])),
)

/**
 * Render one graphic onto a canvas at the given size.
 * The canvas is resized to the format, cleared, then handed to the graphic.
 */
export async function renderGraphic(canvas, graphicId, {
  match, table: tableData, season, size, theme, options,
}) {
  const graphic = GRAPHIC_BY_ID[graphicId]
  if (!graphic) throw new Error(`Unknown graphic: ${graphicId}`)

  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.textRendering = 'geometricPrecision'

  await graphic.draw(ctx, { match, table: tableData, season, size, theme, options })
  return canvas
}
