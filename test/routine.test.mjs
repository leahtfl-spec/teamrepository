// Keeps ROUTINE.md runnable: its state snippet and example ops must work against the real CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyOps } from "../app/ops.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(path.join(root, "ROUTINE.md"), "utf8");
const snippet = doc.match(/<<'EOF'[^\n]*\n([\s\S]*?)\nEOF\n/)[1];
const exampleOps = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1]);

const tmpData = (from) => {
  const dir = mkdtempSync(path.join(tmpdir(), "routine-"));
  cpSync(from, path.join(dir, "hub.json"));
  return dir;
};
const state = (dir, today) =>
  JSON.parse(execFileSync("node", ["--input-type=module"], { cwd: root, input: snippet, env: { ...process.env, HUB_DATA_DIR: dir, TODAY: today } }));
const hub = (args, dir) => execFileSync("node", ["scripts/hub.mjs", ...args], { cwd: root, env: { ...process.env, HUB_DATA_DIR: dir } }).toString();

test("state snippet: autoOps, reminder candidates and content slots (fixture, Tue 2026-11-10)", () => {
  const dir = tmpData(path.join(root, "test/fixtures/hub.json"));
  const s = state(dir, "2026-11-10");
  assert.equal(s.scorecardWeek, "2026-11-09");
  const sc = s.autoOps.find((o) => o.coll === "scorecard");
  assert.equal(sc?.item.id, "2026-11-09");
  const weekly = s.autoOps.filter((o) => o.coll === "tasks").map((o) => o.item);
  assert.equal(weekly.length, 5);
  assert.ok(weekly.every((t) => t.id.startsWith("t-wk-2026-11-09-") && t.due >= "2026-11-10" && t.phase === "Weekly"));
  assert.equal(weekly.find((t) => t.id.endsWith("-scorecard"))?.owner, "michelle");
  assert.ok(Object.keys(s.phaseProgress).every((p) => p.startsWith("Phase ")));
  assert.ok(s.contentSlots.length <= 7 && s.contentSlots.every((c) => c.id === `c-r-${c.date}`));
  assert.ok(s.remindCandidates.every((p) => p.email && s.people.find((x) => x.id === p.id).remind));
  assert.doesNotThrow(() => applyOps(JSON.parse(readFileSync(path.join(dir, "hub.json"), "utf8")), s.autoOps));
});

test("example ops apply with hub.mjs, and re-applying adds no duplicates", () => {
  const dir = tmpData(path.join(root, "data/hub.json"));
  const opsFile = path.join(dir, "ops.json");
  writeFileSync(opsFile, JSON.stringify(exampleOps));
  hub(["apply", opsFile], dir);
  const once = JSON.parse(readFileSync(path.join(dir, "hub.json"), "utf8"));
  hub(["apply", opsFile], dir);
  const twice = JSON.parse(readFileSync(path.join(dir, "hub.json"), "utf8"));
  assert.equal(twice.tasks.length, once.tasks.length);
  assert.equal(twice.content.length, once.content.length);
  assert.ok(twice.briefings.some((b) => b.id === "b-2026-11-16"));
  const after = state(dir, "2026-11-16");
  assert.ok(!after.autoOps.some((o) => o.item.id === "t-wk-2026-11-16-reps"));
  assert.ok(!after.contentSlots.some((c) => c.id === "c-r-2026-11-22"));
});

test("data/hub.json: owners, role docs, library files and rhythm line up", () => {
  const data = JSON.parse(readFileSync(path.join(root, "data/hub.json"), "utf8"));
  const people = new Set(data.people.map((p) => p.id));
  const slugs = new Set(data.docs.map((d) => d.slug));
  for (const coll of ["tasks", "content", "metrics", "rhythm"])
    for (const x of data[coll]) assert.ok(people.has(x.owner), `${coll} ${x.id ?? x.key}: unknown owner ${x.owner}`);
  for (const d of data.docs) assert.ok(existsSync(path.join(root, "data/docs", `${d.slug}.md`)), `missing data/docs/${d.slug}.md`);
  for (const p of data.people) if (p.doc) assert.ok(slugs.has(p.doc), `${p.id}: doc ${p.doc} is not in docs[]`);
  const when = new Set(["daily", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "weekly", "monthly"]);
  for (const r of data.rhythm) assert.ok(r.id && when.has(r.when) && r.title, `rhythm ${r.id}: bad item`);
  assert.equal(new Set(data.rhythm.map((r) => r.id)).size, data.rhythm.length);
  const keys = new Set(data.metrics.map((m) => m.key));
  for (const row of data.scorecard) for (const k of Object.keys(row.values)) assert.ok(keys.has(k), `scorecard ${row.id}: unknown metric ${k}`);
  assert.ok(!JSON.stringify(data).includes("Inner Board"), 'brand is spelled "InnerBoard"');
});
