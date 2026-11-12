// core/pipeline/plan.ts — the workflow DSL a bundled app's workflow.js calls,
// and the pure step from a workflow definition to a fresh run state.

import { RUN_STATE_SCHEMA_VERSION, RunPaths, RunTask, WorkflowRun } from "../state/types.js";

export interface InputDefinition {
  name: string;
  type?: string;
  required?: boolean;
  repeated?: boolean;
  description?: string;
  default?: unknown;
}

export interface TaskDefinition {
  id: string;
  kind: "agent" | "artifact";
  prompt: string;
  requiresEvidence?: boolean;
  reviewsRepo?: boolean;
  resultCache?: { includeCompletedResults?: string };
}

export interface PhaseDefinition {
  name: string;
  mode: "sequential" | "parallel";
  tasks: TaskDefinition[];
  overlapPrevious?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  summary?: string;
  limits?: { maxAgents?: number; maxConcurrentAgents?: number };
  inputs?: InputDefinition[];
  phases: PhaseDefinition[];
}

type Options = Record<string, unknown>;

/** The factories handed to `module.exports = (dsl) => ...` in workflow.js. */
export const WORKFLOW_DSL = {
  workflow: (def: WorkflowDefinition): WorkflowDefinition => def,
  input: (name: string, options: Options = {}): InputDefinition => ({ ...options, name }),
  phase: (name: string, tasks: TaskDefinition[], options: Options = {}): PhaseDefinition => ({ ...options, name, mode: "sequential", tasks }),
  parallel: (name: string, tasks: TaskDefinition[], options: Options = {}): PhaseDefinition => ({ ...options, name, mode: "parallel", tasks }),
  agent: (id: string, prompt: string, options: Options = {}): TaskDefinition => ({ ...options, id, kind: "agent", prompt }),
  artifact: (id: string, prompt: string, options: Options = {}): TaskDefinition => ({ ...options, id, kind: "artifact", prompt }),
};

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function textOf(value: unknown): string {
  return Array.isArray(value) ? value.join("; ") : String(value ?? "");
}

/** `{{name}}` takes the input's value; a list joins with "; ". */
export function renderPrompt(prompt: string, inputs: Record<string, unknown>): string {
  return prompt.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (whole, key: string) => (key in inputs ? textOf(inputs[key]) : whole));
}

/** Declared inputs only, defaults filled in; a required one left empty throws. */
export function resolveInputs(def: WorkflowDefinition, given: Record<string, unknown>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const declared of def.inputs || []) {
    const value = isMissing(given[declared.name]) ? (declared.default ?? "") : given[declared.name];
    if (declared.required && isMissing(value)) throw new Error(`Missing required input: ${declared.name}`);
    inputs[declared.name] = value;
  }
  return inputs;
}

export function planRun(def: WorkflowDefinition, inputs: Record<string, unknown>, at: { runId: string; cwd: string; now: string; paths: RunPaths }): WorkflowRun {
  const seen = new Set<string>();
  const tasks: RunTask[] = [];
  for (const phase of def.phases) {
    for (const task of phase.tasks) {
      if (seen.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
      seen.add(task.id);
      tasks.push({
        id: task.id,
        kind: task.kind,
        phase: phase.name,
        status: "pending",
        prompt: renderPrompt(task.prompt, inputs),
        requiresEvidence: Boolean(task.requiresEvidence),
        ...(task.reviewsRepo ? { reviewsRepo: true } : {}),
        ...(task.resultCache?.includeCompletedResults === "previous-phases" ? { includePriorResults: true } : {}),
      });
    }
  }
  return {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    id: at.runId,
    createdAt: at.now,
    updatedAt: at.now,
    cwd: at.cwd,
    workflow: {
      id: def.id,
      title: def.title,
      summary: def.summary || "",
      limits: { maxAgents: def.limits?.maxAgents ?? 40, maxConcurrentAgents: def.limits?.maxConcurrentAgents ?? 1 },
    },
    inputs,
    loopStage: "interpret",
    phases: def.phases.map((phase) => ({
      id: phase.name.toLowerCase(),
      name: phase.name,
      status: "pending",
      taskIds: phase.tasks.map((task) => task.id),
      mode: phase.mode,
      ...(phase.overlapPrevious ? { overlapPrevious: true } : {}),
    })),
    tasks,
    commits: [],
    paths: at.paths,
  };
}
