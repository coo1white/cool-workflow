"use strict";
// Cool Workflow Workbench UI — vanilla JS, no dependencies.
//
// The UI holds NO state of its own and contains NO business logic: it fetches
// the read-only JSON views from the localhost host and renders them. Every panel
// is exactly one capability payload; refresh re-derives everything from disk.
// The look is Tailwind + daisyUI classes only (app.css is built from them).

const PANEL_GROUPS = [
  { key: "graph", label: "Run graph", panels: ["operator", "multiAgent", "compact", "criticalPath"] },
  { key: "blackboard", label: "Blackboard", panels: ["coordinator", "digest", "graph"] },
  { key: "worker", label: "Worker logs", panels: ["summary"] },
  { key: "candidate", label: "Candidate compare", panels: ["summary", "reasoning"] },
  { key: "audit", label: "Audit timeline", panels: ["summary", "multiAgent", "policy", "judge"] },
  { key: "metrics", label: "Metrics & cost", panels: ["report"] },
  { key: "collaboration", label: "Review & collaboration", panels: ["review", "comments"] }
];

const NAV = globalThis.CWWorkbenchNavigation;
if (!NAV) throw new Error("Workbench navigation helper is not available");
const INSPECTION = globalThis.CWWorkbenchInspection;
if (!INSPECTION) throw new Error("Workbench inspection helper is not available");

// Class strings used more than once. One word each for colour: green = done
// and checked, orange = the tool is working, amber = needs a person, red = broke.
const C = {
  label: "font-mono text-[11px] uppercase tracking-[.08em] text-base-content/60",
  pill: "badge badge-outline badge-sm h-[22px] font-mono text-[11px] uppercase tracking-[.04em] text-base-content/60",
  cmd: "inline-block rounded-md border border-base-300 bg-base-300 px-2 font-mono text-[12px] leading-[1.6] text-base-content [overflow-wrap:anywhere]",
  card: "card card-compact card-bordered bg-base-200 text-[13px] [&>*]:gap-1.5",
  block: "border-t border-base-300 px-3.5 py-2.5 first:border-t-0",
  title: "mb-1.5 font-mono text-[11px] uppercase tracking-[.08em] text-base-content/60",
  items: "m-0 pl-[18px] font-mono text-[12px] leading-normal whitespace-pre-wrap [overflow-wrap:anywhere]"
};
const TONE = {
  present: "badge-success", valid: "badge-success", completed: "badge-success",
  running: "badge-primary",
  absent: "badge-warning", stale: "badge-warning", blocked: "badge-warning",
  missing: "badge-error", bad: "badge-error", failed: "badge-error"
};
const DOT = { running: "bg-primary", completed: "bg-success", blocked: "bg-warning", failed: "bg-error" };

// `indexSeq` is a request sequence number: the debounced filter input can
// start a second api/index fetch while an older one is still in flight, and
// only the NEWEST request may render (an old slow response must not
// overwrite a new fast one). `viewFetchedAt` is when the active run's view
// was fetched, shown as "as of HH:MM:SS" in the detail header.
const state = {
  activeRunId: null,
  activeTab: NAV.DEFAULT_TAB,
  currentView: null,
  detailSeq: 0,
  indexSeq: 0,
  viewFetchedAt: null
};

// The host's auth token, read ONCE at startup from the page URL. When
// CW_WORKBENCH_TOKEN is set on the host, every /api/* request must carry it;
// the static UI files themselves are served without it, so the page loads
// and can explain what to do instead of rendering broken.
const TOKEN = new URLSearchParams(location.search).get("token") || "";

function routeUrl(runId, tab) {
  return `${location.pathname}${location.search}${NAV.formatFragment(runId, tab)}`;
}

function writeRoute(runId, tab, mode = "push") {
  const fragment = NAV.formatFragment(runId, tab);
  if (location.hash === fragment && mode === "push") return;
  history[mode === "replace" ? "replaceState" : "pushState"](null, "", routeUrl(runId, tab));
}

// Build a request URL with URLSearchParams so the token composes with any
// other query params (e.g. the index filter's ?text=). Paths are relative,
// so the page works under any prefix (the host at /, a static site at /x/).
function apiUrl(pathname, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (TOKEN) search.set("token", TOKEN);
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response (${res.status}): ${text.slice(0, 120)}`);
  }
  if (res.status === 401) {
    throw new Error("unauthorized — reopen as /?token=<your CW_WORKBENCH_TOKEN value>");
  }
  if (!res.ok) throw new Error(body && body.error ? body.error : `HTTP ${res.status}`);
  return body;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function rawJson(data, label = "raw payload") {
  return el("details", { class: "collapse collapse-arrow rounded-none border-t border-base-300" }, [
    el("summary", { class: "collapse-title min-h-0 px-3.5 py-2.5 text-[12px] text-base-content/60", text: label }),
    el("div", { class: "collapse-content px-0" }, [el("pre", { class: "max-h-[460px] overflow-x-auto whitespace-pre bg-base-100 px-3.5 py-3 font-mono text-[12px] leading-normal", text: JSON.stringify(data, null, 2) })])
  ]);
}

// The stamp word comes from `view.lifecycle` alone; no key, no stamp.
const STAMP = { completed: ["PASS", "border-primary text-primary"], blocked: ["BLOCKED", "border-warning text-warning"], failed: ["FAILED", "border-error text-error"], running: ["RUNNING", "border-primary text-primary"] };
function stampFor(lifecycle) {
  if (!lifecycle) return null;
  const [word, tone] = STAMP[lifecycle] || [lifecycle, "border-base-content/40 text-base-content/60"];
  return el("div", {
    class: `flex h-28 w-28 flex-none -rotate-[8deg] flex-col items-center justify-center gap-0.5 rounded-full border-[3px] font-mono uppercase [box-shadow:inset_0_0_0_5px_oklch(var(--b1)),inset_0_0_0_6px_currentColor] ${tone}`,
    role: "img",
    "aria-label": `verdict ${word}`
  }, [
    el("span", { class: "text-[8px] tracking-[.2em]", text: "verifier-gated" }),
    el("span", { class: "text-[22px] font-extrabold leading-none tracking-[.06em]", text: word }),
    el("span", { class: "text-[8px] tracking-[.2em]", text: ".cw/runs" })
  ]);
}

function freshnessBadge(value, title) {
  const v = String(value || "").toLowerCase();
  const attrs = { class: `${C.pill} ${TONE[v] || ""}`, text: value || "unknown" };
  if (title) attrs.title = title;
  return el("span", attrs);
}

async function loadIndex() {
  const seq = ++state.indexSeq;
  const filter = document.getElementById("filter").value.trim();
  const list = document.getElementById("run-list");
  // A loading placeholder, not a bare wipe: the same pattern the detail
  // pane uses, so the sidebar never flashes empty while the fetch runs.
  list.innerHTML = "";
  list.appendChild(el("li", { class: "px-3 py-2 text-[12px] text-base-content/60", text: "loading runs…", role: "status" }));
  let view;
  try {
    view = await getJson(apiUrl("api/index", { text: filter }));
  } catch (error) {
    if (seq !== state.indexSeq) return;
    list.innerHTML = "";
    list.appendChild(el("li", { class: "px-3 py-2 text-[12px] text-error", text: `failed to load index: ${error.message}`, role: "alert" }));
    // Clear the stale registry pill; leaving the last successful freshness
    // next to a load error is itself a stale badge on the one panel whose
    // whole point is freshness.
    const fresh = document.getElementById("registry-freshness");
    fresh.innerHTML = "";
    fresh.append(freshnessBadge("unavailable", "registry unavailable · index unreachable"));
    return;
  }
  // Only the newest request may render (see state.indexSeq).
  if (seq !== state.indexSeq) return;
  list.innerHTML = "";
  const reg = view.registry || {};
  const fresh = document.getElementById("registry-freshness");
  fresh.innerHTML = "";
  const regStatus = reg.freshness && reg.freshness.status;
  const regTitle = String(regStatus || "").toLowerCase() === "absent"
    ? `no home registry data yet — runs made in this repo still show; \`cw registry refresh\` builds it · scope ${view.scope}`
    : `registry ${regStatus} · scope ${view.scope}`;
  fresh.append(freshnessBadge(regStatus, regTitle));
  const runs = view.runs || {};
  const records = runs.records || [];
  if (!records.length) {
    list.appendChild(el("li", { class: "px-3 py-2 text-[12px] text-base-content/60" }, [
      el("div", { text: "no runs indexed in this scope" }),
      el("code", { class: `${C.cmd} mt-1.5`, text: 'cw -q "<question>"' })
    ]));
    if (!state.activeRunId) renderFirstRun();
    return;
  }
  // Tell the user when the page is only part of the run set (the server
  // returns the newest page but caps it) — otherwise a scope with more runs
  // than the page size silently hides the rest, and someone checking "did my
  // run get created" is misled into thinking it doesn't exist.
  if (typeof runs.total === "number" && runs.total > records.length) {
    list.appendChild(el("li", { class: "px-3 py-2 text-[12px] text-base-content/60", text: `showing latest ${records.length} of ${runs.total} runs` }));
  }
  // The server returns the page sorted oldest-first; show newest at the top.
  for (const record of [...records].reverse()) {
    const lifecycle = record.lifecycle || record.status || "";
    // A real <button>, not a bare <li> with a click listener: Tab reaches
    // it, Enter/Space activate it, and it gets a focus ring for free — no
    // extra ARIA needed. The "active" class is what markActiveRow toggles;
    // daisyUI's menu draws it.
    const when = record.createdAt ? new Date(record.createdAt) : null;
    const btn = el("button", {
      type: "button",
      "data-runid": record.runId,
      title: `${record.runId}\n${record.repo || ""}`,
      class: `flex w-full flex-col items-stretch gap-[3px] rounded-lg px-3 py-2.5 text-left ${state.activeRunId === record.runId ? "active" : ""}`
    }, [
      el("div", { class: "flex items-center gap-2 font-mono text-[12px]" }, [
        el("span", { class: `inline-block h-2 w-2 flex-none rounded-full ${DOT[lifecycle] || "bg-base-content/40"}`, title: lifecycle || "unknown" }),
        document.createTextNode(`${record.appId || record.workflowId || record.runId}${when ? ` · ${formatClock(when).slice(0, 5)}` : ""}`)
      ]),
      el("div", { class: "flex justify-between pl-4 text-[11px] text-base-content/60" }, [el("span", { text: lifecycle || "unknown" }), el("span", { text: when ? when.toISOString().slice(0, 10) : "" })])
    ]);
    btn.addEventListener("click", () => selectRun(record.runId));
    list.appendChild(el("li", { class: "run-entry" }, [btn]));
  }
}

// Move the "active" highlight to the chosen run's button WITHOUT rebuilding
// the list. Rebuilding (the old `loadIndex()` call in selectRun) removed the
// very <button> the user had just clicked/Entered, dropping keyboard focus to
// <body> and flashing the whole sidebar on every selection.
function markActiveRow(runId) {
  const list = document.getElementById("run-list");
  for (const btn of list.querySelectorAll("button[data-runid]")) {
    const active = btn.getAttribute("data-runid") === runId;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "true");
    else btn.removeAttribute("aria-current");
  }
}

function selectRun(runId, options = {}) {
  state.activeRunId = runId;
  if (!state.currentView || state.currentView.runId !== runId) state.currentView = null;
  markActiveRow(runId);
  if (options.history !== false) writeRoute(runId, state.activeTab);
  return loadRunDetail(runId);
}

async function loadRunDetail(runId) {
  const seq = ++state.detailSeq;
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  detail.appendChild(el("p", { class: "text-base-content/60", text: `loading ${runId}…`, role: "status" }));
  let view;
  try {
    view = await getJson(apiUrl(`api/run/${encodeURIComponent(runId)}`));
  } catch (error) {
    if (state.activeRunId !== runId || seq !== state.detailSeq) return;
    detail.innerHTML = "";
    detail.appendChild(el("p", { class: "text-error", text: `failed to load run: ${error.message}`, role: "alert" }));
    return;
  }
  // The user may have clicked another run while this fetch was in flight;
  // a stale response must not overwrite the newer selection's render.
  if (state.activeRunId !== runId || seq !== state.detailSeq) return;
  state.viewFetchedAt = new Date();
  state.currentView = view;
  renderRun(view);
}

// The refresh button re-derives BOTH panes from disk: the sidebar index AND
// the currently-open run's detail. Refreshing only the index (the old
// behavior) left the detail header's lifecycle badge showing stale state
// while the sidebar dot next to it had already changed.
function refreshAll() {
  loadIndex();
  if (state.activeRunId) loadRunDetail(state.activeRunId);
}

function formatClock(date) {
  return date ? date.toTimeString().slice(0, 8) : "";
}

function renderFirstRun() {
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  detail.appendChild(el("div", { class: "mx-auto mt-[10vh] flex max-w-[620px] flex-col gap-3.5" }, [
    el("span", { class: `${C.label} text-primary`, text: "first run" }),
    el("h2", { class: "text-[26px] font-extrabold leading-[1.2] tracking-[-.01em]", text: "Ask one question. Get a saved, cited report." }),
    el("p", { class: "text-base-content/60", text: "Run this in a repo. The report opens by itself when the run ends, and it shows up here." }),
    el("code", { class: `${C.cmd} block border-primary px-4 py-3 text-[14px]`, text: 'cw -q "<question>"' }),
    el("ol", { class: "grid list-none grid-cols-4 gap-2.5 p-0" }, ["ask", "plan and dispatch", "verify", "report"].map((step, i) =>
      el("li", { class: "card card-bordered card-compact bg-base-200 px-3.5 py-3 text-[13px] font-semibold" }, [
        el("span", { class: `${C.label} mb-1 block`, text: String(i + 1) }),
        document.createTextNode(step)
      ])
    ))
  ]));
}

// The three facts a person needs first, from three panels of the one
// payload already fetched: no new request. Only graph's `nextAction`
// counts; the coordinator payload carries one too and it is dropped.
const NEEDS_YOU = [
  ["problems", "candidate", "summary", "problems", "border-error text-error"],
  ["missingEvidence", "blackboard", "coordinator", "missing evidence", ""],
  ["nextAction", "graph", "compact", "next action", "border-primary"]
];
function renderNeedsYou(view) {
  const strip = el("section", { class: "grid grid-cols-3 gap-3", "aria-label": "what needs you" });
  for (const [key, group, name, label, someTone] of NEEDS_YOU) {
    const panel = view.panels && view.panels[group] && view.panels[group][name];
    const fact = panel && panel.status === "present" ? INSPECTION.actionFacts(panel.data).find((f) => f.key === key) : null;
    const none = !fact || fact.items[0] === "none";
    const tone = key === "nextAction" ? someTone : none ? "" : someTone;
    const card = el("div", { class: `${C.card} ${tone}` });
    const cardBody = el("div", { class: "card-body" }, [el("span", { class: `${C.label} ${key === "nextAction" ? "text-primary" : ""}`, text: label })]);
    card.appendChild(cardBody);
    if (none) cardBody.appendChild(el("span", { class: "text-success", text: "none" }));
    else if (key === "nextAction") cardBody.appendChild(el("code", { class: C.cmd, text: fact.items[0] }));
    else cardBody.appendChild(el("ul", { class: C.items }, fact.items.map((item) => el("li", { text: item }))));
    strip.appendChild(card);
  }
  return strip;
}

function selectTab(tab, options = {}) {
  state.activeTab = NAV.TAB_KEYS.includes(tab) ? tab : NAV.DEFAULT_TAB;
  if (options.history !== false && state.activeRunId) writeRoute(state.activeRunId, state.activeTab);
  if (state.currentView) renderRun(state.currentView, { focusTab: options.focus === true });
}

function renderRun(view, options = {}) {
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  const facts = el("div", { class: "flex flex-wrap items-center gap-2.5 text-[12px] text-base-content/60" }, [
    view.lifecycle ? freshnessBadge(view.lifecycle) : null,
    el("span", {}, [document.createTextNode("resolved "), freshnessBadge(view.resolved ? "valid" : "missing")])
  ]);
  if (state.viewFetchedAt) facts.appendChild(el("span", { text: `as of ${formatClock(state.viewFetchedAt)}` }));
  if (view.error) facts.appendChild(el("span", { class: "text-error", text: view.error }));
  detail.appendChild(el("div", { class: "flex items-start justify-between gap-6" }, [
    el("div", { class: "flex flex-col gap-1.5" }, [el("span", { class: C.label, text: "run" }), el("span", { class: "font-mono text-[20px] font-semibold", text: view.runId }), facts]),
    stampFor(view.lifecycle)
  ]));
  if (view.lifecycle === "blocked" || view.lifecycle === "failed") {
    detail.appendChild(
      el("p", {
        class: "alert alert-warning text-[13px]",
        text: `${view.lifecycle} — run 'cw run status ${view.runId}' or 'cw doctor' for next steps`
      })
    );
  }
  detail.appendChild(renderNeedsYou(view));

  const tabs = el("div", { class: "tabs tabs-bordered", role: "tablist" });
  for (const group of PANEL_GROUPS) {
    const active = state.activeTab === group.key;
    const btn = el("button", {
      id: `workbench-tab-${group.key}`,
      class: `tab text-[13px] font-semibold ${active ? "tab-active" : ""}`,
      text: group.label,
      role: "tab",
      "aria-controls": `workbench-panel-${group.key}`,
      "aria-selected": active ? "true" : "false",
      tabindex: active ? "0" : "-1"
    });
    btn.addEventListener("click", (event) => {
      selectTab(group.key, { focus: event.detail === 0 });
    });
    btn.addEventListener("keydown", (event) => {
      const next = NAV.moveTab(state.activeTab, event.key);
      if (next === state.activeTab && !["Home", "End", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      selectTab(next, { focus: true });
    });
    tabs.appendChild(btn);
  }
  detail.appendChild(tabs);

  const group = PANEL_GROUPS.find((g) => g.key === state.activeTab) || PANEL_GROUPS[0];
  const panels = (view.panels && view.panels[group.key]) || {};
  const tabPanel = el("section", {
    id: `workbench-panel-${group.key}`,
    role: "tabpanel",
    "aria-labelledby": `workbench-tab-${group.key}`
  });
  // Some groups declare two panel names that map to the same capability on
  // the server (e.g. graph's compact/criticalPath both come from
  // summary.show), so they carry byte-identical payloads. Render such a pair
  // ONCE under a merged label instead of showing the same JSON twice under
  // two names that promise distinct views.
  const rendered = [];
  for (const name of group.panels) {
    const panel = panels[name];
    if (!panel) continue;
    const twin = rendered.find((entry) => JSON.stringify(entry.panel) === JSON.stringify(panel));
    if (twin) twin.names.push(name);
    else rendered.push({ names: [name], panel });
  }
  for (const entry of rendered) {
    tabPanel.appendChild(renderPanel(entry.names.join(" / "), entry.panel));
  }
  detail.appendChild(tabPanel);
  if (options.focusTab) document.getElementById(`workbench-tab-${group.key}`).focus();
}

function renderPanel(name, panel) {
  const card = el("div", { class: "card card-bordered mb-3.5 overflow-hidden rounded-[10px] bg-base-200" });
  const head = el("div", { class: "flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-3.5 py-2.5" }, [
    el("span", { class: "text-[13px] font-semibold", text: `${name} — ${panel.capability}` }),
    el("span", { class: "mr-auto flex gap-2" }, [el("code", { class: C.cmd, text: panel.cli }), el("code", { class: C.cmd, text: panel.mcp })]),
    el("span", { class: `${C.pill} ${TONE[panel.status] || ""}`, text: panel.status })
  ]);
  card.appendChild(head);
  if (panel.status === "present") {
    const actionSummary = renderActionSummary(panel.data);
    if (actionSummary) card.appendChild(actionSummary);
    card.appendChild(renderStructured(panel.data) || rawJson(panel.data));
  } else {
    card.appendChild(el("div", { class: "px-3.5 py-2.5 text-[12px] text-warning", text: `absent — ${panel.error || "source unreadable"}` }));
  }
  return card;
}

function renderActionSummary(data) {
  const facts = INSPECTION.actionFacts(data);
  if (facts.length === 0) return null;
  const summary = el("section", { class: "border-b border-base-300 bg-base-300 px-3.5 py-2.5", "aria-label": "What matters" }, [
    el("h3", { class: C.title, text: "What matters" })
  ]);
  for (const fact of facts) {
    summary.appendChild(
      el("div", { class: "mt-1.5 grid grid-cols-[minmax(100px,140px)_1fr] gap-2.5 first-of-type:mt-0" }, [
        el("div", { class: "text-[12px] text-base-content/60", text: fact.label }),
        el("ul", { class: C.items }, fact.items.map((item) => el("li", { text: item })))
      ])
    );
  }
  return summary;
}

// Purely presentational shape-detection: recognizes the two payload shapes
// that recur across several capabilities (a nodes/edges graph, and one or
// more TrustAuditEvent[] arrays) and tables them instead of dumping raw
// JSON. Anything that doesn't match either shape falls back to the plain
// JSON dump in renderPanel — no per-capability special-casing.
function isNodeEdgeGraph(data) {
  return !!data && Array.isArray(data.nodes) && Array.isArray(data.edges);
}

function isEventArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === "object" && typeof item.kind === "string" && typeof item.decision === "string")
  );
}

function renderStructured(data) {
  if (isNodeEdgeGraph(data)) return renderGraph(data);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const eventKeys = Object.keys(data).filter((key) => isEventArray(data[key]));
    if (eventKeys.length > 0) return renderEventGroups(data, eventKeys);
  }
  return null;
}

// A semantically-correct data table: header cells in a <thead> with
// scope="col", body rows in a <tbody> — screen readers can then associate
// each cell with its column header.
function structTable(headers) {
  const table = el("table", { class: "table table-zebra table-xs font-mono" }, [
    el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { scope: "col", text: h })))])
  ]);
  const tbody = el("tbody");
  table.appendChild(tbody);
  return { table, tbody };
}

function row(cells) {
  return el("tr", {}, cells.map((text) => el("td", { class: "align-top", text })));
}

function structBlock(title) {
  return el("div", { class: C.block }, [el("div", { class: C.title, text: title })]);
}

function renderGraph(data) {
  const wrap = el("div");
  const nodesBlock = structBlock(`nodes (${data.nodes.length})`);
  if (data.nodes.length === 0) {
    nodesBlock.appendChild(el("div", { class: "text-[12px] text-base-content/60", text: "none" }));
  } else {
    const { table, tbody } = structTable(["id", "kind", "status", "label"]);
    for (const node of data.nodes) tbody.appendChild(row([node.id, node.kind, node.status, node.label]));
    nodesBlock.appendChild(table);
  }
  wrap.appendChild(nodesBlock);

  const edgesBlock = structBlock(`edges (${data.edges.length})`);
  if (data.edges.length === 0) {
    edgesBlock.appendChild(el("div", { class: "text-[12px] text-base-content/60", text: "none" }));
  } else {
    const list = el("ul", { class: "list-none p-0 font-mono text-[12px]" });
    for (const edge of data.edges) {
      list.appendChild(
        el("li", { class: "py-[3px]" }, [
          document.createTextNode(edge.from),
          el("span", { class: "px-1.5 text-base-content/60", text: edge.label ? `--${edge.label}-->` : "-->" }),
          document.createTextNode(edge.to)
        ])
      );
    }
    edgesBlock.appendChild(list);
  }
  wrap.appendChild(edgesBlock);
  return wrap;
}

function humanizeKey(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function renderEventGroups(data, confirmedEventKeys) {
  // At least one sibling array on this object is confirmed TrustAuditEvent-
  // shaped -- so its OTHER array fields that happen to be empty (e.g. a
  // healthy `policyViolations: []`) are almost certainly the same family
  // and read better as their own "(0)" table than buried in the raw
  // "other fields" JSON below. An empty array can't self-identify by
  // content, so this only widens the match within an already-confirmed
  // object, never anywhere else.
  const eventKeys = Object.keys(data).filter(
    (key) => confirmedEventKeys.includes(key) || (Array.isArray(data[key]) && data[key].length === 0)
  );
  const wrap = el("div");
  for (const key of eventKeys) {
    const events = [...data[key]].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const block = structBlock(`${humanizeKey(key)} (${events.length})`);
    const { table, tbody } = structTable(["time", "kind", "decision", "source", "actor"]);
    for (const event of events) {
      tbody.appendChild(row([event.createdAt || "", event.kind || "", event.decision || "", event.source || "", event.actor || event.workerId || event.taskId || ""]));
    }
    block.appendChild(table);
    wrap.appendChild(block);
  }
  const rest = Object.keys(data).filter((key) => !eventKeys.includes(key) && key !== "schemaVersion" && key !== "runId");
  const restData = {};
  for (const key of rest) restData[key] = data[key];
  if (Object.keys(restData).length > 0) {
    wrap.appendChild(rawJson(restData, "other fields"));
  }
  return wrap;
}

function showIndexOnly() {
  ++state.detailSeq;
  state.currentView = null;
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  detail.appendChild(
    el("p", {
      class: "text-base-content/60",
      text: "Select a run to inspect its graph, blackboard, worker logs, candidate compare, and audit timeline."
    })
  );
}

function applyLocationRoute() {
  const route = NAV.parseFragment(location.hash);
  state.activeRunId = route.runId;
  state.activeTab = route.tab;
  if (route.replace) writeRoute(route.runId, route.tab, "replace");
  markActiveRow(route.runId);
  if (!route.runId) {
    showIndexOnly();
    return;
  }
  if (state.currentView && state.currentView.runId === route.runId) {
    renderRun(state.currentView);
    return;
  }
  state.currentView = null;
  loadRunDetail(route.runId);
}

document.getElementById("refresh").addEventListener("click", refreshAll);
document.getElementById("filter").addEventListener("input", debounce(loadIndex, 200));
window.addEventListener("popstate", applyLocationRoute);

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

loadIndex();
applyLocationRoute();
