"use client";

// Client island: reads the selected run from the page address, then does
// the run detail fetch — the one useEffect below both fetches api/run/<id>
// (a relative path) whenever the selected run changes AND is the shell's
// Refresh button's target ("cw:refresh" re-runs the same fetch for the
// currently open run). No fetch runs before a run is selected.
import { useEffect, useRef, useState } from "react";
import { apiUrl, getJson, type WorkbenchPanel, type WorkbenchRunView } from "./api";
import { C, badgeClass, STAMP } from "./classes";
import { actionFacts } from "./inspection";
import { FirstRun } from "./first-run";
import { DEFAULT_TAB, parseFragment, writeRoute, type TabKey } from "./navigation";
import { NeedsYou } from "./needs-you";
import { PANEL_GROUPS, Tabs } from "./tabs";
import { RawJson } from "./raw-json";

function formatClock(date: Date | null): string {
  return date ? date.toTimeString().slice(0, 8) : "";
}

function Stamp({ lifecycle }: { lifecycle?: string }) {
  if (!lifecycle) return null;
  const [word, tone] = STAMP[lifecycle] || [lifecycle, "border-base-content/40 text-base-content/60"];
  return (
    <div
      className={`flex h-28 w-28 flex-none -rotate-[8deg] flex-col items-center justify-center gap-0.5 rounded-full border-[3px] font-mono uppercase [box-shadow:inset_0_0_0_5px_var(--color-base-100),inset_0_0_0_6px_currentColor] ${tone}`}
      role="img"
      aria-label={`verdict ${word}`}
    >
      <span className="text-[8px] tracking-[.2em]">verifier-gated</span>
      <span className="text-[22px] font-extrabold leading-none tracking-[.06em]">{word}</span>
      <span className="text-[8px] tracking-[.2em]">.cw/runs</span>
    </div>
  );
}

// Purely presentational shape-detection, ported from app.js: recognizes
// the two payload shapes that recur across several capabilities (a
// nodes/edges graph, and one or more TrustAuditEvent[] arrays) and tables
// them instead of dumping raw JSON. Anything else falls back to RawJson —
// no per-capability special-casing.
function isNodeEdgeGraph(data: unknown): data is { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  return !!data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).nodes) && Array.isArray((data as Record<string, unknown>).edges);
}

function isEventArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).kind === "string" && typeof (item as Record<string, unknown>).decision === "string")
  );
}

function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// A semantically-correct data table: header cells in a <thead> with
// scope="col", body rows in a <tbody>.
function StructTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-zebra table-xs font-mono">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((text, j) => (
                <td key={j} className="align-top">
                  {text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={C.block}>
      <div className={C.title}>{title}</div>
      {children}
    </div>
  );
}

function GraphView({ data }: { data: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } }) {
  return (
    <div>
      <StructBlock title={`nodes (${data.nodes.length})`}>
        {data.nodes.length === 0 ? (
          <div className="text-[12px] text-base-content/60">none</div>
        ) : (
          <StructTable
            headers={["id", "kind", "status", "label"]}
            rows={data.nodes.map((n) => [String(n.id ?? ""), String(n.kind ?? ""), String(n.status ?? ""), String(n.label ?? "")])}
          />
        )}
      </StructBlock>
      <StructBlock title={`edges (${data.edges.length})`}>
        {data.edges.length === 0 ? (
          <div className="text-[12px] text-base-content/60">none</div>
        ) : (
          <ul className="list-none p-0 font-mono text-[12px]">
            {data.edges.map((edge, i) => (
              <li key={i} className="py-[3px]">
                {String(edge.from ?? "")}
                <span className="px-1.5 text-base-content/60">{edge.label ? `--${edge.label}-->` : "-->"}</span>
                {String(edge.to ?? "")}
              </li>
            ))}
          </ul>
        )}
      </StructBlock>
    </div>
  );
}

function EventGroups({ data, confirmedEventKeys }: { data: Record<string, unknown>; confirmedEventKeys: string[] }) {
  // At least one sibling array is confirmed TrustAuditEvent-shaped, so an
  // OTHER array field that happens to be empty (e.g. a healthy
  // `policyViolations: []`) reads better as its own "(0)" table than
  // buried in "other fields" below.
  const eventKeys = Object.keys(data).filter((key) => confirmedEventKeys.includes(key) || (Array.isArray(data[key]) && (data[key] as unknown[]).length === 0));
  const rest = Object.keys(data).filter((key) => !eventKeys.includes(key) && key !== "schemaVersion" && key !== "runId");
  const restData: Record<string, unknown> = {};
  for (const key of rest) restData[key] = data[key];
  return (
    <div>
      {eventKeys.map((key) => {
        const events = [...(data[key] as Record<string, unknown>[])].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        return (
          <StructBlock key={key} title={`${humanizeKey(key)} (${events.length})`}>
            <StructTable
              headers={["time", "kind", "decision", "source", "actor"]}
              rows={events.map((event) => [
                String(event.createdAt || ""),
                String(event.kind || ""),
                String(event.decision || ""),
                String(event.source || ""),
                String(event.actor || event.workerId || event.taskId || ""),
              ])}
            />
          </StructBlock>
        );
      })}
      {Object.keys(restData).length > 0 ? <RawJson data={restData} label="other fields" /> : null}
    </div>
  );
}

function renderStructured(data: unknown): React.ReactNode {
  if (isNodeEdgeGraph(data)) return <GraphView data={data} />;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const eventKeys = Object.keys(record).filter((key) => isEventArray(record[key]));
    if (eventKeys.length > 0) return <EventGroups data={record} confirmedEventKeys={eventKeys} />;
  }
  return null;
}

function ActionSummary({ data }: { data: unknown }) {
  const facts = actionFacts(data);
  if (facts.length === 0) return null;
  return (
    <section className="border-b border-base-300 bg-base-300 px-3.5 py-2.5" aria-label="What matters">
      <h3 className={C.title}>What matters</h3>
      {facts.map((fact) => (
        <div key={fact.key} className="mt-1.5 grid grid-cols-[minmax(100px,140px)_1fr] gap-2.5 first-of-type:mt-0">
          <div className="text-[12px] text-base-content/60">{fact.label}</div>
          <ul className={C.items}>
            {fact.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function PanelCard({ name, panel }: { name: string; panel: WorkbenchPanel }) {
  return (
    <div className="card card-border mb-3.5 overflow-hidden rounded-[10px] bg-base-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-3.5 py-2.5">
        <span className="text-[13px] font-semibold">
          {name} — {panel.capability}
        </span>
        <span className="me-auto flex gap-2">
          <code className={C.cmd}>{panel.cli}</code>
          <code className={C.cmd}>{panel.mcp}</code>
        </span>
        <span className={badgeClass(panel.status)}>{panel.status}</span>
      </div>
      {panel.status === "present" ? (
        <>
          <ActionSummary data={panel.data} />
          {renderStructured(panel.data) ?? <RawJson data={panel.data} />}
        </>
      ) : (
        <div className="px-3.5 py-2.5 text-[12px] text-warning">{`absent — ${panel.error || "source unreadable"}`}</div>
      )}
    </div>
  );
}

function ActivePanel({ view, activeTab }: { view: WorkbenchRunView; activeTab: TabKey }) {
  const group = PANEL_GROUPS.find((g) => g.key === activeTab) || PANEL_GROUPS[0];
  const panels = view.panels?.[group.key] || {};
  // Two panel names can map to the same capability (e.g. graph's
  // compact/criticalPath both come from summary.show) and so carry
  // byte-identical payloads; render such a pair once under a merged label
  // instead of showing the same JSON twice under two names.
  const rendered: { names: string[]; panel: WorkbenchPanel }[] = [];
  for (const name of group.panels) {
    const panel = panels[name];
    if (!panel) continue;
    const twin = rendered.find((entry) => JSON.stringify(entry.panel) === JSON.stringify(panel));
    if (twin) twin.names.push(name);
    else rendered.push({ names: [name], panel });
  }
  return (
    <section id={`workbench-panel-${group.key}`} role="tabpanel" aria-labelledby={`workbench-tab-${group.key}`}>
      {rendered.map((entry) => (
        <PanelCard key={entry.names.join("/")} name={entry.names.join(" / ")} panel={entry.panel} />
      ))}
    </section>
  );
}

export function RunPanel({ hasRuns }: { hasRuns: boolean }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>(DEFAULT_TAB);
  const [view, setView] = useState<WorkbenchRunView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const detailSeq = useRef(0);
  const pendingFocus = useRef(false);

  // Reads the run/tab from the page address on mount, and again on every
  // popstate — real Back/Forward, and the synthetic event navigation.ts's
  // writeRoute() dispatches for a same-tab route change made by the run
  // list or the tab strip.
  useEffect(() => {
    function applyRoute() {
      const route = parseFragment(location.hash);
      setRunId(route.runId);
      setActiveTab(route.tab);
      // An unknown tab in the URL falls back to the default above; also
      // normalize the address bar so a reload or a copied link does not
      // keep repeating the same unknown tab name.
      if (route.replace) writeRoute(route.runId, route.tab, "replace");
    }
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, []);

  // The one effect that fetches the run detail: it re-runs whenever the
  // selected run changes, and it is also the shell Refresh button's
  // target ("cw:refresh"). detailSeq guards against a stale response
  // (from an older run, or an older refresh) overwriting a newer one —
  // only the newest in-flight request for the current run may render.
  useEffect(() => {
    if (!runId) {
      setView(null);
      setLoadError(null);
      return;
    }
    async function load() {
      const seq = ++detailSeq.current;
      try {
        const result = await getJson<WorkbenchRunView>(apiUrl(`api/run/${encodeURIComponent(runId!)}`));
        if (seq !== detailSeq.current) return;
        setView(result);
        setLoadError(null);
        setFetchedAt(new Date());
      } catch (error) {
        if (seq !== detailSeq.current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setView(null);
      }
    }
    load();
    window.addEventListener("cw:refresh", load);
    return () => window.removeEventListener("cw:refresh", load);
  }, [runId]);

  useEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(`workbench-tab-${activeTab}`)?.focus();
      pendingFocus.current = false;
    }
  }, [activeTab]);

  function selectTab(tab: TabKey, options: { focus?: boolean } = {}) {
    pendingFocus.current = options.focus === true;
    setActiveTab(tab);
    if (runId) writeRoute(runId, tab);
  }

  return (
    <section id="run-panel" className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
      {!runId ? (
        hasRuns ? (
          <p className="text-base-content/60">Select a run to inspect its graph, blackboard, worker logs, candidate compare, and audit timeline.</p>
        ) : (
          <FirstRun />
        )
      ) : loadError ? (
        <p className="text-error" role="alert">{`failed to load run: ${loadError}`}</p>
      ) : !view ? (
        <p className="text-base-content/60" role="status">{`loading ${runId}…`}</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-6">
            <div className="flex flex-col gap-1.5">
              <span className={C.label}>run</span>
              <span className="font-mono text-[20px] font-semibold">{view.runId}</span>
              <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-base-content/60">
                {view.lifecycle ? <span className={badgeClass(view.lifecycle)}>{view.lifecycle}</span> : null}
                <span>
                  resolved <span className={badgeClass(view.resolved ? "valid" : "missing")}>{view.resolved ? "valid" : "missing"}</span>
                </span>
                {fetchedAt ? <span>{`as of ${formatClock(fetchedAt)}`}</span> : null}
                {view.error ? <span className="text-error">{view.error}</span> : null}
              </div>
            </div>
            <Stamp lifecycle={view.lifecycle} />
          </div>
          {view.lifecycle === "blocked" || view.lifecycle === "failed" ? (
            <p className="alert alert-warning text-[13px]">{`${view.lifecycle} — run 'cw run status ${view.runId}' or 'cw doctor' for next steps`}</p>
          ) : null}
          <NeedsYou view={view} />
          <Tabs activeTab={activeTab} onSelect={selectTab} />
          <ActivePanel view={view} activeTab={activeTab} />
        </>
      )}
    </section>
  );
}
