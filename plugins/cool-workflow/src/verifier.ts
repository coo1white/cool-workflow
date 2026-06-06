import { Finding, ResultEnvelope, RunTask, WorkflowRun } from "./types";
import { firstRunnablePhase } from "./dispatch";

export function assertTaskCanComplete(run: WorkflowRun, task: RunTask): void {
  const runnablePhase = firstRunnablePhase(run);
  if (!runnablePhase || runnablePhase.name !== task.phase) {
    throw new Error(
      `Phase gate blocked task ${task.id}; current runnable phase is ${runnablePhase?.name || "none"}`
    );
  }
  if (!["pending", "running"].includes(task.status)) {
    throw new Error(`Task ${task.id} cannot be completed from status ${task.status}`);
  }
}

export function parseResultEnvelope(markdown: string): ResultEnvelope {
  const match = markdown.match(/```cw:result\s*([\s\S]*?)```/);
  if (!match) {
    return {
      summary: firstNonEmptyLine(markdown),
      findings: [],
      evidence: []
    };
  }
  try {
    const parsed = JSON.parse(match[1]) as Partial<ResultEnvelope>;
    return {
      summary: parsed.summary || firstNonEmptyLine(markdown),
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence : []
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid cw:result JSON: ${message}`);
  }
}

export function validateResultEnvelope(task: RunTask, result: ResultEnvelope): void {
  const mustHaveEvidence =
    task.requiresEvidence ||
    /^verify[:/]/i.test(task.id) ||
    /^verdict[:/]/i.test(task.id) ||
    /^synthesis[:/]/i.test(task.id);
  if (mustHaveEvidence && !hasEvidence(result)) {
    throw new Error(`Task ${task.id} requires cw:result evidence`);
  }
  for (const finding of result.findings || []) {
    validateFinding(task, finding);
  }
}

export function validateRunGates(run: WorkflowRun): void {
  const verdictTasks = run.tasks.filter((task) => /^verdict[:/]|^synthesis[:/]/i.test(task.id));
  for (const verdictTask of verdictTasks) {
    if (verdictTask.status !== "completed") continue;
    const verdictPhaseIndex = run.phases.findIndex((phase) => phase.name === verdictTask.phase);
    const earlierPhases = run.phases.slice(0, verdictPhaseIndex);
    const incompleteEarlier = earlierPhases.find((phase) => phase.status !== "completed");
    if (incompleteEarlier) {
      throw new Error(
        `Verdict gate blocked ${verdictTask.id}; phase ${incompleteEarlier.name} is not complete`
      );
    }
  }
}

function validateFinding(task: RunTask, finding: Finding): void {
  if (!finding.id) throw new Error(`Task ${task.id} has a finding without id`);
  if (
    finding.classification &&
    !["real", "conditional", "non-issue", "unknown"].includes(finding.classification)
  ) {
    throw new Error(`Task ${task.id} finding ${finding.id} has invalid classification`);
  }
  if (["P0", "P1", "P2"].includes(finding.severity || "") && !hasEvidence(finding)) {
    throw new Error(`Task ${task.id} finding ${finding.id} severity ${finding.severity} requires evidence`);
  }
}

function hasEvidence(value: { evidence?: string[] }): boolean {
  return Array.isArray(value.evidence) && value.evidence.some((entry) => String(entry).trim());
}

function firstNonEmptyLine(markdown: string): string {
  return (
    markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) || ""
  );
}
