/**
 * League table. Rugby columns, not football ones: bonus points and points
 * difference earn their place, goal difference does not exist.
 */
import { FONTS, scale } from '../theme.js'
import {
  drawText, drawCrest, loadCrestImage, truncateText, withAlpha, fillRoundRect, drawDivider, crestFallback,
} from '../primitives.js'
import { contentBox, drawFrame, drawEyebrow, drawFooter, resolveAccent } from '../frame.js'
import { formLetters } from '../format.js'

export const meta = Object.freeze({
  id: 'table',
  label: 'League table',
  description: 'Standings with bonus points and points difference.',
  needs: 'table',
  requiresSquad: false,
})

/** Win/loss keep their universal meaning; draws follow the theme. */
const formColor = (letter, theme) => {
  if (letter === 'W') return '#25D07A'
  if (letter === 'L') return '#E5344A'
  return theme.inkMuted
}

/** Column layout as fractions of the content width, so both formats share it. */
const COLUMNS = Object.freeze([
  { key: 'played', label: 'P', at: 0.555 },
  { key: 'won', label: 'W', at: 0.635 },
  { key: 'drawn', label: 'D', at: 0.705 },
  { key: 'lost', label: 'L', at: 0.775 },
  { key: 'pointsDifference', label: 'PD', at: 0.875, signed: true },
  { key: 'bonusPoints', label: 'BP', at: 0.945 },
  { key: 'points', label: 'PTS', at: 1, strong: true },
])

/** Right edge of the form dots, as a fraction of content width. */
const FORM_RIGHT_AT = 0.50

const signedValue = (value) => (value > 0 ? `+${value}` : String(value))

function drawFormRun(ctx, size, theme, { form, x, y, height }) {
  const letters = formLetters(form).slice(-5)
  const dot = Math.min(scale(size, 14), height * 0.3)
  const gap = scale(size, 6)
  let cursor = x - (letters.length * (dot + gap) - gap)
  for (const letter of letters) {
    fillRoundRect(ctx, cursor, y - dot / 2, dot, dot, dot / 2, formColor(letter, theme))
    cursor += dot + gap
  }
}

export async function draw(ctx, { table, size, theme, options = {} }) {
  if (!table || !table.rows.length) throw new Error('No table data to render')

  const accent = resolveAccent(theme, { accent: options.accent })
  const box = contentBox(size)
  const isStory = size.height > size.width
  const rows = table.rows.slice(0, options.limit || (isStory ? 20 : 16))
  // Form is drawn only when the data has it. ESPN's own form column was a
  // global snapshot that contradicted the record beside it, so it is now
  // derived from match results and blanked wherever it cannot be verified.
  const hasForm = table.rows.some((row) => row.form)
  const showForm = (options.showForm === undefined ? isStory : Boolean(options.showForm)) && hasForm

  drawFrame(ctx, size, theme, { accent })
  const top = drawEyebrow(ctx, size, theme, {
    label: table.competition.name || 'Standings',
    meta: table.season.display ? `Season ${table.season.display}` : '',
    accent,
  })

  const headline = options.headline || (table.partial ? 'Pool standings' : 'Standings')
  drawText(ctx, headline, box.left, top + scale(size, 40), {
    size: scale(size, 62), weight: 700, color: theme.ink, uppercase: true, tracking: 1,
  })

  // Column headers.
  const headerY = top + scale(size, 96)
  drawText(ctx, 'Team', box.left + scale(size, 74), headerY, {
    size: scale(size, 20), weight: 700, family: FONTS.body,
    color: theme.inkFaint, tracking: 3, uppercase: true,
  })
  for (const column of COLUMNS) {
    drawText(ctx, column.label, box.left + box.width * column.at, headerY, {
      size: scale(size, 20), weight: 700, family: FONTS.body,
      color: theme.inkFaint, align: 'right', tracking: 2, uppercase: true,
    })
  }
  drawDivider(ctx, box.left, headerY + scale(size, 16), box.width, withAlpha(theme.line, 1), 2)

  const listTop = headerY + scale(size, 34)
  const listBottom = box.bottom - scale(size, 100)
  const rowHeight = (listBottom - listTop) / rows.length
  const crestBox = Math.min(scale(size, 40), rowHeight * 0.68)

  const crests = await Promise.all(rows.map((row) => loadCrestImage(row.team.logo, scale(size, 40))))

  rows.forEach((row, index) => {
    const y = listTop + index * rowHeight
    const middle = y + rowHeight / 2

    if (index % 2 === 0) {
      fillRoundRect(ctx, box.left - scale(size, 12), y, box.width + scale(size, 24),
        rowHeight, scale(size, 10), withAlpha(theme.ink, 0.04))
    }
    if (options.highlightRank && row.rank <= options.highlightRank) {
      fillRoundRect(ctx, box.left - scale(size, 12), y + rowHeight * 0.15,
        scale(size, 4), rowHeight * 0.7, 999, accent)
    }

    const valueSize = Math.min(scale(size, 27), rowHeight * 0.45)

    drawText(ctx, row.rank ?? index + 1, box.left + scale(size, 20), middle, {
      size: valueSize, weight: 700, color: theme.inkMuted, align: 'right', baseline: 'middle',
    })
    drawCrest(ctx, crests[index], box.left + scale(size, 52), middle, crestBox, {
      ...crestFallback(theme, accent, row.team.abbreviation),
    })

    const nameOptions = { size: valueSize, weight: 600, family: FONTS.body }
    // Leave room for the form dots when they are shown, or the name runs under them.
    const nameWidth = showForm
      ? box.width * FORM_RIGHT_AT - scale(size, 210)
      : box.width * COLUMNS[0].at - scale(size, 120)
    const name = truncateText(ctx, row.team.name, nameWidth, nameOptions)
    drawText(ctx, name, box.left + scale(size, 78), middle, {
      ...nameOptions, color: theme.ink, baseline: 'middle',
    })

    for (const column of COLUMNS) {
      const raw = row[column.key]
      const value = raw === null ? '-' : column.signed ? signedValue(raw) : String(raw)
      drawText(ctx, value, box.left + box.width * column.at, middle, {
        size: column.strong ? valueSize * 1.12 : valueSize,
        weight: column.strong ? 700 : 500,
        family: column.strong ? FONTS.display : FONTS.body,
        color: column.strong ? theme.ink : theme.inkMuted,
        align: 'right',
        baseline: 'middle',
      })
    }

    if (showForm) {
      drawFormRun(ctx, size, theme, {
        form: row.form, x: box.left + box.width * FORM_RIGHT_AT,
        y: middle, height: rowHeight,
      })
    }
  })

  drawFooter(ctx, size, theme, {
    left: [
      showForm ? 'PD difference  -  BP bonus  -  form: last 5' : 'PD points difference  -  BP bonus points',
      table.partial ? 'one pool only' : '',
    ].filter(Boolean).join('  -  '),
    right: options.handle || table.competition.abbreviation || '',
  })
}
