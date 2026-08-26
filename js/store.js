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
  lastBackup: null,  // ISO date of the last unified export
  sirah: {},         // { 'YYYY-MM-DD' (a Friday): { paras, stats, at } } — frozen weekly chronicles
  /* The people who must never drift. Ṣilat ar-raḥim is a duty before it is a
     feature, and none of the six apps owns the humans in his life — so the
     register does. { id, name, every (days), last (ISO), log: [ISO…] } */
  rahim: [],
  /* Things that belong to one day and to no app — "ring the dentist", "pack the
     charger". They live here rather than being pushed into a sibling, because none of
     the six owns them and inventing a home would distort whichever got them. */
  todos: [],         // { id, date, text, done, at? }
  /* Meditation and affirmations leave no trace in Sakina — it records that a track was
     *made*, never that it was played. So this is new information rather than a second
     copy of something, which is the only reason it is allowed to live here. Journalling
     is not in this list: it does leave a trace, and is read from Sakina directly. */
  practice: {},      // 'YYYY-MM-DD' -> { meditation: ts, affirmations: ts }
  /* The watch's mornings, one row per day. The shell delivers today's summary
     every time the app wakes; keeping the days is what turns a glanceable
     card into data that can be WORKED WITH — trends in the pulse, resting HR
     against training weeks, sleep against everything. Ninety days: enough for
     a season's pattern, short enough not to become an archive. */
  health: {},        // 'YYYY-MM-DD' -> { wake, sleepH, rhr, hrv, steps, aerobicMin }
  skips: {}          // 'YYYY-MM-DD' -> { taskKey: ts } — set aside today, on purpose
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

/* ---------- the ties ---------- */
export const rahim = () => S.rahim || [];
export function addRahim(name, every) {
  S.rahim ||= [];
  const p = { id: Math.random().toString(36).slice(2, 9), name: String(name).trim(),
              every: Math.max(1, Number(every) || 7), last: null, log: [] };
  S.rahim.push(p); save(); return p;
}
export function markRahim(id, dateISO) {
  const p = (S.rahim || []).find(x => x.id === id); if (!p) return null;
  const prev = p.last;
  p.last = dateISO; p.log ||= [];
  if (!p.log.includes(dateISO)) p.log.push(dateISO);
  p.log = p.log.slice(-30);
  save(); return { prev };
}
export function unmarkRahim(id, dateISO, prev) {
  const p = (S.rahim || []).find(x => x.id === id); if (!p) return;
  p.last = prev ?? null; p.log = (p.log || []).filter(d => d !== dateISO); save();
}
export function killRahim(id) { S.rahim = (S.rahim || []).filter(x => x.id !== id); save(); }

/* ---------- sīrah: frozen weekly pages ---------- */
export const sirahAll = () => S.sirah || {};
export function putSirah(week, page) { S.sirah ||= {}; S.sirah[week] = page; save(); }

/* ---------- the day's own list ---------- */
export const todos = (date) => (S.todos || []).filter(t => !date || t.date === date);

export function addTodo(text, date, at) {
  const t = { id: Math.random().toString(36).slice(2, 9), date, text: String(text).trim(), done: false };
  if (at) t.at = at;
  (S.todos ||= []).push(t);
  /* Keep a month. A to-do list that never forgets becomes a graveyard, which is the
     failure this whole ecosystem is built against. */
  const cutoff = new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10);
  S.todos = S.todos.filter(x => x.date >= cutoff);
  save();
  return t;
}
export function toggleTodo(id) {
  const t = (S.todos || []).find(x => x.id === id);
  if (t) { t.done = !t.done; save(); }
  return t;
}
/* ---------- morning and evening practice ---------- */
export const practiceOn = date => (S.practice || {})[date] || {};
export function togglePractice(date, which) {
  S.practice ||= {};
  const day = (S.practice[date] ||= {});
  if (day[which]) delete day[which]; else day[which] = Date.now();
  if (!Object.keys(day).length) delete S.practice[date];
  /* Two months is plenty to see a pattern and short enough not to become an archive. */
  const cutoff = new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(S.practice)) if (d < cutoff) delete S.practice[d];
  save();
  return !!(S.practice[date] || {})[which];
}

/* Re-seed from what is on disk. Sync writes `diwan.v1` directly, and this module holds
   `S` in memory from import — without this the next save would put the pre-merge copy
   straight back over the merged one. The same hazard, and the same fix, as Anbīq and
   Āfāq; the hub is not exempt from its own rule. */
export function replace(next) {
  S = Object.assign(structuredClone(BLANK), next || {});
}

/* ---------- deliberately set aside ----------
   A skip is neither a tick nor a forgetting: "not today, on purpose". Kept
   per day so tomorrow the task stands again at full strength — a skip never
   compounds into an exemption, which is the difference between this and the
   bail-out button it replaces. */
export const skippedOn = date => (S.skips || {})[date] || {};
export function toggleSkip(date, key) {
  S.skips ||= {};
  const day = (S.skips[date] ||= {});
  if (day[key]) delete day[key]; else day[key] = Date.now();
  if (!Object.keys(day).length) delete S.skips[date];
  const cutoff = new Date(Date.now() - 62 * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(S.skips)) if (d < cutoff) delete S.skips[d];
  save();
  return !!(S.skips[date] || {})[key];
}

/* ---------- the watch's days ---------- */
export const healthDays = () => S.health || {};
export function recordHealth(date, o) {
  S.health ||= {};
  /* Merge rather than replace: the morning delivery has sleep, the evening
     one has the day's steps — both are true and neither should erase the
     other. Only present, non-null fields land. */
  const day = (S.health[date] ||= {});
  for (const k of ['wake', 'sleepH', 'rhr', 'hrv', 'steps', 'aerobicMin']) {
    if (o[k] != null) day[k] = o[k];
  }
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  for (const d of Object.keys(S.health)) if (d < cutoff) delete S.health[d];
  save();
}

export function dropTodo(id) {
  S.todos = (S.todos || []).filter(x => x.id !== id);
  save();
}
