# Decisions

Settled. Re-open only if Cam asks.

**2026-08-21 - Both data sources, one schema.** Pro competitions via a prefetched
ESPN adapter, plus manual entry for club rugby. Both produce identical `Match`
objects so graphics never branch on source.

**2026-08-21 - Instagram set is the export unit.** One click writes both the
1080x1080 feed and 1080x1920 story PNGs. Story layouts keep content inside a
250px top/bottom safe area.

**2026-08-21 - Static JSON, not live fetching.** Forced by ESPN's 403 on browser
User-Agents. Refresh runs in Node, weekly via GitHub Actions. Side benefit: the
app is instant and works offline.

**2026-08-21 - Month-chunked fetching.** ESPN silently caps a scoreboard response
at 100 events.

**2026-08-21 - Derive the starting XV from shirt numbers.** ESPN's `starter` and
`captain` flags exist but are always false for rugby. 1-15 start, 16-23 bench,
`R` position code marks replacements. Captaincy only comes from manual entry.

**2026-08-21 - Team colours pass through a contrast guard.** France's `#0000CC`
is invisible on a dark canvas. `contrastAccent()` lifts the colour until it
clears a 3.5:1 ratio, keeping the hue.

**2026-08-21 - Feed team sheets use two columns.** 23 legible rows do not fit in
one column on a square canvas. Story keeps a single list.

**2026-08-21 - Coverage gate covers logic, not pixels.** The vitest threshold
applies to `src/data/**`, all of `src/analysis/**`, and `format.js`, `labels.js`, `series.js`, `availability.js` and `crest-sizes.js`. Canvas, DOM and export are verified by
the Playwright e2e suite instead; pixel assertions are brittle and prove little.

**2026-08-21 - Win probability is computed, never fetched.** No free rugby feed
publishes it. The model is two parameters fitted on real completed matches, and
every chart footer names the sample size. Matches with timelines that do not add
up to the final score are excluded from fitting and flagged when drawn.

**2026-08-21 - Kick-off timezone comes from a per-competition map.** ESPN
carries no timezone, latitude or country data, and `venue.address.state` is
unreliable (Stade de France returns "Reunion"). A map keyed on competition is
the honest option; the user can override it or type the time by hand.

**2026-08-21 - inkFaint must clear 4.5:1.** It labels content, not decoration.

**2026-08-21 - Chart series colours are chosen for separability, not fidelity.**
Club colours are frequently near-black or near-identical to each other. A chart
whose two areas look alike has failed at its only job.

**2026-08-21 - Team stats are aggregated from player stat lines.** ESPN's rugby
feed has no team-level statistics block (`boxscore.teams` carries only an empty
`general` entry). The aggregate is trusted only because it reconciles against a
known truth: summed player points equal the final score exactly.

**2026-08-21 - Rates are averaged over active players, never summed.** Four
kickers at 80% must not report 320%.

**2026-08-21 - Squads and stats are tracked separately.** ESPN publishes team
sheets for club rugby but stat lines only for internationals - 53 of 1,147
matches. Conflating them would offer graphics that cannot be drawn.

**2026-08-21 - Club details persist locally, scores do not.** A club using this
weekly should not retype its squad, ground and crest. Match-specific fields are
excluded on purpose: a stale scoreline is worse than an empty one.

**2026-08-21 - Uploaded crests are downscaled and re-encoded as PNG data URLs.**
Keeps the canvas untainted so export works, keeps localStorage small, and
preserves the transparency club badges rely on.

**2026-08-21 - Form is derived from match results, never taken from the feed.**
ESPN's form column is a global snapshot that contradicts the record printed
beside it. Derived form must reproduce the row's own W/D/L or it is blanked,
and it is all-or-nothing per table so a partly-filled column cannot look like
a rendering fault.

**2026-08-21 - Pool tables are labelled as pools.** A Champions Cup file holds
one pool of six from twenty-four teams; titling that "Standings" would silently
omit three quarters of the competition.

**2026-08-21 - Crest plating stays on mean luminance. Investigated and rejected
a "vanishing pixel share" test.** Counting how many of a crest's pixels fall
below a contrast bar against the page said most of the 96 mirrored crests were
largely invisible, against the ten the shipped mean-luminance test plates. That
measurement is misleading: it counts dark pixels, not illegibility. Rendering
every crest through the real `drawCrest` path and inspecting the result shows
they read fine - a mostly-dark crest like the Australia flag or the Sharks box
is defined by its bright content, and a bold blue mark clears 2:1 and is
perfectly legible. The genuinely invisible case that motivated plating in the
first place (Newcastle Falcons) is already caught. Switching to the share test
would plate roughly a third of all crests and make the design worse. The dim
wordmarks that remain (Saracens, Harlequins, Ospreys) are a matter of degree,
not a defect. Do not re-open without a legibility measure that is not just a
dark-pixel count.

**2026-08-22 - No playoff or relegation banding on the league table.
Investigated and declined.** ESPN's standings carry no qualification metadata
at all: the row is rank/team/played/won/drawn/lost/for/against/difference/
tries/bonus/points/form, and no file in `data/` contains the words qualify,
playoff or relegation. Drawing a banding line would mean hard-coding each
competition's structure by hand - which teams make the play-offs, whether the
league relegates at all, and for which season - none of it verifiable from the
source and all of it changing year to year. This project already refuses to
state what it cannot check (the incomplete-archive note, the blanked form
column, the refused win curve); a confidently drawn cutoff that is a season out
of date is the same fault with a line instead of a number. Re-open only if a
source that actually carries qualification per row is adopted.

**2026-08-22 - The hero stat's benchmark ORDERS, it does not gate.** Requiring
a value to reach its own shirt's p90 before it can headline was measured and
rejected: acceptance fell from 38.6% to 26.4% of players while the weakest
hero's percentile within its own match moved by 0.02. The per-stat floors do
the gating; the benchmark decides which of several qualifying stats wins.

**2026-08-22 - There is no perfect-rate tier on the player card.** "100% from
14 tackles" can only be reached by a player who has already cleared the volume
floor of 12, so the volume tier fires first by construction - 0 of 2,438
players in the archive ever reached a rate headline. Raising the rate's floor
cannot help, because the volume floor sits below it. The concrete number is the
better headline; the rate belongs in the supporting row.
