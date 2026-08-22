/* Dīwān — the live session.
 *
 * A workout is the one thing in this ecosystem that happens minute by minute with your
 * hands full, and it is the one thing a notification cannot carry: iOS has no action
 * buttons and no text entry on the lock screen. So the split is deliberate — the panel
 * holds everything interactive, and the notification is only ever the way back to it.
 *
 * THE REST TIMER IS WALL-CLOCK, and that is a fix rather than a preference. Compound's
 * own timer runs on requestAnimationFrame, which the browser pauses in a backgrounded
 * tab: put the phone in your pocket between sets and the countdown freezes, then resumes
 * from where it stopped instead of from where the clock actually is. Everything here
 * derives from a stored end time, so three minutes in a pocket is three minutes.
 *
 * Every set written goes through Compound's own session store. The hub never keeps a
 * second copy of a workout — one source of truth, the same rule as every other tick.
 */

const KEY = 'diwan.session';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const write = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* full */ } };

const iso = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

let mods = null;
async function load() {
  if (mods) return mods;
  const [S, D] = await Promise.all([
    import('../../compound/js/store.js'),
    import('../../compound/js/data.js')
  ]);
  mods = { S, D };
  return mods;
}

/** The day Compound has scheduled for a given weekday, or null on a rest day. */
export async function scheduledToday() {
  const { D } = await load();
  return (D.SCHEDULE.find(x => x.day === new Date().getDay()) || {}).workout || null;
}

/** The built plan for a day id, at the current cycle. */
export async function planFor(dayId) {
  const { S, D } = await load();
  return D.buildSplit(S.getSplit().cycle).find(d => d.id === dayId) || null;
}

export const live = () => read();
export const isLive = () => !!read();

/* ── starting and stopping ──────────────────────────────────────── */

export async function start(dayId) {
  const { S } = await load();
  const plan = await planFor(dayId);
  if (!plan) return { ok: false, error: 'No plan for that day.' };
  const date = iso();
  /* Compound's own ensureSession creates the row and keeps its shape in step with the
     plan if the plan changed under an in-progress session. Its job, not ours. */
  const sess = S.ensureSession(dayId, plan, date);
  if (!sess.startedAt) { sess.startedAt = Date.now(); S.saveSession(S.sessionKey(dayId, date), sess); }
  write({ dayId, date, at: Date.now(), ex: 0, set: 0, restEndsAt: 0, restTotal: 0, restLabel: '' });
  return { ok: true };
}

export async function finish() {
  const l = read(); if (!l) return;
  const { S } = await load();
  const key = S.sessionKey(l.dayId, l.date);
  const sess = S.getSession(key);
  if (sess) { sess.finishedAt = Date.now(); S.saveSession(key, sess); }
  write(null);
}

/** Leave the session running but stop showing it. */
export function dismiss() { const l = read(); if (l) write({ ...l, hidden: true }); }
export function resume() { const l = read(); if (l) write({ ...l, hidden: false }); }

/* ── where you are ──────────────────────────────────────────────── */

export function focus(ex, set) {
  const l = read(); if (!l) return;
  write({ ...l, ex, set: set == null ? l.set : set });
}

/**
 * Everything the panel needs, in one read. Combines the plan, the stored session and
 * the live cursor so the UI never has to reconcile three sources itself.
 */
export async function view() {
  const l = read(); if (!l) return null;
  const { S, D } = await load();
  const plan = await planFor(l.dayId);
  if (!plan) return null;
  const key = S.sessionKey(l.dayId, l.date);
  const sess = S.getSession(key) || { sets: {} };

  const exercises = plan.exercises.map((e, i) => {
    const rows = sess.sets[e.ex] || [];
    /* Logged sets can exceed the plan — Compound allows adding one. Count the larger. */
    const n = Math.max(e.sets.length, rows.length);
    const sets = [];
    for (let k = 0; k < n; k++) {
      sets.push({
        i: k,
        target: (e.sets[k] || {}).target || '',
        rir: (e.sets[k] || {}).rir,
        ...(rows[k] || { w: null, reps: null, rir: null, done: false })
      });
    }
    return {
      i, id: e.ex, name: (D.LIB[e.ex] || {}).name || e.ex,
      cue: (D.LIB[e.ex] || {}).cue || '',
      rest: e.rest, perSide: e.perSide,
      supersetInto: e.supersetInto ? ((D.LIB[e.supersetInto] || {}).name || e.supersetInto) : null,
      sets, done: sets.every(s => s.done), lastTime: S.lastPerformance(e.ex, key)
    };
  });

  const total = exercises.reduce((n, e) => n + e.sets.length, 0);
  const doneN = exercises.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0);
  const volume = exercises.reduce((n, e) =>
    n + e.sets.filter(s => s.done && s.w != null && s.reps != null)
      .reduce((m, s) => m + s.w * s.reps, 0), 0);

  const ex = Math.min(l.ex || 0, exercises.length - 1);
  return {
    dayId: l.dayId, name: plan.name, focus: plan.focus, date: l.date,
    exercises, ex, set: l.set || 0,
    total, doneN, volume,
    elapsed: l.at ? Date.now() - l.at : 0,
    rest: restState(l),
    hidden: !!l.hidden,
    unit: S.getPrefs().unit
  };
}

/* ── the rest timer ─────────────────────────────────────────────── */

function restState(l) {
  if (!l || !l.restEndsAt) return null;
  const left = Math.round((l.restEndsAt - Date.now()) / 1000);
  return { left, total: l.restTotal || 0, label: l.restLabel || '', over: left <= 0 };
}
export const rest = () => restState(read());

export function startRest(seconds, label) {
  const l = read(); if (!l || !seconds) return;
  write({ ...l, restEndsAt: Date.now() + seconds * 1000, restTotal: seconds, restLabel: label || '' });
}
export function addRest(seconds) {
  const l = read(); if (!l || !l.restEndsAt) return;
  write({ ...l, restEndsAt: l.restEndsAt + seconds * 1000, restTotal: (l.restTotal || 0) + seconds });
}
export function stopRest() {
  const l = read(); if (!l) return;
  write({ ...l, restEndsAt: 0, restTotal: 0, restLabel: '' });
}

/* ── writing a set ──────────────────────────────────────────────── */

/** Store weight / reps / RIR for one set without marking it done. */
export async function setFields(exId, idx, patch) {
  const l = read(); if (!l) return { ok: false };
  const { S } = await load();
  const key = S.sessionKey(l.dayId, l.date);
  const sess = S.getSession(key); if (!sess) return { ok: false };
  const rows = (sess.sets[exId] ||= []);
  while (rows.length <= idx) rows.push({ w: null, reps: null, rir: null, done: false });
  rows[idx] = { ...rows[idx], ...patch };
  S.saveSession(key, sess);
  return { ok: true };
}

/**
 * Mark a set done (or undone) and move on the way Compound does: an A-half goes straight
 * into its superset partner with no rest, a B-half rests then returns to the partner for
 * the next round, and an ordinary lift rests and advances when its sets are finished.
 */
export async function toggleSet(exId, idx) {
  const l = read(); if (!l) return { ok: false };
  const { S, D } = await load();
  const plan = await planFor(l.dayId);
  const key = S.sessionKey(l.dayId, l.date);
  const sess = S.getSession(key); if (!sess) return { ok: false };

  const rows = (sess.sets[exId] ||= []);
  while (rows.length <= idx) rows.push({ w: null, reps: null, rir: null, done: false });
  const now = !rows[idx].done;
  rows[idx] = { ...rows[idx], done: now };
  S.saveSession(key, sess);

  if (!now) return { ok: true, done: false };

  /* ---- advance ---- */
  const i = plan.exercises.findIndex(e => e.ex === exId);
  const e = plan.exercises[i];
  const nm = id => (D.LIB[id] || {}).name || id;
  const count = id => {
    const planned = plan.exercises.find(x => x.ex === id)?.sets.length || 0;
    return Math.max(planned, (sess.sets[id] || []).length);
  };
  let restFor = 0, label = '', nextEx = i, nextSet = idx;

  if (e.supersetInto && plan.exercises[i + 1]) {
    label = `Straight into ${nm(e.supersetInto)}`;
    nextEx = i + 1; nextSet = idx;                       // same set number, no rest
  } else if (i > 0 && plan.exercises[i - 1].supersetInto === exId) {
    const partner = plan.exercises[i - 1];
    const more = idx + 1 < count(partner.ex);
    restFor = e.rest;
    label = more ? `Back to ${nm(partner.ex)} · set ${idx + 2}`
                 : (plan.exercises[i + 1] ? 'Next: ' + nm(plan.exercises[i + 1].ex) : 'Last set — you are done');
    nextEx = more ? i - 1 : i + 1; nextSet = more ? idx + 1 : 0;
  } else {
    const more = idx + 1 < count(exId);
    restFor = e.rest;
    if (more) { label = `${nm(exId)} · set ${idx + 2}`; nextEx = i; nextSet = idx + 1; }
    else {
      const nx = plan.exercises[i + 1];
      label = nx ? 'Next: ' + nm(nx.ex) : 'Last set — you are done';
      nextEx = nx ? i + 1 : i; nextSet = 0;
    }
  }

  const cur = read() || {};
  write({
    ...cur, ex: Math.min(nextEx, plan.exercises.length - 1), set: nextSet,
    ...(restFor ? { restEndsAt: Date.now() + restFor * 1000, restTotal: restFor, restLabel: label }
                : { restEndsAt: 0, restTotal: 0, restLabel: '' })
  });

  return { ok: true, done: true, rest: restFor, label };
}

/** Compound allows a set beyond the plan; so does this. */
export async function addSet(exId) {
  const l = read(); if (!l) return;
  const { S } = await load();
  const key = S.sessionKey(l.dayId, l.date);
  const sess = S.getSession(key); if (!sess) return;
  (sess.sets[exId] ||= []).push({ w: null, reps: null, rir: null, done: false });
  S.saveSession(key, sess);
}
