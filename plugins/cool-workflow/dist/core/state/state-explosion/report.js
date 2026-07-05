"use strict";
// core/state/state-explosion/report.ts — buildStateExplosionReport, the
// operator-digest builder, and maybeCompactRun's PURE decision half.
//
// MILESTONE 4. Byte-exact port of the old build's `buildStateExplosion
// Report`/`buildOperatorDigestWithContext` (src/state-explosion.ts) minus
// the disk I/O — persistence (`refreshStateExplosionSummaries`'s writes,
// `loadStateExplosionSummaryIndex`'s read) is shell/state-explosion-
// cli.ts's job per v2/PLAN.md's core/shell split. This file only builds
// the report VALUE from an in-memory run + an already-loaded index.
//
// See size.ts/graph.ts/digest.ts's own header notes on why `operatorDigest`
// carries truthfully-empty `failures`/`evidenceDigest`/`trustDigest` at
// this milestone (no multi-agent/trust records exist yet — milestone 9).
//
// Evidence: SPEC/state-core.md "buildStateExplosionReport(...)",
// "maybeCompactRun(...) — best-effort ... ALL errors silently caught".
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStateSize = computeStateSize;
exports.buildOperatorDigest = buildOperatorDigest;
exports.buildStateExplosionReport = buildStateExplosionReport;
exports.shouldCompactRun = shouldCompactRun;
const hash_1 = require("../../hash");
const size_1 = require("./size");
const graph_1 = require("./graph");
const digest_1 = require("./digest");
const helpers_1 = require("./helpers");
/** `computeStateSize(run, thresholds?)` — builds the graph view via
 *  `runToGraphViewFromWorkflowRun` then delegates to
 *  `computeStateSizeWithGraph`. Lives here (not size.ts) so size.ts stays
 *  graph-builder-agnostic — see size.ts's own header note on this
 *  module-boundary choice. */
function computeStateSize(run, thresholds = size_1.DEFAULT_STATE_EXPLOSION_THRESHOLDS) {
    return (0, size_1.computeStateSizeWithGraph)(run, thresholds, (0, graph_1.runToGraphViewFromWorkflowRun)(run));
}
function buildOperatorDigest(run, compact, blackboard, stateSize, now, operator) {
    const hiddenSourceRecords = compact.syntheticNodes.map((syn) => ({
        kind: syn.id.split(":summary:")[1] || syn.kind,
        count: syn.collapsedNodeCount,
        expansionCommand: syn.expansionCommand,
    }));
    const expansionCommands = (0, helpers_1.unique)([
        `node scripts/cw.js multi-agent graph ${run.id} --view full --json`,
        `node scripts/cw.js blackboard message list ${run.id} --topic <topic-id>`,
        `node scripts/cw.js multi-agent graph ${run.id} --view critical-path`,
        `node scripts/cw.js multi-agent failures ${run.id} --json`,
        ...compact.syntheticNodes.map((syn) => syn.expansionCommand),
    ]);
    const evidence = operator?.evidence || [];
    const adopted = evidence.filter((e) => e.status === "adopted");
    const missing = evidence.filter((e) => e.status === "missing" || e.status === "pending" || e.status === "conflicting");
    const rejected = evidence.filter((e) => e.status === "rejected");
    return {
        schemaVersion: size_1.STATE_EXPLOSION_SCHEMA_VERSION,
        runId: run.id,
        id: "operator-digest",
        scope: "run",
        sourceRecordIds: compact.sourceRecordIds,
        sourceFingerprint: (0, hash_1.fingerprintStrings)([compact.sourceFingerprint, blackboard.sourceFingerprint, String(stateSize.total)]),
        includedCount: compact.compactNodeCount,
        omittedCount: compact.collapsedNodeCount,
        importantRefs: compact.criticalPath,
        evidenceRefs: (0, helpers_1.unique)(adopted.map((e) => e.ref || e.id)),
        trustAuditEventRefs: (0, helpers_1.unique)(blackboard.trustAuditEventRefs),
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
                sourceIds: [e.sourceId || e.id].filter(Boolean),
                evidenceRefs: [e.ref || e.id].filter(Boolean),
                expansionCommand: `node scripts/cw.js multi-agent evidence ${run.id} --json`,
            })),
        },
        trustDigest: {
            events: operator?.trustEvents || 0,
            policyViolations: blackboard.policyViolations.length,
            judgeRationales: blackboard.judgeRationale.length,
            entries: (0, helpers_1.unique)([...blackboard.policyViolations.map((p) => p.id), ...blackboard.judgeRationale.map((j) => j.id)]),
        },
        hiddenSourceRecords,
        expansionCommands,
    };
}
function currentEntryFingerprint(entry, records) {
    if (entry.scope === "blackboard")
        return records.blackboardDigest.sourceFingerprint;
    if (entry.id.startsWith("graph-")) {
        if (entry.id === records.compactGraph.id)
            return records.compactGraph.sourceFingerprint;
        return undefined;
    }
    if (entry.id === "operator-digest")
        return records.operatorDigest.sourceFingerprint;
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
function buildStateExplosionReport(run, options = {}) {
    const thresholds = options.thresholds || size_1.DEFAULT_STATE_EXPLOSION_THRESHOLDS;
    const now = options.now || new Date().toISOString();
    const graphView = options.graphView || (0, graph_1.runToGraphViewFromWorkflowRun)(run);
    const stateSize = (0, size_1.computeStateSizeWithGraph)(run, thresholds, graphView);
    const compactGraph = (0, graph_1.buildCompactGraphFromView)(run.id, graphView, "compact", { thresholds, now });
    const criticalPathGraph = (0, graph_1.buildCompactGraphFromView)(run.id, graphView, "critical-path", { thresholds, now });
    // `run.blackboard` is `unknown[]`-typed at this milestone (core/state/
    // types.ts's MultiAgentState/BlackboardState header note — real record
    // shapes land with milestone 9); this cast is the one bridge point
    // between "genuinely empty today" and "typed once milestone 9 writes
    // real records", matching digest.ts's own DigestTopic/Message/... shapes.
    const blackboardDigest = (0, digest_1.summarizeBlackboardDigest)({
        id: run.id,
        blackboard: run.blackboard,
    }, undefined, now);
    const operatorDigest = buildOperatorDigest(run, compactGraph, blackboardDigest, stateSize, now, options.operator);
    const currentFingerprint = (0, hash_1.fingerprintStrings)([
        compactGraph.sourceFingerprint,
        blackboardDigest.sourceFingerprint,
        operatorDigest.sourceFingerprint,
        String(stateSize.total),
    ]);
    const persisted = options.index;
    const staleScopes = [];
    let status = persisted ? "valid" : "absent";
    if (persisted) {
        if (persisted.sourceFingerprint !== currentFingerprint)
            status = "stale";
        for (const entry of persisted.entries) {
            const current = currentEntryFingerprint(entry, { compactGraph, blackboardDigest, operatorDigest });
            if (current && current !== entry.sourceFingerprint)
                staleScopes.push(`${entry.scope}:${entry.id}`);
        }
        if (staleScopes.length)
            status = "stale";
    }
    const nextAction = status === "stale" || status === "absent" ? `node scripts/cw.js summary refresh ${run.id}` : operatorDigest.nextAction;
    return {
        schemaVersion: size_1.STATE_EXPLOSION_SCHEMA_VERSION,
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
function shouldCompactRun(run, thresholds = size_1.DEFAULT_STATE_EXPLOSION_THRESHOLDS) {
    const graphView = (0, graph_1.runToGraphViewFromWorkflowRun)(run);
    return (0, size_1.computeStateSizeWithGraph)(run, thresholds, graphView).compactionRecommended;
}
