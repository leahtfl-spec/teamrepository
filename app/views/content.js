import { newId, report, weekStart, addDays, CONTENT_STATUSES } from "../ops.js";
import { state } from "../store.js";
import { h, icon, avatar, act, editable, removeWithUndo, toast, openSheet, closeSheet, pageHead, quickAdd, empty, person, ownerSelect, today, fmtDay, fmtWeekday, plural, status, CONTENT_LABEL } from "../ui.js";

const next = (s) => CONTENT_STATUSES[(CONTENT_STATUSES.indexOf(s) + 1) % CONTENT_STATUSES.length];
const save = (id, item) => act([{ op: "upsert", coll: "content", item: { id, ...item } }]);
const byId = (id) => (state.hub.content || []).find((c) => c.id === id);
let earlierOpen = false;

function addPost(title, date, { open = false } = {}) {
  const id = newId("c");
  if (!save(id, { title, date, owner: state.me || "", status: "idea" })) return;
  if (open) openPost(id);
  else toast(`Added for ${fmtDay(date)}`, { action: "Open", onAction: () => openPost(id) });
}

function statusPill(c) {
  return h("button", { type: "button", class: "pill-btn", title: "Click to move to the next stage", "aria-label": `Status: ${CONTENT_LABEL[c.status] || c.status}. Change to ${CONTENT_LABEL[next(c.status)]}`,
    onclick: (e) => { e.stopPropagation(); save(c.id, { status: next(c.status) }); } }, status(c.status, CONTENT_LABEL[c.status] || c.status));
}

function postRow(c) {
  const p = person(c.owner);
  return h("div", { class: "row post" },
    h("button", { type: "button", class: "row-main post-main", onclick: () => openPost(c.id), "aria-label": `Open post: ${c.title || "Untitled"}` },
      h("span", { class: "post-date" }, h("span", { class: "post-dow" }, c.date ? fmtWeekday(c.date) : "—"), h("span", { class: "post-day" }, c.date ? c.date.slice(8).replace(/^0/, "") : "")),
      h("span", { class: "post-text" },
        h("span", { class: "row-title" }, c.title || "Untitled post"),
        h("span", { class: "row-meta" }, [c.channel, c.format, c.pillar].filter(Boolean).join(" · ") || "Add channel and format"))),
    h("span", { class: "row-owner", title: p?.name || "No owner" }, avatar(c.owner, "sm")),
    statusPill(c));
}

export function render() {
  const t0 = today();
  const items = [...(state.hub.content || [])].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || String(a.title).localeCompare(String(b.title)));
  const gaps = report(state.hub, t0).contentGapsNext14;
  const thisWeek = weekStart(t0);

  const weeks = new Map([[thisWeek, []], [addDays(thisWeek, 7), []]]);
  const undated = [];
  for (const c of items) {
    if (!c.date) { undated.push(c); continue; }
    const w = weekStart(c.date);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(c);
  }
  const ordered = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
  const past = ordered.filter(([w]) => w < thisWeek);
  const upcoming = ordered.filter(([w]) => w >= thisWeek);

  const weekLabel = (w) => (w === thisWeek ? "This week" : w === addDays(thisWeek, 7) ? "Next week" : w < thisWeek ? `Week of ${fmtDay(w)}` : `Week of ${fmtDay(w)}`);
  const weekBlock = ([w, list]) => {
    const open = gaps.filter((d) => d >= w && d <= addDays(w, 6));
    return h("section", { class: "group" },
      h("div", { class: "group-head" }, h("h2", { class: "group-title" }, weekLabel(w)), h("span", { class: "group-range" }, `${fmtDay(w)} – ${fmtDay(addDays(w, 6))}`)),
      list.length ? h("div", { class: "card list" }, list.map(postRow)) : null,
      // An empty week gets one quiet line; a partly planned week lists its open days.
      !list.length && open.length ? h("p", { class: "week-empty" }, "Nothing planned yet.",
        h("button", { type: "button", class: "link-btn", onclick: () => addPost("New post", open[0], { open: true }) }, icon("plus", 15), "Plan a post")) : null,
      list.length && open.length ? h("div", { class: "gaps" }, h("span", { class: "gaps-label" }, "Open days"),
        open.map((d) => h("button", { type: "button", class: "gap", onclick: () => addPost("New post", d), "aria-label": `Add a post on ${fmtDay(d)}` }, icon("plus", 14), `${fmtWeekday(d)} ${d.slice(8).replace(/^0/, "")}`))) : null);
  };

  const date = h("input", { type: "date", class: "input input-date qa-date", value: gaps[0] || t0, "aria-label": "Post date" });
  return h("div", { class: "page" },
    pageHead("Content", `${plural(items.filter((c) => c.status !== "posted" && c.date >= t0).length, "post")} coming up · ${plural(gaps.length, "open day")} in the next two weeks`),
    quickAdd({ placeholder: "Add a post: hook or topic…", label: "Add a post", key: "qa-content", extra: date, onAdd: (title) => addPost(title, date.value || t0) }),
    h("div", { class: "groups" },
      upcoming.map(weekBlock),
      undated.length ? h("section", { class: "group" }, h("div", { class: "group-head" }, h("h2", { class: "group-title" }, "No date yet")), h("div", { class: "card list" }, undated.map(postRow))) : null,
      past.length ? h("details", { class: "earlier", open: earlierOpen, ontoggle: (e) => { earlierOpen = e.currentTarget.open; } }, h("summary", {}, `Earlier · ${plural(past.reduce((n, [, l]) => n + l.length, 0), "post")}`), [...past].reverse().map(weekBlock)) : null),
    !items.length ? empty("No posts planned yet", "Add a hook or topic above and give it a date.") : null,
  );
}

const field = (label, control) => h("div", { class: "prop" }, h("span", { class: "prop-label" }, label), h("div", { class: "prop-value" }, control));

export function openPost(id) {
  openSheet({
    label: "Post",
    render(body) {
      const c = byId(id);
      if (!c) return false;
      const text = (key, label, placeholder) => editable({ value: c[key], label, placeholder, onSave: (v) => save(id, { [key]: v }) });
      body.replaceChildren(
        h("div", { class: "sheet-top" },
          h("span", { class: "eyebrow" }, "Post"),
          h("div", { class: "sheet-tools" },
            h("button", { type: "button", class: "icon-btn", "aria-label": "Delete post", title: "Delete post", onclick: () => { closeSheet(); removeWithUndo("content", c, "Post deleted"); } }, icon("trash", 18)),
            h("button", { type: "button", class: "icon-btn", "aria-label": "Close", title: "Close (Esc)", onclick: () => closeSheet() }, icon("x", 18)))),
        h("div", { class: "sheet-title" }, editable({ value: c.title, label: "Hook or topic", placeholder: "Hook or topic…", multiline: true, onSave: (v) => save(id, { title: v }) })),
        h("div", { class: "props" },
          field("Stage", h("select", { class: "select", "aria-label": "Stage", onchange: (e) => save(id, { status: e.target.value }) },
            CONTENT_STATUSES.map((s) => h("option", { value: s, selected: s === c.status }, CONTENT_LABEL[s])))),
          field("Date", h("input", { type: "date", class: "input input-date", value: c.date || "", "aria-label": "Date", onchange: (e) => save(id, { date: e.target.value }) })),
          field("Owner", h("div", { class: "with-avatar" }, avatar(c.owner, "sm"), ownerSelect(c.owner, (v) => save(id, { owner: v })))),
          field("Channel", text("channel", "Channel", "Instagram, TikTok…")),
          field("Format", text("format", "Format", "Reel, carousel…")),
          field("Pillar", text("pillar", "Pillar", "Education, story…")),
          field("Link", text("link", "Link", "Paste the link once it's live…"))),
        c.link && /^https?:\/\//.test(c.link) ? h("a", { class: "btn btn-quiet btn-wide", href: c.link, target: "_blank", rel: "noopener" }, "Open link", icon("chevron", 16)) : null,
      );
    },
  });
}
