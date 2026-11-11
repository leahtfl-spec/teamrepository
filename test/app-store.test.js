// Preview mode must never freeze the data: local edits are replayed on top of whatever the
// latest deployment serves (regression: a stored hub snapshot hid every later deployment).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyHub } from "../app/ops.js";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.document = { hidden: false };
let served;
globalThis.fetch = async (url) => {
  if (String(url).startsWith("/api/data")) return { ok: true, status: 200, json: async () => ({ hub: served, sha: null, source: "bundle", canWrite: false }) };
  return { ok: false, status: 404, json: async () => ({}) };
};

const hubWith = (name) => ({
  ...emptyHub(),
  people: [{ id: "founder", name, title: "Founder & Voice of InnerBoard", email: "", remind: false }],
  tasks: [{ id: "t-1", title: "A task", owner: "founder", due: "", status: "todo", phase: "", notes: "", createdAt: "2026-11-01T00:00:00.000Z", createdBy: "routine", doneAt: null, lastRemindedAt: null }],
});

const store = await import("../app/store.js");

test("preview edits survive, and a new deployment's data still shows", async () => {
  served = hubWith("Founder");
  await store.load();
  assert.equal(store.state.canWrite, false);
  store.dispatch([{ op: "upsert", coll: "tasks", item: { id: "t-1", status: "done" } }]);
  const log = JSON.parse(localStorage.getItem("ib.ops.local"));
  assert.equal(log.length, 1);
  const doneAt = store.state.hub.tasks[0].doneAt;
  assert.ok(doneAt);

  served = hubWith("Leah"); // a new deployment
  await store.load();
  assert.equal(store.state.hub.people[0].name, "Leah", "new deployed data shows");
  assert.equal(store.state.hub.tasks[0].status, "done", "this device's edit is kept");
  assert.equal(store.state.hub.tasks[0].doneAt, log[0].at, "doneAt keeps the time of the edit");
});

test("an old stored snapshot no longer hides new data", async () => {
  localStorage.removeItem("ib.ops.local");
  localStorage.setItem("ib.hub.local", JSON.stringify(hubWith("Founder")));
  served = hubWith("Leah");
  await store.load();
  assert.equal(store.state.hub.people[0].name, "Leah");
  assert.equal(localStorage.getItem("ib.hub.local"), null, "stale snapshot is dropped");
});

test("a local edit to an item that no longer exists is skipped, not fatal", async () => {
  localStorage.setItem("ib.ops.local", JSON.stringify([{ op: { op: "upsert", coll: "tasks", item: { id: "t-1", due: "not-a-date" } }, at: "2026-11-10T00:00:00.000Z" }]));
  served = hubWith("Leah");
  await store.load();
  assert.equal(store.state.hub.tasks[0].due, "");
});

test("going live: this device's preview edits are saved to the team once, then cleared", async () => {
  const posted = [];
  served = hubWith("Leah");
  localStorage.setItem("ib.ops.local", JSON.stringify([
    { op: { op: "upsert", coll: "tasks", item: { id: "t-1", status: "done" } }, at: "2026-11-11T09:00:00.000Z" },
    { op: { op: "upsert", coll: "tasks", item: { id: "t-gone", due: "bad" } }, at: "2026-11-11T09:01:00.000Z" },
  ]));
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith("/api/data") && opts.method === "POST") {
      const { ops } = JSON.parse(opts.body);
      posted.push(...ops);
      const { applyOps } = await import("../app/ops.js");
      return { ok: true, status: 200, json: async () => ({ hub: applyOps(served, ops), sha: "s2" }) };
    }
    if (String(url).startsWith("/api/data")) return { ok: true, status: 200, json: async () => ({ hub: served, sha: "s1", source: "github", canWrite: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    await store.load();
    assert.equal(store.state.canWrite, true);
    assert.equal(store.state.hub.tasks[0].status, "done", "shown at once");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(posted.length, 1, "only the edit that still applies is sent");
    assert.equal(posted[0].item.id, "t-1");
    assert.equal(localStorage.getItem("ib.ops.local"), null, "log cleared after the save");
    assert.equal(store.state.hub.tasks[0].status, "done");
  } finally {
    globalThis.fetch = prevFetch;
  }
});
