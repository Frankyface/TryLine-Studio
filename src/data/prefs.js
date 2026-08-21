/**
 * Settings that belong to the person, not to the match.
 *
 * A club's @handle, their chosen theme and whether they work from a live
 * competition or their own team are the same every week, and all three were
 * being set again every session - a club had its squad restored from storage
 * but still had to click "My own team" to see it.
 *
 * Kept apart from the manual-entry store because they apply in both sources
 * and must survive "Forget saved details".
 */

const STORAGE_KEY = 'tryline-studio:prefs:v1'

/** Only these keys are stored; anything else in the object is dropped. */
const PREF_KEYS = Object.freeze(['handle', 'theme', 'source'])

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
  } catch (error) {
    // Matches saveManualState's shape so a caller can show the reason rather
    // than failing silently.
    const detail = `${error?.name ?? ''} ${error?.message ?? ''}`
    return {
      ok: false,
      reason: /quota|exceeded/i.test(detail)
        ? 'This browser is out of local storage, so your handle and theme were not remembered.'
        : 'This browser will not let the page store anything, so your handle and theme were not remembered.',
    }
  }
}

export { PREF_KEYS }
