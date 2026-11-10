// "Our week": the team's recurring commitments (hub.rhythm) as a calm weekly calendar on the Team page.
// The week itself (Every day · Monday … Sunday) comes first; Each week · Each month sit underneath under
// "No set day yet", so they don't read as an 8th and 9th day. Everything is editable in place.
import { newId, RHYTHM_WHEN, weekdayOf } from "../ops.js";
import { state } from "../store.js";
import { app, h, icon, avatar, act, editable, removeWithUndo, toast, popover, menu, people, person, today, firstName, RHYTHM_LABEL, RHYTHM_SHORT } from "../ui.js";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const UNDATED = ["weekly", "monthly"];
let who = "";       // filter: "" = everyone, otherwise a person id
let adding = null;  // the group whose add box is open
let noteFor = null; // the item whose (still empty) note is being written

export const setWho = (id) => { who = id && person(id) ? id : ""; };

const save = (id, patch) => act([{ op: "upsert", coll: "rhythm", item: { id, ...patch } }]);
const rowSel = (id) => `.wk-item[data-id="${CSS.escape(id)}"]`;

function addItem(when, title) {
  return act([{ op: "upsert", coll: "rhythm", item: { id: newId("r"), owner: who || state.me || "", when, title, note: "" } }]);
}

function openAdd(key) {
  adding = key;
  app.render();
  requestAnimationFrame(() => document.querySelector(`[data-focus-key="wk-add-${key}"]`)?.focus());
}

function ownerMenu(anchor, r) {
  const choose = (id) => { if (id !== r.owner) save(r.id, { owner: id }); };
  menu(anchor, [
    ...people().map((p) => ({ label: p.name, icon: avatar(p.id, "xs"), active: p.id === r.owner, onClick: () => choose(p.id) })),
    "-",
    { label: "No one yet", icon: avatar("", "xs"), active: !person(r.owner), onClick: () => choose("") },
  ]);
}

function itemMenu(anchor, r) {
  let close = () => {};
  const name = r.title || "this";
  const move = (when) => {
    close();
    if (when === r.when) return;
    if (save(r.id, { when })) toast(`Moved to ${RHYTHM_LABEL[when].replace(/^E/, "e")}`);
  };
  const when = (key, text) => h("button", { type: "button", class: "wk-when", "aria-pressed": String(r.when === key), "aria-label": RHYTHM_LABEL[key], onclick: () => move(key) }, text);
  const addNote = () => {
    close();
    noteFor = r.id;
    app.render();
    requestAnimationFrame(() => {
      document.querySelector(`${rowSel(r.id)} .wk-note .ed-view`)?.click();
      document.querySelector(`${rowSel(r.id)} .wk-note .ed-input`)?.addEventListener("blur", () => setTimeout(() => {
        if (noteFor === r.id) { noteFor = null; app.render(); } // closed without writing anything
      }));
    });
  };
  close = popover(anchor, h("div", { class: "wk-pop" },
    h("p", { class: "wk-pop-label" }, "When"),
    h("div", { class: "wk-when-grid" },
      when("daily", RHYTHM_LABEL.daily),
      h("div", { class: "wk-days" }, DAYS.map((d) => when(d, RHYTHM_SHORT[d]))),
      when("weekly", RHYTHM_LABEL.weekly),
      when("monthly", RHYTHM_LABEL.monthly)),
    h("div", { class: "menu-sep" }),
    !r.note && h("button", { type: "button", class: "menu-item lead", onclick: addNote }, icon("edit", 16), h("span", { class: "menu-label" }, "Add a note")),
    h("button", { type: "button", class: "menu-item lead is-danger", onclick: () => { close(); removeWithUndo("rhythm", r, `“${name}” removed`); } }, icon("trash", 16), h("span", { class: "menu-label" }, "Delete"))),
  { align: "right", label: `Options for ${name}` });
}

function itemRow(r) {
  const p = person(r.owner);
  return h("li", { class: "wk-item", "data-id": r.id },
    h("button", { type: "button", class: "wk-owner", "aria-haspopup": "menu", "aria-label": `${p ? p.name : "No owner yet"}. Change owner of “${r.title}”`, title: p?.name || "No owner yet", onclick: (e) => ownerMenu(e.currentTarget, r) }, avatar(r.owner, "sm")),
    h("div", { class: "wk-text" },
      h("div", { class: "wk-title" }, editable({ value: r.title, label: "What happens", placeholder: "Name it…",
        onSave: (v) => (v ? save(r.id, { title: v }) : (toast("It needs a name. To remove it, use Delete in its menu."), app.render())) })),
      r.note || noteFor === r.id
        ? h("div", { class: "wk-note" }, editable({ value: r.note, label: `Note for ${r.title}`, placeholder: "Add a note…", onSave: (v) => { noteFor = null; save(r.id, { note: v }); } }))
        : null),
    h("button", { type: "button", class: "icon-btn icon-btn-sm wk-more", "aria-haspopup": "dialog", "aria-label": `Move, add a note to or delete “${r.title}”`, title: "Move, note or delete", onclick: (e) => itemMenu(e.currentTarget, r) }, icon("dots", 18)));
}

function addRow(key) {
  const label = `Add to ${RHYTHM_LABEL[key].replace(/^E/, "e")}`;
  const input = h("input", { class: "wk-add-input", placeholder: `${label}…`, "aria-label": label, enterkeyhint: "done", "data-quick": "", "data-focus-key": `wk-add-${key}` });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = "";
      if (!addItem(key, v)) input.value = v;
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      input.value = "";
      adding = null;
      app.render();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (!input.isConnected || adding !== key) return; // re-rendered, or another group opened
    const v = input.value.trim();
    adding = null;
    if (!v || !addItem(key, v)) app.render();
  }));
  return h("li", { class: "wk-item wk-adding" }, h("span", { class: "wk-owner is-static" }, avatar(who || state.me, "sm")), input);
}

function group(key, list, isToday, cls = "wk-group") {
  return h("section", { class: `${cls}${isToday ? " is-today" : ""}`, "aria-label": RHYTHM_LABEL[key] },
    h("div", { class: "wk-label" },
      h("h3", { class: "wk-day" }, RHYTHM_LABEL[key], isToday ? h("span", { class: "wk-today" }, "Today") : null),
      adding !== key && h("button", { type: "button", class: "link-btn wk-add", "aria-label": `Add to ${RHYTHM_LABEL[key]}`, onclick: () => openAdd(key) }, icon("plus", 14), "Add")),
    h("ul", { class: "wk-items" }, list.map(itemRow), adding === key ? addRow(key) : null));
}

export function ourWeek() {
  const list = (state.hub.rhythm || []).filter((r) => r && (!who || r.owner === who));
  const byWhen = Object.fromEntries(RHYTHM_WHEN.map((k) => [k, []]));
  for (const r of list) (byWhen[r.when] || byWhen.weekly).push(r);
  const todayKey = weekdayOf(today());
  const shown = RHYTHM_WHEN.filter((k) => byWhen[k].length || adding === k);
  const free = RHYTHM_WHEN.filter((k) => !shown.includes(k));
  const dated = shown.filter((k) => !UNDATED.includes(k));
  const undated = shown.filter((k) => UNDATED.includes(k));

  // Keep the URL in step with the filter (replaceState fires no hashchange), so a reload keeps what was picked.
  const pick = (id) => {
    who = id;
    adding = null;
    history.replaceState(null, "", who ? `#/team?who=${encodeURIComponent(who)}` : "#/team");
    app.render();
  };
  const chip = (id, label, lead) => h("button", { type: "button", class: `chip${lead ? " chip-person" : ""}`, "aria-pressed": String(who === id), onclick: () => pick(id) }, lead, label);
  // Phones hide each group's "+ Add"; one Add chip opens "Each week", and the item's menu moves it to its day.
  const addAny = h("button", { type: "button", class: "gap wk-add-any", "aria-label": "Add to our week", onclick: () => openAdd("weekly") }, icon("plus", 14), "Add");
  return h("section", { class: "section week", id: "our-week", "aria-labelledby": "our-week-title" },
    h("div", { class: "section-head" }, h("h2", { class: "section-title", id: "our-week-title" }, "Our week")),
    h("div", { class: "chips wk-chips", role: "group", "aria-label": "Whose week" },
      chip("", "Everyone"),
      people().map((p) => chip(p.id, firstName(p.id) || p.name, avatar(p.id, "xs")))),
    h("div", { class: "card wk" },
      dated.length
        ? dated.map((k) => group(k, byWhen[k], k === todayKey))
        : h("p", { class: "wk-empty" }, shown.length ? "Nothing on a fixed day yet." : who ? `Nothing on ${firstName(who)}'s week yet.` : "Nothing on our week yet. Add what happens every day, every week and every month."),
      h("div", { class: `wk-free${free.length ? "" : " is-phone-only"}` },
        addAny,
        free.length ? [
          h("span", { class: "wk-free-label" }, shown.length ? "Add to" : "Start with"),
          free.map((k) => h("button", { type: "button", class: "gap", "aria-label": `Add to ${RHYTHM_LABEL[k]}`, onclick: () => openAdd(k) }, icon("plus", 14), RHYTHM_SHORT[k]))] : null)),
    undated.length ? h("section", { class: "wk-later", "aria-labelledby": "wk-later-title" },
      h("h3", { class: "wk-later-title eyebrow", id: "wk-later-title" }, "No set day yet"),
      h("div", { class: `wk-undated${undated.length > 1 ? "" : " is-single"}` }, undated.map((k) => group(k, byWhen[k], false, "wk-col")))) : null);
}
