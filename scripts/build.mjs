// Builds the team hub into a static site in dist/.
// The Markdown files and the CSV stay the source of truth: edit them, push, and Vercel rebuilds.
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist");

// Page list = site navigation, in order. [source file, nav label]
const pages = [
  ["README.md", "Home"],
  ["team/roles.md", "Roles"],
  ["schedule/weekly-cadence.md", "Weekly Cadence"],
  ["schedule/content-calendar.csv", "Content Calendar"],
  ["workflows/masterclass-pipeline.md", "Masterclass Pipeline"],
  ["workflows/membership-assets.md", "Membership Assets"],
  ["playbooks/what-to-post.md", "What to Post"],
  ["playbooks/how-to-engage.md", "How to Engage"],
];

const outPath = (src) => (src === "README.md" ? "index.html" : src.replace(/\.(md|csv)$/, ".html"));

const escape = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Minimal CSV parser (handles quoted fields with commas and "" escapes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

function csvToHtml(text) {
  const [header, ...rows] = parseCsv(text);
  const label = (h) => h.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const statusCol = header.indexOf("status");
  const linkCol = header.indexOf("link");
  const cell = (v, i) => {
    if (i === statusCol && v) return `<td><span class="status status-${escape(v.replace(/\s+/g, "-"))}">${escape(v)}</span></td>`;
    if (i === linkCol && /^https?:\/\//.test(v)) return `<td><a href="${escape(v)}">View</a></td>`;
    return `<td>${escape(v)}</td>`;
  };
  return `<h1>Content Calendar</h1>
<p>Edit <code>schedule/content-calendar.csv</code> (Excel or Google Sheets) and push — this page updates automatically.</p>
<div class="table-wrap"><table>
<thead><tr>${header.map((h) => `<th>${escape(label(h))}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${header.map((_, i) => cell(r[i] ?? "", i)).join("")}</tr>`).join("\n")}</tbody>
</table></div>`;
}

// Rewrite links between docs (e.g. ../team/roles.md) to the built .html pages.
function rewriteLinks(html, src) {
  const dir = path.posix.dirname(src);
  return html.replace(/href="([^"#:]+\.(?:md|csv))(#[^"]*)?"/g, (m, href, hash = "") => {
    const target = path.posix.normalize(path.posix.join(dir, href));
    if (!pages.some(([p]) => p === target)) return m;
    const rel = path.posix.relative(dir, outPath(target)) || outPath(target);
    return `href="${rel.replace(/\.html$/, "")}${hash}"`;
  });
}

function layout(title, body, src) {
  const depth = src.split("/").length - 1;
  const base = depth ? "../".repeat(depth) : "./";
  const nav = pages
    .map(([p, label]) => {
      const href = base + outPath(p).replace(/(index)?\.html$/, "");
      return `<a href="${href || "./"}"${p === src ? ' aria-current="page"' : ""}>${label}</a>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Team Hub</title>
<link rel="stylesheet" href="${base}style.css">
</head>
<body>
<header><div class="brand">Team Hub</div><nav>${nav}</nav></header>
<main>${body}</main>
</body>
</html>`;
}

await rm(out, { recursive: true, force: true });
for (const [src, label] of pages) {
  const text = await readFile(path.join(root, src), "utf8");
  const body = src.endsWith(".csv") ? csvToHtml(text) : rewriteLinks(marked.parse(text), src)
        .replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
  const dest = path.join(out, outPath(src));
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, layout(label, body, src));
}
await writeFile(path.join(out, "style.css"), await readFile(path.join(root, "scripts/style.css")));
console.log(`Built ${pages.length} pages into dist/`);
