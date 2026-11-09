// Builds the static site: app/ -> dist/, data snapshot -> dist/data/, marked -> dist/vendor/marked.js.
// The live data is read through /api/data; dist/data is only the fallback snapshot.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const from = (...p) => path.join(root, ...p);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

if (existsSync(from("app"))) await cp(from("app"), dist, { recursive: true });
else console.warn("build: app/ not found, dist/ has no front end");

let docs = 0;
await mkdir(path.join(dist, "data", "docs"), { recursive: true });
// The snapshot is public, so teammates' reminder emails are blanked; the live API serves the real ones.
if (existsSync(from("data", "hub.json"))) {
  const hub = JSON.parse(await readFile(from("data", "hub.json"), "utf8"));
  for (const p of hub.people || []) if (p && typeof p === "object" && "email" in p) p.email = "";
  await writeFile(path.join(dist, "data", "hub.json"), JSON.stringify(hub, null, 2) + "\n");
}
else console.warn("build: data/hub.json not found, skipping snapshot");
if (existsSync(from("data", "docs"))) {
  for (const name of await readdir(from("data", "docs"))) {
    if (!name.endsWith(".md")) continue;
    await cp(from("data", "docs", name), path.join(dist, "data", "docs", name));
    docs++;
  }
}

// marked's ESM build (package "exports" -> import). Drop the source-map comment; the map is not shipped.
let markedFile = from("node_modules", "marked", "lib", "marked.esm.js");
try {
  markedFile = fileURLToPath(import.meta.resolve("marked"));
} catch {}
const marked = (await readFile(markedFile, "utf8")).replace(/\n\/\/# sourceMappingURL=.*\s*$/, "\n");
await mkdir(path.join(dist, "vendor"), { recursive: true });
await writeFile(path.join(dist, "vendor", "marked.js"), marked);

console.log(`Built dist/ (app, data snapshot with ${docs} docs, vendor/marked.js)`);
