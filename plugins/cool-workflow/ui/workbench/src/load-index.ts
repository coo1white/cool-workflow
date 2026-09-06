// Build-time loader for the run index. Node fs/require only; this runs
// during `next build`/export, never in the browser (app/page.tsx, a server
// component, is its only caller). It reads the same data the host's
// /api/index route serves, through the SAME function
// (buildWorkbenchIndex), so the exported page's embedded snapshot can
// never drift from the live route's shape. On a bare tree (no .cw/ runs
// yet — true for this repo's own build) the snapshot is empty; the run
// list's client island re-fetches the real index once a host serves it.
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkbenchIndexView } from "./api";

const EMPTY_INDEX: WorkbenchIndexView = {
  schemaVersion: 1,
  surface: "workbench",
  command: "index",
  scope: "repo",
  registry: {},
  runs: { total: 0, records: [] },
};

export function loadWorkbenchIndex(): WorkbenchIndexView {
  try {
    // dist/shell/workbench.js is committed alongside src/ (built from
    // src/shell/workbench.ts), so this is normally importable; the
    // plain-JSON fallback below only covers a checkout where dist/ has
    // not been built yet.
    const distPath = path.resolve(__dirname, "..", "..", "..", "dist", "shell", "workbench.js");
    // `eval("require")` (not a literal `require(...)` call) so the Next/
    // Turbopack bundler never sees a resolvable require and leaves this to
    // Node at run time; a plain `require(distPath)` fails the build ("server
    // relative imports are not implemented yet") because the path is only
    // known at run time.
    const nodeRequire = eval("require") as NodeRequire;
    const workbench = nodeRequire(distPath) as { buildWorkbenchIndex: (args?: Record<string, unknown>) => WorkbenchIndexView };
    return workbench.buildWorkbenchIndex({ scope: "repo" });
  } catch {
    return readIndexFromDisk();
  }
}

// Fallback: read .cw/runs/*/state.json directly, in the same two shapes
// (registry + runs) the host returns, when the compiled module cannot be
// loaded. No fingerprinting, no freshness check — just enough to render a
// run list; the client island re-fetches the real index once a host
// serves it.
// ponytail: a minimal stand-in for buildWorkbenchIndex's full registry
// logic; upgrade if this path is ever more than a build-time safety net.
function readIndexFromDisk(): WorkbenchIndexView {
  const cwd = path.resolve(__dirname, "..", "..");
  const runsDir = path.join(cwd, ".cw", "runs");
  if (!fs.existsSync(runsDir)) return EMPTY_INDEX;
  const records: WorkbenchIndexView["runs"]["records"] = [];
  for (const runId of fs.readdirSync(runsDir)) {
    const statePath = path.join(runsDir, runId, "state.json");
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      records!.push({ runId, appId: state.appId, workflowId: state.workflowId, lifecycle: state.lifecycle, createdAt: state.createdAt, repo: cwd });
    } catch {
      // Corrupt state.json: skip it, the same fail-open-on-one-bad-run the
      // host's own index build takes.
    }
  }
  return { schemaVersion: 1, surface: "workbench", command: "index", scope: "repo", registry: {}, runs: { total: records!.length, records } };
}
