# TryLine Studio - working notes

Rugby matchday graphics generator. Read `handoff.md` for current state, then
`docs/decisions.md` for what is already settled. Do not re-open settled questions.

## Non-negotiables

- **Never fetch ESPN from the browser.** It returns 403 to browser User-Agents
  and the 403 has no CORS header, so it surfaces as a misleading CORS error.
  All fetching lives in `scripts/fetch-data.mjs`; the app reads `data/` only.
- **Chunk scoreboard requests by month.** ESPN caps a response at 100 events and
  truncates silently - a whole-season request looks complete but stops halfway.
- **One schema.** Every source produces the `Match`/`Table` shapes in
  `src/data/schema.js`. Graphics never branch on where data came from.
- **Verify visually.** A graphic that renders without throwing is not a graphic
  that looks right. Run `npm run shots` and actually look at the PNGs.
- **Crests are mirrored locally, at two sizes.** ESPN's 500x500 originals were
  78% of a session's transfer, for crests drawn at 40px in a table row.
  Mirrored at two sizes they are served same-origin and cached; a league
  table's crests now weigh 34-139 KB depending on the competition. Use
  `loadCrestImage(logo, px)` and pass the size you actually draw at.
- **A real number must never draw as nothing.** A proportional bar can collapse
  to zero width; floor it. This shipped on 565 rows of a default card.
- **Never judge a chart by one fixture.** The demo match in `dev/preview.html`
  was flattering: fixed-offset labels looked clean on it while crossing the
  curve on 68% of real matches. `npm run stress` runs the label geometry over
  every match in `data/` and is part of `npm run verify`.

## `npm run geometry` is the guard that should have existed all along

Three adversarial reviews found eight geometry faults between them and every
one survived a green verify: a headline drawing 1,075px into 762px of room,
crests 51.5px outside the box on all 1,147 story matchdays, a hero label
printed through the row beneath it, club names past the right edge because the
fit measured without the tracking it drew with. Nothing in the suite looked at
WHERE ink landed - the e2e asserts a canvas has content, and `shots` renders
pictures for a human. Both pass with the text stacked in a corner.

It renders every graphic over real data, wraps the canvas, and checks three
things: nothing outside the CANVAS, nothing outside the CONTENT BOX bar a
short explicit allowlist, and no text over other text.

**Mutation-test it after any change to it.** The first version could not fail:
`TOLERANCE` was passed to the page as a parameter the arrow function never
destructured, so every comparison was against `undefined` and it reported a
clean sweep on a 47px breach. It looked exactly like a working guard. Break
something on purpose and confirm it goes red.

The tolerance (0.8px) sits between two MEASURED numbers - a 0.7px artefact
where a right-aligned column anchors exactly on `box.right`, and the smallest
real fault seen, a 1.1px axis label. It was 1.2px for a while and masked that
fault. Do not raise it without re-measuring what starts getting through.

## A crest plate pads INWARD

`drawCrest` paints a plate behind a crest that would otherwise vanish. It used
to add 6% of the crest box on each side, which put the plate outside every
caller's box - and four graphics draw a crest flush against the content box, so
four of them bled into the margin, over the accent hairline on the left. The
padding now comes out of the crest instead, so nothing `drawCrest` paints
exceeds the box it was given and `PLATE_HALF` is simply 0.5.

## Measure contrast against the RENDERED background, never the token

`theme.js` used to claim every ink cleared 4.5:1, and against `bg` that was
true. Nothing is ever drawn on flat `bg`: `drawBackdrop` washes bgAlt-bg-bgAlt
and lays a 16% accent glow across the middle of the canvas, exactly where
content sits. Measured where they land, the inks were 2.93-3.52 - twelve
`drawText` sites across nine graphics, all failing, none of it visible from the
token. Same trap caught the eyebrow pill, whose own tint lifts the background
under its own label.

`pageSurface(theme, accent)` is the one place that knows what a graphic is
actually drawn on. Use it - every contrast fault in this project has come from
measuring against `theme.bg`, which nothing ever touches.

`npm run contrast` renders the real backdrop, samples it, and fails under
4.5:1 for the ink tokens or 3:1 for the data marks, or if the three ink tokens
collapse into one. It covers the marks as well as the text BECAUSE it once did
not: four separate mark faults shipped under a green verify while it checked
only the three inks.

## CSS source order is a live trap in this file

`styles/app.css` has no build step and no nesting, so an override and the rule
it overrides have EQUAL specificity and source order decides. A mobile
`.stage { position: static }` written above `.stage { position: sticky }`
silently lost, pinned a viewport-taller preview over the whole control rail,
and made the app unusable on every phone and tablet - while still looking
correct, because the `order: -1` in the same block did apply. Any `@media`
block that overrides a base rule must sit BELOW it. Two e2e checks now
hit-test the controls at 390px.

## ESPN quirks already handled (don't rediscover)

- `starter`, `captain`, `active`, `subbedIn`, `subbedOut` are present on every
  rugby roster entry and always false. The XV is derived from shirt numbers 1-15
  plus the `R` position code. Captaincy is genuinely unavailable from this source.
- Replacements are all coded position `R`; the team sheet hides it.
- The standings group label is stale ("2023/24") even when `?season=` returns the
  right table. Never render it.
- `attendance: 0` means "not reported".
- The summary header has a season year but no display name.
- No player headshots for rugby (the NBA feed has them; rugby does not).
- **No timezone data exists anywhere** in the rugby payloads - no lat/long, no
  country, no offset. `venue.address.state` is NOT a country and is sometimes
  wrong (Stade de France returns "Reunion", which would put a kick-off 3 hours
  out). Local kick-off comes from the per-competition map in
  `src/data/timezones.js`, never from the venue address.
- Major League Rugby mixes empty `{}` objects into its events array; the
  scoreboard adapter filters anything without two named teams.
- **ESPN serves a COUNTRY FLAG as a club crest** when it has none, matched on
  the abbreviation: Perpignan ("USA") were served the United States flag. Flags
  are only valid in competitions between countries.
- **Abbreviations are not unique.** Three Top 14 clubs are all "STA". Use
  `uniqueTeamLabels` from `src/render/format.js` for any team label.
- **Some club crests are permanently 404 at ESPN.** `mirror-crests` blanks the
  url so the monogram draws with no request; leaving it made the live site
  retry a failing cross-origin request on every page view. 12 team crests and
  8 competition badges currently carry a blank url for this reason.
- **`T00:00Z` means the kick-off has not been announced**, not midnight. 90 of
  1,147 matches carry it, 77 of them Top 14. `formatKickoffTime` returns '' for
  it and the matchday pill collapses.
- Some ids resolve with a correct name but serve zero events - Women's Six
  Nations (289258) and Currie Cup (270555) are dead. Verify events, not just
  a 200.

## Stat data reality (measured, do not re-derive)

Across 1,147 downloaded matches:
- **201 have squads, only 53 have player stats.** Stats exist for internationals
  only (Six Nations, Women's RWC, Rugby Championship, Lions). Every club
  competition has team sheets with `stats: {}` on all 23 players. The
  `hasStats` index flag and its filter exist for exactly this.
- Where stats exist they are complete: all 26 keys on all 23 players, never
  one side only.
- **`defendersBeaten` for one team == the opponent's `missedTackles` in 99.1%
  of matches.** Never put both on one card.
- **`redCards` and `dropGoalsConverted` are 0-0 in 96%+ of matches.** Never a
  fixed row. `cleanBreaks`/`offload` are fine per team but ~50% dead on a
  player card.
- Summed player points equal the final score in 102/106 team-matches. The four
  failures are all exactly -7 and the `timeline` is short by the same amount:
  ESPN dropped a converted try. Take the scoreline from `home.score`, which is
  always right. `compareTeams` now DROPS a summed tries or points row when
  either squad fails to reconcile, and `heroStat` withholds a scoring headline
  on the same test - both were documented as required here long before either
  existed, and the only reason nothing shipped wrong from the comparison is
  that `TEAM_STAT_KEYS` happens to list neither key.

  Per-PLAYER tiles are deliberately NOT gated: "Arundell 3 tries" is true
  whatever the squad sums to. What reconciliation protects is a claim about the
  whole - a team total, or "most in the match".
- Tackles run ~25% above a "tackles made" convention (ESPN appears to count
  assists), so do not caption them one-per-tackle.

## The player card headlines ONE number, benchmarked against the shirt

The card used to blow up the first four non-zero stats in a fixed priority
order. Measured across all 2,438 players with stats, the number it chose sat at
the **58th percentile of its own match** - a coin flip - and for **149 of the
212 props it chose METRES, at a median of six**. A hero card for a prop who
made six metres is what `src/analysis/hero.js` exists to prevent.

Three rules do it, and each was measured:

- **Benchmarks are per SHIRT** (`data/models/hero-stats.json`, the raw p90 per
  shirt group, built by `npm run benchmarks`), and a stat may only headline for
  a shirt whose OWN p90 clears that stat's floor. Prop p90 for metres is 18
  against a floor of 55, so metres is not a prop headline at any value.
  The eligibility this produces reads like the game: props and hookers headline
  tackles, locks tackles and carries, flankers add rucks won, scrum-halves
  passes and kicks, wings and full-backs metres and carries, and replacements
  scoring only.

  **Never clamp the stored p90 up to the floor.** It did, which left 148 of the
  170 cells equal to the floor exactly - so `value / benchmark` was
  `value / floor`, and the minimum qualifying number scored a perfect 1.0.
  Mauls, offloads, clean breaks and defenders beaten have NO shirt whose p90
  reaches their floor, so they always scored 1.0 and always won: Oscar Jegou
  headlined "3 MAULS WON" in a match where he made 15 tackles. Storing the raw
  p90 and gating on it removed all 21 headlines of three or less and cost 6
  points of acceptance.
- **Scoring outranks volume.** Ranking on benchmark ratio alone loses all 55
  two-try performances to busy forwards.
- **It REFUSES**, for 61% of players, and the existing grid is their card. A
  confidently wrong hero number is worse than none.

Result: the hero sits at the **93rd percentile of its own match** at the median
and never below the 60th, on 32.5% of players.

**A scoring headline is gated on the squad's points reconciling with the
scoreline**, and the caller must pass it - `squadPointsReconcile` defaults to
true, so a caller that forgets silently loses the gate. That is exactly what
happened: nothing passed it, and 8 cards were reachable on the 4 squads ESPN
is 7 points short on, including a 4-try "Most in the match" on France 48-46
England - the match this project already refuses to draw a win curve for.

**A rank says JOINT at every position, not just first.** 59 of 209 "2nd most"
cards and 44 of 101 "3rd most" cards had another player on the identical
number; two Italy players printed "2nd most of the 46" on 19 tackles from the
same match. The `Top N%` line counts to the END of the tie block for the same
reason.

**Requiring the VALUE to reach the p90** (as opposed to requiring the p90 to
be a real benchmark) was measured and rejected separately: it cut acceptance to
17.2% for no gain in the weakest card.

**There is no perfect-rate tier.** "100% from 14 tackles" can only be reached by
a player who already cleared the volume floor of 12, so the volume tier fired
first every time - 0 of 2,438 players ever reached a rate headline. The
concrete number is the better line anyway.

When a hero fires the shirt-number watermark is NOT drawn: a decorative 460px
numeral beside the 400px one carrying the message read as two headlines. The
shirt moves into the position chip.

## Dead canvas: measure it over MATCHES, never over the demo fixture

`npm run space` measures the largest run of near-empty pixel rows inside each
format's content box. The first version of it drove `dev/preview.html`, which
renders exactly one match - so it reported one fixture as if it were the
archive, and "nothing sits outside a 9-13% band" went into this file on that
basis. A scheduled fixture measures 244-395px where the demo match measures
124. The harness that existed to stop this project judging a chart by one
fixture was itself judging by one fixture. It now sweeps `--every N` matches
and prints p50/p90/max per graphic, format and played/scheduled.

Current, over 144 matches: result/scheduled is the worst at 26-28% of the box,
result/played 18-25%, matchday 12-15%. **A scheduled `result` is sparse by
nature** - a pill, two crests, a time and two names - and `matchday` is the
graphic designed for a fixture. Do not inflate one into the other.

Two constants decide the answer and only one of them is obvious. THRESHOLD=90
separates ink from the backdrop texture (at 24 every row of every graphic
scores as inked); anything from 45 to 160 gives the same answer. The
load-bearing one is EMPTY_ROW=3: at 0 or 1 every gap collapses to zero,
because the accent hairline the frame paints at x <= 10 puts a step on every
row of every canvas.

The window is the CONTENT BOX in both formats. It used to exclude the story's
250px safe margins but include the feed's 72px pad, which put 8 of 11 feed
rows' "largest gap" in the canvas margin rather than the layout.

## The result card, and two ways to get its story format wrong

The result story stacks into two COLUMNS, one per team, because the score has
to fit between the crests otherwise - 262px of room, which caps "36-14" at
about a 100px face on a canvas 1920 tall. Both numbers take the size of the
wider one, or a 7 beside a 36 prints the losing score larger.

Matchday already shrank its stack to fit an overflow and had no branch for the
opposite case, so a 9:16 canvas banked ~300px of surplus as two voids. It now
spends it - crests first, then the flexible gaps.

**Crest growth is bounded by the WIDTH, not just the surplus.** Growing on
height alone put both crests 51.5px outside the content box on all 1,147 story
matchdays, and their plates 77.6px out, over the accent hairline. A plate is
the crest box plus 6% of padding each side, so `offset + box * 0.53` is what
has to fit inside `box.right`.

**Do not reserve room for the SCORERS header.** It looks necessary and is not:
the header is centred (ink x 481-595 always) and the winner's underline is
drawn at the box edges or under a column centre (x 72-136 / 944-1008 /
276-340 / 740-804), so they cannot intersect at any size or score. Reserving
34px for a collision that cannot happen cost exactly one row of scorers, and
16 real cards that had listed every scorer stopped doing so - silently, under
a heading reading SCORERS. Where the list genuinely does not fit, the heading
now says how many are missing (7 renders in the archive).

**A block is centred against the drawing, not against a model of it.** The
first attempt summed a whole pill (`drawPill` anchors on its TOP, so only the
part below `pillY` is in the block) and a name block that hangs ABOVE its
baseline, and missed the kick-off line entirely. That over-counted the feed by
96px and under-counted the story by 80, and pushed the feed's worst dead band
from 283px to 319 - a regression shipped inside a commit about fixing dead
space.

## A win-probability curve MUST end where the match ended

80 of the 738 archived scoring timelines do not add up to the final score -
ESPN drops the occasional converted try, almost always exactly 7 points. On
**16 of them the timeline disagrees with the result** - 12 a straight winner
flip, 4 a real draw shown as a win or the reverse. France read 41-46 to England
on a graphic printing the correct 48-46. The curve used to draw anyway
with a small "timeline incomplete" note in the footer, which does not begin to
undo a chart showing the loser winning.

`blockingReason` now requires `timelineIsComplete` for any graphic declaring
`requiresTimeline`. That refuses 80 matches and keeps 658. Do not relax this to
a caption.

## The drama score zeroes home advantage; the win-prob GRAPHIC does not

`src/analysis/notable.js` ranks matches by how worth posting they are, and it
runs the model with `h = 0`. The fitted model gives the home side 0.692 at
kick-off, so an away team that led from the first minute to the last still
"bottomed out" at 0.308 - 72 of the matches scoring below 0.45 had never
trailed at all, every one an away win. The measure was reporting the venue.
Neutralised, a winner who never trailed scores exactly 0.

The win-probability graphic keeps the fitted home advantage, because there it
is predicting a match; the score is describing one that already happened. The
two therefore disagree by the home-advantage offset at kick-off, on purpose.

The comeback branch is DAMPED by how late the winner was last behind.
Undamped, "Racing 92 came back from 0-14 at 10'" was recommended - a 31-point
win, on one ten-minute spell. Fourteen of the recommendations were won by 13+
points; now none are, and the median final margin of a recommendation is 3.

The late-doubt branch is a FLAT mean over minutes 61-80. Weighting it toward
the whistle looks obviously right and is not: win probability uses the time
REMAINING, so at minute 80 there is none and any non-zero margin reads as
certainty. Weighting toward 80 weights the least informative minute most - it
halved the recommendations and left only draws at the top. The known cost of
the flat mean is that a match won with the last kick scores low, and that is
not fixable by reweighting this window.

Two branches, `max(comeback, lateDoubt)`, because neither covers the other -
they share under a quarter of their top 50. A one-point win where nobody ever
trailed scores zero on the first and high on the second. Do NOT add lead
changes as a third: it ranks a six-lead-change match that finished 14 points
apart above genuine thrillers.

**An unscoreable match is not a dull one.** 125 finished matches have no usable
timeline - every Major League Rugby match (ESPN publishes none at all for it)
and France 48-46 England, whose feed is missing the winning score. 22 of them
finished within three points. They carry no `drama` field and must read as
unrated, never as zero.

## A club's own season is NOT the league table's season

`season-{year}.json` carries a per-team match list, and it includes play-offs.
The Gallagher table records 18 played for every club; the archive holds 20 for
the winner and 19 for the beaten finalist. Both are right and mean different things, so `teamseason` prints
"INCLUDING PLAY-OFFS" when its record exceeds the table's.

**The archive is also genuinely short, and that is stated, not hidden.** ESPN
does not hold 10 of the Top 14's results (verified by re-fetching: still 172 of
182), one Gallagher fixture, and several MLR ones. Refusing those cost 10 of 14
Top 14 clubs and 9 of 16 in the URC - most of two leagues - so the chart draws
and prints "23 OF 26 MATCHES RECORDED". A gap that is STATED is not misleading;
only a silent one is.

Completeness is measured against BOTH the league table and the count of
fixtures the competition itself lists (`fixtures` per team in the season file),
because Major League Rugby has no table at all and five of its six clubs are
short - one of them a perfect "12 from 12" that is really 12 of 14.

The picker calls `teamsWithTimeline(season, { table })`, which asks exactly the
question the gate asks. Filtering on anything looser offers clubs it then
refuses.

## The form column is a trap

ESPN's `form` is a single GLOBAL "current form" snapshot per team, not that
competition's results. All 52 teams appearing in more than one table carry an
IDENTICAL string in every one - Stade Toulousain reads `WWLWL` in a Champions
Cup pool they won 4-0; France reads `WWLWL` in the 2025 Six Nations, the 2026
Six Nations and the Nations Championship alike. Where the season is short
enough to check, it reconciles with the row's own W/D/L 10% of the time.

`npm run form` recomputes it from match results and blanks it wherever it
cannot be verified. It is all-or-nothing per table: dots on 4 rows of 16 read
as a rendering fault, so a table carries form only when EVERY row reconciles.
Currently that is Six Nations 2026 and the two cup pools - 18 rows of 134.

The same script sets `partial: true` on pool tables (the Champions Cup files
hold one pool of six from twenty-four teams), and the graphic then titles them
"Pool standings" rather than implying full standings.

The weekly refresh workflow must install Chromium (`npx playwright install
--with-deps chromium`) because `mirror-crests` sits in the middle of the chain
and the playwright package ships no postinstall. It must also stage `assets`
alongside `data`, or it commits crest paths whose files were never committed.

**`npm run refresh` runs every derivation afterwards** - form, season records
and the win model. Fetching alone puts the false form strings straight back and
leaves the season files stale.

## fetch-data --only merges; it used to truncate

`--only <id>` rewrote `data/index.json` with just that competition, so
refreshing one league silently deleted the other twelve from the app - the data
stayed on disk but nothing offered it. It now merges. `npm run reindex`
rebuilds the catalogue from the per-competition index files and is the way back
if it ever happens again.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests only |
| `npm run coverage` | Unit tests with the coverage gate |
| `npm run verify` | Coverage, shots, label stress, contrast, full e2e - five steps. Run before saying done. |
| `npm run refresh` | Re-download competition data into `data/` |
| `npm run reindex` | Rebuild index files from data already on disk (no network) |
| `npm run form` | Recompute form from match results; blank where unverifiable |
| `npm run seasons` | Build per-team home/away records for the season charts |
| `npm run repair` | Fix known data faults in files already on disk |
| `npm run crests` | Mirror and downscale team crests into assets/crests |
| `npm run fit` | Refit the win-probability model |
| `npm run shots` | Render every graphic to `dev/shots/` |
| `npm run e2e` | Drive the real app in Chromium |
| `npm run stress` | Label-collision geometry over every real match |
| `npm run geometry` | Nothing off canvas, outside its box, or over other text |
| `npm run space` | Dead canvas per graphic, format and played/scheduled, swept over matches |
| `npm run contrast` | Ink contrast against the backdrop actually rendered |
| `npm run rank` | Score every match for how worth posting it is |
| `npm run benchmarks` | Rebuild the per-shirt stat benchmarks for the player card |

Four scripts need the static server running - shots, stress, contrast and e2e,
which is four of the five steps in `npm run verify` (`npx serve . -l 4321`, or
the `tryline` entry in the workspace `.claude/launch.json`).

## Style

Plain ES modules, no framework, no build step - it must keep working as static
files on GitHub Pages. Immutable data, small files, named constants. Layout
numbers are written against a 1080 reference and passed through `scale()`.
