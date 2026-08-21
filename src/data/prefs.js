/**
 * Settings that belong to the person, not to the match.
 *
 * A club's @handle and their chosen theme are the same on every graphic they
 * will ever make, and both were being retyped and re-picked every session.
 * Kept apart from the manual-entry store because they apply in both sources
 * and must survive "Forget saved details".
 */

const STORAGE_KEY = 'tryline-studio:prefs:v1'

/** Only these keys are stored; anything else in the object is dropped. */
const PREF_KEYS = Object.freeze(['handle', 'theme'])

/**
 * localStorage throws outright in some private-browsing modes, so every access
 * is guarded. A preference is never worth breaking the app over.
 */
export function loadPrefs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.freeze(Object.fromEntries(
      PREF_KEYS
        .filter((key) => typeof parsed[key] === 'string' && parsed[key])
        .map((key) => [key, parsed[key]]),
    ))
  } catch {
    return {}
  }
}

/** Merges over what is already stored, so one caller cannot wipe another's key. */
export function savePrefs(patch) {
  try {
    const next = { ...loadPrefs() }
    for (const key of PREF_KEYS) {
      if (key in patch) next[key] = String(patch[key] ?? '')
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export { PREF_KEYS }
