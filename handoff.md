# Handoff

_Last updated 2026-08-21. **LIVE at https://frankyface.github.io/TryLine-Studio/**_

## State: 10 graphics live, reviewed and audited

Ten graphics across two Instagram formats from two data sources, deployed to
GitHub Pages. **383 unit tests, 44 end-to-end checks, all green.**

### Newest: "Season so far"

One club, every result in order, as a margin bar per match. This is the
graphic a club posts about itself - the other season charts answer questions
about a competition. Built from final scores alone: no league points, because
bonus-point rules differ by competition and depend on try counts the archive
does not hold for every match.

Two honesty rules are built in. It prints "INCLUDING PLAY-OFFS" when its record
exceeds the league table's, and "17 OF 18 MATCHES RECORDED" when the archive is
short of what the competition lists. It does NOT refuse a short archive -
refusing cost 10 of 14 Top 14 clubs and 9 of 16 in the URC, and a gap that is
stated is not misleading. Completeness is measured against the fixture list as
well as the table, because Major League Rugby has no table at all.

A code review and a live-production audit both ran against this build. Every
CRITICAL and HIGH finding is fixed and verified in production; the remaining
open items are listed below.

### The one that mattered

**The app was unusable on every phone and tablet.** `.stage { position: static }`
for narrow screens was written *above* `.stage { position: sticky }` in the same
file - equal specificity, so source order decided and the override silently
lost. `order: -1` survived, so the preview still appeared first and the layout
looked right. But a preview taller than the viewport pinned itself to the top
and painted over the entire control rail: every chip, select and button was
unclickable at 900px and below. Fixed, verified by hit-test at eight viewports
and functionally on a 390x664 phone, and now covered by two e2e checks.

### Also fixed this pass

- Crest urls that were permanently 404 at ESPN were retried on every page view.
  Live console errors: 12 -> **0**.
- 90 fixtures rendered "00:00 KICK OFF" - ESPN's not-yet-announced marker.
- `blockingReason` decides what draws, what exports and how chips render, and
  no unit test could reach it. Now `src/render/availability.js`, with a
  table-driven test over every graphic.
- Comparison bars are computed as a pair, so a tie reads as a tie. Previously
  "both missed 5 tackles" drew two full bars and "neither missed any" drew two
  stubs.
- Player cards no longer pad to four tiles with zeroes (18% of players).
- Season data goes through the schema like matches and tables do.
- Handle, theme and chosen source persist between visits.

### Measured performance, 2026-08-22

Live, on a throttled phone (390x844, Fast 3G, 4x CPU): **DOMContentLoaded 2.0s,
first graphic drawn 3.3s cold**, 45 requests. Warm reload is about 1.1s with
everything from disk cache.

The payload is dominated by fonts (90 KB) and crests (88 KB); the data itself
is 4.4 KB because GitHub Pages gzips it - the Top 14 season file is 70 KB on
disk and **5.4 KB on the wire**, which is why its size was left alone.

Considered and NOT done: self-hosting the two Google fonts. It would remove the
only third-party origin and save roughly 500-700ms of cold load, but it means
matching Google's unicode-range subsetting by hand, and getting the files even
slightly wrong shifts text metrics across all ten graphics. Worth doing as a
focused piece of work with the label-stress and shots suites as the check, not
as an aside.

### Open, deliberately

- **Nobody has posted one of these to Instagram or eyeballed them on a phone.**
  That is still the outstanding human acceptance step (`help.md`).
- Low-severity review items not acted on: `loadImage`/`loadImageOrNull` are
  exported but only used inside `primitives.js`; `dataFiles()` in
  `mirror-crests` skips top-level `data/index.json` (no crest there today).
- Crest plating stays on mean luminance - see `docs/decisions.md` for why the
  "vanishing pixel share" alternative was measured and rejected.

## Earlier state: v1 as it shipped on 2026-08-21

Everything in this section describes v1 at the time and has been SUPERSEDED -
the numbers below are kept because the reasoning is still useful, not because
they are current. Current figures are at the top of this file.

All five graphics of v1 rendered in both Instagram formats, from both data
sources, and exported as real PNGs. 106 unit tests passed against real captured
API responses; a 17-check end-to-end suite passed against the real app.

- **Data**: 658 matches across 4 competitions, 87 with full squads and
  per-player stats, 7 league tables. Refreshed 2026-08-21.
- **Not yet done by a human**: nobody has posted one of these to Instagram or
  eyeballed them on a phone. That is the outstanding acceptance step (`help.md`).

## What was built

| Layer | Files |
|---|---|
| Schema | `src/data/schema.js` - one Match/Table shape for every source |
| ESPN adapter | `src/data/espn.js` - pure mapping, fully unit tested |
| Manual entry | `src/data/manual.js` - squad/scorer/table text parsing |
| Data refresh | `scripts/fetch-data.mjs` - Node-only fetching, monthly chunks |
| Graphics | `src/render/graphics/*.js` - result, matchday, teamsheet, statcard, table, winprob, comparison, scatter, fortress, teamseason |
| App | `index.html`, `src/app.js`, `styles/app.css` |
| Export | `src/export/png.js` - feed + story in one click |

## Two landmines found the hard way

1. **ESPN 403s browser User-Agents.** The failure presents as a CORS error, so
   the obvious diagnosis is wrong. Architecture changed mid-build from live
   browser fetching to prefetched static JSON because of this.
2. **ESPN caps scoreboards at 100 events, silently.** A full Top 14 season came
   back "complete" with exactly 100 matches, ending in January. Fetching is now
   chunked by month; Top 14 went from 100 to 287 matches.

## Done since v1

- **Win probability chart** - `src/analysis/winprob.js` plus a fitted model
  (`npm run fit`). Cam asked for graphsketball-level analysis; this is the first
  piece of it.
- **13 competitions**, every id verified to return actual events. Women's Six
  Nations (289258) and Currie Cup (270555) resolve but serve nothing - omitted.
  PWR and Japan League One do not exist on ESPN at all.
- **Timezones** - kick-off renders in the competition's zone, user-overridable.
  ESPN carries no timezone data, so this is a per-competition map by necessity.
- **Accessibility pass** - `inkFaint` failed contrast in all four themes while
  labelling real content; now 4.5:1+ everywhere.
- **Match stats comparison** - team-v-team and player-v-player, the second
  graphic Cam picked. Aggregates squad stat lines, since the feed has no
  team-level block; validated by reconciling summed points against the final
  score. Rates are averaged, not summed.
- **hasStats tracking** - only 53 of 1,147 matches carry player stats
  (internationals only). Its own index flag, its own filter, and a clear
  message instead of an empty card.
- **Visual audit fixes** - feed tables no longer silently drop teams, story
  result no longer floats in dead space, statcard watermark no longer clipped,
  team-sheet positions no longer orphaned, crests that are dark-on-dark get a
  plate, chart series colours are guaranteed distinguishable.

## Visual audit of the season charts (2026-08-21)

The scatter was safe on a 10-team league and broken on a 14-16 team one.

- **Perpignan were rendering as the United States flag.** ESPN falls back to a
  country flag when it has no club crest, matching on the abbreviation - and
  Perpignan abbreviate to "USA". A US flag on a French league chart. Flags are
  legitimate for national teams, so the adapter now allows them only in
  competitions between countries; `npm run repair` strips the bad ones from
  data already on disk (Perpignan and Vannes).
- **Three Top 14 clubs all abbreviate to "STA"** - Stade Toulousain, Stade
  Francais Paris and La Rochelle - so the chart carried three identical labels.
  `uniqueTeamLabels` keeps an abbreviation where it is unambiguous and takes the
  next distinct candidate from the name where it is not (STA / FRA / ROC).
- **A crest overprinted the bottom-left corner caption every single time**,
  because that corner is by definition where the league's worst team sits.
  Captions moved outside the plot.
- **Above 12 teams the crests crowd** and a label stops being clearly attached
  to its own mark. Those leagues now use lettered discs, so the label IS the
  mark and there is nothing to mis-attach.
- **Crest plating was wrong in both directions.** A symmetric contrast test
  plated most crests on the light theme while still missing near-black ones on
  dark. It is now DIRECTIONAL - a dark page only hides dark crests, a light page
  only hides pale ones. Ten of the 96 mirrored crests qualify: five on the dark
  themes (Zebre, Western Force, Newcastle Falcons, Fijian Drua, Uruguay) and
  five on chalk (Racing 92, Bordeaux Begles, Japan, England Women, Castres).
- Players mode read as two teams: identical layout to the team card. Crests are
  smaller, the subtitle carries the team, and the scoreline is labelled "Match
  18-15" so it cannot read as the two players' own contest. Its monogram
  fallback was also being handed "10 - FH", drawing a disc reading "10 ".

## Home advantage chart + a state race (2026-08-21)

- **Home advantage ("fortress") chart** shipped: a dumbbell per club joining its
  away win rate to its home win rate, ordered by the gap, with the league
  average marked. Per-team home/away records are computed by
  `scripts/build-season-stats.mjs` (`npm run seasons`) and only written where
  every team has 4+ games at each venue and the competition has 6+ such teams -
  which is 5 leagues. Top 14 2026: Pau 92% home / 31% away, +62pp.
- **A genuine async race in the app.** `render()` read `state` AFTER awaiting
  the canvas draw, so a concurrent data load could swap the state underneath it.
  Symptom found while testing: selecting a competition with no season records
  left the PREVIOUS competition's chart on screen, labelled with its own name -
  the worst failure mode a data graphic has. Fixed three ways: render works from
  a state snapshot, a render token stops an out-of-order render reporting, and
  competition changes clear the old match/table/season immediately.
  The existing e2e had been passing BECAUSE of this bug and needed correcting.
- Export filenames were derived from whatever data was loaded rather than what
  the graphic needs, so a match graphic could be named after a season.
- The app no longer probes for season files that do not exist; the competition
  index records which seasons have one.

## Second code review (2026-08-21)

- **A real value drew a zero-width bar on 565 rows.** On a "fewer is better"
  row, a winner of 0 made the loser's proportional bar `0/n = 0` - a player
  with 5 missed tackles got no bar beside a full one for 0, on a DEFAULT player
  card stat. Bars now have a visible floor, and a missing value (which should
  draw nothing) is distinguished from a zero.
- **1,074 real colour pairs shipped below the module's own separation bar.**
  A colour could clear the chroma threshold by two points and still land inside
  the separation threshold - the two hand-tuned numbers had a crack between
  them. The pair is now re-checked after substitution; a sweep of every real
  team colour across all four themes returns zero failures.
- **`segmentHitsRect` had a 1.1% false-negative rate** on integer geometry -
  segments running along an edge or grazing a corner were reported as misses,
  because the orientation test excluded the exactly-zero case. Replaced with
  Liang-Barsky clipping, verified against an independent separating-axis oracle
  (0 disagreements over 20,000 cases, now a test).
- `lineoutSuccess` returned `NaN` for a partial stats object, which would have
  rendered "NaN%" and passed NaN as a bar width.
- "Penalties" meant penalty GOALS on the stat card and penalties CONCEDED on
  the comparison card. Renamed both.
- `series.js` had no tests and was outside the coverage gate; both fixed.
- Script hardening: JSON parsing that names the bad file instead of aborting,
  draws written as `D` rather than `T`, an honest blanking summary, no in-place
  mutation in reindex, and its docstring corrected to match what it does.

Worth noting the review verified two things I had assumed: `derive-form`'s
`slice(0, played)` is sound on every shipped table (checked against the sharpest
case, Hurricanes 14 table games vs 17 archive matches), and exact team-name
matching is correct - it keeps the Durban "Sharks" and "Sale Sharks" distinct.

## Season scatter + deploy readiness (2026-08-21)

- **Attack v defence scatter** shipped (`src/analysis/season.js`,
  `src/render/graphics/scatter.js`). Every team plotted by points scored against
  points conceded per game, quadrants split at the league's own averages, crests
  as the marks and collision-avoided labels. It **refuses** to draw a cup pool
  or a short competition rather than producing a confident, meaningless chart -
  verified in the app for both the league and the refusal case.
- **Deploy audit**, proved by serving the app from a subpath in a real browser:
  every path is relative, nothing 404s, and it still works with all external
  hosts blocked. Fixed as a result: the Pages workflow published the entire
  checkout including `CLAUDE.md`, `handoff.md`, `dev/` and `tests/` (now only
  the app: index.html, src, styles, data, assets and the favicon - 1,411 files,
  about 14 MB, of which 8.4 MB is data and 4.8 MB mirrored crests); the weekly
  refresh could never trigger a deploy because
  GitHub blocks token-pushed workflow chains (now listens for the refresh);
  added a favicon; removed a dead empty `public/`.
- **Shipped 2026-08-21.** Repo `Frankyface/TryLine-Studio`, Pages via Actions.

## Visual audit of the analysis charts (2026-08-21)

Audited across all four themes and stress-tested against all 738 real matches
rather than the demo fixture, which turned out to be flattering:

- **Labels crossed the curve on 68% of real chart instances** and overlapped
  each other on 12%. Now 2.8% and 0% over 1,476 chart instances. Three changes:
  key moments must be 6+
  minutes apart, same-minute events merge into one label (`TRY+CON 80'`), and
  placement tries 20 anchors against both the curve and the placed labels
  before falling back. Whatever lands gets a background halo.
- **The win-probability curve was invisible on chalk** - hardcoded `#FFFFFF`
  over a near-white panel, 1.09:1. Now `theme.ink` - 15.9:1 at worst against
  the panel it is actually drawn over, on turf.
- **The losing bar was invisible on chalk** at 22% alpha; the loser alpha is
  now theme-aware.
- **On "fewer is better" rows the longer bar belonged to the loser.** Bars are
  now swapped on those rows so the leader is always longer, with a `↓` beside
  the label rather than a `*` keyed only in the footer.
- Markers at 80' hung half outside the panel (9% of matches) - now clamped.
- Story left ~290px blank whenever the comeback caption was skipped (62% of
  matches). Chart height is now derived from the space actually available.
- Players mode was never in the shot set, so it had never been looked at. It is
  now, and it gained the scoreline it was missing.

`npm run stress` guards the label geometry and runs as part of `npm run verify`.

The five older graphics were re-checked across all themes: no regressions from
the raised `inkFaint`, the crest plate, or the `readableInk` rewrite.

## Phone layout (2026-08-21)

Checked on a real iPhone 13 viewport before Cam's own phone test:

- The preview used to sit a full screen below the controls, so you adjusted a
  graphic you could not see. On narrow screens the preview now comes first.
- The previews were 172px and 117px wide side by side - too small to judge.
  They now stack, at 335px and 226px.
- No horizontal overflow at 390px or 810px; desktop layout unchanged.

## Club path completed (2026-08-21)

- **Crest upload** for manual entry: decoded, downscaled to 512px and stored as
  a PNG data URL, so the canvas stays untainted and export keeps working.
- **Local persistence**: club name, ground, squad and crest survive a reload,
  because a club doing this weekly will not retype them. Scores and scorers are
  deliberately NOT persisted - they change every match and stale ones would be
  worse than blank. localStorage failures (private browsing, full quota) report
  and carry on rather than breaking the render.
- **Crest plate rule corrected**: it tested absolute luminance, which plated a
  saturated red club crest (3.8:1 against the page, perfectly visible) as well
  as the black crest that actually needed it (1.1:1). Now tests contrast.

## Code review pass (2026-08-21)

An adversarial review of the analysis and rendering code found and fixed:

- **`keyMoments` measured every swing against a stale baseline.** Home advantage
  decays continuously between scores, and all of it was being credited to the
  next try - one swing overstated by 57%, and a different top-3 annotated in
  53% of matches. Both sides of a swing are now evaluated at the same minute.
- **The match picker went blank on filter, leaving the canvas stale.**
  `replaceChildren()` clears the selection and nothing re-selected or redrew,
  so Export would save the previous match.
- **The comeback callout fired on the pre-match prior.** An away side starts
  below 50% by definition, so 86 matches printed "were down to 31% at 0'".
  It also named the away team as winner of all 9 drawn matches.
- **A malformed flag made the fitter write an UNFITTED model** labelled
  `"fitted"` - `--iterations` with no value gave NaN, the loop ran zero times,
  and the starting guess went to disk. Flags are now validated.
- **A model file missing coefficients drew nothing, silently.** Canvas ignores
  NaN coordinates, so the chart rendered axes and no curve, with no error.
  Coefficients now fall back individually.
- **Picker dates disagreed with the graphic** in 9.5% of matches, because the
  list used the viewer's zone and the poster used the competition's.
- Plus: stale default coefficients, a dead import, duplicated colour parsers,
  an unused-and-unsafe `step` option, and an unguarded empty catalogue.

Verified clean by the same review: the gradient ascent maths (converged, and
matching a 400,000-iteration reference to six decimals), the fitter/runtime
feature parity, all timezone handling across DST and midnight rollover, and
the malformed-event filtering.

## Player card redesign + audit fixes (2026-08-22)

**The card now leads with one number, or refuses to.** The old card blew up the
first four non-zero stats in a fixed priority order; measured over all 2,438
players with stats, its chosen number sat at the 58th percentile of its own
match and picked METRES for 149 of the 212 props at a median of six.
`src/analysis/hero.js` benchmarks each stat against the same SHIRT (p90 per
shirt group in `data/models/hero-stats.json`), puts scoring above volume, and
returns null for 61% of players, who keep the grid. Measured after: 96th
percentile at the median, never below the 60th, 0 of 212 props on metres.

Two rules were measured and rejected rather than assumed - requiring a value to
reach its shirt's p90 (cost a third of the cards, bought 0.02 of percentile)
and a perfect-rate tier (unreachable: 0 of 2,438). Both are recorded in
CLAUDE.md so they are not re-opened.

**An audit of the headline change found eight faults**, all fixed: a single
over-wide word drew off the canvas (the shrink loop only counted lines, never
width); the label stress harness had stopped measuring the plot the graphic
draws, so `npm run verify`'s label proof was hollow; the fortress footer still
repeated its own headline and a two-line headline shrank club names to 15.3px;
the season tiebreak compared floats exactly and never ran; and the win-prob
headline printed "down to 0%" for a side that won. The headline geometry now
has tests and `frame.js` is inside the coverage gate.

## Story format measured, and mostly not a problem (2026-08-22)

"The story is the feed layout letterboxed into 9:16" was an opinion in this
file for weeks. `npm run space` turns it into a number and confirmed it of two
graphics, not of the format: result and matchday.

**The first version of that harness measured ONE fixture** - it drove the
preview page - so the "9-13% band" it produced was a single match's numbers.
Swept over 144 real matches it is 12-28%, and scheduled fixtures are the worst
case by a distance. Corrected in CLAUDE.md; the harness now sweeps.

Result now stacks into two columns on story, one per team, because the score
otherwise has to fit between the crests in 262px. Matchday had a branch to
shrink its stack on overflow and none for surplus, so it banked 300px as two
voids. Scorer rows now breathe rather than centring and leaving a band above
the footer. Everything sits in a 9-13% band; nothing else needed touching.

Also investigated and DECLINED, with the numbers, in docs/decisions.md: making
the attack-v-defence scatter equal-aspect. The plot is 1.81:1 on feed and
0.70:1 on story while the data is near-square, so the same season does read
differently between the two - but correcting it nearly doubles mark overlaps
(59 to 112 pairs) and drops the worst gap from 9px to 4px, which forces
relaxMarks to push marks further from where the team actually is. A distortion
of position is worse than a distortion of aspect.

## Open, found by the harnesses (2026-08-22)

`npm run space` now sweeps every graphic through the app's own availability
gate, and it surfaced one thing nobody has looked at: **winprob/story carries a
402px median dead band (31% of the box)**, the worst of any graphic. It was
invisible before because the harness measured one fixture, then two graphics.
Not investigated yet.

## Next, in rough order

1. Cam's phone check - do these read well in the Instagram feed and story
   frames? Still the only item needing a human.
2. Deeper analysis beyond what is built: scoring-run charts. Rugby has no
   shot-chart equivalent in free
   data - no coordinates, no possession-level play-by-play.
