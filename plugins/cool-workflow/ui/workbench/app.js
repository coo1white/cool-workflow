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

const state = { activeRunId: null, activeTab: "graph" };

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response (${res.status})`);
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

function freshnessBadge(value) {
  const v = String(value || "").toLowerCase();
  return el("span", { class: `badge ${v || "absent"}`, text: value || "unknown" });
}

async function loadIndex() {
  const filter = document.getElementById("filter").value.trim();
  const list = document.getElementById("run-list");
  list.innerHTML = "";
  let view;
  try {
    view = await getJson(`/api/index${filter ? `?text=${encodeURIComponent(filter)}` : ""}`);
  } catch (error) {
    list.appendChild(el("li", { class: "err", text: `failed to load index: ${error.message}` }));
    return;
  }
  const reg = view.registry || {};
  const fresh = document.getElementById("registry-freshness");
  fresh.innerHTML = "";
  fresh.append("registry ", freshnessBadge(reg.freshness && reg.freshness.status), ` · scope ${view.scope}`);
  const records = (view.runs && view.runs.records) || [];
  if (!records.length) {
    list.appendChild(el("li", { class: "muted", text: "no runs indexed in this scope" }));
    return;
  }
  for (const record of records) {
    const lifecycle = record.lifecycle || record.status || "";
    // A real <button>, not a bare <li> with a click listener: Tab reaches
    // it, Enter/Space activate it, and it gets a focus ring for free — no
    // extra ARIA needed. Same CSS classes as before so the row/card look
    // is unchanged (see app.css .run-list button rules).
    const btn = el("button", { type: "button", class: state.activeRunId === record.runId ? "active" : "" }, [
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
    list.appendChild(btn);
  }
}

async function selectRun(runId) {
  state.activeRunId = runId;
  loadIndex();
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  detail.appendChild(el("p", { class: "muted", text: `loading ${runId}…` }));
  let view;
  try {
    view = await getJson(`/api/run/${encodeURIComponent(runId)}`);
  } catch (error) {
    detail.innerHTML = "";
    detail.appendChild(el("p", { class: "err", text: `failed to load run: ${error.message}` }));
    return;
  }
  renderRun(view);
}

function renderRun(view) {
  const detail = document.getElementById("run-panel");
  detail.innerHTML = "";
  const header = el("div", { class: "kv" }, [
    el("span", {}, [el("b", { text: "run " }), document.createTextNode(view.runId)]),
    el("span", {}, [document.createTextNode("resolved "), freshnessBadge(view.resolved ? "valid" : "missing")])
  ]);
  if (view.error) header.appendChild(el("span", { class: "err", text: view.error }));
  detail.appendChild(header);

  const tabs = el("div", { class: "tabs" });
  for (const group of PANEL_GROUPS) {
    const btn = el("button", { class: `tab ${state.activeTab === group.key ? "active" : ""}`, text: group.label });
    btn.addEventListener("click", () => {
      state.activeTab = group.key;
      renderRun(view);
    });
    tabs.appendChild(btn);
  }
  detail.appendChild(tabs);

  const group = PANEL_GROUPS.find((g) => g.key === state.activeTab) || PANEL_GROUPS[0];
  const panels = (view.panels && view.panels[group.key]) || {};
  for (const name of group.panels) {
    const panel = panels[name];
    if (panel) detail.appendChild(renderPanel(name, panel));
  }
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

function renderGraph(data) {
  const wrap = el("div");
  const nodesBlock = el("div", { class: "struct-block" }, [el("div", { class: "struct-title", text: `nodes (${data.nodes.length})` })]);
  if (data.nodes.length === 0) {
    nodesBlock.appendChild(el("div", { class: "struct-empty", text: "none" }));
  } else {
    const table = el("table", { class: "struct-table" }, [
      el("tr", {}, ["id", "kind", "status", "label"].map((h) => el("th", { text: h })))
    ]);
    for (const node of data.nodes) {
      table.appendChild(
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
    const table = el("table", { class: "struct-table" }, [
      el("tr", {}, ["time", "kind", "decision", "source", "actor"].map((h) => el("th", { text: h })))
    ]);
    for (const event of events) {
      table.appendChild(
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

document.getElementById("refresh").addEventListener("click", loadIndex);
document.getElementById("filter").addEventListener("input", debounce(loadIndex, 200));

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

loadIndex();
