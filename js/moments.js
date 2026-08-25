/* Dīwān — moments.
 *
 * Most notifications point at work. These ARE the work, one swallow at a
 * time: a dhikr, a line from his own affirmation track, a claim from the lab,
 * a word upgrade, a training truth, something to watch, somewhere to go. The
 * day's set is deterministic — seeded by the date — so a reopened app never
 * reshuffles what today already promised.
 *
 * Sourced from the apps' own data wherever the apps can be imported; the
 * adhkar are the one exception (Sakina's live inside its bundle), so a small
 * set is carried here with sources, the way Sakina itself would insist.
 */

const h32 = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = (arr, seed) => arr.length ? arr[h32(seed) % arr.length] : null;

const APPS_URL = 'https://lorit0t.github.io/';

/* Short, sourced, the kind said in a passing moment. */
const ADHKAR = [
  { a: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', t: 'SubhanAllahi wa bihamdih — a hundred times, and sins fall away like sea-foam.', src: 'Bukhari 6405' },
  { a: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ', t: 'La hawla wa la quwwata illa billah — a treasure from the treasures of Paradise.', src: 'Bukhari 4205' },
  { a: 'اللَّهُمَّ أَعِنِّي عَلَى ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ', t: 'O Allah, help me remember You, thank You, and worship You well.', src: 'Abu Dawud 1522' },
  { a: 'أَسْتَغْفِرُ اللَّهَ', t: 'Istighfar in a spare breath — the Prophet ﷺ sought forgiveness over seventy times a day.', src: 'Bukhari 6307' },
  { a: 'رَبِّ اشْرَحْ لِي صَدْرِي وَيَسِّرْ لِي أَمْرِي', t: 'My Lord, expand my chest for me and ease my task for me.', src: 'Qur’an 20:25–26' },
];

/* The day's slots, local hours. Spread across the gaps the task list leaves. */
const SLOTS = [10.5, 13.25, 16.5, 19.75, 21.5];

async function affirmationLine(seed) {
  /* His own track, speaking during the day. Newest affirmation track's script
     lines — the same words the night voice says, met once in daylight. */
  try {
    if (!indexedDB.databases) return null;
    const dbs = await indexedDB.databases();
    if (!dbs.some(d => d.name === 'sakina')) return null;
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('sakina'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    try {
      if (!db.objectStoreNames.contains('tracks')) return null;
      const tracks = await new Promise((res, rej) => {
        const tx = db.transaction('tracks').objectStore('tracks').getAll();
        tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
      });
      const aff = tracks.filter(t => (t.settings?.kind ?? 'affirmation') === 'affirmation' && t.script?.lines?.length)
                        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!aff) return null;
      const lines = aff.script.lines.filter(l => l.section === 'core' && l.text.length < 90);
      const l = pick(lines, seed);
      return l ? { title: 'From your own track', body: l.text, url: APPS_URL + 'sakina/library/' } : null;
    } finally { db.close(); }
  } catch { return null; }
}

export async function build(date) {
  const out = [];
  const kinds = [];

  // dhikr — always present, always first of the day
  kinds.push(seed => {
    const d = pick(ADHKAR, seed);
    return { title: d.a, body: `${d.t} — ${d.src}`, url: APPS_URL + 'sakina/prayer/' };
  });

  // a claim from the lab
  kinds.push(seed => {
    try {
      const st = JSON.parse(localStorage.getItem('anbiq.v1') || 'null');
      const live = (st?.claims || []).filter(c => !c.dead && c.text && c.text.length < 200);
      const c = pick(live, seed);
      return c ? { title: 'From the lab', body: c.text, url: APPS_URL + 'anbiq/#claims' } : null;
    } catch { return null; }
  });

  // a word upgrade from the gym (classic script: it hangs its content on window)
  kinds.push(async seed => {
    try {
      if (!window.VOICE_CONTENT) await import('../../charisma-gym/content-voice.js');
      const pairs = window.VOICE_CONTENT?.UPGRADES || [];
      const p = pick(pairs, seed);
      if (!p) return null;
      const strong = pick(p.strong, seed + ':s');
      return { title: `Retire “${p.weak}”`,
               body: `Reach for “${strong}” today. Vivid beats accurate for wit.`,
               url: APPS_URL + 'charisma-gym/#vocab' };
    } catch { return null; }
  });

  // a training truth from Compound — the why or the trap, which is the useful half
  kinds.push(async seed => {
    try {
      const H = await import('../../compound/js/health.js');
      const items = H.ITEMS.filter(i => i.trap || i.why);
      const i = pick(items, seed);
      if (!i) return null;
      const text = (i.trap || i.why).replace(/<[^>]+>/g, '');
      return { title: `${i.ico || ''} ${i.name}`.trim(), body: text.slice(0, 170), url: APPS_URL + 'compound/#/?hx=' + i.id };
    } catch { return null; }
  });

  // something to watch, or somewhere to go — alternating days
  kinds.push(async seed => {
    try {
      const D = await import('../../afaq/js/data.js');
      if (h32(date) % 2 === 0) {
        const t = pick(D.CATALOGUE.filter(x => x.why), seed);
        return t ? { title: `🎬 ${t.t}`, body: t.why.slice(0, 170), url: APPS_URL + 'afaq/#screen' } : null;
      }
      const d = pick(D.DESTS.filter(x => x.why), seed);
      return d ? { title: `🧭 ${d.n}`, body: d.why.slice(0, 170), url: APPS_URL + 'afaq/#travel' } : null;
    } catch { return null; }
  });

  // his own affirmations, in daylight — replaces the lab slot on days it exists? No: gets slot 5.
  kinds.push(seed => affirmationLine(seed));

  const chosen = kinds.slice(0, SLOTS.length + 1);
  let slot = 0;
  for (let k = 0; k < chosen.length && slot < SLOTS.length; k++) {
    const seed = `${date}:${k}`;
    let m = chosen[k](seed);
    if (m && typeof m.then === 'function') m = await m;
    if (!m) continue;
    const at = new Date(date + 'T00:00');
    at.setHours(Math.floor(SLOTS[slot]), Math.round((SLOTS[slot] % 1) * 60), 0, 0);
    out.push({ id: `moment.${date}.${slot}`, at: at.toISOString(), title: m.title, body: m.body, url: m.url });
    slot++;
  }
  return out;
}
