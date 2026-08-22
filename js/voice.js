/* Dīwān — saying it instead of tapping it.
 *
 * What this is, plainly: keyword matching against the words already on the queue.
 * It is not understanding. There is no model here and there cannot be — the repo is
 * public and static, so any key in it would be a key given away, which is the same
 * constraint Anbīq works under.
 *
 * That limitation decides the design. A matcher that cannot understand must never
 * guess quietly, so:
 *   · everything it matched is named back to you before anything moves
 *   · anything it could not place is said out loud rather than dropped
 *   · every tick it makes is undoable in one tap
 *
 * Speech is the browser's own recogniser (`SpeechRecognition`, `webkit` prefix on
 * Safari). On iOS and Chrome that means the audio does go to the platform's speech
 * service — Apple's or Google's — which is worth knowing given everything else here
 * stays on the device. Typing the same sentence into the box does not.
 */

const NORM = s => String(s || '')
  .toLowerCase()
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* "showered and did my teeth, then fajr" → three fragments */
const SPLIT = /\s+(?:and then|and also|and|then|also|plus)\s+|\s*,\s*/;

const FILLER = /^(i|ive|i have|just|did|done|finished|completed|had|took|my|the|a|an|we|do)\s+/;
function strip(f) { let s = f; for (let i = 0; i < 4; i++) s = s.replace(FILLER, ''); return s.trim(); }

const ESC_RX = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does this keyword appear in the fragment as a word, not as a fragment of one?
 *
 * Substring matching was the first attempt and it is wrong in a way that costs you:
 * "walked the dog" contains "walk", so it silently logged a Zone 2 session. The left
 * edge is anchored to a word boundary and the right edge is left open, so ordinary
 * inflections still land — "walk" matches "walked", "shower" matches "showered" —
 * while "up" no longer matches "supplements".
 */
function hasWord(frag, kw) {
  return new RegExp('\\b' + ESC_RX(kw)).test(frag);
}

/**
 * Match a sentence against the queue.
 *
 * Done tasks are matched too, and reported separately. Saying "I showered" about
 * something already ticked should hear "already logged", not "no idea what you mean" —
 * the second one makes you doubt the tool.
 *
 * Returns { hits, already, misses, ambiguous }.
 */
export function match(text, tasks, bundles = []) {
  const clean = NORM(text);
  if (!clean) return { hits: [], already: [], notDue: [], misses: [], ambiguous: [] };

  const open = tasks.filter(t => !t.done && !t.dormant);
  const fragments = clean.split(SPLIT).map(strip).filter(Boolean);
  const hits = [], already = [], notDue = [], misses = [], ambiguous = [];
  const taken = new Set();

  const scoreAgainst = (frag, pool) => {
    let best = 0; const scored = [];
    for (const t of pool) {
      if (taken.has(t.key)) continue;
      let score = 0;
      for (const kw of (t.words || [])) {
        const k = NORM(kw);
        if (k.length >= 3 && hasWord(frag, k)) score = Math.max(score, k.length);
      }
      if (score) { scored.push({ t, score }); best = Math.max(best, score); }
    }
    return scored.filter(s => s.score === best);
  };

  for (const frag of fragments) {
    /* Bundles first: "my routine" means a block, not one row. */
    const bundle = bundles.find(b => b.words.some(bw => hasWord(frag, NORM(bw))));
    if (bundle) {
      const group = open.filter(t => bundle.match(t) && !taken.has(t.key));
      if (group.length) {
        for (const t of group) { taken.add(t.key); hits.push({ task: t, via: frag }); }
        continue;
      }
    }

    /* Score against EVERYTHING known first, including things not due today, so the
       longest keyword genuinely wins. "scalp oil" has to reach the oil treatment even
       on a day it is not scheduled — otherwise it falls through to "scalp" and ticks
       the massage, which is a wrong entry made silently. */
    const best = scoreAgainst(frag, tasks);
    if (!best.length) { misses.push(frag); continue; }

    const openHit = best.filter(s => !s.t.done && !s.t.dormant);
    if (openHit.length === 1) { taken.add(openHit[0].t.key); hits.push({ task: openHit[0].t, via: frag }); continue; }
    if (openHit.length > 1) { ambiguous.push({ fragment: frag, tasks: openHit.map(s => s.t) }); continue; }

    const doneHit = best.find(s => s.t.done);
    if (doneHit) { already.push({ fragment: frag, task: doneHit.t }); continue; }

    const dormantHit = best.find(s => s.t.dormant);
    if (dormantHit) { notDue.push({ fragment: frag, task: dormantHit.t }); continue; }

    misses.push(frag);
  }

  return { hits, already, notDue, misses, ambiguous };
}

/* ── speech ────────────────────────────────────────────────────────── */

export function speechSupported() {
  return typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Start listening. Calls onPartial as it goes and onFinal once with the sentence.
 * Returns a stop() — call it to end early; the recogniser still delivers whatever
 * it heard.
 */
export function listen({ onPartial, onFinal, onError, onEnd }) {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) { onError && onError('This browser has no speech recognition. Type it instead.'); return () => {}; }

  const rec = new Rec();
  rec.lang = 'en-GB';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    onPartial && onPartial((finalText + interim).trim());
  };
  rec.onerror = e => {
    const msg = e.error === 'not-allowed'
      ? 'Microphone permission was refused. Type it instead.'
      : e.error === 'no-speech' ? 'Did not catch anything.'
      : `Speech failed (${e.error}). Type it instead.`;
    onError && onError(msg);
  };
  rec.onend = () => {
    onEnd && onEnd();
    const t = finalText.trim();
    if (t) onFinal && onFinal(t);
  };

  try { rec.start(); } catch { onError && onError('Could not start listening.'); }
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}
