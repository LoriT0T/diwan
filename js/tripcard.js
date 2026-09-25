/* Trip — the day-out guide on the Today page.
 *
 * The workout has its own live section because a session is a sequence you
 * move through with your hands full. A trip is the same shape: a string of
 * stops, each with a what, a where and a how, and the only question that
 * matters on the street is "what now, and how do I get there". So this card
 * answers exactly that, big, at the top — the current stop with a one-tap
 * route in Maps — then the next stop, what to carry, who to call, and the
 * whole plan folded underneath.
 *
 * It reads Āfāq's trips in place (the trip is Āfāq's record) and writes back
 * through Āfāq's own store, so a stop ticked here is ticked there.
 *
 * Optional fields a stop may carry beyond Āfāq's own {t, kind, txt, note}:
 *   where  — place name or address, used for the Maps route
 *   how    — how to get there ("12 min walk", "Elizabeth line to Bond St")
 *   mins   — how long to spend there
 *   cost   — what it will cost
 *   tip    — the one thing worth knowing at that stop
 * And a trip may carry: with, meet, bring[{x, done}], contacts[{n, tel}], tips[].
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RAW = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const between = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 864e5);
const KIND_ICO = { travel: '✈', stay: '⌂', see: '◉', eat: '🍽', ride: '⚡', walk: '🚶', salah: '🕌', admin: '▦' };

/* The trip worth showing: one running today, else the nearest starting within three days. */
export function pick(todayISO) {
  const af = RAW('afaq.v1');
  const trips = (af?.trips || []).filter(t => t.status !== 'idea' && t.from && t.to);
  const live = trips.find(t => t.from <= todayISO && t.to >= todayISO);
  if (live) return { t: live, live: true, day: todayISO };
  const soon = trips.filter(t => t.from > todayISO && between(todayISO, t.from) <= 3)
    .sort((a, b) => a.from.localeCompare(b.from))[0];
  return soon ? { t: soon, live: false, day: soon.from } : null;
}

/* Route mode from the stop's own words — the plan already says how. */
function dirflg(how) {
  const h = (how || '').toLowerCase();
  if (/walk|foot|stroll/.test(h)) return 'w';
  if (/tube|line|bus|train|metro|overground|tram|dlr|rail/.test(h)) return 'r';
  if (/drive|car|taxi|uber|bolt|cab/.test(h)) return 'd';
  return '';
}
const mapsHref = s => {
  const f = dirflg(s.how);
  return `https://maps.apple.com/?daddr=${encodeURIComponent(s.where)}${f ? '&dirflg=' + f : ''}`;
};

function stopBlock(s, big) {
  const ico = KIND_ICO[s.kind] || '◉';
  const meta = [s.mins ? `${s.mins} min there` : '', s.cost ? s.cost : ''].filter(Boolean).join(' · ');
  return `<div class="tc-stop${big ? ' big' : ''}${s.done ? ' done' : ''}">
    <div class="tc-t">${esc(s.t || '—')}</div>
    <div class="tc-b">
      <div class="tc-what">${ico} ${esc(s.txt)}</div>
      ${s.where ? `<div class="tc-where">📍 ${esc(s.where)}</div>` : ''}
      ${s.how ? `<div class="tc-how">↳ ${esc(s.how)}</div>` : ''}
      ${meta ? `<div class="tc-meta">${esc(meta)}</div>` : ''}
      ${s.tip || s.note ? `<div class="tc-tip">${esc(s.tip || s.note)}</div>` : ''}
      ${big ? `<div class="tc-acts">
        ${s.where ? `<a class="btn" href="${esc(mapsHref(s))}" target="_blank" rel="noopener">Directions →</a>` : ''}
        <button class="btn pri" data-tc-done="${esc(s.id)}">${s.done ? 'Undo' : 'Done ✓'}</button>
      </div>` : `<button class="tc-mini" data-tc-done="${esc(s.id)}" aria-label="Mark done">${s.done ? '✓' : ''}</button>`}
    </div>
  </div>`;
}

export function html(todayISO) {
  const p = pick(todayISO);
  if (!p) return '';
  const { t, live, day } = p;
  const dayRec = (t.days || []).find(d => d.date === day);
  const stops = (dayRec?.items || []).slice().sort((a, b) => (a.t || '99').localeCompare(b.t || '99'));
  const now = stops.find(s => !s.done);
  const next = now ? stops[stops.indexOf(now) + 1] : null;
  const doneN = stops.filter(s => s.done).length;
  const bring = t.bring || [];
  const away = between(todayISO, t.from);

  const status = live
    ? (stops.length ? `${doneN} of ${stops.length} stops done` : 'Today')
    : `Starts ${away === 1 ? 'tomorrow' : `in ${away} days`} — here is the plan`;

  return `<section class="tripcard" id="tripcard">
    <div class="tc-head">
      <span class="tc-eyebrow">Trip</span>
      <h2>${esc(t.name)}</h2>
      <div class="tc-sub">${[t.with ? `with ${esc(t.with)}` : '', esc(status)].filter(Boolean).join(' · ')}</div>
      ${stops.length ? `<div class="tc-bar"><i style="width:${Math.round(doneN / stops.length * 100)}%"></i></div>` : ''}
    </div>

    ${t.meet && (!live || doneN === 0) ? `<div class="tc-meet"><b>Meet:</b> ${esc(t.meet)}</div>` : ''}

    ${!stops.length ? `<div class="tc-empty">No stops planned for this day yet.</div>`
      : now ? `<div class="tc-label">${live ? 'Now' : 'First stop'}</div>${stopBlock(now, true)}
               ${next ? `<div class="tc-label">Then</div>${stopBlock(next, false)}` : ''}`
      : `<div class="tc-empty">Every stop done. Good day out.</div>`}

    ${bring.length ? `<div class="tc-label">Bring</div>
      <div class="tc-bring">${bring.map((b, i) =>
        `<button class="tc-chip${b.done ? ' on' : ''}" data-tc-bring="${i}">${b.done ? '✓ ' : ''}${esc(b.x)}</button>`).join('')}</div>` : ''}

    ${(t.contacts || []).length ? `<div class="tc-label">Contacts</div>
      <div class="tc-bring">${t.contacts.map(c =>
        `<a class="tc-chip" href="tel:${esc(String(c.tel).replace(/\s+/g, ''))}" target="_blank">📞 ${esc(c.n)}</a>`).join('')}</div>` : ''}

    ${(t.tips || []).length ? `<div class="tc-label">Good to know</div>
      <ul class="tc-tips">${t.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}

    ${stops.length > 2 ? `<details class="tc-all"><summary>The whole plan · ${stops.length} stops</summary>
      ${stops.map(s => stopBlock(s, false)).join('')}</details>` : ''}
  </section>`;
}

/* Writes go through Āfāq's own store: re-read disk first so nothing it saved is lost. */
async function withTrip(tripId, fn) {
  const F = await import('../../afaq/js/store.js');
  const disk = RAW('afaq.v1'); if (disk) F.replace(disk);
  const t = F.trip(tripId); if (!t) return false;
  fn(t, F); F.save(); return true;
}

export function wire(root, todayISO, onChange) {
  const p = pick(todayISO); if (!p || !root) return;
  root.querySelectorAll('[data-tc-done]').forEach(b => b.onclick = async e => {
    e.preventDefault();
    await withTrip(p.t.id, (t, F) => F.toggleItem(t.id, p.day, b.dataset.tcDone));
    try { window.webkit?.messageHandlers?.diwan?.postMessage({ type: 'haptic' }); } catch { /* browser */ }
    onChange();
  });
  root.querySelectorAll('[data-tc-bring]').forEach(b => b.onclick = async () => {
    const i = +b.dataset.tcBring;
    await withTrip(p.t.id, t => { if (t.bring && t.bring[i]) t.bring[i].done = !t.bring[i].done; });
    onChange();
  });
}
