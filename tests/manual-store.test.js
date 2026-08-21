/**
 * Local persistence for the club path.
 *
 * localStorage is hostile in ways that matter here: it throws outright in some
 * private-browsing modes, and a crest can push an origin over quota. Losing a
 * saved squad is a nuisance; breaking the render because saving failed is not
 * acceptable, so every path is checked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadManualState, saveManualState, clearManualState, PERSISTED_FIELDS, CREST_FIELDS,
} from '../src/data/manual-store.js'

/** Minimal localStorage stand-in; vitest runs in node, which has none. */
function installStorage(behaviour = {}) {
  const store = new Map()
  globalThis.window = {
    localStorage: {
      getItem: (key) => {
        if (behaviour.throwOnRead) throw new Error('read blocked')
        return store.has(key) ? store.get(key) : null
      },
      setItem: (key, value) => {
        if (behaviour.throwOnWrite) {
          const error = new Error(behaviour.throwOnWrite)
          error.name = behaviour.throwOnWrite
          throw error
        }
        store.set(key, value)
      },
      removeItem: (key) => {
        if (behaviour.throwOnRemove) throw new Error('remove blocked')
        store.delete(key)
      },
    },
  }
  return store
}

const sampleFields = Object.fromEntries(PERSISTED_FIELDS.map((key) => [key, `value for ${key}`]))

beforeEach(() => { installStorage() })
afterEach(() => { delete globalThis.window; vi.restoreAllMocks() })

describe('saving and loading', () => {
  it('round-trips the persisted fields', () => {
    expect(saveManualState({ fields: sampleFields }).ok).toBe(true)
    const loaded = loadManualState()
    for (const key of PERSISTED_FIELDS) {
      expect(loaded.fields[key]).toBe(sampleFields[key])
    }
  })

  it('round-trips crests', () => {
    saveManualState({ fields: {}, crests: { homeCrest: 'data:image/png;base64,AAA' } })
    expect(loadManualState().crests.homeCrest).toBe('data:image/png;base64,AAA')
  })

  it('stores only the known fields, never the whole form', () => {
    // Scores and scorers change every week and must not come back stale.
    saveManualState({ fields: { ...sampleFields, 'm-home-score': '27', 'secret': 'x' } })
    const loaded = loadManualState()
    expect(loaded.fields['m-home-score']).toBeUndefined()
    expect(loaded.fields.secret).toBeUndefined()
  })

  it('skips empty values rather than storing blanks', () => {
    saveManualState({ fields: { 'm-home': 'Old Boys RFC', 'm-away': '' } })
    const loaded = loadManualState()
    expect(loaded.fields['m-home']).toBe('Old Boys RFC')
    expect(loaded.fields['m-away']).toBeUndefined()
  })

  it('ignores unknown crest keys', () => {
    saveManualState({ fields: {}, crests: { homeCrest: 'a', bogusCrest: 'b' } })
    const loaded = loadManualState()
    expect(loaded.crests.homeCrest).toBe('a')
    expect(loaded.crests.bogusCrest).toBeUndefined()
    expect(CREST_FIELDS).toContain('homeCrest')
  })

  it('returns null when nothing has been saved', () => {
    expect(loadManualState()).toBeNull()
  })

  it('accepts no argument', () => {
    expect(saveManualState().ok).toBe(true)
    expect(() => loadManualState()).not.toThrow()
  })
})

describe('hostile storage', () => {
  it('reports a full quota instead of throwing', () => {
    installStorage({ throwOnWrite: 'QuotaExceededError' })
    const result = saveManualState({ fields: sampleFields })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/storage is full/i)
  })

  it('reports a blocked write instead of throwing', () => {
    installStorage({ throwOnWrite: 'SecurityError' })
    const result = saveManualState({ fields: sampleFields })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/will not let/i)
  })

  it('survives storage that throws on read', () => {
    installStorage({ throwOnRead: true })
    expect(loadManualState()).toBeNull()
  })

  it('survives storage that throws on remove', () => {
    installStorage({ throwOnRemove: true })
    expect(clearManualState()).toBe(false)
  })

  it('survives localStorage being absent entirely', () => {
    globalThis.window = {}
    expect(loadManualState()).toBeNull()
    expect(saveManualState({ fields: sampleFields }).ok).toBe(false)
    expect(clearManualState()).toBe(false)
  })

  it('ignores corrupted stored data', () => {
    const store = installStorage()
    store.set('tryline-studio:manual:v1', '{ not json')
    expect(loadManualState()).toBeNull()
  })

  it('ignores stored data of the wrong shape', () => {
    const store = installStorage()
    store.set('tryline-studio:manual:v1', '"a string"')
    expect(loadManualState()).toBeNull()
    store.set('tryline-studio:manual:v1', '{"fields":"nope"}')
    expect(loadManualState().fields).toEqual({})
  })
})

describe('clearing', () => {
  it('forgets everything', () => {
    saveManualState({ fields: sampleFields, crests: { homeCrest: 'a' } })
    expect(loadManualState()).not.toBeNull()
    expect(clearManualState()).toBe(true)
    expect(loadManualState()).toBeNull()
  })
})
