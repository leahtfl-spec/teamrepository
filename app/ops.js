// Shared state operations for the InnerBoard hub.
// Pure and dependency-free: imported by the browser app, the API functions and the CLI.
// Every change to data/hub.json is a list of ops passed through applyOps().

export const COLLECTIONS = Object.freeze(["people", "tasks", "content", "metrics", "scorecard", "docs", "briefings", "rhythm"]);
export const SET_ROOTS = Object.freeze(["brand", "goal", "settings"]);
export const TASK_STATUSES = Object.freeze(["todo", "doing", "done"]);
export const CONTENT_STATUSES = Object.freeze(["idea", "planned", "in-edit", "scheduled", "posted"]);
export const SLUG_RE = /^[a-z0-9-]{1,60}$/;
// When a rhythm item happens: every day, on one weekday, or weekly / monthly with no fixed day yet.
export const RHYTHM_WHEN = Object.freeze(["daily", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "weekly", "monthly"]);
export const METRIC_UNITS = Object.freeze(["", "%"]);
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]; // index = Date#getUTCDay()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// The field that identifies an element of each collection. docs are keyed by slug, metrics by key.
export const keyOf = (coll) => (coll === "docs" ? "slug" : coll === "metrics" ? "key" : "id");

// Fields a brand-new element starts with (the upserted item overrides them).
const DEFAULTS = {
  tasks: () => ({ title: "", owner: "", due: "", status: "todo", phase: "", notes: "", doneAt: null, lastRemindedAt: null }),
  content: () => ({ date: "", channel: "", pillar: "", format: "", title: "", owner: "", status: "idea", link: "" }),
  rhythm: () => ({ owner: "", when: "weekly", title: "", note: "" }),
};

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (msg) => {
  throw new Error(msg);
};

export function emptyHub() {
  return {
    version: 1, updatedAt: null, brand: {}, goal: {},
    people: [], tasks: [], content: [], metrics: [], scorecard: [], docs: [], briefings: [], rhythm: [],
    settings: {},
  };
}

// newId("t") -> "t-<base36 time><4 random chars>". A trailing "-" on the prefix is optional.
export function newId(prefix = "") {
  const sep = prefix && !prefix.endsWith("-") ? "-" : "";
  let rand = "";
  while (rand.length < 4) rand += Math.random().toString(36).slice(2);
  return prefix + sep + Date.now().toString(36) + rand.slice(0, 4);
}

/**
 * applyOps(hub, ops, nowIso?) -> new hub. Never mutates `hub` or `ops`.
 * Throws Error (with a readable message) on the first invalid op; nothing is applied then.
 *   { op: "upsert", coll, item }   merge into the element with the same id (slug for docs), or append
 *   { op: "remove", coll, id }     no-op when missing
 *   { op: "set", path, value }     dot path under brand | goal | settings
 */
export function applyOps(hub, ops, nowIso = new Date().toISOString()) {
  if (!isPlain(hub)) fail("hub must be an object");
  if (!Array.isArray(ops)) fail("ops must be an array");
  if (typeof nowIso !== "string" || Number.isNaN(Date.parse(nowIso))) fail("now must be an ISO timestamp");
  const next = structuredClone(hub);
  ops.forEach((op, i) => applyOne(next, op, nowIso, `ops[${i}]`));
  next.updatedAt = nowIso;
  return next;
}

function applyOne(hub, op, now, at) {
  if (!isPlain(op)) fail(`${at}: op must be an object`);
  if (op.op === "upsert") return upsert(hub, op, now, at);
  if (op.op === "remove") return remove(hub, op, at);
  if (op.op === "set") return setPath(hub, op, at);
  fail(`${at}: unknown op ${JSON.stringify(op.op)}`);
}

function list(hub, coll, at) {
  if (!COLLECTIONS.includes(coll)) fail(`${at}: unknown collection ${JSON.stringify(coll)}`);
  if (hub[coll] == null) hub[coll] = [];
  if (!Array.isArray(hub[coll])) fail(`${at}: hub.${coll} is not a list`);
  return hub[coll];
}

function upsert(hub, { coll, item }, now, at) {
  const items = list(hub, coll, at);
  if (!isPlain(item)) fail(`${at}: upsert needs an item object`);
  assertSafe(item, at);
  const key = keyOf(coll);
  const id = item[key];
  if (typeof id !== "string" || !id.trim() || id.length > 120) fail(`${at}: ${coll} item needs a string "${key}"`);
  if (coll === "docs" && !SLUG_RE.test(id)) fail(`${at}: doc slug must match ${SLUG_RE}`);
  validateFields(coll, item, at);

  const patch = structuredClone(item);
  const idx = items.findIndex((x) => x && x[key] === id);
  const el = idx === -1 ? { [key]: id, ...(DEFAULTS[coll]?.() ?? {}), ...patch } : merge(items[idx], patch);
  if (coll === "tasks") {
    if (idx === -1 && !el.createdAt) el.createdAt = now;
    if (el.status === "done") {
      if (!el.doneAt) el.doneAt = now;
    } else el.doneAt = null;
  }
  if (idx === -1) items.push(el);
  else items[idx] = el;
}

function remove(hub, { coll, id }, at) {
  const items = list(hub, coll, at);
  if (typeof id !== "string" || !id) fail(`${at}: remove needs a string id`);
  const key = keyOf(coll);
  const idx = items.findIndex((x) => x && x[key] === id);
  if (idx !== -1) items.splice(idx, 1);
}

function setPath(hub, { path, value }, at) {
  if (typeof path !== "string" || !path) fail(`${at}: set needs a path`);
  const parts = path.split(".");
  if (!SET_ROOTS.includes(parts[0])) fail(`${at}: set path must start with ${SET_ROOTS.join(", ")}`);
  if (parts.some((p) => !p || BAD_KEYS.has(p))) fail(`${at}: invalid path ${JSON.stringify(path)}`);
  if (value === undefined) fail(`${at}: set needs a value`);
  if (value !== null && typeof value === "object") assertSafe(value, at);
  if (parts[0] === "goal" && (parts.length === 1 ? isPlain(value) && "milestones" in value : parts[1] === "milestones"))
    validateMilestones(parts.length === 1 ? value.milestones : parts.length === 2 ? value : null, at);
  if (parts.length === 1) {
    if (!isPlain(value)) fail(`${at}: ${path} must be an object`);
    hub[path] = structuredClone(value);
    return;
  }
  let obj = hub;
  for (const p of parts.slice(0, -1)) {
    if (obj[p] == null) obj[p] = {};
    if (!isPlain(obj[p])) fail(`${at}: ${path} goes through a non-object`);
    obj = obj[p];
  }
  obj[parts.at(-1)] = structuredClone(value);
}

// Merge plain objects recursively (so a scorecard cell edit keeps the other values); arrays are replaced.
function merge(target, patch) {
  const out = isPlain(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && isPlain(out[k]) ? merge(out[k], v) : v;
  return out;
}

function assertSafe(value, at) {
  if (Array.isArray(value)) return value.forEach((v) => v && typeof v === "object" && assertSafe(v, at));
  for (const [k, v] of Object.entries(value)) {
    if (BAD_KEYS.has(k)) fail(`${at}: invalid key ${JSON.stringify(k)}`);
    if (v && typeof v === "object") assertSafe(v, at);
  }
}

// goal.milestones: [{ date: "YYYY-MM-DD", target: number }, ...]. Other keys on a milestone are kept as-is.
function validateMilestones(list, at) {
  if (!Array.isArray(list)) fail(`${at}: goal.milestones must be a list of { date, target }`);
  list.forEach((m, i) => {
    if (!isPlain(m)) fail(`${at}: goal.milestones[${i}] must be an object`);
    if (typeof m.date !== "string" || !DATE_RE.test(m.date)) fail(`${at}: goal.milestones[${i}].date must be YYYY-MM-DD`);
    if (typeof m.target !== "number" || !Number.isFinite(m.target)) fail(`${at}: goal.milestones[${i}].target must be a number`);
  });
}

function validateFields(coll, item, at) {
  const dateOrBlank = (field) => {
    if (field in item && item[field] !== "" && !(typeof item[field] === "string" && DATE_RE.test(item[field])))
      fail(`${at}: ${coll}.${field} must be YYYY-MM-DD or ""`);
  };
  const oneOf = (field, allowed) => {
    if (field in item && !allowed.includes(item[field])) fail(`${at}: ${coll}.${field} must be one of ${allowed.join(", ")}`);
  };
  if (coll === "tasks") {
    oneOf("status", TASK_STATUSES);
    dateOrBlank("due");
  } else if (coll === "content") {
    oneOf("status", CONTENT_STATUSES);
    dateOrBlank("date");
  } else if (coll === "scorecard") {
    dateOrBlank("week");
    if ("values" in item) {
      if (!isPlain(item.values)) fail(`${at}: scorecard.values must be an object`);
      for (const [k, v] of Object.entries(item.values))
        if (v !== null && !(typeof v === "number" && Number.isFinite(v))) fail(`${at}: scorecard value ${k} must be a number or null`);
    }
  } else if (coll === "briefings") {
    dateOrBlank("date");
  } else if (coll === "metrics") {
    oneOf("unit", METRIC_UNITS);
  } else if (coll === "rhythm") {
    oneOf("when", RHYTHM_WHEN);
    for (const f of ["owner", "title", "note"])
      if (f in item && typeof item[f] !== "string") fail(`${at}: rhythm.${f} must be text`);
  }
}

// One-line description of a batch of ops, used for commit messages ("Hub: <summary>").
export function summarizeOps(ops) {
  if (!Array.isArray(ops) || !ops.length) return "no changes";
  const one = (op) => {
    if (op?.op === "set") return `set ${op.path}`;
    if (op?.op === "remove") return `remove ${op.coll} ${op.id}`;
    const it = op?.item ?? {};
    const label = it.title || it.name || it.label || it.summary || it[keyOf(op?.coll)] || "";
    const done = op?.coll === "tasks" && it.status === "done" ? "done: " : "";
    return `${done || `update ${op?.coll} `}${String(label).replace(/\s+/g, " ").slice(0, 48)}`;
  };
  const text = one(ops[0]) + (ops.length > 1 ? ` (+${ops.length - 1} more)` : "");
  return text.length > 72 ? text.slice(0, 71) + "…" : text;
}

// ---- dates (YYYY-MM-DD strings, calendar arithmetic in UTC so it is timezone-proof) ----

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Monday of the week containing ymd (scorecard weeks are keyed by their Monday).
export function weekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

// "mon".."sun" for a YYYY-MM-DD date (the rhythm `when` code of that weekday).
export function weekdayOf(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// The first goal milestone dated on or after `today` -> { date, target }, or null when none is left.
export function nextMilestone(goal, today = localDate()) {
  const list = Array.isArray(goal?.milestones) ? goal.milestones : [];
  const next = list
    .filter((m) => isPlain(m) && typeof m.date === "string" && DATE_RE.test(m.date) && m.date >= today && Number.isFinite(m.target))
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? { date: next.date, target: next.target } : null;
}

/**
 * report(hub, today?) -> what the daily routine (and Today screen) needs to know.
 * today defaults to the local date. Returned tasks are copies.
 */
export function report(hub, today = localDate()) {
  if (typeof today !== "string" || !DATE_RE.test(today)) fail("today must be YYYY-MM-DD");
  const tasks = (hub?.tasks ?? []).filter(isPlain);
  const open = tasks.filter((t) => t.status !== "done");
  const byDue = (a, b) => String(a.due).localeCompare(String(b.due)) || String(a.title ?? "").localeCompare(String(b.title ?? ""));

  const overdue = open.filter((t) => t.due && t.due < today).sort(byDue);
  const soonEnd = addDays(today, 7);
  const dueSoon = open.filter((t) => t.due && t.due >= today && t.due <= soonEnd).sort(byDue);

  const last = (hub?.briefings ?? [])
    .filter((b) => isPlain(b) && typeof b.date === "string" && DATE_RE.test(b.date) && b.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const since = last ? last.date : addDays(today, -1);
  const alreadyReported = new Set(Array.isArray(last?.done) ? last.done : []);
  const doneSinceLastBriefing = tasks
    .filter((t) => t.status === "done" && typeof t.doneAt === "string" && !alreadyReported.has(t.id))
    .filter((t) => t.doneAt.slice(0, 10) >= since && t.doneAt.slice(0, 10) <= today)
    .sort((a, b) => a.doneAt.localeCompare(b.doneAt));

  const overdueByOwner = {};
  for (const t of overdue) (overdueByOwner[t.owner || "unassigned"] ??= []).push(t);

  const scorecardWeek = weekStart(today);
  const missingScorecardWeek = !(hub?.scorecard ?? []).some((r) => isPlain(r) && (r.week === scorecardWeek || r.id === scorecardWeek));

  // Days with no social post yet. A newsletter goes out by email, so it doesn't fill a day on the social calendar.
  const dated = new Set((hub?.content ?? []).filter((c) => isPlain(c) && !/newsletter|email/i.test(String(c.channel ?? ""))).map((c) => c.date));
  const contentGapsNext14 = Array.from({ length: 14 }, (_, i) => addDays(today, i)).filter((d) => !dated.has(d));

  // Everyone's recurring commitments for today: every-day items first, then today's weekday.
  const rhythm = (hub?.rhythm ?? []).filter(isPlain);
  const dow = weekdayOf(today);
  const rhythmToday = [...rhythm.filter((r) => r.when === "daily"), ...rhythm.filter((r) => r.when === dow)];

  return structuredClone({
    today,
    lastBriefingDate: last?.date ?? null,
    scorecardWeek,
    overdue,
    dueSoon,
    doneSinceLastBriefing,
    overdueByOwner,
    missingScorecardWeek,
    contentGapsNext14,
    rhythmToday,
    nextMilestone: nextMilestone(hub?.goal, today),
  });
}
