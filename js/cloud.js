/* Dīwān — the cloud side.
 *
 * Supabase, spoken to over plain HTTP. Their JS client would work, but it is a
 * hundred-odd kilobytes of bundle for two endpoints, and this ecosystem has no build
 * step to hide that in. GoTrue and PostgREST are ordinary REST; `fetch` is enough.
 *
 * WHY THE KEY IN THIS PUBLIC REPO IS NOT A LEAK
 * The anon key is designed to be public — it identifies the project, it does not grant
 * anything. Every row is protected by Row Level Security enforced inside Postgres:
 *
 *   create policy "own rows" on records for all
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 *
 * With that policy, a request carrying only the anon key can read nothing and write
 * nothing. It has to also carry a signed JWT from a real sign-in, and then it can only
 * ever touch rows whose user_id matches that token. The database is the guard, not the
 * client, which is the only arrangement that survives the client being readable.
 *
 * The service_role key is the opposite — it bypasses RLS entirely. It must never appear
 * in this repo, in a browser, or in anything you paste into the app.
 */

const CFG_KEY = 'diwan.cloud';        // project url + anon key
const SESS_KEY = 'diwan.session';     // tokens

/* The project, wired in. Both of these are meant to be public: the URL names the
   project and the publishable key identifies it. Neither grants anything on its own —
   verified against this project, not merely assumed:
     read  with only this key → []        (no rows, no leak)
     write with only this key → 401 "new row violates row-level security policy"
   Pasting a different project in Data → Sync overrides these. */
const BUILT_IN = {
  url: 'https://mnoiiidzvtezuaxlnubr.supabase.co',
  anon: 'sb_publishable_TOmeyCO03pjpgmJO8moTHQ_j6piQ6c3'
};

const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export function config() {
  const saved = read(CFG_KEY);
  const c = { ...BUILT_IN, ...(saved || {}) };
  return c.url && c.anon ? c : null;
}
export function setConfig(url, anon) {
  url = String(url || '').trim().replace(/\/+$/, '');
  anon = String(anon || '').trim();
  /* Supabase-hosted is the normal case; a self-hosted instance or a local one is
     allowed too, since both speak the same REST. Anything else is a typo. */
  const ok = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)
    || /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url);
  if (!ok) {
    throw new Error('That does not look like a project URL. It should be https://<something>.supabase.co — copy it from Settings → API.');
  }
  if (anon.length < 30) throw new Error('That key looks too short. Copy the whole publishable key from Settings → API.');
  if (secretKey(anon)) {
    throw new Error('That is a secret key — it bypasses every security rule and must never go in a browser. Use the publishable one (sb_publishable_…) instead.');
  }
  write(CFG_KEY, { url, anon });
}
export function clearConfig() { localStorage.removeItem(CFG_KEY); }

/** Which project this build is talking to, for the status line. */
export const projectRef = () => {
  const c = config();
  const m = c && c.url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m ? m[1] : (c ? c.url : null);
};

/**
 * Refuse a key that bypasses Row Level Security, in both the shapes Supabase uses.
 * Getting this wrong once would put a key in a public repo that grants the whole
 * database to anyone who reads it, so it is checked rather than trusted.
 */
function secretKey(k) {
  if (/^sb_secret_/i.test(k)) return true;              // current format
  if (/service_role/i.test(k)) return true;             // pasted by name
  const parts = k.split('.');                            // legacy JWT: look inside it
  if (parts.length === 3) {
    try {
      const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (p && p.role && p.role !== 'anon') return true;
    } catch { /* not a JWT we can read — fall through */ }
  }
  return false;
}

/* ---------- session ---------- */
export const session = () => read(SESS_KEY);
export const signedIn = () => { const s = session(); return !!(s && s.access_token); };
export const email = () => (session() || {}).email || null;
function saveSession(j, mail) {
  write(SESS_KEY, {
    access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    email: mail || j.user?.email || null
  });
}
export function signOut() { localStorage.removeItem(SESS_KEY); }

/* ---------- plumbing ---------- */
async function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const c = config();
  if (!c) throw new Error('No Supabase project configured yet. Add it in Data → Sync.');
  const h = { apikey: c.anon, 'content-type': 'application/json', ...headers };
  if (auth) {
    const t = await validToken();
    if (!t) throw new Error('Signed out.');
    h.Authorization = `Bearer ${t}`;
  }
  let res;
  try {
    res = await fetch(c.url + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  } catch {
    /* Distinguish "no network" from "server said no" — they need different reactions. */
    throw new Error('Could not reach Supabase. Offline, or the project is paused — a free project sleeps after about a week idle and needs waking from the dashboard.');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.msg || data.message || data.error_description || data.error)) || res.statusText;
    const e = new Error(msg || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/** Refresh a little early rather than discovering expiry mid-sync. */
async function validToken() {
  const s = session();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60_000) return s.access_token;
  if (!s.refresh_token) { signOut(); return null; }
  try {
    const j = await call('/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', auth: false, body: { refresh_token: s.refresh_token } });
    saveSession(j, s.email);
    return j.access_token;
  } catch {
    signOut();
    return null;
  }
}

/* ---------- auth ---------- */
export async function signUp(mail, password) {
  const j = await call('/auth/v1/signup', { method: 'POST', auth: false, body: { email: mail, password } });
  /* With email confirmation on, signup returns a user but no session. Say so plainly
     rather than leaving a sign-in that silently did nothing. */
  if (!j.access_token) return { confirm: true };
  saveSession(j, mail);
  return { confirm: false };
}

export async function signIn(mail, password) {
  const j = await call('/auth/v1/token?grant_type=password',
    { method: 'POST', auth: false, body: { email: mail, password } });
  saveSession(j, mail);
  return true;
}

export async function whoami() {
  const j = await call('/auth/v1/user');
  return j && j.id ? { id: j.id, email: j.email } : null;
}

/* ---------- records ----------
   One table, one row per record. `user_id` is filled by a column default of
   auth.uid(), so the client never sends it and cannot spoof it. */

/** Everything changed since `since` (ISO string), oldest first, paged. */
export async function pull(since) {
  const out = [];
  const LIMIT = 1000;
  let from = 0;
  for (;;) {
    const q = new URLSearchParams({
      select: 'app,key,value,updated_at',
      order: 'updated_at.asc',
      limit: String(LIMIT),
      offset: String(from)
    });
    if (since) q.set('updated_at', `gt.${since}`);
    const page = await call('/rest/v1/records?' + q.toString());
    out.push(...(page || []));
    if (!page || page.length < LIMIT) break;
    from += LIMIT;
  }
  return out;
}

/** Upsert in batches. Postgres has a parameter ceiling and a request has a size one. */
export async function push(rows) {
  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    await call('/rest/v1/records?on_conflict=user_id,app,key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows.slice(i, i + BATCH)
    });
  }
  return rows.length;
}

/** Row count and newest timestamp, for the status line. */
export async function stat() {
  const c = config();
  const t = await validToken();
  const res = await fetch(c.url + '/rest/v1/records?select=updated_at&order=updated_at.desc&limit=1', {
    headers: { apikey: c.anon, Authorization: `Bearer ${t}`, Prefer: 'count=exact' }
  });
  const range = res.headers.get('content-range') || '';
  const total = Number((range.split('/')[1] || '0')) || 0;
  const rows = await res.json().catch(() => []);
  return { total, newest: rows[0]?.updated_at || null };
}

/** The SQL the project needs, shown in the UI so it can be copied verbatim. */
export const SCHEMA_SQL = `-- Dīwān — run once in the Supabase SQL editor.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  app        text        not null,
  key        text        not null,
  value      jsonb,                    -- null means deleted (a tombstone)
  updated_at timestamptz not null default now(),
  primary key (user_id, app, key)
);

-- Pulling "everything since X" is the only read this app makes.
create index if not exists records_since on public.records (user_id, updated_at);

alter table public.records enable row level security;

-- The whole security model. Without this the anon key would be a way in.
drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Let the server stamp the clock, so a device with a wrong date cannot poison ordering.
create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_updated_at();`;
