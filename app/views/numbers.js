import { newId, weekStart, keyOf } from "../ops.js";
import { state } from "../store.js";
import { h, icon, act, editable, removeWithUndo, toast, pageHead, section, today, fmtDay, fmtFull, plural, nf, ownerSelect, person, avatar, empty } from "../ui.js";
import { goalStats } from "./today.js";

const set = (path, value) => act([{ op: "set", path, value }]);
let trackOpen = false; // "Edit what we track" stays open across re-renders once opened

// Fade the table's right edge while there are more columns to scroll to.
function markScroll(wrap) {
  wrap.classList.toggle("is-scrollable", wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
}
addEventListener("resize", () => document.querySelectorAll(".table-wrap").forEach(markScroll));

export function render() {
  const hub = state.hub;
  const goal = hub.goal || {};
  const g = goalStats(goal);
  const metrics = hub.metrics || [];
  const t0 = today();
  const thisWeek = weekStart(t0);
  // Only weeks that have started; future rows wait until their Monday.
  const rows = [...(hub.scorecard || [])].filter((r) => String(r.week || r.id) <= thisWeek).sort((a, b) => String(a.week || a.id).localeCompare(String(b.week || b.id)));
  const hasThis = rows.some((r) => r.id === thisWeek || r.week === thisWeek);
  const addWeek = () => act([{ op: "upsert", coll: "scorecard", item: { id: thisWeek, week: thisWeek, values: Object.fromEntries(metrics.map((m) => [m.key, null])), note: "" } }]);

  // ---- goal ----
  const goalCard = h("div", { class: "card goal-panel" },
    h("div", { class: "goal-label eyebrow" }, editable({ value: goal.label, label: "What we're counting", placeholder: "What are we counting?", onSave: (v) => set("goal.label", v) })),
    h("div", { class: "goal-big" },
      editable({ value: goal.current ?? 0, type: "number", label: "Members today", format: nf, className: "num-xl", onSave: (v) => set("goal.current", v ?? 0) }),
      h("span", { class: "goal-of" }, "of", editable({ value: goal.target ?? 0, type: "number", label: "Target", format: nf, className: "num-target", onSave: (v) => set("goal.target", v ?? 0) }))),
    h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(g.target), "aria-valuenow": String(g.current), "aria-label": "Progress to goal" }, h("span", { class: "bar-fill", style: { width: `${Math.max(g.pct * 100, g.current > 0 ? 1 : 0)}%` } })),
    g.pct > 0 ? h("p", { class: "goal-pct" }, `${Math.round(g.pct * 1000) / 10}% of goal`) : null,
    h("dl", { class: "goal-facts" },
      h("div", {}, h("dt", {}, "Deadline"), h("dd", {}, editable({ value: goal.deadline || "", type: "date", label: "Deadline", format: fmtFull, placeholder: "Set a date…", onSave: (v) => set("goal.deadline", v) }))),
      h("div", {}, h("dt", {}, "Still to go"), h("dd", {}, nf(g.left))),
      h("div", {}, h("dt", {}, "Weekly pace needed"), h("dd", {}, g.pace != null ? `${nf(g.pace)} a week` : "—")),
      h("div", {}, h("dt", {}, "Weeks left"), h("dd", {}, g.weeks ? String(g.weeks) : "—"))));

  // ---- scorecard ----
  const cell = (row, m) => editable({
    value: row.values?.[m.key] ?? null, type: "number", label: `${m.label}, week of ${fmtDay(row.week || row.id)}`, placeholder: "—", format: nf, className: "cell-ed",
    onSave: (v) => act([{ op: "upsert", coll: "scorecard", item: { id: row.id, values: { [m.key]: v } } }]),
  });
  const wrap = rows.length && metrics.length ? h("div", { class: "table-wrap", tabindex: "0", role: "region", "aria-label": "Weekly scorecard", onscroll: (e) => markScroll(e.currentTarget) },
    h("table", { class: "score" },
      h("thead", {}, h("tr", {},
        h("th", { class: "th-week", scope: "col" }, "Week"),
        metrics.map((m) => h("th", { scope: "col", title: m.label }, h("span", { class: "th-label" }, String(m.label || "").replace(/-/g, "\u2011")), m.target != null ? h("span", { class: "th-target" }, `Target ${nf(m.target)}`) : null)),
        h("th", { class: "th-note", scope: "col" }, "Note"),
        h("th", { class: "th-x" }, h("span", { class: "sr" }, "Remove")))),
      h("tbody", {}, rows.map((r) => {
        const w = r.week || r.id;
        return h("tr", { class: w === thisWeek ? "is-now" : "" },
          h("th", { scope: "row", class: "td-week" }, h("span", {}, fmtDay(w)), w === thisWeek ? h("span", { class: "now-tag" }, "This week") : null),
          metrics.map((m) => {
            const v = r.values?.[m.key];
            const hit = m.target != null && v != null ? (v >= m.target ? "hit" : "miss") : "";
            return h("td", { class: `td-num ${hit}` }, cell(r, m));
          }),
          h("td", { class: "td-note" }, editable({ value: r.note || "", label: `Note for week of ${fmtDay(w)}`, placeholder: "Add a note…", onSave: (v) => act([{ op: "upsert", coll: "scorecard", item: { id: r.id, note: v } }]) })),
          h("td", { class: "td-x" }, h("button", { type: "button", class: "icon-btn icon-btn-sm", "aria-label": `Remove week of ${fmtDay(w)}`, title: "Remove this week", onclick: () => removeWithUndo("scorecard", r, `Week of ${fmtDay(w)} removed`) }, icon("x", 15))));
      })))) : null;
  if (wrap) requestAnimationFrame(() => markScroll(wrap));
  const table = wrap || empty("No weeks yet", "Add this week and fill in where we are.", null);

  // ---- metric definitions ----
  const metricRow = (m) => h("div", { class: "row metric" },
    h("div", { class: "metric-name" }, editable({ value: m.label, label: "Metric name", placeholder: "Name this number…", onSave: (v) => saveMetric(m, { label: v }) })),
    h("div", { class: "metric-owner" }, avatar(m.owner, "xs"), ownerSelect(m.owner, (v) => saveMetric(m, { owner: v }), { label: `Owner of ${m.label}` })),
    h("div", { class: "metric-target" }, h("span", { class: "muted" }, "Target"), editable({ value: m.target ?? null, type: "number", label: `Weekly target for ${m.label}`, placeholder: "—", format: nf, onSave: (v) => saveMetric(m, { target: v }) })),
    h("button", { type: "button", class: "icon-btn icon-btn-sm", "aria-label": `Remove ${m.label}`, title: "Remove this number", onclick: () => removeWithUndo("metrics", m, `“${m.label}” removed`) }, icon("x", 15)));

  return h("div", { class: "page" },
    pageHead("Numbers", "The road to 1,000, one week at a time."),
    goalCard,
    section("Weekly scorecard",
      hasThis ? null : h("button", { type: "button", class: "btn btn-quiet btn-sm", onclick: addWeek }, icon("plus", 16), "Add this week"),
      h("p", { class: "section-note" }, "Updated every Friday. Click any cell to fill it in."),
      h("div", { class: "card card-flush" }, table)),
    h("details", { class: "earlier track", open: trackOpen, ontoggle: (e) => { trackOpen = e.currentTarget.open; } },
      h("summary", {}, `Edit what we track (${metrics.length})`),
      metrics.length ? h("div", { class: "card list" }, metrics.map(metricRow)) : empty("Nothing tracked yet", "Add the numbers the team looks at every week."),
      h("button", { type: "button", class: "link-btn add-line", onclick: addMetric }, icon("plus", 15), "Add a number")),
  );
}

// Metrics are identified by their `key` (keyOf("metrics")).
function saveMetric(m, patch) {
  const key = keyOf("metrics");
  if (m[key]) act([{ op: "upsert", coll: "metrics", item: { [key]: m[key], ...patch } }]);
}

function addMetric() {
  const key = newId("m").replace(/-/g, "");
  trackOpen = true;
  act([{ op: "upsert", coll: "metrics", item: { id: key, key, label: "New number", owner: state.me || "", target: null } }]);
  setTimeout(() => [...document.querySelectorAll(".metric-name .ed-view")].at(-1)?.click());
}
