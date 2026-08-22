/* Dīwān — the sender.
 *
 * The only thing in this system that is awake when nothing is open. Runs every minute
 * from pg_cron and does exactly one job: find agenda rows whose moment has passed and
 * has not been sent, and push them.
 *
 * It knows nothing about cadences, prayer calculation, rituals or reps, and that is the
 * design rather than an omission. The browser computes the day — it already imports all
 * six apps' own logic to do so — and uploads a flat list of "say this at this moment".
 * Teaching this function to work any of that out would put a second copy of six apps'
 * rules in Deno, where it would drift from the first inside a fortnight.
 *
 * Web Push is implemented here directly rather than pulled from a library: it is a VAPID
 * JWT, an ECDH key agreement, HKDF and one AES-GCM seal. All of it is in Deno's standard
 * WebCrypto, and a dependency for this would be more code to trust, not less.
 *
 * Secrets, set on the function (never in the repo):
 *   VAPID_PRIVATE_KEY   the private half of the keypair in js/push.js
 *   VAPID_SUBJECT       mailto: address, required by the push services
 *   SB_URL / SB_SERVICE_KEY   to read the agenda across accounts
 */

const enc = new TextEncoder();

const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};
const cat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};

/* ---- VAPID: a short-lived ES256 JWT proving who is sending ---- */
async function vapidHeader(audience: string, subject: string, privateD: string) {
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: privateD, x: '', y: '', ext: true };
  /* The public half is recoverable from the stored public key; simpler to import the
     private scalar together with the public point we already publish. */
  const pub = unb64u(Deno.env.get('VAPID_PUBLIC_KEY') ?? '');
  jwk.x = b64u(pub.slice(1, 33));
  jwk.y = b64u(pub.slice(33, 65));

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({
    aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${body}`));
  return { jwt: `${header}.${body}.${b64u(sig)}`, pub: b64u(pub) };
}

/* ---- aes128gcm payload encryption (RFC 8291) ---- */
async function encrypt(payload: string, p256dh: string, auth: string) {
  const uaPub = unb64u(p256dh);
  const authSecret = unb64u(auth);

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
  };

  const prkInfo = cat(enc.encode('WebPush: info\0'), uaPub, localPubRaw);
  const ikm = await hkdf(authSecret, shared, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = cat(enc.encode(payload), new Uint8Array([2]));   // padding delimiter
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, body));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return cat(salt, rs, new Uint8Array([localPubRaw.length]), localPubRaw, sealed);
}

async function send(sub: { endpoint: string; p256dh: string; auth: string }, payload: unknown) {
  const url = new URL(sub.endpoint);
  const { jwt, pub } = await vapidHeader(
    url.origin,
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  );
  const body = await encrypt(JSON.stringify(payload), sub.p256dh, sub.auth);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwt}, k=${pub}`
    },
    body
  });
}

/* ---- the run ---- */
Deno.serve(async () => {
  const SB = Deno.env.get('SB_URL')!;
  const KEY = Deno.env.get('SB_SERVICE_KEY')!;
  const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  /* Anything due in the last ten minutes and not yet sent. The window means a function
     that missed a run catches up, and an agenda row from this morning does not ambush
     you at midnight. */
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const now = new Date().toISOString();
  const due = await (await fetch(
    `${SB}/rest/v1/agenda?select=*&sent_at=is.null&at=lte.${now}&at=gte.${since}`, { headers: h }
  )).json();

  if (!Array.isArray(due) || !due.length) return Response.json({ sent: 0 });

  const byUser: Record<string, typeof due> = {};
  for (const r of due) (byUser[r.user_id] ||= []).push(r);

  let sent = 0, gone = 0;
  for (const [user, rows] of Object.entries(byUser)) {
    const subs = await (await fetch(
      `${SB}/rest/v1/push_subs?select=*&user_id=eq.${user}`, { headers: h }
    )).json();
    if (!Array.isArray(subs) || !subs.length) continue;

    for (const row of rows) {
      for (const s of subs) {
        try {
          const res = await send(s, { title: row.title, body: row.body, url: row.url, tag: row.tag });
          if (res.status === 404 || res.status === 410) {
            /* The subscription is dead — the browser was reinstalled or the app removed.
               Delete it rather than retrying it every minute forever. */
            await fetch(`${SB}/rest/v1/push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`,
              { method: 'DELETE', headers: h });
            gone++;
          } else if (res.ok) sent++;
        } catch { /* one bad endpoint must not stop the run */ }
      }
      await fetch(`${SB}/rest/v1/agenda?user_id=eq.${row.user_id}&tag=eq.${encodeURIComponent(row.tag)}&at=eq.${encodeURIComponent(row.at)}`,
        { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' },
          body: JSON.stringify({ sent_at: new Date().toISOString() }) });
    }
  }
  return Response.json({ sent, gone, due: due.length });
});
