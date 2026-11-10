import { newId, weekStart, addDays, keyOf } from "../ops.js";
import { state } from "../store.js";
import { app, h, icon, act, editable, removeWithUndo, toast, pageHead, section, today, fmtDay, fmtFull, nf, ownerSelect, person, people, avatar, empty, segmented, daysBetween } from "../ui.js";
import { goalStats, nextPaceText, awaitingBaseline, NORTH_STAR } from "./today.js";

const set = (path, value) => act([{ op: "set", path, value }]);
const LATEST = 4;          // weeks shown on desktop (the CSS keeps the latest 2 on phones)
let showEarlier = false;   // "Earlier weeks" open
let scrollToNow = false;   // after opening earlier weeks, start scrolled to this week
let editingKey = null;     // the metric whose definition is open under its row

const unit = (m) => (m.unit === "%" ? "%" : "");
const withUnit = (m) => (v) => (v == null || v === "" ? "" : `${nf(v)}${unit(m)}`);
const hasTarget = (m) => typeof m.target === "number" && Number.isFinite(m.target);
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
const midDate = (a, b) => addDays(a, Math.round(daysBetween(a, b) / 2));

export function leave() { editingKey = null; }

export function render() {
  const hub = state.hub;
  const goal = hub.goal || {};
  const t0 = today();
  const g = goalStats(goal, t0);
  return h("div", { class: "page numbers" },
    pageHead("Numbers", g.target ? `The road to ${nf(g.target)}, one week at a time.` : "One week at a time."),
    goalPanel(goal, g, t0),
    section("Weekly scorecard", null,
      h("p", { class: "section-note" }, "Updated every Friday. Click any cell to fill it in."),
      scorecard(hub.metrics || [], t0)),
  );
}

// ---------------- goal + milestones ----------------
function goalPanel(goal, g, t0) {
  const milestones = (Array.isArray(goal.milestones) ? goal.milestones : []).filter((m) => m && typeof m === "object");
  const sorted = [...milestones].sort(byDate);
  const saveAll = (list) => set("goal.milestones", [...list].sort(byDate));
  const name = goal.label || "Our goal";

  const removeMs = (m) => {
    const before = structuredClone(milestones);
    if (saveAll(sorted.filter((x) => x !== m))) toast(`Milestone ${nf(m.target)} removed`, { action: "Undo", onAction: () => set("goal.milestones", before) });
  };
  const addMs = () => {
    const last = sorted.at(-1);
    const end = goal.deadline || "";
    const capped = (date) => (end && date > end ? end : date);
    let item;
    if (!last) item = { date: capped(addDays(t0, 91)), target: Math.round((g.target || 1000) / 4) };
    else if ((end && last.date >= end) || (g.target && last.target >= g.target)) {
      // The last step already is the goal: split the final stretch rather than add a step past it.
      const prev = sorted.at(-2) || { date: t0, target: g.current };
      item = { date: midDate(prev.date, last.date), target: Math.round((prev.target + last.target) / 2) };
    } else item = { date: capped(addDays(last.date, 91)), target: g.target ? Math.min(g.target, last.target + 250) : last.target + 250 };
    const list = [...sorted, item].sort(byDate);
    const at = list.indexOf(item);
    if (saveAll(list)) requestAnimationFrame(() => document.querySelectorAll(".ms-target .ed-view")[at]?.click());
  };
  const msItem = (m) => {
    const isNext = !!g.next && m.date === g.next.date && m.target === g.next.target;
    const update = (patch) => saveAll(sorted.map((x) => (x === m ? { ...x, ...patch } : x)));
    return h("li", { class: `ms${isNext ? " is-next" : ""}${m.date < t0 ? " is-past" : ""}${g.current >= m.target ? " is-reached" : ""}` },
      h("div", { class: "ms-top" },
        h("div", { class: "ms-target" }, editable({ value: m.target, type: "number", label: `Milestone due ${fmtFull(m.date)}`, format: nf,
          onSave: (v) => (v == null ? (toast("A milestone needs a number."), app.render()) : update({ target: v })) })),
        h("button", { type: "button", class: "icon-btn icon-btn-sm ms-x", "aria-label": `Remove milestone ${nf(m.target)} by ${fmtFull(m.date)}`, title: "Remove milestone", onclick: () => removeMs(m) }, icon("x", 14))),
      h("div", { class: "ms-date" }, editable({ value: m.date, type: "date", label: `Date for milestone ${nf(m.target)}`, format: fmtFull,
        onSave: (v) => (v ? update({ date: v }) : (toast("A milestone needs a date."), app.render())) })),
      isNext ? h("span", { class: "ms-tag" }, "Next") : g.current >= m.target ? h("span", { class: "ms-tag is-done" }, "Reached") : null);
  };

  const waiting = awaitingBaseline(state.hub);
  const ticks = g.target ? sorted.filter((m) => m.target > 0 && m.target < g.target).map((m) => h("span", { class: "bar-tick", style: { left: `${(m.target / g.target) * 100}%` } })) : [];
  return h("div", { class: "card goal-panel" },
    h("div", { class: "goal-label eyebrow" }, editable({ value: goal.label, label: "What we're counting", placeholder: "What are we counting?", onSave: (v) => set("goal.label", v) })),
    h("div", { class: "goal-big" },
      editable({ value: waiting ? null : goal.current ?? 0, type: "number", label: `${name}, now`, placeholder: "—", format: nf, className: "num-xl", onSave: (v) => set("goal.current", v ?? 0) }),
      h("span", { class: "goal-of" }, "of", editable({ value: goal.target ?? 0, type: "number", label: "Target", format: nf, className: "num-target", onSave: (v) => set("goal.target", v ?? 0) }))),
    h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(g.target), "aria-valuenow": String(g.current), "aria-label": `Progress to ${nf(g.target)}` },
      h("span", { class: "bar-fill", style: { width: `${Math.max(g.pct * 100, g.current > 0 ? 1 : 0)}%` } }), ticks),
    h("div", { class: "ms-head" },
      h("span", { class: "eyebrow" }, "Milestones"),
      h("button", { type: "button", class: "link-btn", onclick: addMs }, icon("plus", 15), "Add")),
    sorted.length
      ? h("ol", { class: "ms-list" }, sorted.map(msItem))
      : h("p", { class: "ms-empty" }, "Break the goal into dated steps, like 250 by the end of March."),
    h("div", { class: "goal-foot" },
      h("p", { class: "goal-pace" }, paceLine(goal, g, t0, waiting)),
      h("p", { class: "goal-deadline" }, "Final deadline",
        editable({ value: goal.deadline || "", type: "date", label: "Final deadline", format: fmtFull, placeholder: "Set a date…", onSave: (v) => set("goal.deadline", v) }))));
}

// One plain sentence: the weekly pace to the next milestone (or to the deadline once the milestones are behind us).
function paceLine(goal, g, t0, waiting) {
  if (g.next) {
    const by = `${nf(g.next.target)} by ${fmtFull(g.next.date)}`;
    if (waiting) return `Baseline due Friday. Then we'll know the weekly pace to ${by}.`;
    if (!g.nextLeft) return `${nf(g.next.target)} reached ahead of ${fmtFull(g.next.date)}.`;
    if (g.nextPace == null) return `${nf(g.nextLeft)} to go: ${nf(g.next.target)} is due today.`;
    return `${nextPaceText(g)} to reach ${by}.`;
  }
  if (!goal.deadline) return "Set a final deadline to see the weekly pace.";
  if (goal.deadline < t0) return `${nf(g.current)} of ${nf(g.target)}. The deadline has passed.`;
  if (g.pace == null) return `${nf(g.left)} to go: ${nf(g.target)} is due today.`;
  return `Grow ${nf(g.pace)} a week to reach ${nf(g.target)} by ${fmtFull(goal.deadline)}.`;
}

// ---------------- scorecard: rows = numbers by owner, columns = weeks ----------------
function scorecard(metrics, t0) {
  const thisWeek = weekStart(t0);
  const rows = new Map();
  for (const r of state.hub.scorecard || []) if (r && (r.week || r.id)) rows.set(r.week || r.id, r);
  // Up to the latest four weeks show, never before the first scorecard week (so a new scorecard opens on "This week" alone);
  // filling a cell creates that week's row. Older rows wait behind "Earlier weeks".
  const start = [...rows.keys()].filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w) && w <= thisWeek).sort()[0] || thisWeek;
  const latest = Array.from({ length: LATEST }, (_, i) => addDays(thisWeek, (i - LATEST + 1) * 7)).filter((w) => w >= start);
  const earlier = [...rows.keys()].filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w) && w < latest[0]).sort();
  const earlierCount = earlier.length;
  const phone = matchMedia("(max-width: 759.98px)").matches; // phones show 2 of the latest weeks, so they can open up the rest
  const canExpand = earlierCount > 0 || (phone && latest.length > 2);
  const expanded = showEarlier && canExpand;
  const cols = expanded ? [...earlier, ...latest] : latest;
  const phoneHidden = new Set(expanded ? [] : latest.slice(0, -2));
  const rowId = (w) => rows.get(w)?.id || w;
  // This week's "people practicing" number is the goal's current count too, so it is entered once and moves Today's ring.
  const saveCell = (w, key, v) => act([
    { op: "upsert", coll: "scorecard", item: { id: rowId(w), week: w, values: { [key]: v } } },
    ...(key === NORTH_STAR && w === thisWeek && v != null ? [{ op: "set", path: "goal.current", value: v }] : []),
  ]);
  const span = 2 + cols.length;

  // Group by owner, in team order; numbers without a known owner go last.
  const groups = people().map((p) => [p.id, metrics.filter((m) => m.owner === p.id)]);
  groups.push(["", metrics.filter((m) => !person(m.owner))]);

  const weekHead = (w) => h("th", { scope: "col", class: `sc-week${w === thisWeek ? " is-now" : ""}${phoneHidden.has(w) ? " phone-hide" : ""}` },
    h("span", { class: "sc-week-date" }, fmtDay(w)), w === thisWeek ? h("span", { class: "now-tag" }, "This week") : null);

  const targetBits = (m) => [
    hasTarget(m) ? h("span", { class: "sc-target-num" }, withUnit(m)(m.target)) : null,
    m.targetNote ? h("span", { class: "sc-target-note", title: m.targetNote }, m.targetNote) : null,
  ].filter(Boolean);

  const metricRow = (m) => {
    const key = m[keyOf("metrics")];
    const open = editingKey === key;
    const bits = targetBits(m);
    const toggleEditor = () => { editingKey = open ? null : key; app.render(); if (!open) requestAnimationFrame(() => document.getElementById(`mf-${key}-label`)?.focus()); };
    return [
      h("tr", { class: `sc-row${open ? " is-editing" : ""}`, "data-key": key },
        h("th", { scope: "row", class: "sc-metric" },
          h("div", { class: "sc-name" },
            // Phones hide the pencil; tapping the name opens the definition instead.
            phone
              ? h("button", { type: "button", class: "sc-label sc-label-btn", "aria-expanded": String(open), "aria-label": `${m.label || "Untitled number"}. Edit this number`, onclick: toggleEditor }, m.label || "Untitled number")
              : h("span", { class: "sc-label" }, m.label || "Untitled number"),
            h("button", { type: "button", class: "icon-btn icon-btn-sm sc-edit", "aria-expanded": String(open), "aria-label": `Edit “${m.label || "this number"}”`, title: "Edit this number", onclick: toggleEditor }, icon(open ? "x" : "edit", 15))),
          m.why ? h("span", { class: "sc-why" }, m.why) : null,
          bits.length ? h("span", { class: "sc-target-inline" }, `Target: ${bits.map((b) => b.textContent).join(" · ")}`) : null),
        h("td", { class: "sc-target" }, bits.length ? bits : h("span", { class: "sc-none" }, "—")),
        cols.map((w) => {
          const v = rows.get(w)?.values?.[key] ?? null;
          const hit = hasTarget(m) && v != null && v >= m.target;
          return h("td", { class: `sc-cell${w === thisWeek ? " is-now" : ""}${hit ? " hit" : ""}${phoneHidden.has(w) ? " phone-hide" : ""}` },
            editable({ value: v, type: "number", label: `${m.label}, week of ${fmtDay(w)}`, placeholder: "—", format: withUnit(m), className: "cell-ed", onSave: (nv) => saveCell(w, key, nv) }));
        })),
      open ? h("tr", { class: "sc-editor-row" }, h("td", { colspan: String(span) }, metricEditor(m, key))) : null,
    ];
  };

  if (!metrics.length) {
    return h("div", {},
      h("div", { class: "card" }, empty("Nothing tracked yet", "Add the numbers the team looks at every week.", h("button", { type: "button", class: "btn btn-primary", onclick: addMetric }, icon("plus", 16), "Add a number"))));
  }

  // Opened up, the table is as wide as its columns (name + target + weeks, matching the CSS widths) and scrolls sideways.
  const wide = phone ? 200 + cols.length * 68 : 300 + 168 + cols.length * 92;
  const table = h("table", { class: `sc${expanded ? " is-expanded" : ""}`, style: expanded ? { width: `${wide}px` } : null },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", class: "sc-metric" }, "Number"),
      h("th", { scope: "col", class: "sc-target" }, "Target"),
      cols.map(weekHead))),
    groups.filter(([, list]) => list.length).map(([id, list]) => h("tbody", {},
      h("tr", { class: "sc-owner" }, h("th", { colspan: String(span), scope: "colgroup" },
        h("span", { class: "sc-owner-inner" }, avatar(id, "xs"), h("span", {}, person(id)?.name || "No owner yet")))),
      list.map(metricRow))));
  const wrap = h("div", { class: `table-wrap${expanded ? " is-wide" : ""}`, tabindex: expanded ? "0" : null, role: "region", "aria-label": "Weekly scorecard" }, table);
  if (expanded && scrollToNow) { scrollToNow = false; requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; }); }

  // Week notes: this week always (to add one), other shown weeks only when they have one.
  const noteWeeks = [...cols].reverse().filter((w) => w === thisWeek || rows.get(w)?.note);
  const notes = h("div", { class: "sc-notes" },
    h("span", { class: "eyebrow" }, "Week notes"),
    h("ul", {}, noteWeeks.map((w) => h("li", { class: "sc-note" },
      h("span", { class: "sc-note-week" }, w === thisWeek ? "This week" : fmtDay(w)),
      editable({ value: rows.get(w)?.note || "", multiline: true, label: `Note for the week of ${fmtDay(w)}`, placeholder: "Add a note…",
        onSave: (v) => act([{ op: "upsert", coll: "scorecard", item: { id: rowId(w), week: w, values: {}, note: v } }]) })))));

  return h("div", { class: "scorecard" },
    h("div", { class: "card card-flush" }, wrap),
    h("div", { class: "sc-actions" },
      h("button", { type: "button", class: "link-btn", onclick: addMetric }, icon("plus", 15), "Add a number"),
      canExpand ? h("button", { type: "button", class: "link-btn", "aria-expanded": String(expanded), onclick: () => { showEarlier = !expanded; scrollToNow = showEarlier; app.render(); } },
        expanded ? "Hide earlier weeks" : earlierCount ? `Earlier weeks (${earlierCount})` : "Earlier weeks", h("span", { class: `chev${expanded ? " is-open" : ""}` }, icon("down", 15))) : null),
    notes);
}

// ---------------- metric definition editor (opens under its row) ----------------
function saveMetric(key, patch) {
  return act([{ op: "upsert", coll: "metrics", item: { [keyOf("metrics")]: key, ...patch } }]);
}

function metricEditor(m, key) {
  const id = (f) => `mf-${key}-${f}`;
  const field = (f, label, control, cls = "") => h("div", { class: `mf ${cls}` }, h("label", { class: "mf-label", for: id(f) }, label), control);
  const commitOnEnter = (input, reset) => input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); reset(); input.blur(); }
  });
  // Saves wait a tick so focus has landed on the next field; the re-render then holds until focus leaves the editor.
  const later = (fn) => () => setTimeout(fn);
  const text = (f, placeholder) => {
    const input = h("input", { class: "input", id: id(f), "data-focus-key": id(f), value: m[f] ?? "", placeholder, autocomplete: "off" });
    input.addEventListener("change", later(() => {
      const v = input.value.trim();
      if (f === "label" && !v) { toast("A number needs a name."); input.value = m.label || ""; return; }
      if (v !== (m[f] ?? "")) saveMetric(key, { [f]: v });
    }));
    commitOnEnter(input, () => { input.value = m[f] ?? ""; });
    return input;
  };
  const target = h("input", { class: "input mf-num", id: id("target"), "data-focus-key": id("target"), type: "number", inputmode: "decimal", step: "any", value: hasTarget(m) ? String(m.target) : "", placeholder: "—" });
  target.addEventListener("change", later(() => {
    const raw = target.value.trim();
    const v = raw === "" ? null : Number(raw);
    if (v !== null && !Number.isFinite(v)) { toast("The target needs to be a number."); return; }
    if (v !== (hasTarget(m) ? m.target : null)) saveMetric(key, { target: v });
  }));
  commitOnEnter(target, () => { target.value = hasTarget(m) ? String(m.target) : ""; });
  const owner = ownerSelect(m.owner, (v) => saveMetric(key, { owner: v }), { label: `Owner of ${m.label}` });
  owner.id = id("owner");
  owner.dataset.focusKey = id("owner");
  const unitSeg = segmented([["", "Number"], ["%", "%"]], m.unit === "%" ? "%" : "", (v) => saveMetric(key, { unit: v }), "Unit");
  unitSeg.querySelectorAll("button").forEach((btn, i) => { btn.dataset.focusKey = id(`unit${i}`); });

  return h("div", { class: "mf-grid", role: "group", "aria-label": `Edit ${m.label || "number"}` },
    field("label", "Name", text("label", "Name this number"), "mf-name"),
    field("owner", "Owner", owner, "mf-owner"),
    field("why", "Why it matters", text("why", "One short sentence"), "mf-why"),
    h("div", { class: "mf mf-target" }, h("label", { class: "mf-label", for: id("target") }, "Target"),
      h("div", { class: "mf-target-row" }, target, unitSeg)),
    field("targetNote", "Target note", text("targetNote", "When it isn't one number"), "mf-note"),
    field("baseline", "Baseline", text("baseline", "e.g. To pull"), "mf-base"),
    h("div", { class: "mf-actions" },
      h("button", { type: "button", class: "link-btn danger", onclick: () => { editingKey = null; removeWithUndo("metrics", m, `“${m.label}” removed`); } }, icon("trash", 15), "Remove this number"),
      h("button", { type: "button", class: "btn btn-sm", onclick: () => { editingKey = null; app.render(); requestAnimationFrame(() => document.querySelector(`.sc-row[data-key="${CSS.escape(key)}"] :is(.sc-label-btn, .sc-edit)`)?.focus()); } }, "Done")));
}

function addMetric() {
  const key = newId("m").replace(/-/g, "");
  const ok = act([{ op: "upsert", coll: "metrics", item: { key, label: "New number", owner: state.me || "", unit: "", target: null, targetNote: "", why: "", baseline: "" } }]);
  if (!ok) return;
  editingKey = key;
  app.render();
  requestAnimationFrame(() => {
    const input = document.getElementById(`mf-${key}-label`);
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
    input?.focus({ preventScroll: true });
    input?.select();
  });
}
