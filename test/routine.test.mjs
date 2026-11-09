// Keeps ROUTINE.md runnable: its state snippet and example ops must work against the real CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
