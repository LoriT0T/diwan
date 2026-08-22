/* Dīwān — arbitration.
 *
 * There are already five recommendation engines. Compound's `recommend()`, Anbīq's
 * `gaps()`, Good Company's `Coach.nextRep()`, Sakina's `guidanceFor()` and Jamāl's
 * cadence maths are each well reasoned inside their own domain, and a sixth engine
 * sitting on top of them would just be a louder opinion.
 *
 * So this file generates nothing. Every proposal it ranks was produced by the app it
 * belongs to. The only job here is the one no single app can do: deciding which of
 * five domains gets today.
 *
 * The output is ONE action. Good Company already wrote the argument for why —
 * "a list is a decision you have pushed back onto him" — and it is right. The rest
 * is kept, in order, underneath and quieter, so nothing is hidden; but the page
 * answers the question rather than restating it.
 */

/* ---------------------------------------------------------------------------
   The order, and why it is this order.

   foundation   Sleep and the wake time. Compound's own engine calls Lever 01 the
                highest-leverage item in the app and says nothing further down
                compensates for it; Sakina's `observe()` independently reads a run of
                low-energy days as pointing at sleep rather than at mood. Two apps
                arriving there separately is the strongest signal in the ecosystem.

   reality      An anti-self-deception organ has gone dark. Every app has one — the
                field log, a dated prediction, a blood panel — and they are the inputs
                that stop the system drifting without noticing. They are also the ones
                that lapse silently, because nothing breaks when they stop.

   due          Today's outstanding work. Real, but it will still be there in an hour,
                and it is the tier most able to crowd out the two above it.

   review       A loop that has not closed. Slow to hurt, expensive to keep deferring.

   housekeeping The hub's own upkeep — a stale snapshot, a backup not taken.

   Deliberately absent: salah. Sakina refuses streaks, scores and anything that turns
   a gap into a failure, and states the reason. Ranking prayer as a task would import
   exactly the pressure it removed. It is shown as state on the Today page and never
   ranked. That is a decision, not an oversight.
   --------------------------------------------------------------------------- */
export const TIERS = ['foundation', 'reality', 'due', 'review', 'housekeeping'];

export const TIER_LABEL = {
  foundation:   'Foundation',
  reality:      'Reality contact',
  due:          'Due today',
  review:       'Close the loop',
  housekeeping: 'Upkeep'
};

export const TIER_WHY = {
  foundation:   'Nothing further down compensates for this one.',
  reality:      'The input that stops the system drifting without noticing has gone quiet.',
  due:          'Outstanding today.',
  review:       'A loop that has not closed.',
  housekeeping: 'The hub’s own upkeep.'
};

/* Stable ordering when tier and staleness both tie. Declared rather than computed,
   so the same morning always produces the same answer instead of a coin toss. */
const APP_ORDER = ['compound', 'gc', 'anbiq', 'jamal', 'sakina'];

export function arbitrate(apps) {
  const all = [];
  for (const a of apps) {
    if (!a.ok || !Array.isArray(a.proposals)) continue;
    for (const p of a.proposals) all.push({ ...p, app: p.app || a.id, appName: a.name });
  }

  all.sort((x, y) => {
    const t = TIERS.indexOf(x.tier) - TIERS.indexOf(y.tier);
    if (t !== 0) return t;
    const o = (y.overdue || 0) - (x.overdue || 0);
    if (o !== 0) return o;
    return APP_ORDER.indexOf(x.app) - APP_ORDER.indexOf(y.app);
  });

  return { top: all[0] || null, rest: all.slice(1), count: all.length };
}

/* What the page says when there is genuinely nothing to raise. Distinguishes
   "you are current" from "nothing is set up yet", because those want opposite
   responses and a single empty state would blur them. */
export function quietState(apps) {
  const readable = apps.filter(a => a.ok);
  const started = readable.filter(a => a.started);

  if (!readable.length) {
    return {
      head: 'Nothing readable yet',
      body: 'None of the apps have data on this device. Open one, log something, and it will appear here — the hub reads them in place rather than keeping its own copy.'
    };
  }
  if (!started.length) {
    return {
      head: 'All five are empty on this device',
      body: 'Storage is per-device and per-browser. If you have been using these on your phone, that data is on your phone — this page is not missing it, it is somewhere else.'
    };
  }
  return {
    head: 'Everything is current',
    body: 'No foundation gap, no instrument gone dark, nothing outstanding. Pick the thing you least want to do — that is usually the signal.'
  };
}
