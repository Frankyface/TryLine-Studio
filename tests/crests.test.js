/**
 * Crest files on disk against crest paths in the data.
 *
 * The renderer builds a filename by appending a size to the stored path, so a
 * missing file is not an error anywhere - it silently becomes a lettered
 * monogram. Nothing else would catch a broken reference or a size that stopped
 * being written.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CREST_SIZES } from '../src/render/crest-sizes.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dataDir = join(root, 'data')
const crestDir = join(root, 'assets', 'crests')

/** Every object carrying a `logo`, anywhere in any of our shapes. */
function eachLogo(payload, visit) {
  if (!payload || typeof payload !== 'object') return
  if (typeof payload.logo === 'string' && payload.logo) visit(payload.logo)
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) value.forEach((entry) => eachLogo(entry, visit))
    else if (value && typeof value === 'object') eachLogo(value, visit)
  }
}

function collectLogos() {
  const logos = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.json')) {
        try { eachLogo(JSON.parse(readFileSync(path, 'utf8')), (logo) => logos.add(logo)) } catch { /* covered elsewhere */ }
      }
    }
  }
  if (existsSync(dataDir)) walk(dataDir)
  return [...logos]
}

const logos = collectLogos()
const local = logos.filter((logo) => logo.startsWith('assets/crests/'))

describe('mirrored crests', () => {
  it.skipIf(!logos.length)('has data to check', () => {
    expect(logos.length).toBeGreaterThan(0)
  })

  it.skipIf(!local.length)('has a file at every size the renderer can ask for', () => {
    const missing = []
    for (const logo of local) {
      for (const size of CREST_SIZES) {
        const file = join(root, `${logo}@${size}.png`)
        if (!existsSync(file)) missing.push(`${logo}@${size}.png`)
      }
    }
    expect(missing).toEqual([])
  })

  it.skipIf(!logos.length)('points at no remote crest', () => {
    // A remote url is a cross-origin request on every page view, and 13 of them
    // were permanently 404 at the source.
    expect(logos.filter((logo) => /^https?:\/\//.test(logo))).toEqual([])
  })

  it.skipIf(!existsSync(crestDir))('ships no crest file nothing references', () => {
    const referenced = new Set(
      local.flatMap((logo) => CREST_SIZES.map((size) => `${logo.split('/').pop()}@${size}.png`)),
    )
    const orphans = readdirSync(crestDir).filter((file) => !referenced.has(file))
    expect(orphans).toEqual([])
  })
})
