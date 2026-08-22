# Auto-posting to Instagram

Groundwork, and an honest account of what is not built.

## What exists now

`src/publish/plan.js` decides **what to post**: which cards, in what order, on
which theme, with what caption. It is pure logic and fully tested
(`tests/plan.test.js`), and it reuses the app's own `blockingReason`, so a plan
never lists a card the renderer would refuse — a posting run that fails halfway
because card four cannot be drawn is the failure mode this prevents.

`npm run plan` writes a plan and renders its PNGs.

Theme rotation is deterministic: both the starting theme and the step through
the list come from the match id, so the same match always produces the same
run and a retry after a failure repeats it exactly. Measured over 864 archived
matches: 160 distinct theme runs, and no card ever follows one on the same
theme. A theme added to `THEMES` joins the rotation with no second edit.

## What does NOT exist, and why

**There is no back end.** TryLine Studio is static files on GitHub Pages. It has
no server, no secrets store and no scheduler. Everything below needs at least
one of those, so none of it can be added to the site itself.

Publishing to Instagram needs, in order:

1. **An Instagram Business or Creator account**, linked to a Facebook Page.
   A personal account cannot be posted to by any API.
2. **A Meta app** with the `instagram_content_publish` and
   `instagram_basic` permissions. These require App Review — Meta has to
   approve the app before it can post to an account it does not own.
3. **A long-lived access token**, which expires after 60 days and has to be
   refreshed on a schedule. This is a secret and cannot live in a static site;
   anything shipped to the browser is public.
4. **Publicly reachable image URLs.** The Graph API does not accept image
   bytes for a feed post — it fetches a URL you give it. The PNGs have to be
   uploaded somewhere public first.
5. **Two API calls per card**: create a media container, then publish it.
   Carousels and Stories each have their own shape and their own limits.
6. **A rate limit** of 25 published posts per account per rolling 24 hours.

The realistic shape is a small scheduled job — a GitHub Action, or whatever
runs the other `scripts/` — that renders the plan, uploads the PNGs, and calls
the API with a token held as a repository secret. `plan.js` is the input to
that job and is deliberately independent of it.

## What to be careful about

- **Do not put a token in this repository or in any file the site serves.**
- **A failed run must be resumable.** The plan is deterministic for exactly
  this reason: re-planning the same match gives the same cards in the same
  order, so a job can record how far it got and continue.
- **Captions state only what the analysis found.** `captionFor` falls back to
  the scoreline, which is always true, rather than inventing a line. The same
  rule the graphics follow.
- **Posting is outward-facing and irreversible.** Whatever runs this should
  require an explicit opt-in per match rather than posting everything it can.
