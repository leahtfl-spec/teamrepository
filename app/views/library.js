import { marked } from "../vendor/marked.js";
import { SLUG_RE } from "../ops.js";
import { state, getDoc, saveDoc } from "../store.js";
import { app, h, icon, act, editable, removeWithUndo, pageHead, empty, toast, slugify } from "../ui.js";

const cache = new Map(); // slug -> { markdown, sha, missing }
let editing = null;      // { slug, draft }
let creating = false;

const docs = () => state.hub.docs || [];
const docBySlug = (slug) => docs().find((d) => d.slug === slug);
const saveMeta = (slug, item) => act([{ op: "upsert", coll: "docs", item: { slug, ...item } }]);

export function leave() { creating = false; }

// marked does not sanitize; pages are written by the team, but strip anything executable anyway.
function toHtml(md, title) {
  const tpl = document.createElement("template");
  tpl.innerHTML = marked.parse(md || "", { gfm: true, breaks: false });
  const root = tpl.content;
  root.querySelectorAll("script, iframe, object, embed, style, link, meta, form").forEach((n) => n.remove());
  root.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value))) el.removeAttribute(a.name);
    }
    if (el.tagName === "A" && /^https?:/i.test(el.getAttribute("href") || "")) { el.target = "_blank"; el.rel = "noopener"; }
  });
  root.querySelectorAll("table").forEach((t) => t.replaceWith(h("div", { class: "prose-table" }, t.cloneNode(true))));
  const first = root.firstElementChild;
  if (first?.tagName === "H1" && first.textContent.trim().toLowerCase() === String(title).trim().toLowerCase()) first.remove();
  return root;
}

async function fetchDoc(slug) {
  try {
    cache.set(slug, await getDoc(slug));
  } catch {
    cache.set(slug, { markdown: "", sha: null, error: true });
  }
  if (location.hash.startsWith(`#/library/${slug}`)) app.render();
}

export function render({ param, query, fresh }) {
  if (param) return renderDoc(param, { fresh, wantEdit: query.get("edit") === "1" });
  return renderIndex();
}

function renderIndex() {
  const groups = new Map();
  for (const d of docs()) {
    const g = d.group || "Other";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(d);
  }
  const knownGroups = [...groups.keys()];
  const newPage = creating ? newPageForm(knownGroups) : null;
  return h("div", { class: "page" },
    pageHead("Library", "Playbooks and how we work.", h("button", { type: "button", class: "btn btn-quiet", onclick: () => { creating = true; app.render(); requestAnimationFrame(() => document.querySelector(".new-page input")?.focus()); } }, icon("plus", 16), "New page")),
    newPage,
    groups.size
      ? h("div", { class: "groups lib-groups" }, [...groups.entries()].map(([g, list]) => h("section", { class: "group" },
          h("div", { class: "group-head" }, h("h2", { class: "group-title" }, g), h("span", { class: "group-count" }, list.length)),
          h("div", { class: "card list" }, list.map((d) => h("a", { class: "row doc-row", href: `#/library/${d.slug}` },
            h("span", { class: "doc-icon" }, icon("doc", 18)),
            h("span", { class: "row-title" }, d.title || d.slug),
            h("span", { class: "row-chev" }, icon("chevron", 16))))))))
      : empty("The library is empty", "Write the first playbook: how we do something, step by step.", h("button", { type: "button", class: "btn btn-primary", onclick: () => { creating = true; app.render(); } }, "New page")),
  );
}

function newPageForm(groups) {
  const title = h("input", { class: "input", placeholder: "Page title", "aria-label": "Page title" });
  const group = h("input", { class: "input", placeholder: "Group (e.g. How we work)", list: "lib-groups", "aria-label": "Group", value: groups[0] || "" });
  const create = () => {
    const t = title.value.trim();
    if (!t) return title.focus();
    let slug = slugify(t), n = 2;
    while (docBySlug(slug)) slug = `${slugify(t).slice(0, 56)}-${n++}`;
    if (!SLUG_RE.test(slug)) return toast("Try a shorter title.");
    if (!saveMeta(slug, { title: t, group: group.value.trim() || "Other" })) return;
    creating = false;
    cache.set(slug, { markdown: "", sha: null, missing: true });
    editing = { slug, draft: `# ${t}\n\n` };
    location.hash = `#/library/${slug}`;
  };
  const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); create(); } if (e.key === "Escape") { creating = false; app.render(); } };
  title.addEventListener("keydown", onKey);
  group.addEventListener("keydown", onKey);
  return h("div", { class: "card new-page" },
    h("datalist", { id: "lib-groups" }, groups.map((g) => h("option", { value: g }))),
    title, group,
    h("div", { class: "new-page-actions" },
      h("button", { type: "button", class: "btn btn-quiet", onclick: () => { creating = false; app.render(); } }, "Cancel"),
      h("button", { type: "button", class: "btn btn-primary", onclick: create }, "Create page")));
}

function renderDoc(slug, { fresh, wantEdit }) {
  const meta = docBySlug(slug);
  if (editing && editing.slug !== slug) editing = null;
  if (fresh && !editing) fetchDoc(slug); // (re)load quietly; cached text shows meanwhile
  const doc = cache.get(slug);
  if (doc && wantEdit && !editing) editing = { slug, draft: doc.markdown };
  const isEditing = editing?.slug === slug;
  const title = meta?.title || slug;

  const back = h("a", { class: "back", href: "#/library" }, icon("back", 16), "Library");
  const head = h("header", { class: "page-head doc-head" },
    h("div", { class: "page-head-text" },
      back,
      h("h1", { class: "page-title", tabindex: "-1" }, meta ? editable({ value: meta.title, label: "Page title", placeholder: "Untitled page", onSave: (v) => (v ? saveMeta(slug, { title: v }) : (toast("A page needs a title."), app.render())) }) : title),
      meta && h("p", { class: "page-sub" }, editable({ value: meta.group, label: "Group", placeholder: "Add a group…", onSave: (v) => saveMeta(slug, { group: v || "Other" }) }))),
    h("div", { class: "page-actions" },
      !isEditing && h("button", { type: "button", class: "btn btn-quiet", disabled: !doc, onclick: () => { editing = { slug, draft: doc.markdown }; app.render(); requestAnimationFrame(() => document.querySelector(".doc-editor")?.focus()); } }, icon("edit", 16), "Edit"),
      !isEditing && meta && h("button", { type: "button", class: "icon-btn", "aria-label": "Remove page from Library", title: "Remove from Library", onclick: () => { removeWithUndo("docs", meta, `“${meta.title}” removed from the Library`); location.hash = "#/library"; } }, icon("trash", 18))));

  let bodyEl;
  if (!doc) bodyEl = h("div", { class: "loading" }, h("span", { class: "spinner" }), "Opening page…");
  else if (isEditing) bodyEl = editor(slug, doc);
  else if (doc.error) bodyEl = empty("This page couldn't be opened", "Check your connection and try again.", h("button", { type: "button", class: "btn btn-quiet", onclick: () => { cache.delete(slug); fetchDoc(slug); } }, "Try again"));
  else if (!doc.markdown.trim()) bodyEl = empty("This page is empty", "Write it in plain text. Use # for headings and - for lists.", h("button", { type: "button", class: "btn btn-primary", onclick: () => { editing = { slug, draft: `# ${title}\n\n` }; app.render(); } }, "Start writing"));
  else bodyEl = h("article", { class: "prose" }, toHtml(doc.markdown, title));

  return h("div", { class: "page doc-page" }, head, bodyEl);
}

function editor(slug, doc) {
  const ta = h("textarea", { class: "doc-editor", "aria-label": "Page text (Markdown)", spellcheck: "true" });
  ta.value = editing.draft;
  const fit = () => { ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight + 2, 360) + "px"; };
  ta.addEventListener("input", () => { if (editing) editing.draft = ta.value; fit(); });
  requestAnimationFrame(fit);
  const saveBtn = h("button", { type: "button", class: "btn btn-primary" }, "Save");
  const save = async () => {
    if (saveBtn.disabled) return; // a second Ctrl+S while saving would send a stale sha
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const { sha } = await saveDoc(slug, ta.value, doc.sha);
      cache.set(slug, { markdown: ta.value, sha });
      editing = null;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      ta.blur(); // main.js holds re-renders while a textarea has focus
      toast(state.canWrite ? "Page saved" : "Page saved on this device");
      app.render();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      if (err.status === 409) toast("Someone else changed this page while you were editing. Copy your text, then reload to see theirs.");
      else if (err.code === "passcode") toast("Not saved. The team passcode is needed to save.");
      else toast("Couldn't save the page. Your text is still here, try again.");
    }
  };
  saveBtn.addEventListener("click", save);
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  const cancel = () => {
    if (ta.value !== doc.markdown && !confirm("Discard your changes to this page?")) return;
    editing = null;
    ta.blur();
    app.render();
  };
  return h("div", { class: "doc-edit" },
    h("p", { class: "section-note" }, "Plain text with a little formatting: # Heading, **bold**, - list, [link](url). Press Ctrl+S or ⌘S to save."),
    ta,
    h("div", { class: "doc-edit-actions" }, h("button", { type: "button", class: "btn btn-quiet", onclick: cancel }, "Cancel"), saveBtn));
}
