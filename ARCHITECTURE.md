# InnerBoard Command Center — Architecture

A clean, minimal, fully editable team app for the road to **1,000 people practicing each week by
November 9, 2027** (people practice in Practice, the app; GHL runs marketing, messages and automations; the
website is the front door; Skool retires January 2027). Static front end + two tiny Vercel functions.
**All shared state lives in this repo** (`data/`), so the web app, teammates, and the daily
Claude routine all read and write the same files.

## File layout

```
app/                 Front end (vanilla ES modules, no framework, no build step beyond copy)
  index.html
  styles.css
  main.js            router, store, sync
  ops.js             PURE shared module: applyOps(hub, ops, now) — imported by app AND server
  views/*.js         one file per screen; week.js = Team's "Our week" calendar (rhythm), task-parts.js = shared task row/sheet
api/
  data.js            GET hub / POST ops            (Vercel Node function)
  doc.js             GET / PUT one markdown doc     (Vercel Node function)
lib/
  store.js           storage adapter: GitHub contents API (prod) or local files (dev)
data/
  hub.json           THE database (see schema)
  docs/<slug>.md     playbooks / library pages (markdown)
scripts/
  build.mjs          copies app/ → dist/, data/ → dist/data/ (fallback snapshot), marked → dist/vendor/
  dev.mjs            local server: serves dist/ + /api/* using local file storage
  hub.mjs            CLI: `node scripts/hub.mjs apply <ops.json>` and `node scripts/hub.mjs report [YYYY-MM-DD]`
test/                node --test unit tests (ops, store-local, api handlers)
ROUTINE.md           what the daily Claude routine does, step by step
vercel.json
```

Hash routing only (`#/today`, `#/tasks`, `#/content`, `#/numbers`, `#/team`, `#/library/<slug>`) — no rewrites needed.

## data/hub.json schema

```jsonc
{
  "version": 1,
  "updatedAt": "ISO timestamp",
  "brand": { "name": "InnerBoard", "tagline": "The practice of becoming you." },   // one word, everywhere
  "goal": {
    "label": "People practicing each week",           // shown wherever the goal is named (Today, Numbers)
    "target": 1000, "current": 0, "deadline": "2027-11-09",
    "milestones": [                                    // optional; validated on every set that touches it
      { "date": "2027-03-31", "target": 250 }, { "date": "2027-06-30", "target": 500 },
      { "date": "2027-09-30", "target": 750 }, { "date": "2027-11-09", "target": 1000 }
    ]                                                  // each { date: YYYY-MM-DD, target: number }; extra keys kept
  },
  "people": [{
    "id": "founder|abra|michelle|clint|logan",
    "name": "Abra", "title": "Chief of Staff & Head of Growth",
    "email": "",                       // used ONLY by the daily routine for reminders; blank = never emailed
    "mission": "one sentence", "number": "the metric they own",
    "owns": ["..."], "invitation": "how they step up", "stop": ["..."],
    "remind": true,                     // false = never send this person reminders (founder defaults false)
    "doc": "abra-role"                  // optional slug of the Library page with their full role; "" = none yet.
                                        // Team shows "Read <Name>'s full role" when set. Adding Clint's later is one step:
                                        // write data/docs/clint-role.md + a docs entry (group "Roles"), then set doc
                                        // (one upsert, or pick it under "Full role page" on his Team card).
  }],
  "tasks": [{
    "id": "t-xxxx", "title": "...", "owner": "<person id>",
    "due": "YYYY-MM-DD" | "", "status": "todo" | "doing" | "done",
    "phase": "Phase 0 · Decide" | "Weekly" | "...", "notes": "",
    "createdAt": "ISO", "createdBy": "<person id>|routine",
    "doneAt": "ISO" | null, "lastRemindedAt": "YYYY-MM-DD" | null
  }],
  "content": [{
    "id": "c-xxxx", "date": "YYYY-MM-DD", "channel": "Instagram", "pillar": "Education",
    "format": "Reel", "title": "hook / topic", "owner": "clint",
    "status": "idea" | "planned" | "in-edit" | "scheduled" | "posted", "link": ""
  }],
  "metrics": [ {
    "key": "day30Retention", "label": "Still practicing at day 30", "owner": "michelle",
    "target": 40,                       // number | null
    "unit": "%",                        // optional: "" (a count) or "%"; anything else is rejected
    "why": "Shows whether Practice is a place people don't want to miss",   // optional short sentence (second line on Numbers)
    "targetNote": "50% by mid-2027",    // optional short text, for when the target isn't one number
    "baseline": "To pull"               // optional text
  } ],
  "scorecard": [ { "id": "2026-11-09", "week": "2026-11-09", "values": { "<metric key>": number|null }, "note": "" } ],
  "docs": [ { "slug": "road-to-1000", "title": "Road to 1,000", "group": "Strategy" } ],   // group "Roles" lists first
  "rhythm": [ {                         // recurring commitments: the team's daily / weekly calendar (Team → "Our week")
    "id": "r-…", "owner": "<person id>" | "",
    "when": "daily" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | "weekly" | "monthly",
                                        // "weekly" / "monthly" = no fixed day yet (note may say e.g. "First Monday")
    "title": "Team meeting", "note": "" // new items default to owner "", when "weekly", title "", note ""
  } ],
  "briefings": [ {
    "id": "b-2026-11-09", "date": "YYYY-MM-DD", "summary": "2–4 sentence plain-English recap",
    "done": ["task ids"], "overdue": ["task ids"], "added": ["task/content ids"],
    "reminded": ["person ids"]
  } ],
  "settings": {
    "reminders": { "enabled": true, "mode": "send" | "draft", "minDaysBetween": 2,
                   "signature": "With care,\nThe InnerBoard Hub" },
    "dataBranch": "claude/relaxed-maxwell-uy6zn5"
  }
}
```

## Ops (the only way state changes) — `app/ops.js`

`applyOps(hub, ops, nowIso) → newHub` — pure, never mutates input, throws `Error` on invalid op.

| op | shape | notes |
|----|-------|-------|
| upsert | `{ op:"upsert", coll, item }` | `coll` ∈ people, tasks, content, metrics, scorecard, docs, briefings, rhythm. Merge `item` fields into the element with the same key (`id`; `slug` for docs, `key` for metrics), or append if new (with that collection's defaults). For `tasks`: status→"done" sets `doneAt=now` if empty; status≠"done" clears `doneAt`. New task gets `createdAt=now` if missing. Validation: `rhythm.when` ∈ `RHYTHM_WHEN`, rhythm owner/title/note are text; `metrics.unit` ∈ `""`, `"%"`. |
| remove | `{ op:"remove", coll, id }` | no-op if missing |
| set | `{ op:"set", path, value }` | dot path; root must be `brand`, `goal`, or `settings`. Setting `goal` (with `milestones`) or `goal.milestones` validates the list; paths into it (`goal.milestones.0`) are refused, send the whole list. |

Also export: `newId(prefix)` (prefix + base36 time + 4 random chars), `COLLECTIONS`, `RHYTHM_WHEN`, `METRIC_UNITS`,
`weekdayOf(ymd)` → `"mon"…"sun"`, `nextMilestone(goal, today)` → `{ date, target }` (first milestone on/after today) or `null`, and
`report(hub, todayYYYYMMDD)` → `{ today, overdue:[task], dueSoon:[task (next 7 days)], doneSinceLastBriefing:[task], overdueByOwner:{id:[task]}, missingScorecardWeek:boolean, contentGapsNext14:[YYYY-MM-DD (days with no social post; newsletter/email items don't fill a day)], rhythmToday:[rhythm (every "daily" item, then today's weekday)], nextMilestone:{date,target}|null }`.
`emptyHub()` includes `rhythm: []`; a hub saved before `rhythm` existed gets the list on its first rhythm upsert.
`updatedAt` is stamped by applyOps.

## API

`GET /api/data` → `200 { hub, sha, source: "github"|"local"|"bundle", canWrite: boolean }`
- reads live data/hub.json via the store; if store not configured → `source:"bundle"`, `canWrite:false`, hub from the deployed snapshot (`dist/data/hub.json`, read from disk or `fetch` of `/data/hub.json`).

`POST /api/data` body `{ ops:[...] }`, header `x-team-passcode` (only checked if env `TEAM_PASSCODE` is set)
→ load latest + sha, `applyOps`, write with sha; on sha conflict retry up to 3× → `200 { hub, sha }`.
Errors: `400` bad op, `401` passcode, `503 { error:"not-configured" }` when no storage.
Commit message: `Hub: <short summary of ops>`.

`GET /api/doc?slug=x` → `{ slug, markdown, sha }`; `PUT /api/doc` `{ slug, markdown }` → `{ slug, sha }`.
Slug must match `/^[a-z0-9-]{1,60}$/`.

All responses `Cache-Control: no-store`, JSON.

### Storage adapter (`lib/store.js`)
- **GitHub** when env `GITHUB_TOKEN` and `GITHUB_REPO` (`owner/name`) are set; branch = `GITHUB_BRANCH` or repo default. Contents API GET/PUT with sha.
- **Local** when `HUB_DATA_DIR` is set (dev server sets it to `./data` unless overridden; tests point it at a temp copy). Sha = content hash.
- Otherwise **not configured**.

## Vercel
`vercel.json`: `buildCommand: npm run build`, `outputDirectory: dist`,
`ignoreCommand: git diff --quiet HEAD^ HEAD -- . ':(exclude)data'` (data-only commits from the app/routine don't trigger rebuilds — the app reads live data through the API).
Env vars: `GITHUB_TOKEN` (fine-grained, Contents read/write on this repo), `GITHUB_REPO`, `GITHUB_BRANCH` (optional), `TEAM_PASSCODE` (optional).

## Front-end behavior
- **Store + sync:** on load GET /api/data. Every edit = ops → applied locally at once (optimistic) → queued → debounced (~700 ms) POST. On success replace hub with server hub. On 401 ask for passcode once (remember in localStorage). On failure keep local, show a quiet toast, retry later.
- **Preview mode:** if `canWrite:false`, edits still work and persist to `localStorage` (key `ib.hub.local`), with one small pill: "Preview — changes saved on this device only".
- Refetch every 60 s while the tab is visible and nothing is pending.
- **"I am…" switcher** (top right, remembered in localStorage): Today shows that person's work first.
- Everything editable in place: click text to edit, Enter/blur saves, Esc cancels. Add buttons on every list. Delete with a 5-second Undo toast.
  Re-renders wait while a field has focus or a pointer is down (so clicking from one field into another opens the second), then run.

## Screens (keep it to these six)
1. **Today** — greeting + date; goal ring (current / target, named by `goal.label`) with the next milestone ("Next: 250 by Mar 31, 2027") and the weekly pace from `current` to it. Until a baseline exists (`goal.current` is 0 and no scorecard week has `practicingWeekly`) the ring shows "—" and "Baseline due Friday"; after the last milestone it shows the deadline pace, or "deadline passed". Latest daily briefing; *Your rhythm today* (the selected person's daily + today's-weekday rhythm items as plain dots, not checkboxes, then one muted "Also this week: …" line naming their `weekly` items; hidden if none; linking to `#/team?who=<id>`); *My tasks* (overdue → today → this week) with one-tap done; team at-a-glance (each person: open / overdue counts).
2. **Tasks** — one list, grouped by phase or by person (toggle); filter chips: All · Mine · Overdue · Done; quick-add row at top; click a task → side sheet with all fields.
3. **Content** — calendar list by week (date, channel, title, owner, status pill); quick-add; status cycles on click.
4. **Numbers** — goal panel (editable label/current/target; milestones as an editable timeline under the bar, with add/remove: Add steps 91 days / 250 on from the last one, capped at the deadline, or splits the final stretch when the last one already is the goal; then one plain pace line, "Grow 13 a week for 21 weeks to reach 250 by Mar 31, 2027.", and a small editable "Final deadline") + scorecard: rows = metrics grouped by owner, each showing label, muted `why`, and target (number + unit, and/or `targetNote`); columns = the latest 4 weeks (Mondays; 2 on phones) but never before the first scorecard week, so a new scorecard opens on "This week" alone, with "Earlier weeks" opening older scorecard rows (or, on phones, the hidden latest weeks) in a sideways-scrolling table. Every cell editable (filling one creates that week's row); "%" metrics show the unit. This week's `practicingWeekly` cell also sets `goal.current` (the north-star number is entered once). A small edit button on each row (on phones: tapping the number's name) opens the metric's definition (label, owner, why, target, unit, target note, baseline, remove) under it. "Add a number" below. Week notes (this week + any shown week with one) under the table.
5. **Team** — *Our week* first: the team calendar built from `rhythm`, grouped Every day · Monday … Sunday (today's weekday tinted; empty groups collapse into "Add to" chips), then a quieter "No set day yet" block underneath with Each week · Each month side by side (stacked on phones). Filter chips Everyone + each person (`?who=<id>` preselects; picking a chip updates the URL with `replaceState`). Each item = owner avatar (click → owner menu) + title + muted note, edited in place; its ⋯ menu moves it to another day, adds a note, or deletes it (Undo). Phones hide each group's "+ Add" and show one "Add" chip instead (it adds to Each week; the item's menu moves it). Then *Who owns what*: person cards (title, mission, number, owns, invitation, stop doing, full role page, email, reminders on/off) all editable, with a quiet "Read <Name>'s full role" link when `doc` is set; Reminder settings (enabled, mode send/draft, days between).
6. **Library** — list of docs grouped by `group` ("Roles" first); open renders markdown (vendor/marked.js) as a reading page: a quiet Edit link on the "Library" back-link row; Edit → plain textarea → Save, and the remove-page button shows only while editing. On phones, tables stack into one block per row with each cell under its column name. "New page".

## Design system (high-end, calm, minimal)
- Brand: the wordmark and `<title>` read `hub.brand.name` ("InnerBoard", one word); `app/index.html` carries the same name as the pre-load fallback. No other copy of the name is hard-coded in `app/`.
- Fonts (Google Fonts): **Instrument Serif** for the wordmark and page titles; **Inter** for everything else. Body 15px/1.55.
- Tokens (`:root`; dark mode via `prefers-color-scheme` guarded by `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`):
  - light: `--bg #F7F5F1` `--surface #FFFFFF` `--ink #1B1A17` `--muted #6E6A62` `--line #E8E4DD` `--accent #2E4A3D` `--accent-soft #E7EEE9` `--danger #A6402E` `--warn #A87516`
  - dark: `--bg #121211` `--surface #1A1A18` `--ink #EDEAE4` `--muted #9A958C` `--line #2A2926` `--accent #93B8A3` `--accent-soft #1E2A23` `--danger #E0826E` `--warn #D9A84E`
- Radius 14px cards / 10px controls; hairline 1px borders; almost no shadow; generous whitespace; max content width 880px.
- One accent color only. Status = small dot + word, never loud badges. Avatars = initials in soft circles.
- Desktop: slim left rail (wordmark, 6 nav items, "I am…" at bottom). Mobile (<760px): bottom tab bar with 6 icons + short labels; 16px side gutters; no horizontal scroll.
- Inline SVG icons (simple 1.5px stroke). No emoji in UI chrome. No external JS from CDNs.
- Accessible: real buttons/inputs, focus rings, labels, ≥44px tap targets on mobile.
