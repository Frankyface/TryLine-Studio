import { DOMESTIC_LEAGUES, POSTING_ZONE, mondayOf, dateInZone, addDays, buildWeek, scheduleFor, weeklyCards } from './publish/weekly.js'
import { loadCompetition, loadMatch, loadTable, loadCrestPlating } from './data/client.js'
import { renderGraphic, GRAPHIC_BY_ID } from './render/index.js'
import { SIZES, THEMES } from './render/theme.js'
import { setCrestPlating } from './render/primitives.js'
import { fixtureDate } from './data/fixture-time.js'

const $ = (id) => document.getElementById(id)
let edition
let request = 0
const download = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

for (const league of DOMESTIC_LEAGUES) $('league').add(new Option(league.name, league.id))
const params = new URLSearchParams(location.search)
$('league').value = DOMESTIC_LEAGUES.some((l) => l.id === params.get('league')) ? params.get('league') : '267979'
$('week').value = params.get('week') || dateInZone(new Date())
if (['preview', 'review', 'stories'].includes(params.get('pack'))) $('pack').value = params.get('pack')
if (['feed', 'story'].includes(params.get('format'))) $('format').value = params.get('format')

async function build() {
  const revision = ++request
  document.body.dataset.renderState = 'loading'
  $('status').textContent = 'Loading the recorded fixtures…'
  $('cards').replaceChildren()
  $('empty').hidden = true
  $('notes').hidden = true
  $('calendar').disabled = true
  const league = DOMESTIC_LEAGUES.find((l) => l.id === $('league').value)
  const kind = $('pack').value
  const format = $('format').value
  const handle = $('handle').value
  try {
    const weekStart = mondayOf($('week').value)
    const weekEnd = addDays(weekStart, 7)
    $('week').value = weekStart
    const query = new URLSearchParams({ league: league.id, week: weekStart, pack: kind, format })
    history.replaceState(null, '', `?${query}`)
    const index = await loadCompetition(league.id)
    const records = index.matches.filter((m) => {
      const date = fixtureDate(m, POSTING_ZONE)
      return date >= weekStart && date < weekEnd
    })
    const matches = await Promise.all(records.map(async (row) => {
      const match = await loadMatch(league.id, row.id)
      if (match.id !== row.id || match.competition.id !== league.id || match.kickoff !== row.kickoff || match.status !== row.status) throw new Error('Fixture index and match details disagree. Refresh the data before exporting.')
      return match
    }))
    const year = matches.find((m) => m.status === 'final')?.season.year
    const table = year && index.tables.includes(year) ? await loadTable(league.id, year) : null
    const week = buildWeek({ league, matches, table, week: weekStart, updated: index.updated })
    const slots = scheduleFor(week)
    const slot = slots.find((s) => s.kind === kind)
    const cards = weeklyCards(week, kind)
    await setCrestPlating(await loadCrestPlating())
    const sample = JSON.stringify(week)
    for (const family of ['Barlow Condensed', 'Inter']) for (const weight of [400, 500, 600, 700]) await document.fonts.load(`${weight} 32px "${family}"`, sample)
    await document.fonts.ready
    if (revision !== request) return
    edition = { schemaVersion: 1, week: week.start, league, timeZone: week.timeZone, publishingEnabled: false,
      warnings: week.warnings, slots, cards: cards.map(({ match, ...card }) => ({ ...card, matchId: match?.id, format, id: `${card.id}:${format}` })) }
    $('edition-label').textContent = `${league.short} / ${week.label}`
    $('edition-title').textContent = slot.title
    const when = new Intl.DateTimeFormat('en-GB', { timeZone: POSTING_ZONE, weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(slot.publishAt))
    $('status').textContent = `${cards.length} slides · Posting slot: ${when} · Snapshot: ${index.updated.slice(0, 10)}${week.stale ? ' · Archive preview — refresh before posting' : ''}`
    $('notes').hidden = !week.warnings.length
    $('notes').querySelector('ul').replaceChildren(...week.warnings.map((warning) => {
      const li = document.createElement('li'); li.textContent = warning; return li
    }))
    $('notes').open = week.stale || week.unresolved.length > 0
    const latest = index.matches.filter((m) => m.status === 'final').sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff))[0]
    if (latest) $('latest').href = `?league=${league.id}&week=${mondayOf(dateInZone(latest.kickoff))}&pack=review`
    $('empty').hidden = Boolean(cards.length)
    const fragment = document.createDocumentFragment()
    for (const card of cards) {
      const article = document.createElement('article')
      article.className = 'card'
      const canvas = document.createElement('canvas')
      canvas.getContext('2d', { willReadFrequently: true })
      const caption = `${league.name} · ${week.label}\n${card.caption}`
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', caption)
      await renderGraphic(canvas, card.graphicId, { week, table: week.standings, match: card.match,
        size: SIZES[format], theme: THEMES[card.themeId], options: { ...card.options, handle, timeZone: week.timeZone } })
      const info = document.createElement('div')
      info.className = 'card-info'
      const order = document.createElement('small')
      order.textContent = `Carousel ${card.carousel} / slide ${card.slide}`
      const title = document.createElement('h3')
      title.textContent = GRAPHIC_BY_ID[card.graphicId].meta.label
      const actions = document.createElement('div')
      actions.className = 'card-actions'
      const save = document.createElement('button')
      save.textContent = 'Download JPEG ↓'
      save.addEventListener('click', () => canvas.toBlob((blob) => { if (blob) download(blob, `${league.id}-${week.start}-${kind}-${card.order}-${format}.jpg`) }, 'image/jpeg', .94))
      const copy = document.createElement('button')
      copy.textContent = 'Copy caption'
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(caption); copy.textContent = 'Copied ✓' }
        catch { copy.textContent = 'Select caption below' }
      })
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      summary.textContent = 'Caption'
      const pre = document.createElement('pre')
      pre.textContent = caption
      details.append(summary, pre)
      actions.append(save, copy)
      info.append(order, title, actions, details)
      article.append(canvas, info)
      fragment.append(article)
    }
    if (revision !== request) return
    $('cards').replaceChildren(fragment)
    $('calendar').disabled = false
    document.body.dataset.renderState = 'done'
  } catch (error) {
    if (revision !== request) return
    $('status').textContent = `Could not build this edition: ${error.message}`
    document.body.dataset.renderState = 'error'
  }
}
$('controls').addEventListener('submit', (event) => { event.preventDefault(); build() })
$('calendar').addEventListener('click', () => download(new Blob([JSON.stringify(edition, null, 2)], { type: 'application/json' }), `tryline-${edition.league.id}-${edition.week}-schedule.json`))
build()
