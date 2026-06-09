// Host multi-agent domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner. hostMultiAgentRun receives an already-resolved
// run (the runner still owns the load-or-plan policy, since it owns plan()).
import { WorkflowRun } from "../types";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import * as host from "../multi-agent-host";

export function hostMultiAgentRun(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof host.hostRun> {
  const response = host.hostRun(run, options);
  writeReport(run);
  saveCheckpoint(run);
  return response;
}

export function hostMultiAgentStatus(run: WorkflowRun): ReturnType<typeof host.hostStatus> {
  writeReport(run);
  return host.hostStatus(run);
}

export function hostMultiAgentStep(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof host.hostStep> {
  const response = host.hostStep(run, options);
  writeReport(run);
  saveCheckpoint(run);
  return response;
}

export function hostMultiAgentBlackboard(run: WorkflowRun, action?: string, options: Record<string, unknown> = {}): ReturnType<typeof host.hostBlackboard> {
  const response = host.hostBlackboard(run, action, options);
  writeReport(run);
  saveCheckpoint(run);
  return response;
}

export function hostMultiAgentScore(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof host.hostScore> {
  const response = host.hostScore(run, options);
  writeReport(run);
  saveCheckpoint(run);
  return response;
}

export function hostMultiAgentSelect(run: WorkflowRun, options: Record<string, unknown> = {}): ReturnType<typeof host.hostSelect> {
  const response = host.hostSelect(run, options);
  writeReport(run);
  saveCheckpoint(run);
  return response;
}
