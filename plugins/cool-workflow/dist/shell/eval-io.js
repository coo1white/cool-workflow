"use strict";
// shell/eval-io.ts — createMultiAgentReplaySnapshot/replayMultiAgentSnapshot/
// compareMultiAgentReplay/scoreMultiAgentReplay/gateMultiAgentEval/
// reportMultiAgentEval: the impure disk-orchestrated wrapper around
// core/multi-agent/eval-replay.ts's pure 31-metric compare/score/gate/
// report + normalizeRun projection.
//
// MILESTONE 9. Byte-exact port of the impure half of the old build's
// src/multi-agent-eval.ts: snapshot/suite/comparison/score/gate/report
// file writes, target-path resolution, and — the load-bearing piece —
// replayMultiAgentSnapshot RE-DERIVING the projection from the raw
// baseline run state file rather than copying snapshot.normalized.
//
// BYTE-COMPAT / REBUILD RISK 5 [load-bearing]: see
// eval-replay-detects-drift.case.js.
//
// Evidence: SPEC/multi-agent.md section I, "Eval harness exact outputs";
// plugins/cool-workflow/src/multi-agent-eval.ts (byte-exact source for
// the wiring/resolution sequence).
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
exports.createMultiAgentReplaySnapshot = createMultiAgentReplaySnapshot;
exports.replayMultiAgentSnapshot = replayMultiAgentSnapshot;
exports.compareMultiAgentReplay = compareMultiAgentReplay;
exports.scoreMultiAgentReplay = scoreMultiAgentReplay;
exports.gateMultiAgentEval = gateMultiAgentEval;
exports.reportMultiAgentEval = reportMultiAgentEval;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fs_atomic_1 = require("./fs-atomic");
const run_store_1 = require("./run-store");
const ev = __importStar(require("../core/multi-agent/eval-replay"));
const trust_policy_io_1 = require("./trust-policy-io");
const topology_io_1 = require("./topology-io");
const multi_agent_io_1 = require("./multi-agent-io");
const evidence_reasoning_1 = require("./evidence-reasoning");
function now() {
    return new Date().toISOString();
}
function evalSuiteDir(cwd, suiteId) {
    return path.join(cwd, ".cw", "evals", (0, fs_atomic_1.safeFileName)(suiteId));
}
function resolveTargetPath(target) {
    if (!target)
        throw new Error("Missing eval target");
    return path.isAbsolute(target) ? target : path.resolve(target);
}
function resolveSnapshotPath(target) {
    const resolved = resolveTargetPath(target);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())
        return path.join(resolved, "snapshot.json");
    if (fs.existsSync(resolved))
        return resolved;
    return path.join(process.cwd(), ".cw", "evals", (0, fs_atomic_1.safeFileName)(target), "snapshot.json");
}
function resolveReplayPath(target) {
    const resolved = resolveTargetPath(target);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())
        return path.join(resolved, "replay-run.json");
    if (fs.existsSync(resolved))
        return resolved;
    return path.join(process.cwd(), ".cw", "evals", (0, fs_atomic_1.safeFileName)(target), "replay-run.json");
}
function resolveSuiteDir(target) {
    const resolved = resolveTargetPath(target);
    if (fs.existsSync(resolved)) {
        if (fs.statSync(resolved).isDirectory())
            return resolved;
        const value = (0, fs_atomic_1.readJson)(resolved);
        if (value.paths?.suiteDir)
            return value.paths.suiteDir;
        return path.dirname(resolved);
    }
    return path.join(process.cwd(), ".cw", "evals", (0, fs_atomic_1.safeFileName)(target));
}
function writeSuite(suite) {
    (0, fs_atomic_1.writeJson)(path.join(suite.paths.suiteDir, "suite.json"), suite);
}
function loadSuiteFromDir(suiteDir) {
    const suitePath = path.join(suiteDir, "suite.json");
    if (fs.existsSync(suitePath))
        return (0, fs_atomic_1.readJson)(suitePath);
    return { schemaVersion: 1, id: path.basename(suiteDir), title: `Multi-Agent Eval Suite ${path.basename(suiteDir)}`, createdAt: now(), cases: [], paths: { suiteDir, snapshotPath: path.join(suiteDir, "snapshot.json") } };
}
function reportSections(run) {
    if (!fs.existsSync(run.paths.report))
        return [];
    const text = fs.readFileSync(run.paths.report, "utf8");
    return text
        .split("\n")
        .filter((line) => /^#+\s+/.test(line))
        .map((line) => line.replace(/^#+\s+/, "").trim())
        .sort();
}
function collectCandidateScores(run) {
    const scores = [];
    const candidates = run.candidates || [];
    for (const candidate of candidates) {
        for (const scoreId of candidate.scores || []) {
            const scorePath = path.join(run.paths.candidatesDir || path.join(run.paths.runDir, "candidates"), (0, fs_atomic_1.safeFileName)(candidate.id), "scores", `${(0, fs_atomic_1.safeFileName)(scoreId)}.json`);
            if (fs.existsSync(scorePath)) {
                const score = (0, fs_atomic_1.readJson)(scorePath);
                scores.push({ candidateId: candidate.id, scoreId, criteria: score.criteria, total: score.total, maxTotal: score.maxTotal, normalized: score.normalized, verdict: score.verdict, evidenceCount: Array.isArray(score.evidence) ? score.evidence.length : 0, notes: score.notes });
            }
            else {
                scores.push({ candidateId: candidate.id, scoreId, missing: true });
            }
        }
    }
    return scores;
}
/** Minimal, real (non-operator-ux) dependency/failure derivation over
 *  multi-agent + trust state: one row per membership that has not yet
 *  reported, one row per policy violation. See core/multi-agent/eval-
 *  replay.ts's file header for why this milestone's normalizeRun scope
 *  is reduced from the full operator-ux module. */
function dependencyRows(run) {
    const multiAgent = run.multiAgent || {};
    return (multiAgent.memberships || []).map((membership) => ({ from: `${run.id}:multi-agent:group:${membership.groupId}`, to: `${run.id}:multi-agent:membership:${membership.id}`, label: "depends-on", status: membership.status }));
}
function failureRows(run) {
    const multiAgent = run.multiAgent || {};
    const rows = [];
    for (const membership of multiAgent.memberships || []) {
        if (membership.status === "failed")
            rows.push({ kind: "agent-membership", status: membership.status, owner: membership.id, reason: "failed membership" });
    }
    for (const fanin of multiAgent.fanins || []) {
        for (const reason of fanin.blockedReasons || [])
            rows.push({ kind: "fanin", status: "blocked", owner: fanin.id, reason });
    }
    // Plain single-agent pipeline path: a worker in a terminal non-verified
    // status (failed/rejected) is a failure row too, so a mutated raw
    // baseline state (see eval-replay-detects-drift.case.js) is visible
    // in the re-derived normalized projection, not just in multi-agent
    // state.
    for (const worker of run.workers || []) {
        if (worker.status === "failed" || worker.status === "rejected")
            rows.push({ kind: "worker", status: worker.status, owner: worker.id, reason: `worker ${worker.id} ${worker.status}` });
    }
    return rows;
}
/** Evidence adoption rows: one per candidate-selection's evidence
 *  (multi-agent path) PLUS one per accepted result node's evidence (the
 *  plain single-agent pipeline path, where there is no candidate/
 *  selection layer at all — see the file header's scope note: this
 *  keeps the section non-trivial for a completed `-q`/`--drive` run,
 *  matching the SPEC's own evidence-adoption model of "adopted through
 *  acceptance" for every accepted result). */
function evidenceAdoptionRows(run) {
    const selections = run.candidateSelections || [];
    const rows = [];
    for (const selection of selections) {
        for (const item of selection.evidence || [])
            rows.push({ ref: item.id, status: "adopted", adoptedBy: selection.candidateId });
    }
    for (const node of run.nodes || []) {
        if (node.kind !== "result")
            continue;
        for (const item of node.evidence || [])
            rows.push({ ref: item.id, status: "adopted", adoptedBy: node.id });
    }
    return rows;
}
function normalizeRun(run) {
    const trust = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    const blackboard = run.blackboard || {};
    const topologies = (0, topology_io_1.summarizeTopologies)(run);
    const multiAgentSummary = (0, multi_agent_io_1.summarizeMultiAgent)(run);
    const multiAgent = run.multiAgent || {};
    return {
        workflow: ev.normalizeValue({ id: run.workflow.id, appId: run.workflow.app?.id, appVersion: run.workflow.app?.version, taskCount: run.tasks.length }),
        topologyShape: ev.lines([
            topologies.active.map((entry) => ({ topologyId: entry.topologyId, status: entry.status, roleCount: entry.roles.length, groupCount: entry.groups.length, fanoutCount: entry.fanouts.length, faninCount: entry.fanins.length })),
            multiAgentSummary.groupsDetail,
        ]),
        roles: ev.lines(multiAgent.roles || []),
        groups: ev.lines(multiAgent.groups || []),
        memberships: ev.lines(multiAgent.memberships || []),
        fanouts: ev.lines(multiAgent.fanouts || []),
        fanins: ev.lines(multiAgent.fanins || []),
        dependencyEdges: ev.lines(dependencyRows(run)),
        failures: ev.lines(failureRows(run)),
        blackboardRecords: ev.lines([blackboard.boards || [], blackboard.topics || [], blackboard.messages || [], blackboard.contexts || [], blackboard.artifacts || [], blackboard.snapshots || [], blackboard.decisions || []]),
        messageProvenance: ev.lines(trust.messageProvenance || []),
        rolePolicies: ev.lines(trust.rolePolicies || []),
        permissionDecisions: ev.lines(trust.permissionDecisions || []),
        blackboardWriteAudit: ev.lines(trust.blackboardWrites || []),
        judgeRationales: ev.lines(trust.judgeRationales || []),
        panelDecisions: ev.lines(trust.panelDecisions || []),
        policyViolations: ev.lines(trust.policyViolations || []),
        evidenceAdoption: ev.lines(evidenceAdoptionRows(run)),
        candidateScores: ev.lines(collectCandidateScores(run)),
        selectedCandidates: ev.lines((run.candidateSelections || []).map((entry) => ({ candidateId: entry.candidateId, scoreId: entry.scoreId, verifierNodeId: entry.verifierNodeId, reason: entry.reason, evidenceCount: entry.evidence.length }))),
        verifierCommitGate: ev.lines((run.commits || []).map((entry) => ({ verifierGated: Boolean(entry.verifierGated), checkpoint: Boolean(entry.checkpoint), candidateId: entry.candidateId, selectionId: entry.selectionId, verifierNodeId: entry.verifierNodeId, evidenceCount: (entry.evidence || []).length }))),
        reportSections: reportSections(run),
        summaryFreshness: [],
        compactGraphShape: [],
        blackboardDigest: [],
        criticalPath: [],
        evidenceDigest: [],
        expansionRefs: [],
        ...(0, evidence_reasoning_1.normalizeEvidenceReasoningForEval)(run),
    };
}
function createMultiAgentReplaySnapshot(run, options = {}) {
    const id = (0, fs_atomic_1.safeFileName)(String(options.id || options.snapshot || `${run.id}-snapshot`));
    const suiteDir = evalSuiteDir(run.cwd, id);
    const snapshotPath = path.join(suiteDir, "snapshot.json");
    const snapshot = {
        schemaVersion: 1,
        kind: "multi-agent-replay-snapshot",
        id,
        createdAt: now(),
        runId: run.id,
        workflow: { id: run.workflow.id, appId: run.workflow.app?.id, appVersion: run.workflow.app?.version, title: run.workflow.title },
        inputs: ev.normalizeValue(run.inputs),
        paths: { suiteDir, snapshotPath, baselineStatePath: run.paths.state, reportPath: run.paths.report },
        normalized: normalizeRun(run),
    };
    (0, fs_atomic_1.writeJson)(snapshotPath, snapshot);
    writeSuite({ schemaVersion: 1, id, title: `Multi-Agent Eval Suite ${id}`, createdAt: snapshot.createdAt, cases: [{ id: `${id}-case`, snapshotId: id, baselinePath: snapshotPath, expectedVerdict: "pass" }], paths: { suiteDir, snapshotPath } });
    return snapshot;
}
function assertSnapshotShape(snapshot, file) {
    if (!snapshot.id)
        throw new Error(`Replay snapshot missing id: ${file}`);
    if (!snapshot.runId)
        throw new Error(`Replay snapshot missing runId: ${file}`);
    if (!snapshot.paths || !snapshot.paths.suiteDir || !snapshot.paths.snapshotPath)
        throw new Error(`Replay snapshot missing paths.suiteDir or paths.snapshotPath: ${file}`);
    ev.assertNormalizedShape(snapshot.normalized, `Replay snapshot missing normalized section: ${file}`);
}
function assertReplayShape(replay, file) {
    if (!replay.id)
        throw new Error(`Replay run missing id: ${file}`);
    if (!replay.snapshotId)
        throw new Error(`Replay run missing snapshotId: ${file}`);
    if (replay.status !== "completed" && replay.status !== "failed")
        throw new Error(`Replay run has unsupported status ${String(replay.status)}: ${file}`);
    if (!replay.paths || !replay.paths.suiteDir || !replay.paths.replayRunPath || !replay.paths.snapshotPath)
        throw new Error(`Replay run missing paths.suiteDir, paths.replayRunPath, or paths.snapshotPath: ${file}`);
    if (!Array.isArray(replay.errors))
        throw new Error(`Replay run errors must be an array: ${file}`);
    ev.assertNormalizedShape(replay.replay, `Replay run missing replay section: ${file}`);
}
function loadSnapshot(target) {
    const resolved = resolveSnapshotPath(target);
    if (!fs.existsSync(resolved))
        throw new Error(`File not found: ${resolved}`);
    const snapshot = (0, fs_atomic_1.readJson)(resolved);
    if (snapshot.kind !== "multi-agent-replay-snapshot")
        throw new Error(`Not a replay snapshot: ${resolved}`);
    assertSnapshotShape(snapshot, resolved);
    return snapshot;
}
/** RE-DERIVE the normalized projection from the raw captured state file
 *  instead of copying snapshot.normalized. Fail-closed: throws when the
 *  baseline state cannot be reconstructed. See file header, byte-compat
 *  / rebuild risk 5. */
function rederiveNormalizedFromSnapshot(snapshot) {
    const statePath = snapshot.paths.baselineStatePath;
    if (!statePath || !fs.existsSync(statePath)) {
        throw new Error(`Cannot re-derive replay projection: baseline run state missing at ${statePath || "<unset>"}; re-snapshot from a live run before replaying.`);
    }
    const result = (0, run_store_1.loadRunStateFile)(statePath, { dryRun: true });
    if (result.report.status === "unsupported") {
        throw new Error(`Cannot re-derive replay projection: baseline run state at ${statePath} is unsupported: ${result.report.errors.join("; ")}`);
    }
    return normalizeRun(result.run);
}
function replayMultiAgentSnapshot(target, options = {}) {
    if (!target)
        throw new Error("Missing snapshot id or path.");
    const snapshot = loadSnapshot(target);
    const replayId = (0, fs_atomic_1.safeFileName)(String(options.id || options.replay || `${snapshot.id}-replay`));
    const suiteDir = snapshot.paths.suiteDir;
    const replayDir = path.join(suiteDir, "replay");
    const replayRunPath = path.join(suiteDir, "replay-run.json");
    fs.mkdirSync(replayDir, { recursive: true });
    const replayed = rederiveNormalizedFromSnapshot(snapshot);
    const replay = {
        schemaVersion: 1,
        kind: "multi-agent-replay-run",
        id: replayId,
        snapshotId: snapshot.id,
        baselineRunId: snapshot.runId,
        replayedAt: now(),
        status: "completed",
        isolatedWorkspace: replayDir,
        paths: { suiteDir, replayDir, replayRunPath, snapshotPath: snapshot.paths.snapshotPath },
        replay: replayed,
        errors: [],
    };
    (0, fs_atomic_1.writeJson)(replayRunPath, replay);
    const suite = loadSuiteFromDir(suiteDir);
    suite.paths.replayRunPath = replayRunPath;
    suite.cases = suite.cases.map((entry) => (entry.snapshotId === snapshot.id ? { ...entry, replayRunId: replayId, replayPath: replayRunPath } : entry));
    writeSuite(suite);
    return replay;
}
function loadReplay(target) {
    const resolved = resolveReplayPath(target);
    if (!fs.existsSync(resolved))
        throw new Error(`File not found: ${resolved}`);
    const replay = (0, fs_atomic_1.readJson)(resolved);
    if (replay.kind !== "multi-agent-replay-run")
        throw new Error(`Not a replay run: ${resolved}`);
    assertReplayShape(replay, resolved);
    return replay;
}
function loadBaselineNormalized(target) {
    const snapshotPath = resolveSnapshotPath(target);
    if (!fs.existsSync(snapshotPath))
        throw new Error(`File not found: ${snapshotPath}`);
    const snapshot = (0, fs_atomic_1.readJson)(snapshotPath);
    if (snapshot.kind !== "multi-agent-replay-snapshot")
        throw new Error(`Not a replay snapshot: ${snapshotPath}`);
    assertSnapshotShape(snapshot, snapshotPath);
    return { id: snapshot.id, path: snapshotPath, normalized: snapshot.normalized };
}
function compareMultiAgentReplay(baselineTarget, replayTarget) {
    if (!baselineTarget)
        throw new Error("Missing baseline id or path.");
    const baseline = loadBaselineNormalized(baselineTarget);
    const replay = loadReplay(replayTarget);
    const suiteDir = replay.paths.suiteDir;
    const comparisonPath = path.join(suiteDir, "comparison.json");
    const findingsPath = path.join(suiteDir, "findings.json");
    const comparison = ev.compareNormalized(baseline.id, baseline.path, baseline.normalized, replay, now(), comparisonPath, findingsPath, suiteDir);
    (0, fs_atomic_1.writeJson)(comparisonPath, comparison);
    (0, fs_atomic_1.writeJson)(findingsPath, comparison.findings);
    const suite = loadSuiteFromDir(suiteDir);
    suite.paths.comparisonPath = comparisonPath;
    suite.paths.findingsPath = findingsPath;
    writeSuite(suite);
    return comparison;
}
function loadOrCompareForTarget(target) {
    const suiteDir = resolveSuiteDir(target);
    const comparisonPath = path.join(suiteDir, "comparison.json");
    const replayPath = resolveReplayPath(target);
    if (fs.existsSync(comparisonPath)) {
        const comparison = (0, fs_atomic_1.readJson)(comparisonPath);
        if (comparison.paths.replayPath === replayPath)
            return comparison;
    }
    return compareMultiAgentReplay(path.join(suiteDir, "snapshot.json"), replayPath);
}
function scoreMultiAgentReplay(target) {
    const comparison = loadOrCompareForTarget(target);
    const scorePath = path.join(comparison.paths.suiteDir, "score.json");
    const score = ev.scoreComparison(comparison, now(), scorePath);
    (0, fs_atomic_1.writeJson)(scorePath, score);
    const suite = loadSuiteFromDir(comparison.paths.suiteDir);
    suite.paths.scorePath = scorePath;
    writeSuite(suite);
    return score;
}
function loadScoreForTarget(target, scorePath) {
    const replayPath = resolveReplayPath(target);
    if (fs.existsSync(scorePath)) {
        const score = (0, fs_atomic_1.readJson)(scorePath);
        if (fs.existsSync(score.paths.comparisonPath)) {
            const comparison = (0, fs_atomic_1.readJson)(score.paths.comparisonPath);
            if (comparison.replayId === score.replayId && comparison.paths.replayPath === replayPath)
                return score;
        }
    }
    return scoreMultiAgentReplay(target);
}
function gateMultiAgentEval(target) {
    const suiteDir = resolveSuiteDir(target);
    const snapshotPath = path.join(suiteDir, "snapshot.json");
    const replayRunPath = path.join(suiteDir, "replay-run.json");
    const comparisonPath = path.join(suiteDir, "comparison.json");
    const scorePath = path.join(suiteDir, "score.json");
    const missing = [snapshotPath, replayRunPath, comparisonPath, scorePath].filter((file) => !fs.existsSync(file));
    if (missing.length)
        throw new Error(`Eval gate missing required artifact(s): ${missing.join(", ")}`);
    const comparison = (0, fs_atomic_1.readJson)(comparisonPath);
    const score = (0, fs_atomic_1.readJson)(scorePath);
    const report = reportMultiAgentEval(comparison.paths.replayPath);
    const gate = ev.buildGate(suiteDir, snapshotPath, replayRunPath, comparisonPath, scorePath, report.reportPath, comparison, score, now(), path.basename(suiteDir));
    (0, fs_atomic_1.writeJson)(path.join(suiteDir, "gate.json"), gate);
    return gate;
}
function reportMultiAgentEval(target) {
    const suiteDir = resolveSuiteDir(target);
    const scorePath = path.join(suiteDir, "score.json");
    const score = loadScoreForTarget(target, scorePath);
    const reportPath = path.join(suiteDir, "report.md");
    const lines = ev.buildReportLines(path.basename(suiteDir), score);
    fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
    const suite = loadSuiteFromDir(suiteDir);
    suite.paths.reportPath = reportPath;
    writeSuite(suite);
    return { schemaVersion: 1, replayId: score.replayId, status: score.status, reportPath, score: score.score, maxScore: score.maxScore, findings: score.findings };
}
