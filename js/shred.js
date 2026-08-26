/* Dīwān — shredding, and putting back together.
 *
 * Syncing a whole app's storage as one blob is the obvious design and it destroys data:
 * log a workout on the phone and a prayer on the laptop, and whichever uploads second
 * overwrites the first entirely. So nothing here syncs a blob. Every app's storage is
 * decomposed into the smallest independently-meaningful records it has —
 *
 *     hlog/2026-08-22/wake        done/2026-08-22/shower        claims/k3f9a1
 *
 * — and each one travels on its own. Two devices editing different rows on the same day
 * both survive, because they are never writing the same record.
 *
 * The apps are untouched by any of this. They keep reading and writing localStorage
 * synchronously and never learn that a cloud exists; this file is the only thing that
 * knows how to take their storage apart and put it back.
 *
 * WHAT IS DELIBERATELY NOT SYNCED
 *   · Compound's exercise photos — data URLs, megabytes each, and they are illustrations
 *     rather than a record of anything you did.
 *   · Sakina's audio and its chunk cache — a handful of finished tracks is hundreds of
 *     megabytes. The track's metadata syncs, so the library lists it everywhere and the
 *     audio is re-made on the device that wants to hear it.
 *   · Anything derived. Jamāl's `last` is computed from `done`, so syncing it would let
 *     two sources of one truth disagree; it is recomputed after every merge instead.
 */

const raw = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

/* ---------- generic shapes ---------- */

/** { id: value } → { "p/id": value } */
const one = (obj, p, out) => { for (const [k, v] of Object.entries(obj || {})) out[`${p}/${k}`] = v; };
/** { a: { b: value } } → { "p/a/b": value } */
const two = (obj, p, out) => {
  for (const [a, inner] of Object.entries(obj || {}))
    for (const [b, v] of Object.entries(inner || {})) out[`${p}/${a}/${b}`] = v;
};
/** [{id,…}] → { "p/id": item } */
const list = (arr, p, out) => { for (const it of arr || []) if (it && it.id) out[`${p}/${it.id}`] = it; };

const unOne = (recs, p) => {
  const o = {};
  for (const [k, v] of Object.entries(recs)) {
    const m = k.startsWith(p + '/') && k.slice(p.length + 1);
    if (m && !m.includes('/')) o[m] = v;
  }
  return o;
};
const unTwo = (recs, p) => {
  const o = {};
  for (const [k, v] of Object.entries(recs)) {
    if (!k.startsWith(p + '/')) continue;
    const parts = k.slice(p.length + 1).split('/');
    if (parts.length !== 2) continue;
    (o[parts[0]] ||= {})[parts[1]] = v;
  }
  return o;
};
const unList = (recs, p) => Object.entries(recs)
  .filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'))
  .map(([, v]) => v).filter(Boolean);


/* Writing an empty record set would create an app's storage out of nothing — a skeleton
   of empty arrays for an app that has never run here. That is the same hazard the Sakina
   reader guards against, and it belongs on every apply: nothing to write means write
   nothing. Once there is a single record, creating the storage to hold it is correct. */
const empty = r => !r || Object.keys(r).length === 0;

/* Anbīq and Āfāq keep their state in a module-level singleton loaded once at import.
   Writing their localStorage key behind their back leaves that singleton stale, and the
   next save from it writes the OLD state straight back over what was just merged — so a
   book added on the phone would vanish the next time anything touched Anbīq here. Both
   expose `replace()`, which re-seeds the singleton from a given object, so every write
   to those two is followed by re-seeding them from what is now on disk. */
async function rehydrate(mod, key) {
  try {
    const m = await import(mod);
    if (typeof m.replace === 'function') m.replace(raw(key) || {});
  } catch { /* the app is not reachable; its storage is still correct */ }
}

/* ══════════════════════════════════════════════════════════════════
   COMPOUND — ten localStorage keys under pp:v1:*
   ══════════════════════════════════════════════════════════════════ */
const CK = {
  split: 'pp:v1:split', sessions: 'pp:v1:sessions', fuel: 'pp:v1:fuel',
  prefs: 'pp:v1:prefs', blocks: 'pp:v1:blocks', hlog: 'pp:v1:hlog',
  hoff: 'pp:v1:hoff', oura: 'pp:v1:oura', buy: 'pp:v1:buy'
  /* photos deliberately absent — see the header */
};

const compound = {
  shred() {
    const o = {};
    for (const w of ['split', 'prefs', 'hoff', 'blocks']) { const v = raw(CK[w]); if (v != null) o[w] = v; }
    one(raw(CK.sessions), 'sessions', o);
    one(raw(CK.fuel), 'fuel', o);
    one(raw(CK.oura), 'oura', o);
    one(raw(CK.buy), 'buy', o);
    two(raw(CK.hlog), 'hlog', o);
    return o;
  },
  apply(r) {
    if (empty(r)) return;
    for (const w of ['split', 'prefs', 'hoff', 'blocks']) if (w in r) put(CK[w], r[w]);
    put(CK.sessions, unOne(r, 'sessions'));
    put(CK.fuel, unOne(r, 'fuel'));
    put(CK.oura, unOne(r, 'oura'));
    put(CK.buy, unOne(r, 'buy'));
    put(CK.hlog, unTwo(r, 'hlog'));
  }
};

/* ══════════════════════════════════════════════════════════════════
   JAMĀL — one key. `last` is derived and rebuilt rather than synced.
   ══════════════════════════════════════════════════════════════════ */
const jamal = {
  shred() {
    const s = raw('jamal.v1'); if (!s) return {};
    const o = {};
    if (s.set) o.set = s.set;
    if (s.worn) o.worn = s.worn;
    two(s.done, 'done', o);
    two(s.inside, 'inside', o);
    two(s.sev, 'sev', o);
    one(s.cab, 'cab', o);
    one(s.marks, 'marks', o);
    return o;
  },
  apply(r) {
    if (empty(r)) return;
    const s = raw('jamal.v1') || { v: 1 };
    if ('set' in r) s.set = r.set;
    if ('worn' in r) s.worn = r.worn;
    s.done = unTwo(r, 'done');
    s.inside = unTwo(r, 'inside');
    s.sev = unTwo(r, 'sev');
    s.cab = unOne(r, 'cab');
    s.marks = unOne(r, 'marks');
    /* Derived: the most recent day each ritual was completed. Recomputed from the
       merged `done` so it can never disagree with it. */
    s.last = {};
    for (const [d, day] of Object.entries(s.done))
      for (const id of Object.keys(day || {})) if (!s.last[id] || s.last[id] < d) s.last[id] = d;
    s.v = 1;
    put('jamal.v1', s);
  }
};

/* ══════════════════════════════════════════════════════════════════
   ANBĪQ
   ══════════════════════════════════════════════════════════════════ */
const anbiq = {
  shred() {
    const s = raw('anbiq.v1'); if (!s) return {};
    const o = {};
    if (s.set) o.set = s.set;
    if (s.reviews) o.reviews = s.reviews;
    one(s.dispatchSeen, 'seen', o);
    for (const [p, arr] of [['books', s.books], ['sessions', s.sessions], ['claims', s.claims],
                            ['preds', s.preds], ['progs', s.progs], ['crucibles', s.crucibles]])
      list(arr, p, o);
    return o;
  },
  apply(r) {
    if (empty(r)) return;
    const s = raw('anbiq.v1') || { v: 1 };
    if ('set' in r) s.set = r.set;
    if ('reviews' in r) s.reviews = r.reviews;
    s.dispatchSeen = unOne(r, 'seen');
    s.books = unList(r, 'books'); s.sessions = unList(r, 'sessions');
    s.claims = unList(r, 'claims'); s.preds = unList(r, 'preds');
    s.progs = unList(r, 'progs'); s.crucibles = unList(r, 'crucibles');
    s.v = 1;
    put('anbiq.v1', s);
    return rehydrate('../../anbiq/js/store.js', 'anbiq.v1');
  }
};

/* ══════════════════════════════════════════════════════════════════
   CHARISMA GYM — the append-only log, which is the easy case.
   Events are immutable, so a stable key derived from the event itself makes
   the union of two devices' logs exactly right with no conflict possible.
   ══════════════════════════════════════════════════════════════════ */
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const GC_KEYS = ['charismagym.v1', 'goodcompany.v2', 'goodcompany.v1'];
const gcKey = () => GC_KEYS.find(k => localStorage.getItem(k)) || GC_KEYS[0];

const gc = {
  shred() {
    const s = raw(gcKey()); if (!s) return {};
    const o = {};
    for (const w of ['vocab', 'identity', 'settings', 'playbook']) if (s[w] != null) o[w] = s[w];
    for (const e of s.events || []) o[`ev/${e.at}/${hash(e.type + JSON.stringify(e.payload || {}))}`] = e;
    for (const f of s.field || []) o[`field/${f.at}`] = f;
    for (const c of s.calls || []) o[`call/${c.at}`] = c;
    for (const v of s.reviews || []) o[`review/${v.at}`] = v;
    list(s.experiments, 'exp', o);
    return o;
  },
  apply(r) {
    if (empty(r)) return;
    const k = gcKey();
    const s = raw(k) || { version: 2 };
    for (const w of ['vocab', 'identity', 'settings', 'playbook']) if (w in r) s[w] = r[w];
    s.events = Object.entries(r).filter(([x]) => x.startsWith('ev/')).map(([, v]) => v)
      .filter(Boolean).sort((a, b) => a.at - b.at);
    const byAt = p => Object.entries(r).filter(([x]) => x.startsWith(p + '/')).map(([, v]) => v)
      .filter(Boolean).sort((a, b) => b.at - a.at);
    s.field = byAt('field'); s.calls = byAt('call'); s.reviews = byAt('review');
    s.experiments = unList(r, 'exp');
    s.version = 2;
    put(k, s);
  }
};

/* ══════════════════════════════════════════════════════════════════
   ĀFĀQ
   ══════════════════════════════════════════════════════════════════ */
const afaq = {
  shred() {
    const s = raw('afaq.v1'); if (!s) return {};
    const o = {};
    if (s.set) o.set = s.set;
    if (s.lic) o.lic = s.lic;
    for (const [p, arr] of [['custom', s.custom], ['watch', s.watch], ['rides', s.rides],
                            ['maint', s.maint], ['pursuits', s.pursuits], ['trips', s.trips],
                            ['places', s.places], ['culled', s.culled]])
      list(arr, p, o);
    return o;
  },
  apply(r) {
    if (empty(r)) return;
    const s = raw('afaq.v1') || { v: 1 };
    if ('set' in r) s.set = r.set;
    if ('lic' in r) s.lic = r.lic;
    for (const p of ['custom', 'watch', 'rides', 'maint', 'pursuits', 'trips', 'places', 'culled'])
      s[p] = unList(r, p);
    s.v = 1;
    put('afaq.v1', s);
    return rehydrate('../../afaq/js/store.js', 'afaq.v1');
  }
};

/* ══════════════════════════════════════════════════════════════════
   SAKINA — IndexedDB, and the same defensive open as everywhere else:
   list before opening, never create, open at the version already on disk.
   ══════════════════════════════════════════════════════════════════ */
const SAK_STORES = ['prayers', 'moods', 'journal', 'tracks', 'drafts'];
const SAK_PK = { prayers: 'date', moods: 'id', journal: 'id', tracks: 'id', drafts: 'id' };

async function sakDb() {
  if (!indexedDB.databases) return null;
  const row = (await indexedDB.databases()).find(d => d.name === 'sakina');
  if (!row) return null;
  return new Promise(res => {
    const q = indexedDB.open('sakina', row.version);
    q.onsuccess = () => res(q.result);
    q.onerror = () => res(null);
    q.onblocked = () => res(null);
    q.onupgradeneeded = () => { /* unreachable: opened at the version on disk */ };
  });
}
const getAll = (db, s) => new Promise(res => {
  if (!db.objectStoreNames.contains(s)) return res([]);
  try { const q = db.transaction(s, 'readonly').objectStore(s).getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => res([]);
  } catch { res([]); }
});

/* Two localStorage keys ride along with the IndexedDB stores: the Gemini key
   the meditation generator runs on, and the prayer coordinates. Both are
   settings a person enters ONCE and expects everywhere — the key especially,
   because without it "Make a meditation" dead-ends on every new device with a
   paste screen for a value that already exists three devices away. They are
   records like anything else: private table, RLS, never in a repo. */
const SAK_LS = { apikey: 'sakina.apikey', place: 'sakina.place' };

const sakina = {
  async shred() {
    const o = {};
    for (const [name, k] of Object.entries(SAK_LS)) {
      const v = localStorage.getItem(k);
      if (v) o[`ls/${name}`] = v;
    }
    const db = await sakDb(); if (!db) return o;
    try {
      for (const s of SAK_STORES)
        for (const row of await getAll(db, s)) {
          const id = row[SAK_PK[s]];
          if (id != null) o[`${s}/${id}`] = row;
        }
    } finally { db.close(); }
    return o;
  },
  async apply(r) {
    if (empty(r)) return {};
    /* The settings land whether or not the database exists — a fresh device
       should have the key BEFORE Sakina is first opened, so the generator
       works on its very first run. A value already set locally is kept: a
       deliberate local change beats a synced one for a setting. */
    for (const [name, k] of Object.entries(SAK_LS)) {
      const v = r[`ls/${name}`];
      if (typeof v === 'string' && v && !localStorage.getItem(k)) localStorage.setItem(k, v);
    }
    const db = await sakDb();
    /* No database means Sakina has never run here. Creating one would be the exact
       hazard this codebase avoids everywhere else — a hub-made v1 with no object
       stores would make Sakina's own upgrade skip its track stores permanently. */
    if (!db) return { skipped: 'Sakina has not been opened on this device yet.' };
    try {
      for (const s of SAK_STORES) {
        if (!db.objectStoreNames.contains(s)) continue;
        const want = Object.entries(r)
          .filter(([k]) => k.startsWith(s + '/') && !k.slice(s.length + 1).includes('/'))
          .map(([, v]) => v).filter(Boolean);
        if (!want.length) continue;
        await new Promise((res, rej) => {
          const tx = db.transaction(s, 'readwrite');
          const os = tx.objectStore(s);
          for (const row of want) os.put(row);
          tx.oncomplete = res; tx.onerror = () => rej(tx.error);
        });
      }
    } finally { db.close(); }
    return {};
  }
};

/* ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   DĪWĀN ITSELF — the little it owns
   ══════════════════════════════════════════════════════════════════
   The hub deliberately holds almost nothing, but "almost" is not "nothing", and what
   it does hold is exactly the kind of thing that must follow you between devices: the
   one-off jobs written down for today, and whether the morning's meditation happened.
   Leaving this shard out was a silent hole — every other app synced and the hub's own
   page quietly did not.

   The pasted Good Company snapshot travels as a single record. It is large and it
   changes only on an import, so splitting it would buy nothing. */
const diwanKey = 'diwan.v1';
const diwan = {
  shred() {
    const s = raw(diwanKey); if (!s) return {};
    const o = {};
    list(s.todos, 'todo', o);
    two(s.practice, 'prac', o);
    one(s.health, 'health', o);
    two(s.skips, 'skip', o);
    one(s.sirah, 'sirah', o);
    list(s.rahim, 'rahim', o);
    if (s.gc) o.gc = s.gc;
    if (s.lastBackup) o.lastBackup = s.lastBackup;
    return o;
  },
  async apply(r) {
    if (empty(r)) return;
    const s = raw(diwanKey) || { v: 1 };
    s.todos = unList(r, 'todo');
    s.practice = unTwo(r, 'prac');
    s.health = unOne(r, 'health');
    s.skips = unTwo(r, 'skip');
    s.sirah = unOne(r, 'sirah');
    s.rahim = unList(r, 'rahim');
    s.gc = 'gc' in r ? r.gc : null;
    s.lastBackup = 'lastBackup' in r ? r.lastBackup : null;
    s.v = 1;
    put(diwanKey, s);
    await rehydrate('./store.js', diwanKey);
  }
};

export const SHREDDERS = { compound, jamal, anbiq, gc, afaq, sakina, diwan };
export const APP_IDS = Object.keys(SHREDDERS);

/** Every app's records, as { app: { key: value } }. */
export async function shredAll() {
  const out = {};
  for (const [id, s] of Object.entries(SHREDDERS)) {
    try { out[id] = await s.shred(); }
    catch (e) { out[id] = {}; console.warn('shred failed for', id, e); }
  }
  return out;
}

/** Write a merged record set back into the app it came from. */
export async function applyOne(app, records) {
  const s = SHREDDERS[app];
  if (!s) return { skipped: 'unknown app' };
  return (await s.apply(records)) || {};
}
