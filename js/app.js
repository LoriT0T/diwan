/* Dīwān — views and router.
 *
 * Today is a queue you work from the top down. Everything on it was raised by the app
 * that owns the domain; the ordering is this file's only opinion, and it follows the
 * clock rather than importance, because a wake time at 22:00 is not a wake time.
 */

import * as R from './read.js';
import * as D from './store.js';
import * as W from './write.js';
import * as V from './voice.js';
import * as C from './cloud.js';
import * as SY from './sync.js';
import * as N from './remind.js';
import * as SS from './session.js';
import * as P from './push.js';
import { buildQueue, BUNDLES, PRAYER_LABEL, place, prayerTimes, leftLabel } from './tasks.js';
import { TIER_LABEL } from './rank.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HUE = id => `var(--${id})`;
const APP_IDS = ['compound', 'jamal', 'anbiq', 'sakina', 'gc', 'afaq'];
const APP_ORDER = ['diwan', ...APP_IDS];
const APP_NAME = {
  compound: 'Compound', jamal: 'Jamāl', anbiq: 'Anbīq',
  sakina: 'Sakina', gc: 'Charisma Gym', afaq: 'Āfāq', diwan: 'Today'
};

/* Each app's folder relative to Dīwān's own. Relative rather than absolute so the
   frame is same-origin wherever this is served from — the production host, a local
   rig, anywhere. An absolute URL silently becomes cross-origin off production and
   the frame turns into a black box the parent cannot read. */
const relPath = a => '../' + a.url.replace(/^https?:\/\/[^/]+\//, '');

const inward = (url, appId) => {
  /* Turn an app's absolute URL into a Dīwān route that mounts it, keeping any
     deep link (#/rituals, prayer/) as an encoded tail. */
  const a = SNAP && SNAP.apps.find(x => x.id === appId);
  if (!a || !url || url.startsWith('#')) return url;
  const tail = url.startsWith(a.url) ? url.slice(a.url.length) : '';
  return `#/in/${appId}` + (tail ? '~' + encodeURIComponent(tail) : '');
};

let SNAP = null;   // per-app reports
let Q = null;      // the day's queue
let lastUndo = null;

const hhmm = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function toast(msg, opts = {}) {
  $('#toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  if (opts.bad) el.className = 'bad';
  el.innerHTML = `<span>${esc(msg)}</span>` + (opts.undo ? `<button id="t-undo">Undo</button>` : '');
  document.body.appendChild(el);
  if (opts.undo) $('#t-undo').onclick = async () => { el.remove(); await opts.undo(); };
  setTimeout(() => el.remove(), opts.bad ? 5200 : opts.undo ? 6500 : 2400);
}

const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = () => {
  const d = new Date();
  return `${DAYNAMES[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}`;
};
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late'; if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon'; if (h < 22) return 'Evening';
  return 'Late';
}
function ago(dateKey) {
  const n = R.since(dateKey);
  if (n == null) return 'never';
  if (n === 0) return 'today'; if (n === 1) return 'yesterday';
  if (n < 14) return `${n} days ago`;
  return `${n} days ago`;
}

/* ══════════════════════════════════════════════════════════════════
   Ticking
   ══════════════════════════════════════════════════════════════════ */
async function tick(task, action) {
  const act = action || task.action;
  if (!act) return;
  const res = await W.perform(act);
  if (!res.ok) { toast(res.error, { bad: true }); return false; }

  task.done = res.done !== false;
  if (act.state) task.state = act.state;
  lastUndo = async () => {
    await res.undo();
    task.done = false; task.state = 'none';
    await refresh();
    toast('Put back.');
  };
  renderQueue();
  toast(`${task.label} — logged.`, { undo: lastUndo });
  return true;
}

/* ══════════════════════════════════════════════════════════════════
   TODAY — the queue
   ══════════════════════════════════════════════════════════════════ */
function viewToday() {
  const open = Q.openCount, done = Q.doneCount;

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow">${esc(longDate())}</p>
      <h1>${esc(greeting())}, Musaed</h1>
      <p class="sub" id="q-sub"></p>
    </header>
    <div id="queue"></div>
    ${todoBar()}
    ${commandBar()}
    <div class="sect">
      <div class="note"><b>Ticking here writes into the app that owns it.</b> If that app is
      also open in another tab, reload it afterwards — its in-memory copy will not know.</div>
    </div>`;

  renderQueue();
  wireTodo();
  wireCommandBar();
}

/* ══════════════════════════════════════════════════════════════════
   THE DAY, ON TWO AXES

   Time and app pull against each other and only one can be the outer grouping. The
   first attempt nested app inside time band, which quietly destroyed the thing that
   made the page work: inside "Later today", 08:30 sat below 07:30 because they came
   from different apps, and "tick from the top" stopped meaning anything.

   So time wins by default and is never broken — within a band the order is strictly
   chronological. What app a row belongs to is carried in words on the row itself,
   because a colour only tells you if you have memorised six of them.

   The other axis is a toggle rather than a nesting. By app, the same rows regroup, and
   time still orders them within each app. Two readings of one list, neither corrupting
   the other.

   The bands are chosen to answer different questions: what did I miss, what is next,
   what is coming, what has a deadline this week, what has none.
   ══════════════════════════════════════════════════════════════════ */
const GKEY = 'diwan.grouping';
const grouping = () => { try { return localStorage.getItem(GKEY) === 'app' ? 'app' : 'time'; } catch { return 'time'; } };
const setGrouping = g => { try { localStorage.setItem(GKEY, g); } catch {} };

function renderQueue() {
  const box = $('#queue'); if (!box) return;
  const sub = $('#q-sub');
  const open = Q.all.filter(t => !t.done);
  const done = Q.all.filter(t => t.done).concat(Q.done);
  const total = open.length + done.length;

  if (sub) sub.textContent = open.length
    ? `${open.length} left today, in the order the day happens. Tick from the top.`
    : 'Nothing left. Everything the six apps raised for today is done.';

  if (!open.length) {
    box.innerHTML = `<div class="act act-none"><h2>Clear</h2>
      <p>Nothing outstanding across the six. Pick the thing you least want to do — that is
      usually the signal.</p></div>` + doneBlock(done);
    wireRows();
    return;
  }

  const head = open[0];
  const rest = open.slice(1);
  const mode = grouping();

  box.innerHTML =
    headCard(head) +
    progressBar(done.length, total) +
    switcher(mode) +
    (mode === 'app' ? byApp(rest) : byTime(rest)) +
    doneBlock(done);

  $('#sw-time') && ($('#sw-time').onclick = () => { setGrouping('time'); renderQueue(); });
  $('#sw-app')  && ($('#sw-app').onclick  = () => { setGrouping('app');  renderQueue(); });
  wireRows();
}

/** How much of the day is behind you. One bar beats six counters. */
function progressBar(doneN, total) {
  if (!total) return '';
  const pct = Math.round((doneN / total) * 100);
  return `<div class="dayprog" title="${doneN} of ${total} done">
    <i style="width:${pct}%"></i>
    <span>${doneN} of ${total} done today</span>
  </div>`;
}

function switcher(mode) {
  return `<div class="switch" role="tablist">
    <button id="sw-time" role="tab" aria-selected="${mode === 'time'}" class="${mode === 'time' ? 'on' : ''}">By time</button>
    <button id="sw-app"  role="tab" aria-selected="${mode === 'app'}"  class="${mode === 'app' ? 'on' : ''}">By app</button>
  </div>`;
}

/* ── the time axis ───────────────────────────────────────────────── */
function byTime(rest) {
  const now = Date.now();
  const soon = now + 3 * 3600e3;

  const overdue = rest.filter(t => t.at && t.at.getTime() <= now);
  const next    = rest.filter(t => t.at && t.at.getTime() > now && t.at.getTime() <= soon);
  const later   = rest.filter(t => t.at && t.at.getTime() > soon);
  /* A deadline this week is a different kind of thing from something with no date at
     all, and burying them together is how the cabinet went unnoticed for a month. */
  const week    = rest.filter(t => !t.at && !t.isNote && (t.over || t.left != null));
  const someday = rest.filter(t => !t.at && !t.isNote && !t.over && t.left == null);
  const notes   = rest.filter(t => t.isNote);

  const byClock = (a, b) => a.at - b.at;
  /* "Missed" is a verdict; "earlier today" is a fact. Thirty rows under a word that
     blames you is how a list stops being opened. */
  return band('Earlier today', overdue.sort(byClock), 'late')
       + band('Next few hours', next.sort(byClock))
       + band('Later today', later.sort(byClock))
       + band('Running out this week', week.sort((a, b) =>
           ((a.left ?? 99) - (b.left ?? 99)) || (a.over === b.over ? 0 : a.over ? -1 : 1)))
       + band('No deadline', someday)
       + band('Needs the app', notes);
}

function band(title, list, cls) {
  if (!list.length) return '';
  return `<div class="sect">
    <div class="sect-h"><h3 class="${cls || ''}">${esc(title)}</h3><span class="aside">${list.length}</span></div>
    <div class="rows">${list.map(row).join('')}</div>
  </div>`;
}

/* ── the app axis ────────────────────────────────────────────────── */
function byApp(rest) {
  const byId = {};
  for (const t of rest) (byId[t.app] ||= []).push(t);

  return APP_ORDER.filter(id => byId[id]).map(id => {
    const rows = byId[id].sort((a, b) => {
      /* Time still orders within an app — the axis changes, the clock does not. */
      if (a.at && b.at) return a.at - b.at;
      if (a.at) return -1;
      if (b.at) return 1;
      return (a.left ?? 99) - (b.left ?? 99);
    });
    const doneHere = Q.all.concat(Q.done).filter(t => t.app === id && t.done).length;
    return `<div class="sect">
      <div class="sect-h"><h3 style="color:${HUE(id)}">${esc(APP_NAME[id] || id)}</h3>
        <span class="aside">${rows.length} open${doneHere ? ` · ${doneHere} done` : ''}</span></div>
      <div class="rows">${rows.map(row).join('')}</div>
    </div>`;
  }).join('');
}

/* The top of the list, enlarged. Same row, more room — it is not a different
   kind of thing, it is just the one you are on. */
function headCard(t) {
  const time = t.at ? hhmm(t.at)
    : (t.daily ? 'Today' : leftLabel(t.left, t.over) || t.cadence || 'Any time');
  const late = t.at && t.at.getTime() <= Date.now();
  return `<div class="act head" style="--hue:${HUE(t.app)}" data-key="${esc(t.key)}">
    <div class="act-top">
      <span class="act-tier">${esc(t.at ? (late ? 'Now · ' + time : 'At ' + time) : time)}</span>
      <span class="act-app">${esc(APP_NAME[t.app] || t.app)}</span>
      ${t.note ? `<span class="act-app">${esc(t.note)}</span>` : ''}
    </div>
    <h2>${esc(t.label)}</h2>
    ${t.brief ? `<p>${esc(t.brief)}</p>` : ''}
    <div class="act-btns">
      ${t.startSession ? `<button class="go" data-start="${esc(t.startSession)}">Start the session <span class="arr">→</span></button>`
        : t.action ? `<button class="go" data-tick="${esc(t.key)}">Done <span class="arr">✓</span></button>` : ''}
      ${t.alt ? `<button class="btn alt" data-alt="${esc(t.key)}">${esc(t.alt.label)}</button>` : ''}
      <a class="btn quiet" href="${esc(inward(t.href, t.app))}">${esc(t.cta || 'Open ' + (APP_NAME[t.app] || ''))} →</a>
    </div>
  </div>`;
}

/**
 * A group of rows. When there are enough to be a wall, they are broken out under the
 * app each belongs to — a colour stripe tells you which app a row came from only if you
 * have memorised six colours, and a heading does not ask you to.
 */
function group(title, list, { split = false } = {}) {
  if (!list.length) return '';
  const head = `<div class="sect-h"><h3>${esc(title)}</h3><span class="aside">${list.length}</span></div>`;

  if (!split || list.length < 6) {
    return `<div class="sect">${head}<div class="rows">${list.map(row).join('')}</div></div>`;
  }

  const byApp = {};
  for (const t of list) (byApp[t.app] ||= []).push(t);
  const blocks = APP_ORDER.filter(id => byApp[id]).map(id => {
    const rows = byApp[id];
    /* Within an app, its own domains stay together — supplements under fuel, rituals
       under ritual — so a section reads as that app's page rather than a shuffle. */
    const byDom = {};
    for (const t of rows) (byDom[t.note || '—'] ||= []).push(t);
    const inner = Object.entries(byDom).map(([dom, ts]) =>
      `${Object.keys(byDom).length > 1 ? `<div class="sub-h">${esc(dom)}</div>` : ''}
       <div class="rows">${ts.map(row).join('')}</div>`).join('');
    return `<div class="appgrp" style="--hue:${HUE(id)}">
      <div class="appgrp-h"><i></i><span>${esc(APP_NAME[id] || id)}</span>
        <b>${rows.length}</b></div>${inner}</div>`;
  }).join('');
  return `<div class="sect">${head}${blocks}</div>`;
}

function row(t) {
  /* A once-a-day thing says "today"; a window closing says how much of it is left. */
  const countdown = t.at ? '' : (t.daily ? 'today' : leftLabel(t.left, t.over));
  const time = t.at ? hhmm(t.at) : (countdown || (t.mins ? `${t.mins}m` : ''));
  const urgent = !t.at && !t.daily && (t.over || t.tight || (t.left != null && t.left <= 0));
  return `<div class="trow${t.isNote ? ' note-row' : ''}" style="--hue:${HUE(t.app)}" data-key="${esc(t.key)}">
    ${t.startSession
      ? `<button class="tick play" data-start="${esc(t.startSession)}" aria-label="Start ${esc(t.label)}">▶</button>`
      : t.action
      ? `<button class="tick" data-tick="${esc(t.key)}" aria-label="Mark ${esc(t.label)} done"></button>`
      : `<a class="tick link" href="${esc(inward(t.href, t.app))}" aria-label="Open ${esc(t.label)}">→</a>`}
    <span class="t-when${urgent ? ' urgent' : ''}">${esc(time)}</span>
    <span class="t-body">
      <span class="t-label">${esc(t.label)}</span>
      <span class="t-note"><b style="color:${HUE(t.app)}">${esc(APP_NAME[t.app] || t.app)}</b>${
        t.note ? ' · ' + esc(t.note) : ''}${t.cadence ? ' · ' + esc(t.cadence) : ''}${
        t.brief && t.isNote ? ' · ' + esc(t.brief.slice(0, 70)) : ''}</span>
    </span>
    ${t.alt ? `<button class="t-alt" data-alt="${esc(t.key)}">${esc(t.alt.label)}</button>` : ''}
    <i class="t-dot"></i>
  </div>`;
}

function doneBlock(done) {
  if (!done.length) return '';
  return `<div class="sect">
    <div class="sect-h"><h3>Done today</h3><span class="aside">${done.length}</span></div>
    <div class="rows done">${done.map(t => `
      <div class="trow is-done" style="--hue:${HUE(t.app)}" data-key="${esc(t.key)}">
        ${t.action ? `<button class="tick on" data-untick="${esc(t.key)}" aria-label="Undo ${esc(t.label)}">✓</button>`
                   : '<span class="tick on static">✓</span>'}
        <span class="t-when">${t.at ? esc(hhmm(t.at)) : ''}</span>
        <span class="t-body"><span class="t-label">${esc(t.label)}</span>
          <span class="t-note">${esc(t.state && t.state !== 'prayed' ? t.state : t.note)}</span></span>
        <i class="t-dot"></i>
      </div>`).join('')}</div>
  </div>`;
}

function findTask(key) { return Q.all.find(t => t.key === key) || Q.done.find(t => t.key === key); }

function wireRows() {
  document.querySelectorAll('[data-start]').forEach(b => {
    b.onclick = async e => {
      e.preventDefault();
      const r = await SS.start(b.dataset.start);
      if (!r.ok) { toast(r.error, { bad: true }); return; }
      await paintSession(); openPanel();
    };
  });
  document.querySelectorAll('[data-tick]').forEach(b => {
    b.onclick = async e => {
      e.preventDefault();
      const t = findTask(b.dataset.tick); if (!t) return;
      b.disabled = true; await tick(t);
    };
  });
  document.querySelectorAll('[data-alt]').forEach(b => {
    b.onclick = async e => {
      e.preventDefault();
      const t = findTask(b.dataset.alt); if (!t || !t.alt) return;
      b.disabled = true; await tick(t, t.alt.action);
    };
  });
  document.querySelectorAll('[data-untick]').forEach(b => {
    b.onclick = async e => {
      e.preventDefault();
      const t = findTask(b.dataset.untick); if (!t) return;
      /* Untick is the same write again for a toggle; for prayer it is back to none. */
      const act = t.domain === 'prayer'
        ? { ...t.action, state: 'none' } : t.action;
      const res = await W.perform(act);
      if (!res.ok) { toast(res.error, { bad: true }); return; }
      t.done = false; t.state = 'none';
      renderQueue(); toast('Unticked.');
    };
  });
}

/* ── the day's own list ──────────────────────────────────────────────
   Everything else on this page was raised by an app. This is the one place to put
   something that belongs to today and to nothing else. */
function todoBar() {
  return `<div class="sect">
    <div class="sect-h"><h3>Just for today</h3><span class="aside">yours, not an app's</span></div>
    <div class="cmd-in">
      <input id="td-t" type="text" autocomplete="off" placeholder="Something only today needs…">
      <input id="td-at" type="time" class="td-time" aria-label="At (optional)">
      <button id="td-go" class="cmd-go">Add</button>
    </div>
  </div>`;
}
function wireTodo() {
  const inp = $('#td-t'); if (!inp) return;
  const add = async () => {
    const text = inp.value.trim(); if (!text) return;
    D.addTodo(text, R.iso(), $('#td-at').value || null);
    inp.value = ''; $('#td-at').value = '';
    await refresh();
    toast('Added to today.');
  };
  $('#td-go').onclick = add;
  inp.onkeydown = e => { if (e.key === 'Enter') add(); };
}

/* ── the command bar ──────────────────────────────────────────────── */
function commandBar() {
  const mic = V.speechSupported();
  return `<div class="cmd">
    <div class="cmd-in">
      <input id="cmd-t" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="“showered and did my teeth, then fajr”">
      ${mic ? `<button id="cmd-mic" class="mic" aria-label="Speak">🎙</button>` : ''}
      <button id="cmd-go" class="cmd-go">Log</button>
    </div>
    <p class="cmd-hint" id="cmd-hint">${mic
      ? 'Say or type what you have done. It matches words against the list above — it does not interpret, so it will tell you what it could not place.'
      : 'Type what you have done. This browser has no speech recognition, so the microphone is not offered.'}</p>
  </div>`;
}

function wireCommandBar() {
  const input = $('#cmd-t'), hint = $('#cmd-hint');
  if (!input) return;

  const run = async () => {
    const text = input.value.trim();
    if (!text) return;
    /* Done tasks go in too, so "I showered" about something already ticked
       hears "already logged" rather than a shrug. */
    const pool = Q.all.concat(Q.done, Q.dormant || []).filter(t => t.action);
    let { hits, already, notDue, misses, ambiguous } = V.match(text, pool, BUNDLES);

    /* Some rows are real tasks that this bar cannot tick, because the doing and the
       recording are the same act somewhere else — a journal entry is the writing of it.
       Matching those separately turns "I journalled" from a shrug into a sentence that
       says where it actually gets recorded. */
    const elsewhere = [];
    if (misses.length) {
      const off = Q.all.concat(Q.done).filter(t => !t.action && t.recordedBy);
      const still = [];
      for (const m of misses) {
        const r = V.match(m, off, []);
        if (r.hits.length) elsewhere.push(...r.hits.map(h => h.task));
        else still.push(m);
      }
      misses = still;
    }

    if (!hits.length && !ambiguous.length && !already.length && !notDue.length && !elsewhere.length) {
      hint.innerHTML = `<b>Nothing matched.</b> “${esc(text)}” did not line up with anything tickable on the list. Tap it instead, or use the words as they appear above.`;
      return;
    }

    const undos = [];
    for (const h of hits) {
      const res = await W.perform(h.task.action);
      if (res.ok) { h.task.done = true; undos.push(res.undo); } else h.failed = res.error;
    }
    renderQueue(); wireCommandBar();
    $('#cmd-t').value = '';

    const okd = hits.filter(h => !h.failed);
    const bits = [];
    if (okd.length) bits.push(`<b>Ticked:</b> ${okd.map(h => esc(h.task.label)).join(', ')}.`);
    for (const h of hits.filter(h => h.failed)) bits.push(`<b>${esc(h.task.label)} failed:</b> ${esc(h.failed)}`);
    if (already.length) bits.push(`<b>Already logged:</b> ${already.map(a => esc(a.task.label)).join(', ')}.`);
    if (notDue.length) bits.push(`<b>Not due today:</b> ${notDue.map(n => esc(n.task.label)).join(', ')}. Left alone rather than ticked early.`);
    for (const a of ambiguous) bits.push(`<b>“${esc(a.fragment)}”</b> could be ${a.tasks.map(t => esc(t.label)).join(' or ')} — tap the one you meant.`);
    for (const t of elsewhere) bits.push(`<b>${esc(t.label)}</b> is recorded by ${esc(t.recordedBy)} — do it there and it ticks itself here.`);
    if (misses.length) bits.push(`<b>Not placed:</b> ${misses.map(m => '“' + esc(m) + '”').join(', ')}. Nothing was ticked for those.`);
    $('#cmd-hint').innerHTML = bits.join('<br>');

    if (undos.length) toast(`${undos.length} ticked.`, {
      undo: async () => { for (const u of undos) await u(); await refresh(); toast('Put back.'); }
    });
  };

  $('#cmd-go').onclick = run;
  input.onkeydown = e => { if (e.key === 'Enter') run(); };

  const micBtn = $('#cmd-mic');
  if (micBtn) {
    let stop = null;
    micBtn.onclick = () => {
      if (stop) { stop(); stop = null; return; }
      micBtn.classList.add('live');
      hint.textContent = 'Listening…';
      stop = V.listen({
        onPartial: t => { input.value = t; },
        onFinal: t => { input.value = t; run(); },
        onError: m => { hint.textContent = m; micBtn.classList.remove('live'); stop = null; },
        onEnd: () => { micBtn.classList.remove('live'); stop = null; }
      });
    };
  }
}

/* ══════════════════════════════════════════════════════════════════
   APP DETAIL — what is important inside one app
   ══════════════════════════════════════════════════════════════════ */
function viewApp(id) {
  const a = SNAP.apps.find(x => x.id === id);
  if (!a) { location.hash = '#/apps'; return; }
  const hue = HUE(a.id);
  const mine = Q.all.filter(t => t.app === id && !t.done);
  const mineDone = Q.all.concat(Q.done).filter(t => t.app === id && t.done);

  const stats = a.ok && a.started
    ? `<div class="card pad"><div class="app-s big">${a.stat.map(s =>
        `<span class="st"><span class="l">${esc(s.l)}</span>
          <span class="v ${s.tone === 'open' ? 'open' : s.tone === 'ok' ? 'ok' : ''}">${esc(s.v)}</span></span>`).join('')}</div></div>`
    : `<div class="card pad"><p class="small">${esc(a.ok ? 'Nothing logged on this device yet.' : a.reason)}</p></div>`;

  /* Each app's own engine, quoted rather than re-derived. */
  const engine = (a.engine || []).length ? `
    <div class="sect">
      <div class="sect-h"><h3>What ${esc(a.name)} says</h3><span class="aside">its own engine</span></div>
      <div class="rows">${a.engine.map(r => `
        <div class="trow note-row" style="--hue:${hue}">
          <span class="tick blank"></span><span class="t-when"></span>
          <span class="t-body"><span class="t-label">${esc(r.t)}</span>
            <span class="t-note">${esc(r.p)}</span></span><i class="t-dot"></i>
        </div>`).join('')}</div>
    </div>` : '';

  /* Same suppression as the queue: drop the counts of rows already listed above,
     and anything the app's own engine has already said in its own words. */
  const engineTitles = new Set((a.engine || []).map(r => r.t));
  const notes = (a.proposals || []).filter(p =>
    p.tier !== 'housekeeping' && p.tier !== 'due' && !engineTitles.has(p.why));
  const raised = notes.length ? `
    <div class="sect">
      <div class="sect-h"><h3>Raised</h3><span class="aside">${notes.length}</span></div>
      <div class="rows">${notes.map(p => `
        <a class="trow note-row" style="--hue:${hue}" href="${esc(inward(p.href, a.id))}">
          <span class="tick link">→</span>
          <span class="t-when">${esc(TIER_LABEL[p.tier] || '')}</span>
          <span class="t-body"><span class="t-label">${esc(p.why)}</span>
            <span class="t-note">${esc(p.what)}</span></span><i class="t-dot"></i>
        </a>`).join('')}</div>
    </div>` : '';

  const dispatch = (a.dispatch || []).length ? `
    <div class="sect">
      <div class="sect-h"><h3>Dispatch</h3><span class="aside">left overnight</span></div>
      ${a.dispatch.map(i => `<div class="card pad" style="margin-bottom:8px">
        <div class="t-label">${esc(i.title)}</div>
        <p class="small" style="margin:6px 0 0">${esc(i.body)}</p></div>`).join('')}
    </div>` : '';

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow"><a href="#/apps" class="back">← Apps</a></p>
      <h1 style="color:${hue}">${esc(a.name)}${a.arabic ? ` <span class="ar">${esc(a.arabic)}</span>` : ''}</h1>
      <p class="sub">${esc(a.tag)}</p>
    </header>
    ${stats}
    ${mine.length ? `<div class="sect">
      <div class="sect-h"><h3>Outstanding today</h3><span class="aside">${mine.length}</span></div>
      <div class="rows">${mine.map(row).join('')}</div>
    </div>` : `<div class="sect"><div class="note">Nothing outstanding in ${esc(a.name)} today.</div></div>`}
    ${engine}
    ${raised}
    ${dispatch}
    ${mineDone.length ? `<div class="sect">
      <div class="sect-h"><h3>Done today</h3><span class="aside">${mineDone.length}</span></div>
      <div class="rows done">${mineDone.map(t => `
        <div class="trow is-done" style="--hue:${hue}">
          <span class="tick on static">✓</span><span class="t-when">${t.at ? esc(hhmm(t.at)) : ''}</span>
          <span class="t-body"><span class="t-label">${esc(t.label)}</span></span><i class="t-dot"></i>
        </div>`).join('')}</div></div>` : ''}
    <div class="sect">
      <div class="sect-h"><h3>Go to</h3></div>
      <div class="links">${a.links.map(l =>
        `<a class="lnk" href="${esc(inward(l.href, a.id))}">${esc(l.label)}</a>`).join('')}</div>
      <p class="tiny" style="margin:10px 2px 0">Opens inside Dīwān. The ↗ in the bar there
      puts it in its own tab if you want it full screen.</p>
    </div>`;

  wireRows();
}



/* ══════════════════════════════════════════════════════════════════
   The side menu.

   Inside a mounted app Dīwān's bottom bar is hidden — the app has its own and two
   stacked navigation bars is one too many — so this is how you move between apps
   without going back out first. It is the same list everywhere, so the way from
   Compound to Jamāl is the same gesture as the way from Today to the Log.

   Each app carries how many of its rows are still open, because the point of a
   menu here is to choose where to go next, and that number is the reason.
   ══════════════════════════════════════════════════════════════════ */
const SECTIONS = [
  { hash: '#/',     label: 'Today', ico: '◈' },
  { hash: '#/log',  label: 'Log',   ico: '▦' },
  { hash: '#/apps', label: 'Apps',  ico: '◫' },
  { hash: '#/data', label: 'Data',  ico: '↧' }
];

function drawerHTML() {
  const here = location.hash || '#/';
  const inApp = (here.match(/^#\/in\/([a-z]+)/) || [])[1];

  const apps = (SNAP ? SNAP.apps : []).map(a => {
    const open = Q ? Q.all.filter(t => t.app === a.id && !t.done).length : 0;
    const on = inApp === a.id;
    return `<a class="dw-app${on ? ' on' : ''}" style="--hue:${HUE(a.id)}" href="#/in/${a.id}">
      <i class="dw-dot"></i>
      <span class="dw-n">${esc(a.name)}</span>
      ${open ? `<span class="dw-count">${open}</span>` : ''}
    </a>`;
  }).join('');

  return `
    <div class="dw-head">
      <span class="dw-title">Dīwān</span>
      <button class="dw-x" id="dw-close" aria-label="Close menu">✕</button>
    </div>
    <nav class="dw-sect">
      ${SECTIONS.map(s => `<a class="dw-row${here === s.hash ? ' on' : ''}" href="${s.hash}">
        <span class="dw-ico">${s.ico}</span>${s.label}</a>`).join('')}
    </nav>
    <div class="dw-lab">Apps</div>
    <nav class="dw-apps">${apps}</nav>
    <p class="dw-foot">Each one runs inside Dīwān. ↗ in the bar opens it in its own tab.</p>`;
}

function openDrawer() {
  const d = $('#drawer'), sc = $('#scrim');
  d.innerHTML = drawerHTML();
  d.hidden = false; sc.hidden = false;
  /* Force a reflow rather than waiting for a frame. requestAnimationFrame is paused
     in a backgrounded tab, so a drawer opened as the tab loses focus would stay
     stuck off-screen with no way to see it. Reading offsetWidth flushes layout
     synchronously, which is all the transition needs to have a start state. */
  void d.offsetWidth;
  d.classList.add('open'); sc.classList.add('open');
  $('#menu')?.setAttribute('aria-expanded', 'true');
  $('#dw-close').onclick = closeDrawer;
  d.querySelectorAll('a').forEach(a => a.addEventListener('click', closeDrawer));
}
function closeDrawer() {
  const d = $('#drawer'), sc = $('#scrim');
  d.classList.remove('open'); sc.classList.remove('open');
  $('#menu')?.setAttribute('aria-expanded', 'false');
  setTimeout(() => { d.hidden = true; sc.hidden = true; }, 200);
}
const drawerOpen = () => !$('#drawer').hidden;

document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerOpen()) closeDrawer(); });
document.addEventListener('click', e => { if (e.target && e.target.id === 'scrim') closeDrawer(); });

/* ══════════════════════════════════════════════════════════════════
   INSIDE — an app, mounted in Dīwān.

   The apps are not copied here and their source is not moved. Every one of them
   already lives on this origin, so an iframe of `../compound/` is the same app,
   the same code, the same storage — just framed by this page instead of a browser
   tab. That is the whole trick, and it is why this costs nothing:

     · nothing breaks. Existing URLs still work, home-screen installs still work,
       and each app keeps its own repo, its own deploy and its own service worker.
     · nothing duplicates. There is no second copy to drift from the first, which
       is the failure this ecosystem is built to avoid.
     · same origin means the frame is not a black box. When the app inside writes,
       the parent hears the storage event and knows the queue is stale.

   Copying the source in would have bought none of that and cost all of it —
   Sakina alone is a Next.js build with its own basePath.
   ══════════════════════════════════════════════════════════════════ */
/* A framed page gets NO device permissions unless the frame grants them, and the
   failure is silent from the inside: Charisma Gym's call would ask for the mic,
   be refused by policy, and report a microphone problem — the merge quietly
   breaking the one feature in the ecosystem that needs a device. Granted per app
   rather than across the board, because five of the six have no use for it.

   Nothing is escalated by this. Every frame here is the same origin as this page,
   so anything granted is something the app already has when opened in its own
   tab; the list only decides which of them keep it when they are mounted. */
const FRAME_ALLOW = {
  gc:     'microphone; autoplay',   // the live call — mic in, voice out
  sakina: 'autoplay'                // plays the meditation and affirmation tracks
};

function viewFrame(id, tail) {
  const a = SNAP.apps.find(x => x.id === id);
  if (!a) { location.hash = '#/apps'; return; }
  const src = relPath(a) + (tail ? decodeURIComponent(tail) : '');
  const allow = FRAME_ALLOW[id] || '';

  document.body.classList.add('framed');
  const mb = $('#menu'); if (mb) mb.hidden = true;
  app.innerHTML = `
    <div class="frame-wrap">
      <div class="frame-bar" style="--hue:${HUE(a.id)}">
        <button class="fb-menu" id="fb-menu" aria-label="Open menu">☰</button>
        <a class="fb-back" href="#/" aria-label="Back to Dīwān">←</a>
        <span class="fb-name">${esc(a.name)}</span>
        <span class="fb-sp"></span>
        <a class="fb-out" href="${esc(src)}" target="_blank" rel="noopener"
           aria-label="Open in its own tab">↗</a>
      </div>
      <iframe class="frame" src="${esc(src)}" title="${esc(a.name)}"
        ${allow ? `allow="${esc(allow)}"` : ''}></iframe>
    </div>`;
  $('#fb-menu').onclick = openDrawer;
}

/* Anything logged inside a mounted app is a change to data this hub reads. The
   storage event does fire in the parent when a same-origin frame writes, but relying
   on it means trusting one event not to be missed; leaving an app is rare and a
   re-read is entirely local, so the exit just always re-reads. Cheap and never wrong. */
let wasFramed = false;

/* ══════════════════════════════════════════════════════════════════
   LOG
   ══════════════════════════════════════════════════════════════════ */
function viewLog() {
  const { apps, today } = SNAP;
  const WEEKS = 13;

  const off = (new Date(today + 'T00:00').getDay() + 6) % 7;
  const thisMonday = R.shift(today, -off);
  const start = R.shift(thisMonday, -7 * (WEEKS - 1));

  const rows = [];
  for (let wk = 0; wk < WEEKS; wk++) {
    const wkStart = R.shift(start, wk * 7);
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const key = R.shift(wkStart, d);
      const future = key > today;
      const active = apps.filter(a => a.ok && a.days && a.days[key]);
      cells.push(`<div class="cell${key === today ? ' today' : ''}${future ? ' future' : ''}" title="${esc(key)}${active.length ? ' — ' + active.map(a => a.name).join(', ') : future ? '' : ' — nothing logged'}">
        ${APP_IDS.map(id => `<i class="${!future && active.some(a => a.id === id) ? 'on' : ''}" style="--c:${HUE(id)}"></i>`).join('')}
      </div>`);
    }
    const lab = new Date(wkStart + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    rows.push(`<div class="heat-row"><span class="heat-lab">${esc(lab)}</span>${cells.join('')}</div>`);
  }

  const dowHead = `<div class="heat-dow"><span class="heat-lab"></span>${
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>`;

  const key = `<div class="heat-key">${apps.map(a =>
    `<span class="k"><i style="--c:${HUE(a.id)}"></i>${esc(a.name)}</span>`).join('')}</div>`;

  /* Per-app: days logged, and the longest recent silence — the number that
     actually says which domain is slipping. */
  const totals = apps.map(a => {
    const days = a.ok ? Object.keys(a.days || {}).filter(k => k >= start && k <= today) : [];
    const gap = a.last != null ? R.since(a.last) : null;
    return `<div class="tot" style="--hue:${HUE(a.id)}">
      <i></i><span class="tn">${esc(a.name)}</span>
      <span class="tv">${days.length}<small>d</small></span>
      <span class="tg${gap != null && gap >= 3 ? ' warn' : ''}">${gap == null ? '—' : gap === 0 ? 'today' : gap + 'd ago'}</span>
    </div>`;
  }).join('');

  const feed = apps.filter(a => a.ok).flatMap(a => (a.feed || []).map(f => ({ ...f, name: a.name })))
    .sort((x, y) => y.t - x.t).slice(0, 120);

  let lastDay = null;
  const feedHtml = feed.length ? feed.map(f => {
    const showDay = f.d !== lastDay; lastDay = f.d;
    const when = showDay
      ? (f.d === today ? 'Today' : f.d === R.shift(today, -1) ? 'Yest'
        : new Date(f.d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
      : '';
    return `<div class="fd${showDay ? ' newday' : ''}" style="--hue:${HUE(f.app)}">
      <i class="bar"></i><span class="when">${esc(when)}</span>
      <span class="txt"><b>${esc(f.name)}</b> ${esc(f.text)}</span></div>`;
  }).join('') : '<p class="small" style="padding:6px 0">Nothing logged on this device yet.</p>';

  app.innerHTML = `
    <header class="masthead tight">
      <p class="eyebrow">Everything, one surface</p>
      <h1>Log</h1>
      <p class="sub">A quarter. Each day is one cell split six ways, one sliver per app.
      A sliver missing all the way down a column is the domain you are losing.</p>
    </header>
    <div class="card pad">
      <div class="heat"><div class="heat-in">${dowHead}${rows.join('')}</div></div>
      ${key}
    </div>
    <div class="sect">
      <div class="sect-h"><h3>Days logged · last touched</h3><span class="aside">13 weeks</span></div>
      <div class="card pad"><div class="tots">${totals}</div></div>
    </div>
    <div class="sect">
      <div class="sect-h"><h3>Activity</h3><span class="aside">${feed.length}</span></div>
      <div class="card pad"><div class="feed">${feedHtml}</div></div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   APPS
   ══════════════════════════════════════════════════════════════════ */
function viewApps() {
  const cards = SNAP.apps.map(a => {
    const openN = Q.all.filter(t => t.app === a.id && !t.done).length;
    const stats = a.ok && a.started
      ? `<div class="app-s">${a.stat.slice(0, 4).map(s =>
          `<span class="st"><span class="l">${esc(s.l)}</span>
            <span class="v ${s.tone === 'open' ? 'open' : ''}">${esc(s.v)}</span></span>`).join('')}</div>`
      : `<p class="app-cold">${esc(a.ok ? 'Nothing logged on this device yet.' : a.reason)}</p>`;
    return `<div class="app" style="--hue:${HUE(a.id)}">
      <a class="app-hit" href="#/app/${a.id}">
        <div class="app-h"><span class="app-n">${esc(a.name)}</span>
          ${openN ? `<span class="badge">${openN} due</span>` : '<span class="app-ar">' + esc(a.arabic || '') + '</span>'}</div>
        <div class="app-t">${esc(a.tag)}</div>
        ${stats}
      </a>
      <div class="links">
        <a class="lnk strong" href="#/in/${a.id}">Open it here</a>
        <a class="lnk" href="#/app/${a.id}">What's due</a>
      </div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow">The six, and the way in</p>
      <h1>Apps</h1>
      <p class="sub">Every app runs inside this one. <b>Open it here</b> mounts the real app —
      same code, same data, framed by Dīwān instead of a browser tab. <b>What's due</b> shows
      what it is asking for and what its own engine is saying.</p>
    </header>
    <div class="grid">${cards}</div>`;
}

/* ══════════════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════════════ */
function viewData() {
  const { apps } = SNAP;
  const snap = D.gc();
  const lastB = D.lastBackup();
  const p = place();

  const diag = apps.map(a => {
    const days = Object.keys(a.days || {}).length;
    let cls, msg;
    if (!a.ok) { cls = 'down'; msg = a.reason; }
    else if (a.source === 'snapshot') {
      cls = 'cold';
      msg = `From a pasted snapshot${snap ? ' ' + ago(R.iso(new Date(snap.importedAt))) : ''}. `
          + `${days} days in it, newest ${ago(a.last)}.`;
    }
    else if (a.started) { cls = 'up'; msg = `Read directly from this device. ${days} days on record, last ${ago(a.last)}.`; }
    else { cls = 'cold'; msg = 'Readable, but nothing logged on this device yet.'; }
    return `<div class="dg"><span class="dot ${cls}"></span>
      <div><div class="n">${esc(a.name)}</div><div class="m">${esc(msg)}</div></div></div>`;
  }).join('');

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow">The backup and the wiring</p>
      <h1>Data</h1>
      <p class="sub">This hub keeps almost nothing. It reads the apps where they already live,
      so there is no second copy to fall out of date — and it writes back only what you tick.</p>
    </header>

    ${remindSection()}

    ${pushSection()}

    ${syncSection()}

    <div class="sect">
      <div class="sect-h"><h3>One backup, all six</h3>
        <span class="aside">${lastB ? esc(ago(lastB)) : 'never'}</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 11px">Six apps meant six export buttons, which is a
        habit nobody keeps. This writes one file.</p>
        <div class="btn-row"><button class="btn" id="dl">Download everything</button></div>
        <p class="tiny" style="margin-top:11px"><b>Export only, on purpose.</b> Restoring means
        writing a whole app's state at once, and each app already validates its own restore.
        Ticks from Today are single, reversible writes — that is a different thing. Audio tracks
        are not included.</p>
      </div>
    </div>

    <div class="sect">
      <div class="sect-h"><h3>Prayer times</h3><span class="aside">${esc(p.label)}</span></div>
      <div class="card pad">
        <p class="small" style="margin:0">Computed here with the same library, version and
        settings Sakina uses, from the coordinates it already stores — so the times on Today and
        the times in Sakina cannot disagree. Change them in Sakina and this follows.</p>
        <p class="tiny" style="margin:9px 0 0">${esc(p.method)} · ${esc(p.madhab)} ·
        ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}</p>
      </div>
    </div>

    <div class="sect">
      <div class="sect-h"><h3>What this page can see</h3></div>
      <div class="card pad"><div class="diag">${diag}</div></div>
      <p class="tiny" style="margin:10px 2px 0">Green: read directly from this device.
      Grey: readable but empty, or a pasted snapshot. Red: unreachable, with the reason.</p>
    </div>

    <div class="sect">
      <div class="sect-h"><h3>Charisma Gym snapshot</h3>
        <span class="aside">fallback</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 11px">Charisma Gym moved onto this origin and is now
        read live like the rest. This box stays only for a device that holds an old export but
        has never opened the app here.</p>
        <textarea id="gc-in" placeholder="Paste an old Good Company export…" spellcheck="false"></textarea>
        <div class="btn-row">
          <button class="btn" id="gc-save">Import snapshot</button>
          ${snap ? '<button class="btn quiet danger" id="gc-forget">Forget it</button>' : ''}
        </div>
      </div>
    </div>

    <div class="sect">
      <div class="note"><b>Storage is per-device, and that is not fixable from here.</b>
      These apps have no accounts and no server by design. This page reads whichever device it
      is open on. The backup above is the way across.</div>
    </div>`;

  wireSync();
  wireRemind();
  wirePush();

  $('#gc-save').onclick = () => {
    const txt = $('#gc-in').value.trim();
    if (!txt) { toast('Paste the export first.', { bad: true }); return; }
    try { const n = D.importGC(txt); toast(`Imported — ${n.events} events.`); refresh(); }
    catch (e) { toast(e.message, { bad: true }); }
  };
  $('#gc-forget') && ($('#gc-forget').onclick = () => { D.forgetGC(); toast('Snapshot removed.'); refresh(); });

  $('#dl').onclick = async () => {
    const btn = $('#dl'); btn.disabled = true; btn.textContent = 'Collecting…';
    try {
      const data = await R.exportEverything();
      const stamp = R.iso();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `diwan-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      D.markBackup(stamp);
      const skipped = Object.entries(data.parts).filter(([, v]) => v && (v.error || v.skipped)).map(([k]) => k);
      toast(skipped.length ? `Saved. Not included: ${skipped.join(', ')}.` : 'Saved — everything.');
    } catch (e) { toast('Export failed: ' + e.message, { bad: true }); }
    btn.disabled = false; btn.textContent = 'Download everything';
  };
}


/* ══════════════════════════════════════════════════════════════════
   SYNC — the account, and the state of it.
   ══════════════════════════════════════════════════════════════════ */
let syncing = false;

async function runSync(label) {
  if (syncing || !C.signedIn()) return;
  syncing = true;
  const el = $('#sy-state');
  const say = m => { if (el) el.textContent = m; };
  say(label || 'Syncing…');
  const r = await SY.sync({ onStep: say });
  syncing = false;
  if (!r.ok) { say(''); toast(r.error, { bad: true }); return r; }
  await refresh();
  /* An app mounted right now is showing what it read before the merge. Reload the frame
     so it picks up what just arrived, rather than sitting on a stale view of its own data. */
  if (r.took || r.removed) {
    const f = $('iframe.frame');
    if (f) { try { f.contentWindow.location.reload(); } catch { f.src = f.src; } }
  }
  const bits = [];
  if (r.took) bits.push(`${r.took} in`);
  if (r.sent) bits.push(`${r.sent} out`);
  if (r.removed) bits.push(`${r.removed} deleted`);
  if (r.kept) bits.push(`${r.kept} kept local`);
  toast(bits.length ? `Synced — ${bits.join(', ')}.` : 'Synced. Nothing had changed.');
  if (r.notes && r.notes.length) console.info('sync notes:', r.notes);
  return r;
}

function syncSection() {
  const cfg = C.config();
  const inn = C.signedIn();
  const st = SY.state();

  if (!cfg) return `
    <div class="sect">
      <div class="sect-h"><h3>Sync across devices</h3><span class="aside">not set up</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 12px">Storage is per-browser, so a phone and a
        laptop never see each other. Connecting a Supabase project fixes that — the six apps
        stay exactly as they are and Dīwān does the syncing for them.</p>
        <ol class="steps">
          <li>Make a free project at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a>.</li>
          <li>Open its <b>SQL editor</b>, paste the block below, run it once.</li>
          <li>In <b>Settings → API</b>, copy the <b>Project URL</b> and the <b>anon public</b> key
            — <em>not</em> service_role — and paste them here.</li>
        </ol>
        <details class="sql"><summary>The SQL to run</summary><pre>${esc(C.SCHEMA_SQL)}</pre>
          <button class="btn quiet" id="sy-copysql">Copy it</button></details>
        <label class="f-lab" for="sy-url">Project URL</label>
        <input id="sy-url" class="f-input" placeholder="https://xxxxxxxx.supabase.co" spellcheck="false">
        <label class="f-lab" for="sy-anon">anon public key</label>
        <input id="sy-anon" class="f-input" placeholder="eyJhbGciOi…" spellcheck="false">
        <div class="btn-row"><button class="btn" id="sy-save">Connect</button></div>
        <p class="tiny" style="margin-top:11px">Both of these are safe in a public repo by
        design — the anon key identifies the project and grants nothing. Every row is guarded
        inside Postgres by <code>auth.uid() = user_id</code>, so without a signed-in token it
        reaches nothing. The service_role key is the opposite and must never be pasted here.</p>
      </div>
    </div>`;

  if (!inn) return `
    <div class="sect">
      <div class="sect-h"><h3>Sync across devices</h3><span class="aside">signed out</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 12px">Project <code>${esc(C.projectRef() || '')}</code>
        is connected. Sign in and this device joins the account — the first sync merges both
        ways, so nothing already on it is lost. Creating the account sends a confirmation
        email; click that before signing in.</p>
        <label class="f-lab" for="sy-mail">Email</label>
        <input id="sy-mail" class="f-input" type="email" autocomplete="username" spellcheck="false"
               value="mesadhq@gmail.com">
        <label class="f-lab" for="sy-pw">Password</label>
        <input id="sy-pw" class="f-input" type="password" autocomplete="current-password" autofocus>
        <div class="btn-row">
          <button class="btn" id="sy-up">Create the account</button>
          <button class="btn quiet" id="sy-in">Sign in</button>
          <button class="btn quiet danger" id="sy-forget">Use a different project</button>
        </div>
        <p class="tiny" id="sy-msg" style="margin-top:11px"></p>
      </div>
    </div>`;

  return `
    <div class="sect">
      <div class="sect-h"><h3>Sync across devices</h3>
        <span class="aside">${st.lastAt ? esc(ago(R.iso(new Date(st.lastAt)))) : 'never synced'}</span></div>
      <div class="card pad">
        <div class="app-s big" style="margin-bottom:12px">
          <span class="st"><span class="l">Account</span><span class="v" style="font-size:13px">${esc(C.email() || '—')}</span></span>
          <span class="st"><span class="l">Project</span><span class="v" style="font-size:13px">${esc(C.projectRef() || '—')}</span></span>
          <span class="st"><span class="l">Records</span><span class="v">${st.lastCount || 0}</span></span>
          <span class="st"><span class="l">Waiting</span><span class="v" id="sy-pending">…</span></span>
        </div>
        <p class="small" id="sy-state" style="margin:0 0 10px;min-height:1.2em"></p>
        <div class="btn-row">
          <button class="btn" id="sy-now">Sync now</button>
          <button class="btn quiet" id="sy-out">Sign out</button>
        </div>
        <p class="tiny" style="margin-top:11px">Syncs on its own when the hub opens, when you
        leave an app you logged something in, and every few minutes while it is open. Audio
        tracks and exercise photos are left out — metadata for a track travels, the audio is
        re-made where it is wanted.</p>
      </div>
    </div>`;
}

function wireSync() {
  $('#sy-copysql') && ($('#sy-copysql').onclick = async () => {
    try { await navigator.clipboard.writeText(C.SCHEMA_SQL); toast('SQL copied.'); }
    catch { toast('Select it and copy by hand.', { bad: true }); }
  });
  $('#sy-save') && ($('#sy-save').onclick = () => {
    try { C.setConfig($('#sy-url').value, $('#sy-anon').value); toast('Project connected.'); paint(); }
    catch (e) { toast(e.message, { bad: true }); }
  });
  $('#sy-forget') && ($('#sy-forget').onclick = () => { C.clearConfig(); C.signOut(); toast('Disconnected.'); paint(); });
  $('#sy-out') && ($('#sy-out').onclick = () => {
    C.signOut(); SY.forget(); toast('Signed out. Nothing on this device was deleted.'); paint();
  });

  const creds = () => [$('#sy-mail').value.trim(), $('#sy-pw').value];
  const msg = m => { const e = $('#sy-msg'); if (e) e.textContent = m; };

  $('#sy-in') && ($('#sy-in').onclick = async () => {
    const [m, pw] = creds();
    if (!m || !pw) { msg('Email and password, both.'); return; }
    msg('Signing in…');
    try { await C.signIn(m, pw); paint(); await runSync('First sync — merging both ways…'); }
    catch (e) { msg(e.message); }
  });
  $('#sy-up') && ($('#sy-up').onclick = async () => {
    const [m, pw] = creds();
    if (!m || pw.length < 8) { msg('Email, and a password of at least 8 characters.'); return; }
    msg('Creating…');
    try {
      const r = await C.signUp(m, pw);
      if (r.confirm) { msg('Account made. Confirm the email Supabase just sent, then sign in.'); return; }
      paint(); await runSync('First sync…');
    } catch (e) { msg(e.message); }
  });
  $('#sy-now') && ($('#sy-now').onclick = () => runSync());

  if ($('#sy-pending')) SY.pending().then(n => {
    const e = $('#sy-pending'); if (e) e.textContent = n == null ? 'all' : String(n);
  }).catch(() => {});
}


function remindSection() {
  const s = N.settings();
  const perm = N.permission();
  const p = place();
  const times = prayerTimes();
  const fmt = d => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  return `
    <div class="sect">
      <div class="sect-h"><h3>Times and reminders</h3>
        <span class="aside">${esc(perm === 'granted' && s.on ? 'on' : 'off')}</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 10px">Prayer times are computed on this device from
        your coordinates with the same library and settings Sakina uses, so the two cannot
        disagree. Setting your location here sets it for Sakina too.</p>
        <div class="app-s" style="margin-bottom:10px">
          ${times ? Object.entries(times).map(([k, d]) =>
            `<span class="st"><span class="l">${esc(PRAYER_LABEL[k])}</span>
              <span class="v">${esc(fmt(d))}</span></span>`).join('') : '<span class="small">Times unavailable.</span>'}
        </div>
        <p class="tiny" style="margin:0 0 10px">${esc(p.label)} · ${esc(p.method)} · ${esc(p.madhab)}</p>
        <div class="btn-row"><button class="btn quiet" id="rm-loc">Use my location</button></div>

        <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">

        <p class="small" style="margin:0 0 10px">A notification when something falls due —
        each prayer at its time, and anything with an hour on it.</p>
        ${perm === 'unsupported'
          ? '<p class="tiny">This browser has no notifications.</p>'
          : perm === 'denied'
          ? '<p class="tiny">Notifications are blocked for this site. Allow them in the browser’s site settings, then come back.</p>'
          : `<label class="tog"><input type="checkbox" id="rm-on" ${s.on && perm === 'granted' ? 'checked' : ''}>
               <span>Remind me</span></label>
             <label class="tog"><input type="checkbox" id="rm-pr" ${s.prayers ? 'checked' : ''}>
               <span>At each prayer time</span></label>
             <label class="tog"><input type="checkbox" id="rm-ti" ${s.timed ? 'checked' : ''}>
               <span>At the hour of anything else timed</span></label>
             <label class="tog"><input type="checkbox" id="rm-sw" ${s.eveningSweep != null ? 'checked' : ''}>
               <span>One evening sweep of what is still open</span></label>`}
        <p class="tiny" style="margin-top:11px"><b>They fire only while Dīwān is open in a
        tab</b> — backgrounded is fine, closed is not. Push needs a server to push from and
        there isn’t one; the alternative is sending your day somewhere, which is not worth it
        for a reminder. Add Dīwān to your home screen and it behaves like an app.</p>
      </div>
    </div>`;
}

function wireRemind() {
  $('#rm-loc') && ($('#rm-loc').onclick = async () => {
    const b = $('#rm-loc'); b.disabled = true; b.textContent = 'Finding you…';
    try {
      const p = await N.locate();
      toast(`Location set — ${p.label}.`);
      await refresh();
    } catch (e) { toast(e.message, { bad: true }); b.disabled = false; b.textContent = 'Use my location'; }
  });

  const bind = (id, key) => {
    const el = $(id); if (!el) return;
    el.onchange = async () => {
      if (id === '#rm-on' && el.checked && N.permission() !== 'granted') {
        const got = await N.ask();
        if (got !== 'granted') { el.checked = false; toast('Notifications were not allowed.', { bad: true }); paint(); return; }
      }
      N.save({ [key]: key === 'eveningSweep' ? (el.checked ? 21 : null) : el.checked });
      if (N.settings().on) N.start(() => Q);
      toast('Saved.');
    };
  };
  bind('#rm-on', 'on'); bind('#rm-pr', 'prayers');
  bind('#rm-ti', 'timed'); bind('#rm-sw', 'eveningSweep');
}


/* ══════════════════════════════════════════════════════════════════
   THE LIVE SESSION

   Everything a workout needs while your hands are full, in the one place the
   platform allows it to be rich. iOS notifications have no buttons and no text
   entry, so the lock screen can only ever be a doorway; this is the room.

   The bar rides above the nav on every view — you can be in Sakina and still see
   which set you are on. Tapping it opens the panel.
   ══════════════════════════════════════════════════════════════════ */
let sessTimer = null;
let restFired = new Set();

const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

async function paintSession() {
  const bar = $('#sessbar'), panel = $('#sesspanel');
  const v = await SS.view();

  if (!v) {
    bar.hidden = true; panel.hidden = true;
    document.body.classList.remove('has-sess');
    if (sessTimer) { clearInterval(sessTimer); sessTimer = null; }
    return;
  }

  /* One second tick while a session is live. Everything it shows is derived from a
     stored end time, so a tick that is late or skipped entirely changes nothing. */
  if (!sessTimer) sessTimer = setInterval(tickSession, 1000);

  const r = v.rest;
  const ex = v.exercises[v.ex] || v.exercises[0];
  bar.hidden = false;
  document.body.classList.add('has-sess');
  bar.innerHTML = `
    <button class="sb-main" id="sb-open">
      <span class="sb-l">
        <span class="sb-n">${esc(ex ? ex.name : v.name)}</span>
        <span class="sb-s">${v.doneN}/${v.total} sets · ${esc(v.name)}</span>
      </span>
      ${r ? `<span class="sb-rest${r.over ? ' over' : ''}">
               <b>${r.over ? 'GO' : esc(mmss(r.left))}</b>
               <i style="width:${r.over ? 100 : Math.max(0, 100 - (r.left / Math.max(1, r.total)) * 100)}%"></i>
             </span>`
          : `<span class="sb-go">Open</span>`}
    </button>`;
  $('#sb-open').onclick = () => openPanel();

  if (!panel.hidden) renderPanel(v);
}

function tickSession() {
  const r = SS.rest();
  const bar = $('#sessbar');
  if (r && bar && !bar.hidden) {
    const el = bar.querySelector('.sb-rest');
    if (el) {
      el.classList.toggle('over', r.over);
      el.querySelector('b').textContent = r.over ? 'GO' : mmss(r.left);
      el.querySelector('i').style.width =
        (r.over ? 100 : Math.max(0, 100 - (r.left / Math.max(1, r.total)) * 100)) + '%';
    }
    /* Fire once, when it crosses zero. The notification is the point — it is what
       reaches you with the phone face-down on a bench. */
    const stamp = String(SS.live()?.restEndsAt || 0);
    if (r.over && !restFired.has(stamp)) {
      restFired.add(stamp);
      N.fire('Rest done', r.label || 'Next set', 'rest');
      try { if (navigator.vibrate) navigator.vibrate([120, 70, 120, 70, 220]); } catch {}
    }
  }
  const p = $('#sesspanel');
  if (p && !p.hidden) {
    const cd = p.querySelector('#sp-cd');
    if (cd && r) { cd.textContent = r.over ? 'Go' : mmss(r.left); cd.classList.toggle('over', r.over); }
    const el = p.querySelector('#sp-el');
    if (el) { const v = SS.live(); if (v?.at) el.textContent = mmss((Date.now() - v.at) / 1000); }
  }
}

async function openPanel() { $('#sesspanel').hidden = false; renderPanel(await SS.view()); }
function closePanel() { $('#sesspanel').hidden = true; }

function renderPanel(v) {
  if (!v) return;
  const panel = $('#sesspanel');
  const r = v.rest;
  const ex = v.exercises[v.ex] || v.exercises[0];
  const u = v.unit;

  const last = ex && ex.lastTime
    ? ex.lastTime.sets.map(s => `${s.w}×${s.reps}`).join('  ') : null;

  panel.innerHTML = `
    <div class="sp-wrap">
      <div class="sp-top">
        <button class="sp-x" id="sp-close" aria-label="Back">▾</button>
        <span class="sp-name">${esc(v.name)}</span>
        <span class="sp-el" id="sp-el">${esc(mmss(v.elapsed / 1000))}</span>
      </div>

      ${r ? `<div class="sp-rest${r.over ? ' over' : ''}">
          <div class="sp-cd" id="sp-cd">${r.over ? 'Go' : esc(mmss(r.left))}</div>
          <div class="sp-next">${esc(r.label || 'Rest')}</div>
          <div class="sp-rb"><button class="btn btn-mini" id="sp-add">+30s</button>
            <button class="btn btn-mini" id="sp-skip">Skip</button></div>
        </div>` : ''}

      <div class="sp-body">
        ${v.exercises.map(e => `
          <div class="sp-ex${e.i === v.ex ? ' on' : ''}${e.done ? ' done' : ''}" data-ex="${e.i}">
            <div class="sp-eh">
              <span class="sp-en">${esc(e.name)}</span>
              <span class="sp-ec">${e.sets.filter(s => s.done).length}/${e.sets.length}</span>
            </div>
            ${e.i === v.ex ? `
              ${e.cue ? `<p class="sp-cue">${esc(e.cue)}</p>` : ''}
              ${last ? `<p class="sp-last">Last time — ${esc(last)}</p>` : '<p class="sp-last">First time. Record the weight.</p>'}
              ${e.supersetInto ? `<p class="sp-last">Superset into ${esc(e.supersetInto)} — no rest between.</p>` : ''}
              <div class="sp-sets">
                ${e.sets.map(s => `
                  <div class="sp-set${s.done ? ' done' : ''}">
                    <button class="tick${s.done ? ' on' : ''}" data-set="${e.id}|${s.i}"
                      aria-label="Set ${s.i + 1}">${s.done ? '✓' : s.i + 1}</button>
                    <span class="sp-t">${esc(String(s.target || ''))}${s.rir != null ? ` · RIR ${s.rir}` : ''}</span>
                    <input class="sp-in" type="number" inputmode="decimal" step="0.5" placeholder="${esc(u)}"
                      value="${s.w ?? ''}" data-f="w" data-k="${e.id}|${s.i}">
                    <input class="sp-in" type="number" inputmode="numeric" placeholder="reps"
                      value="${s.reps ?? ''}" data-f="reps" data-k="${e.id}|${s.i}">
                    <input class="sp-in narrow" type="number" inputmode="numeric" placeholder="rir"
                      value="${s.rir ?? ''}" data-f="rir" data-k="${e.id}|${s.i}">
                  </div>`).join('')}
              </div>
              <div class="btn-row"><button class="btn quiet btn-mini" data-add="${e.id}">Add a set</button></div>
            ` : ''}
          </div>`).join('')}
      </div>

      <div class="sp-foot">
        <span class="sp-vol">${v.doneN}/${v.total} sets · ${Math.round(v.volume).toLocaleString()} ${esc(u)} volume</span>
        <button class="btn" id="sp-finish">Finish</button>
      </div>
    </div>`;

  $('#sp-close').onclick = closePanel;
  $('#sp-add') && ($('#sp-add').onclick = () => { SS.addRest(30); paintSession(); });
  $('#sp-skip') && ($('#sp-skip').onclick = () => { SS.stopRest(); paintSession(); });
  $('#sp-finish').onclick = async () => {
    await SS.finish(); closePanel(); toast('Session finished.'); await refresh();
  };
  panel.querySelectorAll('.sp-ex').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('button, input')) return;
      SS.focus(+el.dataset.ex, 0); paintSession();
    });
  });
  panel.querySelectorAll('[data-set]').forEach(b => {
    b.onclick = async () => {
      const [id, i] = b.dataset.set.split('|');
      const r = await SS.toggleSet(id, +i);
      restFired.clear();
      if (r.rest) N.schedule(r.rest, 'Rest done', r.label || 'Next set');
      await paintSession();
    };
  });
  panel.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = async () => { await SS.addSet(b.dataset.add); await paintSession(); };
  });
  panel.querySelectorAll('.sp-in').forEach(inp => {
    inp.onchange = async () => {
      const [id, i] = inp.dataset.k.split('|');
      const val = inp.value === '' ? null : Number(inp.value);
      await SS.setFields(id, +i, { [inp.dataset.f]: val });
    };
  });
}


function pushSection() {
  const why = P.blocker();
  const ios = P.isIOS(), inst = P.installed();
  return `
    <div class="sect">
      <div class="sect-h"><h3>Push to this phone</h3>
        <span class="aside" id="pu-state">checking…</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 11px">Reminders that arrive with Dīwān closed and
        the phone asleep. Everything else on this page only fires while a tab is open.</p>
        ${ios && !inst ? `
          <div class="note" style="margin-bottom:12px"><b>Add Dīwān to your Home Screen first.</b>
          On iOS push reaches an installed web app and never a Safari tab — this is Apple's
          rule, not a setting. Share → Add to Home Screen, open Dīwān from the icon, then come
          back to this page.</div>` : ''}
        ${why && !(ios && !inst) ? `<p class="tiny" style="margin:0 0 11px">${esc(why)}</p>` : ''}
        <div class="btn-row">
          <button class="btn" id="pu-on"${why ? ' disabled' : ''}>Turn on push</button>
          <button class="btn quiet" id="pu-off" hidden>Turn it off</button>
          <button class="btn quiet" id="pu-test" hidden>Send a test</button>
        </div>
        <p class="tiny" id="pu-note" style="margin-top:11px"></p>
        <details class="sql" style="margin-top:12px"><summary>The SQL push needs</summary>
          <pre>${esc(P.PUSH_SQL)}</pre>
          <button class="btn quiet" id="pu-sql">Copy it</button></details>
      </div>
    </div>`;
}

async function wirePush() {
  const st = $('#pu-state'), note = $('#pu-note');
  const on = await P.subscribed().catch(() => false);
  if (st) st.textContent = on ? 'on' : (P.blocker() ? 'not available' : 'off');
  $('#pu-off') && ($('#pu-off').hidden = !on);
  $('#pu-test') && ($('#pu-test').hidden = !on);
  $('#pu-on') && ($('#pu-on').hidden = on);

  $('#pu-sql') && ($('#pu-sql').onclick = async () => {
    try { await navigator.clipboard.writeText(P.PUSH_SQL); toast('SQL copied.'); }
    catch { toast('Select it and copy by hand.', { bad: true }); }
  });
  $('#pu-on') && ($('#pu-on').onclick = async () => {
    const b = $('#pu-on'); b.disabled = true; b.textContent = 'Subscribing…';
    try {
      await P.subscribe();
      await syncAgenda();
      toast('Push is on for this device.');
      paint();
    } catch (e) { note.textContent = e.message; b.disabled = false; b.textContent = 'Turn on push'; }
  });
  $('#pu-off') && ($('#pu-off').onclick = async () => {
    await P.unsubscribe(); toast('Push off for this device.'); paint();
  });
  $('#pu-test') && ($('#pu-test').onclick = async () => {
    /* A row one minute out proves the whole chain — agenda, cron, function, VAPID,
       encryption, Apple — rather than only the browser half. */
    const at = new Date(Date.now() + 60_000).toISOString();
    try {
      /* `manual:` so the next agenda rebuild does not delete it before it can fire. */
      await C.upsert('agenda', [{ at, title: 'Dīwān', body: 'Push is working.', url: './#/', tag: 'manual:test' }], 'user_id,tag,at');
      note.textContent = 'Queued for one minute from now. If it does not arrive, the Edge Function or its cron is not running yet.';
    } catch (e) { note.textContent = e.message; }
  });
}

/** Replace the stored agenda with the current day's. Cheap, so it runs on every read. */
async function syncAgenda() {
  if (!C.signedIn() || !Q) return;
  if (!(await P.subscribed().catch(() => false))) return;
  try { await P.pushAgenda(P.buildAgenda(Q, N.settings())); }
  catch (e) { console.warn('agenda upload failed', e.message); }
}

/* ══════════════════════════════════════════════════════════════════
   Router
   ══════════════════════════════════════════════════════════════════ */
function paint() {
  const hash = location.hash || '#/';
  document.body.classList.remove('framed');
  const inFrame = hash.match(/^#\/in\/([a-z]+)(?:~(.*))?$/);
  const m = hash.match(/^#\/app\/([a-z]+)$/);
  let nav = 'today';
  if (inFrame) { viewFrame(inFrame[1], inFrame[2]); return; }
  if (m) { nav = 'apps'; viewApp(m[1]); }
  else if (hash === '#/log') { nav = 'log'; viewLog(); }
  else if (hash === '#/apps') { nav = 'apps'; viewApps(); }
  else if (hash === '#/data') { nav = 'data'; viewData(); }
  else viewToday();
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  const mb = $('#menu');
  if (mb) { mb.hidden = false; mb.onclick = openDrawer; }
  paintSession();
  window.scrollTo(0, 0);
}

async function refresh() {
  SNAP = await R.readAll();
  Q = await buildQueue(SNAP);
  /* The day's shape on the app icon, glanceable with nothing open. */
  N.badge(Q.all.filter(t => !t.done && !t.isNote).length);
  paint();
  syncAgenda();
}

/* The service worker asks an open window to route rather than opening a second copy. */
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data && e.data.type === 'navigate' && e.data.url) {
    const h = String(e.data.url).replace(/^\.\//, '');
    location.hash = h.startsWith('#') ? h : '#/';
  }
});

window.addEventListener('hashchange', () => {
  const nowFramed = /^#\/in\//.test(location.hash);
  /* On the way out of an app, re-read before painting — so the queue shows what was
     just done in there rather than what was true when you went in. */
  if (wasFramed && !nowFramed) {
    wasFramed = false;
    /* Left an app you may have logged something in — push it before anything else. */
    refresh().then(() => { if (C.signedIn()) runSync(); });
    return;
  }
  wasFramed = nowFramed;
  paint();
});

let lastRead = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRead > 4000) {
    lastRead = Date.now(); refresh();
  }
});

app.innerHTML = `<header class="masthead"><p class="eyebrow">Reading the apps…</p>
  <h1>Dīwān</h1><p class="sub">Opening Compound, Jamāl, Anbīq, Sakina, Charisma Gym and Āfāq where they sit.</p></header>`;

/* Sync as soon as the page is usable, not before — the queue should paint from what is
   already here rather than waiting on the network, and then quietly correct itself. */
refresh().then(() => {
  if (N.settings().on) N.start(() => Q);
  if (C.signedIn()) runSync();
  setInterval(() => { if (C.signedIn() && document.visibilityState === 'visible' && !syncing) runSync(); }, 5 * 60_000);
}).catch(e => {
  app.innerHTML = `<header class="masthead"><p class="eyebrow">Something broke</p>
    <h1>Dīwān</h1><p class="sub">The hub could not finish reading: ${esc(e.message || e)}</p></header>
    <div class="note">Every reader is meant to fail on its own without taking the page down, so
    this is a bug in the hub rather than in one of the apps. Nothing was written anywhere.</div>`;
  console.error(e);
});

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocal) navigator.serviceWorker.register('sw.js').catch(() => {});
