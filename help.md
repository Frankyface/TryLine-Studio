# Human-only tasks

Things Claude cannot do. Nothing here is urgent unless marked.

## 1. Look at the graphics on a phone

Open the app, export a set, and put them in an Instagram draft - feed post and
story. Check that text is readable at phone size and that nothing important
sits under Instagram's own UI in the story frame.

Sample PNGs are in `dev/shots/` after `npm run shots`.

## 2. It is online

**https://frankyface.github.io/TryLine-Studio/** - repo at
https://github.com/Frankyface/TryLine-Studio, Pages building from GitHub
Actions. Pushing to `main` redeploys; the weekly data refresh redeploys too.

Verified on the live site: 13 competitions load (the app opens on British &
Irish Lions), all ten graphics render, PNG export works, no 404s and no page
errors. `CLAUDE.md` and `handoff.md`
return 404 - the workflow publishes only the app.

Checked before launch, so you should not hit these:

- **It works from a subdirectory.** Pages serves project sites at
  `user.github.io/tryline-studio/`, which breaks any absolute path. Every path
  in the app is relative, and this was proved by serving the app from a
  subpath in a real browser: no 404s, graphics render, PNG export works.
- **It survives losing the fonts and crests.** With every external host blocked
  it still loads and exports; you get system fonts and monogram crests.
- **Only the app is published** - not `CLAUDE.md`, `handoff.md`, `dev/` or
  `tests/`. The workflow copies `index.html`, `src`, `styles`, `data`, `assets`
  and the favicon: 1,411 files, about 14 MB, of which 8.4 MB is match data and
  4.8 MB mirrored crests.
- **Refreshed data will actually deploy.** A workflow committing with the
  default token cannot trigger another workflow, so the Pages job also listens
  for the refresh job finishing.

## 3. Decide on the name

"TryLine Studio" is a placeholder I picked. Renaming touches `index.html`,
`README.md` and `package.json` - say the word and it's a two-minute change.
