/**
 * Person-level settings. The store must never throw: localStorage is
 * unavailable outright in some private-browsing modes, and a remembered
 * handle is not worth breaking the app over.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadPrefs, savePrefs, PREF_KEYS } from '../src/data/prefs.js'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: memoryStorage() })
})

describe('savePrefs / loadPrefs', () => {
  it('round-trips a handle', () => {
    savePrefs({ handle: '@myclubrfc' })
    expect(loadPrefs().handle).toBe('@myclubrfc')
  })

  it('merges rather than replacing, so one control cannot wipe another', () => {
    savePrefs({ handle: '@myclubrfc' })
    savePrefs({ theme: 'chalk' })
    expect(loadPrefs()).toEqual({ handle: '@myclubrfc', theme: 'chalk' })
  })

  it('drops keys it does not own', () => {
    savePrefs({ handle: '@a', secrets: 'nope' })
    expect(loadPrefs().secrets).toBeUndefined()
  })

  it('omits empty values rather than storing blanks', () => {
    savePrefs({ handle: '' })
    expect(loadPrefs().handle).toBeUndefined()
  })

  it('returns nothing for absent storage', () => {
    expect(loadPrefs()).toEqual({})
  })

  it('survives a corrupt payload', () => {
    window.localStorage.setItem('tryline-studio:prefs:v1', '{not json')
    expect(loadPrefs()).toEqual({})
  })

  it('survives a payload that is not an object', () => {
    window.localStorage.setItem('tryline-studio:prefs:v1', '"a string"')
    expect(loadPrefs()).toEqual({})
  })

  it('reports failure instead of throwing when storage is unavailable', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem() { throw new Error('denied') },
        setItem() { throw new Error('denied') },
      },
    })
    expect(loadPrefs()).toEqual({})
    expect(savePrefs({ handle: '@a' }).ok).toBe(false)
  })

  it('owns exactly the two person-level settings', () => {
    expect([...PREF_KEYS].sort()).toEqual(['handle', 'theme'])
  })
})
