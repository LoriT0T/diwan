/* Dīwān — the writers.
 *
 * Until now this hub only read. Ticking things off from here means writing into apps
 * that are not this one, which is the most dangerous thing the codebase does, so the
 * rules are tighter rather than looser:
 *
 *   1. WRITE THROUGH THE APP'S OWN CODE wherever it exists. Compound's `toggleH`,
 *      Anbīq's `markSeen` equivalent — those functions already know the shape, the
 *      migration and the invariants. A hand-rolled write that happens to produce the
 *      right JSON today will not survive the app changing its schema tomorrow.
 *
 *   2. RE-READ IMMEDIATELY BEFORE WRITING. Anbīq and Jamāl both hold their state in a
 *      module-level singleton loaded once. If their app is open in another tab and has
 *      written since, a save from a stale copy silently destroys that work. Every write
 *      below re-syncs from localStorage first, so the worst case is a lost tick rather
 *      than a lost day.
 *
 *   3. EVERY WRITE IS REVERSIBLE. Each returns an `undo` that restores exactly the prior
 *      value. A tick made by voice on the wrong item has to be one tap to take back.
 *
 * Still true: the hub never writes anything it was not explicitly asked to write, and it
 * never writes on load. Opening this page changes nothing anywhere.
 *
 * The one hazard that cannot be engineered away: if an app is open in another tab, that
 * tab's in-memory copy does not know about a change made here and may overwrite it on its
 * next save. Reload the app after ticking from the hub. The UI says so where it matters.
 */

const RAW = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

/* ── Compound ──────────────────────────────────────────────────────
   Its store reads fresh from localStorage on every call, so there is no
   singleton to go stale and its own toggle is used directly. */
async function compoundToggle({ date, id }) {
  const S = await import('../../compound/js/store.js');
  const before = S.getHEntry(date, id);
  const ok = S.toggleH(date, id);
  if (!ok) return { ok: false, error: 'Compound would not save — storage is full or blocked.' };
  return {
    ok: true,
    done: !!(S.getHEntry(date, id) || {}).done,
    undo: () => S.setHEntry(date, id, before)
  };
}

/* ── Jamāl ─────────────────────────────────────────────────────────
   Written raw, deliberately. jamal/js/store.js stamps `set.start` at module
   load, so importing it would write to Jamāl merely because this page opened.
   This mirrors its `complete()` / `uncomplete()` exactly. */
function jamalToggle({ date, id }) {
  const st = RAW('jamal.v1');
  if (!st) return { ok: false, error: 'Jamāl has no data on this device yet. Open it once first.' };
  st.done ||= {}; st.last ||= {};
  const was = !!(st.done[date] && st.done[date][id]);
  const beforeLast = st.last[id];

  if (was) {
    delete st.done[date][id];
    /* its uncomplete() recomputes `last` from the remaining days */
    const days = Object.keys(st.done).filter(k => st.done[k] && st.done[k][id]).sort();
    if (days.length) st.last[id] = days[days.length - 1]; else delete st.last[id];
  } else {
    (st.done[date] ||= {})[id] = Date.now();
    if (!st.last[id] || st.last[id] < date) st.last[id] = date;
  }

  try { localStorage.setItem('jamal.v1', JSON.stringify(st)); }
  catch { return { ok: false, error: 'Could not save to Jamāl — storage is full or blocked.' }; }

  return {
    ok: true, done: !was,
    undo: () => {
      const s = RAW('jamal.v1'); if (!s) return;
      s.done ||= {}; s.last ||= {};
      if (was) { (s.done[date] ||= {})[id] = Date.now(); } else { if (s.done[date]) delete s.done[date][id]; }
      if (beforeLast === undefined) delete s.last[id]; else s.last[id] = beforeLast;
      localStorage.setItem('jamal.v1', JSON.stringify(s));
    }
  };
}

/* Jamāl's inside metrics — the boolean ones only. A count wants a real number
   and guessing one would put a fiction in the log, so those link out instead. */
function jamalInside({ date, id, value }) {
  const st = RAW('jamal.v1');
  if (!st) return { ok: false, error: 'Jamāl has no data on this device yet. Open it once first.' };
  st.inside ||= {};
  const day = (st.inside[date] ||= {});
  const before = day[id];
  if (value === null || value === undefined) delete day[id]; else day[id] = value;
  try { localStorage.setItem('jamal.v1', JSON.stringify(st)); }
  catch { return { ok: false, error: 'Could not save to Jamāl.' }; }
  return {
    ok: true, done: value != null,
    undo: () => {
      const s = RAW('jamal.v1'); if (!s) return;
      s.inside ||= {}; const d = (s.inside[date] ||= {});
      if (before === undefined) delete d[id]; else d[id] = before;
      localStorage.setItem('jamal.v1', JSON.stringify(s));
    }
  };
}

/* Cabinet: replacing a consumable resets its clock and its use count, exactly as
   Jamāl's own cabDone does. */
function jamalCab({ id }) {
  const st = RAW('jamal.v1');
  if (!st) return { ok: false, error: 'Jamāl has no data on this device yet. Open it once first.' };
  st.cab ||= {};
  const before = st.cab[id] ? { ...st.cab[id] } : undefined;
  const today = new Date();
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  st.cab[id] = { ...(st.cab[id] || {}), last: iso, uses: 0 };
  try { localStorage.setItem('jamal.v1', JSON.stringify(st)); }
  catch { return { ok: false, error: 'Could not save to Jamāl.' }; }
  return {
    ok: true, done: true,
    undo: () => {
      const s2 = RAW('jamal.v1'); if (!s2) return;
      s2.cab ||= {};
      if (before === undefined) delete s2.cab[id]; else s2.cab[id] = before;
      localStorage.setItem('jamal.v1', JSON.stringify(s2));
    }
  };
}

/* ── Anbīq ─────────────────────────────────────────────────────────
   Its store is a singleton loaded at import. `replace()` re-syncs it from what
   is actually on disk, which is what stops a stale hub tab from clobbering work
   done in the app. Cheap, and it is the app's own supported entry point. */
async function anbiqDispatchSeen({ id }) {
  const A = await import('../../anbiq/js/store.js');
  const disk = RAW('anbiq.v1');
  if (disk) A.replace(disk);
  const st = A.state();
  st.dispatchSeen ||= {};
  const before = st.dispatchSeen[id];
  st.dispatchSeen[id] = true;
  A.save();
  return {
    ok: true, done: true,
    undo: () => {
      const d = RAW('anbiq.v1'); if (d) A.replace(d);
      const s = A.state(); s.dispatchSeen ||= {};
      if (before === undefined) delete s.dispatchSeen[id]; else s.dispatchSeen[id] = before;
      A.save();
    }
  };
}

/* ── Sakina ────────────────────────────────────────────────────────
   IndexedDB, and the same defensive open as the reader: list first, never
   create, open at the version already on disk. A hub that conjured an empty
   `sakina` database would make Sakina's own upgrade skip its track stores. */
async function sakinaDb() {
  if (!indexedDB.databases) throw new Error('This browser cannot list databases, so Sakina cannot be written safely from here.');
  const row = (await indexedDB.databases()).find(d => d.name === 'sakina');
  if (!row) throw new Error('No Sakina database on this device. Open Sakina once first.');
  return new Promise((res, rej) => {
    const r = indexedDB.open('sakina', row.version);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new Error('The Sakina database would not open.'));
    r.onblocked = () => rej(new Error('Sakina is open in another tab and holding the database.'));
    r.onupgradeneeded = () => { /* unreachable: opened at the version on disk */ };
  });
}
const idbGet = (db, store, key) => new Promise(res => {
  try {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => res(undefined);
  } catch { res(undefined); }
});
const idbPut = (db, store, val) => new Promise((res, rej) => {
  try {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
  } catch (e) { rej(e); }
});

const EMPTY_DAY = { fajr: 'none', dhuhr: 'none', asr: 'none', maghrib: 'none', isha: 'none' };

/* Sakina's own shape: five states per prayer, not a checkbox, because a binary
   flattens on-time and late into one mark. Ticking here sets `prayed`; the
   jamāʿah button sets `jamaah`. Nothing here ever writes `missed` — the app
   refuses to turn a gap into a failure and so does this.

   Undo restores the prior *value*, not the prior absence of a row. Ticking the
   first prayer of a day creates that day's row, and undo leaves it behind with
   every state back at `none`. That is deliberate: Sakina's own `setPrayerState`
   creates the row the same way and never deletes one, and a row of all-`none`
   reads identically to no row everywhere it is consumed — `getPrayerDay` returns
   an empty day for a missing key, and both the grid and `advice.ts` count a day
   as logged only when some prayer is not `none`. */
async function sakinaPrayer({ date, prayer, state }) {
  const db = await sakinaDb();
  try {
    const row = (await idbGet(db, 'prayers', date)) || { date, prayers: { ...EMPTY_DAY }, updatedAt: 0 };
    const before = row.prayers[prayer];
    const next = { ...row, prayers: { ...row.prayers, [prayer]: state }, updatedAt: Date.now() };
    await idbPut(db, 'prayers', next);
    return {
      ok: true, done: state !== 'none',
      undo: async () => {
        const d = await sakinaDb();
        try {
          const cur = (await idbGet(d, 'prayers', date)) || { date, prayers: { ...EMPTY_DAY }, updatedAt: 0 };
          await idbPut(d, 'prayers', { ...cur, prayers: { ...cur.prayers, [prayer]: before }, updatedAt: Date.now() });
        } finally { d.close(); }
      }
    };
  } finally { db.close(); }
}

/* ── Charisma Gym ──────────────────────────────────────────────────
   Written raw, but not by choice: its store.js is a classic script that hangs
   `Store` off `window` and exports nothing, so there is no module to import.
   This mirrors its `addRep()` exactly, including the local day key it settled on
   and the 4,000-event cap its own writer enforces. */
const GC_KEYS = ['charismagym.v1', 'goodcompany.v2', 'goodcompany.v1'];
const GC_MAX = 4000;
function gcKeyInUse() {
  for (const k of GC_KEYS) if (localStorage.getItem(k)) return k;
  return GC_KEYS[0];
}
const localDay = ts => {
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};

function gcRep() {
  const key = gcKeyInUse();
  const st = RAW(key);
  if (!st || !Array.isArray(st.events)) {
    return { ok: false, error: 'Charisma Gym has no data on this device yet. Open it once first.' };
  }
  const ev = { type: 'rep', payload: { source: 'diwan' }, day: localDay(Date.now()), at: Date.now() };
  st.events.push(ev);
  if (st.events.length > GC_MAX) st.events = st.events.slice(-GC_MAX);
  try { localStorage.setItem(key, JSON.stringify(st)); }
  catch { return { ok: false, error: 'Could not save to Charisma Gym — storage is full or blocked.' }; }
  return {
    ok: true, done: true,
    undo: () => {
      const s = RAW(key); if (!s || !Array.isArray(s.events)) return;
      const i = s.events.findIndex(e => e.at === ev.at && e.type === 'rep' && e.payload?.source === 'diwan');
      if (i >= 0) s.events.splice(i, 1);
      localStorage.setItem(key, JSON.stringify(s));
    }
  };
}

/* ── Āfāq ──────────────────────────────────────────────────────────
   Its store is a proper module with its own `toggleItem`, and `replace()`
   re-syncs the singleton from disk first for the same reason Anbīq does. */
async function afaqItem({ tripId, date, itemId }) {
  const F = await import('../../afaq/js/store.js');
  const disk = RAW('afaq.v1');
  if (disk) F.replace(disk);
  const t = F.trip(tripId);
  const item = t && (t.days || []).find(d => d.date === date)?.items.find(i => i.id === itemId);
  if (!item) return { ok: false, error: 'That itinerary item is no longer there.' };
  const before = !!item.done;
  F.toggleItem(tripId, date, itemId);
  return {
    ok: true, done: !before,
    undo: () => {
      const d = RAW('afaq.v1'); if (d) F.replace(d);
      const cur = F.trip(tripId);
      const it = cur && (cur.days || []).find(x => x.date === date)?.items.find(y => y.id === itemId);
      if (it && !!it.done !== before) F.toggleItem(tripId, date, itemId);
    }
  };
}

/* ── dispatch table ───────────────────────────────────────────────── */
const HANDLERS = {
  'compound.h':    compoundToggle,
  'jamal.ritual':  jamalToggle,
  'jamal.inside':  jamalInside,
  'jamal.cab':     jamalCab,
  'anbiq.seen':    anbiqDispatchSeen,
  'sakina.prayer': sakinaPrayer,
  'gc.rep':        gcRep,
  'afaq.item':     afaqItem
};

/**
 * Perform one tick. Returns { ok, done, undo } or { ok:false, error }.
 * Never throws — a failed write reports itself so the row can show it rather
 * than the page dying mid-list.
 */
export async function perform(action) {
  const fn = HANDLERS[action && action.kind];
  if (!fn) return { ok: false, error: 'Nothing here can write that one — open the app for it.' };
  try {
    const r = await fn(action);
    return r || { ok: false, error: 'The write returned nothing.' };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

export const canWrite = action => !!(action && HANDLERS[action.kind]);
