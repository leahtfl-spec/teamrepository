// Local server: serves dist/ and runs the API handlers against local files.
// HUB_DATA_DIR defaults to ./data (edits go straight into the repo's data files). PORT defaults to 3000.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
process.env.HUB_DATA_DIR ||= path.join(root, "data");
const port = Number(process.env.PORT) || 3000;

const { default: data } = await import("../api/data.js");
const { default: doc } = await import("../api/doc.js");
const routes = { "/api/data": data, "/api/doc": doc };

const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

async function serveStatic(req, res, pathname) {
  let file = path.join(dist, path.normalize(decodeURIComponent(pathname)).replace(/^([/\\]*\.\.)+/, ""));
  if (!file.startsWith(dist)) return notFound(res);
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const handler = routes[pathname.replace(/\/$/, "")];
  try {
    if (handler) await handler(req, res);
    else if (req.method === "GET" || req.method === "HEAD") await serveStatic(req, res, pathname);
    else notFound(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, () => {
  console.log(`Inner Board hub on http://localhost:${port}  (data: ${process.env.GITHUB_REPO ? `github ${process.env.GITHUB_REPO}` : process.env.HUB_DATA_DIR})`);
});
