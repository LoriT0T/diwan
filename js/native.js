/* Dīwān — the native bridge.
 *
 * Inside the iOS app this page is the app: a WKWebView marked with
 * `window.DIWAN_NATIVE` before any script runs. Everything here is inert in a
 * normal browser — no handler, no work, no errors.
 *
 * The division of labour is strict. THE PAGE COMPUTES, NATIVE PRESENTS. The
 * queue is built here, by the same code that builds it everywhere, and handed
 * over as plain rows; the Swift side turns them into the Day Live Activity and
 * local notifications — the two things a web page cannot put on an iOS lock
 * screen. In the other direction the watch's morning arrives here and is
 * written through Compound's own store, so the app never invents a storage
 * shape and the data is identical to a hand-logged one, plus a note saying
 * where it came from.
 */

const handler = () => window.webkit?.messageHandlers?.diwan;
export const inApp = () => !!(window.DIWAN_NATIVE && handler());

/** A tick that lands should be felt. No-op outside the shell. */
export function haptic() {
  if (inApp()) { try { handler().postMessage({ type: 'haptic' }); } catch { } }
}

/** Hand the built queue to the lock screen. Called after every build and tick. */
export function publish(Q) {
  if (!inApp() || !Q) return;
  try {
    const items = Q.all.concat(Q.done || []).map(t => ({
      key: t.key, label: t.label, ico: t.ico || '◈', app: t.app,
      at: t.at ? t.at.toISOString() : null, done: !!t.done,
      /* `tickable` decides whether the lock screen offers a Done button at all.
         A journal, a protein count, a field entry — things a checkbox would
         fake — carry false and get no button. Full control never means fake
         logging. `hash` is the row's own deep link, so tapping a notification
         lands inside the task's app, not on a front page. */
      tickable: !!t.action,
      hash: t.href ? String(t.href) : null
    }));
    handler().postMessage({
      type: 'queue',
      date: new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10),
      items,
      done: (Q.done || []).length + Q.all.filter(t => t.done).length,
      total: items.length
    });
  } catch { /* a bridge failure must never take the page down */ }
}

/* ── the watch's morning ──────────────────────────────────────────
   Wake time fills Compound's Lever 01 only when nothing is logged yet — a
   hand-entered time always wins over a sensor. Zone 2 minutes tick the lever
   only past Compound's own bar for a session. The full payload is stashed for
   the pulse to read later. */
export function install(onChange) {
  if (!inApp()) return;
  window.diwanFromNative = async (msg) => {
    try {
      if (!msg) return;

      /* ── ticks from the lock screen ──
         Each key is performed through the task's own action — the same code
         path as tapping the row — and ACKed whether it succeeded or was moot
         (already done, task gone). Only an ACK removes it from the shell's
         queue, so a tick can never be lost to a mid-delivery crash; and a
         tick that cannot ever be fulfilled is dropped WITH its ACK rather
         than retried forever. */
      if (msg.type === 'ticks' && Array.isArray(msg.keys)) {
        const { queue } = window.__DIWAN_Q ? { queue: window.__DIWAN_Q } : { queue: null };
        const W = await import('./write.js');
        const acked = [];
        for (const key of msg.keys) {
          acked.push(key);
          const t = queue && queue.all.concat(queue.done || []).find(x => x.key === key);
          if (!t || t.done || !t.action) continue;      // moot — ack and move on
          try { const r = await W.perform(t.action); if (r.ok) t.done = true; } catch { }
        }
        handler().postMessage({ type: 'ack', keys: acked });
        if (onChange) onChange();
        return;
      }

      /* ── a native workout, reconciled into Compound ──
         Same ids on both sides (the native split was generated from data.js),
         so this is a merge rather than a translation. Per exercise, per set
         index: a done native set overwrites; an empty native slot never
         erases something logged on the web. */
      if (msg.type === 'sessions' && Array.isArray(msg.sessions)) {
        const S = await import('../../compound/js/store.js');
        let wrote = false;
        for (const ns of msg.sessions) {
          if (!ns || !ns.date || !ns.dayId) continue;
          const key = `${ns.date}|${ns.dayId}`;
          const cur = S.getSession(key) || { sets: {} };
          cur.sets ||= {};
          for (const [ex, rows] of Object.entries(ns.sets || {})) {
            const dst = (cur.sets[ex] ||= []);
            (rows || []).forEach((r, i) => {
              while (dst.length <= i) dst.push({ w: null, reps: null, rir: null, done: false });
              if (r && r.done) dst[i] = { w: r.w ?? null, reps: r.reps ?? null,
                                          rir: r.rir ?? null, done: true };
            });
          }
          if (ns.startedAt && !cur.startedAt) cur.startedAt = ns.startedAt;
          if (ns.finishedAt) cur.finishedAt = ns.finishedAt;
          S.saveSession(key, cur);
          wrote = true;
        }
        if (wrote && onChange) onChange();
        return;
      }

      if (msg.type !== 'health') return;
      const date = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      /* Into the hub's own store, one row per day — synced by the diwan shard,
         read by the pulse. A stash nobody reads is not data; a history is. */
      try {
        const D = await import('./store.js');
        D.recordHealth(date, msg);
      } catch { }

      const S = await import('../../compound/js/store.js');
      let wrote = false;
      if (msg.wake && /^\d{1,2}:\d{2}$/.test(msg.wake)) {
        const cur = S.getHEntry(date, 'wake');
        if (!cur || !cur.done) {
          S.setHEntry(date, 'wake', { done: true, v: { t: msg.wake, src: 'watch' } });
          wrote = true;
        }
      }
      if ((msg.aerobicMin || 0) >= 20) {
        const cur = S.getHEntry(date, 'zone2');
        if (!cur || !cur.done) {
          S.setHEntry(date, 'zone2', { done: true, v: { m: msg.aerobicMin, src: 'watch' } });
          wrote = true;
        }
      }
      if (wrote && onChange) onChange();
    } catch { /* the page carries on; the card in the Train tab still shows it */ }
  };
}
