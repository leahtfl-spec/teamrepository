#!/usr/bin/env node
// Command line access to the hub data, for teammates and the daily routine.
//   node scripts/hub.mjs apply <ops.json | ->   apply an ops array (or { ops: [...] }) to hub.json
//   node scripts/hub.mjs report [YYYY-MM-DD]    print report() JSON (default: today)
// Reads/writes HUB_DATA_DIR (default: <repo>/data). Commit the result yourself.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyOps, localDate, report, summarizeOps } from "../app/ops.js";
import { localStore } from "../lib/store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = localStore(process.env.HUB_DATA_DIR || path.join(root, "data"));
const [cmd, arg] = process.argv.slice(2);

async function readInput(file) {
  if (file === "-") {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(file, "utf8");
}

async function loadHub() {
  const { hub, sha } = await store.readHub();
  if (!hub) throw new Error(`No hub.json in ${store.dir}`);
  return { hub, sha };
}

try {
  if (cmd === "apply" && arg) {
    const parsed = JSON.parse(await readInput(arg));
    const ops = Array.isArray(parsed) ? parsed : parsed?.ops;
    if (!Array.isArray(ops)) throw new Error("ops file must contain an array of ops or { ops: [...] }");
    const { hub, sha } = await loadHub();
    const next = applyOps(hub, ops);
    await store.writeHub(next, sha);
    const counts = {};
    for (const op of ops) counts[`${op.op} ${op.coll ?? op.path}`] = (counts[`${op.op} ${op.coll ?? op.path}`] ?? 0) + 1;
    console.log(`Applied ${ops.length} op${ops.length === 1 ? "" : "s"} to ${path.join(store.dir, "hub.json")}`);
    for (const [k, n] of Object.entries(counts)) console.log(`  ${k}${n > 1 ? ` ×${n}` : ""}`);
    console.log(`Commit message: Hub: ${summarizeOps(ops)}`);
  } else if (cmd === "report") {
    const { hub } = await loadHub();
    console.log(JSON.stringify(report(hub, arg || localDate()), null, 2));
  } else {
    console.error("Usage:\n  node scripts/hub.mjs apply <ops.json | ->\n  node scripts/hub.mjs report [YYYY-MM-DD]");
    process.exit(2);
  }
} catch (err) {
  console.error(`hub: ${err.message}`);
  process.exit(1);
}
