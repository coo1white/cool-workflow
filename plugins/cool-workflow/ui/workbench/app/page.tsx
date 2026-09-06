import { Shell } from "../src/next-shell/shell";

// The ids are the wiring points packet 2 hangs behavior on; no data code yet.
export default function Page() {
  return (
    <Shell>
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        <section id="index-panel" className="flex max-h-56 flex-col gap-2.5 overflow-y-auto border-b border-base-300 px-3 py-3.5 md:max-h-none md:border-b-0 md:border-r">
          <div className="flex items-center justify-between px-1">
            <h2 className="font-mono text-[11px] font-normal uppercase tracking-[.08em]">Runs</h2>
            <div id="registry-freshness" />
          </div>
          <input id="filter" type="search" className="input input-sm w-full" placeholder="filter runs · app, status, text" aria-label="filter runs" />
          <ul id="run-list" className="menu menu-sm gap-0.5 p-0" />
        </section>
        <section id="run-panel" className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          <p className="text-base-content/60">Select a run to inspect its graph, blackboard, worker logs, candidate compare, and audit timeline.</p>
        </section>
      </div>
    </Shell>
  );
}
