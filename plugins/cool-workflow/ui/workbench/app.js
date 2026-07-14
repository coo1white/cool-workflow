"use strict";
// Cool Workflow Workbench UI — vanilla JS, no dependencies.
//
// The UI holds NO state of its own and contains NO business logic: it fetches
// the read-only JSON views from the localhost host and renders them. Every panel
// is exactly one capability payload; refresh re-derives everything from disk.

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

// `indexSeq` is a request sequence number: the debounced filter input can
// start a second /api/index fetch while an older one is still in flight, and
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
// other query params (e.g. the index filter's ?text=).
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

function freshnessBadge(value, title) {
  const v = String(value || "").toLowerCase();
  const attrs = { class: `badge ${v || "absent"}`, text: value || "unknown" };
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
  list.appendChild(el("li", { class: "muted", text: "loading runs…", role: "status" }));
  let view;
  try {
    view = await getJson(apiUrl("/api/index", { text: filter }));
  } catch (error) {
    if (seq !== state.indexSeq) return;
    list.innerHTML = "";
    list.appendChild(el("li", { class: "err", text: `failed to load index: ${error.message}`, role: "alert" }));
    // Clear the stale "registry valid · scope …" line — leaving the last
    // successful freshness next to a load error is itself a stale badge on
    // the one panel whose whole point is freshness.
    const fresh = document.getElementById("registry-freshness");
    fresh.innerHTML = "";
    fresh.append("registry ", freshnessBadge("unavailable"), " · index unreachable");
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
    ? "no home registry data yet — runs made in this repo still show; `cw registry refresh` builds it"
    : undefined;
  fresh.append("registry ", freshnessBadge(regStatus, regTitle), ` · scope ${view.scope}`);
  const runs = view.runs || {};
  const records = runs.records || [];
  if (!records.length) {
    list.appendChild(el("li", { class: "muted" }, [
      el("div", { text: "no runs indexed in this scope" }),
      el("div", { class: "hint", text: 'create one with: cw quickstart <app> --repo <path> --question "..."' })
    ]));
    return;
  }
  // Tell the user when the page is only part of the run set (the server
  // returns the newest page but caps it) — otherwise a scope with more runs
  // than the page size silently hides the rest, and someone checking "did my
  // run get created" is misled into thinking it doesn't exist.
  if (typeof runs.total === "number" && runs.total > records.length) {
    list.appendChild(el("li", { class: "muted hint", text: `showing latest ${records.length} of ${runs.total} runs` }));
  }
  // The server returns the page sorted oldest-first; show newest at the top.
  for (const record of [...records].reverse()) {
    const lifecycle = record.lifecycle || record.status || "";
    // A real <button>, not a bare <li> with a click listener: Tab reaches
    // it, Enter/Space activate it, and it gets a focus ring for free — no
    // extra ARIA needed. Same CSS classes as before so the row/card look
    // is unchanged (see app.css .run-list button rules).
    const btn = el("button", { type: "button", "data-runid": record.runId, class: state.activeRunId === record.runId ? "active" : "" }, [
      el("div", { class: "rid" }, [
        el("span", { class: `status-dot ${lifecycle}`, title: lifecycle || "unknown" }),
        document.createTextNode(record.runId)
      ]),
      el("div", {
        class: "meta",
        text: [record.appId || record.workflowId, lifecycle, record.repo].filter(Boolean).join(" · ")
      })
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
  detail.appendChild(el("p", { class: "muted", text: `loading ${runId}…`, role: "status" }));
  let view;
  try {
    view = await getJson(apiUrl(`/api/run/${encodeURIComponent(runId)}`));
  } catch (error) {
    if (state.activeRunId !== runId || seq !== state.detailSeq) return;
    detail.innerHTML = "";
    detail.appendChild(el("p", { class: "err", text: `failed to load run: ${error.message}`, role: "alert" }));
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

function selectTab(tab, options = {}) {
  state.activeTab = NAV.TAB_KEYS.includes(tab) ? tab : NAV.DEFAULT_TAB;
  if (options.history !== false && state.activeRunId) writeRoute(state.activeRunId, state.activeTab);
  if (state.currentView) renderRun(state.currentView, { focusTab: options.focus === true });
}

function renderRun(view, options = {}) {
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  const header = el("div", { class: "kv" }, [
    el("span", {}, [el("b", { text: "run " }), document.createTextNode(view.runId)]),
    el("span", {}, [document.createTextNode("resolved "), freshnessBadge(view.resolved ? "valid" : "missing")])
  ]);
  if (view.lifecycle) {
    header.appendChild(el("span", {}, [document.createTextNode("lifecycle "), freshnessBadge(view.lifecycle)]));
  }
  if (state.viewFetchedAt) {
    header.appendChild(el("span", { class: "muted", text: `as of ${formatClock(state.viewFetchedAt)}` }));
  }
  if (view.error) header.appendChild(el("span", { class: "err", text: view.error }));
  detail.appendChild(header);
  if (view.lifecycle === "blocked" || view.lifecycle === "failed") {
    detail.appendChild(
      el("p", { class: "recovery-hint", text: `${view.lifecycle} — run 'cw run status ${view.runId}' or 'cw doctor' for next steps` })
    );
  }

  const tabs = el("div", { class: "tabs", role: "tablist" });
  for (const group of PANEL_GROUPS) {
    const active = state.activeTab === group.key;
    const btn = el("button", {
      id: `workbench-tab-${group.key}`,
      class: `tab ${active ? "active" : ""}`,
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
  const card = el("div", { class: "panel-card" });
  const head = el("div", { class: "head" }, [
    el("span", { class: "title", text: `${name} — ${panel.capability}` }),
    el("span", { class: `badge ${panel.status}`, text: panel.status })
  ]);
  card.appendChild(head);
  card.appendChild(el("div", { class: "kv" }, [el("span", { class: "src", text: panel.cli }), el("span", { class: "src", text: panel.mcp })]));
  if (panel.status === "present") {
    card.appendChild(renderStructured(panel.data) || el("pre", { class: "json", text: JSON.stringify(panel.data, null, 2) }));
  } else {
    card.appendChild(el("div", { class: "absent-note", text: `absent — ${panel.error || "source unreadable"}` }));
  }
  return card;
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
  const table = el("table", { class: "struct-table" }, [
    el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { scope: "col", text: h })))])
  ]);
  const tbody = el("tbody");
  table.appendChild(tbody);
  return { table, tbody };
}

function renderGraph(data) {
  const wrap = el("div");
  const nodesBlock = el("div", { class: "struct-block" }, [el("div", { class: "struct-title", text: `nodes (${data.nodes.length})` })]);
  if (data.nodes.length === 0) {
    nodesBlock.appendChild(el("div", { class: "struct-empty", text: "none" }));
  } else {
    const { table, tbody } = structTable(["id", "kind", "status", "label"]);
    for (const node of data.nodes) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", { text: node.id }),
          el("td", { text: node.kind }),
          el("td", { text: node.status }),
          el("td", { text: node.label })
        ])
      );
    }
    nodesBlock.appendChild(table);
  }
  wrap.appendChild(nodesBlock);

  const edgesBlock = el("div", { class: "struct-block" }, [el("div", { class: "struct-title", text: `edges (${data.edges.length})` })]);
  if (data.edges.length === 0) {
    edgesBlock.appendChild(el("div", { class: "struct-empty", text: "none" }));
  } else {
    const list = el("ul", { class: "struct-edges" });
    for (const edge of data.edges) {
      list.appendChild(
        el("li", {}, [
          document.createTextNode(edge.from),
          el("span", { class: "arrow", text: edge.label ? `--${edge.label}-->` : "-->" }),
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
    const block = el("div", { class: "struct-block" }, [el("div", { class: "struct-title", text: `${humanizeKey(key)} (${events.length})` })]);
    const { table, tbody } = structTable(["time", "kind", "decision", "source", "actor"]);
    for (const event of events) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", { text: event.createdAt || "" }),
          el("td", { text: event.kind || "" }),
          el("td", { text: event.decision || "" }),
          el("td", { text: event.source || "" }),
          el("td", { text: event.actor || event.workerId || event.taskId || "" })
        ])
      );
    }
    block.appendChild(table);
    wrap.appendChild(block);
  }
  const rest = Object.keys(data).filter((key) => !eventKeys.includes(key) && key !== "schemaVersion" && key !== "runId");
  const restData = {};
  for (const key of rest) restData[key] = data[key];
  if (Object.keys(restData).length > 0) {
    const block = el("div", { class: "struct-block" }, [el("div", { class: "struct-title", text: "other fields" })]);
    block.appendChild(el("pre", { class: "json", text: JSON.stringify(restData, null, 2) }));
    wrap.appendChild(block);
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
      class: "empty",
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
