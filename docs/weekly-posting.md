# Domestic weekly posting

Open **Weekly studio** from the main app, choose a league, a coverage week and
an edition. Each slide has a JPEG download and a copyable caption. The schedule
can be downloaded as JSON. The browser reads the static `data/` archive only.

## Editorial rhythm

Cover Premiership, Top 14, URC, Super Rugby Pacific and Major League Rugby.
Every recorded completed match is included; there is no standout-match filter.
The coverage week runs Monday–Sunday in **America/Toronto**. Late Sunday games
stay in that week even if their UTC date is Monday. Daylight saving time is
handled when computing UTC publication timestamps.

| Edition | Posting day | Carousel order |
|---|---|---|
| Weekly preview | Wednesday of the coverage week | Every upcoming fixture, six per slide |
| Results & analysis | Following Monday | Every final result → standings when available → weekly team analysis → up to two scoring spotlights |
| Match stories | Following Tuesday | One timeline per completed match; a result card if events cannot be verified |

Each posting day uses these local slots:

| League | Eastern Time |
|---|---|
| Super Rugby Pacific | 09:00 |
| URC | 10:00 |
| Premiership | 11:00 |
| Top 14 | 12:00 |
| MLR | 13:00 |

These are editorial defaults, not engagement claims. Change the hours in
`src/publish/weekly.js` after comparing actual account performance. A preview
moves earlier if needed to precede the first fixture by at least 24 hours.
The midnight marker for an unannounced kick-off is kept on its supplied date,
labelled TBC, and scheduled before that day begins. It is not shifted into
Sunday by converting a fictional Monday midnight UTC kick-off to Eastern Time.

The preview is generated from fixtures still upcoming at preparation time.
If rebuilding it after games have begun, those games remain in the review pack.
No-fixture weeks produce an explicit status, not invented fixtures or a claim
that the league has a bye. Check the source calendar when coverage is empty.

## What the new graphics say

- **Weekly fixtures / results:** all games, automatically paginated at six per
  slide. Club names fit their column; captions retain full names.
- **Weekly analysis:** points scored, average combined points per match,
  home wins, away wins, draws and the four highest team scores in a match.
  These are final-score calculations, not inferred possession or tackle stats.
- **Scoring spotlight:** a named player's tries, conversions, penalty goals,
  drop goals and total points. The first selection favours tries; the second
  favours points and cannot repeat the same player. It is an editorial
  selection, not an official player-of-the-match award. Penalty tries are
  team points and never credited to a player.
- **Match timeline:** running scores at 20, 40 and 60 minutes and full time,
  with rugby-ball, goalpost, yellow-card and red-card icons in each period.
  Icon counts are grouped, not precisely positioned at individual minutes.
  The 40-minute checkpoint is not claimed to be the half-time whistle.
  FT includes added time. `PT` means penalty try; `con`, `pen` and `DG` identify
  conversions, penalty goals and drop goals in the scoring-kick breakdown.

Every scoring event must have a known type, side and minute. Its point value
must add up to the final score. Merely supplying a last cumulative score that
matches the result does not pass. Missing or inconsistent events produce a
result-card fallback, and remain visible in the pack caption.

The present domestic archive usually lacks player performance stats. MLR also
has no scoring timelines or standings from this provider. Its results and
weekly score analysis still render. Do not fill those gaps with made-up data.

## Standings and readiness

Standings must be for the same league and season, with the snapshot dated in
the covered week or its following Monday/Tuesday. An August table must not be
labelled as the standings after an April round. Older sample editions therefore
omit standings and state why; the existing league-table graphic handles a
contemporaneous table when one is supplied. No ranking changes or bonus points
are reconstructed from final scores alone.

Snapshots older than 48 hours, invalid timestamps and future timestamps are
blocked by default in the CLI. `--allow-stale` permits archive review but keeps
the manifest state `needs-refresh`. A review with unresolved fixtures is marked
`waiting-for-results`; cancelled, postponed and abandoned matches are excluded.
Readiness is distinct from whether an image was successfully rendered.

## Prepare packs and calendar

```bash
npm ci
npx playwright install chromium
npm run refresh

# Wednesday preview for the current coverage week, all five leagues.
npm run weekly -- --pack preview

# Monday roundup, then Tuesday match timelines for the previous week.
npm run weekly -- --previous --pack review
npm run weekly -- --previous --pack stories

# An explicit week, one league, both image formats.
npm run weekly -- --week 2026-04-20 --competition 267979 --formats feed,story --allow-stale

# Calendar and captions only. No browser required.
npm run weekly -- --week 2026-04-20 --allow-stale --no-render
```

`--timezone`, `--handle`, `--out` and zoned `--now` are also supported.
Open `dev/posts/weekly/index.html` for the exported calendar and links to every
pack. Each pack contains JPEGs, captions, a preview, stable slide IDs, content
hashes, source timestamps and an immutable `plan-<hash>.json`. Feed and Story
formats are separate packs. More than ten slides split into numbered carousel
parts, preserving every slide. A preparation lock prevents concurrent writes;
draft runs use separate files and cannot overwrite rendered calendar manifests.

The **Prepare domestic weekly packs** GitHub Action creates the same downloadable
artifacts. Run **Refresh rugby data** first for current editions, or explicitly
enable the archive option when reviewing historical examples.

The calendar is a plan, not a scheduled Instagram post. No publishing jobs or
Instagram API calls are enabled. A future publisher must check readiness,
respect carousel/slide order, host images, and deduplicate stable IDs in its
publication ledger. Account authorization is still required; see
[the publisher contract](instagram.md).

## Verification

`npm run verify` includes pure weekly/date/event tests, all graphics in both
formats, real-data geometry checks and the weekly browser/export smoke test.
The latter covers every league, mobile controls, JPEG and schedule downloads,
empty weeks and byte-identical CLI retries. `npm run e2e:weekly` runs it alone.
