/* Dīwān — its own small store.
 *
 * The hub owns almost nothing. Four of the five apps hold their own data and this page
 * reads it in place; duplicating any of it here would create a second version of the
 * truth, which is the failure mode the whole ecosystem is built to avoid.
 *
 * So this file holds exactly two things:
 *   · the Good Company snapshot, because that app is on another origin and cannot be read
 *   · a note of when a full backup was last taken
 *
 * Namespaced `diwan.v1` so it can never collide with a sibling on the shared origin.
 */

const KEY = 'diwan.v1';

const BLANK = {
  v: 1,
  gc: null,          // { data, importedAt }  — pasted Good Company export
  lastBackup: null   // ISO date of the last unified export
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Object.assign(structuredClone(BLANK), JSON.parse(raw)) : structuredClone(BLANK);
  } catch { return structuredClone(BLANK); }
}

let S = load();

/** Returns false if the write did not land, so a caller can say so instead of
    pretending it saved. Borrowed from Compound, which learned it the hard way. */
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
  catch (e) { console.warn('diwan: write failed', e); return false; }
}

export const state = () => S;
export const gc = () => S.gc;
export const lastBackup = () => S.lastBackup;

/** Accepts a Good Company export. Validated before it is stored, because a silent
    half-import would show wrong numbers rather than no numbers. */
export function importGC(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('That is not JSON. Copy the whole file, including the outer braces.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('That JSON is not an object.');
  if (!Array.isArray(parsed.events)) {
    throw new Error('No event log in there. This should be the file from Good Company → Export, which always has an "events" array.');
  }
  S.gc = { data: parsed, importedAt: Date.now() };
  if (!save()) throw new Error('Could not save — this browser’s storage is full or blocked.');
  return {
    events: parsed.events.length,
    field: (parsed.field || []).length,
    calls: (parsed.calls || []).length
  };
}

export function forgetGC() { S.gc = null; save(); }

export function markBackup(dateISO) { S.lastBackup = dateISO; save(); }
