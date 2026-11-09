import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, createStore, gitSha, githubStore, isConflict, localStore, serializeHub } from "../lib/store.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
async function tempData() {
  const dir = await mkdtemp(path.join(tmpdir(), "hub-store-"));
  await cp(fixtures, dir, { recursive: true });
  return dir;
}

test("createStore picks github, then local, then none", () => {
  assert.equal(createStore({ GITHUB_TOKEN: "x", GITHUB_REPO: "a/b", HUB_DATA_DIR: "/tmp" }).kind, "github");
  assert.equal(createStore({ GITHUB_TOKEN: "x", HUB_DATA_DIR: "/tmp" }).kind, "local");
  const none = createStore({});
  assert.equal(none.kind, "none");
  assert.equal(none.configured, false);
  return assert.rejects(none.readHub(), { code: "not-configured", status: 503 });
});

test("local: read, write with sha, conflict", async () => {
  const dir = await tempData();
  try {
    const store = localStore(dir);
    const { hub, sha } = await store.readHub();
    assert.equal(hub.brand.name, "Inner Board");
    assert.equal(sha, gitSha(await readFile(path.join(dir, "hub.json"), "utf8")));

    hub.goal.current = 150;
    const w = await store.writeHub(hub, sha, "Hub: test");
    const text = await readFile(path.join(dir, "hub.json"), "utf8");
    assert.equal(text, serializeHub(hub));
    assert.ok(text.endsWith("}\n") && text.includes('\n  "version": 1'));
    assert.equal(w.sha, gitSha(text));

    await assert.rejects(store.writeHub(hub, sha, "stale"), (e) => e instanceof ConflictError && isConflict(e));
    await assert.rejects(store.writeHub(hub, null, "create"), { code: "conflict" });
    assert.equal((await store.readHub()).hub.goal.current, 150);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local: missing hub, create with null sha", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hub-empty-"));
  try {
    const store = localStore(dir);
    assert.deepEqual(await store.readHub(), { hub: null, sha: null });
    await store.writeHub({ version: 1 }, null);
    assert.equal((await store.readHub()).hub.version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local: docs", async () => {
  const dir = await tempData();
  try {
    const store = localStore(dir);
    const doc = await store.readDoc("road-to-1000");
    assert.match(doc.markdown, /^# Road to 1,000/);
    assert.equal(await store.readDoc("missing"), null);
    const w = await store.writeDoc("new-page", "# New\n", "msg");
    assert.equal((await store.readDoc("new-page")).sha, w.sha);
    await assert.rejects(store.writeDoc("new-page", "# Other\n", "msg", doc.sha), { code: "conflict" });
    await assert.rejects(store.readDoc("../hub"), { code: "bad-slug" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local: concurrent writes with the same sha — exactly one wins", async () => {
  const dir = await tempData();
  try {
    const store = localStore(dir);
    const { hub, sha } = await store.readHub();
    const results = await Promise.allSettled([1, 2, 3].map((n) => store.writeHub({ ...hub, n }, sha)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- GitHub adapter against a stubbed global fetch

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeGitHub(files = {}) {
  const repo = new Map(Object.entries(files).map(([p, text]) => [p, { text, sha: gitSha(text) }]));
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    calls.push({ method, url: u, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const m = u.pathname.match(/^\/repos\/acme\/hub\/contents\/(.+)$/);
    if (!m) return json(404, { message: "Not Found" });
    const file = repo.get(m[1]);
    if (method === "GET") {
      if (!file) return json(404, { message: "Not Found" });
      return json(200, { type: "file", sha: file.sha, encoding: "base64", content: Buffer.from(file.text).toString("base64").replace(/(.{60})/g, "$1\n") });
    }
    if (method === "PUT") {
      const body = JSON.parse(init.body);
      if (file && !body.sha) return json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (file && body.sha !== file.sha) return json(409, { message: `${m[1]} does not match ${body.sha}` });
      const text = Buffer.from(body.content, "base64").toString("utf8");
      const next = { text, sha: gitSha(text) };
      repo.set(m[1], next);
      return json(file ? 200 : 201, { content: { sha: next.sha, path: m[1] } });
    }
    return json(405, {});
  };
  return { repo, calls };
}

test("github: read hub, write with sha, conflict, branch", async () => {
  const hubText = serializeHub({ version: 1, goal: { current: 1 } });
  const gh = fakeGitHub({ "data/hub.json": hubText });
  const store = createStore({ GITHUB_TOKEN: "tok", GITHUB_REPO: "acme/hub", GITHUB_BRANCH: "data" });
  const { hub, sha } = await store.readHub();
  assert.deepEqual(hub, { version: 1, goal: { current: 1 } });
  assert.equal(sha, gitSha(hubText));
  assert.equal(gh.calls[0].url.searchParams.get("ref"), "data");
  assert.equal(gh.calls[0].headers.Authorization, "Bearer tok");

  const w = await store.writeHub({ ...hub, goal: { current: 2 } }, sha, "Hub: set goal.current");
  const put = gh.calls.at(-1);
  assert.equal(put.method, "PUT");
  assert.equal(put.body.branch, "data");
  assert.equal(put.body.sha, sha);
  assert.equal(put.body.message, "Hub: set goal.current");
  assert.equal(w.sha, gh.repo.get("data/hub.json").sha);
  assert.equal(JSON.parse(gh.repo.get("data/hub.json").text).goal.current, 2);

  await assert.rejects(store.writeHub(hub, sha, "stale"), { code: "conflict" });
  await assert.rejects(store.writeHub(hub, null, "no sha"), { code: "conflict" });
});

test("github: default branch, missing files, docs, errors", async () => {
  const gh = fakeGitHub({ "data/docs/road-to-1000.md": "# Road\n" });
  const store = githubStore({ token: "tok", repo: "acme/hub" });
  assert.deepEqual(await store.readHub(), { hub: null, sha: null });
  assert.equal(gh.calls[0].url.search, "");
  assert.equal((await store.readDoc("road-to-1000")).markdown, "# Road\n");
  assert.equal(await store.readDoc("nope"), null);
  // writeDoc without sha overwrites the latest
  const w = await store.writeDoc("road-to-1000", "# Road v2\n", "Hub: update doc road-to-1000");
  assert.equal(gh.repo.get("data/docs/road-to-1000.md").text, "# Road v2\n");
  assert.equal(w.sha, gitSha("# Road v2\n"));
  assert.equal(gh.calls.at(-1).body.branch, undefined);

  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
  await assert.rejects(store.readHub(), (e) => e.status === 502 && /Bad credentials/.test(e.message));
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  await assert.rejects(store.readHub(), /offline/);
  assert.throws(() => githubStore({ token: "t", repo: "not a repo" }), /owner\/name/);
});
