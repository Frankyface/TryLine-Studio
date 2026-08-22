/**
 * Export filenames.
 *
 * The name is the only thing a club sees in its downloads folder, so it has to
 * identify the graphic on its own. It also has to be UNIQUE per export: a
 * per-club graphic that named itself after the competition gave every club in
 * a league the identical filename, so saving a second one either overwrote the
 * first or landed as "(1)".
 */
import { describe, it, expect } from 'vitest'
import { fileNameFor } from '../src/export/png.js'

const season = { competition: { name: 'Gallagher Prem' }, season: { display: '2026' } }
const table = { competition: { name: 'Gallagher Prem' }, season: { display: '2026' } }
const match = {
  competition: { name: 'Six Nations', abbreviation: 'Six Nations' },
  home: { shortName: 'France' },
  away: { shortName: 'England' },
}

describe('fileNameFor', () => {
  it('names a match graphic after the fixture', () => {
    expect(fileNameFor({ match, graphicId: 'result', sizeId: 'feed' }))
      .toBe('six-nations-france-v-england-result-feed.png')
  })

  it('names a table graphic after the competition and season', () => {
    expect(fileNameFor({ table, graphicId: 'table', sizeId: 'story' }))
      .toBe('gallagher-prem-2026-table-story.png')
  })

  it('names a per-club graphic after the club', () => {
    expect(fileNameFor({
      season, table, graphicId: 'teamseason', sizeId: 'feed', options: { team: 'Northampton Saints' },
    })).toBe('gallagher-prem-northampton-saints-2026-teamseason-feed.png')
  })

  it('gives two clubs in one league two different filenames', () => {
    const nameFor = (team) => fileNameFor({
      season, table, graphicId: 'teamseason', sizeId: 'feed', options: { team },
    })
    expect(nameFor('Northampton Saints')).not.toBe(nameFor('Newcastle Falcons'))
  })

  it('ignores a club on a graphic that does not use one', () => {
    expect(fileNameFor({
      season, table, graphicId: 'fortress', sizeId: 'feed', options: { team: 'Northampton Saints' },
    })).toBe('gallagher-prem-2026-fortress-feed.png')
  })

  it('survives a per-club graphic with no club chosen', () => {
    expect(fileNameFor({ season, table, graphicId: 'teamseason', sizeId: 'feed' }))
      .toBe('gallagher-prem-2026-teamseason-feed.png')
  })

  it('falls back to a generic name with no data at all', () => {
    expect(fileNameFor({ graphicId: 'table', sizeId: 'feed' })).toBe('rugby-table-feed.png')
  })

  it('produces a filesystem-safe name from awkward club names', () => {
    const name = fileNameFor({
      season, table, graphicId: 'teamseason', sizeId: 'feed',
      options: { team: 'Section Paloise / Pau (Béarn)' },
    })
    expect(name).toMatch(/^[a-z0-9-]+\.png$/)
  })
})
