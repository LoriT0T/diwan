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

/** Hand the built queue to the lock screen. Called after every build and tick. */
export function publish(Q) {
  if (!inApp() || !Q) return;
  try {
    const items = Q.all.concat(Q.done || []).map(t => ({
      key: t.key, label: t.label, ico: t.ico || '◈', app: t.app,
      at: t.at ? t.at.toISOString() : null, done: !!t.done
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
      if (!msg || msg.type !== 'health') return;
      const date = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      try { localStorage.setItem('diwan.health', JSON.stringify({ ...msg, date, at: Date.now() })); } catch {}

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
