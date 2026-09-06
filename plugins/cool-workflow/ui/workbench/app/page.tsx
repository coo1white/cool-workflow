import { Shell } from "../src/next-shell/shell";
import { loadWorkbenchIndex } from "../src/load-index";
import { RunList } from "../src/run-list";
import { RunPanel } from "../src/run-panel";

// Server component: loads the build-time run index snapshot once (Node fs,
// src/load-index.ts) and passes it to the run list. RunList and RunPanel
// are the two client islands that re-fetch api/index and api/run/<id>
// once a real host serves this page; no fetch happens for this first paint.
export default function Page() {
  const initialIndex = loadWorkbenchIndex();
  const hasRuns = (initialIndex.runs.records?.length ?? 0) > 0;
  return (
    <Shell>
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
        <RunList initialIndex={initialIndex} />
        <RunPanel hasRuns={hasRuns} />
      </div>
    </Shell>
  );
}
