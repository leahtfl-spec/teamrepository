// Task row + task sheet, shared by Today and Tasks.
import { newId, TASK_STATUSES } from "../ops.js";
import { state } from "../store.js";
import { h, icon, avatar, act, editable, removeWithUndo, toast, openSheet, closeSheet, dueLabel, fmtFull, person, ownerSelect, segmented, TASK_LABEL } from "../ui.js";

// Tasks completed during this visit stay visible (struck through) until the route changes.
export const justDone = new Set();

export const taskById = (id) => (state.hub.tasks || []).find((t) => t.id === id);

export function setTaskStatus(task, status) {
  const prev = task.status;
  if (status === "done") justDone.add(task.id); // before the re-render, so the row stays (struck through)
  if (!act([{ op: "upsert", coll: "tasks", item: { id: task.id, status } }])) return justDone.delete(task.id);
  if (status === "done") {
    toast("Marked done", { action: "Undo", onAction: () => { justDone.delete(task.id); act([{ op: "upsert", coll: "tasks", item: { id: task.id, status: prev === "done" ? "todo" : prev } }]); } });
  } else justDone.delete(task.id);
}

export function addTask(title, fields = {}) {
  const id = newId("t");
  const ok = act([{ op: "upsert", coll: "tasks", item: { id, title, owner: state.me || "", createdBy: state.me || "", ...fields } }]);
  if (ok) toast(`Added “${title.length > 40 ? title.slice(0, 39) + "…" : title}”`, { action: "Open", onAction: () => openTask(id) });
  return ok;
}

export function taskRow(t, { showOwner = true, showPhase = false } = {}) {
  const done = t.status === "done";
  const due = dueLabel(t.due, done);
  const owner = person(t.owner);
  const check = h("button", {
    type: "button", class: `check${done ? " is-done" : ""}`, role: "checkbox", "aria-checked": String(done),
    "aria-label": done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`,
    onclick: (e) => { e.stopPropagation(); setTaskStatus(t, done ? "todo" : "done"); },
  }, icon("check", 14));
  const meta = [
    t.status === "doing" && h("span", { class: "meta-doing" }, h("span", { class: "dot" }), "Doing"),
    showPhase && t.phase && h("span", { class: "meta-phase" }, t.phase),
    due.text && h("span", { class: `meta-due ${due.tone}` }, due.text),
  ].filter(Boolean);
  return h("div", { class: `row task${done ? " is-done" : ""}`, "data-id": t.id },
    check,
    h("button", { type: "button", class: "row-main", onclick: () => openTask(t.id), "aria-label": `Open task: ${t.title || "Untitled"}` },
      h("span", { class: "row-title" }, t.title || "Untitled task"),
      meta.length ? h("span", { class: "row-meta" }, meta) : null),
    showOwner && h("span", { class: "row-owner", title: owner?.name || "No owner" }, avatar(t.owner, "sm")),
  );
}

const field = (label, control) => h("div", { class: "prop" }, h("span", { class: "prop-label" }, label), h("div", { class: "prop-value" }, control));

export function openTask(id) {
  openSheet({
    label: "Task",
    render(body) {
      const t = taskById(id);
      if (!t) return false;
      const save = (item) => act([{ op: "upsert", coll: "tasks", item: { id, ...item } }]);
      const phases = [...new Set((state.hub.tasks || []).map((x) => x.phase).filter(Boolean))].sort();
      const listId = "phase-options";
      const done = t.status === "done";
      const created = person(t.createdBy)?.name || (t.createdBy === "routine" ? "the daily routine" : "");
      const due = h("input", { type: "date", class: "input input-date", value: t.due || "", "aria-label": "Due date", onchange: (e) => save({ due: e.target.value }) });
      body.replaceChildren(
        h("div", { class: "sheet-top" },
          h("span", { class: "eyebrow" }, "Task"),
          h("div", { class: "sheet-tools" },
            h("button", { type: "button", class: "icon-btn", "aria-label": "Delete task", title: "Delete task", onclick: () => { closeSheet(); removeWithUndo("tasks", t, "Task deleted"); } }, icon("trash", 18)),
            h("button", { type: "button", class: "icon-btn", "aria-label": "Close", title: "Close (Esc)", onclick: () => closeSheet() }, icon("x", 18)))),
        h("div", { class: "sheet-title" }, editable({ value: t.title, label: "Task title", placeholder: "Name this task…", multiline: true, onSave: (v) => save({ title: v }) })),
        h("div", { class: "props" },
          field("Status", segmented(TASK_STATUSES.map((s) => [s, TASK_LABEL[s]]), t.status, (v) => setTaskStatus(t, v), "Status")),
          field("Owner", h("div", { class: "with-avatar" }, avatar(t.owner, "sm"), ownerSelect(t.owner, (v) => save({ owner: v })))),
          field("Due", h("div", { class: "date-row" }, due, t.due && h("button", { type: "button", class: "link-btn", onclick: () => save({ due: "" }) }, "Clear"))),
          field("Phase", h("span", {},
            h("datalist", { id: listId }, phases.map((p) => h("option", { value: p }))),
            phaseInput(t.phase, listId, (v) => save({ phase: v })))),
        ),
        h("div", { class: "notes" },
          h("span", { class: "eyebrow" }, "Notes"),
          editable({ value: t.notes, label: "Notes", multiline: true, placeholder: "Add notes, links or context…", onSave: (v) => save({ notes: v }) })),
        h("div", { class: "sheet-foot" },
          h("button", { type: "button", class: `btn ${done ? "btn-quiet" : "btn-primary"} btn-wide`, onclick: () => setTaskStatus(t, done ? "todo" : "done") },
            icon(done ? "back" : "check", 18), done ? "Reopen task" : "Mark done"),
          h("p", { class: "fine" }, [t.createdAt && `Added ${fmtFull(t.createdAt.slice(0, 10))}${created ? ` by ${created}` : ""}`, t.doneAt && `done ${fmtFull(t.doneAt.slice(0, 10))}`].filter(Boolean).join(" · "))),
      );
    },
  });
}

function phaseInput(value, listId, onSave) {
  const input = h("input", { class: "input", value: value || "", placeholder: "No phase", list: listId, "aria-label": "Phase" });
  const commit = () => { const v = input.value.trim(); if (v !== (value || "")) { value = v; onSave(v); } };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } if (e.key === "Escape") { e.stopPropagation(); input.value = value || ""; input.blur(); } });
  return input;
}
