// Storage for data/hub.json and data/docs/<slug>.md, plus small helpers shared by api/*.js.
//   GitHub  — GITHUB_TOKEN + GITHUB_REPO (owner/name); branch = GITHUB_BRANCH or the repo default.
//   Local   — HUB_DATA_DIR (the dev server and tests); sha = git blob sha of the file.
//   Neither — not configured: reads fall back to the deployed snapshot ("bundle"), writes are refused.
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SLUG_RE } from "../app/ops.js";

export const HUB_PATH = "data/hub.json";
export const docPath = (slug) => `data/docs/${slug}.md`;

export class StoreError extends Error {
  constructor(message, { status = 502, code = "store-error" } = {}) {
    super(message);
    this.name = "StoreError";
    this.status = status;
    this.code = code;
  }
}
export class ConflictError extends StoreError {
  constructor(message = "The file changed since it was read") {
    super(message, { status: 409, code: "conflict" });
    this.name = "ConflictError";
  }
}
export const isConflict = (err) => err?.code === "conflict";

export const serializeHub = (hub) => JSON.stringify(hub, null, 2) + "\n";
export const gitSha = (text) => {
  const buf = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
};

function assertSlug(slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) throw new StoreError("Invalid slug", { status: 400, code: "bad-slug" });
}

function parseHub(text, where) {
  try {
    return JSON.parse(text);
  } catch {
    throw new StoreError(`${where} is not valid JSON`, { status: 500, code: "bad-data" });
  }
}

/**
 * createStore(env = process.env) -> {
 *   kind: "github" | "local" | "none", configured: boolean,
 *   readHub(): Promise<{ hub: object | null, sha: string | null }>,          // hub null = file missing
 *   writeHub(hub, sha, message): Promise<{ sha }>,                           // sha null = create; throws ConflictError
 *   readDoc(slug): Promise<{ markdown, sha } | null>,
 *   writeDoc(slug, markdown, message, sha?): Promise<{ sha }>,               // sha omitted = overwrite latest
 * }
 */
export function createStore(env = process.env) {
  if (env.GITHUB_TOKEN && env.GITHUB_REPO)
    return githubStore({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || "", apiUrl: env.GITHUB_API_URL });
  if (env.HUB_DATA_DIR) return localStore(env.HUB_DATA_DIR);
  return notConfiguredStore();
}

export function notConfiguredStore() {
  const refuse = async () => {
    throw new StoreError("Storage is not configured", { status: 503, code: "not-configured" });
  };
  return { kind: "none", configured: false, readHub: refuse, writeHub: refuse, readDoc: refuse, writeDoc: refuse };
}

// ---------------------------------------------------------------- GitHub contents API

export function githubStore({ token, repo, branch = "", apiUrl = "https://api.github.com" }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new StoreError("GITHUB_REPO must be owner/name", { status: 500, code: "bad-config" });
  const base = `${(apiUrl || "https://api.github.com").replace(/\/+$/, "")}/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "inner-board-hub",
  };

  async function call(method, url, body) {
    try {
      return await globalThis.fetch(url, {
        method,
        headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new StoreError(`GitHub request failed: ${err.message}`);
    }
  }

  async function failure(res, what) {
    let detail = "";
    try {
      detail = (await res.json()).message || "";
    } catch {}
    return new StoreError(`GitHub ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }

  async function getFile(file) {
    const res = await call("GET", `${base}/contents/${file}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await failure(res, `read ${file}`);
    const meta = await res.json();
    if (Array.isArray(meta) || meta.type !== "file") throw new StoreError(`${file} is not a file`);
    let b64 = meta.content;
    if (!b64 && meta.encoding === "none") {
      // Files over 1 MB come without content; fetch the blob instead.
      const blob = await call("GET", `${base}/git/blobs/${meta.sha}`);
      if (!blob.ok) throw await failure(blob, `read ${file}`);
      b64 = (await blob.json()).content;
    }
    return { text: Buffer.from(b64 || "", "base64").toString("utf8"), sha: meta.sha };
  }

  async function putFile(file, text, sha, message) {
    const body = { message, content: Buffer.from(text, "utf8").toString("base64") };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    const res = await call("PUT", `${base}/contents/${file}`, body);
    if (res.status === 409) throw new ConflictError();
    if (res.status === 422) {
      const err = await failure(res, `write ${file}`);
      if (/sha/i.test(err.message)) throw new ConflictError(err.message);
      throw err;
    }
    if (!res.ok) throw await failure(res, `write ${file}`);
    return { sha: (await res.json()).content.sha };
  }

  return {
    kind: "github",
    configured: true,
    async readHub() {
      const f = await getFile(HUB_PATH);
      return f ? { hub: parseHub(f.text, HUB_PATH), sha: f.sha } : { hub: null, sha: null };
    },
    writeHub: (hub, sha, message = "Hub: update") => putFile(HUB_PATH, serializeHub(hub), sha, message),
    async readDoc(slug) {
      assertSlug(slug);
      const f = await getFile(docPath(slug));
      return f ? { markdown: f.text, sha: f.sha } : null;
    },
    async writeDoc(slug, markdown, message = `Hub: update doc ${slug}`, sha) {
      assertSlug(slug);
      if (sha === undefined) sha = (await getFile(docPath(slug)))?.sha ?? null;
      return putFile(docPath(slug), markdown, sha, message);
    },
  };
}

// ---------------------------------------------------------------- local files

const locks = new Map();
function withLock(key, fn) {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => locks.get(key) === tail && locks.delete(key));
  return run;
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new StoreError(`Could not read ${file}: ${err.message}`, { status: 500 });
  }
}

export function localStore(dir) {
  const root = path.resolve(dir);
  const hubFile = path.join(root, "hub.json");
  const docFile = (slug) => path.join(root, "docs", `${slug}.md`);

  // sha undefined = no check; null/"" = the file must not exist yet; otherwise must match the current sha.
  const writeChecked = (file, text, sha) =>
    withLock(file, async () => {
      const current = await readText(file);
      const currentSha = current == null ? null : gitSha(current);
      if (sha !== undefined && (sha || null) !== currentSha) throw new ConflictError();
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      await writeFile(tmp, text);
      await rename(tmp, file);
      return { sha: gitSha(text) };
    });

  return {
    kind: "local",
    configured: true,
    dir: root,
    async readHub() {
      const text = await readText(hubFile);
      return text == null ? { hub: null, sha: null } : { hub: parseHub(text, hubFile), sha: gitSha(text) };
    },
    writeHub: (hub, sha) => writeChecked(hubFile, serializeHub(hub), sha),
    async readDoc(slug) {
      assertSlug(slug);
      const text = await readText(docFile(slug));
      return text == null ? null : { markdown: text, sha: gitSha(text) };
    },
    async writeDoc(slug, markdown, _message, sha) {
      assertSlug(slug);
      return writeChecked(docFile(slug), markdown, sha);
    },
  };
}

// ---------------------------------------------------------------- deployed snapshot ("bundle")

function origin(req) {
  const h = req?.headers ?? {};
  const host = h["x-forwarded-host"] || h.host;
  if (!host) return null;
  const proto = String(h["x-forwarded-proto"] || (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https")).split(",")[0];
  return `${proto}://${host}`;
}

// data/** is shipped with the functions (vercel.json includeFiles); dist/data is the static copy.
async function readBundleText(rel, req, cwd) {
  for (const dir of ["", "dist"]) {
    const text = await readText(path.join(cwd, dir, "data", rel));
    if (text != null) return text;
  }
  const o = origin(req);
  if (!o) return null;
  try {
    const res = await globalThis.fetch(`${o}/data/${rel}`);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function readBundleHub(req, cwd = process.cwd()) {
  const text = await readBundleText("hub.json", req, cwd);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function readBundleDoc(slug, req, cwd = process.cwd()) {
  assertSlug(slug);
  return readBundleText(`docs/${slug}.md`, req, cwd);
}

// ---------------------------------------------------------------- request helpers for api/*.js

export class HttpError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export function sendError(res, err) {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500 && status !== 503) console.error(err);
  sendJson(res, status, { error: err?.code || "server-error", message: err?.message || "Something went wrong" });
}

// Works with Vercel's pre-parsed req.body and with a raw Node request stream.
export async function readJsonBody(req, limit = 1_000_000) {
  let body;
  try {
    body = req.body;
  } catch {
    throw new HttpError(400, "bad-json", "Body is not valid JSON");
  }
  if (body == null) {
    const chunks = [];
    let size = 0;
    if (!req.readableEnded) {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new HttpError(413, "too-large", "Body is too large");
        chunks.push(chunk);
      }
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try {
      body = JSON.parse(body);
    } catch {
      throw new HttpError(400, "bad-json", "Body is not valid JSON");
    }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad-request", "Body must be a JSON object");
  return body;
}

// True when TEAM_PASSCODE is unset, or the x-team-passcode header matches it.
export function passcodeOk(req, env = process.env) {
  const expected = env.TEAM_PASSCODE;
  if (!expected) return true;
  const given = req.headers?.["x-team-passcode"];
  if (typeof given !== "string" || !given) return false;
  const digest = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
