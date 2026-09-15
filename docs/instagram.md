# Instagram preparation and publishing

TryLine Studio now prepares complete posting bundles from the existing canvas
renderers. It does not connect to an Instagram account or publish posts.

For the five domestic leagues, [Weekly studio](weekly-posting.md) now prepares
fixture previews, results/standings/analysis, scoring spotlights and match
timeline carousels with a dated JSON/CSV posting calendar.

## Quick start

```bash
npm ci
npx playwright install chromium
npm run plan -- --match 602502 --handle @yourclub
```

No static server needs to be started. The command owns a temporary loopback
server and browser, loads the bundled fonts and crests, and closes both after
success or failure. External requests are blocked. Missing assets fail the run
instead of silently shipping fallback fonts or missing crests. Intentionally
blank crest URLs still use the designed monogram.

Open `dev/posts/180659-602502-final/preview.html` to review the images and captions.
Each bundle contains:

- JPEGs at 1080×1080 for feed and 1080×1920 for Stories, quality 0.94.
- `captions.txt` and descriptive alt text in the manifest.
- `plan.json` and an immutable `plan-<hash>.json` manifest.
- An offline `preview.html` contact sheet with image downloads.

The CLI rejects images over its 8 MB budget and captions over 2,200 characters.
The app also offers JPEG in the Export panel; PNG remains the default there.

## Batch preparation

```bash
# Explicit matches; archive data is allowed with a warning.
npm run plan -- --match 602502,602503 --formats feed --side away

# Final matches that KICKED OFF within the last 24 hours, newest first.
npm run plan -- --recent --competition 180659 --phase final --limit 3

# Upcoming fixtures, closest first; old scheduled fixtures are excluded.
npm run plan -- --recent --phase scheduled --lookahead-hours 48

# Reproduce an archive selection without opening a browser.
npm run plan -- --recent --competition 180659 --now 2026-02-08T00:00:00Z --allow-stale --no-render
```

Batch selection refuses competition data older than 48 hours by default. Use
`npm run refresh` first; `--allow-stale` is an explicit archive-preview override.
`--max-age-hours` changes that bound. The timestamp is checked per competition:
refreshing one league cannot make the other leagues appear fresh.

The kickoff window is **not a completion-time window**; the source has no
reliable final-whistle timestamp. Live, cancelled, postponed, suspended and
abandoned matches are excluded. Final results need two valid scores, including
0–0 draws. Fixtures with 0–0 placeholders remain fixtures.

Kickoff times use the venue's zone, then the competition's zone, then UTC;
`--timezone America/Toronto` overrides this explicitly. A runner's location
cannot change an image. `--side home|away` controls the team sheet and featured
player. A player with a supported scoring headline is preferred to the first
shirt in the squad; this is not a claim to be player of the match.

`--no-render` uses Node only and writes `draft.json`, an immutable draft and
`queue-draft.json`. Image paths are null and status is `planned`. It never
overwrites a rendered manifest or claims images exist. See `--help` for all flags.

## Contract for a future publisher

Consume `queue.json` **only after the command exits successfully**, then read
the immutable manifests it references. A failed run leaves the previous queue
in place, rather than exposing a partly completed batch.

Each manifest carries `schemaVersion`, `status`, match/competition/phase,
source freshness, kickoff, timezone, handle, side, and ordered `cards`. Each card
has a stable `id`, graphic, format, theme, caption, alt text, destination,
dimensions, MIME type, filename, byte count and SHA-256. Image paths are relative
to the manifest. Filenames include a content hash, so changed artwork cannot
replace the bytes behind an existing URL. Different matches have different
directories. `FEED` and `STORIES` are distinct destinations; do not send a 9:16
Story image through the feed-image endpoint or assume Stories accept captions
and alt text in the same way.

Stable IDs identify the competition, match, phase, graphic, subject and format.
They exclude theme, image hash and queue position. A publisher must keep a
**durable ledger** keyed by account plus card ID and record container/media IDs.
The renderer itself has no published-post ledger and does not deduplicate live
Instagram posts. A changed theme must not become a new post on retry. When an
API call times out after submission, reconcile the existing container/media
before retrying; a deterministic file alone does not prevent duplicates.

Reruns of the same input in the same browser environment produce identical
images and manifests. Across browser/OS/font updates, image hashes may change;
card IDs remain stable. Concurrent runs into the same output directory are
refused with an exclusive `.render-lock`. If a process is forcibly killed,
confirm it has stopped before removing that empty lock directory.

## GitHub Actions

After merging, run **Prepare Instagram graphics** from the Actions tab, enter
match IDs, choose formats/side and optionally a handle. Download the resulting
artifact, unzip it and open the previews. This workflow only needs repository
read permission and uploads a review artifact; it does not publish to Pages or
Instagram. **Verify studio** runs the complete graphics and export suite on PRs.

## Connecting an account later

The remaining integration is a server-side publisher: choose the supported
Meta login flow and account permissions, store tokens in a secrets store,
upload the JPEGs to a publicly reachable image host, then create and publish
media containers while maintaining the ledger above. Account eligibility,
Stories support, token lifecycle, permissions and quotas depend on the selected
flow. Check the account's current publishing allowance at runtime instead of
hard-coding the old 25-post figure from earlier project notes.

Use Meta's [Instagram Platform documentation](https://developers.facebook.com/docs/instagram-platform/)
and [content-publishing guide](https://developers.facebook.com/docs/instagram-platform/content-publishing/)
when wiring that service. Those pages were rate-limited during this implementation;
no live Meta integration or current account eligibility has been verified.
No access token belongs in this repository or in files served by GitHub Pages.

The existing weekly data refresh is suitable for archive preparation. A future
matchday publisher will need a more frequent, narrowly scoped data refresh and
must wait for the source to report a final result. Preparation and publishing
remain separate so generating a preview never posts it accidentally.
