// Candidate domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner; each function takes a loaded run. Behavior is
// identical to the inline implementations — only the location changed.
import path from "node:path";
import { WorkflowRun } from "../types";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import { stringOption, numberOption, mergeEvidence, parseCriteria, parseEvidence } from "./cli-options";
import { getWorkerScope } from "../worker-isolation";
import {
  listCandidates as listCandidatesImpl,
  getCandidate,
  registerCandidate as registerCandidateImpl,
  scoreCandidate as scoreCandidateImpl,
  rankCandidates as rankCandidatesImpl,
  selectCandidate as selectCandidateImpl,
  rejectCandidate as rejectCandidateImpl
} from "../candidate-scoring";

export function listCandidates(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof listCandidatesImpl> {
  return listCandidatesImpl(run, {
    status: options.status ? (String(options.status) as never) : undefined,
    kind: options.kind ? (String(options.kind) as never) : undefined
  });
}

export function showCandidate(run: WorkflowRun, candidateId: string): NonNullable<ReturnType<typeof getCandidate>> {
  const candidate = getCandidate(run, candidateId);
  if (!candidate) throw new Error(`Unknown candidate id for run ${run.id}: ${candidateId}`);
  return candidate;
}

export function registerCandidate(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof registerCandidateImpl> {
  const workerId = options.worker ? String(options.worker) : undefined;
  const worker = workerId ? getWorkerScope(run, workerId) : undefined;
  if (workerId && !worker) throw new Error(`Unknown worker id for run ${run.id}: ${workerId}`);
  const task = worker ? run.tasks.find((candidate) => candidate.id === worker.taskId) : undefined;
  const resultNodeId = stringOption(options.resultNode) || worker?.resultNodeId || task?.resultNodeId;
  const verifierNodeId = stringOption(options.verifierNode) || worker?.output?.verifierNodeId || task?.verifierNodeId;
  const resultPath = stringOption(options.resultPath) || worker?.output?.resultPath || task?.resultPath;
  const resultNode = resultNodeId ? run.nodes?.find((node) => node.id === resultNodeId) : undefined;
  const verifierNode = verifierNodeId ? run.nodes?.find((node) => node.id === verifierNodeId) : undefined;
  const candidate = registerCandidateImpl(run, {
    id: stringOption(options.id),
    kind: stringOption(options.kind) as never,
    workerId,
    taskId: stringOption(options.task) || worker?.taskId,
    resultNodeId,
    verifierNodeId,
    resultPath,
    artifacts: [
      ...(resultPath ? [{ id: "result", kind: "markdown", path: path.resolve(resultPath) }] : []),
      ...(worker ? [{ id: "worker", kind: "json", path: path.join(worker.workerDir, "worker.json") }] : [])
    ] as never,
    evidence: mergeEvidence(resultNode?.evidence || [], verifierNode?.evidence || []),
    metadata: {
      source: worker ? "worker" : "manual",
      workerDir: worker?.workerDir
    }
  }, { persist: false });
  writeReport(run);
  saveCheckpoint(run);
  return candidate;
}

export function scoreCandidate(run: WorkflowRun, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof scoreCandidateImpl> {
  const score = scoreCandidateImpl(run, candidateId, {
    id: stringOption(options.id),
    scorer: stringOption(options.scorer),
    criteria: parseCriteria(options),
    maxTotal: numberOption(options.maxTotal || options.max),
    verdict: stringOption(options.verdict) as never,
    evidence: parseEvidence(options.evidence),
    notes: stringOption(options.notes)
  }, { persist: false });
  writeReport(run);
  saveCheckpoint(run);
  return score;
}

export function rankCandidates(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof rankCandidatesImpl> {
  const ranking = rankCandidatesImpl(run, {
    includeRejected: Boolean(options.includeRejected),
    policy: {
      minNormalized: numberOption(options.minNormalized),
      requireEvidence: options.requireEvidence === undefined ? undefined : Boolean(options.requireEvidence),
      requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate),
      tieBreaker: stringOption(options.tieBreaker) as never
    }
  });
  writeReport(run);
  saveCheckpoint(run);
  return ranking;
}

export function selectCandidate(run: WorkflowRun, candidateId: string, options: Record<string, unknown> = {}): ReturnType<typeof selectCandidateImpl> {
  const selection = selectCandidateImpl(run, candidateId, {
    selectedBy: stringOption(options.by) || stringOption(options.selectedBy),
    reason: stringOption(options.reason),
    scoreId: stringOption(options.score),
    allowUnverified: Boolean(options.allowUnverified)
  }, {
    persist: false,
    policy: {
      minNormalized: numberOption(options.minNormalized),
      requireVerifierGate: options.requireVerifierGate === undefined ? undefined : Boolean(options.requireVerifierGate)
    }
  });
  writeReport(run);
  saveCheckpoint(run);
  return selection;
}

export function rejectCandidate(run: WorkflowRun, candidateId: string, reason: string): ReturnType<typeof rejectCandidateImpl> {
  const candidate = rejectCandidateImpl(run, candidateId, reason, { persist: false });
  writeReport(run);
  saveCheckpoint(run);
  return candidate;
}
