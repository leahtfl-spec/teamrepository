import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import data from "../api/data.js";
import doc from "../api/doc.js";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
let server, base, dir;
const ENV_KEYS = ["GITHUB_TOKEN", "GITHUB_REPO", "GITHUB_BRANCH", "HUB_DATA_DIR", "TEAM_PASSCODE"];

before(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  server = createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/api/data") return data(req, res);
    if (pathname === "/api/doc") return doc(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

beforeEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = await mkdtemp(path.join(tmpdir(), "hub-api-"));
  await cp(fixtures, dir, { recursive: true });
  process.env.HUB_DATA_DIR = dir;
});
after(() => rm(dir, { recursive: true, force: true }));

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, cache: res.headers.get("cache-control"), type: res.headers.get("content-type"), json: await res.json() };
};

test("GET /api/data reads the local store", async () => {
  const r = await call("GET", "/api/data");
  assert.equal(r.status, 200);
  assert.equal(r.cache, "no-store");
  assert.match(r.type, /application\/json/);
  assert.equal(r.json.source, "local");
  assert.equal(r.json.canWrite, true);
  assert.equal(r.json.needsPasscode, false);
  assert.match(r.json.sha, /^[0-9a-f]{40}$/);
  assert.equal(r.json.hub.brand.name, "Inner Board");
});

test("POST /api/data applies ops and writes the file", async () => {
  const r = await call("POST", "/api/data", { ops: [
    { op: "upsert", coll: "tasks", item: { id: "t-soon", status: "done" } },
    { op: "set", path: "goal.current", value: 130 },
  ] });
  assert.equal(r.status, 200);
  const saved = JSON.parse(await readFile(path.join(dir, "hub.json"), "utf8"));
  assert.equal(saved.goal.current, 130);
  assert.ok(saved.tasks.find((t) => t.id === "t-soon").doneAt);
  assert.deepEqual(r.json.hub, saved);
  assert.equal(r.json.sha, (await call("GET", "/api/data")).json.sha);
});

test("POST /api/data 400s", async () => {
  for (const body of [{ ops: [{ op: "upsert", coll: "nope", item: { id: "x" } }] }, { ops: [] }, { nope: 1 }, "{not json", "[1]"]) {
    const r = await call("POST", "/api/data", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.json.error);
  }
  const r = await call("POST", "/api/data", { ops: [{ op: "set", path: "tasks", value: [] }] });
  assert.equal(r.json.error, "bad-op");
  assert.match(r.json.message, /brand, goal, settings/);
});

test("passcode is required for writes when TEAM_PASSCODE is set", async () => {
  process.env.TEAM_PASSCODE = "open sesame";
  const ops = { ops: [{ op: "set", path: "goal.current", value: 1 }] };
  assert.equal((await call("POST", "/api/data", ops)).status, 401);
  assert.equal((await call("POST", "/api/data", ops, { "x-team-passcode": "wrong" })).status, 401);
  assert.equal((await call("POST", "/api/data", ops, { "x-team-passcode": "open sesame" })).status, 200);
  assert.equal((await call("PUT", "/api/doc", { slug: "a", markdown: "x" })).status, 401);
  const g = await call("GET", "/api/data");
  assert.equal(g.status, 200);
  assert.equal(g.json.needsPasscode, true);
});

test("not configured: GET serves the bundle read-only, writes 503", async () => {
  delete process.env.HUB_DATA_DIR;
  const cwd = process.cwd();
  const bundle = await mkdtemp(path.join(tmpdir(), "hub-bundle-"));
  await mkdir(path.join(bundle, "data", "docs"), { recursive: true });
  await cp(path.join(fixtures, "hub.json"), path.join(bundle, "data", "hub.json"));
  await cp(path.join(fixtures, "docs"), path.join(bundle, "data", "docs"), { recursive: true });
  process.chdir(bundle);
  try {
    const g = await call("GET", "/api/data");
    assert.equal(g.status, 200);
    assert.equal(g.json.source, "bundle");
    assert.equal(g.json.canWrite, false);
    assert.equal(g.json.sha, null);
    assert.equal(g.json.hub.goal.target, 1000);
    const p = await call("POST", "/api/data", { ops: [{ op: "set", path: "goal.current", value: 1 }] });
    assert.equal(p.status, 503);
    assert.deepEqual(p.json, { error: "not-configured" });
    const d = await call("GET", "/api/doc?slug=road-to-1000");
    assert.equal(d.status, 200);
    assert.equal(d.json.source, "bundle");
    assert.equal(d.json.canWrite, false);
    assert.equal((await call("PUT", "/api/doc", { slug: "road-to-1000", markdown: "x" })).status, 503);
  } finally {
    process.chdir(cwd);
    await rm(bundle, { recursive: true, force: true });
  }
});

test("GET/PUT /api/doc", async () => {
  const g = await call("GET", "/api/doc?slug=road-to-1000");
  assert.equal(g.status, 200);
  assert.equal(g.json.slug, "road-to-1000");
  assert.match(g.json.markdown, /One member at a time/);
  assert.match(g.json.sha, /^[0-9a-f]{40}$/);
  assert.equal(g.cache, "no-store");

  const p = await call("PUT", "/api/doc", { slug: "new-page", markdown: "# New page\n" });
  assert.equal(p.status, 200);
  assert.equal(await readFile(path.join(dir, "docs", "new-page.md"), "utf8"), "# New page\n");
  assert.equal((await call("GET", "/api/doc?slug=new-page")).json.sha, p.json.sha);
  assert.equal((await call("PUT", "/api/doc", { slug: "new-page", markdown: "y", sha: g.json.sha })).status, 409);
  assert.equal((await call("GET", "/api/doc?slug=missing")).status, 404);
});

test("bad slugs and methods", async () => {
  for (const q of ["", "?slug=", "?slug=Road", "?slug=../hub", "?slug=" + "a".repeat(61), "?slug=a%2Fb"]) {
    const r = await call("GET", "/api/doc" + q);
    assert.equal(r.status, 400, q);
    assert.equal(r.json.error, "bad-slug");
  }
  assert.equal((await call("PUT", "/api/doc", { slug: "../../etc", markdown: "x" })).status, 400);
  assert.equal((await call("PUT", "/api/doc", { slug: "ok", markdown: 5 })).status, 400);
  assert.equal((await call("DELETE", "/api/data")).status, 405);
  assert.equal((await call("POST", "/api/doc", {})).status, 405);
});

const fakeRes = () => {
  const out = { headers: {}, statusCode: 0, body: "" };
  out.setHeader = (k, v) => (out.headers[k.toLowerCase()] = v);
  out.end = (b) => (out.body = b);
  return out;
};

test("Vercel-style pre-parsed req.body (no stream)", async () => {
  const res = fakeRes();
  await data({ method: "POST", headers: {}, url: "/api/data", body: { ops: [{ op: "set", path: "goal.current", value: 777 }] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(res.body).hub.goal.current, 777);
  assert.equal(JSON.parse(await readFile(path.join(dir, "hub.json"), "utf8")).goal.current, 777);

  const bad = fakeRes();
  await data({ method: "POST", headers: {}, url: "/api/data", get body() { throw new Error("Invalid JSON"); } }, bad);
  assert.equal(bad.statusCode, 400);
});

test("GitHub store: POST retries on sha conflict and re-applies ops on the latest hub", async () => {
  delete process.env.HUB_DATA_DIR;
  process.env.GITHUB_TOKEN = "tok";
  process.env.GITHUB_REPO = "acme/hub";
  const realFetch = globalThis.fetch;
  const fixture = JSON.parse(await readFile(path.join(fixtures, "hub.json"), "utf8"));
  let file = { text: JSON.stringify(fixture), sha: "sha-1" };
  let puts = 0;
  const messages = [];
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith("https://api.github.com/")) return realFetch(url, init);
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    if ((init.method || "GET") === "GET")
      return json(200, { type: "file", sha: file.sha, encoding: "base64", content: Buffer.from(file.text).toString("base64") });
    const body = JSON.parse(init.body);
    messages.push(body.message);
    puts++;
    if (puts === 1) {
      // someone else saved between our read and write
      const other = { ...fixture, goal: { ...fixture.goal, target: 2000 } };
      file = { text: JSON.stringify(other), sha: "sha-2" };
    }
    if (body.sha !== file.sha) return json(409, { message: "does not match" });
    file = { text: Buffer.from(body.content, "base64").toString("utf8"), sha: `sha-${puts + 2}` };
    return json(200, { content: { sha: file.sha } });
  };
  try {
    const r = await call("POST", "/api/data", { ops: [{ op: "set", path: "goal.current", value: 140 }] });
    assert.equal(r.status, 200);
    assert.equal(puts, 2);
    assert.equal(r.json.sha, file.sha);
    const saved = JSON.parse(file.text);
    assert.equal(saved.goal.current, 140);
    assert.equal(saved.goal.target, 2000);
    assert.deepEqual(messages, ["Hub: set goal.current", "Hub: set goal.current"]);
    const g = await call("GET", "/api/data");
    assert.equal(g.json.source, "github");
    assert.equal(g.json.sha, file.sha);

    // permanent conflict -> 409 after 4 attempts
    puts = 0;
    globalThis.fetch = async (url, init = {}) => {
      if (!String(url).startsWith("https://api.github.com/")) return realFetch(url, init);
      if ((init.method || "GET") === "GET")
        return new Response(JSON.stringify({ type: "file", sha: "x", content: Buffer.from(file.text).toString("base64") }), { status: 200 });
      puts++;
      return new Response(JSON.stringify({ message: "conflict" }), { status: 409 });
    };
    const c = await call("POST", "/api/data", { ops: [{ op: "set", path: "goal.current", value: 1 }] });
    assert.equal(c.status, 409);
    assert.equal(c.json.error, "conflict");
    assert.equal(puts, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});
