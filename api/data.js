// GET  /api/data  -> { hub, sha, source: "github" | "local" | "bundle", canWrite, needsPasscode }
// POST /api/data  { ops: [...] } (+ x-team-passcode when TEAM_PASSCODE is set) -> { hub, sha }
// Portable Node handler: works on Vercel and when called directly by scripts/dev.mjs.
import { applyOps, emptyHub, summarizeOps } from "../app/ops.js";
import { createStore, isConflict, passcodeOk, readBundleHub, readJsonBody, sendError, sendJson } from "../lib/store.js";

const ATTEMPTS = 4; // first write + up to 3 retries when someone else saved in between
const MAX_OPS = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Local files live on one machine: run saves one at a time so a burst of edits never conflicts.
let localQueue = Promise.resolve();
const serialLocal = (fn) => {
  const run = localQueue.then(fn, fn);
  localQueue = run.catch(() => {});
  return run;
};

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await read(req, res);
    if (req.method === "POST") return await save(req, res);
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "method-not-allowed" });
  } catch (err) {
    return sendError(res, err);
  }
}

async function read(req, res) {
  const store = createStore();
  const needsPasscode = Boolean(process.env.TEAM_PASSCODE);
  if (!store.configured) {
    const hub = (await readBundleHub(req)) ?? emptyHub();
    return sendJson(res, 200, { hub, sha: null, source: "bundle", canWrite: false, needsPasscode });
  }
  const { hub, sha } = await store.readHub();
  return sendJson(res, 200, {
    hub: hub ?? (await readBundleHub(req)) ?? emptyHub(),
    sha,
    source: store.kind,
    canWrite: true,
    needsPasscode,
  });
}

async function save(req, res) {
  if (!passcodeOk(req)) return sendJson(res, 401, { error: "passcode", message: "Passcode required" });
  const store = createStore();
  if (!store.configured) return sendJson(res, 503, { error: "not-configured" });
  const { ops } = await readJsonBody(req);
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS)
    return sendJson(res, 400, { error: "bad-request", message: `Body must be { ops: [...] } with 1–${MAX_OPS} ops` });
  const message = `Hub: ${summarizeOps(ops)}`;
  const write = () => writeWithRetry(req, res, store, ops, message);
  return store.kind === "local" ? serialLocal(write) : write();
}

async function writeWithRetry(req, res, store, ops, message) {
  for (let attempt = 1; ; attempt++) {
    const latest = await store.readHub();
    const base = latest.hub ?? (await readBundleHub(req)) ?? emptyHub();
    let hub;
    try {
      hub = applyOps(base, ops);
    } catch (err) {
      return sendJson(res, 400, { error: "bad-op", message: err.message });
    }
    try {
      const { sha } = await store.writeHub(hub, latest.sha, message);
      return sendJson(res, 200, { hub, sha });
    } catch (err) {
      if (!isConflict(err) || attempt >= ATTEMPTS) throw err;
      await sleep(120 * attempt + Math.random() * 300); // jitter so simultaneous retries spread out
    }
  }
}
