/**
 * What to post for a match, in what order, on which theme.
 *
 * This is the part of auto-posting that can be built and tested without any
 * of the parts that cannot. It is pure: a match in, an ordered list of cards
 * out. Nothing here talks to Instagram, holds a token or touches the network -
 * see docs/instagram.md for what publishing actually needs and why none of it
 * can live in a static site.
 *
 * The rules it encodes are the editorial ones:
 *
 *  - Only cards the app would actually draw. `blockingReason` already decides
 *    that for the UI, and a plan that lists a graphic the renderer refuses is
 *    a plan that fails halfway through a posting run.
 *  - A DIFFERENT theme per card, so a run does not look like one template
 *    seven times, but deterministic from the match id so the same match always
 *    produces the same plan. A rerun after a failure has to be the same run.
 *  - The most interesting card first. `matchDrama` already scores how worth
 *    posting a match is, and the same reasoning orders the cards within it.
 */
import { GRAPHIC_BY_ID, GRAPHICS } from '../render/index.js'
import { blockingReason } from '../render/availability.js'
import { THEME_LIST, SIZES } from '../render/theme.js'
import { winprobHeadline } from '../analysis/winprob.js'
import { dramaReason, matchDrama } from '../analysis/notable.js'
import { formatMatchDate, formatKickoffTime } from '../render/format.js'
import { zoneForVenue } from '../data/venue-zones.js'
import { zoneForCompetition, resolveZone } from '../data/timezones.js'

/** Unattended plans must never treat an in-progress score as a final result. */
export function planningReason(match) {
  if (!match) return 'No match selected.'
  if (!match.home?.name || !match.away?.name) return 'Both teams need names.'
  if (/\b(postponed|cancelled|canceled|abandoned|suspended)\b/i.test(match.statusDetail || '')) {
    return 'Match has been postponed, cancelled, abandoned or suspended.'
  }
  if (match.status === 'live') return 'Match is still live; wait for the final result.'
  if (!['scheduled', 'final'].includes(match.status)) return 'Match is not scheduled or final.'
  if (match.status === 'final' && ![match.home.score, match.away.score]
    .every((score) => Number.isInteger(score) && score >= 0)) return 'Final match needs two valid scores.'
  return ''
}

/** Never inherit the runner's timezone, including for touring competitions. */
export function postingTimeZone(match, override) {
  if (override) {
    if (!resolveZone(override)) throw new Error(`Use an IANA timezone, not "${override}".`)
    return override
  }
  return zoneForVenue(match?.venue) || resolveZone(zoneForCompetition(match?.competition?.id)) || 'UTC'
}

/**
 * The order cards are posted in when they are all available.
 *
 * Result first because it is the one people look for, then the story of the
 * match, then the detail. A team sheet posted before the result would be odd
 * on a finished game and is handled by the played/unplayed split below.
 */
const PLAYED_ORDER = Object.freeze(['result', 'winprob', 'comparison', 'statcard', 'teamsheet'])
const FIXTURE_ORDER = Object.freeze(['matchday', 'teamsheet'])

/**
 * Themes a run rotates through.
 *
 * Taken from the theme list rather than named here, so a theme added to the
 * app joins the rotation without a second edit - which is the mistake that
 * leaves a new theme unused everywhere except the picker.
 */
export const rotationThemes = () => THEME_LIST.map((theme) => theme.id)

/**
 * A stable number from a string, so a plan is reproducible.
 * Deliberately not `Math.random`: a retry after a half-finished run has to
 * produce the same themes, or the two halves of one matchday do not match.
 */
function seedFrom(value) {
  let hash = 0
  for (const character of String(value)) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100000007
  }
  return hash
}

/**
 * One caption per card, from the analysis the graphics already run.
 * Never invents a fact: where there is no finding, the caption is the fixture,
 * which is always true.
 */
export function captionFor(graphicId, match, model, options = {}) {
  const home = match.home?.shortName || match.home?.name || 'Home'
  const away = match.away?.shortName || match.away?.name || 'Away'
  const played = match.status === 'final' && Number.isFinite(match.home?.score) && Number.isFinite(match.away?.score)
  const scoreline = played ? `${home} ${match.home.score}-${match.away.score} ${away}` : `${home} v ${away}`

  if (graphicId === 'winprob') {
    const finding = winprobHeadline(match, model)
    return finding ? `${finding}. ${scoreline}` : scoreline
  }
  if (graphicId === 'result') {
    const why = dramaReason(match, matchDrama(match, model))
    return why ? `${why}. ${scoreline}` : scoreline
  }
  if (graphicId === 'matchday') {
    const timeZone = postingTimeZone(match, options.timeZone)
    const date = formatMatchDate(match.kickoff, { withYear: true, timeZone })
    const time = formatKickoffTime(match.kickoff, { timeZone })
    return [scoreline, date, time ? `Kick-off ${time} (${timeZone})` : 'Kick-off time TBC', match.venue?.name]
      .filter(Boolean).join('\n')
  }
  if (graphicId === 'statcard' && options.player) return `${options.player.name} — player stats. ${scoreline}`
  if (graphicId === 'teamsheet') return `${match[options.side === 'away' ? 'away' : 'home'].name} — team sheet. ${scoreline}`
  return scoreline
}

/**
 * The cards to post for one match.
 *
 * `snapshot` is what `blockingReason` needs - `{ match, table, season, source }` -
 * so the plan refuses exactly what the app refuses. `options` is the render
 * options those graphics would be given.
 */
export function planFor(snapshot = {}, { model, options = {}, formats = ['feed', 'story'] } = {}) {
  if (!Array.isArray(formats) || !formats.length || formats.some((format) => !Object.hasOwn(SIZES, format))) {
    throw new Error('Formats must contain feed and/or story.')
  }
  const match = snapshot.match
  if (planningReason(match)) return []

  const played = match.status === 'final'
  const wanted = played ? PLAYED_ORDER : FIXTURE_ORDER
  const themes = rotationThemes()
  const seed = seedFrom(match.id || `${match.home?.name}-${match.away?.name}`)

  // Both where the rotation STARTS and how far it steps come from the match,
  // so two matches on the same day do not run through the themes in the same
  // order. Stepping by a fixed one meant any two matches whose seeds landed on
  // the same residue produced an identical run - one chance in seven. The step
  // is never a multiple of the theme count, so consecutive cards still differ.
  const step = 1 + (seed % Math.max(1, themes.length - 1))

  const cards = []
  for (const graphicId of wanted) {
    const graphic = GRAPHIC_BY_ID[graphicId]
    if (!graphic) continue
    if (blockingReason(graphic, snapshot, options)) continue

    for (const format of new Set(formats)) {
      // Advanced per CARD, not per graphic, so a feed and a story of the same
      // graphic do not arrive as a matching pair either.
      const themeId = themes[(seed + cards.length * step) % themes.length]
      cards.push({
        graphicId,
        format,
        themeId,
        caption: captionFor(graphicId, match, model, options),
        order: cards.length + 1,
      })
    }
  }
  return cards
}

/**
 * Every graphic the plan could ever include, for anyone checking coverage.
 * Exported so a test can assert the orders above name real graphics - a typo
 * in one of those strings would silently drop a card from every plan.
 */
export const plannableGraphics = Object.freeze([...new Set([...PLAYED_ORDER, ...FIXTURE_ORDER])])

export const knownGraphicIds = Object.freeze(GRAPHICS.map((graphic) => graphic.meta.id))
