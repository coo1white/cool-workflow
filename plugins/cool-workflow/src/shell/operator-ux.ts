// shell/operator-ux.ts — the operator console surface: `cw status`,
// `cw graph`, `cw operator status|report|graph`.
//
// MILESTONE 11 (reporting/observability). A scoped-but-real port of the
// old build's src/operator-ux.ts + src/orchestrator/report.ts's
// `summarizeRun`: every summary here reads real run state through the
// same summarizers report.ts and the multi-agent/candidate/trust shell
// modules already use (no duplicate logic, no fabricated fields). The
// old build's deeper multi-agent-operator-ux / topology-trust cross-
// summaries are folded in at a scoped level sufficient for this
// milestone's conformance surface (candidates/feedback/commits/trust/
// nextActions on `operator status`, the deterministic run graph) rather
// than ported in full — a later milestone can extend these without
// changing this file's exported shapes.
//
// Evidence: SPEC/reporting-ux.md "Operator UX human text", "Exit codes";
// plugins/cool-workflow/src/operator-ux.ts:1-788,
// plugins/cool-workflow/src/orchestrator/report.ts:120-149 (byte-exact
// source for the ported pieces).

import * as path from "node:path";
import { WorkflowRun, RunTask, RunPhase, StateCommit, TaskStatus } from "../core/state/types";
import { WorkerScope } from "./worker-isolation";
import { updatePhaseStatuses } from "../core/pipeline/dispatch";
import { summarizeCandidates as summarizeCandidatesCounts, listCandidates } from "./candidate-scoring-io";
import { summarizeTrustAudit, TrustAuditSummary } from "./trust-audit";
import { summarizeMultiAgent } from "./multi-agent-io";
import { summarizeBlackboard } from "./coordinator-io";

export interface OperatorRecommendation {
  command: string;
  reason: string;
  priority: "high" | "normal" | "low";
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  app?: unknown;
  phases: RunPhase[];
  tasks: { total: number; pending: number; running: number; failed: number; completed: number };
  loopStage: string;
  durationMs?: number;
  progressPercent: number;
  next: string | null;
  reportPath: string;
  commits: StateCommit[];
  workers: { total: number; byStatus: Record<string, number> };
}

function countBy<T>(values: T[], key: (v: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] || 0) + 1;
  return counts;
}

function firstRunnablePhase(run: WorkflowRun): RunPhase | undefined {
  return run.phases.find((phase) => phase.status === "pending" || phase.status === "running");
}

function summarizeWorkersCounts(run: WorkflowRun): { total: number; byStatus: Record<string, number> } {
  const workers = (run.workers as unknown as WorkerScope[]) || [];
  return { total: workers.length, byStatus: countBy(workers, (w) => w.status) };
}

/** `summarizeRun` — byte-exact port of the old build's
 *  src/orchestrator/report.ts:120-149. Used by `cw status <id> --json`
 *  and `cw report <id>`'s internals. */
export function summarizeRun(run: WorkflowRun): RunSummary {
  updatePhaseStatuses(run);
  const workerSummary = summarizeWorkersCounts(run);
  const createdAtMs = Date.parse(run.createdAt);
  const updatedAtMs = Date.parse(run.updatedAt);
  const durationMs = Number.isFinite(createdAtMs) && Number.isFinite(updatedAtMs) ? Math.max(0, updatedAtMs - createdAtMs) : undefined;
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    app: run.workflow.app,
    phases: run.phases,
    tasks: {
      total: run.tasks.length,
      pending: run.tasks.filter((t) => t.status === "pending").length,
      running: run.tasks.filter((t) => t.status === "running").length,
      failed: run.tasks.filter((t) => t.status === "failed").length,
      completed: run.tasks.filter((t) => t.status === "completed").length,
    },
    loopStage: run.loopStage,
    durationMs,
    progressPercent: run.tasks.length ? Math.round((run.tasks.filter((t) => t.status === "completed").length / run.tasks.length) * 100) : 0,
    next: firstRunnablePhase(run)?.name || null,
    reportPath: run.paths.report,
    commits: run.commits,
    workers: workerSummary,
  };
}

/** `cw status` with no run id: the fixed advice (byte-exact to the old
 *  build's adviseNoRun). */
export function adviseNoRun(): OperatorRecommendation[] {
  return [
    {
      command: "node scripts/cw.js plan <workflow-id> --repo <path>",
      reason: "No run id is available yet; create a workflow run before dispatching or recording evidence.",
      priority: "high",
    },
  ];
}

export interface OperatorPhaseSummary {
  id: string;
  name: string;
  status: string;
  tasks: { total: number } & Record<string, number>;
}

function summarizePhases(run: WorkflowRun): OperatorPhaseSummary[] {
  return run.phases.map((phase) => {
    const phaseTasks = run.tasks.filter((t) => phase.taskIds.includes(t.id));
    const byStatus = countBy(phaseTasks, (t) => t.status);
    return { id: phase.id, name: phase.name, status: phase.status, tasks: { total: phaseTasks.length, ...byStatus } };
  });
}

export interface OperatorTaskSummary {
  total: number;
  byStatus: Record<string, number>;
  pending: string[];
  running: string[];
  failed: string[];
  completed: string[];
}

function summarizeTasks(tasks: RunTask[]): OperatorTaskSummary {
  const byId = (status: TaskStatus) => tasks.filter((t) => t.status === status).map((t) => t.id);
  return {
    total: tasks.length,
    byStatus: countBy(tasks, (t) => t.status),
    pending: byId("pending"),
    running: byId("running"),
    failed: byId("failed"),
    completed: byId("completed"),
  };
}

export interface OperatorCandidateSummary {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  selections: number;
  indexPath: string;
  rankingPath: string;
}

function summarizeOperatorCandidates(run: WorkflowRun): OperatorCandidateSummary {
  return summarizeCandidatesCounts(run);
}

export interface OperatorFeedbackSummary {
  total: number;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  byClassification: Record<string, number>;
}

function summarizeOperatorFeedback(run: WorkflowRun): OperatorFeedbackSummary {
  const records = (run.feedback || []) as Array<{ status: string; severity: string; classification: string }>;
  return {
    total: records.length,
    byStatus: countBy(records, (r) => r.status),
    bySeverity: countBy(records, (r) => r.severity),
    byClassification: countBy(records, (r) => r.classification),
  };
}

export interface OperatorCommitSummary {
  total: number;
  verifierGated: number;
  checkpoints: number;
  latest?: StateCommit;
  commits: StateCommit[];
}

function summarizeOperatorCommits(run: WorkflowRun): OperatorCommitSummary {
  const commits = [...(run.commits || [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return {
    total: commits.length,
    verifierGated: commits.filter((c) => c.verifierGated).length,
    checkpoints: commits.filter((c) => !c.verifierGated).length,
    latest: commits.at(-1),
    commits,
  };
}

export interface OperatorWorkerSummary {
  total: number;
  byStatus: Record<string, number>;
  workers: Array<{ id: string; taskId: string; status: string; manifestPath?: string; resultPath?: string }>;
}

function summarizeOperatorWorkers(run: WorkflowRun): OperatorWorkerSummary {
  const workers = ((run.workers as unknown as WorkerScope[]) || []).slice().sort((a, b) => a.id.localeCompare(b.id));
  return {
    total: workers.length,
    byStatus: countBy(workers, (w) => w.status),
    workers: workers.map((w) => ({ id: w.id, taskId: w.taskId, status: w.status, manifestPath: w.workerDir, resultPath: w.resultPath })),
  };
}

/** Next-action advice: a scoped-but-real subset of the old build's
 *  priority-ordered advice ladder (open feedback -> failed worker ->
 *  running tasks -> pending tasks -> ready-for-commit -> fallback
 *  `report --show`). */
function adviseNextSteps(run: WorkflowRun, ctx: { tasks: OperatorTaskSummary; workers: OperatorWorkerSummary; feedback: OperatorFeedbackSummary }): OperatorRecommendation[] {
  const actions: OperatorRecommendation[] = [];
  if (ctx.feedback.total > (run.feedback ? 0 : 0) && (ctx.feedback.byStatus.open || 0) > 0) {
    actions.push({ command: `node scripts/cw.js feedback list ${run.id}`, reason: "Open feedback needs a decision before the run can proceed.", priority: "high" });
  }
  const failedWorker = ctx.workers.workers.find((w) => w.status === "failed" || w.status === "rejected");
  if (failedWorker) {
    actions.push({ command: `node scripts/cw.js worker show ${run.id} --worker-id ${failedWorker.id}`, reason: `Worker ${failedWorker.id} failed and needs attention.`, priority: "high" });
  }
  if (ctx.tasks.running.length) {
    actions.push({ command: `node scripts/cw.js status ${run.id}`, reason: "Tasks are running; check back for completion.", priority: "normal" });
  }
  if (ctx.tasks.pending.length) {
    actions.push({ command: `node scripts/cw.js dispatch ${run.id} --limit 1`, reason: "Pending tasks are ready to dispatch.", priority: "normal" });
  }
  if (!actions.length) {
    const allComplete = run.tasks.length > 0 && run.tasks.every((t) => t.status === "completed");
    if (allComplete) {
      actions.push({ command: `node scripts/cw.js report ${run.id} --show`, reason: "All tasks are complete; review the full report.", priority: "normal" });
    } else {
      actions.push({ command: `node scripts/cw.js status ${run.id}`, reason: "Check the current run status.", priority: "low" });
    }
  }
  return actions;
}

export interface OperatorRunSummary {
  runId: string;
  workflowId: string;
  workflowTitle: string;
  appId?: string;
  appVersion?: string;
  loopStage: string;
  activePhase?: string;
  blocked: boolean;
  blockedReasons: string[];
  phases: OperatorPhaseSummary[];
  tasks: OperatorTaskSummary;
  workers: OperatorWorkerSummary;
  candidates: OperatorCandidateSummary;
  feedback: OperatorFeedbackSummary;
  commits: OperatorCommitSummary;
  multiAgent: ReturnType<typeof summarizeMultiAgent>;
  blackboard: ReturnType<typeof summarizeBlackboard>;
  trust: TrustAuditSummary;
  reportPath: string;
  nextActions: OperatorRecommendation[];
}

/** `cw operator status <id> --json` — a wider payload than `summarizeRun`
 *  (different capability, per SPEC/reporting-ux.md: "cw operator status
 *  <id> --json is a DIFFERENT, wider payload than cw status --json"). */
export function summarizeOperatorRun(run: WorkflowRun): OperatorRunSummary {
  updatePhaseStatuses(run);
  const app = run.workflow.app as { id?: string; version?: string } | undefined;
  const phases = summarizePhases(run);
  const tasks = summarizeTasks(run.tasks);
  const workers = summarizeOperatorWorkers(run);
  const candidates = summarizeOperatorCandidates(run);
  const feedback = summarizeOperatorFeedback(run);
  const commits = summarizeOperatorCommits(run);
  const multiAgent = summarizeMultiAgent(run);
  const blackboard = summarizeBlackboard(run);
  const trust = summarizeTrustAudit(run);
  const activePhase = phases.find((p) => p.status === "running") || phases.find((p) => p.status === "pending");
  const blockedReasons: string[] = [];
  for (const worker of workers.workers) {
    if (worker.status === "failed" || worker.status === "rejected") blockedReasons.push(`worker ${worker.id} ${worker.status}`);
  }
  return {
    runId: run.id,
    workflowId: run.workflow.id,
    workflowTitle: run.workflow.title,
    appId: app?.id,
    appVersion: app?.version,
    loopStage: run.loopStage,
    activePhase: activePhase?.name,
    blocked: blockedReasons.length > 0,
    blockedReasons,
    phases,
    tasks,
    workers,
    candidates,
    feedback,
    commits,
    multiAgent,
    blackboard,
    trust,
    reportPath: run.paths.report,
    nextActions: adviseNextSteps(run, { tasks, workers, feedback }),
  };
}

export interface OperatorGraphNode {
  id: string;
  kind: string;
  status: string;
  label: string;
  path?: string;
}
export interface OperatorGraphEdge {
  from: string;
  to: string;
  label?: string;
}
export interface OperatorGraph {
  runId: string;
  nodes: OperatorGraphNode[];
  edges: OperatorGraphEdge[];
}

function workerManifestPath(worker: WorkerScope): string {
  return path.join(worker.workerDir, "manifest.json");
}

/** `cw graph <id>` — a scoped-but-real port of the old build's
 *  buildOperatorGraph. Nodes/edges sort deterministically (kind then id
 *  for nodes; from/to/label for edges, de-duplicated), per SPEC/
 *  reporting-ux.md invariant 12. */
export function buildOperatorGraph(run: WorkflowRun): OperatorGraph {
  const nodes = new Map<string, OperatorGraphNode>();
  const edgeKeys = new Set<string>();
  const edges: OperatorGraphEdge[] = [];
  const addNode = (id: string, kind: string, status: string, label: string, pathValue?: string): void => {
    nodes.set(id, { id, kind, status, label, path: pathValue });
  };
  const addEdge = (from: string | undefined, to: string | undefined, label?: string): void => {
    if (!from || !to) return;
    const key = `${from} ${to} ${label || ""}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, label });
  };

  addNode(`${run.id}:run`, "run", run.loopStage, run.id, run.paths.state);
  for (const phase of run.phases || []) {
    const phaseId = `${run.id}:phase:${phase.id}`;
    addNode(phaseId, "phase", phase.status, phase.name);
    addEdge(`${run.id}:run`, phaseId);
    for (const taskId of phase.taskIds) addEdge(phaseId, `${run.id}:task:${taskId}`);
  }
  for (const task of run.tasks || []) {
    addNode(`${run.id}:task:${task.id}`, "task", task.status, task.id, task.taskPath);
    if (task.dispatchId) addEdge(`${run.id}:task:${task.id}`, `${run.id}:dispatch:${task.dispatchId}`);
    if (task.resultNodeId) addEdge(`${run.id}:task:${task.id}`, task.resultNodeId);
    if (task.verifierNodeId) addEdge(`${run.id}:task:${task.id}`, task.verifierNodeId);
  }
  for (const dispatch of run.dispatches || []) {
    addNode(`${run.id}:dispatch:${dispatch.id}`, "dispatch", "completed", dispatch.id, dispatch.manifestPath);
    for (const workerId of dispatch.workerIds || []) addEdge(`${run.id}:dispatch:${dispatch.id}`, `${run.id}:worker:${workerId}`);
  }
  for (const workerRaw of run.workers || []) {
    const worker = workerRaw as unknown as WorkerScope;
    addNode(`${run.id}:worker:${worker.id}`, "worker", worker.status, worker.id, workerManifestPath(worker));
    if (worker.resultNodeId) addEdge(`${run.id}:worker:${worker.id}`, worker.resultNodeId);
    for (const feedbackId of worker.feedbackIds || []) addEdge(`${run.id}:worker:${worker.id}`, `${run.id}:feedback:${feedbackId}`);
  }
  for (const candidate of listCandidates(run)) {
    addNode(`${run.id}:candidate:${candidate.id}`, "candidate", candidate.status, candidate.id, candidate.resultPath);
    if (candidate.resultNodeId) addEdge(candidate.resultNodeId, `${run.id}:candidate:${candidate.id}`);
    if (candidate.verifierNodeId) addEdge(candidate.verifierNodeId, `${run.id}:candidate:${candidate.id}`, "gate");
    for (const feedbackId of candidate.feedbackIds || []) addEdge(`${run.id}:candidate:${candidate.id}`, `${run.id}:feedback:${feedbackId}`);
  }
  for (const selectionRaw of run.candidateSelections || []) {
    const selection = selectionRaw as { id: string; candidateId: string; verifierNodeId?: string; rankingPath?: string };
    addNode(`${run.id}:selection:${selection.id}`, "selection", "verified", selection.id, selection.rankingPath);
    addEdge(`${run.id}:candidate:${selection.candidateId}`, `${run.id}:selection:${selection.id}`);
    if (selection.verifierNodeId) addEdge(selection.verifierNodeId, `${run.id}:selection:${selection.id}`, "verifier");
  }
  for (const commit of run.commits || []) {
    const commitNodeId = commit.stateNodeId || `${run.id}:commit:${commit.id}`;
    addNode(commitNodeId, "commit", commit.verifierGated ? "committed" : "completed", commit.id, commit.snapshotPath);
    if (commit.verifierNodeId) addEdge(commit.verifierNodeId, commitNodeId, "verifier");
    if (commit.selectionId) addEdge(`${run.id}:selection:${commit.selectionId}`, commitNodeId, "selection");
  }
  for (const feedbackRaw of run.feedback || []) {
    const feedback = feedbackRaw as { id: string; status: string; severity: string; classification: string; nodeId?: string; taskId?: string };
    addNode(`${run.id}:feedback:${feedback.id}`, "feedback", feedback.status, `${feedback.severity} ${feedback.classification}`);
    if (feedback.nodeId) addEdge(feedback.nodeId, `${run.id}:feedback:${feedback.id}`);
    if (feedback.taskId) addEdge(`${run.id}:task:${feedback.taskId}`, `${run.id}:feedback:${feedback.id}`);
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const sortedEdges = edges.slice().sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || (a.label || "").localeCompare(b.label || ""));
  return { runId: run.id, nodes: sortedNodes, edges: sortedEdges };
}
