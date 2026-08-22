/* Dīwān — the merge.
 *
 * The apps write to localStorage with no notion of a clock, a device or a conflict.
 * This file gives them all three without touching a line of them, using one trick:
 *
 *   A SHADOW INDEX. After every sync, Dīwān remembers a hash of every record it saw.
 *   Next time, any record whose hash differs is one that changed on this device since
 *   then — no timestamps in the apps required, and nothing for them to maintain.
 *
 * From there the merge is per record, not per app:
 *
 *   changed here only        → push it
 *   changed there only       → take it
 *   changed both sides       → see CONFLICTS below
 *   gone here, present there → tombstone, push the delete
 *   gone there (null value)  → delete here
 *
 * CONFLICTS. Two devices editing the *same record* between syncs is the only case with
 * no correct answer, so the rule is stated rather than hidden:
 *
 *   · On a device's FIRST sync, the cloud wins. Signing in somewhere new almost always
 *     means joining an account that already has your history, not carrying the truth to
 *     it. Nothing is deleted either way — the two sides are unioned, and only genuine
 *     same-key disagreements go to the cloud.
 *   · After that, THIS DEVICE wins. You are here, you just did the thing, and quietly
 *     discarding it in favour of an older edit made elsewhere is the one outcome that
 *     would make the whole feature untrustworthy.
 *
 * In practice conflicts are rare, because the records are small enough that two devices
 * are almost never writing the same one — a workout logged on the phone and a prayer
 * marked on the laptop are different keys and both simply survive.
 */

import * as C from './cloud.js';
import { shredAll, applyOne, APP_IDS } from './shred.js';

const SHADOW = 'diwan.shadow';   // { "app/key": hash }
const STATE = 'diwan.sync';      // { cursor, lastAt, lastCount }

const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

/* FNV-1a over the canonical JSON. Enough to notice a change; not a security boundary. */
function hash(v) {
  const s = JSON.stringify(v ?? null);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export const state = () => read(STATE) || { cursor: null, lastAt: null, lastCount: 0 };
export const everSynced = () => !!read(SHADOW);

/** Forget the local sync bookkeeping. Does not touch app data or the cloud. */
export function forget() { localStorage.removeItem(SHADOW); localStorage.removeItem(STATE); }

/**
 * One full cycle. Returns a plain report — nothing here throws for an ordinary
 * failure, because a sync that fails should leave a sentence on screen and every
 * app exactly as it was.
 */
export async function sync({ onStep } = {}) {
  const step = onStep || (() => {});
  if (!C.signedIn()) return { ok: false, error: 'Not signed in.' };

  const first = !everSynced();
  const shadow = read(SHADOW) || {};
  const st = state();

  /* ---- 1. what is on this device now ---- */
  step('Reading this device…');
  const local = await shredAll();

  /* ---- 2. what changed here since last time ---- */
  const localHash = {};
  const changed = {};                       // "app/key" -> value
  for (const app of APP_IDS) {
    for (const [k, v] of Object.entries(local[app] || {})) {
      const id = `${app}/${k}`;
      const h = hash(v);
      localHash[id] = h;
      if (shadow[id] !== h) changed[id] = v;
    }
  }
  /* Present last time, gone now — a deletion made on this device. */
  const deleted = [];
  for (const id of Object.keys(shadow)) if (!(id in localHash)) deleted.push(id);

  /* ---- 3. what changed there since last time ---- */
  step('Fetching changes…');
  let remote;
  try { remote = await C.pull(st.cursor); }
  catch (e) { return { ok: false, error: e.message }; }

  let cursor = st.cursor;
  const incoming = {};                      // "app/key" -> value (null = tombstone)
  for (const row of remote) {
    incoming[`${row.app}/${row.key}`] = row.value;
    if (!cursor || row.updated_at > cursor) cursor = row.updated_at;
  }

  /* ---- 4. merge ---- */
  step('Merging…');
  const merged = {};                        // app -> { key: value }
  for (const app of APP_IDS) merged[app] = { ...(local[app] || {}) };

  let took = 0, kept = 0, removed = 0;
  for (const [id, val] of Object.entries(incoming)) {
    const slash = id.indexOf('/');
    const app = id.slice(0, slash), key = id.slice(slash + 1);
    if (!merged[app]) continue;             // a record from an app this build does not know

    const localChanged = id in changed;
    if (localChanged && !first) { kept++; continue; }      // this device wins after the first sync

    if (val === null) { delete merged[app][key]; removed++; }
    else { merged[app][key] = val; took++; }
    if (localChanged) { delete changed[id]; }              // first sync: cloud won, do not push it back
  }

  /* ---- 5. write the result back into the apps ---- */
  step('Writing…');
  const notes = [];
  for (const app of APP_IDS) {
    try {
      const r = await applyOne(app, merged[app]);
      if (r && r.skipped) notes.push(`${app}: ${r.skipped}`);
    } catch (e) { notes.push(`${app}: could not write — ${e.message}`); }
  }

  /* ---- 6. send ours ---- */
  const rows = [];
  for (const [id, v] of Object.entries(changed)) {
    const slash = id.indexOf('/');
    rows.push({ app: id.slice(0, slash), key: id.slice(slash + 1), value: v });
  }
  for (const id of deleted) {
    const slash = id.indexOf('/');
    rows.push({ app: id.slice(0, slash), key: id.slice(slash + 1), value: null });
  }
  if (rows.length) {
    step(`Sending ${rows.length}…`);
    try { await C.push(rows); }
    catch (e) { return { ok: false, error: e.message, pushed: 0, took }; }
  }

  /* ---- 7. remember where we got to ----
     The shadow is rebuilt from what is on the device *after* the merge, so anything
     just taken from the cloud counts as seen and is not pushed straight back. */
  const after = await shredAll();
  const nextShadow = {};
  for (const app of APP_IDS)
    for (const [k, v] of Object.entries(after[app] || {})) nextShadow[`${app}/${k}`] = hash(v);
  write(SHADOW, nextShadow);
  write(STATE, { cursor, lastAt: new Date().toISOString(), lastCount: Object.keys(nextShadow).length });

  return {
    ok: true, first, took, sent: rows.length, kept, removed,
    total: Object.keys(nextShadow).length, notes
  };
}

/** Records this device would send right now, without sending them. For the status line. */
export async function pending() {
  const shadow = read(SHADOW);
  if (!shadow) return null;                 // never synced: everything is pending
  const local = await shredAll();
  let n = 0;
  const seen = new Set();
  for (const app of APP_IDS)
    for (const [k, v] of Object.entries(local[app] || {})) {
      const id = `${app}/${k}`; seen.add(id);
      if (shadow[id] !== hash(v)) n++;
    }
  for (const id of Object.keys(shadow)) if (!seen.has(id)) n++;
  return n;
}
