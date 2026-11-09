import { state, ls } from "../store.js";
import { app, h, pageHead, quickAdd, segmented, empty, person, people, avatar, today, plural, icon } from "../ui.js";
import { taskRow, addTask, justDone } from "./task-parts.js";

const pref = ls.json("ib.tasks.view") || {};
let filter = pref.filter || "all";
let group = pref.group || "phase";
let owner = "";
const remember = () => ls.set("ib.tasks.view", JSON.stringify({ filter, group }));

export function leave() { justDone.clear(); }

const byDue = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || String(a.title).localeCompare(String(b.title));

export function render({ query, fresh }) {
  if (fresh) { owner = query.get("owner") || ""; if (owner) { group = "person"; filter = "all"; } }
  const all = state.hub.tasks || [];
  const t0 = today();
  const open = all.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due && t.due < t0);
  const visible = (t) => t.status !== "done" || justDone.has(t.id);

  let list = all.filter((t) => {
    if (owner && t.owner !== owner) return false;
    if (filter === "done") return t.status === "done";
    if (!visible(t)) return false;
    if (filter === "mine") return t.owner === state.me;
    if (filter === "overdue") return !!t.due && t.due < t0;
    return true;
  });
  list = filter === "done" ? list.sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))) : list.sort(byDue);

  const chip = (id, label, count) => h("button", { type: "button", class: "chip", "aria-pressed": String(filter === id), onclick: () => { filter = id; remember(); app.render(); } },
    label, count != null && h("span", { class: "chip-count" }, count));
  const mineCount = open.filter((t) => t.owner === state.me).length;

  const groups = new Map();
  const keyFor = (t) => (group === "person" ? t.owner || "" : t.phase || "");
  if (group === "person") for (const p of people()) if (!owner || p.id === owner) groups.set(p.id, []);
  for (const t of list) { const k = keyFor(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  let entries = [...groups.entries()].filter(([, items]) => items.length);
  if (group === "phase") entries.sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "en", { numeric: true })));

  const groupHead = (k, items) => {
    const label = group === "person" ? person(k)?.name || "No owner" : k || "No phase yet";
    return h("div", { class: "group-head" },
      group === "person" && avatar(k, "xs"),
      h("h2", { class: "group-title" }, label),
      h("span", { class: "group-count" }, items.length));
  };

  const emptyState = () => {
    if (filter === "mine" && !state.me) return empty("Who are you?", "Choose your name in “I am…” to see the tasks that are yours.");
    if (filter === "overdue") return empty("Nothing overdue", "Every open task is on time. Lovely.");
    if (filter === "done") return empty("Nothing finished yet", "Tasks you mark done will collect here.");
    if (filter === "mine") return empty("Your list is clear", "Add a task above, or pick one up from the team.");
    return empty("No tasks yet", "Add the first one above. It takes a second.");
  };

  return h("div", { class: "page" },
    pageHead("Tasks", `${plural(open.length, "open task")}${overdue.length ? ` · ${overdue.length} overdue` : ""}`),
    quickAdd({ placeholder: state.me ? "Add a task for yourself…" : "Add a task…", label: "Add a task", key: "qa-tasks",
      onAdd: (title) => addTask(title, owner ? { owner } : {}) }),
    h("div", { class: "toolbar" },
      h("div", { class: "chips", role: "group", "aria-label": "Show" },
        chip("all", "All"), chip("mine", "Mine", state.me ? mineCount : null), chip("overdue", "Overdue", overdue.length || null), chip("done", "Done"),
        owner && h("button", { type: "button", class: "chip chip-person", "aria-pressed": "true", "aria-label": `Showing ${person(owner)?.name}. Clear`, onclick: () => { owner = ""; history.replaceState(null, "", "#/tasks"); app.render(); } },
          avatar(owner, "xs"), person(owner)?.name || owner, icon("x", 14))),
      segmented([["phase", "Phase"], ["person", "Person"]], group, (v) => { group = v; remember(); app.render(); }, "Group tasks")),
    entries.length
      ? h("div", { class: "groups" }, entries.map(([k, items]) => h("section", { class: "group" },
          groupHead(k, items),
          h("div", { class: "card list" }, items.map((t) => taskRow(t, { showOwner: group !== "person", showPhase: group === "person" }))))))
      : emptyState(),
  );
}
