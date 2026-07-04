// shell/state-explosion-cli.ts — CLI/MCP-reachable bodies for the
// state-explosion capability rows (summary.refresh, summary.show).
//
// MILESTONE 4. Byte-exact port of the old build's
// `refreshStateExplosionSummaries`/`loadStateExplosionSummaryIndex`/
// `showStateExplosionSummary`/`maybeCompactRun` (src/state-explosion.ts)
// DISK I/O half — the report VALUE itself is built by core/state/state-
// explosion/report.ts's `buildStateExplosionReport` (pure); this file only
// writes/reads the summary files and wires the CLI handler bodies.
//
// Evidence: SPEC/state-core.md "refreshStateExplosionSummaries(...)",
// "loadStateExplosionSummaryIndex(...)", "showStateExplosionSummary(...)",
// "maybeCompactRun(...) — best-effort ... ALL errors silently caught".

import * as fs from "node:fs";
import * as path from "node:path";
import { writeJson, safeFileName } from "./fs-atomic";
import { loadRunFromCwd, saveCheckpoint } from "./run-store";
import { fingerprintStrings } from "../core/hash";
import { DEFAULT_STATE_EXPLOSION_THRESHOLDS, StateExplosionThresholds } from "../core/state/state-explosion/size";
import { GRAPH_VIEWS, GraphView, buildCompactGraphFromView, runToGraphViewFromWorkflowRun } from "../core/state/state-explosion/graph";
import { BlackboardDigestRunView, summarizeBlackboardDigest } from "../core/state/state-explosion/digest";
import { unique } from "../core/state/state-explosion/helpers";
import {
  MultiAgentSummaryIndex,
  MultiAgentSummaryIndexEntry,
  StateExplosionReport,
  buildOperatorDigest,
  buildStateExplosionReport,
  shouldCompactRun,
} from "../core/state/state-explosion/report";
import { computeStateSizeWithGraph } from "../core/state/state-explosion/size";
import { WorkflowRun } from "../core/state/types";

export type { MultiAgentSummaryIndex, MultiAgentSummaryIndexEntry, StateExplosionReport };
export { buildStateExplosionReport };

function summariesDir(run: WorkflowRun): string {
  return path.join(run.paths.runDir, "summaries");
}

/** Best-effort: when `shouldCompactRun(run)`, refresh the summaries. ALL
 *  errors silently caught — a state mutation must never fail because of
 *  compaction. */
export function maybeCompactRun(run: WorkflowRun): void {
  try {
    if (shouldCompactRun(run)) refreshStateExplosionSummaries(run);
  } catch {
    // Best-effort optimization only.
  }
}

/** Writes every summary record plus `index.json` and
 *  `state-explosion-report.json` under `<runDir>/summaries/`. Trust-audit
 *  event recording (`kind: "summary.refresh"`) is deferred to milestone 8
 *  (no trust-audit module exists yet); this is a purely observational
 *  side effect in the old build and does not affect the JSON this
 *  function returns or persists. */
export function refreshStateExplosionSummaries(
  run: WorkflowRun,
  options: { thresholds?: StateExplosionThresholds; views?: GraphView[]; now?: string } = {}
): MultiAgentSummaryIndex {
  const thresholds = options.thresholds || DEFAULT_STATE_EXPLOSION_THRESHOLDS;
  const now = options.now || new Date().toISOString();
  const dir = summariesDir(run);
  fs.mkdirSync(dir, { recursive: true });
  const views = options.views || GRAPH_VIEWS;

  const graphView = runToGraphViewFromWorkflowRun(run);
  // See core/state/state-explosion/report.ts's own note on this cast.
  const blackboardDigest = summarizeBlackboardDigest(
    {
      id: run.id,
      blackboard: run.blackboard as unknown as BlackboardDigestRunView["blackboard"],
    },
    undefined,
    now
  );
  const stateSize = computeStateSizeWithGraph(run, thresholds, graphView);
  const compactGraph = buildCompactGraphFromView(run.id, graphView, "compact", { thresholds, now });
  const operatorDigest = buildOperatorDigest(run, compactGraph, blackboardDigest, stateSize, now);
  const graphRecords = views.map((view) => buildCompactGraphFromView(run.id, graphView, view, { thresholds, now }));

  const entries: MultiAgentSummaryIndexEntry[] = [];
  const writeRecord = (id: string, record: unknown, scope: string, fingerprint: string, included: number, omitted: number) => {
    const file = path.join(dir, `${safeFileName(id)}.json`);
    writeJson(file, record);
    entries.push({ scope, id, path: file, sourceFingerprint: fingerprint, includedCount: included, omittedCount: omitted, status: "valid" });
  };

  writeRecord(blackboardDigest.id, blackboardDigest, "blackboard", blackboardDigest.sourceFingerprint, blackboardDigest.includedCount, blackboardDigest.omittedCount);
  writeRecord(operatorDigest.id, operatorDigest, "run", operatorDigest.sourceFingerprint, operatorDigest.includedCount, operatorDigest.omittedCount);
  for (const record of graphRecords) {
    writeRecord(record.id, record, "run", record.sourceFingerprint, record.compactNodeCount, record.collapsedNodeCount);
  }

  const reportPath = path.join(dir, "state-explosion-report.json");
  const index: MultiAgentSummaryIndex = {
    schemaVersion: operatorDigest.schemaVersion,
    runId: run.id,
    id: "multi-agent-summary-index",
    scope: "run",
    sourceRecordIds: unique([...blackboardDigest.sourceRecordIds, ...operatorDigest.sourceRecordIds]),
    sourceFingerprint: fingerprintStrings([compactGraph.sourceFingerprint, blackboardDigest.sourceFingerprint, operatorDigest.sourceFingerprint, String(stateSize.total)]),
    includedCount: entries.reduce((acc, e) => acc + e.includedCount, 0),
    omittedCount: entries.reduce((acc, e) => acc + e.omittedCount, 0),
    importantRefs: operatorDigest.criticalPath,
    evidenceRefs: operatorDigest.evidenceRefs,
    trustAuditEventRefs: blackboardDigest.trustAuditEventRefs,
    generatedAt: now,
    status: "valid",
    deterministic: true,
    nextAction: `node scripts/cw.js summary show ${run.id}`,
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    views,
    paths: { summariesDir: dir, indexPath: path.join(dir, "index.json"), reportPath },
  };
  writeJson(index.paths.indexPath, index);
  const report = buildStateExplosionReport(run, { thresholds, index, now });
  writeJson(reportPath, report);

  return index;
}

/** Reads `summaries/index.json`; returns `undefined` when the file is
 *  missing, unparseable, or its `id` is not `multi-agent-summary-index`. */
export function loadStateExplosionSummaryIndex(run: WorkflowRun): MultiAgentSummaryIndex | undefined {
  const indexPath = path.join(summariesDir(run), "index.json");
  if (!fs.existsSync(indexPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as MultiAgentSummaryIndex;
    if (!parsed || parsed.id !== "multi-agent-summary-index") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** Loads the persisted index (if any), builds the report against it.
 *  Trust-audit `summary.stale` event recording is deferred to milestone 8
 *  (see `refreshStateExplosionSummaries`'s own note). */
export function showStateExplosionSummary(run: WorkflowRun, options: { thresholds?: StateExplosionThresholds } = {}): StateExplosionReport {
  const index = loadStateExplosionSummaryIndex(run);
  return buildStateExplosionReport(run, { thresholds: options.thresholds, index });
}

// ---------------------------------------------------------------------
// CLI-facing wrappers: `cw summary refresh <run-id> [--json]` / `cw
// summary show <run-id> [--json]`.
// ---------------------------------------------------------------------

function loadRun(runId: string, options: Record<string, unknown> = {}): WorkflowRun {
  const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
  return loadRunFromCwd(runId, cwd);
}

/** `cw summary refresh <run-id> [--json]` — refresh also runs `writeReport`
 *  + `saveCheckpoint` in the old build; `writeReport` (report.md) is a
 *  later-milestone (11) concern, so this milestone runs `saveCheckpoint`
 *  only (the run-state checkpoint write is real and load-bearing today;
 *  report.md rendering is not). */
export function summaryRefreshCli(runId: string, options: Record<string, unknown> = {}): MultiAgentSummaryIndex {
  const run = loadRun(runId, options);
  const index = refreshStateExplosionSummaries(run);
  saveCheckpoint(run);
  return index;
}

/** `cw summary show <run-id> [--json]` — also runs `saveCheckpoint`. */
export function summaryShowCli(runId: string, options: Record<string, unknown> = {}): StateExplosionReport {
  const run = loadRun(runId, options);
  const report = showStateExplosionSummary(run);
  saveCheckpoint(run);
  return report;
}
