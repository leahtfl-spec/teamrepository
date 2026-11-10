// Small DOM toolkit shared by the views: element builder, icons, inline editing, toasts, sheets.
import { localDate, addDays, keyOf } from "./ops.js";
import { state, dispatch } from "./store.js";

// Set by main.js: re-render the current view in place (keeps scroll, no transition).
export const app = { render: () => {} };

// h("div", { class: "x", onclick }, child, [children], "text")
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid instanceof Node ? kid : String(kid));
  }
}

// ---- icons (24px grid, 1.5px stroke) ----
const P = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1"/>',
  tasks: '<rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4"/><path d="m8.5 12.2 2.4 2.3 4.6-5"/>',
  content: '<rect x="3.75" y="5" width="16.5" height="15.25" rx="3"/><path d="M3.75 9.75h16.5M8 3v3.5M16 3v3.5"/>',
  numbers: '<path d="M4 20h16"/><path d="M7 16.5V11M12 16.5V6.5M17 16.5v-3.5"/>',
  team: '<circle cx="9" cy="8.5" r="3.25"/><path d="M3.5 19.25c.6-3 2.8-4.75 5.5-4.75s4.9 1.75 5.5 4.75"/><path d="M15.5 5.6a3.25 3.25 0 0 1 0 5.8M17.6 14.8c1.5.6 2.6 2 2.9 4.45"/>',
  library: '<path d="M5 4.75h9.5A2.75 2.75 0 0 1 17.25 7.5v11.75H7.5A2.5 2.5 0 0 1 5 16.75z"/><path d="M5 16.75a2.5 2.5 0 0 1 2.5-2.5h9.75M9 8.5h4.5"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  x: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5.5 12.5 4.2 4 8.8-9.5"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  back: '<path d="M14.5 6 8.5 12l6 6"/>',
  trash: '<path d="M4.75 7h14.5M9.75 7V5.25h4.5V7M6.75 7l.8 11.25c.1 1 .9 1.75 1.9 1.75h5.1c1 0 1.8-.75 1.9-1.75L17.25 7"/>',
  edit: '<path d="M4.75 19.25h3.5L18.5 9a2.47 2.47 0 0 0-3.5-3.5L4.75 15.75z"/><path d="m13.5 7 3.5 3.5"/>',
  flag: '<path d="M6 20.25V4.5M6 4.5h10.5l-2 4 2 4H6"/>',
  sparkle: '<path d="M12 4.5c.6 3.7 1.8 4.9 5.5 5.5-3.7.6-4.9 1.8-5.5 5.5-.6-3.7-1.8-4.9-5.5-5.5 3.7-.6 4.9-1.8 5.5-5.5z"/>',
  mail: '<rect x="3.75" y="5.75" width="16.5" height="12.5" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>',
  doc: '<path d="M7 3.75h6.5l4.25 4.25v10.5A1.75 1.75 0 0 1 16 20.25H7a1.75 1.75 0 0 1-1.75-1.75V5.5A1.75 1.75 0 0 1 7 3.75z"/><path d="M13.25 3.75V8.5h4.5"/>',
  dots: '<circle cx="6.5" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="17.5" cy="12" r=".9" fill="currentColor"/>',
  arrow: '<path d="M5.5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
};
export function icon(name, size = 20) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;
  return t.content.firstChild;
}

// ---- dates ----
export const today = () => localDate();
const asDate = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (ymd, opts) => (ymd ? asDate(ymd).toLocaleDateString("en-US", opts) : "");
export const fmtDay = (ymd) => fmt(ymd, { month: "short", day: "numeric" });
export const fmtLong = (ymd) => fmt(ymd, { weekday: "long", month: "long", day: "numeric" });
export const fmtFull = (ymd) => fmt(ymd, { month: "short", day: "numeric", year: "numeric" });
export const fmtWeekday = (ymd) => fmt(ymd, { weekday: "short" });
export const daysBetween = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);

// "Today", "Tomorrow", "Thu", "Nov 30", "3 days late"
export function dueLabel(due, done = false) {
  if (!due) return { text: "", tone: "" };
  const t = today();
  const diff = daysBetween(t, due);
  if (done) return { text: fmtDay(due), tone: "" };
  if (diff < 0) return { text: diff === -1 ? "Yesterday" : `${-diff} days late`, tone: "late" };
  if (diff === 0) return { text: "Today", tone: "today" };
  if (diff === 1) return { text: "Tomorrow", tone: "" };
  if (diff < 7) return { text: fmtWeekday(due), tone: "" };
  return { text: fmtDay(due), tone: "" };
}
export { addDays };

// ---- people ----
export const people = () => state.hub.people || [];
export const person = (id) => people().find((p) => p.id === id);
export const firstName = (id) => (person(id)?.name || "").split(" ")[0];
export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "·";
  return (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : "")).toUpperCase();
}
// Teammates get distinct tints by their place on the team (Leah and Logan both read "L"); others fall back to a hash.
const tint = (id = "") => {
  const i = people().findIndex((p) => p.id === id);
  return i >= 0 ? i % 5 : [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 5;
};
export function avatar(id, size = "") {
  const p = person(id);
  if (!p) return h("span", { class: `avatar avatar-none ${size}`, title: "Unassigned", "aria-hidden": "true" });
  return h("span", { class: `avatar t${tint(p.id)} ${size}`, title: p.name, "aria-hidden": "true" }, initials(p.name));
}

// ---- status ----
export const TASK_LABEL = { todo: "To do", doing: "Doing", done: "Done" };
export const CONTENT_LABEL = { idea: "Idea", planned: "Planned", "in-edit": "In edit", scheduled: "Scheduled", posted: "Posted" };
// Rhythm groups, in calendar order: "Every day", the weekdays, then the ones with no fixed day yet.
export const RHYTHM_LABEL = { daily: "Every day", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday", weekly: "Each week", monthly: "Each month" };
export const RHYTHM_SHORT = { daily: "Every day", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun", weekly: "Each week", monthly: "Each month" };
export const status = (kind, label) => h("span", { class: `status s-${kind}` }, h("span", { class: "dot" }), label);

// ---- inline editing: click text -> input; Enter/blur saves; Esc cancels ----
export function editable({ value, onSave, placeholder = "Add…", multiline = false, type = "text", label = "", className = "", format, min }) {
  const wrap = h("span", { class: `ed ${multiline ? "ed-multi " : ""}${className}` });
  const isEmpty = (v) => v == null || v === "";
  const show = () => {
    wrap.replaceChildren(
      h("button", { type: "button", class: `ed-view${isEmpty(value) ? " is-empty" : ""}`, "aria-label": label ? `${label}: ${isEmpty(value) ? "empty" : format ? format(value) : value}. Click to edit` : null, onclick: open },
        isEmpty(value) ? placeholder : format ? format(value) : String(value)),
    );
  };
  const open = () => {
    const input = multiline ? h("textarea", { rows: 1 }) : h("input", { type, min, inputmode: type === "number" ? "decimal" : null, step: type === "number" ? "any" : null });
    input.className = "ed-input";
    input.value = value ?? "";
    if (label) input.setAttribute("aria-label", label);
    if (placeholder) input.placeholder = placeholder.replace(/…$/, "");
    let closed = false;
    const finish = (save, refocus) => {
      if (closed) return;
      closed = true;
      let v = type === "number" ? (input.value.trim() === "" ? null : Number(input.value)) : multiline ? input.value.replace(/\s+$/, "") : input.value.trim();
      if (type === "number" && v !== null && !Number.isFinite(v)) { toast("That needs to be a number."); save = false; }
      const changed = save && v !== (value ?? (type === "number" ? null : ""));
      if (changed) value = v;
      show();
      if (refocus) wrap.querySelector("button")?.focus();
      if (changed) {
        try { onSave(v); } catch (err) { toast(readable(err)); }
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !(multiline && e.shiftKey) && !e.isComposing) { e.preventDefault(); finish(true, true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false, true); }
    });
    input.addEventListener("blur", () => finish(true, false));
    if (multiline) { const fit = () => { input.style.height = "auto"; input.style.height = input.scrollHeight + 2 + "px"; }; input.addEventListener("input", fit); requestAnimationFrame(fit); }
    wrap.replaceChildren(input);
    input.focus();
    if (type !== "date" && input.select) input.select();
  };
  show();
  return wrap;
}
export const readable = (err) => String(err?.message || err).replace(/^ops\[\d+\]:\s*/, "").replace(/^./, (c) => c.toUpperCase());

// Safe dispatch: shows a toast instead of throwing.
export function act(ops) {
  try { dispatch(ops); return true; } catch (err) { toast(readable(err)); return false; }
}

// Delete with a 5-second Undo.
export function removeWithUndo(coll, item, label) {
  if (!act([{ op: "remove", coll, id: item[keyOf(coll)] }])) return;
  toast(label, { action: "Undo", onAction: () => act([{ op: "upsert", coll, item }]) });
}

// ---- toasts ----
let toastTimer;
export function toast(message, { action, onAction, timeout = 5000 } = {}) {
  const box = document.getElementById("toasts");
  if (!box) return;
  clearTimeout(toastTimer);
  const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 200); };
  const el = h("div", { class: "toast", role: "status" },
    h("span", { class: "toast-msg" }, message),
    action && h("button", { type: "button", class: "toast-action", onclick: () => { close(); onAction?.(); } }, action),
  );
  box.replaceChildren(el);
  toastTimer = setTimeout(close, timeout);
}

// ---- sheets (side panel on desktop, full screen on mobile) ----
let openSheetState = null;
export function openSheet({ label, render, onClose }) {
  closeSheet(true);
  const layer = document.getElementById("layer");
  const lastFocus = document.activeElement;
  const body = h("div", { class: "sheet-body" });
  const panel = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": label, tabindex: "-1" }, body);
  const scrim = h("div", { class: "scrim", onclick: () => closeSheet() });
  layer.replaceChildren(scrim, panel);
  document.body.classList.add("has-sheet");
  setInert(true); // keep focus inside the sheet; toasts and menus live outside #app
  const s = { panel, scrim, body, render, onClose, lastFocus };
  openSheetState = s;
  s.refresh = () => { if (render(body) === false) closeSheet(); };
  s.refresh();
  requestAnimationFrame(() => { panel.classList.add("in"); scrim.classList.add("in"); panel.focus({ preventScroll: true }); });
  return s;
}
export function closeSheet(immediate = false) {
  const s = openSheetState;
  if (!s) return;
  openSheetState = null;
  document.body.classList.remove("has-sheet");
  setInert(false);
  s.panel.classList.remove("in");
  s.scrim.classList.remove("in");
  const gone = () => { s.panel.remove(); s.scrim.remove(); };
  if (immediate) gone(); else setTimeout(gone, 220);
  s.onClose?.();
  if (!immediate && s.lastFocus?.isConnected) s.lastFocus.focus({ preventScroll: true });
}
const setInert = (on) => { const root = document.getElementById("app"); if (root) root.inert = on; };
export const sheetIsOpen = () => !!openSheetState;
export const refreshSheet = () => openSheetState?.refresh();

// ---- popovers ----
// popover(anchor, content) floats `content` next to `anchor`; closes on outside click or Esc. Returns close().
// Opening it again from the same anchor just closes it (a toggle).
export function popover(anchor, content, { align = "left", className = "", label, role = "dialog" } = {}) {
  const layer = document.getElementById("layer");
  const prev = document.querySelector(".menu");
  if (prev) {
    prev.dispatchEvent(new Event("close"));
    if (prev.anchor === anchor) return () => {};
  }
  const r = anchor.getBoundingClientRect();
  const el = h("div", { class: `menu ${className}`.trim(), role, "aria-label": label }, content);
  el.anchor = anchor;
  layer.append(el);
  const mw = el.offsetWidth, mh = el.offsetHeight;
  const below = r.bottom + 6 + mh < innerHeight;
  el.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - mh - 6)}px`;
  el.style.left = `${Math.min(innerWidth - mw - 8, Math.max(8, align === "right" ? r.right - mw : r.left))}px`;
  const onDoc = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) done(); };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); done(); anchor.focus(); } };
  function done() { el.remove(); document.removeEventListener("pointerdown", onDoc, true); document.removeEventListener("keydown", onKey, true); }
  el.addEventListener("close", done);
  setTimeout(() => { document.addEventListener("pointerdown", onDoc, true); document.addEventListener("keydown", onKey, true); });
  (el.querySelector("[aria-checked='true'], [aria-pressed='true']") || el.querySelector("button, input, select"))?.focus();
  return done;
}

export function menu(anchor, items, opts = {}) {
  let close = () => {};
  const list = items.map((it) =>
    it === "-" ? h("div", { class: "menu-sep" }) :
      h("button", { type: "button", role: "menuitem", class: `menu-item${it.active ? " is-active" : ""}${it.danger ? " is-danger" : ""}`, onclick: () => { close(); it.onClick(); } },
        it.icon, h("span", { class: "menu-label" }, it.label), it.active && icon("check", 16)));
  close = popover(anchor, list, { role: "menu", ...opts });
  return close;
}

// ---- small building blocks ----
export const pageHead = (title, sub, actions) =>
  h("header", { class: "page-head" },
    h("div", { class: "page-head-text" }, h("h1", { class: "page-title", tabindex: "-1" }, title), sub && h("p", { class: "page-sub" }, sub)),
    actions && h("div", { class: "page-actions" }, actions));

export const section = (title, extra, ...kids) =>
  h("section", { class: "section" }, h("div", { class: "section-head" }, h("h2", { class: "section-title" }, title), extra), kids);

export function quickAdd({ placeholder, onAdd, extra, label, key = "qa" }) {
  const input = h("input", { class: "qa-input", placeholder, "aria-label": label || placeholder, enterkeyhint: "done", "data-focus-key": key });
  const submit = () => {
    const v = input.value.trim();
    if (!v) return input.focus();
    input.value = "";
    if (onAdd(v) === false) input.value = v;
    if (input.isConnected) input.focus();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
  return h("div", { class: "quick-add" },
    h("span", { class: "qa-icon" }, icon("plus", 18)),
    input,
    extra,
    h("button", { type: "button", class: "btn btn-quiet qa-btn", onclick: submit }, "Add"));
}

export function ownerSelect(value, onChange, { label = "Owner", allowNone = true } = {}) {
  const sel = h("select", { class: "select", "aria-label": label, onchange: () => onChange(sel.value) },
    allowNone && h("option", { value: "" }, "No one yet"),
    people().map((p) => h("option", { value: p.id }, p.name)));
  sel.value = value || "";
  return sel;
}

export const empty = (title, text, action) =>
  h("div", { class: "empty" }, h("div", { class: "empty-mark" }, icon("sparkle", 20)), h("p", { class: "empty-title" }, title), text && h("p", { class: "empty-text" }, text), action);

export function toggle(checked, onChange, label) {
  const btn = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(!!checked), "aria-label": label,
    onclick: () => { const v = btn.getAttribute("aria-checked") !== "true"; btn.setAttribute("aria-checked", String(v)); onChange(v); } },
    h("span", { class: "switch-knob" }));
  return btn;
}

export function segmented(options, value, onChange, label) {
  return h("div", { class: "seg", role: "radiogroup", "aria-label": label },
    options.map(([v, text]) => h("button", { type: "button", role: "radio", class: "seg-btn", "aria-checked": String(v === value), onclick: () => v !== value && onChange(v) }, text)));
}

export const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "page";
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const nf = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("en-US"));
