/**
 * Whether a graphic can honestly be drawn from the data in hand.
 *
 * This is the single source of truth for availability - the preview, the
 * export and the chip states all ask it the same question. It lives in its own
 * DOM-free module so it can be unit tested: while it sat inside app.js nothing
 * could import it under Node, and two separate "reports ok, draws nothing"
 * faults shipped as a result - an empty team sheet that exported happily, and
 * a player card that drew 45% blank canvas.
 */
import { canPlotTeamSeason } from '../analysis/team-season.js'
import { timelineIsComplete } from '../analysis/winprob.js'

/** A team sheet with no numbers on it is a list of names, not a stat source. */
export const squadHasStats = (squad = []) =>
  squad.some((player) => Object.keys(player.stats || {}).length > 0)

/**
 * Does the Home/Away choice change what this graphic draws?
 *
 * A boolean is not enough for the comparison graphic: in player mode the side
 * picks whose squad to list, and in team mode both squads are aggregated and
 * the output is byte-identical either way. Showing the control there implied a
 * choice that did nothing, and gating availability on it let the side flip a
 * graphic between blocked and available with nothing on the canvas changing.
 */
export function usesSide(graphic, options = {}) {
  const declared = graphic.meta.usesSide
  return typeof declared === 'function' ? Boolean(declared(options)) : Boolean(declared)
}

/** The sides whose squads must be present for this graphic to draw. */
function requiredSides(graphic, options) {
  if (!usesSide(graphic, options)) return ['home', 'away']
  return [options.side === 'away' ? 'away' : 'home']
}

/**
 * Why this graphic cannot be drawn from the current data, or '' if it can.
 * `snapshot` is `{ match, table, season, source }`.
 */
export function blockingReason(graphic, snapshot = {}, options = {}) {
  const { match, table, season, source } = snapshot
  const needs = graphic.meta.needs

  if (needs === 'table') {
    if (!table) {
      return source === 'manual'
        ? 'Paste your league table into the box above to draw this.'
        : 'No league table loaded for that season.'
    }
    return ''
  }

  if (needs === 'season') {
    if (source === 'manual') {
      return 'Home and away records cannot come from manual entry - this one needs a full league season.'
    }
    if (!season) {
      return 'No home and away records for that season. Try another season, or a league that plays home and away.'
    }
    // A per-team chart needs a team, and needs that team to have enough of a
    // season to be worth drawing. Asking the analysis keeps the gate and the
    // graphic from ever disagreeing about what is drawable.
    // The table is passed as the cross-check: it knows how many matches a team
    // actually played, and the archive is occasionally short by one.
    if (graphic.meta.requiresTeam) return canPlotTeamSeason(season, options.team, { table })
    return ''
  }

  if (!match) return 'Pick a match to draw.'

  if (graphic.meta.requiresTimeline) {
    if (!(match.timeline || []).length) {
      return 'That match has no scoring timeline, so the swing chart would be guesswork.'
    }
    // The curve has to end where the match ended. 80 of the 738 archived
    // timelines are short of the final score - ESPN drops the occasional
    // converted try - and on 16 of them the timeline implies the OTHER side
    // won. A chart showing France losing 41-46 beside a scoreline reading
    // 48-46 is worse than no chart, and a footnote does not undo it.
    if (!timelineIsComplete(match)) {
      return 'That match has an incomplete scoring timeline, so the curve would '
        + 'end on the wrong scoreline.'
    }
  }

  if (graphic.meta.requiresSquad) {
    const squads = requiredSides(graphic, options).map((side) => match[side]?.squad || [])

    if (squads.some((squad) => !squad.length)) {
      return source === 'manual'
        ? 'Type your team sheet into the Home squad box above.'
        : 'No squad recorded for that match. Tick "only matches with squads", or enter the team yourself.'
    }
    if (graphic.meta.requiresStats && squads.some((squad) => !squadHasStats(squad))) {
      return source === 'manual'
        ? 'Player stats cannot come from manual entry - the form has no place to put them.'
        : 'That match has team sheets but no player stats. ESPN records them for internationals only - try Six Nations, The Rugby Championship, the Lions tour or the Womens Rugby World Cup.'
    }
  }

  return ''
}
