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
  ESPN dropped a converted try. Gate any tries/points row on reconciliation;
  take the scoreline from `home.score`, which is always right.
- Tackles run ~25% above a "tackles made" convention (ESPN appears to count
  assists), so do not caption them one-per-tackle.

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
| `npm run contrast` | Ink contrast against the backdrop actually rendered |

Four scripts need the static server running - shots, stress, contrast and e2e,
which is four of the five steps in `npm run verify` (`npx serve . -l 4321`, or
the `tryline` entry in the workspace `.claude/launch.json`).

## Style

Plain ES modules, no framework, no build step - it must keep working as static
files on GitHub Pages. Immutable data, small files, named constants. Layout
numbers are written against a 1080 reference and passed through `scale()`.
