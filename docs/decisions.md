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
applies to `src/data/**` and `format.js`. Canvas, DOM and export are verified by
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
