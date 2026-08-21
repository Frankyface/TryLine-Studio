# TryLine Studio

Instagram-ready rugby matchday graphics, generated in the browser from real
competition data or from your own team sheet.

Five graphics, each exported as a 1080×1080 feed post and a 1080×1920 story:

| Graphic | What it shows |
|---|---|
| **Result** | Final or live score, crests, try and goal scorers, cards |
| **Matchday** | Fixture announcement with date, kick-off and venue |
| **Team sheet** | The matchday 23 by shirt number, starters and replacements |
| **Player card** | One player and their match numbers |
| **League table** | Standings with bonus points and points difference |
| **Win probability** | How the match swung, minute by minute, with the key moments marked |
| **Match stats** | Team-v-team or player-v-player head-to-head |
| **Attack v defence** | A whole season plotted by what each team scores and concedes |
| **Home advantage** | Every club's home win rate against its away win rate |

No build step, no framework, no server. Plain ES modules and a canvas.

## Using it

```bash
npm install
npm run refresh
```

Then open `index.html` through any static server (`npx serve .`) and pick a
match. Nothing is uploaded — every graphic is drawn in your browser and saved
straight to your downloads.

**Live competition** covers 13 competitions with fixtures - Six Nations,
International Tests, Gallagher Premiership, URC, Top 14, Champions and Challenge
Cup, Super Rugby Pacific, The Rugby Championship, Major League Rugby, British &
Irish Lions, Women's Rugby World Cup and the Nations Championship: crests,
squads, per-player stats and scoring timelines.

Kick-off times render in the competition's own timezone rather than yours, since
a Top 14 match kicking off at 21:10 in Paris should not read as 15:10 in Canada.
Pick any zone, or type the date and time by hand.

**My own team** needs no data at all. Type the teams, the score and a squad list
(one name per line, `2 Alex Jones (c)` for the captain) and every graphic works
identically — this is the path for club and amateur rugby, where no API exists.

Upload your club crest and it is used everywhere a competition crest would be.
Your club name, ground, squad and crest are remembered in your own browser so
you are not retyping them every Saturday; "Forget saved details" clears them.
Nothing is uploaded anywhere — the crest is downscaled and kept locally.

## Refreshing the data

```bash
npm run refresh
```

Writes normalised JSON into `data/`. A GitHub Action re-runs it every Monday
morning. Options: `--only <competitionId>`, `--details <n>`, `--lookahead <days>`.

**The browser cannot call ESPN directly.** ESPN returns `403` to any browser
User-Agent, and because the 403 body carries no CORS header the browser reports
it as a CORS failure, which hides the real cause. Requests from Node are served
normally, so all fetching happens in `scripts/fetch-data.mjs` and the app only
ever reads static files. This also makes the app instant and usable offline.

## What the data can and cannot support

ESPN publishes **team sheets** widely but **per-player statistics only for
internationals**. Of 1,147 downloaded matches, 195 carry squads and just 53
carry stat lines - Six Nations, Women's Rugby World Cup, The Rugby Championship
and Lions tours. Every club competition (Premiership, URC, Top 14, Champions
Cup, Super Rugby) has names and shirt numbers but no numbers behind them.

The app tracks this as a separate `hasStats` flag with its own filter, and any
graphic needing stats says so rather than drawing a card full of dashes.

Team figures on the match-stats card are aggregated from the individual stat
lines, because the feed has no team-level block. That aggregate is checked
against a known truth: summed player points equal the actual final score in
102 of 106 team-matches, and the four exceptions are cases where ESPN's own
timeline is missing the same converted try.

Which stats appear on a card is a measured decision, not a taste one. Rows that
read 0-0 in half their matches are excluded, and `defendersBeaten` is off the
card because it is the opponent's `missedTackles` counted from the other end -
99.1% identical, so showing both would duplicate a row.

## The win probability model

No feed publishes win probability for rugby - ESPN has one for basketball but
not this sport - so it is computed here:

```bash
npm run fit
```

Two parameters, fitted by gradient ascent on 658 real completed matches
(53,298 minute-by-minute samples), writing `data/models/winprob.json` alongside
its own measured accuracy. Current fit: **79.0% accuracy**, 0.429 log loss,
calibrated within a few points across every probability band. Validated against
raw outcomes - at half time a side leading by 8-14 points won 89% of the time
and the model says 90%.

Matches whose scoring timeline does not add up to the recorded final score are
excluded from fitting and flagged in the footer when drawn, because roughly one
ESPN timeline in nine is missing an event.

## Verifying

```bash
npm run verify
```

Runs three layers:

1. `vitest` — 106 unit tests against real captured API responses in
   `tests/fixtures/`, with a coverage gate on the data and formatting logic.
2. `dev/shots.mjs` — renders every graphic in both formats to `dev/shots/` for
   visual review.
3. `tests/app.e2e.mjs` — drives the real app in Chromium: every graphic, both
   data sources, theme switching, and a real PNG download.

## Layout

```
index.html            the app
src/data/             schema, ESPN adapter, manual entry, static-file client
src/render/           theme, canvas primitives, five graphics
src/export/           canvas to PNG
scripts/fetch-data.mjs   data refresh (Node only)
data/                 refreshed competition data
tests/                unit tests, fixtures, end-to-end suite
```

Every data source produces the same `Match` object (`src/data/schema.js`), so a
graphic never knows or cares whether it came from a pro feed or a typed team sheet.

## Data source

Live data comes from ESPN's public but **undocumented** rugby endpoints. They
need no key and are fine for club and personal use, but they can change without
notice and are not licensed for commercial use. `src/data/espn.js` is the only
file that knows their shape — swapping in a licensed provider means rewriting
that one adapter.
