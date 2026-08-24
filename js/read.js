/* Dīwān — the readers.
 *
 * Every static app is served from lorit0t.github.io, and a path does not scope web storage.
 * One origin means one localStorage and one IndexedDB space, so this file reads the other
 * apps directly. No API, no CORS, no server, no second copy of your data.
 *
 * Three rules, because a bug in here would damage an app that is not this one:
 *
 *   1. READ ONLY. Nothing in this file writes to another app's storage. Ever.
 *      That includes not *importing* a module whose top level writes — Jamāl's store.js
 *      stamps a start date on load, so its state is read raw here instead.
 *
 *   2. Where an app can answer the question itself, import its module and ask it.
 *      A second copy of cadence logic drifts, and then the hub and the app disagree
 *      about what you did today. Compound's `satisfied()` and Anbīq's `gaps()` are
 *      the real ones, not reimplementations.
 *
 *   3. Every reader fails soft. An app that has never been opened, a module that moved,
 *      a database that is not there — each returns a report saying so. One broken app
 *      must never take the hub down with it.
 *
 * Charisma Gym (formerly Good Company) moved onto this origin on 2026-08-22 and is now
 * read live like the rest. Its Render service still exists, but only as the voice
 * backend — the UI and all of its storage now sit at lorit0t.github.io/charisma-gym/.
 * The pasted-snapshot path is kept as a fallback for a device that has the export but
 * has never opened the app here.
 */

import * as D from './store.js';

/* ---------- dates: local, matching every app ----------
   Charisma Gym used to derive its day key in UTC, which shifted anything logged
   between midnight and 01:00 BST onto the previous day; that was fixed at the
   source on 2026-08-22. This hub still reads raw `at` timestamps rather than
   `day` labels, which is correct regardless and survives any future drift. */
export const iso = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const shift = (k, n) => iso(new Date(new Date(k + 'T00:00').getTime() + n * 864e5));
export const between = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 864e5);
export const since = k => (k ? between(k, iso()) : null);
export const noon = k => new Date(k + 'T12:00').getTime();

/* Which app owns each quantity when more than one asks for it.
   Jamāl's inside layer duplicates five metrics that live in richer form next door.
   The hub does not ask you for a number a sibling already has — that suppression is
   most of the reason this page exists. */
export const SHADOWED = {
  sleep:   { owner: 'compound', label: 'Sleep',   note: 'Compound logs the wake time' },
  train:   { owner: 'compound', label: 'Trained', note: 'Compound logs the session' },
  protein: { owner: 'compound', label: 'Protein', note: 'Compound logs the grams' },
  salah:   { owner: 'sakina',   label: 'Salah',   note: 'Sakina logs all five states' },
  calm:    { owner: 'sakina',   label: 'Calm',    note: 'Sakina logs mood on two axes' }
};

const APPS = {
  compound: { name: 'Compound',    arabic: '',        tag: 'Sleep · training · fuel · tests',    url: 'https://lorit0t.github.io/compound/' },
  jamal:    { name: 'Jamāl',       arabic: 'جمال',    tag: 'Grooming · skin · fit · scent',      url: 'https://lorit0t.github.io/jamal/' },
  anbiq:    { name: 'Anbīq',       arabic: 'الأنبيق', tag: 'Reading · claims · predictions',     url: 'https://lorit0t.github.io/anbiq/' },
  sakina:   { name: 'Sakina',      arabic: 'سكينة',   tag: 'Prayer · meditation · mood',         url: 'https://lorit0t.github.io/sakina/' },
  gc:       { name: 'Charisma Gym', arabic: '',       tag: 'Charisma · social skill',            url: 'https://lorit0t.github.io/charisma-gym/' },
  afaq:     { name: 'Āfāq',        arabic: 'آفاق',    tag: 'Screen · road · craft · travel',     url: 'https://lorit0t.github.io/afaq/' }
};

function blank(id) {
  return {
    id, ...APPS[id],
    ok: true, reason: null, started: false,
    stat: [], due: [], links: [], proposals: [],
    days: {}, feed: [], last: null
  };
}

const add = (days, k, n = 1) => { if (k) days[k] = (days[k] || 0) + n; };

/* ══════════════════════════════════════════════════════════════════
   COMPOUND — imported wholesale. Its own cadence semantics decide what
   counts as satisfied, so the hub can never disagree with the app.
   ══════════════════════════════════════════════════════════════════ */
async function readCompound() {
  const R = blank('compound');
  R.links = [
    { label: 'Today',  href: R.url },
    { label: 'Split',  href: R.url + '#/split' },
    { label: 'Log',    href: R.url + '#/log' },
    { label: 'Review', href: R.url + '#/review' },
    { label: 'Buy',    href: R.url + '#/buy' }
  ];

  let H, S, DATA;
  try {
    [H, S, DATA] = await Promise.all([
      import('../../compound/js/health.js'),
      import('../../compound/js/store.js'),
      import('../../compound/js/data.js')
    ]);
  } catch (e) {
    R.ok = false;
    R.reason = 'Compound’s modules did not load (' + (e.message || e) + '). Offline, or the app moved.';
    return R;
  }

  const t = iso();
  const hlog = S.getHLog();
  const sessions = S.getSessions();
  R.started = Object.keys(hlog).length > 0 || Object.keys(sessions).length > 0;

  /* activity + feed */
  for (const [d, day] of Object.entries(hlog)) {
    const n = Object.values(day).filter(e => e && e.done).length;
    if (n) { add(R.days, d, n); R.feed.push({ t: noon(d), d, app: 'compound', text: `${n} component${n === 1 ? '' : 's'} logged` }); }
  }
  for (const s of Object.values(sessions)) {
    const done = Object.values(s.sets || {}).flat().filter(r => r && r.done).length;
    if (!done) continue;
    add(R.days, s.date, 1);
    R.feed.push({ t: noon(s.date) + 1, d: s.date, app: 'compound', text: `${s.dayId} — ${done} set${done === 1 ? '' : 's'}` });
  }
  R.last = Object.keys(R.days).sort().pop() || null;

  if (!R.started) {
    R.stat = [{ l: 'Not started', v: '—' }];
    return R;
  }

  /* today, by Compound's own rules */
  const items = H.live();
  const openItems = items.filter(i => !H.satisfied(t, i));
  const byDomain = {};
  for (const i of openItems) (byDomain[i.dom] ||= []).push(i);

  const todaysWorkout = (DATA.SCHEDULE.find(x => x.day === new Date().getDay()) || {}).workout;
  const sessionToday = todaysWorkout ? S.getSession(S.sessionKey(todaysWorkout, t)) : null;
  const setsToday = sessionToday
    ? Object.values(sessionToday.sets || {}).flat().filter(r => r && r.done).length : 0;

  R.stat = [
    { l: 'Logged today', v: `${items.length - openItems.length}/${items.length}` },
    { l: 'Training',     v: todaysWorkout ? (setsToday ? `${setsToday} sets` : todaysWorkout) : 'rest day',
      tone: todaysWorkout && !setsToday ? 'open' : 'ok' },
    { l: 'Wake time',    v: `${S.doneInLast(t, 'wake', 14)}/14` }
  ];

  R.due = openItems.slice(0, 40).map(i => ({
    label: i.name,
    note: (H.DOMAINS[i.dom] || {}).label || i.dom,
    domain: i.dom
  }));
  if (todaysWorkout && !setsToday) {
    R.due.unshift({ label: `${todaysWorkout} — not started`, note: 'Workout', domain: 'workout' });
  }

  /* ---- what Compound would say to do next ---- */

  /* Its own engine calls the wake time the highest-leverage item in the app and says
     nothing else compensates for it. That earns the top tier here too. */
  const wake14 = S.doneInLast(t, 'wake', 14);
  if (wake14 < 10) {
    R.proposals.push({
      tier: 'foundation', app: 'compound', overdue: 14 - wake14,
      why: `Same wake time logged on ${wake14} of the last 14 days`,
      what: 'Fix Lever 01 before anything else. It is the cheapest item in the stack and nothing further down compensates for it.',
      cta: 'Open Compound', href: R.url
    });
  }
  if (S.doneInLast(t, 'bloods', 90) === 0) {
    R.proposals.push({
      tier: 'reality', app: 'compound', overdue: 90,
      why: 'No blood panel in 90 days',
      what: 'Everything in the fuel band is a hypothesis until the panel lands. Stop the multivitamin 72h before the draw.',
      cta: 'See the test band', href: R.url
    });
  }
  const worst = Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length)[0];
  if (worst && worst[1].length) {
    R.proposals.push({
      tier: 'due', app: 'compound', overdue: worst[1].length,
      why: `${worst[1].length} open in ${(H.DOMAINS[worst[0]] || {}).label || worst[0]}`,
      what: worst[1].slice(0, 4).map(i => i.name).join(' · ') + (worst[1].length > 4 ? ' …' : ''),
      cta: 'Log them', href: R.url
    });
  }

  /* Compound's fortnightly engine, verbatim — not re-derived here. */
  try {
    const recs = H.recommend(t).filter(r => r.t !== 'Not enough data yet');
    R.engine = recs.slice(0, 3);
  } catch { R.engine = []; }

  return R;
}

/* ══════════════════════════════════════════════════════════════════
   JAMĀL — content imported, state read raw.
   jamal/js/store.js writes `set.start` at module load, and this hub is not
   allowed to stamp another app's data just by being opened. So `dueIn` below
   is a faithful copy of theirs, and it is the one duplication in this file.
   ══════════════════════════════════════════════════════════════════ */
function jamalDueIn(r, st, t) {
  const c = r.cadence, last = st.last[r.id];
  if (c.type === 'ondemand') return null;
  if (!last) return (c.type === 'months' || (c.type === 'every' && c.n >= 14)) ? null : 0;
  const gap = between(last, t);
  const doneToday = !!(st.done[t] && st.done[t][r.id]);
  if (c.type === 'daily') return doneToday ? 1 : 0;
  if (c.type === 'every') return c.n - gap;
  if (c.type === 'months') return c.n * 30 - gap;
  if (c.type === 'weekly') {
    const wd = new Date().getDay();
    if (wd === c.day) return doneToday ? 7 : 0;
    return gap >= 7 ? 0 : (c.day - wd + 7) % 7;
  }
  return 0;
}

async function readJamal(covered) {
  const R = blank('jamal');
  R.links = [
    { label: 'Today',  href: R.url },
    { label: 'Ritual', href: R.url + '#/rituals' },
    { label: 'Fit',    href: R.url + '#/fit' },
    { label: 'Face',   href: R.url + '#/face' },
    { label: 'Skin',   href: R.url + '#/skin' },
    { label: 'Log',    href: R.url + '#/log' }
  ];

  let J;
  try { J = await import('../../jamal/js/data.js'); }
  catch (e) { R.ok = false; R.reason = 'Jamāl’s content did not load (' + (e.message || e) + ').'; return R; }

  let st = null;
  try { st = JSON.parse(localStorage.getItem('jamal.v1') || 'null'); } catch { /* corrupt: treat as absent */ }
  st = Object.assign({ done: {}, last: {}, inside: {}, sev: {}, cab: {}, worn: [], marks: {}, set: {} }, st || {});
  R.started = Object.keys(st.done).length > 0;

  const t = iso();
  for (const [d, day] of Object.entries(st.done)) {
    const ids = Object.keys(day);
    if (!ids.length) continue;
    add(R.days, d, ids.length);
    const at = Math.max(...ids.map(k => +day[k] || 0)) || noon(d);
    R.feed.push({ t: at, d, app: 'jamal', text: ids.map(id => (J.RITUALS.find(r => r.id === id) || {}).name || id).slice(0, 3).join(' · ') + (ids.length > 3 ? ` +${ids.length - 3}` : '') });
  }
  R.last = Object.keys(R.days).sort().pop() || null;

  if (!R.started) { R.stat = [{ l: 'Not started', v: '—' }]; return R; }

  const dueRituals = J.RITUALS.filter(r => { const n = jamalDueIn(r, st, t); return n !== null && n <= 0; });
  const insideToday = st.inside[t] || {};

  /* Only ask for what nobody else already knows. */
  const wanted = J.INSIDE.filter(m => {
    if (insideToday[m.id] != null) return false;
    const sh = SHADOWED[m.id];
    return !(sh && covered[sh.owner]);
  });
  R.suppressed = J.INSIDE
    .filter(m => insideToday[m.id] == null && SHADOWED[m.id] && covered[SHADOWED[m.id].owner])
    .map(m => SHADOWED[m.id]);

  /* Adherence over the daily rituals, measured from first use — their rule, not a 30-day window. */
  const daily = J.RITUALS.filter(r => r.cadence.type === 'daily');
  const span = Math.min(30, (since(st.set.start) || 0) + 1);
  let hit = 0, tot = 0;
  for (let i = 0; i < span; i++) {
    const d = shift(t, -i);
    for (const r of daily) { tot++; if (st.done[d] && st.done[d][r.id]) hit++; }
  }

  R.stat = [
    { l: 'Rituals due',  v: String(dueRituals.length), tone: dueRituals.length ? 'open' : 'ok' },
    { l: 'Adherence',    v: tot ? Math.round(hit / tot * 100) + '%' : '—' },
    { l: 'Inside',       v: `${J.INSIDE.length - wanted.length - R.suppressed.length}/${J.INSIDE.length - R.suppressed.length}` }
  ];

  R.due = dueRituals.map(r => ({ label: r.name, note: 'Ritual', domain: 'ritual' }))
    .concat(wanted.map(m => ({ label: m.lbl, note: 'Inside', domain: 'inside' })));

  if (dueRituals.length) {
    R.proposals.push({
      tier: 'due', app: 'jamal', overdue: dueRituals.length,
      why: `${dueRituals.length} ritual${dueRituals.length === 1 ? '' : 's'} due`,
      what: dueRituals.slice(0, 3).map(r => r.name).join(' · ') + (dueRituals.length > 3 ? ' …' : ''),
      cta: 'Run one', href: R.url + '#/rituals'
    });
  }
  /* The 12-week adapalene ramp is the one thing here with a schedule that punishes drift. */
  if (st.set.adapaleneStart) {
    const wk = Math.floor((since(st.set.adapaleneStart) || 0) / 7) + 1;
    if (wk <= 12) R.stat.push({ l: 'Adapalene', v: `week ${wk}` });
  }
  return R;
}

/* ══════════════════════════════════════════════════════════════════
   ANBĪQ — the whole evolution engine imported and asked directly.
   ══════════════════════════════════════════════════════════════════ */
async function readAnbiq() {
  const R = blank('anbiq');
  R.links = [
    { label: 'Today',    href: R.url },
    { label: 'Shelf',    href: R.url + '#shelf' },
    { label: 'Claims',   href: R.url + '#claims' },
    { label: 'Crucible', href: R.url + '#crucible' },
    { label: 'Research', href: R.url + '#research' },
    { label: 'Lab',      href: R.url + '#lab' }
  ];

  let L, A;
  try {
    [L, A] = await Promise.all([
      import('../../anbiq/js/lab.js'),
      import('../../anbiq/js/store.js')
    ]);
  } catch (e) {
    R.ok = false; R.reason = 'Anbīq’s modules did not load (' + (e.message || e) + ').'; return R;
  }

  const st = A.state();
  const t = iso();
  R.started = st.claims.length > 0 || st.books.length > 0 || st.sessions.length > 0;

  for (const s of st.sessions) {
    const pages = Math.max(0, s.to - s.from);
    add(R.days, s.date, 1);
    R.feed.push({ t: noon(s.date), d: s.date, app: 'anbiq', text: `${pages}pp — ${(A.book(s.bookId) || {}).title || 'a book'}` });
  }
  for (const c of st.claims) {
    add(R.days, c.created, 1);
    R.feed.push({ t: noon(c.created) + 2, d: c.created, app: 'anbiq', text: 'Claim: ' + (c.text || '').slice(0, 70) });
  }
  R.last = Object.keys(R.days).sort().pop() || null;

  if (!R.started) {
    R.stat = [{ l: 'Lab is empty', v: '—' }];
    R.proposals.push({
      tier: 'due', app: 'anbiq', overdue: 1,
      why: 'The lab has nothing in it, so nothing can be selected on',
      what: 'Every instrument in Anbīq is a function of a corpus. Open one book on the Shelf and press + Claim once — one claim starts it, two give the Crucible something to do.',
      cta: 'Add the first book', href: R.url + '#shelf'
    });
    return R;
  }

  let vit = null, gaps = [];
  try { vit = L.vitals(); } catch { /* engine needs more than it has */ }
  try { gaps = L.gaps(); } catch { gaps = []; }
  const overdue = A.openPreds().filter(p => (since(p.due) ?? -1) > 0);

  R.stat = [
    { l: 'Vitals',  v: vit && vit.score != null ? `${vit.score}/100` : '—' },
    { l: 'Claims',  v: String(A.live().length) },
    { l: 'Reading', v: String(A.reading().length) },
    { l: 'Open bets', v: String(A.openPreds().length), tone: overdue.length ? 'open' : 'ok' }
  ];

  R.due = gaps.map(g => ({ label: g.t, note: 'Gap', domain: g.k }));

  if (overdue.length) {
    R.proposals.push({
      tier: 'reality', app: 'anbiq', overdue: Math.max(...overdue.map(p => since(p.due) || 0)),
      why: `${overdue.length} prediction${overdue.length === 1 ? '' : 's'} past due`,
      what: 'An unresolved prediction is the lab lying to itself. Resolve it — a miss on record is worth more than an open bet.',
      cta: 'Resolve them', href: R.url + '#research'
    });
  }
  const reality = gaps.find(g => g.k === 'reality');
  if (reality) {
    R.proposals.push({
      tier: 'reality', app: 'anbiq', overdue: 1,
      why: reality.t, what: reality.d, cta: 'Open Claims', href: R.url + '#claims'
    });
  }
  const other = gaps.filter(g => g.k !== 'reality' && g.k !== 'ledger')[0];
  if (other) {
    R.proposals.push({
      tier: 'due', app: 'anbiq', overdue: 1,
      why: other.t, what: other.d, cta: 'Open the Lab', href: R.url + '#lab'
    });
  }

  /* The nightly dispatch: things Claude left for you overnight. */
  const pending = (st.dispatch && Array.isArray(st.dispatch.items))
    ? st.dispatch.items.filter(i => !(st.dispatchSeen || {})[i.id]) : [];
  if (pending.length) {
    R.dispatch = pending;
    R.proposals.push({
      tier: 'due', app: 'anbiq', overdue: 1,
      why: `${pending.length} unread dispatch item${pending.length === 1 ? '' : 's'}`,
      what: pending[0].title, cta: 'Read the dispatch', href: R.url
    });
  }
  return R;
}

/* ══════════════════════════════════════════════════════════════════
   SAKINA — IndexedDB, opened defensively.

   `indexedDB.open(name)` with no version CREATES the database if it is absent,
   at version 1 with no object stores. Sakina's own upgrade path only creates
   `tracks`/`audio`/`drafts` when oldVersion < 1, so a database conjured here at
   v1 would make Sakina upgrade 1→3 and skip them permanently. That is a way to
   break a working app by looking at it, so: list first, never create, and open
   at exactly the version already on disk so no upgrade can fire.
   ══════════════════════════════════════════════════════════════════ */
function openSakina() {
  return new Promise(async resolve => {
    if (!indexedDB.databases) {
      return resolve({ ok: false, reason: 'This browser cannot list databases, and opening Sakina blind could create an empty one. Read skipped on purpose.' });
    }
    let row;
    try { row = (await indexedDB.databases()).find(d => d.name === 'sakina'); }
    catch { return resolve({ ok: false, reason: 'Could not list databases on this device.' }); }
    if (!row) return resolve({ ok: false, reason: 'No Sakina data on this device yet. Open Sakina once and it will appear here.' });

    const req = indexedDB.open('sakina', row.version);
    req.onsuccess = () => resolve({ ok: true, db: req.result });
    req.onerror = () => resolve({ ok: false, reason: 'The Sakina database would not open.' });
    req.onblocked = () => resolve({ ok: false, reason: 'Sakina is open in another tab and holding the database. Close it and reload.' });
    req.onupgradeneeded = () => { /* unreachable: opened at the version already on disk */ };
  });
}
const getAll = (db, store) => new Promise(res => {
  if (!db.objectStoreNames.contains(store)) return res([]);
  try {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  } catch { res([]); }
});

async function readSakina() {
  const R = blank('sakina');
  R.links = [
    { label: 'Today',   href: R.url },
    { label: 'Prayer',  href: R.url + 'prayer/' },
    { label: 'Make',    href: R.url + 'make/' },
    { label: 'Journal', href: R.url + 'journal/' },
    { label: 'Library', href: R.url + 'library/' }
  ];

  const open = await openSakina();
  /* An unreachable database is not evidence that nothing was written — it is the
     absence of evidence. `false` is still the right answer for the row, because an
     entry that cannot be seen cannot tick anything, but the field is set explicitly
     so a caller never has to tell "no" apart from "did not look". */
  if (!open.ok) { R.ok = false; R.reason = open.reason; R.journalToday = false; return R; }
  const db = open.db;

  const [prayers, moods, journal, tracks] = await Promise.all(
    ['prayers', 'moods', 'journal', 'tracks'].map(s => getAll(db, s))
  );
  db.close();

  const t = iso();
  R.started = prayers.length > 0 || moods.length > 0 || journal.length > 0 || tracks.length > 0;

  for (const p of prayers) {
    const n = Object.values(p.prayers || {}).filter(v => v && v !== 'none').length;
    if (!n) continue;
    add(R.days, p.date, n);
    R.feed.push({ t: p.updatedAt || noon(p.date), d: p.date, app: 'sakina', text: `${n}/5 prayers marked` });
  }
  for (const m of moods) {
    const d = iso(new Date(m.at)); add(R.days, d, 1);
    R.feed.push({ t: m.at, d, app: 'sakina', text: `Mood — ${m.valence >= 0 ? 'pleasant' : 'unpleasant'}, ${m.energy >= 0 ? 'energised' : 'low'}` });
  }
  for (const j of journal) {
    const d = iso(new Date(j.at)); add(R.days, d, 1);
    R.feed.push({ t: j.at, d, app: 'sakina', text: 'Journal — ' + (j.text || '').slice(0, 60) });
  }
  for (const tr of tracks) {
    const d = iso(new Date(tr.createdAt)); add(R.days, d, 1);
    R.feed.push({ t: tr.createdAt, d, app: 'sakina', text: 'Made "' + (tr.name || 'a track') + '"' });
  }
  R.last = Object.keys(R.days).sort().pop() || null;

  /* Whether anything was written today, read from Sakina's own entries — the one part
     of the evening practice that leaves a trace there, so it needs no record of ours.
     Set before the early return below: "have I journalled today" has the same honest
     answer whether or not Sakina has ever been opened, and the row that asks it is
     due either way. */
  R.journalToday = journal.some(j => iso(new Date(j.at)) === t);

  if (!R.started) { R.stat = [{ l: 'Not started', v: '—' }]; return R; }

  const today = prayers.find(p => p.date === t);
  const markedToday = today ? Object.values(today.prayers).filter(v => v !== 'none').length : 0;

  /* The last seven days of prayer states and journal days, for the hub's week
     boxes. Kept tiny — a map per day, not the records themselves. */
  R.prayerHist = {};
  for (const p of prayers) {
    const gap = Math.round((new Date(t) - new Date(p.date)) / 864e5);
    if (gap >= 0 && gap < 7) R.prayerHist[p.date] = p.prayers;
  }
  R.journalDates = [...new Set(journal.map(j => iso(new Date(j.at))))].slice(-14);
  const lastMood = moods.sort((a, b) => b.at - a.at)[0];
  const weekJournal = journal.filter(j => Date.now() - j.at < 7 * 864e5).length;

  R.prayerToday = today ? today.prayers : null;

  /* Sakina refuses streaks, scores and anything that turns a gap into a failure.
     This hub honours that: salah is shown as state and is never ranked as a task. */
  R.stat = [
    { l: 'Prayers today', v: `${markedToday}/5`, tone: 'plain' },
    { l: 'Last mood',     v: lastMood ? (since(iso(new Date(lastMood.at))) === 0 ? 'today' : `${since(iso(new Date(lastMood.at)))}d ago`) : '—' },
    { l: 'Journal, 7d',   v: String(weekJournal) },
    { l: 'Tracks',        v: String(tracks.length) }
  ];

  if (!lastMood || Date.now() - lastMood.at > 36 * 3600e3) {
    R.proposals.push({
      tier: 'due', app: 'sakina', overdue: 1,
      why: 'No mood logged since ' + (lastMood ? `${since(iso(new Date(lastMood.at)))} days ago` : 'ever'),
      what: 'Two axes, ten seconds. It is the only input that tells the rest of this apart from a tired week.',
      cta: 'Open Sakina', href: R.url
    });
  }
  return R;
}

/* Charisma Gym's own store keys, newest first. Read-only, like everything here. */
const GC_KEYS = ['charismagym.v1', 'goodcompany.v2', 'goodcompany.v1'];

function gcLive() {
  for (const k of GC_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const d = JSON.parse(raw);
      if (Array.isArray(d.events)) return d;
    } catch { /* fail soft — a corrupt neighbour must not take the hub down */ }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   CHARISMA GYM — now on this origin, so it is read live like the others.
   Falls back to a pasted snapshot only if nothing is stored here yet.
   ══════════════════════════════════════════════════════════════════ */
function readGoodCompany() {
  const R = blank('gc');
  R.links = [
    { label: 'Hub',       href: R.url },
    { label: 'Call',      href: R.url + '#call' },
    { label: 'Field log', href: R.url + '#field' },
    { label: 'Lab',       href: R.url + '#lab' },
    { label: 'Signals',   href: R.url + '#signals' }
  ];

  const live = gcLive();
  const snap = live ? null : D.gc();
  R.offOrigin = !live;
  if (!live && !snap) {
    R.ok = false;
    R.reason = 'Charisma Gym is on this origin now, but nothing has been logged on this device yet. Open it once — or paste an export into Data if you have history from elsewhere.';
    return R;
  }

  const d = live || snap.data || {};
  const events = Array.isArray(d.events) ? d.events : [];
  const field = Array.isArray(d.field) ? d.field : [];
  const calls = Array.isArray(d.calls) ? d.calls : [];
  R.started = events.length > 0;
  R.age = live ? 0 : since(iso(new Date(snap.importedAt)));

  /* `at` rather than `day`: their day key is UTC, so late-night entries carry
     yesterday's label. Timestamps are unambiguous. */
  for (const e of events) {
    const dk = iso(new Date(e.at)); add(R.days, dk, 1);
  }
  for (const f of field) {
    R.feed.push({ t: f.at, d: iso(new Date(f.at)), app: 'gc', text: `Field — ${f.context || 'an interaction'}${f.outcome ? ` (${f.outcome}/5)` : ''}` });
  }
  for (const c of calls) {
    R.feed.push({ t: c.at, d: iso(new Date(c.at)), app: 'gc', text: `Call with ${c.persona || 'a friend'}${c.overall ? ` — ${c.overall}/100` : ''}` });
  }
  R.last = Object.keys(R.days).sort().pop() || null;

  const week = Date.now() - 7 * 864e5;
  const reps = events.filter(e => e.type === 'rep' && e.at >= week).length;
  const lastField = field.length ? Math.max(...field.map(f => f.at)) : null;
  const fieldDays = lastField == null ? null : Math.floor((Date.now() - lastField) / 864e5);
  const reviews = Array.isArray(d.reviews) ? d.reviews : [];
  const reviewDays = reviews.length ? Math.floor((Date.now() - reviews[0].at) / 864e5) : null;

  let weakest = null;
  const scored = calls.filter(c => c.scores).slice(0, 10);
  if (scored.length) {
    const keys = Object.keys(scored[0].scores);
    const avg = {};
    for (const k of keys) avg[k] = Math.round(scored.reduce((a, c) => a + (c.scores[k] || 0), 0) / scored.length);
    weakest = Object.entries(avg).sort((a, b) => a[1] - b[1])[0];
  }

  R.stat = [
    { l: 'Reps, 7d',  v: String(reps), tone: reps < 3 ? 'open' : 'ok' },
    { l: 'Last field', v: fieldDays == null ? 'never' : fieldDays === 0 ? 'today' : `${fieldDays}d ago`, tone: fieldDays == null || fieldDays >= 7 ? 'open' : 'ok' },
    { l: 'Weakest',   v: weakest ? `${weakest[0]} ${weakest[1]}` : '—' },
    live
      ? { l: 'Source', v: 'live', tone: 'ok' }
      : { l: 'Snapshot', v: R.age === 0 ? 'today' : `${R.age}d old`, tone: R.age > 14 ? 'open' : 'plain' }
  ];

  /* Their own second rule: simulation without field data is a closed loop
     that cannot detect its own drift. It outranks technique work. */
  if (fieldDays == null || fieldDays >= 7) {
    R.proposals.push({
      tier: 'reality', app: 'gc', overdue: fieldDays == null ? 30 : fieldDays,
      why: fieldDays == null ? 'No real-world interaction ever logged' : `No field entry in ${fieldDays} days`,
      what: 'The calls are practice; the field log is the only thing that says whether any of it transferred. Log one — especially if it went badly.',
      cta: 'Log an interaction', href: R.url + '#field'
    });
  } else if (reps < 3) {
    R.proposals.push({
      tier: 'due', app: 'gc', overdue: 3 - reps,
      why: `Only ${reps} rep${reps === 1 ? '' : 's'} this week`,
      what: 'Chemistry is partly luck; attempts are not. Start one conversation today and log it, whatever happens.',
      cta: 'Go get a rep', href: R.url + '#field'
    });
  }
  if (reviewDays == null || reviewDays >= 7) {
    R.proposals.push({
      tier: 'review', app: 'gc', overdue: reviewDays == null ? 14 : reviewDays,
      why: reviewDays == null ? 'No weekly review yet' : `No review in ${reviewDays} days`,
      what: 'Read your own instruments and decide one thing to change. A system that never reviews itself is a habit with extra steps.',
      cta: 'Run the review', href: R.url + '#signals'
    });
  }
  if (!live && R.age > 14) {
    R.proposals.push({
      tier: 'housekeeping', app: 'gc', overdue: R.age,
      why: `This snapshot is ${R.age} days old`,
      what: 'These numbers are frozen at the last paste. Open Charisma Gym on this device and it will be read live from then on.',
      cta: 'Update it', href: '#/data'
    });
  }
  return R;
}


/* ══════════════════════════════════════════════════════════════════
   ĀFĀQ — screen, road, craft and travel.
   Like Anbīq it carries its own engine, and like Charisma Gym it already
   reduces to a single next action. `theOneThing()` is asked rather than
   re-derived, so the hub cannot come to a different conclusion than the app.
   ══════════════════════════════════════════════════════════════════ */
const detag = h => String(h || '').replace(/<[^>]*>/g, '');

async function readAfaq() {
  const R = blank('afaq');
  R.links = [
    { label: 'Today',  href: R.url },
    { label: 'Screen', href: R.url + '#screen' },
    { label: 'Ride',   href: R.url + '#ride' },
    { label: 'Craft',  href: R.url + '#craft' },
    { label: 'Travel', href: R.url + '#travel' },
    { label: 'Model',  href: R.url + '#model' }
  ];

  let S, E;
  try {
    [S, E] = await Promise.all([
      import('../../afaq/js/store.js'),
      import('../../afaq/js/engine.js')
    ]);
  } catch (e) {
    R.ok = false; R.reason = 'Āfāq’s modules did not load (' + (e.message || e) + ').'; return R;
  }

  const st = S.state();
  R.started = (st.watch || []).length > 0 || (st.rides || []).length > 0
           || (st.pursuits || []).length > 0 || (st.trips || []).length > 0;

  for (const w of (st.watch || [])) {
    if (w.on) { add(R.days, w.on, 1); R.feed.push({ t: noon(w.on), d: w.on, app: 'afaq', text: 'Watched something' }); }
  }
  for (const r of (st.rides || [])) {
    add(R.days, r.date, 1);
    R.feed.push({ t: noon(r.date) + 1, d: r.date, app: 'afaq', text: `Rode ${r.mi || '?'} mi` });
  }
  for (const p of (st.pursuits || [])) for (const l of (p.logs || [])) {
    add(R.days, l.date, 1);
    R.feed.push({ t: noon(l.date) + 2, d: l.date, app: 'afaq', text: `${l.mins || '?'} min of practice` });
  }
  R.last = Object.keys(R.days).sort().pop() || null;

  /* Its own engine before the empty-check, deliberately: on a device with nothing
     logged `theOneThing()` returns the onboarding move, and that is precisely the
     day a new reader most needs to be told where to start. */
  try {
    const one = E.theOneThing();
    if (one) R.proposals.push({
      tier: one.k && /start here/i.test(one.k) ? 'due' : 'reality',
      app: 'afaq', overdue: 1,
      why: detag(one.h), what: detag(one.why),
      cta: 'Open Āfāq', href: R.url + (one.go ? '#' + one.go : '')
    });
  } catch { /* not enough state for it to have a view */ }

  if (!R.started) { R.stat = [{ l: 'Not started', v: '—' }]; return R; }

  let stale = [], up = [], active = [], ladders = [];
  try { stale = E.staleQueue() || []; } catch { /* engine wants more than it has */ }
  try { up = S.upcoming() || []; } catch { }
  try { active = S.activePursuits() || []; } catch { }
  try { ladders = E.craftLadders() || []; } catch { /* older Āfāq, no ladders */ }

  /* A rung that has become claimable is the one moment in a craft worth
     interrupting for, and it is invisible from outside the app. It is not a task
     — nothing here can do it for you and there is nothing to tick. The question
     is "can you actually do this yet", and only you can answer it, which is why
     this arrives as a proposal and lands you inside the Craft tab rather than
     offering a checkbox. */
  const ready = ladders.filter(l => l.next && l.next.eligible);
  if (ready.length) {
    /* One, not a list. Three simultaneous "assess yourself" prompts is how a
       person stops reading them. The furthest-along pursuit goes first, because
       a rung earned deeper into a craft is the harder-won one. */
    const l = ready.sort((a, b) => b.done - a.done || b.sessions - a.sessions)[0];
    /* `reality`, not `due`. The queue drops due-tier proposals on the grounds
       that an app saying "three things are due" only repeats rows already listed
       individually — correct in general, and wrong here: there is no row for
       this, because it is not a task. Nothing above it covers it. */
    R.proposals.push({
      tier: 'reality', app: 'afaq', overdue: 1,
      why: `${l.n} — can you do “${l.next.n}” yet?`,
      what: `${l.next.is} ${l.sessions} sessions logged, which is enough evidence to be asked. Claim it only if you can actually do it, not because you recognise the description.`,
      cta: 'Open Craft', href: R.url + '#craft'
    });
  }

  R.stat = [
    { l: 'Queue',    v: String((S.inQueue() || []).length), tone: stale.length >= 3 ? 'open' : 'plain' },
    { l: 'Rides',    v: String((st.rides || []).length) },
    { l: 'Pursuits', v: String(active.length), tone: ready.length ? 'open' : 'plain' },
    { l: 'Trips',    v: String(up.length) }
  ];

  return R;
}

/* ══════════════════════════════════════════════════════════════════
   One backup for all five.

   Five apps meant five export buttons and five JSON shapes, which is a backup
   habit nobody keeps. This writes one file.

   There is deliberately no matching import. Restoring means writing into another
   app's storage, and each app already validates its own restore properly —
   Anbīq refuses a file with no `claims` array, Good Company refuses one with no
   event log. A hub-level restore would have to bypass all of that. Export here,
   restore there.

   Audio blobs are left out, as Sakina's own export leaves them out: a few
   finished tracks would make the file hundreds of megabytes.
   ══════════════════════════════════════════════════════════════════ */
export async function exportEverything() {
  const out = {
    app: 'diwan', v: 1, exportedAt: new Date().toISOString(),
    note: 'One file, five apps. Restore inside each app — see its own Data or Settings screen. Audio is not included.',
    parts: {}
  };
  const fail = e => ({ error: String((e && e.message) || e) });

  try { const S = await import('../../compound/js/store.js'); out.parts.compound = JSON.parse(S.exportAll()); }
  catch (e) { out.parts.compound = fail(e); }

  /* raw, because importing Jamāl's store would write to it */
  try { out.parts.jamal = JSON.parse(localStorage.getItem('jamal.v1') || 'null'); }
  catch (e) { out.parts.jamal = fail(e); }

  try { const A = await import('../../anbiq/js/store.js'); out.parts.anbiq = JSON.parse(A.exportJSON()); }
  catch (e) { out.parts.anbiq = fail(e); }

  try { out.parts.afaq = JSON.parse(localStorage.getItem('afaq.v1') || 'null'); }
  catch (e) { out.parts.afaq = fail(e); }

  try {
    const open = await openSakina();
    if (!open.ok) out.parts.sakina = { skipped: open.reason };
    else {
      const db = open.db;
      const [tracks, drafts, prayers, moods, journal] = await Promise.all(
        ['tracks', 'drafts', 'prayers', 'moods', 'journal'].map(s => getAll(db, s))
      );
      db.close();
      out.parts.sakina = { tracks, drafts, prayers, moods, journal };
    }
  } catch (e) { out.parts.sakina = fail(e); }

  const snap = D.gc();
  out.parts.goodCompany = snap
    ? { importedAt: new Date(snap.importedAt).toISOString(), data: snap.data }
    : { skipped: 'Never imported. Good Company is on another origin and cannot be read from here.' };

  return out;
}

/* ══════════════════════════════════════════════════════════════════
   Everything, in one call.
   ══════════════════════════════════════════════════════════════════ */
export async function readAll() {
  const t = iso();
  const settle = p => p.catch(e => ({ ok: false, broken: true, reason: String(e && e.message || e) }));

  /* Compound and Sakina first: Jamāl's shadowed metrics depend on whether
     the owning app already has today covered. */
  const [compound, sakina] = await Promise.all([settle(readCompound()), settle(readSakina())]);

  const covered = {
    compound: !!(compound.ok && compound.days && compound.days[t]),
    sakina: !!(sakina.ok && sakina.days && sakina.days[t])
  };

  const [jamal, anbiq, afaq] = await Promise.all([
    settle(readJamal(covered)), settle(readAnbiq()), settle(readAfaq())
  ]);
  const gc = readGoodCompany();

  const apps = [compound, jamal, anbiq, sakina, gc, afaq].map((r, i) => {
    if (r && r.id) return r;
    const fallback = blank(['compound', 'jamal', 'anbiq', 'sakina', 'gc', 'afaq'][i]);
    fallback.ok = false;
    fallback.reason = 'This reader threw: ' + (r && r.reason || 'unknown') + '. The rest of the hub is unaffected.';
    return fallback;
  });

  return { apps, today: t, covered };
}
