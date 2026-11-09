# Inner Board Command Center — Architecture

A clean, minimal, fully editable team app. Static front end + two tiny Vercel functions.
**All shared state lives in this repo** (`data/`), so the web app, teammates, and the daily
Claude routine all read and write the same files.

## File layout

```
app/                 Front end (vanilla ES modules, no framework, no build step beyond copy)
  index.html
  styles.css
  main.js            router, store, sync
  ops.js             PURE shared module: applyOps(hub, ops, now) — imported by app AND server
  views/*.js         one file per screen (optional split)
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
  "brand": { "name": "Inner Board", "tagline": "The practice of becoming you." },
  "goal": { "label": "Paying members", "target": 1000, "current": 0, "deadline": "2027-11-30" },
  "people": [{
    "id": "founder|abra|michelle|clint|logan",
    "name": "Abra", "title": "Chief of Staff & Head of Growth",
    "email": "",                       // used ONLY by the daily routine for reminders; blank = never emailed
    "mission": "one sentence", "number": "the metric they own",
    "owns": ["..."], "invitation": "how they step up", "stop": ["..."],
    "remind": true                      // false = never send this person reminders (founder defaults false)
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
  "metrics": [ { "key": "newPaid", "label": "New paid members", "owner": "abra", "target": 20 } ],
  "scorecard": [ { "id": "2026-11-09", "week": "2026-11-09", "values": { "<metric key>": number|null }, "note": "" } ],
  "docs": [ { "slug": "road-to-1000", "title": "Road to 1,000", "group": "Strategy" } ],
  "briefings": [ {
    "id": "b-2026-11-09", "date": "YYYY-MM-DD", "summary": "2–4 sentence plain-English recap",
    "done": ["task ids"], "overdue": ["task ids"], "added": ["task/content ids"],
    "reminded": ["person ids"]
  } ],
  "settings": {
    "reminders": { "enabled": true, "mode": "send" | "draft", "minDaysBetween": 2,
                   "signature": "With care,\nThe Inner Board Hub" },
    "dataBranch": "claude/relaxed-maxwell-uy6zn5"
  }
}
```

## Ops (the only way state changes) — `app/ops.js`

`applyOps(hub, ops, nowIso) → newHub` — pure, never mutates input, throws `Error` on invalid op.

| op | shape | notes |
|----|-------|-------|
| upsert | `{ op:"upsert", coll, item }` | `coll` ∈ people, tasks, content, metrics, scorecard, docs, briefings. Merge `item` fields into the element with the same `id`, or append if new. For `tasks`: status→"done" sets `doneAt=now` if empty; status≠"done" clears `doneAt`. New task gets `createdAt=now` if missing. |
| remove | `{ op:"remove", coll, id }` | no-op if missing |
| set | `{ op:"set", path, value }` | dot path; root must be `brand`, `goal`, or `settings` |

Also export: `newId(prefix)` (prefix + base36 time + 4 random chars), `COLLECTIONS`, and
`report(hub, todayYYYYMMDD)` → `{ today, overdue:[task], dueSoon:[task (next 7 days)], doneSinceLastBriefing:[task], overdueByOwner:{id:[task]}, missingScorecardWeek:boolean, contentGapsNext14:[YYYY-MM-DD] }`.
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

## Screens (keep it to these six)
1. **Today** — greeting + date; goal ring/bar (current / target, deadline, weekly pace needed); latest daily briefing; *My tasks* (overdue → today → this week) with one-tap done; team at-a-glance (each person: open / overdue counts).
2. **Tasks** — one list, grouped by phase or by person (toggle); filter chips: All · Mine · Overdue · Done; quick-add row at top; click a task → side sheet with all fields.
3. **Content** — calendar list by week (date, channel, title, owner, status pill); quick-add; status cycles on click.
4. **Numbers** — goal (editable target/current/deadline) + scorecard table: rows = weeks, columns = metrics; every cell editable; "Add this week" button.
5. **Team** — person cards (title, mission, number, owns, invitation, stop doing, email, reminders on/off) all editable; Reminder settings (enabled, mode send/draft, days between).
6. **Library** — list of docs grouped by `group`; open renders markdown (vendor/marked.js); Edit → plain textarea → Save. "New page".

## Design system (high-end, calm, minimal)
- Fonts (Google Fonts): **Instrument Serif** for the wordmark and page titles; **Inter** for everything else. Body 15px/1.55.
- Tokens (`:root`; dark mode via `prefers-color-scheme` guarded by `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`):
  - light: `--bg #F7F5F1` `--surface #FFFFFF` `--ink #1B1A17` `--muted #6E6A62` `--line #E8E4DD` `--accent #2E4A3D` `--accent-soft #E7EEE9` `--danger #A6402E` `--warn #A87516`
  - dark: `--bg #121211` `--surface #1A1A18` `--ink #EDEAE4` `--muted #9A958C` `--line #2A2926` `--accent #93B8A3` `--accent-soft #1E2A23` `--danger #E0826E` `--warn #D9A84E`
- Radius 14px cards / 10px controls; hairline 1px borders; almost no shadow; generous whitespace; max content width 880px.
- One accent color only. Status = small dot + word, never loud badges. Avatars = initials in soft circles.
- Desktop: slim left rail (wordmark, 6 nav items, "I am…" at bottom). Mobile (<760px): bottom tab bar with 6 icons + short labels; 16px side gutters; no horizontal scroll.
- Inline SVG icons (simple 1.5px stroke). No emoji in UI chrome. No external JS from CDNs.
- Accessible: real buttons/inputs, focus rings, labels, ≥44px tap targets on mobile.
