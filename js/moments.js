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

/* ── the day's slots, mapped to HIS routine, not to a clock ──
   He described the day himself: morning practice block, breakfast, gym at
   five, hobby off the back of the gym trip, the reclaimed reading hour at
   eight, journal, affirmations, sleep. Each slot below is a mood in that
   arc, and the kind of push each mood can actually receive:

     07:05  rising        — dhikr; the day opens on remembrance
     08:55  post-practice — an identity line; who today is being done as
     11:10  mid-morning   — a claim from the lab; the mind is sharpest
     13:40  after Dhuhr   — a word upgrade; light, playful
     16:20  pre-gym       — a training truth; fuel for the hour ahead
     18:40  post-gym      — the hobby push; he is out, dressed, moving
     20:05  reading hour  — something to watch after, or his own track line
     21:40  winding down  — somewhere to go; let the horizon in before sleep */
const SLOTS = [7.08, 8.92, 11.17, 13.67, 16.33, 18.67, 20.08, 21.67];

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

/* ── the presence deck ──
   While a trip is live the pushes change register entirely. A year of
   optimisation earns six days of presence; the machine that says "go, do,
   improve" all year is the same machine that must know when to say "be here".
   Family first, itinerary second, phone last. */
const PRESENCE = [
  { t: '⚘ People, not places', b: 'One photo of your family today, not the scenery. The fog is in everyone\u2019s photos; your mother laughing inside it will be only in yours.' },
  { t: '⚘ Ask the eldest', b: 'Ask the oldest person at the table what this place was like the first time they saw it. Then just listen.' },
  { t: '⚘ The itinerary serves', b: 'If everyone is happy at the pool, the wadi can wait for another year. The plan is a servant, not a debt.' },
  { t: '⚘ Buy the coconut', b: 'Buy the coconut. Overpay a little. Generosity on a holiday is remembered for decades; the dinar is not.' },
  { t: '⚘ Ten unnarrated minutes', b: 'Sit in the fog for ten minutes without filming it, describing it, or improving it. Let it just be weather.' },
  { t: '⚘ A Maghrib to keep', b: 'Pray Maghrib somewhere you will want to remember having prayed. That is the photograph that lasts.' },
  { t: '⚘ Someone else\u2019s day', b: 'Let someone else choose today\u2019s plan — and go along with your whole heart, not half of it.' },
  { t: '⚘ Trade one story', b: 'Tell one story from your childhood at dinner tonight. Ask for one back. This is what the table is for.' },
  { t: '⚘ The ten-year-old', b: 'Do one thing today that your ten-year-old self would have loved. He is still in there, and he is on holiday too.' },
  { t: '⚘ Easy to be with', b: '\u062e\u064a\u0631\u0643\u0645 \u062e\u064a\u0631\u0643\u0645 \u0644\u0623\u0647\u0644\u0647 \u2014 the best of you is the best to his family. Today, be the reason the trip is easy.' },
];

const liveTrip = () => {
  try {
    const t = new Date(); const d = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    const af = JSON.parse(localStorage.getItem('afaq.v1') || 'null');
    return (af?.trips || []).find(x => x.from <= d && x.to >= d && x.status !== 'idea') || null;
  } catch { return null; }
};

export async function build(date) {
  const kinds = [];

  /* A live trip swaps the whole deck: dawn dhikr stays, everything else
     becomes presence. Deterministic draw without repeats across the day. */
  if (liveTrip()) {
    kinds.push(seed => {
      const d = pick(ADHKAR, seed);
      return { title: d.a, body: `${d.t} — ${d.src}`, url: APPS_URL + 'sakina/prayer/' };
    });
    const start = h32(date) % PRESENCE.length;
    for (let i = 0; i < SLOTS.length - 1; i++) {
      const card = PRESENCE[(start + i) % PRESENCE.length];
      kinds.push(() => ({ title: card.t, body: card.b, url: APPS_URL + 'afaq/#travel' }));
    }
    return assemble(date, kinds);
  }

  // 07:05 — rising: dhikr
  kinds.push(seed => {
    const d = pick(ADHKAR, seed);
    return { title: d.a, body: `${d.t} — ${d.src}`, url: APPS_URL + 'sakina/prayer/' };
  });

  // 08:55 — post-practice: an identity line, the day's X+1 stance
  kinds.push(seed => {
    const LINES = [
      'Today runs on X+1: find the script, take one small step past it. The lift, the till, the corridor.',
      'You are someone who asks the second question. One person today gets the real follow-up.',
      'Warmth first today — one stranger leaves lighter because they crossed you.',
      'Make the joke today. The one you usually hold. It was funny; holding it was the only mistake.',
      'Full attention is the rarest gift on earth. Give it once today, completely.',
    ];
    const l = pick(LINES, seed);
    return { title: 'Who today is being done as', body: l, url: APPS_URL + 'charisma-gym/#identity' };
  });

  // 11:10 — mid-morning: a claim from the lab, while the mind is sharpest
  kinds.push(seed => {
    try {
      const st = JSON.parse(localStorage.getItem('anbiq.v1') || 'null');
      const live = (st?.claims || []).filter(c => !c.dead && c.text && c.text.length < 200);
      const c = pick(live, seed);
      return c ? { title: 'From the lab', body: c.text, url: APPS_URL + 'anbiq/#claims' } : null;
    } catch { return null; }
  });

  // 13:40 — after Dhuhr: a word upgrade, light and playful
  kinds.push(async seed => {
    try {
      if (!window.VOICE_CONTENT) await import('../../charisma-gym/content-voice.js');
      const pairs = window.VOICE_CONTENT?.UPGRADES || [];
      const p = pick(pairs, seed);
      if (!p) return null;
      const strong = pick(p.strong, seed + ':s');
      return { title: `Retire \u201c${p.weak}\u201d`,
               body: `Reach for \u201c${strong}\u201d today. Vivid beats accurate for wit.`,
               url: APPS_URL + 'charisma-gym/#vocab' };
    } catch { return null; }
  });

  // 16:20 — pre-gym: a training truth as fuel, not trivia
  kinds.push(async seed => {
    try {
      const H = await import('../../compound/js/health.js');
      const items = H.ITEMS.filter(i => i.trap || i.why);
      const i = pick(items, seed);
      if (!i) return null;
      const text = (i.trap || i.why).replace(/<[^>]+>/g, '');
      return { title: `${i.ico || ''} ${i.name}`.trim(), body: text.slice(0, 170),
               url: APPS_URL + 'compound/#/?hx=' + i.id };
    } catch { return null; }
  });

  // 18:40 — post-gym: the hobby, while he is already out and moving
  kinds.push(seed => {
    const PUSHES = [
      'You are already out and dressed. Twenty minutes on the bike before home counts as a session.',
      'The gym is done — the hardest part of the hobby was leaving the house, and you already left.',
      'One drill on the way home. The ladder moves on evidence, not intention.',
    ];
    return { title: '✦ The hobby rides the gym trip', body: pick(PUSHES, seed),
             url: APPS_URL + 'afaq/#craft' };
  });

  // 20:05 — the reading hour: his own track line if one exists, else the screen
  kinds.push(async seed => {
    const own = await affirmationLine(seed);
    if (own) return own;
    try {
      const D = await import('../../afaq/js/data.js');
      const t = pick(D.CATALOGUE.filter(x => x.why), seed);
      return t ? { title: `\ud83c\udfac ${t.t}`, body: t.why.slice(0, 170), url: APPS_URL + 'afaq/#screen' } : null;
    } catch { return null; }
  });

  // 21:40 — winding down: let the horizon in
  kinds.push(async seed => {
    try {
      const D = await import('../../afaq/js/data.js');
      const d = pick(D.DESTS.filter(x => x.why), seed);
      return d ? { title: `\ud83e\udded ${d.n}`, body: d.why.slice(0, 170), url: APPS_URL + 'afaq/#travel' } : null;
    } catch { return null; }
  });

  return assemble(date, kinds);
}

async function assemble(date, kinds) {
  const out = [];
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
