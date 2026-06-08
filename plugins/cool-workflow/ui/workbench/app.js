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
  fresh.append("registry ", freshnessBadge(reg.freshness), ` · scope ${view.scope}`);
  const records = (view.runs && view.runs.records) || [];
  if (!records.length) {
    list.appendChild(el("li", { class: "muted", text: "no runs indexed in this scope" }));
    return;
  }
  for (const record of records) {
    const li = el("li", { class: state.activeRunId === record.runId ? "active" : "" }, [
      el("div", { class: "rid", text: record.runId }),
      el("div", {
        class: "meta",
        text: [record.appId || record.workflowId, record.lifecycle || record.status, record.repo]
          .filter(Boolean)
          .join(" · ")
      })
    ]);
    li.addEventListener("click", () => selectRun(record.runId));
    list.appendChild(li);
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
    card.appendChild(el("pre", { class: "json", text: JSON.stringify(panel.data, null, 2) }));
  } else {
    card.appendChild(el("div", { class: "absent-note", text: `absent — ${panel.error || "source unreadable"}` }));
  }
  return card;
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
