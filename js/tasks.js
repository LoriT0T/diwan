/* Dīwān — the day's queue.
 *
 * read.js produces a *report* per app: numbers, history, what each app's own engine
 * would say. This file produces the other thing — a single list of atomic, tickable
 * items, in the order the day actually happens, so the page can be worked from the top
 * down without deciding anything.
 *
 * Two orderings are in play and they are not the same:
 *
 *   · TIME decides the sequence. A wake time belongs at 07:00 and dimming the lights
 *     belongs at 22:00, and no amount of importance moves either of them.
 *   · TIER breaks ties among the things that have no time of their own.
 *
 * Prayer times are computed here with `adhan`, from the coordinates Sakina already
 * stores under `sakina.place` on this same origin — the same library, the same version,
 * the same settings, so the times on this page and the times in Sakina cannot disagree.
 *
 * A task is what an app DEFINES as due today, not what you have logged before. That
 * distinction was a bug once: the queue was gated on each app having history, so a
 * device that had never opened Compound showed no Compound work at all — when in fact
 * all twenty-five of its components were due, and being new is exactly when you most
 * need the list. History decides what is already ticked. It never decides what exists.
 *
 * What is deliberately NOT in the queue:
 *   · Compound's Situational band. Its own copy says these are "taken for a reason, not
 *     daily"; putting five of them in a daily tick list would turn a considered decision
 *     into a chore, which is the opposite of what that band is for.
 *   · Anything needing a real number — a page count, a set, a mood on two axes. Ticking
 *     those would write a fiction. They appear as links to the app that can take the
 *     value properly.
 */

import * as A from '../vendor/adhan.esm.min.js';
import { iso, shift, since } from './read.js';
import * as D from './store.js';

/* ── the clock ─────────────────────────────────────────────────────
   Nominal hours for the things that have a time of day but no exact one.
   Chosen from each app's own copy: Compound's morning light is "soon after
   waking", its caffeine curfew is an early-afternoon cutoff, dimming is the
   last hour before bed. */
const HOUR = {
  wake: 7.0, light: 8.0, caff: 14.0, dim: 22.0,
  fuel1: 8.5, fuel2: 13.0, fuel3: 18.0, fuel4: 22.0,
  workout: 17.0,
  jamalAm: 7.5, jamalPm: 21.5
};

const at = (h, date = new Date()) => {
  const d = new Date(date);
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  return d;
};

/* ── prayer times, from Sakina's own coordinates ──────────────────── */
const DEFAULT_PLACE = {
  latitude: 52.9225, longitude: -1.4746, label: 'Derby, UK',
  method: 'MoonsightingCommittee', madhab: 'hanafi'
};
export function place() {
  try {
    const raw = localStorage.getItem('sakina.place');
    return raw ? { ...DEFAULT_PLACE, ...JSON.parse(raw) } : DEFAULT_PLACE;
  } catch { return DEFAULT_PLACE; }
}
export function prayerTimes(date = new Date()) {
  const p = place();
  try {
    const params = A.CalculationMethod[p.method] ? A.CalculationMethod[p.method]() : A.CalculationMethod.MoonsightingCommittee();
    params.madhab = p.madhab === 'hanafi' ? A.Madhab.Hanafi : A.Madhab.Shafi;
    const pt = new A.PrayerTimes(new A.Coordinates(p.latitude, p.longitude), date, params);
    return { fajr: pt.fajr, dhuhr: pt.dhuhr, asr: pt.asr, maghrib: pt.maghrib, isha: pt.isha };
  } catch { return null; }
}

/* Read once per build rather than imported, so tasks.js keeps no dependency on the
   reminder module. */
const firmSakina = () => {
  try { return (JSON.parse(localStorage.getItem('diwan.remind') || '{}')).sakinaFirm !== false; }
  catch { return true; }
};

export const PRAYER_LABEL = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'ʿAsr', maghrib: 'Maghrib', isha: 'ʿIshāʾ' };
const PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/* ── word lists for the voice and text bar ─────────────────────────
   Plain keyword matching, not understanding. Kept close to how the thing is
   actually said out loud rather than to what the app calls it.

   Bare generic verbs are deliberately absent. "walk" used to sit under Zone 2
   and "walked the dog" logged a cardio session — a false tick is worse than a
   missed one, because a missed one you notice. Anything that could plausibly
   appear in a sentence about something else is either qualified ("brisk walk")
   or left out. */
const WORDS = {
  wake: ['woke', 'wake', 'awake', 'got up'],
  light: ['daylight', 'sunlight', 'outside', 'outdoors', 'morning light'],
  caff: ['caffeine', 'coffee', 'curfew', 'no coffee', 'cut off'],
  dim: ['dim', 'lights', 'dimmed', 'screens off', 'wind down'],
  multi: ['multivitamin', 'multi', 'vitamins'],
  d3: ['vitamin d', 'd3', 'vit d'],
  omega: ['omega', 'fish oil', 'omega 3', 'softgel'],
  mag: ['magnesium', 'mag'],
  brazil: ['brazil', 'brazil nut', 'nuts', 'selenium'],
  eggs: ['eggs', 'egg'],
  fish: ['fish', 'salmon', 'mackerel', 'sardines'],
  liver: ['liver'],
  fibre: ['fibre', 'fiber', 'psyllium'],
  zone2: ['zone 2', 'zone two', 'cardio', 'jog', 'cycle', 'brisk walk', 'easy run'],
  intervals: ['intervals', 'hiit', 'sprints', 'hard session'],
  sauna: ['sauna'],
  bfr: ['bfr', 'blood flow', 'occlusion'],
  bp: ['blood pressure', 'bp'],
  cooper: ['cooper', 'cooper test'],
  bloods: ['bloods', 'blood panel', 'blood test'],
  /* Jamāl */
  reset: ['trim', 'shave', 'shaved', 'trimmed'],
  shower: ['shower', 'showered', 'washed', 'wash'],
  mouth: ['teeth', 'brushed', 'mouth', 'floss', 'flossed'],
  prep: ['fit prep', 'clothes', 'outfit', 'ironed'],
  ready: ['face', 'skincare', 'got ready', 'moisturiser', 'moisturizer'],
  hairstyle: ['hair', 'styled', 'hairstyle'],
  scent: ['scent', 'fragrance', 'perfume', 'cologne', 'aftershave'],
  night: ['evening skin', 'night routine', 'night skin', 'adapalene', 'retinoid'],
  body: ['weekly groom', 'groom', 'grooming'],
  scalp: ['scalp', 'massage', 'scalp massage'],
  hairoil: ['hair oil', 'scalp oil', 'oiled'],
  keratin: ['keratin'],
  audit: ['audit', 'weekly audit'],
  sun: ['daylight', 'outside', 'sunlight'],   /* Jamāl's own daylight toggle */
  clean: ['no spike', 'clean eating', 'no sugar'],
  water: ['water', 'hydrated'],
  /* Sakina */
  fajr: ['fajr', 'fajir'], dhuhr: ['dhuhr', 'duhr', 'zuhr'], asr: ['asr'],
  maghrib: ['maghrib', 'magrib'], isha: ['isha', 'ishaa']
};
const w = (id, extra = []) => [...(WORDS[id] || []), ...extra];

/* Common phrasings that mean "the whole morning block" rather than one item. */
export const BUNDLES = [
  { words: ['my routine', 'the routine', 'morning routine', 'got ready'], match: t => t.app === 'jamal' && t.block === 'am' },
  { words: ['evening routine', 'night routine', 'bedtime routine'], match: t => t.app === 'jamal' && t.block === 'pm' },
  { words: ['my supplements', 'supplements', 'my pills', 'all my vitamins'], match: t => t.app === 'compound' && t.domain === 'fuel' }
];

const hash = str => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* ══════════════════════════════════════════════════════════════════
   SCHEDULING A CADENCE

   "Three times a week" is not a time, and an item that only ever says "0/3 this week"
   never prompts anything — it just sits there accusing you. So a cadence is turned into
   actual dated slots: three sessions a week become three specific days, each with an
   hour, each tickable, each counting down.

   The days are spread evenly and offset by a hash of the item id, so a 2×/week item and
   a 1×/week item do not both land on Monday and make one impossible day.

   Being behind is treated differently from being ahead. If fewer have been done than
   slots have passed, the item is due NOW — the week is running out and that is the fact
   worth surfacing. Otherwise it points at its next slot.
   ══════════════════════════════════════════════════════════════════ */
const DOMAIN_HOUR = { move: 17, fuel: 18, test: 11, sleep: 9, workout: 17 };

function weekSlots(id, n, mondayKey) {
  const off = hash(id) % 7;
  const days = [];
  for (let i = 0; i < n; i++) days.push(Math.round((i * 7) / n));
  /* Rotate by the hash so different items sit on different days, then sort so the
     week reads forwards. */
  return days.map(d => (d + off) % 7).sort((a, b) => a - b).map(d => shift(mondayKey, d));
}

/**
 * Where a periodic item stands today.
 * Returns { at, left, over, note } — `at` is a real Date when it wants doing today or
 * next, and null when its window is not open.
 */
function schedulePeriodic(i, S, date, hour) {
  const dow = (new Date(date + 'T00:00').getDay() + 6) % 7;      // Monday = 0
  const monday = shift(date, -dow);

  if (i.cad.t === 'w') {
    const slots = weekSlots(i.id, i.cad.n, monday);
    const done = S.weekCount(date, i.id);
    const elapsed = slots.filter(d => d <= date).length;
    const remaining = slots.filter(d => d > date).length;
    if (done >= i.cad.n) return { at: null, left: null, note: `${done}/${i.cad.n} this week — done` };
    if (done < elapsed) {
      /* Behind: it wanted doing on a day that has gone. Surface it now. */
      return { at: at(hour, new Date(date + 'T00:00')), left: remaining,
               over: remaining === 0,
               note: `${done}/${i.cad.n} this week · behind by ${elapsed - done}` };
    }
    const next = slots.find(d => d > date) || null;
    return {
      at: next === date ? at(hour, new Date(date + 'T00:00')) : null,
      nextDay: next, left: next ? between(date, next) : null,
      note: `${done}/${i.cad.n} this week` + (next ? ` · next ${new Date(next + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short' })}` : '')
    };
  }

  /* Fortnightly, monthly, quarterly — a real date derived from the last one done. */
  const span = i.cad.t === 'f' ? 14 : i.cad.t === 'm' ? 30 : 90;
  const word = i.cad.t === 'f' ? 'fortnight' : i.cad.t === 'm' ? 'month' : 'quarter';
  let last = null;
  for (let d = 0; d <= span * 2; d++) {
    const e = S.getHEntry(shift(date, -d), i.id);
    if (e && e.done) { last = d; break; }
  }
  if (last === null) return { at: at(hour, new Date(date + 'T00:00')), left: null, over: true,
                              note: `never logged · every ${word}` };
  const left = span - last;
  const dueDay = shift(date, left);
  return {
    at: left <= 0 ? at(hour, new Date(date + 'T00:00')) : null,
    nextDay: left > 0 ? dueDay : null, left, over: left < 0,
    note: `last ${last === 0 ? 'today' : last + 'd ago'} · every ${word}`
  };
}

/* ══════════════════════════════════════════════════════════════════
   Build
   ══════════════════════════════════════════════════════════════════ */
export async function buildQueue(snap) {
  const date = iso();
  const out = [];
  const byId = id => snap.apps.find(a => a.id === id);

  /* ── Compound ── */
  const comp = byId('compound');
  if (comp && comp.ok) {
    try {
      const [H, S, DATA] = await Promise.all([
        import('../../compound/js/health.js'),
        import('../../compound/js/store.js'),
        import('../../compound/js/data.js')
      ]);
      /* Morning light is "soon after waking" in Compound's own words, so it hangs off
         the wake time actually logged rather than a fixed hour. On a day with no wake
         time yet it falls back to the nominal one. */
      const wokeAt = (() => {
        const e = S.getHEntry(date, 'wake');
        const t = e && e.v && e.v.t;
        if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
        const [h, m] = t.split(':').map(Number);
        return h + m / 60;
      })();

      for (const i of H.live()) {
        if (i.dom === 'situ') continue;              // considered, not daily — see the header
        const done = H.satisfied(date, i);
        const daily = i.cad.t === 'd';
        let when = null;
        if (i.id === 'light' && wokeAt != null) when = at(Math.min(wokeAt + 1, 11));
        else if (i.dom === 'sleep') when = at(HOUR[i.id] ?? 9);
        else if (i.dom === 'fuel' && daily) when = at(HOUR['fuel' + (i.when || 2)] ?? HOUR.fuel2);
        /* A cadence becomes real dated slots rather than a running tally. */
        let sched = null;
        if (!daily) {
          sched = schedulePeriodic(i, S, date, DOMAIN_HOUR[i.dom] ?? 12);
          if (sched.at) when = sched.at;
        }

        out.push({
          key: 'compound:' + i.id, app: 'compound', label: i.name,
          note: (H.DOMAINS[i.dom] || {}).label || i.dom, domain: i.dom,
          brief: i.brief || '', at: when, slot: when ? null : 'any',
          done, tier: i.id === 'wake' ? 'foundation' : i.dom === 'test' ? 'reality' : 'due',
          ...(sched ? { cadence: sched.note, left: sched.left, over: sched.over,
                        nextDay: sched.nextDay } : { cadence: null }),
          /* A curfew warned about after it has passed is a reprimand, not a reminder,
             so the notification lands a quarter of an hour before the cutoff while the
             row itself stays at the cutoff, where it belongs in the day. */
          ...(i.id === 'caff' && when ? { notifyAt: new Date(when.getTime() - 15 * 60_000) } : {}),
          words: w(i.id, [i.name.toLowerCase()]),
          action: { kind: 'compound.h', date, id: i.id },
          href: comp.url
        });
      }
      /* Today's split, if there is one. Sets need real numbers, so this links out. */
      const dayId = (DATA.SCHEDULE.find(x => x.day === new Date().getDay()) || {}).workout;
      if (dayId) {
        const s = S.getSession(S.sessionKey(dayId, date));
        const n = s ? Object.values(s.sets || {}).flat().filter(r => r && r.done).length : 0;
        out.push({
          key: 'compound:workout', app: 'compound', label: `${dayId} — today's session`,
          note: 'Workout', domain: 'workout', brief: n ? `${n} sets logged` : 'Sets, reps, RIR and the rest timer — right here',
          at: at(HOUR.workout), done: n > 0, tier: 'due',
          words: ['workout', 'session', 'gym', 'trained', 'lifted', 'training'],
          /* Not a tick and not a link — a workout opens the live panel, which is the
             one place per-set entry and a wall-clock rest timer can actually live. */
          startSession: dayId,
          action: null, href: comp.url
        });
      }
    } catch { /* reader already reported it; queue simply omits Compound */ }
  }

  /* ── Jamāl ── */
  const jam = byId('jamal');
  if (jam && jam.ok) {
    try {
      const J = await import('../../jamal/js/data.js');
      const stored = JSON.parse(localStorage.getItem('jamal.v1') || 'null');
      /* Jamāl's rituals are due whether or not it has been opened here, but the hub
         will not create its storage from nothing — `set.start` is the baseline its
         adherence is measured from, and stamping it from this page would silently
         decide when the user "started". Until it exists, these carry you there. */
      const canTick = !!stored;
      const st = stored || {};
      st.done ||= {}; st.last ||= {}; st.inside ||= {};
      for (const r of J.RITUALS) {
        const n = dueIn(r, st, date);
        const done = !!(st.done[date] && st.done[date][r.id]);
        /* Every ritual is built, including the ones not due. The queue hides them,
           but the command bar can still see them — otherwise saying "scalp oil" on a
           day the oil treatment is not due falls through to the nearest weaker match
           and ticks the scalp massage instead. Better to be told it is not due. */
        const dormant = !done && (n === null || n > 0);
        const when = r.slot === 'am' ? at(HOUR.jamalAm) : r.slot === 'pm' ? at(HOUR.jamalPm) : null;
        out.push({
          key: 'jamal:' + r.id, app: 'jamal', label: r.name, note: 'Ritual',
          domain: 'ritual', mins: r.mins, block: r.slot,
          at: dormant ? null : when, slot: when ? null : 'any', done, dormant, tier: 'due',
          /* dueIn is already a day count: 0 is today, negative is that many days late. */
          left: dormant ? n : (n <= 0 ? n : null), over: !dormant && n < 0,
          cadence: (!dormant && n < 0) ? `${-n}d past its cadence` : null,
          brief: canTick ? (r.kicker || '') : 'Open Jamāl once and these become tickable here',
          words: w(r.id, [r.name.toLowerCase()]),
          action: canTick ? { kind: 'jamal.ritual', date, id: r.id } : null,
          href: jam.url + '#/rituals'
        });
      }

      /* ── The cabinet ──
         Thirteen consumables on real clocks — lenses to the day, a pillowcase every
         four while the skin is a live problem, a razor blade by uses rather than days.
         None of it was reaching the queue, which is exactly the kind of thing that gets
         missed: nothing prompts you, and the failure is slow. Only what is due or close
         is shown, otherwise thirteen rows drown the day. */
      for (const c of (J.CABINET || [])) {
        const rec = (st.cab || {})[c.id] || {};
        let left = null, due = false, why = '';
        if (c.days) {
          if (rec.last) {
            left = c.days - (Math.round((new Date(date + 'T00:00') - new Date(rec.last + 'T00:00')) / 864e5));
            due = left <= 0;
            why = `every ${c.days} day${c.days === 1 ? '' : 's'}`;
          } else {
            /* Never marked. Do not open a fresh install with thirteen overdue items —
               the same reason Jamāl's own dueIn refuses a day-one backlog. */
            continue;
          }
        }
        if (c.uses) {
          const u = rec.uses || 0;
          if (u >= c.uses) { due = true; why = `${u} uses`; if (left == null) left = 0; }
          else if (!c.days) continue;
        }
        /* Three days is right for a pillowcase and wrong for a haircut — one is a
           drawer away and the other needs an appointment. Compound's own copy for it
           is "book before you need it". */
        const lead = (c.days || 0) >= 30 ? 7 : 3;
        if (!due && (left == null || left > lead)) continue;
        out.push({
          key: 'jamal:cab:' + c.id, app: 'jamal', label: c.name, note: 'Replace · ' + (c.cat || ''),
          domain: 'cabinet', brief: c.note || '',
          at: null, slot: 'any', done: false, tier: 'due',
          left, over: left != null && left < 0, cadence: why,
          words: [c.name.toLowerCase()],
          action: canTick ? { kind: 'jamal.cab', id: c.id } : null,
          href: jam.url + '#/log'
        });
      }

      /* ── The daily skin rating ──
         Five concerns on a 0–4 scale. It needs a number per concern, so it carries you
         to the app rather than pretending a tick rated anything. It is the input the
         sparklines and the one honest correlation are both computed from, so a day
         unrated is a day that page cannot use. */
      if ((J.CONCERNS || []).length && !(st.sev || {})[date]) {
        out.push({
          key: 'jamal:sev', app: 'jamal', label: 'Rate your skin', note: 'Skin',
          domain: 'severity', brief: `${J.CONCERNS.length} fronts, 0–4 each — this is what the trend is drawn from`,
          at: null, slot: 'any', done: false, tier: 'due', daily: true,
          words: ['skin', 'rate', 'rating', 'severity'],
          action: null, href: jam.url + '#/skin', cta: 'Rate them'
        });
      }
      /* Inside metrics: only the toggles. A count wants a real number. */
      const supp = new Set((jam.suppressed || []).map(s => s.label));
      const covered = snap.covered || {};
      for (const m of J.INSIDE) {
        const shadow = { sleep: 'compound', train: 'compound', protein: 'compound', salah: 'sakina', calm: 'sakina' }[m.id];
        if (shadow && covered[shadow]) continue;           // owned next door, already answered
        if (st.inside[date] && st.inside[date][m.id] != null) continue;
        const tog = m.type === 'tog';
        out.push({
          key: 'jamal:in:' + m.id, app: 'jamal', label: m.lbl, note: 'Inside',
          domain: 'inside', brief: tog ? '' : `Needs a number — ${m.unit || ''}`.trim(),
          at: null, slot: 'any', done: false, tier: 'due',
          words: w(m.id, [m.lbl.toLowerCase()]),
          action: (tog && canTick) ? { kind: 'jamal.inside', date, id: m.id, value: 1 } : null,
          href: jam.url
        });
      }
    } catch { /* omitted */ }
  }

  /* ── Sakina: the day's five, at their real times ── */
  const sak = byId('sakina');
  if (sak) {
    const times = prayerTimes();
    const today = sak.prayerToday || {};
    /* The five are due whether or not Sakina has ever been opened on this device.
       Only the tick needs its database; without one they carry you there instead. */
    const canTick = sak.ok;
    if (times) {
      for (const p of PRAYER_ORDER) {
        const state = today[p] || 'none';
        out.push({
          key: 'sakina:' + p, app: 'sakina', label: PRAYER_LABEL[p], note: 'Prayer',
          domain: 'prayer', at: times[p], done: state !== 'none', state,
          tier: 'prayer', prayer: p,
          brief: canTick ? '' : 'Open Sakina once and these become tickable here',
          /* Firm mode surfaces a passed, unmarked prayer as outstanding. Sakina itself
             would not: its rule is that a gap is never turned into a failure. This is a
             deliberate override, kept behind a setting so it can be undone. */
          ...(firmSakina() && times[p].getTime() < Date.now() && state === 'none'
              ? { over: true, left: -Math.floor((Date.now() - times[p].getTime()) / 6e4) }
              : {}),
          words: w(p),
          action: canTick ? { kind: 'sakina.prayer', date, prayer: p, state: 'prayed' } : null,
          alt: canTick ? { label: 'jamāʿah', action: { kind: 'sakina.prayer', date, prayer: p, state: 'jamaah' } } : null,
          href: sak.url + 'prayer/'
        });
      }
    }
    /* ── the day's practice, in the order it belongs in ──
       Meditation after waking, journalling before affirmations, affirmations before
       sleep. That ordering is the point rather than decoration: a meditation is for
       arriving in the day and an affirmation track is for going down, and the journal
       goes first in the evening because writing the day down is what lets you stop
       turning it over — held in the head it circles, written down it waits.

       Hours hang off what is already known. Meditation follows the wake time actually
       logged, and affirmations sit just after Compound's dim-the-lights lever, so the
       whole evening reads as one sequence rather than three apps each having an opinion
       about bedtime. */
    /* Deliberately not gated on sak.ok. Meditating and listening to affirmations are
       things to do today whether or not Sakina has ever been opened — and Dīwān keeps
       their record itself, so nothing here depends on that app being reachable. A task
       is what is due, not what has already been logged; gating on the app's state is
       the exact mistake that once left this page showing only the rows it had history
       for. Only the two links below point at Sakina, and a link can wait. */
    {
      const prac = D.practiceOn(date);
      const wokeAt = compoundWake(date);
      const medAt = at(wokeAt != null ? Math.min(wokeAt + 0.34, 11) : 7.34);

      out.push({
        key: 'sakina:meditation', app: 'sakina', label: 'Meditation', note: 'Practice',
        domain: 'meditation', brief: 'Arriving in the day. Silence is the practice, not the gap between words.',
        at: medAt, done: !!prac.meditation, tier: 'due',
        words: ['meditate', 'meditation', 'breathwork'],
        action: { kind: 'diwan.practice', date, which: 'meditation' },
        href: sak.url + 'make/meditation/', cta: 'Make one'
      });

      out.push({
        key: 'sakina:journal', app: 'sakina', label: 'Journal', note: 'Practice',
        domain: 'journal',
        brief: 'Before the affirmations. A line is enough — held in the head it circles.',
        at: at(21), done: !!sak.journalToday, tier: 'due',
        words: ['journal', 'wrote', 'writing'],
        /* Not tickable: writing something is the whole action, and Sakina records it,
           so doneness comes from there rather than from a claim made here. `recordedBy`
           lets the command bar say that instead of shrugging at "I journalled". */
        action: null, recordedBy: 'Sakina', href: sak.url + 'journal/', cta: 'Write it'
      });

      out.push({
        key: 'sakina:affirmations', app: 'sakina', label: 'Affirmations', note: 'Practice',
        domain: 'affirmations', brief: 'On the way down, not something to concentrate on.',
        at: at(22.25), done: !!prac.affirmations, tier: 'due',
        words: ['affirmations', 'affirmation', 'listened'],
        action: { kind: 'diwan.practice', date, which: 'affirmations' },
        href: sak.url + 'library/', cta: 'Open the library'
      });
    }

    if (sak.ok && sak.started) {
      const staleMood = !sak.stat.some(s => s.l === 'Last mood' && s.v === 'today');
      if (staleMood) out.push({
        key: 'sakina:mood', app: 'sakina', label: 'How are you', note: 'Mood',
        domain: 'mood', brief: 'Two axes — pleasant/unpleasant and high/low energy',
        at: null, slot: 'any', done: false, tier: 'due',
        words: ['mood', 'how i am', 'feeling', 'check in'],
        action: null, href: sak.url
      });
    }
  }

  /* ── Anbīq — its daily loop, plus anything left overnight ──
     Reading and the Crucible want real input (a page number, a written synthesis),
     so they carry you to the app rather than pretending a tick did the work. */
  const anb = byId('anbiq');
  if (anb && anb.ok) {
    try {
      const A = await import('../../anbiq/js/store.js');
      const st = A.state();
      const readToday = st.sessions.some(x => x.date === date);
      const openBooks = A.reading();

      out.push({
        key: 'anbiq:read', app: 'anbiq', label: openBooks.length ? `Read — ${openBooks[0].title}` : 'Read',
        note: 'Reading', domain: 'reading',
        brief: openBooks.length
          ? `${openBooks[0].cursor}/${openBooks[0].pages} pages · target ${st.set.pagesPerDay || 30}/day`
          : 'Nothing open on the Shelf yet',
        at: null, slot: 'any', done: readToday, tier: 'due', left: 0, daily: true,
        words: ['read', 'reading', 'pages'],
        action: null, href: anb.url + (openBooks.length ? '' : '#shelf'),
        cta: openBooks.length ? 'Log pages' : 'Open the Shelf'
      });

      /* The daily conjunction only exists once there are two claims to collide. */
      if (A.live().filter(c => c.text.trim()).length >= 2) {
        const doneToday = !!A.crucibleOn(date);
        out.push({
          key: 'anbiq:crucible', app: 'anbiq', label: 'The Crucible', note: 'Recombination',
          domain: 'crucible', brief: 'Today’s pair — the two most distant claims in the lab',
          at: null, slot: 'any', done: doneToday, tier: 'due',
          words: ['crucible', 'conjunction', 'synthesis'],
          action: null, href: anb.url + '#crucible', cta: 'Run it'
        });
      }

      /* A prediction carries a real date, which almost nothing else here does. It gets
         a midday hour on that date so it can reach you, rather than sitting untimed in
         a list — an unresolved prediction is the lab lying to itself, in its own words. */
      for (const pr of A.openPreds()) {
        const late = since(pr.due);
        if (late == null || late < 0) continue;            // not due yet
        out.push({
          key: 'anbiq:pred:' + pr.id, app: 'anbiq',
          label: 'Resolve: ' + (pr.text || 'a prediction').slice(0, 60),
          note: 'Prediction', domain: 'prediction',
          brief: `You said ${Math.round((pr.conf ?? 0.5) * 100)}% · due ${pr.due}`,
          at: late === 0 ? at(12) : null, slot: late === 0 ? null : 'any',
          left: -late, over: late > 0, done: false, tier: 'reality',
          words: ['prediction', 'resolve'],
          action: null, href: anb.url + '#research', cta: 'Resolve it'
        });
      }
    } catch { /* the reader already reported it */ }

    for (const it of (anb.dispatch || [])) {
      out.push({
        key: 'anbiq:d:' + it.id, app: 'anbiq', label: it.title, note: 'Dispatch',
        domain: 'dispatch', brief: (it.body || '').slice(0, 120),
        at: null, slot: 'any', done: false, tier: 'due',
        words: ['dispatch', 'read the dispatch'],
        action: { kind: 'anbiq.seen', id: it.id },
        href: anb.url
      });
    }
  }

  /* ── Charisma Gym ──
     A rep is tickable because its own hub already offers exactly that button.
     The warm-up and the word drill are not: both are timed exercises whose value
     is in doing them, and a tick here would log the record without the rep. */
  const gc = byId('gc');
  if (gc) {
    const raw = (() => { for (const k of ['charismagym.v1', 'goodcompany.v2', 'goodcompany.v1']) {
      try { const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v) return v; } catch {} } return null; })();
    const events = (raw && raw.events) || [];
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const repsToday = events.filter(e => e.type === 'rep' && e.at >= dayStart.getTime()).length;
    const drillToday = events.some(e => e.type === 'drill' && e.at >= dayStart.getTime());
    const vocabToday = events.filter(e => e.type === 'vocab' && e.at >= dayStart.getTime()).length;
    const wantWords = (raw && raw.settings && raw.settings.dailyWords) || 5;

    out.push({
      key: 'gc:warmup', app: 'gc', label: 'Warm up', note: 'Voice',
      domain: 'warmup', brief: 'Articulators, consonants, twisters — it is a timed drill',
      at: null, slot: 'any', done: drillToday, tier: 'due', left: 0, daily: true,
      words: ['warm up', 'warmup', 'twisters', 'articulation', 'drills'],
      action: null, href: gc.url + '#warmup', cta: 'Run the drill'
    });
    out.push({
      key: 'gc:words', app: 'gc', label: `Words — ${vocabToday}/${wantWords}`, note: 'Vocabulary',
      domain: 'words', brief: 'Recall counts only on distinct days, so it has to be done there',
      at: null, slot: 'any', done: vocabToday >= wantWords, tier: 'due', left: 0, daily: true,
      words: ['words', 'vocab', 'vocabulary'],
      action: null, href: gc.url + '#vocab', cta: 'Open Words'
    });
    out.push({
      key: 'gc:rep', app: 'gc', label: 'A rep', note: 'Reps',
      domain: 'rep', brief: repsToday ? `${repsToday} logged today` : 'One conversation you started. Volume is the input you control.',
      at: null, slot: 'any', done: repsToday > 0, tier: 'due', left: 0, daily: true,
      words: ['rep', 'conversation', 'talked to', 'spoke to'],
      action: raw ? { kind: 'gc.rep' } : null, href: gc.url + '#field',
      cta: raw ? undefined : 'Open Charisma Gym'
    });
  }

  /* ── Āfāq ──
     A live trip's itinerary is the one thing here that is genuinely a checklist
     with times on it, and its own `toggleItem` is the write. Everything else in
     that app wants a number — miles, minutes, a rating. */
  const afq = byId('afaq');
  if (afq) {
    try {
      const F = await import('../../afaq/js/store.js');
      const st = F.state();
      const live = (st.trips || []).find(t => t.from <= date && t.to >= date && t.status !== 'idea');
      if (live) {
        const day = (live.days || []).find(d => d.date === date);
        for (const it of (day && day.items) || []) {
          out.push({
            key: 'afaq:item:' + it.id, app: 'afaq', label: it.txt || it.kind || 'Itinerary item',
            note: live.name, domain: 'trip', brief: it.note || '',
            at: it.t ? at(Number(it.t.split(':')[0]) + Number(it.t.split(':')[1] || 0) / 60) : null,
            slot: it.t ? null : 'any', done: !!it.done, tier: 'due',
            words: [(it.txt || '').toLowerCase()].filter(x => x.length > 3),
            action: { kind: 'afaq.item', tripId: live.id, date, itemId: it.id },
            href: afq.url + '#travel'
          });
        }
      }
      for (const p of (F.activePursuits() || [])) {
        const loggedToday = (p.logs || []).some(l => l.date === date);
        if (loggedToday) continue;
        out.push({
          key: 'afaq:pursuit:' + p.id, app: 'afaq', label: 'Practice', note: 'Craft',
          domain: 'pursuit', brief: 'Minutes go in the app',
          at: null, slot: 'any', done: false, tier: 'due',
          words: ['practice', 'practised', 'practiced'],
          action: null, href: afq.url + '#craft', cta: 'Log it'
        });
      }
    } catch { /* reported by the reader */ }
  }

  /* ── The day's own list ──
     Typed by hand, belonging to no app. Ranked with everything else so a dentist
     appointment does not sit in a different universe from a prayer. */
  for (const t of D.todos(date)) {
    out.push({
      key: 'diwan:todo:' + t.id, app: 'diwan', label: t.text, note: 'Today',
      domain: 'todo', brief: '', done: t.done,
      at: t.at ? at(Number(t.at.split(':')[0]) + Number(t.at.split(':')[1] || 0) / 60) : null,
      slot: t.at ? null : 'any', tier: 'due', daily: !t.at,
      words: t.text.toLowerCase().split(/\s+/).filter(x => x.length > 3),
      action: { kind: 'diwan.todo', id: t.id }, href: '#/'
    });
  }

  /* ── What is left that a tick cannot close ──
     An app's own engine also raises things that are not a checkbox: a prediction
     wanting an outcome, a field entry wanting a prediction and a rating.
     Those belong in the day and are kept.

     What is dropped is the summaries. An engine that says "5 rituals due" is
     describing five rows that are already on this list individually, and showing
     both turns a queue into a list of the same work counted twice. The rule:
     a raised item survives only if nothing tickable already covers it. */
  const haveKey = new Set(out.map(t => t.key));
  const COVERED = { 'compound|foundation': 'compound:wake', 'compound|reality': 'compound:bloods' };

  for (const a of snap.apps) {
    if (!a.ok) continue;
    for (const p of (a.proposals || [])) {
      if (p.tier === 'housekeeping') continue;
      if (p.tier === 'due') continue;                                  // always a count of rows above
      const dup = COVERED[`${a.id}|${p.tier}`];
      if (dup && haveKey.has(dup)) continue;                           // the row itself is already here
      out.push({
        key: `prop:${a.id}:${p.tier}:${p.why.slice(0, 24)}`, app: a.id,
        label: p.why, note: a.name, domain: 'note', brief: p.what,
        at: null, slot: 'any', done: false, tier: p.tier, overdue: p.overdue,
        words: [], action: null, href: p.href, cta: p.cta, isNote: true
      });
    }
  }

  return order(out);
}

/* The wake time actually logged today, as a fractional hour, or null. Read straight
   from Compound's store so the morning hangs off one fact rather than three guesses. */
function compoundWake(date) {
  try {
    const raw = JSON.parse(localStorage.getItem('pp:v1:hlog') || '{}');
    const t = raw?.[date]?.wake?.v?.t;
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
  } catch { return null; }
}

/* Jamāl's own dueIn, copied rather than imported — see write.js for why. */
function dueIn(r, st, t) {
  const c = r.cadence, last = st.last[r.id];
  if (c.type === 'ondemand') return null;
  if (!last) return (c.type === 'months' || (c.type === 'every' && c.n >= 14)) ? null : 0;
  const gap = Math.round((new Date(t + 'T00:00') - new Date(last + 'T00:00')) / 864e5);
  const doneToday = !!(st.done[t] && st.done[t][r.id]);
  if (c.type === 'daily') return doneToday ? 1 : 0;
  if (c.type === 'every') return c.n - gap;
  if (c.type === 'months') return c.n * 30 - gap;
  if (c.type === 'weekly') {
    const wd = new Date().getDay();
    if (wd === c.day) return doneToday ? 7 : 0;
    return gap >= 7 ? 0 : (c.day - wd + 7) % 7;
  }
  return 0;
}

/**
 * How long is left on something with no time of day.
 *
 * "Any time this week" is only useful if you can see which end of the week you are at.
 * A weekly item counts down to Sunday night; a fortnightly, monthly or quarterly one
 * counts from when it was last actually done, so the number is a real deadline rather
 * than a calendar boundary.
 *
 * Returns { note, left, over } — `left` in whole days, negative when overdue.
 */
function cadenceNote(i, S) {
  const t = iso();
  const dow = (new Date(t + 'T00:00').getDay() + 6) % 7;      // Monday = 0
  const restOfWeek = 7 - dow;                                  // today counts

  if (i.cad.t === 'w') {
    const got = S.weekCount(t, i.id), need = i.cad.n;
    const short = Math.max(0, need - got);
    /* A weekly target is never "overdue" — it runs out at Sunday night. What can happen
       is that it stops being reachable, and that is a different sentence: the countdown
       stays honest ("2 days left") and the note says the target is already out of reach. */
    const tight = short > restOfWeek;
    return {
      note: `${got}/${need} this week` + (tight ? ` · ${short} in ${restOfWeek} days is not on` : ''),
      left: restOfWeek, short, tight, over: false
    };
  }

  const span = i.cad.t === 'f' ? 14 : i.cad.t === 'm' ? 30 : 90;
  const word = i.cad.t === 'f' ? 'fortnight' : i.cad.t === 'm' ? 'month' : 'quarter';

  /* Walk back for the last time it was actually done — up to twice the window, so an
     item that lapsed can report how far past due it is rather than just "due". */
  let last = null;
  for (let d = 0; d <= span * 2; d++) {
    const e = S.getHEntry(shift(t, -d), i.id);
    if (e && e.done) { last = d; break; }
  }
  /* Never done is not "0 days over" — there is no last date to count from. Say so. */
  if (last === null) return { note: `never logged · every ${word}`, left: null, over: true };
  const left = span - last;
  return { note: `last ${last === 0 ? 'today' : last + 'd ago'} · every ${word}`, left, over: left < 0 };
}

/** Days-left, rendered the way a deadline reads out loud. */
export function leftLabel(left, over) {
  if (left == null) return over ? 'overdue' : '';
  if (left < 0) return `${Math.abs(left)}d over`;
  if (left === 0) return 'last day';
  if (left === 1) return '1 day left';
  return `${left} days left`;
}

const TIER_RANK = { foundation: 0, prayer: 1, reality: 2, due: 3, review: 4, housekeeping: 5 };

/**
 * The order of the day.
 *
 * Anything with a clock time sorts by that time, so the list reads forwards through
 * the day and the next thing to do is the next thing down. Timed items that have
 * already passed sit at the top, oldest first, because those are the ones being
 * missed right now. Untimed work follows, ordered by tier. Done drops out to its
 * own section so the list gets shorter as the day goes on — which is the whole point.
 */
function order(tasks) {
  const now = Date.now();
  /* Dormant = real, known, and not due today. Kept on `all` so the command bar can
     recognise the words, filtered out of every group so the queue stays the day's work. */
  const live = tasks.filter(t => !t.dormant);
  const done = live.filter(t => t.done);
  const open = live.filter(t => !t.done);

  const passed = open.filter(t => t.at && t.at.getTime() <= now)
    .sort((a, b) => a.at - b.at);
  const coming = open.filter(t => t.at && t.at.getTime() > now)
    .sort((a, b) => a.at - b.at);
  /* Untimed work sorts by how long is actually left on it — an item three days over
     its cadence outranks one with a week to run, whatever tier either sits in. Items
     with no deadline at all fall to the back. */
  /* left == null means one of two opposite things: overdue with no last date to count
     from (most urgent), or simply no deadline (least). The `over` flag separates them. */
  const rank = t => t.left != null ? t.left : (t.over ? -999 : 999);
  const anytime = open.filter(t => !t.at).sort((a, b) => {
    const al = rank(a), bl = rank(b);
    if (al !== bl) return al - bl;
    return (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (b.overdue || 0) - (a.overdue || 0);
  });

  return {
    passed, coming, anytime, done,
    all: [...passed, ...coming, ...anytime],
    dormant: tasks.filter(t => t.dormant),
    openCount: open.length,
    doneCount: done.length
  };
}
