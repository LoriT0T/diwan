# Dīwān — ديوان

The register. Historically a dīwān was the bureau that collected the records of every
department into one book, so that somebody could look at the whole thing at once.

One page over six apps. A day's work in one queue, ticked from the top — and every log on
one surface.

**Live: <https://lorit0t.github.io/diwan/>**

---

## The six

| | | |
|---|---|---|
| **Compound** | Sleep · training · fuel · tests | <https://lorit0t.github.io/compound/> |
| **Jamāl** | Grooming · skin · fit · scent | <https://lorit0t.github.io/jamal/> |
| **Anbīq** | Reading · claims · predictions | <https://lorit0t.github.io/anbiq/> |
| **Sakina** | Prayer · meditation · mood | <https://lorit0t.github.io/sakina/> |
| **Charisma Gym** | Charisma · social skill | <https://lorit0t.github.io/charisma-gym/> |
| **Āfāq** | Screen · road · craft · travel | <https://lorit0t.github.io/afaq/> |

## Every app runs inside this one

**Apps → Open it here** mounts the real app in Dīwān: same code, same data, same URL
underneath, framed by this page instead of a browser tab. A slim bar gives you back, the
name, and ↗ for a full tab.

It is an iframe, and that is the point rather than a shortcut. Every app already lives on
this origin, so `../compound/` is *the app* — not a copy of it. Which means:

- **Nothing breaks.** Existing links keep working, home-screen installs keep working, and
  each app keeps its own repo, its own deploy and its own service worker.
- **Nothing duplicates.** There is no second copy to drift from the first, which is the
  exact failure this ecosystem is built to avoid. Moving the source in would also have
  meant rebuilding Sakina, which is a Next.js app with its own `basePath`.
- **The frame is not a black box.** Same origin, so anything logged in there is logged in
  the same storage this page reads. Leaving an app re-reads before painting, so the queue
  already reflects what you just did inside it.

Deep links carry through: `#/in/jamal~%23%2Frituals` mounts Jamāl at its Rituals page, and
every "open" in the queue points at the right page of the right app.

## The live session

Starting a workout opens a panel built for having your hands full: the current exercise
with its cue, last time's numbers, per-set weight / reps / RIR, and a rest countdown large
enough to read at arm's length. A bar rides above the nav on every other view, so you can
be in Sakina and still see which set you are on.

**The rest timer is wall-clock, and that is a fix rather than a preference.** Compound's
own timer runs on `requestAnimationFrame`, which the browser pauses in a backgrounded tab —
put the phone in your pocket between sets and the countdown freezes, then resumes from
where it stopped instead of from where the clock is. Everything here derives from a stored
end time, so three minutes in a pocket is three minutes. Verified by rewinding the end time
45 seconds and confirming 45 seconds had gone.

Every set writes through Compound's own session store — one source of truth, the same rule
as every other tick — and the advance logic matches its own: an A-half goes straight into
its superset partner with no rest, a B-half rests then returns to the partner for the next
round.

**What it cannot do, and why.** iOS has no notification action buttons — MDN records
`actions` as unsupported on Safari and Safari iOS — and no lock-screen text entry. So there
is no "log this set" button on the notification, and there never can be on the web. Live
Activities and the Dynamic Island are native-only. The notification is a doorway; the panel
is the room. The full design, including what a native client would add, is written up
separately.

**Times and reminders.** Prayer times are computed on the device from your coordinates —
*Use my location* writes them to `sakina.place`, the same key Sakina reads, so setting it
once fixes both apps. Reminders fire at each prayer time, at the hour of anything else
timed, and once in the evening listing what is still open. They fire **only while Dīwān is
open in a tab** — backgrounded is fine, closed is not. Push needs a server to push from and
there isn't one; the alternative is sending your day somewhere, which is not worth it for a
reminder. Sakina reached the same conclusion.

**A side menu moves you between them.** Inside an app, Dīwān's bottom bar is hidden — the
app has its own and two stacked bars is one too many — so ☰ in the frame bar opens a drawer
listing Dīwān's own sections and all six apps, each with how many of its rows are still
open. Going from Compound to Jamāl is one gesture, and it is the same gesture as going from
Today to the Log.

## Sync across devices

**Data → Sync.** The project is wired in and the schema is applied; sign in and the device
joins. Every device signed into the same account converges.

The publishable key is in this repo on purpose. It names the project and grants nothing —
every row is guarded inside Postgres by Row Level Security, `auth.uid() = user_id`, so the
database is the guard rather than the client. That is the only arrangement that survives
the client being readable, and it was checked against the live project rather than assumed:

```
read  with only the publishable key  →  []          no rows, nothing leaked
write with only the publishable key  →  401  "new row violates row-level security policy"
```

A **secret** key is the opposite — it bypasses RLS entirely. The app refuses one if it is
ever pasted in, in both shapes Supabase uses: the `sb_secret_…` prefix, and a legacy JWT
whose decoded payload carries any role other than `anon`.

### It syncs records, not blobs

Uploading each app's storage as one lump is the obvious design and it destroys data: log a
workout on the phone and a prayer on the laptop, and whichever uploads second wins outright.
So every app's storage is decomposed into the smallest independently-meaningful records it
has — `hlog/2026-08-22/wake`, `done/2026-08-22/shower`, `claims/k3f9a1` — and each travels
on its own. Two devices editing different things on the same day are never writing the same
record, so both simply survive.

Change detection needs no help from the apps. Dīwān keeps a **shadow index** — a hash of
every record it saw last sync — so anything whose hash moved is something this device
changed. The six apps are untouched: they keep writing localStorage synchronously and never
learn a cloud exists.

### The rules, stated rather than hidden

| | |
|---|---|
| changed here only | pushed |
| changed there only | taken |
| **changed both sides, first sync on this device** | **the cloud wins** — signing in somewhere new means joining an account, not overwriting it |
| **changed both sides, after that** | **this device wins** — you are here, you just did it, and silently discarding it would make the whole feature untrustworthy |
| deleted here | a tombstone is pushed, so it does not resurrect elsewhere |
| deleted there | deleted here |

Nothing is ever deleted by a first sync — the two sides are unioned.

Syncs on open, on leaving an app you logged something in, and every five minutes while
visible. **Not synced:** Compound's exercise photos and Sakina's audio and chunk cache — a
few finished tracks are hundreds of megabytes. Track *metadata* travels, so the library
lists it everywhere and the audio is re-made where it is wanted.

### Verified

Against a stand-in for Supabase's REST, before any real project existed:

- shred → apply round-trips **losslessly** across all six apps
- an empty device joining the account recovers everything, with derived fields rebuilt
- phone logs morning light, laptop logs a ritual, neither having seen the other — **both survive**
- an untick propagates as a tombstone and does not come back
- two devices editing the same record converge, the one in front of you winning

## Today is a queue

One list, in the order the day actually happens. The top item is the one you are on; tick
it and the next comes up. That is the whole interaction.

**Time decides the sequence, not importance.** A wake time belongs at 07:00 and dimming
the lights belongs at 22:00, and nothing about priority moves either. Things with no time
of their own fall to *Any time this week*, each carrying how long is actually left on it —
a weekly target counts down to Sunday, a fortnightly or quarterly one counts from when it
was last really done, and they sort by that rather than by tier. A weekly target that can
no longer be reached says so instead of pretending to be overdue. Prayer times are computed here
with `adhan` — the same library, version and settings Sakina uses, from the coordinates it
already stores — so the two cannot disagree.

**Ticking writes into the app that owns it.** Compound's own `toggleH`, Jamāl's ritual log,
Sakina's prayer states. Every tick is one reversible write with an Undo in the toast.

**Every app puts its work in the same list.** Compound's components at their hour, Jamāl's
rituals in their block, the five prayers at their computed times, Charisma Gym's daily units,
Anbīq's reading and Crucible, and a live Āfāq trip's itinerary at the times on it.

A task is what an app **defines** as due today, never what you have logged before. That
distinction was a bug: the queue was gated on each app having history, so a device that had
never opened Compound showed no Compound work — when all twenty-five of its components were
due, and being new is exactly when you most need the list.

Two things are deliberately not tickable:

- **Anything wanting a real number** — a set, a page count, a mood on two axes. Ticking
  those would write a fiction, so they link to the app that can take the value properly.
  They sit under *Needs the app*.
- **Compound's Situational band.** Its own copy says these are taken for a reason, not
  daily. Five of them in a tick list turns a considered decision into a chore.

A third case sits in between: where an app has never been opened *on this device*, its rows
still appear at the right time but carry you there instead of ticking. The hub will not
create another app's storage from nothing — Jamāl's `set.start` is the baseline its adherence
is measured from, and stamping it from here would silently decide when you started.

**Salah is in the queue at its real time, and is never scored.** Sakina refuses streaks and
anything that turns a gap into a failure; a prayer that has passed unmarked simply sits
there, and nothing here ever writes `missed`.

## Saying it instead of tapping it

The bar at the bottom of Today takes typing or speech. *"showered and did my teeth, then
took my magnesium"* ticks three rows.

It is keyword matching against the words already on the queue — not understanding. There is
no model, because the repo is public and static and any key in it would be a key given
away. That limit sets the design: it names back everything it matched, says out loud
anything it could not place, and every tick is undoable.

Three distinctions it makes, because each one was a bug first:

- **Already logged**, not "no idea what you mean". Saying you showered when it is ticked
  should not make you doubt the tool.
- **Not due today.** "Scalp oil" on a day the oil treatment is not scheduled reports that,
  rather than falling through to the nearest weaker match and ticking the scalp massage.
- **Word boundaries, and no bare generic verbs.** "Walk" used to sit under Zone 2, so
  *"walked the dog"* silently logged a cardio session. A false tick is worse than a missed
  one, because a missed one you notice.

Speech uses the browser's own recogniser, which means the audio goes to Apple's or Google's
speech service — worth knowing, given everything else here stays on the device. Typing the
same sentence does not.

## How it reads them

Four of the five are served from `lorit0t.github.io`, and **a path does not scope web
storage** — that is one origin, therefore one `localStorage` and one IndexedDB space. So
this page reads them where they sit. No API, no server, no sync, and no second copy of
your data to fall out of date.

Where an app can answer a question itself, its module is imported and asked. Compound's
`satisfied()` decides what counts as done today; Anbīq's `gaps()` and `vitals()` are the
real ones, running here. That matters because a reimplementation drifts, and then the hub
and the app disagree about what you did today.

Three rules hold this up:

- **Read only.** Nothing writes to another app's storage, ever. That extends to not
  *importing* a module whose top level writes — Jamāl's `store.js` stamps a start date on
  load, so its state is read raw and the one duplicated function in the codebase is its
  `dueIn`.
- **Never conjure a database.** `indexedDB.open(name)` with no version *creates* the
  database if it is absent, at version 1 with no object stores, and Sakina's own upgrade
  path would then skip creating `tracks`/`audio`/`drafts` permanently. So the databases are
  listed first, never created, and opened at exactly the version already on disk.
- **Fail soft, one app at a time.** An app never opened, a module that moved, a database
  that is not there — each returns a report saying so. One broken reader must never take
  the page down.

Charisma Gym used to be the exception, on onrender.com. It moved onto this origin on
2026-08-22 and is now read live like the rest; its Render service survives as the voice
backend only. The pasted-snapshot path stays in **Data** as a fallback for a device holding
an old export.

## What it decides

There are already six recommendation engines, each well reasoned inside its own domain.
This adds a seventh to none of them — every item on Today was raised by the app that owns
it, and Āfāq's `theOneThing()` and Anbīq's `gaps()` are asked rather than re-derived. The
only job here is the one no single app can do: putting six domains in one order.

Summaries are dropped. An engine saying *"5 rituals due"* is describing five rows already
on the list individually, and showing both turns a queue into the same work counted twice.
A raised item survives only if nothing tickable already covers it.

Tier breaks ties among the things with no time of their own:

| Tier | What it catches | Why it sits there |
|---|---|---|
| **Foundation** | Sleep, the wake time | Compound's engine calls Lever 01 the highest-leverage item in the app; Sakina's `observe()` independently reads low-energy runs as pointing at sleep. Two apps arriving there separately. |
| **Reality contact** | Field log silent, prediction past due, no blood panel | Every app has one organ that stops it grading its own homework, and they are the ones that lapse silently — nothing breaks when they stop. |
| **Due today** | Outstanding work | Real, but it will still be there in an hour, and it is the tier most able to crowd out the two above it. |
| **Close the loop** | A review not run | Slow to hurt, expensive to keep deferring. |
| **Upkeep** | Stale snapshot, no backup | The hub's own housekeeping. |

**Salah is deliberately not ranked.** Sakina refuses streaks, scores and anything that
turns a gap into a failure, and states the reason. Ranking prayer as a task would import
exactly the pressure it removed. It is shown as the day's five states on Today, and never
graded.

## Not asking you twice

Five of Jamāl's eight "inside" metrics are already owned in richer form next door — sleep,
trained and protein by Compound; salah and calm by Sakina. When the owning app has the day
covered, those are marked answered and left off the list, with a note saying which app
holds them. Removing that double entry is most of the reason this page exists.

## One backup, all six

Six apps meant six export buttons, which is a habit nobody keeps. **Data → Download
everything** writes one file.

There is deliberately no matching import. Restoring means writing into another app's
storage, and each app already validates its own restore properly — Anbīq refuses a file
with no `claims` array, Good Company refuses one with no event log. A hub-level restore
would have to bypass all of that. Export here, restore there.

Audio tracks are excluded, as Sakina's own export excludes them: a few would make the file
hundreds of megabytes.

## Known limits

- **Storage is per-device and per-browser**, and this page cannot fix that — it reads
  whichever device it is open on. The apps have no accounts and no server by design. The
  unified backup is the way across.
- **Good Company's numbers are as old as the last paste**, and the hub says so on the card,
  in the diagnostics, and again as an upkeep item once the snapshot passes two weeks.
- **Offline, the sibling apps must have been cached by their own service workers.** This
  worker's scope is `/diwan/` and does not cover `/compound/js/…`. An app whose worker has
  never run is simply unreadable offline, and the diagnostics say which.
- **`indexedDB.databases()` is required to read Sakina.** Where it is unavailable the read
  is skipped on purpose rather than risking creating an empty database.

## Structure

    index.html        shell + bottom nav
    css/app.css       the whole visual system
    js/read.js        the adapters — one report per app
    js/tasks.js       the day's queue: atomic items, ordered by the clock
    js/write.js       the tick writers — the only place this hub writes to another app
    js/voice.js       speech capture and the keyword matcher
    js/rank.js        tier definitions and their rationale
    js/store.js       the hub's own store — a fallback snapshot, and nothing else
    js/app.js         views and router
    vendor/adhan…     prayer times, MIT, the exact build Sakina uses
    sw.js             offline shell, network-first for code

The hub has no accent colour of its own. Every saturated pixel belongs to one of the six
apps and is taken from that app's own `:root`. There are no web fonts — the five it sits
above are offline-first with no build step, and a font request would be the only network
dependency in the set.

## Local

The cross-app reads only work when the apps are siblings at the same relative paths, so
serve a directory containing all of them:

```bash
python3 -m http.server 4180
```

Then open `http://localhost:4180/diwan/`.

## The one hazard that cannot be engineered away

If an app is **open in another tab**, that tab holds its own in-memory copy and may
overwrite a tick made here on its next save. Every write re-reads from storage immediately
beforehand, so the worst case is a lost tick rather than a lost day — but reload the app
after ticking from the hub. Today says so on the page.

---

*It reads six apps. It writes only what you tick, only where that tick belongs, and always
with an undo.*

*Serving the parent directory is what makes `../compound/js/…` resolve. Clone the sibling
repos next to this one and the cross-app reads work locally exactly as they do live.*
