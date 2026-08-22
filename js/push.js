/* Dīwān — push, and the agenda that drives it.
 *
 * A static page cannot send itself a notification at 06:17. Something has to be awake.
 * That something is a Supabase Edge Function on pg_cron, and the interesting decision is
 * how little it is allowed to know.
 *
 * THE SERVER IS STUPID ON PURPOSE. The obvious design has it work out what is due —
 * which means a second copy of six apps' cadence logic living in Deno, drifting from the
 * browser copy inside a fortnight. Instead the browser, which already computes the whole
 * day, uploads a flat list of "say this at this moment". The function's entire job is to
 * find rows whose time has passed and send them. It never learns what a fortnightly
 * cadence is, and it never needs updating when an app changes its mind.
 *
 * The agenda is replaced wholesale on every upload, so ticking something off removes its
 * reminder rather than leaving a ghost to fire later.
 *
 * iOS, stated plainly: push works only for a web app added to the Home Screen. In a Safari
 * tab it will never arrive, whatever permission says. The UI checks and says so.
 */

import * as C from './cloud.js';
import { prayerTimes, PRAYER_LABEL } from './tasks.js';

/* Safe to publish — it identifies this app to the push service and grants nothing.
   Its private half lives only in Supabase's secrets. */
export const VAPID_PUBLIC = 'BGDlBM02D4-g1b3lOhPKmU-10w6JWb7-4CSuEuPjmJCCG5F8a-1HHa2zKrBnIUlT2I_yBksYWAggdFJILn1dt1Y';

const b64ToU8 = b64 => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

/** Installed to the Home Screen? On iOS this is the difference between push and nothing. */
export const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.platform || '') ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || ''));

export function supported() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  return true;
}

/** Why push cannot work here, in a sentence, or null if it can. */
export function blocker() {
  if (!supported()) return 'This browser has no push support.';
  if (isIOS() && !installed())
    return 'On iOS, push only reaches a web app added to the Home Screen — never a Safari tab. Share → Add to Home Screen, then open Dīwān from the icon and come back here.';
  if (Notification.permission === 'denied')
    return 'Notifications are blocked for this site. Allow them in the browser’s settings and reload.';
  if (!C.signedIn()) return 'Sign in first — a subscription belongs to an account.';
  return null;
}

export async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
export const subscribed = async () => !!(await current());

/** Ask, subscribe, and register the subscription against the account. */
export async function subscribe() {
  const why = blocker();
  if (why) throw new Error(why);

  if (Notification.permission !== 'granted') {
    const got = await Notification.requestPermission();
    if (got !== 'granted') throw new Error('Notifications were not allowed.');
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,                       // required; silent push is not allowed
      applicationServerKey: b64ToU8(VAPID_PUBLIC)
    });
  }
  await C.upsert('push_subs', [{
    endpoint: sub.endpoint,
    p256dh: keyOf(sub, 'p256dh'),
    auth: keyOf(sub, 'auth'),
    ua: navigator.userAgent.slice(0, 200)
  }], 'endpoint');
  return sub;
}

export async function unsubscribe() {
  const sub = await current();
  if (!sub) return;
  try { await C.del('push_subs', 'endpoint', sub.endpoint); } catch { /* gone already */ }
  await sub.unsubscribe();
}

const keyOf = (sub, name) => {
  const k = sub.getKey(name);
  return k ? btoa(String.fromCharCode(...new Uint8Array(k))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
};

/* ══════════════════════════════════════════════════════════════════
   The agenda
   ══════════════════════════════════════════════════════════════════ */

/**
 * Turn the day's queue into "say this at this moment" rows for the next 48 hours.
 * Everything here was decided by the app that owns the task; nothing is invented.
 */
export function buildAgenda(queue, settings) {
  const rows = [];
  const now = Date.now();
  const horizon = now + 48 * 3600e3;
  const s = settings || {};

  const quiet = at => {
    if (s.quietFrom == null || s.quietTo == null) return false;
    const h = at.getHours();
    return s.quietFrom > s.quietTo ? (h >= s.quietFrom || h < s.quietTo)
                                   : (h >= s.quietFrom && h < s.quietTo);
  };

  for (const t of queue.all) {
    if (t.done || !t.at) continue;
    const at = t.at.getTime();
    if (at < now - 60_000 || at > horizon) continue;
    const prayer = t.domain === 'prayer';
    if (prayer ? s.prayers === false : s.timed === false) continue;
    /* A prayer is the one thing that legitimately falls inside quiet hours. */
    if (!prayer && quiet(t.at)) continue;
    rows.push({
      at: t.at.toISOString(),
      title: t.label,
      body: prayer ? 'It is time.' : (t.brief || t.note || 'Due now'),
      url: t.startSession ? './#/' : (t.href && t.href.startsWith('http') ? inward(t) : './#/'),
      tag: t.key
    });
  }

  /* ── tomorrow, and the day after ──
     The queue only ever describes today, so an agenda built from it alone stops at
     midnight — and if Dīwān is not opened tomorrow morning, no prayer arrives. Prayer
     times are computable for any date without the queue, so the next two days are added
     directly. It means the phone keeps working for 48 hours with the app never opened,
     which is the entire point of push. */
  if (s.prayers !== false) {
    for (let d = 1; d <= 2; d++) {
      const day = new Date(); day.setDate(day.getDate() + d);
      const t = prayerTimes(day);
      if (!t) break;
      for (const [name, when] of Object.entries(t)) {
        const ms = when.getTime();
        if (ms < now || ms > horizon) continue;
        rows.push({
          at: when.toISOString(), title: PRAYER_LABEL[name] || name,
          body: 'It is time.', url: './#/in/sakina~prayer%2F', tag: `sakina:${name}`
        });
      }
    }
  }

  /* ── the morning digest ──
     Most of what each app raises has no hour of its own: a ritual block, a cabinet item
     running out, a weekly target going out of reach. Notifying each one separately is
     how a person mutes an app, so they arrive as one line at the start of the day with
     the deadlines named. The evening sweep closes the same loop from the other end. */
  if (s.morning != null) {
    for (let d = 0; d <= 1; d++) {
      const when = new Date(); when.setDate(when.getDate() + d);
      when.setHours(s.morning, 0, 0, 0);
      if (when.getTime() <= now || when.getTime() > horizon) continue;

      const open = queue.all.filter(t => !t.done && !t.isNote);
      if (!open.length) continue;

      /* Only today's digest may name anything. Tomorrow's is scheduled from today's
         queue, and by the time it fires half of it will be wrong — a list of things
         already done, and prayers that were yesterday's. A digest that names stale
         items is worse than one that names none. */
      if (d === 0) {
        /* Prayers are excluded from "out of road" deliberately. A passed prayer is not
           a deadline in this sense, framing it as one is the pressure Sakina exists to
           avoid, and firm mode already follows them up on their own. */
        const urgent = open
          .filter(t => t.domain !== 'prayer' && (t.over || (t.left != null && t.left <= 0)))
          .map(t => t.label).slice(0, 3);
        const first = open.find(t => t.at && t.at.getTime() > when.getTime());
        rows.push({
          at: when.toISOString(),
          title: `${open.length} today`,
          body: urgent.length ? `Out of road today: ${urgent.join(', ')}.`
                              : `First up: ${first ? first.label : 'nothing timed'}.`,
          url: './#/', tag: `morning:${when.toISOString().slice(0, 10)}`
        });
      } else {
        rows.push({
          at: when.toISOString(), title: 'Today',
          body: 'Your list is ready.', url: './#/',
          tag: `morning:${when.toISOString().slice(0, 10)}`
        });
      }
    }
  }

  /* One sweep rather than a notification per remaining row. */
  if (s.eveningSweep != null) {
    const sweep = new Date(); sweep.setHours(s.eveningSweep, 0, 0, 0);
    if (sweep.getTime() > now) {
      const open = queue.all.filter(x => !x.done && x.action).length;
      if (open) rows.push({
        at: sweep.toISOString(), title: `${open} still open`,
        body: queue.all.filter(x => !x.done && x.action).slice(0, 4).map(x => x.label).join(', '),
        url: './#/', tag: 'sweep'
      });
    }
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/* An app's absolute URL becomes a Dīwān route that mounts it, so a tap lands inside
   the hub rather than orphaning you in a bare app with no way back. */
function inward(t) {
  const base = { compound: 'compound', jamal: 'jamal', anbiq: 'anbiq',
                 sakina: 'sakina', gc: 'charisma-gym', afaq: 'afaq' }[t.app];
  if (!base) return './#/';
  const m = t.href.match(/^https?:\/\/[^/]+\/[^/]+\/(.*)$/);
  const tail = m && m[1] ? '~' + encodeURIComponent(m[1]) : '';
  return `./#/in/${t.app}${tail}`;
}

/**
 * Replace the stored agenda with this one.
 *
 * `manual:` rows are left alone. The agenda is rebuilt on nearly every render, and the
 * first version of this wiped the whole table each time — which quietly deleted a test
 * notification a few seconds after it was queued, so the test could never fire and
 * looked like a broken push chain rather than a broken clear.
 */
export async function pushAgenda(rows) {
  if (!C.signedIn()) return { ok: false };
  await C.clear('agenda', 'manual:');
  if (rows.length) await C.upsert('agenda', rows, 'user_id,tag,at');
  return { ok: true, n: rows.length };
}

/** The SQL the project needs for push. Shown in the UI to copy. */
export const PUSH_SQL = `-- Dīwān — push. Run once, after the records table.

create table if not exists public.push_subs (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text primary key,
  p256dh   text not null,
  auth     text not null,
  ua       text,
  created  timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own subs" on public.push_subs;
create policy "own subs" on public.push_subs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.agenda (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  tag     text not null,
  at      timestamptz not null,
  title   text not null,
  body    text,
  url     text,
  sent_at timestamptz,
  primary key (user_id, tag, at)
);
create index if not exists agenda_due on public.agenda (at) where sent_at is null;
alter table public.agenda enable row level security;
drop policy if exists "own agenda" on public.agenda;
create policy "own agenda" on public.agenda for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Every minute, ask the function whether anything is due. pg_cron cannot sign a
-- VAPID token, which is the whole reason an Edge Function exists at all.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('diwan-push') where exists
  (select 1 from cron.job where jobname = 'diwan-push');

select cron.schedule('diwan-push', '* * * * *', $$
  select net.http_post(
    url := current_setting('app.push_fn_url', true),
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization', 'Bearer ' || current_setting('app.push_fn_key', true))
  );
$$);`;
