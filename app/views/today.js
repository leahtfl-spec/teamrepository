import { report, addDays, nextMilestone } from "../ops.js";
import { state, setMe } from "../store.js";
import { h, icon, avatar, people, person, today, fmtLong, fmtDay, fmtFull, daysBetween, quickAdd, plural, nf, empty, toast, RHYTHM_LABEL } from "../ui.js";
import { taskRow, addTask, justDone, taskById } from "./task-parts.js";

let briefOpen = false;
export function leave() { justDone.clear(); }

// Long briefings are clamped to three lines; "Read more" appears only when the text is cut.
function briefText(summary) {
  const p = h("p", { class: `brief-text${briefOpen ? " is-open" : ""}` }, summary);
  const btn = h("button", { type: "button", class: "link-btn brief-more", hidden: true, "aria-expanded": String(briefOpen),
    onclick: () => { briefOpen = !briefOpen; p.classList.toggle("is-open", briefOpen); btn.textContent = briefOpen ? "Show less" : "Read more"; btn.setAttribute("aria-expanded", String(briefOpen)); } },
    briefOpen ? "Show less" : "Read more");
  requestAnimationFrame(() => { btn.hidden = !briefOpen && p.scrollHeight <= p.clientHeight + 1; });
  return [p, btn];
}

const greeting = () => { const hr = new Date().getHours(); return hr < 5 ? "Good evening" : hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"; };

// Where the goal stands, and the weekly pace to the deadline and to the next milestone.
export function goalStats(goal = {}, t0 = today()) {
  const target = Number(goal.target) || 0;
  const current = Number(goal.current) || 0;
  const left = Math.max(0, target - current);
  const weeks = goal.deadline ? Math.max(0, daysBetween(t0, goal.deadline) / 7) : 0;
  const pace = weeks > 0 ? Math.ceil(left / weeks) : null;
  const next = nextMilestone(goal, t0);
  const nextLeft = next ? Math.max(0, next.target - current) : 0;
  const nextWeeks = next ? Math.max(0, daysBetween(t0, next.date) / 7) : 0;
  const nextPace = next && nextWeeks > 0 ? Math.ceil(nextLeft / nextWeeks) : null;
  return { target, current, left, weeks: Math.ceil(weeks), pace, pct: target ? Math.min(1, current / target) : 0, next, nextLeft, nextWeeks: Math.ceil(nextWeeks), nextPace };
}

// The scorecard row that counts the goal itself: this week's value is also goal.current (see Numbers).
export const NORTH_STAR = "practicingWeekly";

// Until the first count is in (goal still 0, no week filled), show "—" rather than a 0 that reads as "nobody".
export const awaitingBaseline = (hub) =>
  !Number(hub?.goal?.current) && !(hub?.scorecard || []).some((r) => r?.values?.[NORTH_STAR] != null);

// "Grow 13 a week for 21 weeks": the pace from where we are to the next milestone.
export function nextPaceText(g) {
  if (!g.next) return "";
  if (!g.nextLeft) return "Reached. On to the next one.";
  if (g.nextPace == null) return `${nf(g.nextLeft)} to go, due today`;
  return `Grow ${nf(g.nextPace)} a week for ${plural(g.nextWeeks, "week")}`;
}

function ring(pct) {
  const r = 52, c = 2 * Math.PI * r;
  const t = document.createElement("template");
  t.innerHTML = `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-track" cx="60" cy="60" r="${r}"/>${pct <= 0 ? "" : `<circle class="ring-fill" cx="60" cy="60" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 60 60)"/>`}</svg>`;
  return t.content.firstChild;
}

export function render() {
  const hub = state.hub;
  const t0 = today();
  const rep = report(hub, t0);
  const me = person(state.me);
  const g = goalStats(hub.goal);
  const tasks = hub.tasks || [];

  // ---- goal ----
  const goalName = hub.goal?.label || "Our goal";
  const waiting = awaitingBaseline(hub);
  const deadline = hub.goal?.deadline || "";
  const goalLines = g.next
    ? [`Next: ${nf(g.next.target)} by ${fmtFull(g.next.date).replace(/ /g, "\u00a0")}`, waiting ? "Baseline due Friday" : nextPaceText(g)]
    : !deadline ? ["Set a deadline on Numbers", waiting ? "Baseline due Friday" : ""]
    : deadline < t0 ? [`${nf(g.current)} of ${nf(g.target)} · deadline passed`, ""]
    : [g.pace != null ? `${nf(g.pace)} a week gets us there` : `${nf(g.left)} to go, due today`, waiting ? "Baseline due Friday" : `by ${fmtFull(deadline)} · ${plural(g.weeks, "week")} left`];
  const goalCard = h("a", { class: "card goal-card", href: "#/numbers", "aria-label": `${goalName}: ${waiting ? "baseline due Friday" : nf(g.current)} of ${nf(g.target)}.${g.next ? ` Next milestone ${nf(g.next.target)} by ${fmtFull(g.next.date)}.` : ""} Open Numbers` },
    h("div", { class: "ring-wrap" }, ring(g.pct), h("div", { class: "ring-center" }, h("span", { class: `ring-num${waiting ? " is-waiting" : ""}` }, waiting ? "—" : nf(g.current)), h("span", { class: "ring-of" }, `of ${nf(g.target)}`))),
    h("div", { class: "goal-text" },
      h("span", { class: "eyebrow goal-eyebrow" }, goalName),
      h("p", { class: "goal-line" }, goalLines[0]),
      goalLines[1] ? h("p", { class: "goal-sub" }, goalLines[1]) : null,
      rep.missingScorecardWeek
        ? h("span", { class: "goal-nudge" }, h("span", { class: "dot" }), "This week's numbers aren't in yet")
        : null));

  // ---- briefing ----
  const latest = [...(hub.briefings || [])].filter((b) => b.date <= t0).sort((a, b) => b.date.localeCompare(a.date))[0];
  const briefCard = h("article", { class: "card brief-card" },
    h("div", { class: "brief-head" },
      h("span", { class: "eyebrow" }, icon("sparkle", 14), "Daily briefing"),
      latest && h("span", { class: "brief-date" }, latest.date === t0 ? "This morning" : fmtDay(latest.date))),
    latest
      ? briefText(latest.summary)
      : h("p", { class: "brief-text muted" }, "The first briefing arrives tomorrow morning. It sums up what got done, what's late, and who was nudged."),
    latest && (latest.done?.length || latest.overdue?.length || latest.added?.length) ? h("div", { class: "brief-stats" },
      latest.done?.length ? h("span", {}, h("strong", {}, latest.done.length), " done") : null,
      latest.overdue?.length ? h("span", {}, h("strong", {}, latest.overdue.length), " overdue") : null,
      latest.added?.length ? h("span", {}, h("strong", {}, latest.added.length), " added") : null) : null);

  // ---- my tasks ----
  let mine;
  if (!me) {
    mine = h("div", { class: "card who" },
      h("p", { class: "who-title" }, "Who's here?"),
      h("p", { class: "muted" }, "Pick your name and Today will show your work first. You can change it any time."),
      h("div", { class: "who-list" }, people().map((p) => h("button", { type: "button", class: "who-btn", onclick: () => { setMe(p.id); toast(`Welcome, ${p.name.split(" ")[0]}.`); } }, avatar(p.id), h("span", {}, p.name)))));
  } else {
    const weekEnd = addDays(t0, 7);
    const own = tasks.filter((t) => t.owner === me.id && (t.status !== "done" || justDone.has(t.id)));
    const byDue = (a, b) => (a.due || "").localeCompare(b.due || "") || String(a.title).localeCompare(String(b.title));
    const buckets = [
      ["Overdue", own.filter((t) => t.due && t.due < t0).sort(byDue), "late"],
      ["Today", own.filter((t) => t.due === t0 || (t.status === "doing" && (!t.due || t.due > weekEnd))).sort(byDue), ""],
      ["This week", own.filter((t) => t.due > t0 && t.due <= weekEnd).sort(byDue), ""],
    ].filter(([, list]) => list.length);
    const later = own.filter((t) => t.status !== "done" && (!t.due || t.due > weekEnd) && t.status !== "doing").length;
    mine = h("div", { class: "my-tasks" },
      quickAdd({ placeholder: "Add a task for today…", label: "Add a task for today", key: "qa-today", onAdd: (title) => addTask(title, { due: t0 }) }),
      buckets.length
        ? buckets.map(([label, list, tone]) => h("div", { class: "bucket" },
            h("div", { class: `bucket-head ${tone}` }, h("span", {}, label), h("span", { class: "group-count" }, list.length)),
            h("div", { class: "card list" }, list.map((t) => taskRow(taskById(t.id) || t, { showOwner: false })))))
        : empty("Nothing due this week", "Enjoy the quiet, or pick something up from your list.", null),
      later ? h("a", { class: "more-link", href: `#/tasks?owner=${me.id}` }, `${plural(later, "more task")} later on your list`, icon("chevron", 16)) : null);
  }

  // ---- my rhythm today (every-day items, then today's weekday) ----
  // Weekly items have no fixed day yet, so they never land on "today": name them once underneath instead.
  const myRhythm = me ? rep.rhythmToday.filter((r) => r.owner === me.id) : [];
  const weekHref = me ? `#/team?who=${encodeURIComponent(me.id)}` : "#/team";
  const myWeekly = me ? (hub.rhythm || []).filter((r) => r && r.owner === me.id && r.when === "weekly" && r.title).map((r) => r.title.split(":")[0].trim()) : [];
  const rhythm = myRhythm.length || myWeekly.length ? h("section", { class: "section today-rhythm" },
    h("div", { class: "section-head" }, h("h2", { class: "section-title" }, "Your rhythm today"), h("a", { class: "section-link", href: weekHref }, "Full week")),
    myRhythm.length ? h("ul", { class: "card rhythm-list" }, myRhythm.map((r) => h("li", { class: "rhythm-item" },
      h("span", { class: "rhythm-mark", "aria-hidden": "true" }),
      h("span", { class: "rhythm-text" }, h("span", { class: "rhythm-title" }, r.title || "Untitled"), r.note ? h("span", { class: "rhythm-note" }, r.note) : null),
      r.when === "daily" ? null : h("span", { class: "rhythm-when" }, `${RHYTHM_LABEL[r.when]}s`)))) : null,
    myWeekly.length ? h("a", { class: "rhythm-also", href: weekHref }, h("span", { class: "rhythm-also-label" }, "Also this week: "), myWeekly.join(" · ")) : null) : null;

  // ---- team at a glance ----
  const glance = h("div", { class: "glance" }, people().map((p) => {
    const open = tasks.filter((t) => t.owner === p.id && t.status !== "done").length;
    const late = (rep.overdueByOwner[p.id] || []).length;
    return h("a", { class: `card glance-card${p.id === state.me ? " is-me" : ""}`, href: `#/tasks?owner=${p.id}`, "aria-label": `${p.name}: ${open} open, ${late} overdue` },
      avatar(p.id),
      h("span", { class: "glance-name" }, p.name.split(" ")[0]),
      h("span", { class: "glance-counts" }, h("span", {}, `${open} open`), late ? h("span", { class: "late" }, `${late} late`) : null));
  }));

  return h("div", { class: "page today" },
    h("header", { class: "page-head" },
      h("div", { class: "page-head-text" },
        h("span", { class: "eyebrow date-eyebrow" }, fmtLong(t0)),
        h("h1", { class: "page-title", tabindex: "-1" }, me ? `${greeting()}, ${me.name.split(" ")[0]}.` : `${greeting()}.`))),
    h("div", { class: "today-top" }, goalCard, briefCard),
    rhythm,
    h("section", { class: "section today-tasks" },
      h("div", { class: "section-head" }, h("h2", { class: "section-title" }, "Your tasks"), me && h("a", { class: "section-link", href: "#/tasks" }, "All tasks")),
      mine),
    h("section", { class: "section today-glance" },
      h("div", { class: "section-head" }, h("h2", { class: "section-title" }, "Team at a glance"), h("a", { class: "section-link", href: "#/team" }, "Team")),
      glance),
  );
}
