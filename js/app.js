/* Dīwān — views and router.
 *
 * Reads five apps, ranks what they say, renders one answer. Nothing here decides
 * anything about your health, reading, appearance, prayer or conversation — those
 * judgements belong to the apps that own the domain, and this file only arranges them.
 */

import * as R from './read.js';
import * as D from './store.js';
import { arbitrate, quietState, TIER_LABEL, TIER_WHY } from './rank.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HUE = id => `var(--${id})`;
const APP_IDS = ['compound', 'jamal', 'anbiq', 'sakina', 'gc'];
const APP_NAME = {
  compound: 'Compound', jamal: 'Jamāl', anbiq: 'Anbīq',
  sakina: 'Sakina', gc: 'Good Company'
};

/* One read per render, shared by every view on the page. */
let SNAP = null;

function toast(msg, bad) {
  $('#toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast'; el.textContent = msg;
  if (bad) el.className = 'bad';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), bad ? 4200 : 2400);
}

const DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function longDate() {
  const d = new Date();
  return `${DAYNAMES[d.getDay()]} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Late';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 22) return 'Evening';
  return 'Late';
}
function ago(dateKey) {
  const n = R.since(dateKey);
  if (n == null) return 'never';
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 7) return `${n} days ago`;
  if (n < 14) return 'last week';
  return `${n} days ago`;
}

/* ══════════════════════════════════════════════════════════════════
   TODAY
   ══════════════════════════════════════════════════════════════════ */
function viewToday() {
  const { apps } = SNAP;
  const { top, rest, count } = arbitrate(apps);

  let head = `<header class="masthead">
      <p class="eyebrow">${esc(longDate())}</p>
      <h1>${esc(greeting())}, Musaed</h1>
      <p class="sub">Five apps, read in place. ${count
        ? `${count} thing${count === 1 ? '' : 's'} raised — this is the one that matters first.`
        : 'Nothing raised.'}</p>
    </header>`;

  /* ---- the one action ---- */
  let action;
  if (top) {
    action = `<div class="act" style="--hue:${HUE(top.app)}">
      <div class="act-top">
        <span class="act-tier">${esc(TIER_LABEL[top.tier] || top.tier)}</span>
        <span class="act-app">${esc(top.appName)}</span>
      </div>
      <h2>${esc(top.why)}</h2>
      <p>${esc(top.what)}</p>
      <a class="go" href="${esc(top.href)}"${top.href.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>
        ${esc(top.cta || 'Open')} <span class="arr" aria-hidden="true">→</span></a>
    </div>
    <p class="tiny" style="margin:9px 2px 0">${esc(TIER_WHY[top.tier] || '')} Ranked above ${rest.length} other${rest.length === 1 ? '' : 's'}.</p>`;
  } else {
    const q = quietState(apps);
    action = `<div class="act act-none">
      <h2>${esc(q.head)}</h2>
      <p>${esc(q.body)}</p>
    </div>`;
  }

  /* ---- the five ---- */
  const cards = apps.map(a => appCard(a)).join('');

  /* ---- everything else ---- */
  const restHtml = rest.length ? `
    <div class="sect">
      <div class="sect-h"><h3>The rest of today</h3><span class="aside">${rest.length}</span></div>
      <div class="rest">
        ${rest.map(p => `
          <a class="rest-row" style="--hue:${HUE(p.app)}" href="${esc(p.href)}"${p.href.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>
            <i class="bar"></i>
            <div class="body">
              <div class="why">${esc(p.why)}</div>
              <div class="what">${esc(p.appName)} · ${esc(p.what).slice(0, 110)}</div>
            </div>
            <span class="tier">${esc(TIER_LABEL[p.tier] || p.tier)}</span>
          </a>`).join('')}
      </div>
    </div>` : '';

  /* ---- suppressed duplicates: the reason this page exists ---- */
  const jam = apps.find(a => a.id === 'jamal');
  const supp = (jam && jam.suppressed) || [];
  const suppHtml = supp.length ? (() => {
    const labels = supp.map(s => s.label.toLowerCase());
    const owners = [...new Set(supp.map(s => APP_NAME[s.owner]))];
    const list = labels.length > 1
      ? labels.slice(0, -1).join(', ') + ' and ' + labels[labels.length - 1]
      : labels[0];
    const by = owners.length > 1 ? owners.slice(0, -1).join(', ') + ' and ' + owners[owners.length - 1] : owners[0];
    return `<div class="sect">
      <div class="note"><b>Not asking you twice.</b> Jamāl wants ${esc(list)} today.
      ${esc(by)} already hold${owners.length > 1 ? '' : 's'} ${supp.length > 1 ? 'them' : 'it'} in
      richer form, so ${supp.length > 1 ? 'they are' : 'it is'} counted as answered and left off
      the list above.</div>
    </div>`;
  })() : '';

  app.innerHTML = head + action + suppHtml + `
    <div class="sect">
      <div class="sect-h"><h3>The five</h3><span class="aside">tap to open</span></div>
      <div class="grid">${cards}</div>
    </div>` + restHtml;
}

function appCard(a) {
  const hue = HUE(a.id);
  const openLink = a.links[0] ? a.links[0].href : '#/apps';

  if (!a.ok) {
    return `<a class="app" style="--hue:${hue}" href="${a.id === 'gc' ? '#/data' : esc(openLink)}"${a.id === 'gc' ? '' : ' target="_blank" rel="noopener"'}>
      <div class="app-h"><span class="app-n">${esc(a.name)}</span>
        <span class="app-ar">${esc(a.arabic || '')}</span></div>
      <div class="app-t">${esc(a.tag)}</div>
      <div class="app-cold">${esc(a.reason)}</div>
    </a>`;
  }

  const stats = a.stat.map(s =>
    `<span class="st"><span class="l">${esc(s.l)}</span>
      <span class="v ${s.tone === 'open' ? 'open' : s.tone === 'ok' ? 'ok' : ''}">${esc(s.v)}</span></span>`).join('');

  /* Sakina shows the day's five as state. No count-up, no streak, no grade. */
  let pips = '';
  if (a.id === 'sakina' && a.prayerToday) {
    const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    pips = `<div class="pips"><span class="pips-l">Today</span>${order.map(k => {
      const v = a.prayerToday[k];
      const cls = v === 'prayed' || v === 'jamaah' ? 'on' : v === 'late' ? 'late' : v === 'missed' ? 'missed' : '';
      return `<i class="pip ${cls}" title="${esc(k)}: ${esc(v)}"></i>`;
    }).join('')}</div>`;
  }

  return `<a class="app" style="--hue:${hue}" href="${esc(openLink)}" target="_blank" rel="noopener">
    <div class="app-h"><span class="app-n">${esc(a.name)}</span>
      <span class="app-ar">${esc(a.arabic || '')}</span></div>
    <div class="app-t">${esc(a.tag)}</div>
    <div class="app-s">${stats}</div>
    ${pips}
  </a>`;
}

/* ══════════════════════════════════════════════════════════════════
   LOG — every app's history on one grid, and one merged stream.
   ══════════════════════════════════════════════════════════════════ */
function viewLog() {
  const { apps, today } = SNAP;
  const WEEKS = 8;

  /* Monday-start weeks, matching Compound's schedule and week strip. */
  const dow = (new Date(today + 'T00:00').getDay() + 6) % 7;
  const thisMonday = R.shift(today, -dow);
  const start = R.shift(thisMonday, -7 * (WEEKS - 1));

  const rows = [];
  for (let w = 0; w < WEEKS; w++) {
    const wkStart = R.shift(start, w * 7);
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const key = R.shift(wkStart, d);
      const future = key > today;
      const active = apps.filter(a => a.ok && a.days && a.days[key]);
      cells.push(`<div class="cell${key === today ? ' today' : ''}${future ? ' future' : ''}" title="${esc(key)}${active.length ? ' — ' + active.map(a => a.name).join(', ') : future ? '' : ' — nothing logged'}">
        ${APP_IDS.map(id => {
          const on = !future && active.some(a => a.id === id);
          return `<i class="${on ? 'on' : ''}" style="--c:${HUE(id)}"></i>`;
        }).join('')}
      </div>`);
    }
    const label = new Date(wkStart + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    rows.push(`<div class="heat-row"><span class="heat-lab">${esc(label.replace(' ', ' '))}</span>${cells.join('')}</div>`);
  }

  const dowHead = `<div class="heat-dow"><span class="heat-lab" style="width:30px"></span>${
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<span>${d}</span>`).join('')}</div>`;

  const key = `<div class="heat-key">${apps.map(a =>
    `<span class="k"><i style="--c:${HUE(a.id)}"></i>${esc(a.name)}</span>`).join('')}</div>`;

  /* per-app totals over the window */
  const totals = apps.map(a => {
    const n = a.ok ? Object.keys(a.days || {}).filter(k => k >= start && k <= today).length : 0;
    return `<span class="st"><span class="l">${esc(a.name)}</span><span class="v">${n}</span></span>`;
  }).join('');

  /* merged stream */
  const feed = apps.filter(a => a.ok).flatMap(a => (a.feed || []).map(f => ({ ...f, name: a.name })))
    .sort((x, y) => y.t - x.t).slice(0, 60);

  let lastDay = null;
  const feedHtml = feed.length ? feed.map(f => {
    const showDay = f.d !== lastDay; lastDay = f.d;
    const when = showDay
      ? (f.d === today ? 'Today' : f.d === R.shift(today, -1) ? 'Yesterday'
        : new Date(f.d + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
      : '';
    return `<div class="fd" style="--hue:${HUE(f.app)}">
      <i class="bar"></i>
      <span class="when">${esc(when)}</span>
      <span class="txt"><b>${esc(f.name)}</b> — ${esc(f.text)}</span>
    </div>`;
  }).join('') : '<p class="small" style="padding:6px 0">Nothing logged on this device yet.</p>';

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow">Everything, one surface</p>
      <h1>Log</h1>
      <p class="sub">Eight weeks. Each day is one cell, split five ways — one sliver per app.
      A sliver missing all the way down a column is the domain you are losing, which is the
      thing no single app can show you.</p>
    </header>

    <div class="card pad">
      <div class="heat"><div class="heat-in">${dowHead}${rows.join('')}</div></div>
      ${key}
    </div>

    <div class="sect">
      <div class="sect-h"><h3>Days logged, 8 weeks</h3></div>
      <div class="card pad"><div class="app-s">${totals}</div></div>
    </div>

    <div class="sect">
      <div class="sect-h"><h3>Recent activity</h3><span class="aside">${feed.length} entries</span></div>
      <div class="card pad"><div class="feed">${feedHtml}</div></div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   APPS — the navigation menu.
   ══════════════════════════════════════════════════════════════════ */
function viewApps() {
  const { apps } = SNAP;

  const cards = apps.map(a => {
    const hue = HUE(a.id);
    const links = a.links.map(l =>
      `<a class="lnk" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('');
    const status = a.ok
      ? (a.started
        ? `<div class="app-s">${a.stat.map(s => `<span class="st"><span class="l">${esc(s.l)}</span><span class="v ${s.tone === 'open' ? 'open' : ''}">${esc(s.v)}</span></span>`).join('')}</div>
           <p class="tiny" style="margin-top:9px">Last logged ${esc(ago(a.last))}.</p>`
        : `<p class="app-cold">Nothing logged on this device yet.</p>`)
      : `<p class="app-cold">${esc(a.reason)}</p>`;

    return `<div class="app" style="--hue:${hue};cursor:default">
      <div class="app-h"><span class="app-n">${esc(a.name)}</span>
        <span class="app-ar">${esc(a.arabic || '')}</span></div>
      <div class="app-t">${esc(a.tag)}</div>
      ${status}
      <div class="links">${links}</div>
    </div>`;
  }).join('');

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow">The five, and the way in</p>
      <h1>Apps</h1>
      <p class="sub">Every page of every app, one tap away. Each opens in its own tab so this
      one keeps its place.</p>
    </header>
    <div class="grid" style="grid-template-columns:1fr">${cards}</div>

    <div class="sect">
      <div class="note"><b>Why Good Company is different.</b> The other four are served from
      this same address, so this page reads them where they sit. Good Company runs on
      onrender.com — a different origin, which the browser walls off completely. Its numbers
      here come from a snapshot you paste in on the Data page.</div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   DATA — the Good Company bridge, one backup, and the diagnostics.
   ══════════════════════════════════════════════════════════════════ */
function viewData() {
  const { apps } = SNAP;
  const snap = D.gc();
  const lastB = D.lastBackup();

  const diag = apps.map(a => {
    const days = Object.keys(a.days || {}).length;
    let cls, msg;
    if (!a.ok) { cls = 'down'; msg = a.reason; }
    else if (a.offOrigin) {
      /* Never claim to have read this one. It is a snapshot and it ages. */
      cls = a.age > 14 ? 'cold' : 'up';
      msg = `From a snapshot pasted ${ago(R.iso(new Date(snap.importedAt)))} — a different origin, `
          + `so it cannot be read directly. ${days} days in the snapshot, newest ${ago(a.last)}.`;
    }
    else if (a.started) { cls = 'up'; msg = `Read directly from this device. ${days} days on record, last ${ago(a.last)}.`; }
    else { cls = 'cold'; msg = 'Readable, but nothing logged on this device yet.'; }
    return `<div class="dg"><span class="dot ${cls}"></span>
      <div><div class="n">${esc(a.name)}</div><div class="m">${esc(msg)}</div></div></div>`;
  }).join('');

  app.innerHTML = `
    <header class="masthead">
      <p class="eyebrow">The bridge, the backup, the wiring</p>
      <h1>Data</h1>
      <p class="sub">This hub keeps almost nothing. It reads the other apps where they already
      live, so there is no second copy of your data to fall out of date.</p>
    </header>

    <div class="sect">
      <div class="sect-h"><h3>Good Company snapshot</h3>
        <span class="aside">${snap ? esc(ago(R.iso(new Date(snap.importedAt)))) : 'never'}</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 11px">Good Company is on another origin, so nothing here
        can reach it. Open its hub, use <b>Export</b>, and paste the file below. Everything else
        on this page updates by itself.</p>
        <textarea id="gc-in" placeholder="Paste the Good Company export JSON here…" spellcheck="false"></textarea>
        <div class="btn-row">
          <button class="btn" id="gc-save">Import snapshot</button>
          <a class="btn quiet" href="https://good-company.onrender.com/" target="_blank" rel="noopener">Open Good Company</a>
          ${snap ? '<button class="btn quiet danger" id="gc-forget">Forget it</button>' : ''}
        </div>
        ${snap ? `<p class="tiny" style="margin-top:11px">Holding ${esc(String((snap.data.events || []).length))} events,
          ${esc(String((snap.data.field || []).length))} field entries and
          ${esc(String((snap.data.calls || []).length))} calls, as of
          ${esc(new Date(snap.importedAt).toLocaleString('en-GB'))}.</p>` : ''}
      </div>
    </div>

    <div class="sect">
      <div class="sect-h"><h3>One backup, all five</h3>
        <span class="aside">${lastB ? esc(ago(lastB)) : 'never'}</span></div>
      <div class="card pad">
        <p class="small" style="margin:0 0 11px">Five apps meant five export buttons, which is a
        habit nobody keeps. This writes one file.</p>
        <div class="btn-row"><button class="btn" id="dl">Download everything</button></div>
        <p class="tiny" style="margin-top:11px"><b>Export only, on purpose.</b> Restoring means
        writing into another app's storage, and each app already validates its own restore
        properly. Bringing data back is done inside the app it belongs to. Audio tracks are not
        included — a few would make the file hundreds of megabytes.</p>
      </div>
    </div>

    <div class="sect">
      <div class="sect-h"><h3>What this page can see</h3></div>
      <div class="card pad"><div class="diag">${diag}</div></div>
      <p class="tiny" style="margin:10px 2px 0">Green: read directly from this device.
      Grey: readable, but empty here. Red: unreachable, with the reason.</p>
    </div>

    <div class="sect">
      <div class="note"><b>Storage is per-device, and that is not fixable from here.</b>
      These apps have no accounts and no server by design, so a track made on the laptop is not
      on the phone. This page reads whichever device it is open on. The backup above is the way
      across.</div>
    </div>`;

  $('#gc-save').onclick = () => {
    const txt = $('#gc-in').value.trim();
    if (!txt) { toast('Paste the export first.', true); return; }
    try {
      const n = D.importGC(txt);
      toast(`Imported — ${n.events} events, ${n.field} field entries.`);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  $('#gc-forget') && ($('#gc-forget').onclick = () => {
    D.forgetGC(); toast('Snapshot removed.'); refresh();
  });

  $('#dl').onclick = async () => {
    const btn = $('#dl'); btn.disabled = true; btn.textContent = 'Collecting…';
    try {
      const data = await R.exportEverything();
      const stamp = R.iso();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `diwan-${stamp}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      D.markBackup(stamp);
      const skipped = Object.entries(data.parts)
        .filter(([, v]) => v && (v.error || v.skipped)).map(([k]) => k);
      toast(skipped.length ? `Saved. Not included: ${skipped.join(', ')}.` : 'Saved — all five.');
      btn.disabled = false; btn.textContent = 'Download everything';
    } catch (e) {
      toast('Export failed: ' + e.message, true);
      btn.disabled = false; btn.textContent = 'Download everything';
    }
  };
}

/* ══════════════════════════════════════════════════════════════════
   Router
   ══════════════════════════════════════════════════════════════════ */
const ROUTES = {
  '#/':     { view: viewToday, nav: 'today' },
  '#/log':  { view: viewLog,   nav: 'log' },
  '#/apps': { view: viewApps,  nav: 'apps' },
  '#/data': { view: viewData,  nav: 'data' }
};

function paint() {
  const hash = location.hash || '#/';
  const r = ROUTES[hash] || ROUTES['#/'];
  r.view();
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === r.nav));
  window.scrollTo(0, 0);
}

async function refresh() {
  SNAP = await R.readAll();
  paint();
}

window.addEventListener('hashchange', paint);

/* Come back to the tab after logging something next door and the numbers should
   already be right — the apps write to the same storage this page reads. */
let lastRead = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastRead > 4000) {
    lastRead = Date.now();
    refresh();
  }
});

app.innerHTML = `<header class="masthead"><p class="eyebrow">Reading five apps…</p>
  <h1>Dīwān</h1><p class="sub">Opening Compound, Jamāl, Anbīq and Sakina where they sit.</p></header>`;

refresh().catch(e => {
  app.innerHTML = `<header class="masthead"><p class="eyebrow">Something broke</p>
    <h1>Dīwān</h1><p class="sub">The hub could not finish reading: ${esc(e.message || e)}</p></header>
    <div class="note">Every reader is meant to fail on its own without taking the page down,
    so this is a bug in the hub rather than in one of the apps. The apps themselves are
    untouched — this page only ever reads them.</div>`;
});

/* Production only: a stale worker makes local development miserable. */
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && !isLocal) navigator.serviceWorker.register('sw.js').catch(() => {});
