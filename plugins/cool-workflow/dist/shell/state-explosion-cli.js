"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStateExplosionReport = void 0;
exports.maybeCompactRun = maybeCompactRun;
exports.refreshStateExplosionSummaries = refreshStateExplosionSummaries;
exports.loadStateExplosionSummaryIndex = loadStateExplosionSummaryIndex;
exports.showStateExplosionSummary = showStateExplosionSummary;
exports.summaryRefreshCli = summaryRefreshCli;
exports.summaryShowCli = summaryShowCli;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_store_1 = require("./run-store");
const hash_1 = require("../core/hash");
const size_1 = require("../core/state/state-explosion/size");
const graph_1 = require("../core/state/state-explosion/graph");
const digest_1 = require("../core/state/state-explosion/digest");
const helpers_1 = require("../core/state/state-explosion/helpers");
const report_1 = require("../core/state/state-explosion/report");
Object.defineProperty(exports, "buildStateExplosionReport", { enumerable: true, get: function () { return report_1.buildStateExplosionReport; } });
const size_2 = require("../core/state/state-explosion/size");
const multi_agent_operator_ux_1 = require("./multi-agent-operator-ux");
function summariesDir(run) {
    return path.join(run.paths.runDir, "summaries");
}
/** Best-effort: when `shouldCompactRun(run)`, refresh the summaries. ALL
 *  errors silently caught — a state mutation must never fail because of
 *  compaction. */
function maybeCompactRun(run) {
    try {
        if ((0, report_1.shouldCompactRun)(run))
            refreshStateExplosionSummaries(run);
    }
    catch {
        // Best-effort optimization only.
    }
}
/** Writes every summary record plus `index.json` and
 *  `state-explosion-report.json` under `<runDir>/summaries/`. Trust-audit
 *  event recording (`kind: "summary.refresh"`) is deferred to milestone 8
 *  (no trust-audit module exists yet); this is a purely observational
 *  side effect in the old build and does not affect the JSON this
 *  function returns or persists. */
function refreshStateExplosionSummaries(run, options = {}) {
    const thresholds = options.thresholds || size_1.DEFAULT_STATE_EXPLOSION_THRESHOLDS;
    const now = options.now || new Date().toISOString();
    const dir = summariesDir(run);
    fs.mkdirSync(dir, { recursive: true });
    const views = options.views || graph_1.GRAPH_VIEWS;
    const graphView = (0, graph_1.runToGraphViewFromWorkflowRun)(run);
    // See core/state/state-explosion/report.ts's own note on this cast.
    const blackboardDigest = (0, digest_1.summarizeBlackboardDigest)({
        id: run.id,
        blackboard: run.blackboard,
    }, undefined, now);
    const stateSize = (0, size_2.computeStateSizeWithGraph)(run, thresholds, graphView);
    const compactGraph = (0, graph_1.buildCompactGraphFromView)(run.id, graphView, "compact", { thresholds, now });
    const operatorDigest = (0, report_1.buildOperatorDigest)(run, compactGraph, blackboardDigest, stateSize, now, (0, multi_agent_operator_ux_1.operatorDigestInput)(run));
    const graphRecords = views.map((view) => (0, graph_1.buildCompactGraphFromView)(run.id, graphView, view, { thresholds, now }));
    const entries = [];
    const writeRecord = (id, record, scope, fingerprint, included, omitted) => {
        const file = path.join(dir, `${(0, fs_atomic_1.safeFileName)(id)}.json`);
        (0, fs_atomic_1.writeJson)(file, record);
        entries.push({ scope, id, path: file, sourceFingerprint: fingerprint, includedCount: included, omittedCount: omitted, status: "valid" });
    };
    writeRecord(blackboardDigest.id, blackboardDigest, "blackboard", blackboardDigest.sourceFingerprint, blackboardDigest.includedCount, blackboardDigest.omittedCount);
    writeRecord(operatorDigest.id, operatorDigest, "run", operatorDigest.sourceFingerprint, operatorDigest.includedCount, operatorDigest.omittedCount);
    for (const record of graphRecords) {
        writeRecord(record.id, record, "run", record.sourceFingerprint, record.compactNodeCount, record.collapsedNodeCount);
    }
    const reportPath = path.join(dir, "state-explosion-report.json");
    const index = {
        schemaVersion: operatorDigest.schemaVersion,
        runId: run.id,
        id: "multi-agent-summary-index",
        scope: "run",
        sourceRecordIds: (0, helpers_1.unique)([...blackboardDigest.sourceRecordIds, ...operatorDigest.sourceRecordIds]),
        sourceFingerprint: (0, hash_1.fingerprintStrings)([compactGraph.sourceFingerprint, blackboardDigest.sourceFingerprint, operatorDigest.sourceFingerprint, String(stateSize.total)]),
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
    (0, fs_atomic_1.writeJson)(index.paths.indexPath, index);
    const report = (0, report_1.buildStateExplosionReport)(run, { thresholds, index, now, operator: (0, multi_agent_operator_ux_1.operatorDigestInput)(run) });
    (0, fs_atomic_1.writeJson)(reportPath, report);
    return index;
}
/** Reads `summaries/index.json`; returns `undefined` when the file is
 *  missing, unparseable, or its `id` is not `multi-agent-summary-index`. */
function loadStateExplosionSummaryIndex(run) {
    const indexPath = path.join(summariesDir(run), "index.json");
    if (!fs.existsSync(indexPath))
        return undefined;
    try {
        const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
        if (!parsed || parsed.id !== "multi-agent-summary-index")
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
/** Loads the persisted index (if any), builds the report against it.
 *  Trust-audit `summary.stale` event recording is deferred to milestone 8
 *  (see `refreshStateExplosionSummaries`'s own note). */
function showStateExplosionSummary(run, options = {}) {
    const index = loadStateExplosionSummaryIndex(run);
    return (0, report_1.buildStateExplosionReport)(run, { thresholds: options.thresholds, index, operator: (0, multi_agent_operator_ux_1.operatorDigestInput)(run) });
}
// ---------------------------------------------------------------------
// CLI-facing wrappers: `cw summary refresh <run-id> [--json]` / `cw
// summary show <run-id> [--json]`.
// ---------------------------------------------------------------------
function loadRun(runId, options = {}) {
    const cwd = options.cwd ? path.resolve(String(options.cwd)) : process.cwd();
    return (0, run_store_1.loadRunFromCwd)(runId, cwd);
}
/** `cw summary refresh <run-id> [--json]` — refresh also runs `writeReport`
 *  + `saveCheckpoint` in the old build; `writeReport` (report.md) is a
 *  later-milestone (11) concern, so this milestone runs `saveCheckpoint`
 *  only (the run-state checkpoint write is real and load-bearing today;
 *  report.md rendering is not). */
function summaryRefreshCli(runId, options = {}) {
    const run = loadRun(runId, options);
    const index = refreshStateExplosionSummaries(run);
    (0, run_store_1.saveCheckpoint)(run);
    return index;
}
/** `cw summary show <run-id> [--json]` — also runs `saveCheckpoint`. */
function summaryShowCli(runId, options = {}) {
    const run = loadRun(runId, options);
    const report = showStateExplosionSummary(run);
    (0, run_store_1.saveCheckpoint)(run);
    return report;
}
