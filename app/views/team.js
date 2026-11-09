import { newId, report } from "../ops.js";
import { state } from "../store.js";
import { app, h, icon, avatar, act, editable, removeWithUndo, pageHead, section, toggle, segmented, today, plural, people, toast } from "../ui.js";

const open = new Set();
const save = (id, item) => act([{ op: "upsert", coll: "people", item: { id, ...item } }]);
const setting = (path, value) => act([{ op: "set", path, value }]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// An editable bullet list (arrays replace on upsert, so we always send the whole list).
function listEditor(items = [], onChange, { addLabel, placeholder }) {
  const list = h("ul", { class: "bullets" }, items.map((text, i) => h("li", {},
    editable({ value: text, multiline: true, label: addLabel.replace(/^Add /, ""), placeholder, onSave: (v) => onChange(v ? items.map((x, j) => (j === i ? v : x)) : items.filter((_, j) => j !== i)) }),
    h("button", { type: "button", class: "icon-btn icon-btn-sm bullet-x", "aria-label": `Remove “${text.slice(0, 40)}”`, onclick: () => onChange(items.filter((_, j) => j !== i)) }, icon("x", 14)))));
  const adder = h("button", { type: "button", class: "link-btn add-line", onclick: () => {
    const input = h("input", { class: "input", placeholder, "aria-label": addLabel });
    let done = false;
    const finish = (ok) => { if (done) return; done = true; const v = input.value.trim(); if (ok && v) onChange([...items, v]); else input.replaceWith(adder); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.stopPropagation(); finish(false); } });
    input.addEventListener("blur", () => finish(true));
    adder.replaceWith(input);
    input.focus();
  } }, icon("plus", 15), addLabel);
  return h("div", { class: "list-editor" }, list, adder);
}

function personCard(p, rep) {
  const tasks = (state.hub.tasks || []).filter((t) => t.owner === p.id && t.status !== "done");
  const late = (rep.overdueByOwner[p.id] || []).length;
  const expanded = open.has(p.id);
  const block = (label, control) => h("div", { class: "pblock" }, h("span", { class: "eyebrow" }, label), control);
  return h("article", { class: `card person${expanded ? " is-open" : ""}`, id: `person-${p.id}` },
    h("div", { class: "person-head" },
      avatar(p.id, "lg"),
      h("div", { class: "person-id" },
        h("div", { class: "person-name" }, editable({ value: p.name, label: "Name", placeholder: "Name…", onSave: (v) => (v ? save(p.id, { name: v }) : (toast("A name is needed."), app.render())) })),
        h("div", { class: "person-title" }, editable({ value: p.title, label: "Title", placeholder: "Add a title…", onSave: (v) => save(p.id, { title: v }) }))),
      h("a", { class: "person-counts", href: `#/tasks?owner=${p.id}`, "aria-label": `${p.name}'s tasks` }, plural(tasks.length, "open task"), late ? h("span", { class: "late" }, `${late} late`) : null)),
    h("div", { class: "person-core" },
      block("Mission", editable({ value: p.mission, multiline: true, label: "Mission", placeholder: "One sentence on why this role exists…", className: "mission", onSave: (v) => save(p.id, { mission: v }) })),
      block("Their number", editable({ value: p.number, multiline: true, label: "Their number", placeholder: "The one metric they own…", className: "their-number", onSave: (v) => save(p.id, { number: v }) }))),
    expanded && h("div", { class: "person-more" },
      block("What they own", listEditor(p.owns, (v) => save(p.id, { owns: v }), { addLabel: "Add something they own", placeholder: "Something they own…" })),
      block("How they step up", editable({ value: p.invitation, multiline: true, label: "How they step up", placeholder: "The invitation for this role…", onSave: (v) => save(p.id, { invitation: v }) })),
      block("Stop doing", listEditor(p.stop, (v) => save(p.id, { stop: v }), { addLabel: "Add something to stop", placeholder: "Something to stop doing…" })),
      h("div", { class: "pblock reminders-row" },
        h("div", { class: "rem-email" }, h("span", { class: "eyebrow" }, "Email for reminders"),
          editable({ value: p.email, type: "email", label: "Email", placeholder: "Add an email…", onSave: (v) => {
            if (v && !EMAIL_RE.test(v)) { toast("That doesn't look like an email."); return app.render(); }
            save(p.id, { email: v });
          } })),
        h("label", { class: "rem-toggle" }, toggle(p.remind !== false, (v) => save(p.id, { remind: v }), `Send ${p.name} reminders`), h("span", {}, "Send reminders"))),
      h("div", { class: "person-foot" },
        h("button", { type: "button", class: "link-btn danger", onclick: () => { removeWithUndo("people", p, `${p.name} removed`); } }, icon("trash", 15), "Remove from team"))),
    h("button", { type: "button", class: "more-btn", "aria-expanded": String(expanded), onclick: () => { expanded ? open.delete(p.id) : open.add(p.id); app.render(); } },
      expanded ? "Show less" : `More about ${p.name.split(" ")[0]}`, icon("down", 16)),
  );
}

export function render() {
  const rep = report(state.hub, today());
  const r = state.hub.settings?.reminders || {};
  const noEmails = people().every((p) => !p.email);
  const addPerson = () => {
    const id = newId("p");
    if (act([{ op: "upsert", coll: "people", item: { id, name: "New teammate", title: "", email: "", mission: "", number: "", owns: [], invitation: "", stop: [], remind: true } }])) {
      open.add(id);
      app.render();
      requestAnimationFrame(() => document.querySelector(`#person-${id} .person-name .ed-view`)?.click());
    }
  };
  return h("div", { class: "page" },
    pageHead("Team", "Who owns what. Click anything to change it.", h("button", { type: "button", class: "btn btn-quiet", onclick: addPerson }, icon("plus", 16), "Add a person")),
    h("div", { class: "people" }, people().map((p) => personCard(p, rep))),
    section("Reminders", null,
      h("div", { class: "card settings" },
        h("div", { class: "setting" },
          h("div", {}, h("p", { class: "setting-title" }, "Email reminders"), h("p", { class: "setting-help" }, "Each morning the daily routine nudges owners about overdue tasks. People without an email are never emailed."),
            r.enabled !== false && noEmails ? h("p", { class: "setting-status" }, h("span", { class: "dot" }), "Paused: add an email on a person's card to start") : null),
          toggle(r.enabled !== false, (v) => setting("settings.reminders.enabled", v), "Email reminders")),
        h("div", { class: "setting" },
          h("div", {}, h("p", { class: "setting-title" }, "How they go out"), h("p", { class: "setting-help" }, r.mode === "draft" ? "Saved as drafts for someone to review and send." : "Sent straight to each person.")),
          segmented([["send", "Send"], ["draft", "Draft only"]], r.mode || "send", (v) => setting("settings.reminders.mode", v), "Reminder mode")),
        h("div", { class: "setting" },
          h("div", {}, h("p", { class: "setting-title" }, "Days between reminders"), h("p", { class: "setting-help" }, "The least time between two nudges to the same person.")),
          editable({ value: r.minDaysBetween ?? 2, type: "number", min: "0", label: "Days between reminders", className: "num-setting", onSave: (v) => { if (v == null || v < 0) return toast("Use 0 or more days."); setting("settings.reminders.minDaysBetween", Math.round(v)); } })),
        h("div", { class: "setting setting-col" },
          h("p", { class: "setting-title" }, "Sign-off"),
          editable({ value: r.signature || "", multiline: true, label: "Email sign-off", placeholder: "How reminder emails end…", className: "signature", onSave: (v) => setting("settings.reminders.signature", v) })))),
  );
}
