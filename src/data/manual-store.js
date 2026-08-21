/**
 * Remembering a club's own details between visits.
 *
 * The manual path is for a club doing this every Saturday. Retyping the squad,
 * the crest and the ground each week would make the tool not worth opening, so
 * the form is kept in localStorage. Nothing leaves the browser.
 */

const STORAGE_KEY = 'tryline-studio:manual:v1'

/** Fields worth remembering. Scores and scorers change every week; these do not. */
const PERSISTED_FIELDS = Object.freeze([
  'm-competition', 'm-round', 'm-home', 'm-away', 'm-venue',
  'm-home-squad', 'm-away-squad', 'm-table',
])

/** Crests are stored separately, keyed by side. */
const CREST_FIELDS = Object.freeze(['homeCrest', 'awayCrest'])

/**
 * localStorage throws in private-browsing modes and when the quota is full.
 * Saving a form is never worth breaking the app over, so every access is
 * guarded and failure is silent but reported to the caller.
 */
function safeRead() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function loadManualState() {
  const stored = safeRead()
  if (!stored || typeof stored !== 'object') return null
  return {
    fields: stored.fields && typeof stored.fields === 'object' ? stored.fields : {},
    crests: stored.crests && typeof stored.crests === 'object' ? stored.crests : {},
  }
}

/**
 * Persist the named fields and crests.
 * Returns { ok, reason } rather than throwing - a full quota (a large crest on
 * a nearly-full origin) should tell the user, not break the render.
 */
export function saveManualState({ fields = {}, crests = {} } = {}) {
  const payload = {
    fields: Object.fromEntries(
      PERSISTED_FIELDS.filter((key) => fields[key]).map((key) => [key, fields[key]]),
    ),
    crests: Object.fromEntries(
      CREST_FIELDS.filter((key) => crests[key]).map((key) => [key, crests[key]]),
    ),
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return { ok: true }
  } catch (error) {
    // Both are examined: a browser that sets a generic name would otherwise
    // have its quota message misreported.
    const isQuota = /quota|exceeded/i.test(`${error?.name ?? ''} ${error?.message ?? ''}`)
    return {
      ok: false,
      reason: isQuota
        ? 'Your browser storage is full, so those details will not be remembered.'
        : 'This browser will not let the tool remember those details.',
    }
  }
}

export function clearManualState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export { PERSISTED_FIELDS, CREST_FIELDS }
