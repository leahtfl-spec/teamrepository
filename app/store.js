// App state + sync. Every edit is a list of ops: applied locally at once, queued, then POSTed
// (debounced). In preview mode (no storage behind the API) edits live in localStorage instead.
import { applyOps, emptyHub } from "./ops.js";

const KEY = { hub: "ib.hub.local", docs: "ib.docs.local", me: "ib.me", pass: "ib.passcode" };
export const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  json(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
};

export const state = {
  hub: emptyHub(), sha: null, source: null, canWrite: false, needsPasscode: false,
  loaded: false, sync: "idle", me: ls.get(KEY.me) || "",
};

// UI hooks, filled in by main.js (keeps this module free of DOM code).
export const hooks = { toast: () => {}, askPasscode: async () => null };

const listeners = new Set();
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (why) => listeners.forEach((fn) => fn(why));
const setSync = (s) => { if (state.sync !== s) { state.sync = s; emit("sync"); } };

let pending = [];
let inflight = null;
let timer = null;
let retryMs = 0;
let warned = false;

const passHeader = () => { const p = ls.get(KEY.pass); return p ? { "x-team-passcode": p } : {}; };

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

function enterPreview(hub) {
  state.canWrite = false;
  state.source = state.source || "bundle";
  const local = ls.json(KEY.hub);
  state.hub = local && typeof local === "object" ? local : hub;
}

export async function load() {
  try {
    const data = await getJson("/api/data");
    state.sha = data.sha;
    state.source = data.source;
    state.needsPasscode = !!data.needsPasscode;
    state.canWrite = !!data.canWrite;
    if (state.canWrite) state.hub = data.hub;
    else enterPreview(data.hub);
  } catch {
    // No API (e.g. a plain static host): fall back to the shipped snapshot, preview mode.
    let hub = emptyHub();
    try { hub = await getJson("./data/hub.json"); } catch {}
    state.source = "bundle";
    enterPreview(hub);
  }
  state.loaded = true;
  emit("load");
}

export function dispatch(ops) {
  if (!ops.length) return;
  state.hub = applyOps(state.hub, ops); // throws on a bad op; callers rely on validation here
  if (!state.canWrite) {
    ls.set(KEY.hub, JSON.stringify(state.hub));
    emit("local");
    return;
  }
  pending.push(...ops);
  setSync("pending");
  emit("local");
  schedule(700);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

async function flush() {
  if (inflight || !pending.length) return;
  inflight = pending.splice(0, 500);
  setSync("saving");
  let res, body;
  try {
    res = await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json", ...passHeader() },
      body: JSON.stringify({ ops: inflight }),
    });
    body = await res.json().catch(() => ({}));
  } catch {
    return failed();
  }
  if (res.status === 401) {
    pending = inflight.concat(pending);
    inflight = null;
    const code = await hooks.askPasscode(ls.get(KEY.pass) ? "That passcode didn't work. Try again." : "");
    if (code) { ls.set(KEY.pass, code); schedule(0); } else setSync("locked");
    return;
  }
  if (res.status === 503) {
    // Storage isn't set up: keep working on this device.
    inflight = null;
    pending = [];
    state.canWrite = false;
    ls.set(KEY.hub, JSON.stringify(state.hub));
    setSync("idle");
    emit("mode");
    return;
  }
  if (res.status === 400) {
    inflight = null;
    hooks.toast("One change couldn't be saved, so it was undone.");
    await refresh(true);
    return;
  }
  if (!res.ok || !body.hub) return failed();
  inflight = null;
  retryMs = 0;
  warned = false;
  state.sha = body.sha;
  try { state.hub = pending.length ? applyOps(body.hub, pending) : body.hub; } catch { pending = []; state.hub = body.hub; }
  setSync(pending.length ? "pending" : "saved");
  emit("server");
  if (pending.length) schedule(700);
}

function failed() {
  pending = inflight.concat(pending);
  inflight = null;
  retryMs = Math.min(retryMs ? retryMs * 2 : 4000, 60000);
  setSync("error");
  if (!warned) { warned = true; hooks.toast("Couldn't save just now. Your changes are kept and we'll keep trying."); }
  schedule(retryMs);
}

export const retryNow = () => schedule(0);
export const isBusy = () => pending.length > 0 || !!inflight;

export async function refresh(force = false) {
  if (!state.canWrite || (!force && (isBusy() || document.hidden))) return;
  try {
    const data = await getJson("/api/data");
    if (isBusy() && !force) return;
    if (!data.canWrite) { enterPreview(data.hub); emit("mode"); return; }
    const changed = data.sha !== state.sha;
    state.sha = data.sha;
    state.hub = data.hub;
    if (changed || force) emit("server");
  } catch {}
}

export function setMe(id) {
  state.me = id;
  ls.set(KEY.me, id);
  emit("me");
}

// ---- docs (markdown pages) ----
const localDocs = () => ls.json(KEY.docs) || {};

export async function getDoc(slug) {
  const local = localDocs()[slug];
  if (!state.canWrite && typeof local === "string") return { markdown: local, sha: null };
  const res = await fetch(`/api/doc?slug=${encodeURIComponent(slug)}`, { cache: "no-store" }).catch(() => null);
  if (res?.ok) { const d = await res.json(); return { markdown: d.markdown, sha: d.sha }; }
  if (!res || res.status === 404) {
    try {
      const r = await fetch(`./data/docs/${slug}.md`, { cache: "no-store" });
      if (r.ok && !(r.headers.get("content-type") || "").includes("html")) return { markdown: await r.text(), sha: null };
    } catch {}
    return { markdown: "", sha: null, missing: true };
  }
  throw new Error(`HTTP ${res.status}`);
}

export async function saveDoc(slug, markdown, sha) {
  if (!state.canWrite) {
    ls.set(KEY.docs, JSON.stringify({ ...localDocs(), [slug]: markdown }));
    return { sha: null };
  }
  for (let tries = 0; tries < 3; tries++) {
    const res = await fetch("/api/doc", {
      method: "PUT",
      headers: { "content-type": "application/json", ...passHeader() },
      body: JSON.stringify(sha ? { slug, markdown, sha } : { slug, markdown }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { sha: body.sha };
    if (res.status === 401) {
      const code = await hooks.askPasscode(ls.get(KEY.pass) && tries ? "That passcode didn't work. Try again." : "");
      if (!code) throw Object.assign(new Error("passcode"), { code: "passcode" });
      ls.set(KEY.pass, code);
      continue;
    }
    if (res.status === 503) {
      state.canWrite = false;
      emit("mode");
      return saveDoc(slug, markdown);
    }
    throw Object.assign(new Error(body.message || body.error || `HTTP ${res.status}`), { code: body.error, status: res.status });
  }
  throw Object.assign(new Error("passcode"), { code: "passcode" });
}
