// GET /api/doc?slug=x               -> { slug, markdown, sha, source, canWrite }
// PUT /api/doc { slug, markdown, sha? } (+ x-team-passcode when TEAM_PASSCODE is set) -> { slug, sha }
import { SLUG_RE } from "../app/ops.js";
import { createStore, passcodeOk, readBundleDoc, readJsonBody, sendError, sendJson } from "../lib/store.js";

const MAX_MARKDOWN = 500_000;

export default async function handler(req, res) {
  try {
    if (req.method === "GET") return await read(req, res);
    if (req.method === "PUT") return await save(req, res);
    res.setHeader("Allow", "GET, PUT");
    return sendJson(res, 405, { error: "method-not-allowed" });
  } catch (err) {
    return sendError(res, err);
  }
}

const badSlug = (res) => sendJson(res, 400, { error: "bad-slug", message: "slug must match /^[a-z0-9-]{1,60}$/" });

async function read(req, res) {
  const slug = new URL(req.url || "/", "http://localhost").searchParams.get("slug") ?? "";
  if (!SLUG_RE.test(slug)) return badSlug(res);
  const store = createStore();
  if (store.configured) {
    const doc = await store.readDoc(slug);
    if (doc) return sendJson(res, 200, { slug, markdown: doc.markdown, sha: doc.sha, source: store.kind, canWrite: true });
  }
  const markdown = await readBundleDoc(slug, req);
  if (markdown == null) return sendJson(res, 404, { error: "not-found" });
  return sendJson(res, 200, { slug, markdown, sha: null, source: "bundle", canWrite: store.configured });
}

async function save(req, res) {
  if (!passcodeOk(req)) return sendJson(res, 401, { error: "passcode", message: "Passcode required" });
  const store = createStore();
  if (!store.configured) return sendJson(res, 503, { error: "not-configured" });
  const { slug, markdown, sha } = await readJsonBody(req);
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return badSlug(res);
  if (typeof markdown !== "string" || markdown.length > MAX_MARKDOWN)
    return sendJson(res, 400, { error: "bad-request", message: "markdown must be a string under 500 KB" });
  const result = await store.writeDoc(slug, markdown, `Hub: update doc ${slug}`, typeof sha === "string" ? sha : undefined);
  return sendJson(res, 200, { slug, sha: result.sha });
}
