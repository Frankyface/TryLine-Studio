/**
 * A primary and a secondary colour for every team, from their own crest.
 *
 * ESPN carries neither. Checked directly against the live API rather than
 * assumed: the scoreboard, the teams list and a single-team response all
 * return `color` and nothing else - no `alternateColor` on any of the 112
 * teams in the archive - and only 69 of them have even that one. So the
 * secondary has to come from somewhere, and the crests are already mirrored
 * locally at two sizes, which makes them free to read and impossible to get
 * throttled on.
 *
 * ESPN's `color` stays authoritative for the primary wherever it exists; the
 * crest fills the 43 gaps and supplies every secondary. The script reports how
 * often its own primary agrees with ESPN's, which is the only honest check
 * available on a derived value.
 *
 * Written to data/models/team-colours.json, keyed by team id.
 *
 * Usage: node scripts/build-team-colours.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dataDir = join(root, 'data')
const crestDir = join(root, 'assets', 'crests')
const checkOnly = process.argv.includes('--check')
const NL = String.fromCharCode(10)

/** Every distinct team the archive knows, with whatever ESPN gave us. */
function teamsFromArchive() {
  const teams = new Map()
  for (const competition of readdirSync(dataDir)) {
    const dir = join(dataDir, competition)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    const matchDir = join(dir, 'matches')
    if (!existsSync(matchDir)) continue
    for (const file of readdirSync(matchDir)) {
      let match
      try {
        match = JSON.parse(readFileSync(join(matchDir, file), 'utf8'))
      } catch { continue }
      for (const side of ['home', 'away']) {
        const team = match[side]
        if (!team?.id || teams.has(team.id)) continue
        teams.set(team.id, { id: team.id, name: team.name, espn: team.color || '', logo: team.logo || '' })
      }
    }
  }
  return [...teams.values()]
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

const toRgb = (value) => {
  const clean = String(value).replace('#', '')
  if (clean.length !== 6) return null
  return [0, 2, 4].map((at) => parseInt(clean.slice(at, at + 2), 16))
}

/** Perceptual-ish distance, good enough to say "these are the same colour". */
function distance(a, b) {
  const rMean = (a[0] + b[0]) / 2
  const [dr, dg, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db)
}

const teams = teamsFromArchive()
const browser = await chromium.launch()
const page = await browser.newPage()

const extracted = await page.evaluate(async (files) => {
  /**
   * The two colours a crest is actually built from.
   *
   * Pixels are bucketed coarsely and ranked by how much of the crest they
   * cover. Two things are excluded and both matter: fully transparent pixels,
   * which are most of a crest's bounding box, and near-white, which is the
   * page a wordmark sits on rather than a colour the club wears. Near-BLACK is
   * NOT excluded - New Zealand and Newcastle are black, and dropping it would
   * hand them somebody else's colour.
   *
   * The secondary has to be far enough from the primary to be a different
   * colour rather than a shade of it, or a crest with one colour and its own
   * anti-aliasing returns that colour twice.
   */
  const read = (src) => new Promise((resolve) => {
    const image = new Image()
    image.onerror = () => resolve(null)
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(image, 0, 0)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const buckets = new Map()
      let counted = 0
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
        if (a < 200) continue
        if (r > 236 && g > 236 && b > 236) continue
        counted += 1
        const key = `${r >> 4}|${g >> 4}|${b >> 4}`
        const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
        bucket.r += r
        bucket.g += g
        bucket.b += b
        bucket.n += 1
        buckets.set(key, bucket)
      }
      if (!counted) return resolve(null)

      const ranked = [...buckets.values()]
        .map((bucket) => {
          const rgb = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n]
          const high = Math.max(...rgb)
          const low = Math.min(...rgb)
          return {
            rgb,
            share: bucket.n / counted,
            // How far from grey. An outline, a drop shadow and a crest's own
            // anti-aliasing are all grey, and all three outrank the actual
            // second colour on pixel count.
            chroma: high - low,
          }
        })
        .sort((a, b) => b.share - a.share)

      resolve({ ranked: ranked.slice(0, 16), counted })
    }
    image.src = src
  })

  const out = {}
  for (const file of files) {
    out[file.id] = await read(file.src)
  }
  return out
}, teams
  .filter((team) => existsSync(join(crestDir, `${team.id}@96.png`)))
  // Handed in as data URLs, not file:// paths. A file:// image taints the
  // canvas, `getImageData` throws, and the loader resolves null - so the first
  // run reported 0 crests read and looked exactly like 74 missing files.
  .map((team) => ({
    id: team.id,
    src: 'data:image/png;base64,'
      + readFileSync(join(crestDir, `${team.id}@96.png`)).toString('base64'),
  })))

await browser.close()


/**
 * Below this two colours are the same colour, and ONE number does both jobs.
 *
 * At 110 the two tests disagreed with each other: England's #FF0000 counted as
 * disagreeing with a crest's #e52e33, while that same #e52e33 was offered as
 * England's second colour. Two shades of one red cannot be both. Raised, the
 * red-primary teams stop offering another red, and South Africa keeps its
 * gold, Australia its green, France its red and Argentina its yellow.
 */
const SAME_COLOUR = 170

/**
 * A second colour has to be a MAJOR part of the crest, not merely present in
 * it. Measured across the archive: at 0.06 England came back with the green of
 * its rose leaves and Wales with the green of its feathers; at 0.15 both
 * correctly come back with nothing, and 29 of 113 teams offer a second colour
 * that the club actually wears. Crest extraction can only ever say what is IN
 * a crest - this is the bar that keeps that from being read as a brand.
 */
const MIN_SHARE = 0.15

/** And far enough from grey to be a colour rather than an outline. */
const MIN_CHROMA = 40

const colours = {}
let derived = 0
let agreed = 0
let compared = 0
let missing = 0
const disagreements = []

for (const team of teams) {
  const found = extracted[team.id]
  const ranked = (found?.ranked || []).map((entry) => ({ ...entry, hex: hex(entry.rgb) }))
  const crestPrimary = ranked[0]?.hex || ''
  // How often the crest agrees with ESPN. This is the only check available on
  // a derived value, and it is a sanity check on the extraction rather than a
  // gate: where the two differ, ESPN's is the one that ships.
  if (team.espn && crestPrimary) {
    compared += 1
    const apart = distance(toRgb(team.espn), toRgb(crestPrimary))
    if (apart <= SAME_COLOUR) agreed += 1
    else disagreements.push({ name: team.name, espn: team.espn, crest: crestPrimary, apart: Math.round(apart) })
  }

  const primary = team.espn || crestPrimary

  /**
   * A second colour the club actually wears, or nothing.
   *
   * Three bars, and each removed a specific wrong answer seen in the output:
   * it must be a real share of the crest rather than a stray detail, it must
   * be far enough from grey to be a colour rather than an outline or the
   * crest's own anti-aliasing, and it must be far enough from the primary to
   * be a different colour rather than a shade of it. Before them England came
   * back with the green of its rose leaves, New Zealand with #282828 against
   * its own black, and Ireland with a near-white.
   *
   * Returning nothing is a normal outcome. A crest that is genuinely one
   * colour has no second one, and inventing it would put a colour the club
   * does not wear behind their name.
   */
  const secondary = primary
    ? ranked.find((entry) => entry.share >= MIN_SHARE
      && entry.chroma >= MIN_CHROMA
      && distance(entry.rgb, toRgb(primary)) > SAME_COLOUR)?.hex || ''
    : ''

  if (!primary && !secondary) { missing += 1; continue }
  if (crestPrimary) derived += 1
  colours[team.id] = {
    name: team.name,
    primary,
    secondary,
    primaryFrom: team.espn ? 'espn' : 'crest',
  }
}


const payload = {
  teams: Object.keys(colours).length,
  withSecondary: Object.values(colours).filter((entry) => entry.secondary).length,
  colours,
}

process.stdout.write(`${teams.length} teams in the archive${NL}`)
process.stdout.write(`  ESPN gave a primary for      ${teams.filter((team) => team.espn).length}${NL}`)
process.stdout.write(`  crest yielded a colour for   ${derived}${NL}`)
process.stdout.write(`  ended with a primary         ${Object.values(colours).filter((entry) => entry.primary).length}${NL}`)
process.stdout.write(`  ended with a secondary       ${payload.withSecondary}${NL}`)
process.stdout.write(`  no colour at all             ${missing}${NL}${NL}`)
process.stdout.write(`Crest-derived primary agrees with ESPN's on ${agreed} of ${compared}`
  + ` (${compared ? Math.round((agreed / compared) * 100) : 0}%)${NL}`)
process.stdout.write(`${NL}Sample of what each team ends up with:${NL}`)
for (const [id, entry] of Object.entries(colours).slice(0, 14)) {
  process.stdout.write(`  ${String(entry.name).padEnd(26)}${entry.primary || '-'}`
    + ` (${entry.primaryFrom})   secondary ${entry.secondary || '-'}${NL}`)
}
process.stdout.write(`${NL}`)
for (const row of disagreements.slice(0, 8)) {
  process.stdout.write(`  ${row.name.padEnd(26)}espn ${row.espn}  crest ${row.crest}  apart ${row.apart}${NL}`)
}

if (checkOnly) {
  process.stdout.write(`${NL}nothing written${NL}`)
} else {
  mkdirSync(join(dataDir, 'models'), { recursive: true })
  writeFileSync(join(dataDir, 'models', 'team-colours.json'), `${JSON.stringify(payload)}${NL}`)
  process.stdout.write(`${NL}wrote data/models/team-colours.json${NL}`)
}
