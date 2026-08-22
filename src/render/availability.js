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
import { canPlotSeason } from '../analysis/season.js'
import { canPlotFortress } from '../analysis/fortress.js'
import { pickPlayerStats } from './format.js'
import { timelineIsComplete, timelineTotal } from '../analysis/winprob.js'

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
  // A head-to-head needs both squads whichever mode it is in - player mode
  // still draws one player from each side. Checking only the chosen side let
  // the gate pass on a one-sided match that draw() then refused.
  if (!usesSide(graphic, options) || graphic.meta.comparesSides) return ['home', 'away']
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
    // Some table graphics need a whole league behind them, not a cup pool.
    if (graphic.meta.requiresFullTable) return canPlotSeason(table)
    return ''
  }

  if (needs === 'season') {
    if (source === 'manual') {
      return 'Home and away records cannot come from manual entry - this one needs a full league season.'
    }
    if (!season) {
      return 'No home and away records here - this needs a league where every '
        + 'club hosts and travels, not a tour or a tournament.'
    }
    // A per-team chart needs a team, and needs that team to have enough of a
    // season to be worth drawing. Asking the analysis keeps the gate and the
    // graphic from ever disagreeing about what is drawable.
    // The table is passed as the cross-check: it knows how many matches a team
    // actually played, and the archive is occasionally short by one.
    if (graphic.meta.requiresTeam) return canPlotTeamSeason(season, options.team, { table })
    // Fortress was the one season graphic whose gate never asked its own
    // analysis: a season where too few teams carry a rate passed the gate and
    // threw in draw().
    if (graphic.meta.requiresRatedTeams) return canPlotFortress(season)
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
      // Say WHICH number is wrong. The app knows both, and a club entering its
      // own scoring has no other way to find the discrepancy - the generic
      // message sent them looking for a fault in the app.
      const derived = timelineTotal(match)
      const entered = `${match.home?.score ?? '-'}-${match.away?.score ?? '-'}`
      return source === 'manual'
        ? `Your scoring adds up to ${derived.home}-${derived.away}, but the score `
          + `says ${entered}. Add the missing conversions, penalties or drop goals.`
        : `That match has an incomplete scoring timeline - it adds up to `
          + `${derived.home}-${derived.away} against a final score of ${entered}, `
          + 'so the curve would end on the wrong scoreline.'
    }
  }

  if (graphic.meta.requiresSquad) {
    const squads = requiredSides(graphic, options).map((side) => match[side]?.squad || [])

    if (squads.some((squad) => !squad.length)) {
      // Name the box that is actually empty. It always said "Home", including
      // when Home was the filled one.
      const missing = requiredSides(graphic, options)
        .filter((side) => !(match[side]?.squad || []).length)
        .map((side) => (side === 'away' ? 'Away' : 'Home'))
      return source === 'manual'
        ? `Type your team sheet into the ${missing.join(' and ')} squad box above.`
        : 'No squad recorded for that match. Tick "only matches with squads", or enter the team yourself.'
    }
    // A team sheet is laid out from the starting XV, and divides by how many
    // there are. A squad of replacements only - reachable by pasting a bench
    // list into manual entry - produced NaN geometry and a 61% empty canvas.
    if (graphic.meta.requiresStarters
      && squads.some((squad) => !squad.some((player) => player.isStarter))) {
      return 'No player in that squad is marked as a starter, so there is no '
        + 'team sheet to lay out.'
    }

    // Squad-level FIRST: where a whole competition has no stats, saying which
    // competitions do is the only actionable thing we can tell someone. Asking
    // about the player first shadowed that on 296 combinations across eight
    // competitions, replacing the useful message with a dead end.
    if (graphic.meta.requiresStats && squads.some((squad) => !squadHasStats(squad))) {
      return source === 'manual'
        ? 'Player stats cannot come from manual entry - the form has no place to put them.'
        : 'That match has team sheets but no player stats. ESPN records them for internationals only - try Six Nations, The Rugby Championship, the Lions tour or the Womens Rugby World Cup.'
    }

    // Then the player. Asking whether the stats OBJECT is empty was the wrong
    // question: every ESPN player in a statted squad carries all 26 keys, so a
    // replacement whose every value is zero passed - which is exactly the 44
    // players this check was added to catch. What matters is whether anything
    // would actually be drawn.
    if (graphic.meta.requiresPlayer && graphic.meta.requiresStats && options.player) {
      if (!pickPlayerStats(options.player).length) {
        return 'That player has no match numbers recorded, so the card would be empty.'
      }
    }
  }

  return ''
}
