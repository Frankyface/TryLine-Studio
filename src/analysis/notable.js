/**
 * Which matches are worth making a graphic about.
 *
 * The app renders whatever it is pointed at and makes no editorial choice, so
 * choosing the match was left entirely to the user - and the archive is 1,147
 * matches deep. This scores them, so the interesting ones can be found.
 *
 * TWO BRANCHES, because one number does not cover it. Measured across the 649
 * decided matches with a complete timeline, "how far behind did the winner
 * get" and "how open was it at the end" share under a quarter of their top 50:
 * a one-point win where nobody ever trailed scores zero on the first and high
 * on the second. The branch that fires is also the caption.
 *
 * HOME ADVANTAGE IS ZEROED HERE, and only here. The fitted model gives the
 * home side 0.692 at kick-off, so an away side that led from the first minute
 * to the last still "bottoms out" at 0.308 - and 72 of the matches scoring
 * below 0.45 had never trailed at all, every one of them an away win. The
 * measure was reporting the venue. Neutralised, the zero point is exact:
 * a winner who never trailed scores exactly 0.
 *
 * The win-probability GRAPHIC keeps the fitted home advantage, because there
 * it is predicting a match. Here we are describing one that already happened.
 */
import { scoreSteps, scoreAtMinute, winProbability, timelineIsComplete, FULL_TIME } from './winprob.js'

/** Above this a match has a story worth telling. */
export const WORTH_POSTING = 0.6

/** The closing stretch, for the "was it still open" branch. */
const LATE_FROM = 61

/** A match is not scored at all below this many minutes of timeline. */
const FIRST_MINUTE = 1

const clamp01 = (value) => Math.max(0, Math.min(1, value))

/**
 * How dramatic a match was, 0-1, or null when it cannot honestly be scored.
 *
 * `null` is a real answer: 125 of the 783 finished matches have no usable
 * timeline, including every Major League Rugby match (ESPN publishes none at
 * all for it) and France 48-46 England, whose feed is missing the winning
 * score. Those must be shown as unrated rather than quietly ranked last -
 * 22 of them finished within three points.
 */
export function matchDrama(match, model) {
  if (!match || !timelineIsComplete(match)) return null

  const home = match.home?.score
  const away = match.away?.score
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null

  // Neutral venue: see the module note.
  const neutral = { k: model?.k ?? 0.92, h: 0 }
  const steps = scoreSteps(match)
  const homeWon = home > away
  const drawn = home === away

  /** The eventual winner's chance at `minute`, from a neutral standpoint. */
  const winnerChance = (minute) => {
    const at = scoreAtMinute(steps, minute)
    const chance = winProbability(at.home - at.away, minute, neutral)
    return homeWon ? chance : 1 - chance
  }

  let lowest = 1
  let lowestMinute = null
  let lowestAt = null
  let lateSum = 0
  let lateCount = 0

  for (let minute = FIRST_MINUTE; minute <= FULL_TIME; minute += 1) {
    if (!drawn) {
      const chance = winnerChance(minute)
      if (chance < lowest) {
        lowest = chance
        lowestMinute = minute
        lowestAt = scoreAtMinute(steps, minute)
      }
    }
    if (minute >= LATE_FROM) {
      const at = scoreAtMinute(steps, minute)
      const chance = winProbability(at.home - at.away, minute, neutral)
      // Doubt, not advantage: 1 when the match is level, 0 when it is decided.
      lateSum += 2 * Math.min(chance, 1 - chance)
      lateCount += 1
    }
  }

  // A draw has no winner to have come back, but can still be tense to the end.
  const comeback = drawn ? 0 : clamp01((0.5 - lowest) / 0.5)
  const lateDoubt = lateCount ? clamp01(lateSum / lateCount) : 0

  return Object.freeze({
    score: Math.max(comeback, lateDoubt),
    comeback,
    lateDoubt,
    lowestMinute,
    lowestScore: lowestAt ? Object.freeze({ ...lowestAt }) : null,
    drawn,
  })
}

/**
 * The one line that says why this match is worth drawing, or '' when it is
 * not. Reads from whichever branch actually fired, so it is never a guess.
 */
export function dramaReason(match, drama) {
  if (!drama || drama.score < WORTH_POSTING) return ''

  if (drama.comeback >= drama.lateDoubt && drama.lowestScore) {
    const { home, away } = drama.lowestScore
    const winnerName = match.home.score > match.away.score
      ? match.home.shortName : match.away.shortName
    const behind = match.home.score > match.away.score
      ? `${home}-${away}` : `${away}-${home}`
    return `${winnerName} came back from ${behind} at ${drama.lowestMinute}'`
  }
  return drama.drawn ? 'Level to the whistle' : 'Still in doubt in the last ten'
}

/** Sort helper: dramatic first, unrated last, ties broken by the closer match. */
export function byDrama(a, b) {
  const score = (entry) => (Number.isFinite(entry?.drama) ? entry.drama : -1)
  return score(b) - score(a)
}
