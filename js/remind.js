/* Dīwān — telling you when.
 *
 * Honest about what this can be, because the alternative is a promise it quietly breaks:
 * reminders fire **only while Dīwān is open in a tab**. Backgrounded is fine, closed is
 * not. Web Push needs a server to push from and there isn't one; the Notification
 * Triggers API would do it locally but exists only in Chromium behind a flag. The
 * alternative is routing your prayer times and your day through a server, which is not
 * worth it for a reminder. Sakina reached the same conclusion and says so too.
 *
 * One minute-resolution tick rather than a timer per task. A tab backgrounded for hours
 * wakes with its timers throttled and coalesced, so a chain of setTimeouts silently
 * collapses; re-deriving what is due from the clock on every tick survives that.
 *
 * Fired reminders are written down, so a reload does not re-fire the whole morning.
 */

const KEY = 'diwan.remind';
const FIRED = 'diwan.remind.fired';

const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

const DEFAULTS = {
  on: false,
  prayers: true,      // at each computed prayer time
  timed: true,        // wake, light, supplements, rituals — anything with an hour
  eveningSweep: 21,   // one nudge listing whatever is still open, or null
  session: true,      // rest finished — the one that reaches you mid-set
  quietFrom: 22,      // nothing after this hour…
  quietTo: 6,         // …until this one. A prayer is the exception; it is the one
                      // thing that legitimately falls at 06:17.
  maxPerHour: 6,      // six apps each with a good reason to interrupt you is how a
                      // notification layer gets muted permanently

  /* Sakina is built on a stated rule — no streaks, no scores, nothing that turns a gap
     into a failure — and this switch overrides it. Musaed asked for it explicitly on
     2026-08-22 after the conflict was put to him, so it ships on rather than off. It is
     a setting and not a hard-coded choice precisely so the decision stays reversible
     without a deploy. Off: prayers and mood are shown as state and never chased.
     On: an unmarked prayer is followed up and reads as outstanding. */
  sakinaFirm: true,
  followUpMins: 25    // how long after a prayer time before it is chased
};

export const settings = () => ({ ...DEFAULTS, ...(read(KEY) || {}) });
export const save = s => write(KEY, { ...settings(), ...s });

export function permission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}
export async function ask() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

const stamp = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function alreadyFired(id) {
  const seen = read(FIRED) || {};
  return typeof seen[id] === 'number';
}
function markFired(id) {
  const seen = read(FIRED) || {};
  const cutoff = Date.now() - 36 * 3600e3;         // yesterday's are no longer interesting
  const kept = Object.fromEntries(Object.entries(seen).filter(([, at]) => at > cutoff));
  kept[id] = Date.now();
  write(FIRED, kept);
}

/* Quiet hours and a ceiling, applied to everything except the two kinds that are
   worth waking for: a prayer at its time, and a rest timer you are standing over. */
const RATE = 'diwan.remind.rate';

function inQuiet(now = new Date()) {
  const s = settings(), h = now.getHours();
  if (s.quietFrom == null || s.quietTo == null) return false;
  return s.quietFrom > s.quietTo ? (h >= s.quietFrom || h < s.quietTo)
                                 : (h >= s.quietFrom && h < s.quietTo);
}
function underRate() {
  const cut = Date.now() - 3600e3;
  let hits = [];
  try { hits = (JSON.parse(localStorage.getItem(RATE) || '[]')).filter(t => t > cut); } catch { hits = []; }
  return { ok: hits.length < settings().maxPerHour, hits };
}
function noteRate(hits) {
  try { localStorage.setItem(RATE, JSON.stringify([...hits, Date.now()])); } catch { /* full */ }
}

function show(title, body, tag, { urgent = false } = {}) {
  if (permission() !== 'granted') return false;
  if (!urgent) {
    if (inQuiet()) return false;
    const r = underRate();
    if (!r.ok) return false;
    noteRate(r.hits);
  }
  try {
    new Notification(title, { body, tag, silent: false, renotify: true });
    return true;
  } catch { return false; }   // some browsers only allow this from a service worker
}

/**
 * Fire one now. Used by the session, where the moment is the whole point — a rest
 * timer that respects a rate limit is a rest timer that lies to you, so it is urgent.
 */
export function fire(title, body, tag) {
  if (!settings().on) return false;
  return show(title, body, tag || 'diwan', { urgent: tag === 'rest' });
}

/**
 * Fire in `seconds`. A backgrounded tab throttles setTimeout, so this is a best
 * effort backed by the minute tick and by the visibility check — late by a second
 * is fine, and the session panel is authoritative either way.
 */
const pending = new Map();
export function schedule(seconds, title, body, tag = 'rest') {
  clearTimeout(pending.get(tag));
  pending.set(tag, setTimeout(() => { pending.delete(tag); fire(title, body, tag); }, seconds * 1000));
}
export function unschedule(tag = 'rest') { clearTimeout(pending.get(tag)); pending.delete(tag); }

/**
 * The count on the app icon. Home-screen web apps on iOS support this, so the day's
 * shape is glanceable without opening anything.
 */
export function badge(n) {
  try {
    if (!navigator.setAppBadge) return;
    if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge?.();
  } catch { /* not installed, or unsupported */ }
}

/**
 * One pass. `getQueue` returns the current queue so this never works from a stale copy —
 * something ticked two minutes ago must not still be announced as due.
 */
export function tick(getQueue) {
  const s = settings();
  if (!s.on || permission() !== 'granted') return;

  const q = getQueue();
  if (!q) return;
  const now = Date.now();
  const today = stamp(new Date());
  const open = q.all.filter(t => !t.done);

  /* Anything whose moment has just passed. A two-minute window, so a tab that was
     asleep does not suddenly announce six things from this morning at once. */
  for (const t of open) {
    if (!t.at) continue;
    if (t.domain === 'prayer' ? !s.prayers : !s.timed) continue;
    const age = now - t.at.getTime();
    if (age < 0 || age > 2 * 60_000) continue;
    const id = `${t.key}:${today}`;
    if (alreadyFired(id)) continue;
    markFired(id);
    show(t.label, t.domain === 'prayer' ? 'It is time.' : (t.note || 'Due now'), id,
         { urgent: t.domain === 'prayer' });
  }

  /* Firm mode: chase a prayer still unmarked a while after its time. Off by default in
     spirit, on by choice here — see `sakinaFirm`. */
  if (s.sakinaFirm) {
    for (const t of open) {
      if (t.domain !== 'prayer' || !t.at || !s.prayers) continue;
      const age = now - t.at.getTime();
      const w = s.followUpMins * 60_000;
      if (age < w || age > w + 2 * 60_000) continue;
      const id = `${t.key}:followup:${today}`;
      if (alreadyFired(id)) continue;
      markFired(id);
      show(t.label, 'Still unmarked.', id, { urgent: true });
    }
  }

  /* One evening sweep of what is still open, rather than a notification per row. */
  if (s.eveningSweep != null && new Date().getHours() === s.eveningSweep) {
    const id = `sweep:${today}`;
    if (!alreadyFired(id)) {
      const left = open.filter(t => t.action);
      if (left.length) {
        markFired(id);
        show(`${left.length} still open`,
          left.slice(0, 4).map(t => t.label).join(', ') + (left.length > 4 ? '…' : ''), id);
      }
    }
  }
}

let timer = null;
/** Start the minute tick. Safe to call more than once. */
export function start(getQueue) {
  if (timer !== null) return;
  tick(getQueue);
  timer = setInterval(() => tick(getQueue), 60_000);
  /* A tab returning to the foreground may have missed ticks entirely. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick(getQueue);
  });
}

/* ── where you are ────────────────────────────────────────────────
   Prayer times are only as good as the coordinates. This writes into
   `sakina.place` — the same key Sakina reads — so setting it once here fixes
   both apps at the same time, which is what one origin is for. */
export function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('This browser will not share a location.'));
    navigator.geolocation.getCurrentPosition(
      p => {
        let place = {};
        try { place = JSON.parse(localStorage.getItem('sakina.place') || '{}'); } catch { /* fresh */ }
        const next = {
          method: 'MoonsightingCommittee', madhab: 'hanafi',   // sensible defaults, kept if already set
          ...place,
          latitude: +p.coords.latitude.toFixed(4),
          longitude: +p.coords.longitude.toFixed(4),
          label: `${p.coords.latitude.toFixed(3)}, ${p.coords.longitude.toFixed(3)}`
        };
        localStorage.setItem('sakina.place', JSON.stringify(next));
        res(next);
      },
      e => rej(new Error(
        e.code === 1 ? 'Location permission was refused. Prayer times will stay on the saved coordinates.'
        : e.code === 3 ? 'Timed out finding you. Try again with a clearer view of the sky.'
        : 'Could not get a location.')),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 10 * 60_000 }
    );
  });
}
