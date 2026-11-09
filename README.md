# Inner Board Command Center

One calm place for the Inner Board team to run the road to **1,000 paying members**: today's work, every task, the content calendar, the weekly numbers, the team, and our playbooks. Everything is editable in the browser, and every change is saved back to this repository.

## For the team

Open the site and pick who you are from the **I am…** menu. **Today** shows your work first. Tap a task to mark it done, click any text to change it, and use the Library for how we work.

## Deploy on Vercel

1. In Vercel, **Add New → Project** and import `leahtfl-spec/teamrepository`. The build settings come from `vercel.json`.
2. Under **Settings → Environment Variables**, add:

   | Name | Value |
   |------|-------|
   | `GITHUB_TOKEN` | A fine-grained GitHub token with **Contents: read and write** on `leahtfl-spec/teamrepository` only |
   | `GITHUB_REPO` | `leahtfl-spec/teamrepository` |
   | `GITHUB_BRANCH` | Optional. The branch that holds `data/`; defaults to the repo's default branch |
   | `TEAM_PASSCODE` | Optional. If set, the site asks for it once before saving edits |

3. Turn on **Settings → Deployment Protection** so only the team can open the site.
4. Redeploy. Without `GITHUB_TOKEN` and `GITHUB_REPO` the site still opens in preview mode, with changes saved on that device only.

## Local development

```
npm install
npm run dev
```

The dev server reads and writes the files in `data/` directly.

## The daily routine

A scheduled Claude routine reads the same data every morning, writes a short briefing, and nudges owners about overdue work. See [ROUTINE.md](ROUTINE.md).

## How it's built

All shared state lives in `data/hub.json` and `data/docs/`. The front end is plain HTML, CSS and JavaScript, with two small Vercel functions for reading and saving. See [ARCHITECTURE.md](ARCHITECTURE.md).
