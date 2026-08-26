/* Sīrah — the weekly chronicle.
 *
 * Every app in this house measures; none of them remembers in sentences. This
 * module is the register turning around at the end of each week and writing
 * down what actually happened — not a dashboard, a page of biography. The
 * week runs Saturday to Friday, because Friday is the hinge of his week, and
 * the page is frozen once written: history is not re-derived, it is kept.
 *
 * The prose is assembled from the same feed the queue reads. Phrasing varies
 * by a seed on the week so pages read as written, not generated — but every
 * number in them is real, and the closing line is chosen by what the week
 * actually was, including the one risk this whole system exists to fight:
 * intake without output.
 */

import * as D from './store.js';

const h32 = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const pickv = (arr, seed) => arr[h32(seed) % arr.length];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (k, n) => iso(new Date(new Date(k + 'T00:00').getTime() + n * 864e5));
const human = k => new Date(k + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

/* The Friday that closes the week containing `dateISO`. */
export function weekEnding(dateISO) {
  const d = new Date(dateISO + 'T00:00');
  const back = (d.getDay() - 5 + 7) % 7;      // days since the most recent Friday
  return shift(dateISO, -back);
}
export const lastClosedWeek = todayISO => {
  const w = weekEnding(todayISO);
  return w < todayISO ? w : shift(w, -7);     // a Friday still in progress is not closed
};
const span = fri => Array.from({ length: 7 }, (_, i) => shift(fri, i - 6));

/* ── the week's raw facts, from the same snapshot the queue reads ── */
function harvest(snap, fri) {
  const days = new Set(span(fri));
  const app = id => (snap.apps || []).find(a => a.id === id) || {};
  const feedOf = id => ((app(id).feed) || []).filter(f => days.has(f.d));

  const f = {};

  const sak = feedOf('sakina');
  f.prayerDays = new Set(sak.filter(x => /\/5 prayers/.test(x.text)).map(x => x.d)).size;
  f.prayerFull = sak.filter(x => /^5\/5 prayers/.test(x.text)).length;
  f.journal = sak.filter(x => x.text.startsWith('Journal')).length;
  const moods = sak.filter(x => x.text.startsWith('Mood'));
  f.moods = moods.length;
  f.moodsUp = moods.filter(x => x.text.includes('pleasant,') && !x.text.includes('unpleasant')).length;

  let practice = 0;
  try {
    for (const d of days) {
      const p = D.practiceOn(d) || {};
      practice += Object.values(p).filter(Boolean).length;
    }
  } catch { /* none recorded */ }
  f.practice = practice;

  const cmp = feedOf('compound');
  const sessions = cmp.filter(x => /— \d+ sets?$/.test(x.text));
  f.gym = sessions.length;
  f.gymNames = [...new Set(sessions.map(x => x.text.split(' — ')[0]))];
  f.healthDays = new Set(cmp.filter(x => /components? logged/.test(x.text)).map(x => x.d)).size;

  const anb = feedOf('anbiq');
  f.pages = anb.filter(x => /pp — /.test(x.text)).reduce((n, x) => n + (parseInt(x.text) || 0), 0);
  f.claims = anb.filter(x => x.text.startsWith('Claim:')).length;
  f.readDays = new Set(anb.filter(x => /pp — /.test(x.text)).map(x => x.d)).size;
  f.books = [...new Set(anb.filter(x => /pp — /.test(x.text)).map(x => x.text.split(' — ')[1]).filter(Boolean))];
  f.amal = 0;
  try {
    const a = JSON.parse(localStorage.getItem('anbiq.v1') || 'null');
    for (const b of (a?.books || []))
      f.amal += (b.amal || []).filter(x => days.has(x.date)).length;
  } catch { /* older build */ }

  const gc = feedOf('gc');
  f.calls = gc.filter(x => x.text.startsWith('Call')).length;
  f.field = gc.filter(x => x.text.startsWith('Field')).length;
  const scores = gc.map(x => (x.text.match(/— (\d+)\/100/) || [])[1]).filter(Boolean).map(Number);
  f.bestCall = scores.length ? Math.max(...scores) : null;

  f.jamalDays = new Set(feedOf('jamal').map(x => x.d)).size;

  const af = feedOf('afaq');
  f.watched = af.filter(x => x.text.startsWith('Watched')).length;
  f.craftMins = af.filter(x => /min of practice/.test(x.text)).reduce((n, x) => n + (parseInt(x.text) || 0), 0);
  f.trip = null;
  try {
    const a = JSON.parse(localStorage.getItem('afaq.v1') || 'null');
    f.trip = (a?.trips || []).find(t => t.status !== 'idea' && t.from <= fri && t.to >= shift(fri, -6))?.name || null;
  } catch { /* absent */ }

  return f;
}

/* ── the facts, written down ── */
function compose(f, fri, prev) {
  const P = [];
  const wk = 'w' + fri;
  const start = human(shift(fri, -6));

  /* opening */
  if (f.trip) {
    P.push(pickv([
      `The week that began on ${start} was not an ordinary one: it held ${f.trip}. Weeks like this are why the ordinary ones are kept in order.`,
      `A travelling week — ${f.trip} — begun on ${start}. The register stood down for it, as it should, and what follows is what still got kept.`,
    ], wk + 'open'));
  } else {
    const load = f.gym + f.readDays + f.prayerDays;
    P.push(pickv([
      `The week that began on ${start}, written down before it fades.`,
      `Another seven days on the books, from ${start}. Here is what they actually held.`,
      load >= 12 ? `A full week, begun on ${start} — the kind the whole apparatus exists to produce.` : `The week from ${start}, recorded honestly.`,
    ], wk + 'open'));
  }

  /* the spine — prayer and practice */
  if (f.prayerDays || f.practice) {
    const bits = [];
    if (f.prayerDays) bits.push(`prayer was marked on ${f.prayerDays} of the seven days${f.prayerFull ? `, ${f.prayerFull} of them complete at five` : ''}`);
    if (f.practice) bits.push(`the practices — Duha, Witr, the dhikr of the day — were kept ${f.practice} time${f.practice === 1 ? '' : 's'}`);
    P.push(`The spine first: ${bits.join('; ')}. ` + pickv([
      'Everything else in this page stands on that.',
      'The order of the hierarchy is the order of this page.',
      'That is the load-bearing wall; the rest is rooms.',
    ], wk + 'spine'));
  }

  /* the body */
  if (f.gym || f.healthDays) {
    const bits = [];
    if (f.gym) bits.push(`${f.gym} session${f.gym === 1 ? '' : 's'} under the bar${f.gymNames.length ? ` (${f.gymNames.join(', ')})` : ''}`);
    if (f.healthDays) bits.push(`the health stack logged on ${f.healthDays} day${f.healthDays === 1 ? '' : 's'}`);
    P.push(`The body: ${bits.join(', and ')}.` + (prev && prev.gym != null && f.gym !== prev.gym
      ? ` Last week held ${prev.gym}; this one ${f.gym > prev.gym ? 'held more' : 'held fewer'}, and the direction is the story.`
      : ''));
  }

  /* the mind — with the founding risk named when it shows */
  if (f.pages || f.claims || f.amal) {
    let mind = `The mind: ${f.pages} page${f.pages === 1 ? '' : 's'} read across ${f.readDays} day${f.readDays === 1 ? '' : 's'}${f.books.length ? ` of ${f.books.join(' and ')}` : ''}`;
    if (f.claims) mind += `, ${f.claims} claim${f.claims === 1 ? '' : 's'} extracted`;
    if (f.amal) mind += `, and — the part that counts — ${f.amal} transmutation${f.amal === 1 ? '' : 's'} sealed: reading that became record`;
    mind += '.';
    if (f.pages > 30 && !f.amal && !f.claims) {
      mind += ' All of it intake, none of it yet output — which is the one failure this house was built against. Named here so it is seen.';
    }
    P.push(mind);
  }

  /* the tongue and the face */
  if (f.calls || f.field || f.jamalDays) {
    const bits = [];
    if (f.calls) bits.push(`${f.calls} call${f.calls === 1 ? '' : 's'} in the gym of talk${f.bestCall ? `, the best of them scoring ${f.bestCall}` : ''}`);
    if (f.field) bits.push(`${f.field} real-world rep${f.field === 1 ? '' : 's'} logged from the field`);
    if (f.jamalDays) bits.push(`the grooming rituals kept on ${f.jamalDays} day${f.jamalDays === 1 ? '' : 's'}`);
    P.push(`The presentation of the man: ${bits.join('; ')}.`);
  }

  /* the rest of life */
  if (f.watched || f.craftMins || f.journal || f.moods) {
    const bits = [];
    if (f.watched) bits.push(`${f.watched} thing${f.watched === 1 ? '' : 's'} watched and rated`);
    if (f.craftMins) bits.push(`${f.craftMins} minutes at the craft`);
    if (f.journal) bits.push(`${f.journal} page${f.journal === 1 ? '' : 's'} of journal`);
    if (f.moods) bits.push(`${f.moods} mood${f.moods === 1 ? '' : 's'} taken${f.moodsUp ? `, ${f.moodsUp} of them pleasant` : ''}`);
    P.push(`And the life around the work: ${bits.join('; ')}.`);
  }

  /* closing */
  const total = f.prayerDays + f.gym + f.readDays + f.calls + f.jamalDays + f.journal;
  if (f.trip) {
    P.push('May the days away have been full of the things no register can hold.');
  } else if (total >= 15) {
    P.push(pickv([
      'A week to be quietly proud of. أدومها وإن قلّ — and this one was not small.',
      'Kept, all of it, without drama. That is what the constant weeks look like from inside.',
    ], wk + 'close'));
  } else if (total >= 6) {
    P.push(pickv([
      'An honest middle week. The frame held where it mattered; the rest is next week’s work.',
      'Some rooms of the week were furnished and some stood empty. The wall held. Build on it.',
    ], wk + 'close'));
  } else {
    P.push(pickv([
      'A thin week, and this page will not pretend otherwise. But the mercy of a week is that another one starts tomorrow, from zero, owing nothing.',
      'Little was written this week because little was logged. Either the week was truly empty, or the register was not told — both are worth knowing.',
    ], wk + 'close'));
  }

  return P;
}

/* Build (and freeze) the page for the most recent closed week.
 * Returns { week, paras, fresh } — fresh=true if it was written just now. */
export function ensure(snap, todayISO) {
  const fri = lastClosedWeek(todayISO);
  const all = D.sirahAll();
  if (all[fri]) return { week: fri, paras: all[fri].paras, fresh: false };
  const f = harvest(snap, fri);
  const prevPage = all[shift(fri, -7)];
  const paras = compose(f, fri, prevPage ? prevPage.stats : null);
  D.putSirah(fri, { paras, stats: f, at: Date.now() });
  return { week: fri, paras, fresh: true };
}

/* A live, unfrozen preview of the week currently running. */
export function preview(snap, todayISO) {
  const fri = weekEnding(todayISO) >= todayISO ? weekEnding(todayISO) : shift(weekEnding(todayISO), 7);
  const f = harvest(snap, fri);
  return { week: fri, paras: compose(f, fri, null) };
}

export const archive = () => {
  const s = D.sirahAll();
  return Object.keys(s).sort().reverse().map(w => ({ week: w, paras: s[w].paras }));
};
