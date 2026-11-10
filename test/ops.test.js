import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLLECTIONS, RHYTHM_WHEN, addDays, applyOps, emptyHub, newId, nextMilestone, report, summarizeOps, weekStart, weekdayOf } from "../app/ops.js";

const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/hub.json", import.meta.url), "utf8"));
const NOW = "2026-11-09T10:00:00.000Z";
const task = (hub, id) => hub.tasks.find((t) => t.id === id);

test("exports", () => {
  assert.deepEqual([...COLLECTIONS], ["people", "tasks", "content", "metrics", "scorecard", "docs", "briefings", "rhythm"]);
  assert.deepEqual([...RHYTHM_WHEN], ["daily", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "weekly", "monthly"]);
  assert.ok(Object.isFrozen(RHYTHM_WHEN));
  for (const coll of COLLECTIONS) assert.deepEqual(emptyHub()[coll], [], coll);
  const id = newId("t");
  assert.match(id, /^t-[a-z0-9]{8,}$/);
  assert.match(newId("c-"), /^c-[a-z0-9]+$/);
  assert.notEqual(newId("t"), newId("t"));
});

test("upsert merges into an existing element and stamps updatedAt", () => {
  const hub = applyOps(fixture(), [{ op: "upsert", coll: "tasks", item: { id: "t-soon", title: "Outline v2" } }], NOW);
  const t = task(hub, "t-soon");
  assert.equal(t.title, "Outline v2");
  assert.equal(t.owner, "abra");
  assert.equal(t.createdAt, "2026-11-01T09:00:00.000Z");
  assert.equal(hub.updatedAt, NOW);
});

test("upsert appends new elements with defaults; new tasks get createdAt", () => {
  const hub = applyOps(fixture(), [
    { op: "upsert", coll: "tasks", item: { id: "t-new", title: "New one", owner: "abra" } },
    { op: "upsert", coll: "people", item: { id: "logan", name: "Logan" } },
  ], NOW);
  const t = task(hub, "t-new");
  assert.equal(hub.tasks.at(-1), t);
  assert.equal(t.createdAt, NOW);
  assert.equal(t.status, "todo");
  assert.equal(t.doneAt, null);
  assert.equal(hub.people.at(-1).name, "Logan");
});

test("scorecard values merge per cell; docs are keyed by slug", () => {
  const hub = applyOps(fixture(), [
    { op: "upsert", coll: "scorecard", item: { id: "2026-11-02", values: { newPaid: 15 } } },
    { op: "upsert", coll: "docs", item: { slug: "road-to-1000", group: "Plan" } },
  ], NOW);
  assert.deepEqual(hub.scorecard[0].values, { newPaid: 15, newGroup: 180 });
  assert.deepEqual(hub.docs, [{ slug: "road-to-1000", title: "Road to 1,000", group: "Plan" }]);
});

test("doneAt rules", () => {
  let hub = applyOps(fixture(), [{ op: "upsert", coll: "tasks", item: { id: "t-soon", status: "done" } }], NOW);
  assert.equal(task(hub, "t-soon").doneAt, NOW);
  // already done keeps its doneAt
  hub = applyOps(hub, [{ op: "upsert", coll: "tasks", item: { id: "t-soon", status: "done", title: "x" } }], "2026-11-10T00:00:00.000Z");
  assert.equal(task(hub, "t-soon").doneAt, NOW);
  // explicit doneAt is kept
  hub = applyOps(hub, [{ op: "upsert", coll: "tasks", item: { id: "t-today", status: "done", doneAt: "2026-11-08T01:00:00.000Z" } }], NOW);
  assert.equal(task(hub, "t-today").doneAt, "2026-11-08T01:00:00.000Z");
  // reopening clears doneAt, even if one is sent
  hub = applyOps(hub, [{ op: "upsert", coll: "tasks", item: { id: "t-soon", status: "doing", doneAt: NOW } }], NOW);
  assert.equal(task(hub, "t-soon").doneAt, null);
  // new task created done
  hub = applyOps(hub, [{ op: "upsert", coll: "tasks", item: { id: "t-x", status: "done" } }], NOW);
  assert.equal(task(hub, "t-x").doneAt, NOW);
});

test("remove deletes by id and is a no-op when missing", () => {
  const before = fixture();
  const hub = applyOps(before, [
    { op: "remove", coll: "tasks", id: "t-later" },
    { op: "remove", coll: "tasks", id: "nope" },
    { op: "remove", coll: "docs", id: "road-to-1000" },
  ], NOW);
  assert.equal(hub.tasks.length, before.tasks.length - 1);
  assert.equal(task(hub, "t-later"), undefined);
  assert.deepEqual(hub.docs, []);
});

test("set writes dot paths under brand, goal, settings only", () => {
  const hub = applyOps(fixture(), [
    { op: "set", path: "goal.current", value: 140 },
    { op: "set", path: "settings.reminders.mode", value: "send" },
    { op: "set", path: "brand.extra.deep", value: "ok" },
    { op: "set", path: "brand", value: { name: "IB" } },
  ], NOW);
  assert.equal(hub.goal.current, 140);
  assert.equal(hub.settings.reminders.mode, "send");
  assert.equal(hub.settings.reminders.minDaysBetween, 2);
  assert.deepEqual(hub.brand, { name: "IB" });
  for (const path of ["tasks", "tasks.0.title", "version", "updatedAt", "goal..x", "goal.__proto__.x", ""])
    assert.throws(() => applyOps(fixture(), [{ op: "set", path, value: 1 }], NOW), Error, path);
  assert.throws(() => applyOps(fixture(), [{ op: "set", path: "goal.target.x", value: 1 }], NOW), /non-object/);
  assert.throws(() => applyOps(fixture(), [{ op: "set", path: "goal", value: 5 }], NOW), /object/);
});

test("invalid ops throw and nothing is applied", () => {
  const bad = [
    { op: "upsert", coll: "nope", item: { id: "x" } },
    { op: "explode", coll: "tasks" },
    { op: "upsert", coll: "tasks" },
    { op: "upsert", coll: "tasks", item: { title: "no id" } },
    { op: "upsert", coll: "tasks", item: { id: "t-1", status: "finished" } },
    { op: "upsert", coll: "tasks", item: { id: "t-1", due: "next week" } },
    { op: "upsert", coll: "content", item: { id: "c-9", status: "live" } },
    { op: "upsert", coll: "scorecard", item: { id: "2026-11-09", values: { newPaid: "5" } } },
    { op: "upsert", coll: "docs", item: { slug: "Bad Slug" } },
    { op: "upsert", coll: "tasks", item: JSON.parse('{"id":"t-1","__proto__":{"x":1}}') },
    { op: "remove", coll: "tasks" },
    null,
    "upsert",
  ];
  for (const op of bad) assert.throws(() => applyOps(fixture(), [op], NOW), Error, JSON.stringify(op));
  assert.throws(() => applyOps(fixture(), { op: "set" }, NOW), /array/);
  assert.throws(() => applyOps(null, [], NOW), /hub/);
  assert.throws(() => applyOps(fixture(), [], "yesterday"), /ISO/);
});

test("never mutates the hub or the ops", () => {
  const hub = fixture();
  const ops = [
    { op: "upsert", coll: "tasks", item: { id: "t-soon", status: "done", notes: "n" } },
    { op: "upsert", coll: "scorecard", item: { id: "2026-11-02", values: { newPaid: 1 } } },
    { op: "remove", coll: "content", id: "c-1" },
    { op: "set", path: "settings.reminders", value: { enabled: false } },
  ];
  const hubCopy = structuredClone(hub);
  const opsCopy = structuredClone(ops);
  const next = applyOps(hub, ops, NOW);
  assert.deepEqual(hub, hubCopy);
  assert.deepEqual(ops, opsCopy);
  next.settings.reminders.enabled = true;
  next.scorecard[0].values.newPaid = 99;
  assert.deepEqual(ops, opsCopy);
});

test("summarizeOps", () => {
  assert.equal(summarizeOps([{ op: "upsert", coll: "tasks", item: { id: "t", title: "Write intro", status: "done" } }]), "done: Write intro");
  assert.equal(summarizeOps([{ op: "set", path: "goal.current", value: 1 }, { op: "remove", coll: "tasks", id: "t" }]), "set goal.current (+1 more)");
  assert.ok(summarizeOps([{ op: "upsert", coll: "content", item: { id: "c", title: "x".repeat(200) } }]).length <= 72);
});

test("date helpers", () => {
  assert.equal(addDays("2026-11-09", 7), "2026-11-16");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  assert.equal(weekStart("2026-11-12"), "2026-11-09");
});

test("report", () => {
  const r = report(fixture(), "2026-11-09");
  assert.equal(r.today, "2026-11-09");
  assert.equal(r.lastBriefingDate, "2026-11-08");
  assert.deepEqual(r.overdue.map((t) => t.id), ["t-overdue"]);
  assert.deepEqual(r.dueSoon.map((t) => t.id), ["t-today", "t-soon"]);
  assert.deepEqual(r.doneSinceLastBriefing.map((t) => t.id), ["t-done-new"]);
  assert.deepEqual(Object.keys(r.overdueByOwner), ["abra"]);
  assert.equal(r.overdueByOwner.abra[0].id, "t-overdue");
  assert.equal(r.scorecardWeek, "2026-11-09");
  assert.equal(r.missingScorecardWeek, true);
  assert.equal(r.contentGapsNext14.length, 12);
  assert.ok(!r.contentGapsNext14.includes("2026-11-09") && !r.contentGapsNext14.includes("2026-11-11"));
  assert.equal(r.contentGapsNext14[0], "2026-11-10");
  assert.equal(r.contentGapsNext14.at(-1), "2026-11-22");
  // a newsletter goes out by email: it doesn't fill that day on the social calendar
  const withNews = applyOps(fixture(), [{ op: "upsert", coll: "content", item: { id: "c-news", date: "2026-11-12", channel: "Newsletter (GHL)", title: "Weekly newsletter" } }], NOW);
  assert.ok(report(withNews, "2026-11-09").contentGapsNext14.includes("2026-11-12"));

  const withWeek = applyOps(fixture(), [{ op: "upsert", coll: "scorecard", item: { id: "2026-11-09", week: "2026-11-09", values: {} } }], NOW);
  assert.equal(report(withWeek, "2026-11-12").missingScorecardWeek, false);
  // a briefing for today itself does not count as "last"
  const rerun = applyOps(fixture(), [{ op: "upsert", coll: "briefings", item: { id: "b-2026-11-09", date: "2026-11-09", done: ["t-done-new"] } }], NOW);
  assert.deepEqual(report(rerun, "2026-11-09").doneSinceLastBriefing.map((t) => t.id), ["t-done-new"]);
  // no briefings: since yesterday
  const fresh = applyOps(fixture(), [{ op: "remove", coll: "briefings", id: "b-2026-11-08" }, { op: "remove", coll: "briefings", id: "b-2026-11-07" }], NOW);
  assert.deepEqual(report(fresh, "2026-11-09").doneSinceLastBriefing.map((t) => t.id), ["t-done-reported", "t-done-new"]);
  assert.throws(() => report(fixture(), "11/09/2026"));
});

test("report returns copies", () => {
  const hub = fixture();
  report(hub, "2026-11-09").overdue[0].title = "changed";
  assert.equal(task(hub, "t-overdue").title, "Send partner list");
});

test("metrics are keyed by key: upsert merges, remove deletes", () => {
  let hub = applyOps(fixture(), [{ op: "upsert", coll: "metrics", item: { key: "newPaid", owner: "clint", target: 25 } }], NOW);
  assert.equal(hub.metrics.length, 2);
  assert.deepEqual(hub.metrics[0], { key: "newPaid", label: "New paid members", owner: "clint", target: 25 });
  hub = applyOps(hub, [{ op: "remove", coll: "metrics", id: "newGroup" }], NOW);
  assert.deepEqual(hub.metrics.map((m) => m.key), ["newPaid"]);
});

test("rhythm: keyed by id, defaults, merge, remove", () => {
  let hub = applyOps(fixture(), [{ op: "upsert", coll: "rhythm", item: { id: "r-new", title: "Newsletter draft" } }], NOW);
  assert.deepEqual(hub.rhythm.at(-1), { id: "r-new", owner: "", when: "weekly", title: "Newsletter draft", note: "" });
  hub = applyOps(hub, [{ op: "upsert", coll: "rhythm", item: { id: "r-new", when: "tue", owner: "abra", note: "Before noon" } }], NOW);
  assert.deepEqual(hub.rhythm.at(-1), { id: "r-new", owner: "abra", when: "tue", title: "Newsletter draft", note: "Before noon" });
  const before = hub.rhythm.length;
  hub = applyOps(hub, [{ op: "remove", coll: "rhythm", id: "r-new" }, { op: "remove", coll: "rhythm", id: "nope" }], NOW);
  assert.equal(hub.rhythm.length, before - 1);
  // a hub saved before rhythm existed gets the list on first upsert
  const old = fixture();
  delete old.rhythm;
  const grown = applyOps(old, [{ op: "upsert", coll: "rhythm", item: { id: "r-1", when: "daily", title: "Reps" } }], NOW);
  assert.deepEqual(grown.rhythm.map((r) => r.id), ["r-1"]);
  assert.deepEqual(applyOps(old, [{ op: "remove", coll: "rhythm", id: "r-1" }], NOW).rhythm, []);
});

test("rhythm: every RHYTHM_WHEN value is accepted, anything else throws", () => {
  for (const when of RHYTHM_WHEN)
    assert.equal(applyOps(fixture(), [{ op: "upsert", coll: "rhythm", item: { id: "r-x", when } }], NOW).rhythm.at(-1).when, when);
  for (const when of ["Monday", "MON", "", "biweekly", null, 1])
    assert.throws(() => applyOps(fixture(), [{ op: "upsert", coll: "rhythm", item: { id: "r-x", when } }], NOW), /rhythm\.when/, String(when));
  assert.throws(() => applyOps(fixture(), [{ op: "upsert", coll: "rhythm", item: { id: "r-x", title: 5 } }], NOW), /rhythm\.title/);
  assert.throws(() => applyOps(fixture(), [{ op: "upsert", coll: "rhythm", item: { id: "r-x", owner: null } }], NOW), /rhythm\.owner/);
  assert.throws(() => applyOps(fixture(), [{ op: "upsert", coll: "rhythm", item: { title: "no id" } }], NOW), /id/);
});

test("metrics: unit must be \"\" or \"%\"; new optional fields are kept", () => {
  const item = { key: "returning", label: "Returning after welcome-back", owner: "abra", unit: "%", target: 20, why: "Shows we pick people up", targetNote: "1 in 5 within 7 days", baseline: "Starts at launch" };
  let hub = applyOps(fixture(), [{ op: "upsert", coll: "metrics", item }], NOW);
  assert.deepEqual(hub.metrics.at(-1), item);
  hub = applyOps(hub, [{ op: "upsert", coll: "metrics", item: { key: "returning", unit: "" } }], NOW);
  assert.equal(hub.metrics.at(-1).unit, "");
  assert.equal(hub.metrics.at(-1).why, "Shows we pick people up");
  for (const unit of ["percent", "%%", " %", null, 1])
    assert.throws(() => applyOps(fixture(), [{ op: "upsert", coll: "metrics", item: { key: "newPaid", unit } }], NOW), /metrics\.unit/, String(unit));
  // unit is optional
  assert.doesNotThrow(() => applyOps(fixture(), [{ op: "upsert", coll: "metrics", item: { key: "newPaid", why: "x" } }], NOW));
});

const MILESTONES = [
  { date: "2027-03-31", target: 250 },
  { date: "2027-06-30", target: 500 },
  { date: "2027-09-30", target: 750 },
  { date: "2027-11-09", target: 1000 },
];

test("goal.milestones: validated whenever they are set", () => {
  let hub = applyOps(fixture(), [{ op: "set", path: "goal.milestones", value: MILESTONES }], NOW);
  assert.deepEqual(hub.goal.milestones, MILESTONES);
  assert.equal(hub.goal.target, 1000);
  hub = applyOps(hub, [{ op: "set", path: "goal", value: { label: "People practicing each week", target: 1000, current: 0, deadline: "2027-11-09", milestones: MILESTONES.slice(0, 2) } }], NOW);
  assert.equal(hub.goal.milestones.length, 2);
  assert.deepEqual(applyOps(hub, [{ op: "set", path: "goal.milestones", value: [] }], NOW).goal.milestones, []);
  // extra keys on a milestone are allowed
  assert.equal(applyOps(hub, [{ op: "set", path: "goal.milestones", value: [{ date: "2027-03-31", target: 250, note: "Q1" }] }], NOW).goal.milestones[0].note, "Q1");
  // other goal fields stay free, even next to milestones
  assert.equal(applyOps(hub, [{ op: "set", path: "goal.current", value: 12 }], NOW).goal.current, 12);
  const bad = [
    ["goal.milestones", "250 by March"],
    ["goal.milestones", { date: "2027-03-31", target: 250 }],
    ["goal.milestones", [{ date: "2027-3-31", target: 250 }]],
    ["goal.milestones", [{ date: "2027-03-31", target: "250" }]],
    ["goal.milestones", [{ date: "2027-03-31" }]],
    ["goal.milestones", [{ date: "2027-03-31", target: Infinity }]],
    ["goal.milestones", [null]],
    ["goal.milestones", null],
    ["goal.milestones.0", { date: "2027-03-31", target: 250 }],
    ["goal", { target: 1000, milestones: [{ target: 250 }] }],
    ["goal", { target: 1000, milestones: "soon" }],
  ];
  for (const [path, value] of bad)
    assert.throws(() => applyOps(hub, [{ op: "set", path, value }], NOW), /milestones/, `${path} = ${JSON.stringify(value)}`);
  // a whole-goal set without milestones is fine
  assert.equal(applyOps(hub, [{ op: "set", path: "goal", value: { target: 5 } }], NOW).goal.milestones, undefined);
});

test("weekdayOf and nextMilestone", () => {
  assert.equal(weekdayOf("2026-11-09"), "mon");
  assert.equal(weekdayOf("2026-11-10"), "tue");
  assert.equal(weekdayOf("2026-11-15"), "sun");
  assert.equal(weekdayOf("2027-01-02"), "sat");
  const goal = { milestones: [MILESTONES[2], MILESTONES[0], MILESTONES[3], MILESTONES[1]] }; // unsorted on purpose
  assert.deepEqual(nextMilestone(goal, "2026-11-10"), { date: "2027-03-31", target: 250 });
  assert.deepEqual(nextMilestone(goal, "2027-03-31"), { date: "2027-03-31", target: 250 }); // on the day itself
  assert.deepEqual(nextMilestone(goal, "2027-04-01"), { date: "2027-06-30", target: 500 });
  assert.deepEqual(nextMilestone(goal, "2027-11-09"), { date: "2027-11-09", target: 1000 });
  assert.equal(nextMilestone(goal, "2027-11-10"), null);
  assert.equal(nextMilestone({}, "2026-11-10"), null);
  assert.equal(nextMilestone(undefined, "2026-11-10"), null);
  assert.deepEqual(nextMilestone({ milestones: [{ date: "x", target: 1 }, { date: "2027-01-01", target: 2, note: "n" }] }, "2026-11-10"), { date: "2027-01-01", target: 2 });
});

test("report: rhythmToday and nextMilestone", () => {
  const hub = applyOps(fixture(), [
    { op: "set", path: "goal.milestones", value: MILESTONES },
    { op: "upsert", coll: "rhythm", item: { id: "r-tue", owner: "abra", when: "tue", title: "Tuesday thing" } },
    { op: "upsert", coll: "rhythm", item: { id: "r-daily", owner: "michelle", when: "daily", title: "Open Practice" } },
    { op: "upsert", coll: "rhythm", item: { id: "r-mon", owner: "abra", when: "mon", title: "Leadership meeting" } },
    { op: "upsert", coll: "rhythm", item: { id: "r-week", owner: "abra", when: "weekly", title: "No fixed day" } },
    { op: "upsert", coll: "rhythm", item: { id: "r-month", owner: "abra", when: "monthly", title: "Theme talk", note: "First Monday" } },
  ], NOW);
  const tue = report(hub, "2026-11-10");
  assert.deepEqual(tue.rhythmToday.map((r) => r.id), ["r-daily", "r-tue"]); // daily first, then the weekday
  assert.equal(tue.rhythmToday[1].title, "Tuesday thing");
  assert.deepEqual(report(hub, "2026-11-09").rhythmToday.map((r) => r.id), ["r-daily", "r-mon"]);
  assert.deepEqual(report(hub, "2026-11-14").rhythmToday.map((r) => r.id), ["r-daily"]);
  assert.deepEqual(tue.nextMilestone, { date: "2027-03-31", target: 250 });
  assert.equal(report(hub, "2027-12-01").nextMilestone, null);
  // copies, not references
  tue.rhythmToday[0].title = "changed";
  assert.equal(hub.rhythm.find((r) => r.id === "r-daily").title, "Open Practice");
  // hubs without rhythm or milestones
  const bare = report(fixture(), "2026-11-10");
  assert.deepEqual(bare.rhythmToday, []);
  assert.equal(bare.nextMilestone, null);
  assert.deepEqual(report({}, "2026-11-10").rhythmToday, []);
});
