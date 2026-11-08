# Inner Board — Team Hub

How a lean team takes the practice to **1,000 members**: who owns what, what we do every week, and how we measure it.

> Every number in here is a **starting assumption** until we replace it with real data.

## Start here

1. [**Roles & Titles**](team/roles.md): who owns what, and what each person is invited to step into
2. [**Road to 1,000**](strategy/road-to-1000.md): the goal, the funnel math, and the 10 things we need
3. [**Rollout Plan**](strategy/rollout-plan.md): phases from now through gift season, New Year and beyond
4. [**Scorecard**](strategy/scorecard.csv): the weekly numbers (Abra updates it every Friday)

## The team

```
                    Founder — Voice of Inner Board
                                 │
              Abra — Chief of Staff & Head of Growth
                    ┌────────────┴────────────┐
   Michelle — COO & Head of             Clint — Creative Director
     Member Experience
           │
     Logan — App Lead
```

| Person | Title | Owns |
|--------|-------|------|
| Founder | Founder & Voice of Inner Board | The teaching, podcast, videos, masterclasses |
| Abra | Chief of Staff & Head of Growth | The 1,000 number, scorecard, offers, podcast growth, partnerships |
| Michelle | COO & Head of Member Experience | Masterclass delivery, app assets, onboarding, community, merch fulfillment |
| Clint | Creative Director | Brand, content, podcast production, Rep of the Day, merch design |
| Logan | App Lead | App uploads, gift codes, app numbers |

## Everything in here

| Section | Pages |
|---------|-------|
| Strategy | [Road to 1,000](strategy/road-to-1000.md) · [Rollout Plan](strategy/rollout-plan.md) · [Scorecard](strategy/scorecard.csv) · [Critique of v1](strategy/critique.md) |
| Team | [Roles & Titles](team/roles.md) · [Weekly Cadence](schedule/weekly-cadence.md) |
| Growth & community | [Becoming You podcast](playbooks/podcast.md) · [Rep of the Day group](playbooks/community-rep-of-the-day.md) · [Gift the Practice (merch)](playbooks/gift-the-practice.md) |
| Content | [Content Calendar](schedule/content-calendar.csv) · [What to Post](playbooks/what-to-post.md) · [How to Engage](playbooks/how-to-engage.md) |
| Delivery | [Masterclass Pipeline](workflows/masterclass-pipeline.md) · [Membership Assets](workflows/membership-assets.md) |

## How we track tasks

Every piece of work is a **GitHub Issue**, assigned to one person, with a due date.
Click **Issues → New issue** and pick a template:

- **Masterclass** — creates the full checklist for one masterclass (recording through app upload)
- **Content task** — a single post, clip, or piece of content
- **Weekly leadership meeting**: Abra's Monday meeting, run from the scorecard

Use the labels `michelle`, `clint`, `logan`, `abra` (or assign the person) so anyone can filter "what's on my plate."

**Be honest about this:** if the team won't open GitHub every day, run tasks in the tool they already use daily. Use this site to read the plan and the scorecard to track the numbers.

## Website (Vercel)

This repo builds into a simple website so the team can read everything in a browser.

- **Edit** the Markdown files or `schedule/content-calendar.csv`, commit, push — Vercel rebuilds the site automatically.
- **Preview locally:** `npm install` then `npm run dev`.
- Build settings live in `vercel.json` (build command `npm run build`, output folder `dist`).
- **Turn on Deployment Protection in Vercel.** This site describes internal roles and plans; it shouldn't be public.
