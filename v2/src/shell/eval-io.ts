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

import * as fs from "node:fs";
import * as path from "node:path";
import { readJson, safeFileName, writeJson } from "./fs-atomic";
import { loadRunStateFile } from "./run-store";
import { WorkflowRun } from "../core/state/types";
import * as ev from "../core/multi-agent/eval-replay";
import { summarizeMultiAgentTrust } from "./trust-policy-io";
import { summarizeTopologies } from "./topology-io";
import { summarizeMultiAgent } from "./multi-agent-io";

function now(): string {
  return new Date().toISOString();
}

function evalSuiteDir(cwd: string, suiteId: string): string {
  return path.join(cwd, ".cw", "evals", safeFileName(suiteId));
}

function resolveTargetPath(target: string): string {
  if (!target) throw new Error("Missing eval target");
  return path.isAbsolute(target) ? target : path.resolve(target);
}

function resolveSnapshotPath(target: string): string {
  const resolved = resolveTargetPath(target);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return path.join(resolved, "snapshot.json");
  if (fs.existsSync(resolved)) return resolved;
  return path.join(process.cwd(), ".cw", "evals", safeFileName(target), "snapshot.json");
}

function resolveReplayPath(target: string): string {
  const resolved = resolveTargetPath(target);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return path.join(resolved, "replay-run.json");
  if (fs.existsSync(resolved)) return resolved;
  return path.join(process.cwd(), ".cw", "evals", safeFileName(target), "replay-run.json");
}

function resolveSuiteDir(target: string): string {
  const resolved = resolveTargetPath(target);
  if (fs.existsSync(resolved)) {
    if (fs.statSync(resolved).isDirectory()) return resolved;
    const value = readJson(resolved) as { paths?: { suiteDir?: string } };
    if (value.paths?.suiteDir) return value.paths.suiteDir;
    return path.dirname(resolved);
  }
  return path.join(process.cwd(), ".cw", "evals", safeFileName(target));
}

function writeSuite(suite: ev.MultiAgentEvalSuite): void {
  writeJson(path.join(suite.paths.suiteDir, "suite.json"), suite);
}

function loadSuiteFromDir(suiteDir: string): ev.MultiAgentEvalSuite {
  const suitePath = path.join(suiteDir, "suite.json");
  if (fs.existsSync(suitePath)) return readJson(suitePath) as ev.MultiAgentEvalSuite;
  return { schemaVersion: 1, id: path.basename(suiteDir), title: `Multi-Agent Eval Suite ${path.basename(suiteDir)}`, createdAt: now(), cases: [], paths: { suiteDir, snapshotPath: path.join(suiteDir, "snapshot.json") } };
}

function reportSections(run: WorkflowRun): string[] {
  if (!fs.existsSync(run.paths.report)) return [];
  const text = fs.readFileSync(run.paths.report, "utf8");
  return text
    .split("\n")
    .filter((line) => /^#+\s+/.test(line))
    .map((line) => line.replace(/^#+\s+/, "").trim())
    .sort();
}

function collectCandidateScores(run: WorkflowRun): unknown[] {
  const scores: unknown[] = [];
  const candidates = (run.candidates as Array<{ id: string; scores?: string[] }> | undefined) || [];
  for (const candidate of candidates) {
    for (const scoreId of candidate.scores || []) {
      const scorePath = path.join(run.paths.candidatesDir || path.join(run.paths.runDir, "candidates"), safeFileName(candidate.id), "scores", `${safeFileName(scoreId)}.json`);
      if (fs.existsSync(scorePath)) {
        const score = readJson(scorePath) as Record<string, unknown>;
        scores.push({ candidateId: candidate.id, scoreId, criteria: score.criteria, total: score.total, maxTotal: score.maxTotal, normalized: score.normalized, verdict: score.verdict, evidenceCount: Array.isArray(score.evidence) ? score.evidence.length : 0, notes: score.notes });
      } else {
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
function dependencyRows(run: WorkflowRun): Array<{ from: string; to: string; label: string; status: string }> {
  const multiAgent = (run.multiAgent as { memberships?: Array<{ id: string; groupId: string; status: string }> } | undefined) || {};
  return (multiAgent.memberships || []).map((membership) => ({ from: `${run.id}:multi-agent:group:${membership.groupId}`, to: `${run.id}:multi-agent:membership:${membership.id}`, label: "depends-on", status: membership.status }));
}

function failureRows(run: WorkflowRun): Array<{ kind: string; status: string; owner: string; reason: string }> {
  const multiAgent = (run.multiAgent as { memberships?: Array<{ id: string; status: string }>; fanins?: Array<{ id: string; blockedReasons: string[] }> } | undefined) || {};
  const rows: Array<{ kind: string; status: string; owner: string; reason: string }> = [];
  for (const membership of multiAgent.memberships || []) {
    if (membership.status === "failed") rows.push({ kind: "agent-membership", status: membership.status, owner: membership.id, reason: "failed membership" });
  }
  for (const fanin of multiAgent.fanins || []) {
    for (const reason of fanin.blockedReasons || []) rows.push({ kind: "fanin", status: "blocked", owner: fanin.id, reason });
  }
  // Plain single-agent pipeline path: a worker in a terminal non-verified
  // status (failed/rejected) is a failure row too, so a mutated raw
  // baseline state (see eval-replay-detects-drift.case.js) is visible
  // in the re-derived normalized projection, not just in multi-agent
  // state.
  for (const worker of (run.workers as Array<{ id: string; status: string }> | undefined) || []) {
    if (worker.status === "failed" || worker.status === "rejected") rows.push({ kind: "worker", status: worker.status, owner: worker.id, reason: `worker ${worker.id} ${worker.status}` });
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
function evidenceAdoptionRows(run: WorkflowRun): Array<{ ref: string; status: string; adoptedBy?: string }> {
  const selections = (run.candidateSelections as Array<{ candidateId: string; evidence?: Array<{ id: string }> }> | undefined) || [];
  const rows: Array<{ ref: string; status: string; adoptedBy?: string }> = [];
  for (const selection of selections) {
    for (const item of selection.evidence || []) rows.push({ ref: item.id, status: "adopted", adoptedBy: selection.candidateId });
  }
  for (const node of run.nodes || []) {
    if (node.kind !== "result") continue;
    for (const item of node.evidence || []) rows.push({ ref: item.id, status: "adopted", adoptedBy: node.id });
  }
  return rows;
}

function normalizeRun(run: WorkflowRun): ev.MultiAgentEvalNormalized {
  const trust = summarizeMultiAgentTrust(run);
  const blackboard = (run.blackboard as { boards?: unknown[]; topics?: unknown[]; messages?: unknown[]; contexts?: unknown[]; artifacts?: unknown[]; snapshots?: unknown[]; decisions?: unknown[] } | undefined) || {};
  const topologies = summarizeTopologies(run);
  const multiAgentSummary = summarizeMultiAgent(run);
  const multiAgent = (run.multiAgent as { roles?: unknown[]; groups?: unknown[]; memberships?: unknown[]; fanouts?: unknown[]; fanins?: unknown[] } | undefined) || {};
  return {
    workflow: ev.normalizeValue({ id: run.workflow.id, appId: (run.workflow.app as { id?: string } | undefined)?.id, appVersion: (run.workflow.app as { version?: string } | undefined)?.version, taskCount: run.tasks.length }) as Record<string, unknown>,
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
    selectedCandidates: ev.lines(((run.candidateSelections as Array<{ candidateId: string; scoreId?: string; verifierNodeId?: string; reason: string; evidence: unknown[] }> | undefined) || []).map((entry) => ({ candidateId: entry.candidateId, scoreId: entry.scoreId, verifierNodeId: entry.verifierNodeId, reason: entry.reason, evidenceCount: entry.evidence.length }))),
    verifierCommitGate: ev.lines((run.commits || []).map((entry) => ({ verifierGated: Boolean(entry.verifierGated), checkpoint: Boolean(entry.checkpoint), candidateId: entry.candidateId, selectionId: entry.selectionId, verifierNodeId: entry.verifierNodeId, evidenceCount: (entry.evidence || []).length }))),
    reportSections: reportSections(run),
    summaryFreshness: [],
    compactGraphShape: [],
    blackboardDigest: [],
    criticalPath: [],
    evidenceDigest: [],
    expansionRefs: [],
    reasoningFreshness: [],
    reasoningChains: [],
    reasoningUnexplained: [],
  };
}

export function createMultiAgentReplaySnapshot(run: WorkflowRun, options: Record<string, unknown> = {}): ev.MultiAgentReplaySnapshot {
  const id = safeFileName(String(options.id || options.snapshot || `${run.id}-snapshot`));
  const suiteDir = evalSuiteDir(run.cwd, id);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const snapshot: ev.MultiAgentReplaySnapshot = {
    schemaVersion: 1,
    kind: "multi-agent-replay-snapshot",
    id,
    createdAt: now(),
    runId: run.id,
    workflow: { id: run.workflow.id, appId: (run.workflow.app as { id?: string } | undefined)?.id, appVersion: (run.workflow.app as { version?: string } | undefined)?.version, title: run.workflow.title },
    inputs: ev.normalizeValue(run.inputs) as Record<string, unknown>,
    paths: { suiteDir, snapshotPath, baselineStatePath: run.paths.state, reportPath: run.paths.report },
    normalized: normalizeRun(run),
  };
  writeJson(snapshotPath, snapshot);
  writeSuite({ schemaVersion: 1, id, title: `Multi-Agent Eval Suite ${id}`, createdAt: snapshot.createdAt, cases: [{ id: `${id}-case`, snapshotId: id, baselinePath: snapshotPath, expectedVerdict: "pass" }], paths: { suiteDir, snapshotPath } });
  return snapshot;
}

function assertSnapshotShape(snapshot: ev.MultiAgentReplaySnapshot, file: string): void {
  if (!snapshot.id) throw new Error(`Replay snapshot missing id: ${file}`);
  if (!snapshot.runId) throw new Error(`Replay snapshot missing runId: ${file}`);
  if (!snapshot.paths || !snapshot.paths.suiteDir || !snapshot.paths.snapshotPath) throw new Error(`Replay snapshot missing paths.suiteDir or paths.snapshotPath: ${file}`);
  ev.assertNormalizedShape(snapshot.normalized, `Replay snapshot missing normalized section: ${file}`);
}

function assertReplayShape(replay: ev.MultiAgentReplayRun, file: string): void {
  if (!replay.id) throw new Error(`Replay run missing id: ${file}`);
  if (!replay.snapshotId) throw new Error(`Replay run missing snapshotId: ${file}`);
  if (replay.status !== "completed" && replay.status !== "failed") throw new Error(`Replay run has unsupported status ${String(replay.status)}: ${file}`);
  if (!replay.paths || !replay.paths.suiteDir || !replay.paths.replayRunPath || !replay.paths.snapshotPath) throw new Error(`Replay run missing paths.suiteDir, paths.replayRunPath, or paths.snapshotPath: ${file}`);
  if (!Array.isArray(replay.errors)) throw new Error(`Replay run errors must be an array: ${file}`);
  ev.assertNormalizedShape(replay.replay, `Replay run missing replay section: ${file}`);
}

function loadSnapshot(target: string): ev.MultiAgentReplaySnapshot {
  const resolved = resolveSnapshotPath(target);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const snapshot = readJson(resolved) as ev.MultiAgentReplaySnapshot;
  if (snapshot.kind !== "multi-agent-replay-snapshot") throw new Error(`Not a replay snapshot: ${resolved}`);
  assertSnapshotShape(snapshot, resolved);
  return snapshot;
}

/** RE-DERIVE the normalized projection from the raw captured state file
 *  instead of copying snapshot.normalized. Fail-closed: throws when the
 *  baseline state cannot be reconstructed. See file header, byte-compat
 *  / rebuild risk 5. */
function rederiveNormalizedFromSnapshot(snapshot: ev.MultiAgentReplaySnapshot): ev.MultiAgentEvalNormalized {
  const statePath = snapshot.paths.baselineStatePath;
  if (!statePath || !fs.existsSync(statePath)) {
    throw new Error(`Cannot re-derive replay projection: baseline run state missing at ${statePath || "<unset>"}; re-snapshot from a live run before replaying.`);
  }
  const result = loadRunStateFile(statePath, { dryRun: true });
  if (result.report.status === "unsupported") {
    throw new Error(`Cannot re-derive replay projection: baseline run state at ${statePath} is unsupported: ${result.report.errors.join("; ")}`);
  }
  return normalizeRun(result.run);
}

export function replayMultiAgentSnapshot(target: string, options: Record<string, unknown> = {}): ev.MultiAgentReplayRun {
  if (!target) throw new Error("Missing snapshot id or path.");
  const snapshot = loadSnapshot(target);
  const replayId = safeFileName(String(options.id || options.replay || `${snapshot.id}-replay`));
  const suiteDir = snapshot.paths.suiteDir;
  const replayDir = path.join(suiteDir, "replay");
  const replayRunPath = path.join(suiteDir, "replay-run.json");
  fs.mkdirSync(replayDir, { recursive: true });
  const replayed = rederiveNormalizedFromSnapshot(snapshot);
  const replay: ev.MultiAgentReplayRun = {
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
  writeJson(replayRunPath, replay);
  const suite = loadSuiteFromDir(suiteDir);
  suite.paths.replayRunPath = replayRunPath;
  suite.cases = suite.cases.map((entry) => (entry.snapshotId === snapshot.id ? { ...entry, replayRunId: replayId, replayPath: replayRunPath } : entry));
  writeSuite(suite);
  return replay;
}

function loadReplay(target: string): ev.MultiAgentReplayRun {
  const resolved = resolveReplayPath(target);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const replay = readJson(resolved) as ev.MultiAgentReplayRun;
  if (replay.kind !== "multi-agent-replay-run") throw new Error(`Not a replay run: ${resolved}`);
  assertReplayShape(replay, resolved);
  return replay;
}

function loadBaselineNormalized(target: string): { id: string; path: string; normalized: ev.MultiAgentEvalNormalized } {
  const snapshotPath = resolveSnapshotPath(target);
  if (!fs.existsSync(snapshotPath)) throw new Error(`File not found: ${snapshotPath}`);
  const snapshot = readJson(snapshotPath) as ev.MultiAgentReplaySnapshot;
  if (snapshot.kind !== "multi-agent-replay-snapshot") throw new Error(`Not a replay snapshot: ${snapshotPath}`);
  assertSnapshotShape(snapshot, snapshotPath);
  return { id: snapshot.id, path: snapshotPath, normalized: snapshot.normalized };
}

export function compareMultiAgentReplay(baselineTarget: string, replayTarget: string): ev.MultiAgentEvalComparison {
  if (!baselineTarget) throw new Error("Missing baseline id or path.");
  const baseline = loadBaselineNormalized(baselineTarget);
  const replay = loadReplay(replayTarget);
  const suiteDir = replay.paths.suiteDir;
  const comparisonPath = path.join(suiteDir, "comparison.json");
  const findingsPath = path.join(suiteDir, "findings.json");
  const comparison = ev.compareNormalized(baseline.id, baseline.path, baseline.normalized, replay, now(), comparisonPath, findingsPath, suiteDir);
  writeJson(comparisonPath, comparison);
  writeJson(findingsPath, comparison.findings);
  const suite = loadSuiteFromDir(suiteDir);
  suite.paths.comparisonPath = comparisonPath;
  suite.paths.findingsPath = findingsPath;
  writeSuite(suite);
  return comparison;
}

function loadOrCompareForTarget(target: string): ev.MultiAgentEvalComparison {
  const suiteDir = resolveSuiteDir(target);
  const comparisonPath = path.join(suiteDir, "comparison.json");
  const replayPath = resolveReplayPath(target);
  if (fs.existsSync(comparisonPath)) {
    const comparison = readJson(comparisonPath) as ev.MultiAgentEvalComparison;
    if (comparison.paths.replayPath === replayPath) return comparison;
  }
  return compareMultiAgentReplay(path.join(suiteDir, "snapshot.json"), replayPath);
}

export function scoreMultiAgentReplay(target: string): ev.MultiAgentEvalScore {
  const comparison = loadOrCompareForTarget(target);
  const scorePath = path.join(comparison.paths.suiteDir, "score.json");
  const score = ev.scoreComparison(comparison, now(), scorePath);
  writeJson(scorePath, score);
  const suite = loadSuiteFromDir(comparison.paths.suiteDir);
  suite.paths.scorePath = scorePath;
  writeSuite(suite);
  return score;
}

function loadScoreForTarget(target: string, scorePath: string): ev.MultiAgentEvalScore {
  const replayPath = resolveReplayPath(target);
  if (fs.existsSync(scorePath)) {
    const score = readJson(scorePath) as ev.MultiAgentEvalScore;
    if (fs.existsSync(score.paths.comparisonPath)) {
      const comparison = readJson(score.paths.comparisonPath) as ev.MultiAgentEvalComparison;
      if (comparison.replayId === score.replayId && comparison.paths.replayPath === replayPath) return score;
    }
  }
  return scoreMultiAgentReplay(target);
}

export function gateMultiAgentEval(target: string): ev.MultiAgentEvalGate {
  const suiteDir = resolveSuiteDir(target);
  const snapshotPath = path.join(suiteDir, "snapshot.json");
  const replayRunPath = path.join(suiteDir, "replay-run.json");
  const comparisonPath = path.join(suiteDir, "comparison.json");
  const scorePath = path.join(suiteDir, "score.json");
  const missing = [snapshotPath, replayRunPath, comparisonPath, scorePath].filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`Eval gate missing required artifact(s): ${missing.join(", ")}`);
  const comparison = readJson(comparisonPath) as ev.MultiAgentEvalComparison;
  const score = readJson(scorePath) as ev.MultiAgentEvalScore;
  const report = reportMultiAgentEval(comparison.paths.replayPath);
  const gate = ev.buildGate(suiteDir, snapshotPath, replayRunPath, comparisonPath, scorePath, report.reportPath, comparison, score, now(), path.basename(suiteDir));
  writeJson(path.join(suiteDir, "gate.json"), gate);
  return gate;
}

export function reportMultiAgentEval(target: string): ev.MultiAgentEvalReport {
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
