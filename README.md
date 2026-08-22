# Dīwān — ديوان

The register. Historically a dīwān was the bureau that collected the records of every
department into one book, so that somebody could look at the whole thing at once.

One page over five apps. What is outstanding, what to do next, and every log on one surface.

**Live: <https://lorit0t.github.io/diwan/>**

---

## The five

| | | |
|---|---|---|
| **Compound** | Sleep · training · fuel · tests | <https://lorit0t.github.io/compound/> |
| **Jamāl** | Grooming · skin · fit · scent | <https://lorit0t.github.io/jamal/> |
| **Anbīq** | Reading · claims · predictions | <https://lorit0t.github.io/anbiq/> |
| **Sakina** | Prayer · meditation · mood | <https://lorit0t.github.io/sakina/> |
| **Good Company** | Charisma · social skill | <https://good-company.onrender.com/> |

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

**Good Company is the exception.** It runs on onrender.com, a different origin, which the
browser walls off completely. It arrives as a pasted export from **Data**, and its numbers
are always shown with their age.

## What it decides

There are already five recommendation engines, each well reasoned inside its own domain.
This adds a sixth to none of them — every proposal on the Today page was produced by the
app it belongs to. The only job here is the one no single app can do: deciding which of
five domains gets today.

The answer is **one action**. Good Company already wrote the argument — *a list is a
decision you have pushed back onto the user* — and it is right. The rest is kept
underneath, in order, quieter.

The order, and why it is that order:

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

## One backup, all five

Five apps meant five export buttons, which is a habit nobody keeps. **Data → Download
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
    js/read.js        the adapters — one report per app, the interesting part
    js/rank.js        arbitration: five engines in, one action out
    js/store.js       the hub's own store: the Good Company snapshot, and nothing else
    js/app.js         views and router
    sw.js             offline shell, network-first for code

The hub has no accent colour of its own. Every saturated pixel belongs to one of the five
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

---

*It reads. It never writes to anything but its own key, `diwan.v1`.*

*Serving the parent directory is what makes `../compound/js/…` resolve. Clone the sibling
repos next to this one and the cross-app reads work locally exactly as they do live.*
