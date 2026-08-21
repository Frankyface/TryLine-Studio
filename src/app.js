/**
 * App wiring: pick a match, choose a graphic, draw both previews, export.
 *
 * State is replaced rather than mutated, and every change funnels through
 * setState so one code path decides when to redraw.
 */
import {
  loadCatalog, loadCompetition, loadMatch, loadTable, loadModel, loadSeason,
} from './data/client.js'
import { TIME_ZONES, LOCAL_ZONE, zoneForCompetition, resolveZone } from './data/timezones.js'
import { buildManualMatch, parseSquadText, parseTableText } from './data/manual.js'
import { readCrestFile } from './data/crest.js'
import { loadManualState, saveManualState, clearManualState, PERSISTED_FIELDS } from './data/manual-store.js'
import { loadPrefs, savePrefs } from './data/prefs.js'
import { SIZES, THEME_LIST, THEMES } from './render/theme.js'
import { GRAPHICS, GRAPHIC_BY_ID, renderGraphic } from './render/index.js'
import { exportOne, exportSet } from './export/png.js'
import { blockingReason, usesSide } from './render/availability.js'
import { formatMatchDate } from './render/format.js'

const $ = (id) => document.getElementById(id)
const canvases = { feed: $('canvas-feed'), story: $('canvas-story') }

const MATCH_LIST_LIMIT = 300

let state = Object.freeze({
  source: 'live',
  graphicId: 'result',
  themeId: 'midnight',
  competitionId: '',
  competition: null,
  model: null,
  crests: { homeCrest: '', awayCrest: '' },
  match: null,
  table: null,
  season: null,
})

const setState = (patch) => {
  state = Object.freeze({ ...state, ...patch })
  render()
}

/**
 * Renders are async and can finish out of order: a render started before a
 * competition change can complete after it and overwrite the newer status with
 * stale text. Only the most recently started render may report.
 */
let renderToken = 0

function setStatus(message, tone = '') {
  const status = $('status')
  status.textContent = message
  status.dataset.tone = tone
}

/** Report only if this render is still the current one. */
const reportIfCurrent = (token, message, tone) => {
  if (token === renderToken) setStatus(message, tone)
}

/* ---------- options ---------- */

function playerFromSelect(selectId, side) {
  if (!state.match) return null
  const squad = state.match[side]?.squad || []
  return squad.find((p) => String(p.id || p.jersey) === $(selectId).value) || squad[0] || null
}

const currentSide = () => ($('side').value === 'away' ? 'away' : 'home')

function currentPlayer() {
  return playerFromSelect('player', currentSide())
}

/**
 * The opponent for a player-versus-player comparison, taken from the other
 * side so the card is always a genuine head-to-head.
 */
function opposingPlayer() {
  return playerFromSelect('player-b', currentSide() === 'home' ? 'away' : 'home')
}

function currentOptions() {
  const timeText = $('time-text').value.trim()
  return {
    side: $('side').value,
    mode: $('mode').value,
    player: currentPlayer(),
    playerB: opposingPlayer(),
    accent: $('accent-auto').checked ? '' : $('accent').value,
    handle: $('handle').value.trim(),
    timeZone: resolveZone($('timezone').value),
    model: state.model,
    dateText: $('date-text').value.trim() || undefined,
    timeText: timeText || undefined,
    timeLabel: timeText ? `${timeText} kick off` : undefined,
  }
}

/* ---------- rendering ---------- */

async function render() {
  renderToken += 1
  const token = renderToken

  // Snapshot the state up front. render() awaits the canvas draw, and a
  // concurrent selectTable() can replace state while that await is pending -
  // reading state.season afterwards then threw on a null that the guard above
  // had already checked.
  const { match, table, season } = state
  const graphic = GRAPHIC_BY_ID[state.graphicId]
  const theme = THEMES[state.themeId]
  const options = currentOptions()
  const needsTable = graphic.meta.needs === 'table'
  const needsSeason = graphic.meta.needs === 'season'

  const comparingPlayers = graphic.meta.id === 'comparison' && $('mode').value === 'players'
  // Shown only where the graphic actually reads it. It was previously visible
  // on four graphics whose output is byte-identical either way.
  document.querySelector('[data-option="side"]').hidden = !usesSide(graphic, options)
  document.querySelector('[data-option="mode"]').hidden = graphic.meta.id !== 'comparison'
  syncGraphicChips(options)
  document.querySelector('[data-option="player"]').hidden = !graphic.meta.requiresPlayer && !comparingPlayers
  document.querySelector('[data-option="player-b"]').hidden = !comparingPlayers

  const blocked = blockingReason(graphic, { match, table, season, source: state.source }, options)
  if (blocked) {
    clearCanvases()
    reportIfCurrent(token, blocked, 'error')
    return
  }

  reportIfCurrent(token, `Drawing ${graphic.meta.label.toLowerCase()}...`)

  try {
    await Promise.all(Object.entries(canvases).map(([sizeId, canvas]) => renderGraphic(
      canvas,
      state.graphicId,
      { match, table, season, size: SIZES[sizeId], theme, options },
    )))
    let subject
    if (needsSeason) {
      subject = `${season.competition.name || ''} ${season.season.display || ''}`.trim()
    } else if (needsTable) {
      subject = `${table.competition.name || 'Table'} ${table.season.display || ''}`.trim()
    } else {
      subject = `${match.home.shortName} v ${match.away.shortName}`
    }
    reportIfCurrent(token, `${graphic.meta.label} - ${subject}`, 'ok')
  } catch (error) {
    reportIfCurrent(token, error.message, 'error')
  }
}

/** Blank both previews, so an error never sits on top of the last good graphic. */
function clearCanvases() {
  for (const canvas of Object.values(canvases)) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
  }
}


/**
 * Mark chips that cannot be drawn from the current data, with the reason as a
 * tooltip. Every chip used to look identical, so on a competition with no
 * table, squads or season records six of nine failed only once clicked.
 */
function syncGraphicChips(options) {
  const snapshot = { ...state, source: state.source }
  for (const chip of document.querySelectorAll('[data-graphic]')) {
    const graphic = GRAPHIC_BY_ID[chip.dataset.graphic]
    if (!graphic) continue
    const reason = blockingReason(graphic, snapshot, options)
    chip.classList.toggle('is-unavailable', Boolean(reason))
    chip.title = reason || graphic.meta.description
  }
}

/* ---------- control population ---------- */

function fillOneSquadSelect(selectId, side) {
  const select = $(selectId)
  select.replaceChildren()
  if (!state.match) return
  for (const player of state.match[side]?.squad || []) {
    const option = document.createElement('option')
    option.value = String(player.id || player.jersey)
    option.textContent = `${player.jersey ?? '-'}  ${player.name}`
    select.append(option)
  }
}

function fillPlayerSelect() {
  const side = currentSide()
  fillOneSquadSelect('player', side)
  fillOneSquadSelect('player-b', side === 'home' ? 'away' : 'home')
}

/** Newest first - the match someone wants a graphic for is usually the last one. */
function visibleMatches() {
  const all = state.competition?.matches || []
  const filter = $('match-filter').value.trim().toLowerCase()
  const squadsOnly = $('only-squads').checked
  const statsOnly = $('only-stats').checked

  return all
    .filter((match) => (statsOnly ? match.hasStats : true))
    .filter((match) => (squadsOnly ? match.hasDetail : true))
    .filter((match) => !filter
      || match.home.name.toLowerCase().includes(filter)
      || match.away.name.toLowerCase().includes(filter))
    .sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))
    .slice(0, MATCH_LIST_LIMIT)
}

function fillMatchSelect() {
  const select = $('match')
  const previous = select.value
  const matches = visibleMatches()
  select.replaceChildren()

  for (const match of matches) {
    const option = document.createElement('option')
    option.value = match.id
    const score = match.home.score === null ? 'v' : `${match.home.score}-${match.away.score}`
    const squadMark = match.hasDetail ? ' *' : ''
    const date = formatMatchDate(match.kickoff, { timeZone: resolveZone($('timezone').value) })
    option.textContent = `${date} - ${match.home.shortName} ${score} ${match.away.shortName}${squadMark}`
    select.append(option)
  }

  select.disabled = matches.length === 0
  // replaceChildren() drops the selection; without a fallback the picker shows
  // blank while the canvas still displays the previous match.
  select.value = matches.some((m) => m.id === previous) ? previous : matches[0]?.id ?? ''
  return matches
}

/** Re-apply the filters, and redraw if that changed which match is selected. */
async function refilterMatches() {
  const previous = $('match').value
  fillMatchSelect()
  if ($('match').value !== previous) await selectMatch()
}

function fillSeasonSelect() {
  const select = $('season')
  select.replaceChildren()

  // Union of both: a competition can have season records without a table
  // (Major League Rugby), and a table without season records.
  const seasons = [...new Set([
    ...(state.competition?.tables || []),
    ...(state.competition?.seasons || []),
  ])].sort((a, b) => b - a)

  for (const season of seasons) {
    const option = document.createElement('option')
    option.value = String(season)
    option.textContent = `Season ${season}`
    select.append(option)
  }
  select.disabled = !seasons.length
}

/* ---------- data loading ---------- */

async function selectCompetition(competitionId) {
  setStatus('Loading competition...')
  // Drop the old competition's match, table and season immediately: rendering
  // one competition's data under another's name is worse than rendering nothing.
  state = Object.freeze({ ...state, match: null, table: null, season: null })
  try {
    const competition = await loadCompetition(competitionId)
    state = Object.freeze({ ...state, competitionId, competition })

    // Follow the competition's own zone until the user picks one explicitly.
    if (!$('timezone').dataset.touched) $('timezone').value = zoneForCompetition(competitionId)

    const matches = fillMatchSelect()
    fillSeasonSelect()

    // Default to the newest match that has squads, so every graphic works.
    const preferred = matches.find((m) => m.hasDetail) || matches[0]
    if (preferred) {
      $('match').value = preferred.id
      await selectMatch()
    }
    await selectTable()
  } catch (error) {
    setStatus(error.message, 'error')
  }
}

async function selectMatch() {
  const matchId = $('match').value
  if (!matchId) return
  try {
    const match = await loadMatch(state.competitionId, matchId)
    setState({ match })
    fillPlayerSelect()
  } catch (error) {
    setStatus(error.message, 'error')
  }
}

async function selectTable() {
  const season = $('season').value
  if (!season) {
    setState({ table: null, season: null })
    return
  }
  try {
    // Only ask for a season file the index says exists.
    const hasSeason = (state.competition?.seasons || []).includes(Number(season))
    const hasTable = (state.competition?.tables || []).includes(Number(season))
    const [table, seasonStats] = await Promise.all([
      hasTable ? loadTable(state.competitionId, season) : Promise.resolve(null),
      hasSeason ? loadSeason(state.competitionId, season) : Promise.resolve(null),
    ])
    setState({ table, season: seasonStats })
  } catch (error) {
    setState({ table: null, season: null })
  }
}

/* ---------- manual entry ---------- */

function readManualForm() {
  const match = buildManualMatch({
    competition: $('m-competition').value,
    round: $('m-round').value,
    venue: $('m-venue').value,
    kickoff: $('m-kickoff').value ? new Date($('m-kickoff').value).toISOString() : '',
    home: {
      name: $('m-home').value || 'Home',
      score: $('m-home-score').value,
      squad: parseSquadText($('m-home-squad').value),
      logo: state.crests.homeCrest,
    },
    away: {
      name: $('m-away').value || 'Away',
      score: $('m-away-score').value,
      squad: parseSquadText($('m-away-squad').value),
      logo: state.crests.awayCrest,
    },
    homeTries: $('m-home-tries').value,
    awayTries: $('m-away-tries').value,
  })

  // Manual mode must never fall back to the live competition's data. A club
  // clicking "League table" with an empty box was shown the Six Nations table
  // presented as their own graphic.
  const tableText = $('m-table').value.trim()
  const table = tableText
    ? parseTableText(tableText, { competition: $('m-competition').value })
    : null

  setState({ match, table, season: null })
  fillPlayerSelect()
  persistManualState()
}

/* ---------- club details, remembered locally ---------- */

let persistTimer = null

/** Debounced: typing a squad should not write to storage on every keystroke. */
function persistManualState() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const fields = Object.fromEntries(PERSISTED_FIELDS.map((id) => [id, $(id)?.value || '']))
    const result = saveManualState({ fields, crests: state.crests })
    if (!result.ok) setStatus(result.reason, 'error')
  }, 400)
}

function restoreManualState() {
  const stored = loadManualState()
  if (!stored) return
  for (const [id, value] of Object.entries(stored.fields)) {
    if ($(id)) $(id).value = value
  }
  state = Object.freeze({
    ...state,
    crests: {
      homeCrest: stored.crests.homeCrest || '',
      awayCrest: stored.crests.awayCrest || '',
    },
  })
  showCrestNote()
}

function showCrestNote() {
  const names = []
  if (state.crests.homeCrest) names.push('home')
  if (state.crests.awayCrest) names.push('away')
  $('manual-note').textContent = names.length
    ? `Saved in this browser, including the ${names.join(' and ')} crest.`
    : 'Your club details stay in this browser and are remembered next time.'
}

async function handleCrestUpload(inputId, side) {
  const [file] = $(inputId).files || []
  if (!file) return
  try {
    const dataUrl = await readCrestFile(file)
    state = Object.freeze({ ...state, crests: { ...state.crests, [side]: dataUrl } })
    showCrestNote()
    readManualForm()
  } catch (error) {
    setStatus(error.message, 'error')
    $(inputId).value = ''
  }
}

/* ---------- export ---------- */

async function runExport(sizeId) {
  const graphic = GRAPHIC_BY_ID[state.graphicId]
  const options = currentOptions()
  const blocked = blockingReason(graphic, { ...state, source: state.source }, options)
  if (blocked) {
    setStatus(`${blocked} Nothing was saved.`, 'error')
    return
  }

  const button = sizeId ? document.querySelector(`[data-export="${sizeId}"]`) : $('export-set')
  button.disabled = true
  setStatus('Rendering PNGs...')
  try {
    const payload = {
      graphicId: state.graphicId,
      match: state.match,
      table: state.table,
      season: state.season,
      theme: THEMES[state.themeId],
      options,
    }
    const saved = sizeId
      ? [await exportOne({ ...payload, size: SIZES[sizeId] })]
      : await exportSet(payload)
    setStatus(`Saved ${saved.join(' and ')}`, 'ok')
  } catch (error) {
    setStatus(error.message, 'error')
  } finally {
    button.disabled = false
  }
}

/* ---------- setup ---------- */

function buildStaticControls() {
  restoreManualState()

  for (const theme of THEME_LIST) {
    const option = document.createElement('option')
    option.value = theme.id
    option.textContent = theme.label
    $('theme').append(option)
  }

  for (const zone of TIME_ZONES) {
    const option = document.createElement('option')
    option.value = zone.id
    option.textContent = zone.label
    $('timezone').append(option)
  }
  $('timezone').value = LOCAL_ZONE

  for (const graphic of GRAPHICS) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = `chip${graphic.meta.id === state.graphicId ? ' is-active' : ''}`
    chip.dataset.graphic = graphic.meta.id
    chip.textContent = graphic.meta.label
    chip.title = graphic.meta.description
    $('graphics').append(chip)
  }
}

/** Switch between the live competition and a club's own entry. */
function applySource(source) {
  for (const button of document.querySelectorAll('[data-source]')) {
    const active = button.dataset.source === source
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-selected', String(active))
  }
  document.querySelector('[data-panel="live"]').hidden = source !== 'live'
  document.querySelector('[data-panel="manual"]').hidden = source === 'live'

  if (source === 'manual') {
    // Drop the live competition's data outright when entering manual mode.
    setState({ source, table: null, season: null })
    readManualForm()
    return
  }
  setState({ source })
  selectMatch()
  selectTable()
}

function bindEvents() {
  document.querySelectorAll('[data-source]').forEach((button) => {
    button.addEventListener('click', () => {
      applySource(button.dataset.source)
      savePrefs({ source: button.dataset.source })
    })
  })

  $('graphics').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-graphic]')
    if (!chip) return
    document.querySelectorAll('[data-graphic]').forEach((other) => {
      other.classList.toggle('is-active', other === chip)
    })
    setState({ graphicId: chip.dataset.graphic })
  })

  $('competition').addEventListener('change', () => selectCompetition($('competition').value))
  $('match').addEventListener('change', selectMatch)
  $('season').addEventListener('change', selectTable)
  $('match-filter').addEventListener('input', refilterMatches)
  $('only-squads').addEventListener('change', refilterMatches)
  $('only-stats').addEventListener('change', refilterMatches)
  $('mode').addEventListener('change', render)
  $('player-b').addEventListener('change', render)
  $('theme').addEventListener('change', () => setState({ themeId: $('theme').value }))
  $('timezone').addEventListener('change', () => {
    $('timezone').dataset.touched = 'true'
    // The picker prints dates too, so it has to follow the zone.
    fillMatchSelect()
    render()
  })
  $('side').addEventListener('change', () => { fillPlayerSelect(); render() })

  for (const id of ['player', 'accent', 'accent-auto', 'handle', 'date-text', 'time-text']) {
    $(id).addEventListener('input', render)
  }

  // Without this the picker looks live but changes nothing.
  // The handle and theme are the same on every graphic a club ever makes.
  const prefs = loadPrefs()
  if (prefs.handle) $('handle').value = prefs.handle
  if (prefs.theme && $('theme').querySelector(`option[value="${prefs.theme}"]`)) {
    $('theme').value = prefs.theme
    setState({ themeId: prefs.theme })
  }
  const remember = (patch) => {
    const result = savePrefs(patch)
    if (!result.ok) setStatus(result.reason, 'error')
  }

  // The handle is typed a character at a time, so it is debounced like the
  // manual store. A theme is one `change` event and is written straight away.
  let handleTimer = null
  $('handle').addEventListener('input', () => {
    clearTimeout(handleTimer)
    handleTimer = setTimeout(() => remember({ handle: $('handle').value }), 400)
  })
  $('theme').addEventListener('change', () => remember({ theme: $('theme').value }))

  const syncAccentEnabled = () => { $('accent').disabled = $('accent-auto').checked }
  $('accent-auto').addEventListener('change', syncAccentEnabled)
  syncAccentEnabled()

  document.querySelectorAll('[data-panel="manual"] input, [data-panel="manual"] textarea')
    .forEach((input) => {
      if (input.type === 'file') return
      input.addEventListener('input', readManualForm)
    })

  $('m-home-crest').addEventListener('change', () => handleCrestUpload('m-home-crest', 'homeCrest'))
  $('m-away-crest').addEventListener('change', () => handleCrestUpload('m-away-crest', 'awayCrest'))

  $('m-clear').addEventListener('click', () => {
    clearManualState()
    for (const field of document.querySelectorAll('[data-panel="manual"] input, [data-panel="manual"] textarea')) {
      if (field.type !== 'file') field.value = ''
    }
    $('m-home-crest').value = ''
    $('m-away-crest').value = ''
    setState({ crests: { homeCrest: '', awayCrest: '' } })
    showCrestNote()
    readManualForm()
  })

  $('export-set').addEventListener('click', () => runExport(null))
  document.querySelectorAll('[data-export]').forEach((button) => {
    button.addEventListener('click', () => runExport(button.dataset.export))
  })
}

async function start() {
  buildStaticControls()
  bindEvents()

  // Fonts and data are independent, so they load together. Waiting for fonts
  // first delayed the first data request by about 400ms on a mobile connection.
  const fontsReady = Promise.all([
    document.fonts.load('700 100px "Barlow Condensed"'),
    document.fonts.load('600 40px "Inter"'),
  ]).then(() => document.fonts.ready).catch(() => null)

  try {
    const [catalog, model] = await Promise.all([loadCatalog(), loadModel()])
    // The first render must still wait, or it measures the fallback face.
    await fontsReady
    state = Object.freeze({ ...state, model })

    // A competition with no matches in the downloaded window would just be an
    // empty picker - the men's Rugby World Cup is between tournaments.
    const available = catalog.competitions.filter((competition) => competition.matches > 0)
    if (!available.length) {
      setStatus('No competition data available. Switch to "My own team" to enter a match yourself.', 'error')
      return
    }
    for (const competition of available) {
      const option = document.createElement('option')
      option.value = competition.id
      option.textContent = `${competition.name} (${competition.matches})`
      $('competition').append(option)
    }
    $('data-age').textContent = `Data refreshed ${formatMatchDate(catalog.updated, { withYear: true })}`
    await selectCompetition(available[0].id)

    // Restored last, so a club that works from its own team lands on its own
    // team. The manual fields are already back from storage by this point; the
    // live path needs the catalog loaded, which is why this is not earlier.
    if (loadPrefs().source === 'manual') applySource('manual')
  } catch (error) {
    setStatus(`${error.message} Switch to "My own team" to build graphics without downloaded data.`, 'error')
  }
}

start()
