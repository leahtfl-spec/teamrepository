// Shell: router, navigation, "I am…" switcher, sync status, preview pill, passcode prompt.
import { state, hooks, load, refresh, subscribe, setMe, retryNow, isBusy } from "./store.js";
import { app, h, icon, avatar, person, people, toast, menu, closeSheet, sheetIsOpen, refreshSheet } from "./ui.js";
import * as today from "./views/today.js";
import * as tasks from "./views/tasks.js";
import * as content from "./views/content.js";
import * as numbers from "./views/numbers.js";
import * as team from "./views/team.js";
import * as library from "./views/library.js";

const ROUTES = [
  ["today", "Today", today],
  ["tasks", "Tasks", tasks],
  ["content", "Content", content],
  ["numbers", "Numbers", numbers],
  ["team", "Team", team],
  ["library", "Library", library],
];
const VIEWS = Object.fromEntries(ROUTES.map(([id, , mod]) => [id, mod]));
const BRAND = "InnerBoard"; // fallback until hub.brand.name loads; index.html carries the same name

const $ = (s) => document.querySelector(s);
const view = $("#view");

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const [name, ...rest] = path.split("/");
  return { name: VIEWS[name] ? name : "today", param: decodeURIComponent(rest.join("/")), query: new URLSearchParams(query) };
}

// ---- navigation ----
function buildNav() {
  const link = (id, label, cls) => h("a", { href: `#/${id}`, class: cls, "data-route": id }, icon(id, 20), h("span", {}, label));
  $("#nav").replaceChildren(...ROUTES.map(([id, label]) => link(id, label, "nav-item")));
  $("#tabbar").replaceChildren(...ROUTES.map(([id, label]) => link(id, label, "tab")));
}
function markNav(name) {
  document.querySelectorAll("[data-route]").forEach((a) => {
    const on = a.dataset.route === name;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

// ---- "I am…" ----
function meButton(where) {
  const me = person(state.me);
  const btn = h("button", { type: "button", class: `me-btn me-${where}`, "aria-haspopup": "menu", "aria-label": me ? `You are ${me.name}. Change` : "Choose who you are" },
    me ? avatar(me.id, where === "top" ? "sm" : "") : h("span", { class: "avatar avatar-none" + (where === "top" ? " sm" : "") }, icon("team", 15)),
    where === "rail" && h("span", { class: "me-text" }, h("span", { class: "me-eyebrow" }, "I am"), h("span", { class: "me-name" }, me ? me.name : "Choose…")),
    where === "rail" && icon("down", 16));
  btn.addEventListener("click", () => openMeMenu(btn, where === "top" ? "right" : "left"));
  return btn;
}
export function openMeMenu(anchor, align = "left") {
  menu(anchor, people().map((p) => ({ label: p.name, icon: avatar(p.id, "xs"), active: p.id === state.me, onClick: () => { setMe(p.id); toast(`Hi, ${p.name.split(" ")[0]}. Today now shows your work first.`); } })), { align });
}
function renderShell() {
  const b = state.hub.brand || {};
  document.querySelectorAll("[data-brand-name]").forEach((el) => (el.textContent = b.name || BRAND));
  document.querySelectorAll("[data-brand-tagline]").forEach((el) => (el.textContent = b.tagline || ""));
  document.querySelectorAll("[data-me-slot]").forEach((slot) => slot.replaceChildren(meButton(slot.dataset.meSlot)));
  $("#preview").hidden = !state.loaded || state.canWrite;
  renderSync();
}
function renderSync() {
  const el = $("#sync");
  if (!state.loaded || !state.canWrite) return el.replaceChildren();
  const map = {
    idle: ["ok", "All changes saved"], saved: ["ok", "All changes saved"], pending: ["busy", "Saving…"], saving: ["busy", "Saving…"],
    error: ["err", "Not saved yet · Retry"], locked: ["err", "Passcode needed · Enter"],
  };
  const [tone, text] = map[state.sync] || map.idle;
  const clickable = tone === "err";
  el.replaceChildren(h(clickable ? "button" : "span", { class: `sync-state s-${tone}`, type: clickable ? "button" : null, onclick: clickable ? retryNow : null }, h("span", { class: "dot" }), text));
}

// ---- passcode prompt (asked once; remembered on this device) ----
hooks.askPasscode = (message) => new Promise((resolve) => {
  const input = h("input", { class: "input", type: "password", autocomplete: "current-password", "aria-label": "Team passcode", placeholder: "Team passcode" });
  const dlg = h("dialog", { class: "dialog" },
    h("form", { method: "dialog", class: "dialog-body" },
      h("h2", { class: "dialog-title" }, "Enter the team passcode"),
      h("p", { class: "muted" }, message || "Saving changes needs the team passcode. You'll only be asked once on this device."),
      input,
      h("div", { class: "dialog-actions" },
        h("button", { type: "submit", value: "cancel", class: "btn btn-quiet" }, "Not now"),
        h("button", { type: "submit", value: "ok", class: "btn btn-primary" }, "Save changes"))));
  dlg.addEventListener("close", () => { const ok = dlg.returnValue === "ok" && input.value.trim(); dlg.remove(); resolve(ok ? input.value.trim() : null); });
  document.body.append(dlg);
  dlg.showModal();
  input.focus();
});
hooks.toast = (m) => toast(m);

// ---- render loop ----
let current = null;
let deferred = false;
const editing = () => {
  const a = document.activeElement;
  // An empty quick-add box (cleared right after adding) doesn't hold back the re-render that shows the new item.
  return a && a !== document.body && (a.matches("input, textarea, select, [contenteditable]") && !a.matches(".qa-input:placeholder-shown, [data-quick]:placeholder-shown"));
};

// Clicking from one inline field into another saves the first on mousedown; re-rendering right then would replace
// the element under the pointer and swallow the click. So renders wait while a pointer is down and run just after.
let pressedAt = 0;
const pressed = () => pressedAt && performance.now() - pressedAt < 3000;
const press = () => { pressedAt = performance.now(); };
const release = () => { pressedAt = 0; setTimeout(() => { if (deferred && !editing() && !pressed()) render(); }); };
for (const type of ["pointerdown", "mousedown"]) document.addEventListener(type, press, true);
for (const type of ["pointerup", "mouseup", "pointercancel", "dragend"]) document.addEventListener(type, release, true);

function render({ fresh = false } = {}) {
  renderShell();
  if (!state.loaded) return;
  if (!fresh && (editing() || pressed())) { deferred = true; return; }
  deferred = false;
  const route = parseRoute();
  const mod = VIEWS[route.name];
  const isNew = fresh || current?.name !== route.name || current?.param !== route.param;
  if (isNew) current?.mod.leave?.();
  current = { ...route, mod };
  markNav(route.name);
  const node = mod.render({ param: route.param, query: route.query, fresh: isNew });
  if (!node) return;
  const y = scrollY;
  const keep = document.activeElement?.dataset?.focusKey;
  view.replaceChildren(node);
  if (keep && !isNew) view.querySelector(`[data-focus-key="${keep}"]`)?.focus({ preventScroll: true });
  if (isNew) {
    document.title = `${ROUTES.find((r) => r[0] === route.name)[1]} · ${state.hub.brand?.name || BRAND}`;
    view.classList.remove("enter");
    void view.offsetWidth;
    view.classList.add("enter");
    scrollTo(0, 0);
    view.querySelector(".page-title")?.focus({ preventScroll: true });
  } else scrollTo(0, y);
  if (sheetIsOpen()) refreshSheet();
}

app.render = () => render();
document.addEventListener("focusout", () => setTimeout(() => { if (deferred && !editing()) render(); }));
addEventListener("hashchange", () => { closeSheet(true); render({ fresh: true }); });
subscribe((why) => (why === "sync" ? renderSync() : render()));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetIsOpen() && !e.defaultPrevented) closeSheet(); });

// Refetch every 60 s while visible and idle.
setInterval(() => { if (!document.hidden && !isBusy() && !sheetIsOpen() && !editing()) refresh(); }, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !isBusy()) refresh(); });

buildNav();
markNav(parseRoute().name);
if (!location.hash) history.replaceState(null, "", "#/today");
await load();
render({ fresh: true });
