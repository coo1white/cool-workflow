"use client";

// Client island: re-fetches api/index (relative path — works at "/" and
// under the "/ui" export prefix) on a debounced filter change and on the
// shell's Refresh button. The first paint uses the server-embedded
// `initialIndex` prop (src/load-index.ts); no fetch runs before then.
import { useEffect, useRef, useState } from "react";
import { apiUrl, getJson, type WorkbenchIndexView } from "./api";
import { C, DOT, badgeClass } from "./classes";
import { parseFragment, writeRoute } from "./navigation";

function formatClock(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

export function RunList({ initialIndex }: { initialIndex: WorkbenchIndexView }) {
  const [view, setView] = useState<WorkbenchIndexView>(initialIndex);
  const [filterText, setFilterText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const indexSeq = useRef(0);
  const skipFirstFetch = useRef(true);

  // Highlights the selected run's row; the run panel owns the route, this
  // just follows it (real Back/Forward, and the synthetic popstate
  // navigation.ts's writeRoute() dispatches for a same-tab change).
  useEffect(() => {
    function applyRoute() {
      setActiveRunId(parseFragment(location.hash).runId);
    }
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, []);

  // The one effect that re-fetches the index: a debounced filter change,
  // and the shell's Refresh button ("cw:refresh"). indexSeq guards against
  // a slow keystroke's response overwriting a faster, later one's — only
  // the newest request may render, same as app.js's loadIndex().
  useEffect(() => {
    async function load() {
      const seq = ++indexSeq.current;
      try {
        const result = await getJson<WorkbenchIndexView>(apiUrl("api/index", { text: filterText.trim() || undefined }));
        if (seq !== indexSeq.current) return;
        setView(result);
        setLoadError(null);
      } catch (error) {
        if (seq !== indexSeq.current) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }
    window.addEventListener("cw:refresh", load);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (skipFirstFetch.current) {
      // First paint already has the server-embedded index; no fetch here.
      skipFirstFetch.current = false;
    } else {
      timer = setTimeout(load, 200);
    }
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("cw:refresh", load);
    };
  }, [filterText]);

  function selectRun(runId: string) {
    setActiveRunId(runId);
    writeRoute(runId, parseFragment(location.hash).tab);
  }

  const regStatus = view.registry?.freshness?.status;
  const regTitle = loadError
    ? "registry unavailable · index unreachable"
    : String(regStatus || "").toLowerCase() === "absent"
      ? `no home registry data yet — runs made in this repo still show; \`cw registry refresh\` builds it · scope ${view.scope}`
      : `registry ${regStatus} · scope ${view.scope}`;
  const records = view.runs?.records || [];
  const total = view.runs?.total;

  return (
    <section id="index-panel" className="flex max-h-56 flex-col gap-2.5 overflow-y-auto border-b border-base-300 px-3 py-3.5 md:max-h-none md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-mono text-[11px] font-normal uppercase tracking-[.08em]">Runs</h2>
        <div id="registry-freshness">
          <span className={badgeClass(loadError ? "unavailable" : regStatus)} title={regTitle}>
            {loadError ? "unavailable" : regStatus || "unknown"}
          </span>
        </div>
      </div>
      <input
        id="filter"
        type="search"
        className="input input-sm w-full"
        placeholder="filter runs · app, status, text"
        aria-label="filter runs"
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
      />
      <ul id="run-list" className="menu menu-sm gap-0.5 p-0">
        {loadError ? (
          <li className="px-3 py-2 text-[12px] text-error" role="alert">
            {`failed to load index: ${loadError}`}
          </li>
        ) : records.length === 0 ? (
          <li className="px-3 py-2 text-[12px] text-base-content/60">
            <div>no runs indexed in this scope</div>
            <code className={`${C.cmd} mt-1.5`}>{'cw -q "<question>"'}</code>
          </li>
        ) : (
          <>
            {typeof total === "number" && total > records.length ? (
              <li className="px-3 py-2 text-[12px] text-base-content/60">{`showing latest ${records.length} of ${total} runs`}</li>
            ) : null}
            {[...records].reverse().map((record) => {
              const lifecycle = record.lifecycle || record.status || "";
              const when = record.createdAt ? new Date(record.createdAt) : null;
              const active = activeRunId === record.runId;
              return (
                <li key={record.runId} className="run-entry">
                  <button
                    type="button"
                    data-runid={record.runId}
                    title={`${record.runId}\n${record.repo || ""}`}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full flex-col items-stretch gap-[3px] rounded-lg px-3 py-2.5 text-left ${active ? "active" : ""}`}
                    onClick={() => selectRun(record.runId)}
                  >
                    <div className="flex items-center gap-2 font-mono text-[12px]">
                      <span className={`inline-block h-2 w-2 flex-none rounded-full ${DOT[lifecycle] || "bg-base-content/40"}`} title={lifecycle || "unknown"} />
                      {`${record.appId || record.workflowId || record.runId}${when ? ` · ${formatClock(when).slice(0, 5)}` : ""}`}
                    </div>
                    <div className="flex justify-between pl-4 text-[11px] text-base-content/60">
                      <span>{lifecycle || "unknown"}</span>
                      <span>{when ? when.toISOString().slice(0, 10) : ""}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </>
        )}
      </ul>
    </section>
  );
}
