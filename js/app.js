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
import { buildQueue, BUNDLES, PRAYER_LABEL, place, leftLabel } from './tasks.js';
import { TIER_LABEL } from './rank.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HUE = id => `var(--${id})`;
const APP_IDS = ['compound', 'jamal', 'anbiq', 'sakina', 'gc', 'afaq'];
const APP_NAME = {
  compound: 'Compound', jamal: 'Jamāl', anbiq: 'Anbīq',
  sakina: 'Sakina', gc: 'Charisma Gym', afaq: 'Āfāq'
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
    ${commandBar()}
    <div class="sect">
      <div class="note"><b>Ticking here writes into the app that owns it.</b> If that app is
      also open in another tab, reload it afterwards — its in-memory copy will not know.</div>
    </div>`;

  renderQueue();
  wireCommandBar();
}

function renderQueue() {
  const box = $('#queue'); if (!box) return;
  const sub = $('#q-sub');
  const open = Q.all.filter(t => !t.done);
  const done = Q.all.filter(t => t.done).concat(Q.done);

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

  const now = Date.now();
  const head = open[0];
  const rest = open.slice(1);
  const passed  = rest.filter(t => t.at && t.at.getTime() <= now);
  const coming  = rest.filter(t => t.at && t.at.getTime() > now);
  const anytime = rest.filter(t => !t.at && !t.isNote);
  /* Kept apart from the queue: these are not a checkbox, they are the app
     asking for something only it can take properly. */
  const notes   = rest.filter(t => !t.at && t.isNote);

  box.innerHTML =
    headCard(head) +
    group('Also due now', passed) +
    group('Later today', coming) +
    group('Any time this week', anytime) +
    group('Needs the app', notes) +
    doneBlock(done);

  wireRows();
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
      ${t.action ? `<button class="go" data-tick="${esc(t.key)}">Done <span class="arr">✓</span></button>` : ''}
      ${t.alt ? `<button class="btn alt" data-alt="${esc(t.key)}">${esc(t.alt.label)}</button>` : ''}
      <a class="btn quiet" href="${esc(inward(t.href, t.app))}">${esc(t.cta || 'Open ' + (APP_NAME[t.app] || ''))} →</a>
    </div>
  </div>`;
}

function group(title, list) {
  if (!list.length) return '';
  return `<div class="sect">
    <div class="sect-h"><h3>${esc(title)}</h3><span class="aside">${list.length}</span></div>
    <div class="rows">${list.map(row).join('')}</div>
  </div>`;
}

function row(t) {
  /* A once-a-day thing says "today"; a window closing says how much of it is left. */
  const countdown = t.at ? '' : (t.daily ? 'today' : leftLabel(t.left, t.over));
  const time = t.at ? hhmm(t.at) : (countdown || (t.mins ? `${t.mins}m` : ''));
  const urgent = !t.at && !t.daily && (t.over || t.tight || (t.left != null && t.left <= 0));
  return `<div class="trow${t.isNote ? ' note-row' : ''}" style="--hue:${HUE(t.app)}" data-key="${esc(t.key)}">
    ${t.action
      ? `<button class="tick" data-tick="${esc(t.key)}" aria-label="Mark ${esc(t.label)} done"></button>`
      : `<a class="tick link" href="${esc(inward(t.href, t.app))}" aria-label="Open ${esc(t.label)}">→</a>`}
    <span class="t-when${urgent ? ' urgent' : ''}">${esc(time)}</span>
    <span class="t-body">
      <span class="t-label">${esc(t.label)}</span>
      <span class="t-note">${esc(t.note)}${t.cadence ? ' · ' + esc(t.cadence) : ''}${t.brief && t.isNote ? ' · ' + esc(t.brief.slice(0, 80)) : ''}</span>
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
    const { hits, already, notDue, misses, ambiguous } = V.match(text, pool, BUNDLES);

    if (!hits.length && !ambiguous.length && !already.length && !notDue.length) {
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
function viewFrame(id, tail) {
  const a = SNAP.apps.find(x => x.id === id);
  if (!a) { location.hash = '#/apps'; return; }
  const src = relPath(a) + (tail ? decodeURIComponent(tail) : '');

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
      <iframe class="frame" src="${esc(src)}" title="${esc(a.name)}"></iframe>
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
  window.scrollTo(0, 0);
}

async function refresh() {
  SNAP = await R.readAll();
  Q = await buildQueue(SNAP);
  paint();
}

window.addEventListener('hashchange', () => {
  const nowFramed = /^#\/in\//.test(location.hash);
  /* On the way out of an app, re-read before painting — so the queue shows what was
     just done in there rather than what was true when you went in. */
  if (wasFramed && !nowFramed) { wasFramed = false; refresh(); return; }
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

refresh().catch(e => {
  app.innerHTML = `<header class="masthead"><p class="eyebrow">Something broke</p>
    <h1>Dīwān</h1><p class="sub">The hub could not finish reading: ${esc(e.message || e)}</p></header>
    <div class="note">Every reader is meant to fail on its own without taking the page down, so
    this is a bug in the hub rather than in one of the apps. Nothing was written anywhere.</div>`;
  console.error(e);
});

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocal) navigator.serviceWorker.register('sw.js').catch(() => {});
