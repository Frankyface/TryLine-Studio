/**
 * Data access for the browser app.
 *
 * Everything is read from the static files in data/, refreshed by
 * scripts/fetch-data.mjs. The browser never calls ESPN: it answers 403 to any
 * browser User-Agent, and the 403 carries no CORS header so the failure looks
 * like a CORS problem rather than a block. Static files also mean the app keeps
 * working offline and loads instantly.
 */
import { createMatch, createTable, createSeason } from './schema.js'

const DATA_ROOT = 'data'

const cache = new Map()

async function getJson(path) {
  if (cache.has(path)) return cache.get(path)

  const request = fetch(path).then(async (response) => {
    if (response.status === 404) {
      throw new Error('That data is not available yet.')
    }
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`)
    return response.json()
  }).catch((error) => {
    cache.delete(path)
    throw new Error(error.message || `Could not load ${path}.`)
  })

  cache.set(path, request)
  return request
}

/** Every competition available, with match counts and which seasons have tables. */
export const loadCatalog = () => getJson(`${DATA_ROOT}/index.json`)

/** One competition's match list - light records for populating a picker. */
export const loadCompetition = (competitionId) =>
  getJson(`${DATA_ROOT}/${competitionId}/index.json`)

/** A full match: scores, venue, scoring timeline, and squads when available. */
export async function loadMatch(competitionId, matchId) {
  return createMatch(await getJson(`${DATA_ROOT}/${competitionId}/matches/${matchId}.json`))
}

/**
 * The fitted win-probability model. Returns null when it has not been fitted
 * yet, so the chart can fall back to its default coefficients.
 */
export const loadModel = () =>
  getJson(`${DATA_ROOT}/models/winprob.json`).catch(() => null)

/**
 * Per-team home and away records for one season, built by
 * scripts/build-season-stats.mjs. Absent for competitions whose archive cannot
 * support it, so the caller gets null rather than an exception.
 */
export const loadSeason = (competitionId, season) =>
  getJson(`${DATA_ROOT}/${competitionId}/season-${season}.json`)
    .then(createSeason)
    .catch(() => null)

/** A league table for one season. */
export async function loadTable(competitionId, season) {
  return createTable(await getJson(`${DATA_ROOT}/${competitionId}/table-${season}.json`))
}
