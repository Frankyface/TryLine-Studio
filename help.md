# Human-only tasks

Things Claude cannot do. Nothing here is urgent unless marked.

## 1. Look at the graphics on a phone

Open the app, export a set, and put them in an Instagram draft - feed post and
story. Check that text is readable at phone size and that nothing important
sits under Instagram's own UI in the story frame.

Sample PNGs are in `dev/shots/` after `npm run shots`.

## 2. Put it online (when you want it)

The app is static, so GitHub Pages hosts it free. **It is not a git repository
yet** - that is the only thing standing between it and being live.

```bash
git init -b main && git add -A && git commit -m "feat: rugby matchday graphics"
```

```bash
gh repo create tryline-studio --public --source . --push
```

Then in the repo: Settings -> Pages -> Source: **GitHub Actions**. The workflows
in `.github/workflows/` handle deploys and the weekly data refresh.

Already checked, so you should not hit these:

- **It works from a subdirectory.** Pages serves project sites at
  `user.github.io/tryline-studio/`, which breaks any absolute path. Every path
  in the app is relative, and this was proved by serving the app from a
  subpath in a real browser: no 404s, graphics render, PNG export works.
- **It survives losing the fonts and crests.** With every external host blocked
  it still loads and exports; you get system fonts and monogram crests.
- **Only the app is published** - not `CLAUDE.md`, `handoff.md`, `dev/` or
  `tests/`. The workflow copies just `index.html`, `src`, `styles`, `data` and
  the favicon (about 8.5 MB, 1,207 files).
- **Refreshed data will actually deploy.** A workflow committing with the
  default token cannot trigger another workflow, so the Pages job also listens
  for the refresh job finishing.

## 3. Decide on the name

"TryLine Studio" is a placeholder I picked. Renaming touches `index.html`,
`README.md` and `package.json` - say the word and it's a two-minute change.
