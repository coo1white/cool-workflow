// core/state/state-explosion/report.ts — buildStateExplosionReport, the
// operator-digest builder, and maybeCompactRun's PURE decision half.
//
// MILESTONE 4. Byte-exact port of the old build's `buildStateExplosion
// Report`/`buildOperatorDigestWithContext` (src/state-explosion.ts) minus
// the disk I/O — persistence (`refreshStateExplosionSummaries`'s writes,
// `loadStateExplosionSummaryIndex`'s read) is shell/state-explosion-
// cli.ts's job per plugins/cool-workflow/project/docs/rebuild/PLAN.md's core/shell split. This file only builds
// the report VALUE from an in-memory run + an already-loaded index.
//
// See size.ts/graph.ts/digest.ts's own header notes on why `operatorDigest`
// carries truthfully-empty `failures`/`evidenceDigest`/`trustDigest` at
// this milestone (no multi-agent/trust records exist yet — milestone 9).
//
// Evidence: SPEC/state-core.md "buildStateExplosionReport(...)",
// "maybeCompactRun(...) — best-effort ... ALL errors silently caught".

import { fingerprintStrings } from "../../hash";
import { WorkflowRun } from "../types";
import {
  DEFAULT_STATE_EXPLOSION_THRESHOLDS,
  STATE_EXPLOSION_SCHEMA_VERSION,
  StateExplosionThresholds,
  StateSize,
  computeStateSizeWithGraph,
} from "./size";
import { GraphSummaryRecord, GraphView, GraphViewInput, buildCompactGraphFromView, runToGraphViewFromWorkflowRun } from "./graph";
import { BlackboardDigestRunView, BlackboardSummaryRecord, summarizeBlackboardDigest } from "./digest";
import { unique } from "./helpers";

/** `computeStateSize(run, thresholds?)` — builds the graph view via
 *  `runToGraphViewFromWorkflowRun` then delegates to
 *  `computeStateSizeWithGraph`. Lives here (not size.ts) so size.ts stays
 *  graph-builder-agnostic — see size.ts's own header note on this
 *  module-boundary choice. */
export function computeStateSize(run: WorkflowRun, thresholds: StateExplosionThresholds = DEFAULT_STATE_EXPLOSION_THRESHOLDS): StateSize {
  return computeStateSizeWithGraph(run, thresholds, runToGraphViewFromWorkflowRun(run));
}

export type SummaryStatus = "valid" | "stale" | "absent";

export interface OperatorDigest {
  schemaVersion: number;
  runId: string;
  id: "operator-digest";
  scope: "run";
  sourceRecordIds: string[];
  sourceFingerprint: string;
  includedCount: number;
  omittedCount: number;
  importantRefs: string[];
  evidenceRefs: string[];
  trustAuditEventRefs: string[];
  generatedAt: string;
  status: SummaryStatus;
  deterministic: boolean;
  nextAction: string;
  stateSize: StateSize;
  compactGraphRef: string;
  blackboardDigestRef: string;
  criticalPath: string[];
  failures: Array<{ id: string; kind: string; status: string; reason: string; nextCommand: string }>;
  evidenceDigest: { adopted: number; missing: number; rejected: number; entries: unknown[] };
  trustDigest: { events: number; policyViolations: number; judgeRationales: number; entries: string[] };
  hiddenSourceRecords: Array<{ kind: string; count: number; expansionCommand: string }>;
  expansionCommands: string[];
}

export interface MultiAgentSummaryIndexEntry {
  scope: string;
  id: string;
  path: string;
  sourceFingerprint: string;
  includedCount: number;
  omittedCount: number;
  status: SummaryStatus;
}

export interface MultiAgentSummaryIndex {
  schemaVersion: number;
  runId: string;
  id: "multi-agent-summary-index";
  scope: "run";
  sourceRecordIds: string[];
  sourceFingerprint: string;
  includedCount: number;
  omittedCount: number;
  importantRefs: string[];
  evidenceRefs: string[];
  trustAuditEventRefs: string[];
  generatedAt: string;
  status: SummaryStatus;
  deterministic: boolean;
  nextAction: string;
  entries: MultiAgentSummaryIndexEntry[];
  views: GraphView[];
  paths: { summariesDir: string; indexPath: string; reportPath: string };
}

export interface StateExplosionReport {
  schemaVersion: number;
  runId: string;
  generatedAt: string;
  stateSize: StateSize;
  freshness: {
    status: SummaryStatus;
    persistedFingerprint?: string;
    currentFingerprint: string;
    staleScopes: string[];
  };
  index?: MultiAgentSummaryIndex;
  compactGraph: GraphSummaryRecord;
  criticalPathGraph: GraphSummaryRecord;
  blackboardDigest: BlackboardSummaryRecord;
  operatorDigest: OperatorDigest;
  hiddenSourceRecords: OperatorDigest["hiddenSourceRecords"];
  expansionCommands: string[];
  nextAction: string;
}

/** The operator-derived failures/evidence/trust the digest folds in. Shell's
 *  `summarizeMultiAgentOperator(run)` (multi-agent-operator-ux.ts) produces
 *  this; a core caller with no operator summary passes nothing and the digest
 *  degrades to truthfully-empty. Kept structural so core stays shell-free. */
export interface OperatorDigestInput {
  failures: Array<{ id: string; kind: string; status: string; reason: string; nextCommand: string }>;
  evidence: Array<{ id: string; ref?: string; status: string; sourceId?: string }>;
  nextAction?: string;
  trustEvents?: number;
}

export function buildOperatorDigest(
  run: Pick<WorkflowRun, "id">,
  compact: GraphSummaryRecord,
  blackboard: BlackboardSummaryRecord,
  stateSize: StateSize,
  now: string,
  operator?: OperatorDigestInput
): OperatorDigest {
  const hiddenSourceRecords = compact.syntheticNodes.map((syn) => ({
    kind: syn.id.split(":summary:")[1] || syn.kind,
    count: syn.collapsedNodeCount,
    expansionCommand: syn.expansionCommand,
  }));
  const expansionCommands = unique([
    `cw multi-agent graph ${run.id} --view full --json`,
    `cw blackboard message list ${run.id} --topic <topic-id>`,
    `cw multi-agent graph ${run.id} --view critical-path`,
    `cw multi-agent failures ${run.id} --json`,
    ...compact.syntheticNodes.map((syn) => syn.expansionCommand),
  ]);
  const evidence = operator?.evidence || [];
  const adopted = evidence.filter((e) => e.status === "adopted");
  const missing = evidence.filter((e) => e.status === "missing" || e.status === "pending" || e.status === "conflicting");
  const rejected = evidence.filter((e) => e.status === "rejected");
  return {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    id: "operator-digest",
    scope: "run",
    sourceRecordIds: compact.sourceRecordIds,
    sourceFingerprint: fingerprintStrings([compact.sourceFingerprint, blackboard.sourceFingerprint, String(stateSize.total)]),
    includedCount: compact.compactNodeCount,
    omittedCount: compact.collapsedNodeCount,
    importantRefs: compact.criticalPath,
    evidenceRefs: unique(adopted.map((e) => e.ref || e.id)),
    trustAuditEventRefs: unique(blackboard.trustAuditEventRefs),
    generatedAt: now,
    status: "valid",
    deterministic: true,
    // Prefer the operator summary's nextAction (it reflects the whole run's
    // blocked/evidence state); fall back to the compact graph's own when no
    // operator summary was threaded in.
    nextAction: operator?.nextAction || compact.nextAction,
    stateSize,
    compactGraphRef: compact.id,
    blackboardDigestRef: blackboard.id,
    criticalPath: compact.criticalPath,
    failures: (operator?.failures || []).map((f) => ({ id: f.id, kind: f.kind, status: f.status, reason: f.reason, nextCommand: f.nextCommand })),
    evidenceDigest: {
      adopted: adopted.length,
      missing: missing.length,
      rejected: rejected.length,
      entries: [...adopted, ...missing].slice(0, 40).map((e) => ({
        id: e.id,
        label: `${e.ref || e.id} (${e.status})`,
        status: e.status,
        sourceIds: [e.sourceId || e.id].filter(Boolean) as string[],
        evidenceRefs: [e.ref || e.id].filter(Boolean) as string[],
        expansionCommand: `cw multi-agent evidence ${run.id} --json`,
      })),
    },
    trustDigest: {
      events: operator?.trustEvents || 0,
      policyViolations: blackboard.policyViolations.length,
      judgeRationales: blackboard.judgeRationale.length,
      entries: unique([...blackboard.policyViolations.map((p) => p.id), ...blackboard.judgeRationale.map((j) => j.id)]),
    },
    hiddenSourceRecords,
    expansionCommands,
  };
}

function currentEntryFingerprint(
  entry: MultiAgentSummaryIndexEntry,
  records: { compactGraph: GraphSummaryRecord; blackboardDigest: BlackboardSummaryRecord; operatorDigest: OperatorDigest }
): string | undefined {
  if (entry.scope === "blackboard") return records.blackboardDigest.sourceFingerprint;
  if (entry.id.startsWith("graph-")) {
    if (entry.id === records.compactGraph.id) return records.compactGraph.sourceFingerprint;
    return undefined;
  }
  if (entry.id === "operator-digest") return records.operatorDigest.sourceFingerprint;
  return undefined;
}

/** Builds the full `StateExplosionReport` VALUE (no disk I/O) from an
 *  in-memory run plus an already-loaded persisted index (or none).
 *
 *  `options.graphView` lets a caller that already ran
 *  `runToGraphViewFromWorkflowRun(run)` this same tick (e.g.
 *  `refreshStateExplosionSummaries`) hand that value in, so this function
 *  does not build the graph view a second time. Mirrors the old build's
 *  `StateExplosionBuildContext` memoization — one graph build per refresh,
 *  not one per derived view. */
export function buildStateExplosionReport(
  run: WorkflowRun,
  options: {
    thresholds?: StateExplosionThresholds;
    index?: MultiAgentSummaryIndex;
    now?: string;
    operator?: OperatorDigestInput;
    graphView?: GraphViewInput;
  } = {}
): StateExplosionReport {
  const thresholds = options.thresholds || DEFAULT_STATE_EXPLOSION_THRESHOLDS;
  const now = options.now || new Date().toISOString();
  const graphView = options.graphView || runToGraphViewFromWorkflowRun(run);
  const stateSize = computeStateSizeWithGraph(run, thresholds, graphView);
  const compactGraph = buildCompactGraphFromView(run.id, graphView, "compact", { thresholds, now });
  const criticalPathGraph = buildCompactGraphFromView(run.id, graphView, "critical-path", { thresholds, now });
  // `run.blackboard` is `unknown[]`-typed at this milestone (core/state/
  // types.ts's MultiAgentState/BlackboardState header note — real record
  // shapes land with milestone 9); this cast is the one bridge point
  // between "genuinely empty today" and "typed once milestone 9 writes
  // real records", matching digest.ts's own DigestTopic/Message/... shapes.
  const blackboardDigest = summarizeBlackboardDigest(
    {
      id: run.id,
      blackboard: run.blackboard as unknown as BlackboardDigestRunView["blackboard"],
    },
    undefined,
    now
  );
  const operatorDigest = buildOperatorDigest(run, compactGraph, blackboardDigest, stateSize, now, options.operator);

  const currentFingerprint = fingerprintStrings([
    compactGraph.sourceFingerprint,
    blackboardDigest.sourceFingerprint,
    operatorDigest.sourceFingerprint,
    String(stateSize.total),
  ]);

  const persisted = options.index;
  const staleScopes: string[] = [];
  let status: SummaryStatus = persisted ? "valid" : "absent";
  if (persisted) {
    if (persisted.sourceFingerprint !== currentFingerprint) status = "stale";
    for (const entry of persisted.entries) {
      const current = currentEntryFingerprint(entry, { compactGraph, blackboardDigest, operatorDigest });
      if (current && current !== entry.sourceFingerprint) staleScopes.push(`${entry.scope}:${entry.id}`);
    }
    if (staleScopes.length) status = "stale";
  }

  const nextAction = status === "stale" || status === "absent" ? `cw summary refresh ${run.id}` : operatorDigest.nextAction;

  return {
    schemaVersion: STATE_EXPLOSION_SCHEMA_VERSION,
    runId: run.id,
    generatedAt: now,
    stateSize,
    freshness: {
      status,
      persistedFingerprint: persisted?.sourceFingerprint,
      currentFingerprint,
      staleScopes: staleScopes.sort(),
    },
    index: persisted,
    compactGraph,
    criticalPathGraph,
    blackboardDigest,
    operatorDigest,
    hiddenSourceRecords: operatorDigest.hiddenSourceRecords,
    expansionCommands: operatorDigest.expansionCommands,
    nextAction,
  };
}

/** The pure decision half of `maybeCompactRun`: true when the caller
 *  should refresh summaries. The actual refresh (disk write) + the "catch
 *  ALL errors" best-effort wrapper live in shell/state-explosion-cli.ts,
 *  since only that layer can fail on real disk I/O. */
export function shouldCompactRun(run: WorkflowRun, thresholds: StateExplosionThresholds = DEFAULT_STATE_EXPLOSION_THRESHOLDS): boolean {
  const graphView = runToGraphViewFromWorkflowRun(run);
  return computeStateSizeWithGraph(run, thresholds, graphView).compactionRecommended;
}
