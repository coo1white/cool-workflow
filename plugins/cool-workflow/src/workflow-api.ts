import {
  LoopUntil,
  WorkflowInputDefinition,
  WorkflowDefinition,
  WorkflowPhaseDefinition,
  WorkflowTaskDefinition
} from "./types";

export function workflow(definition: Partial<WorkflowDefinition> & Pick<WorkflowDefinition, "id" | "title" | "phases">): WorkflowDefinition {
  if (!definition.id) throw new Error("workflow.id is required");
  if (!definition.title) throw new Error("workflow.title is required");
  if (!Array.isArray(definition.phases)) throw new Error("workflow.phases must be an array");
  return {
    limits: {
      maxAgents: 20,
      maxConcurrentAgents: 4,
      ...(definition.limits || {})
    },
    inputs: [],
    summary: "",
    ...definition
  };
}

export function phase(name: string, tasks: WorkflowTaskDefinition[], options: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition {
  if (!name) throw new Error("phase name is required");
  if (!Array.isArray(tasks)) throw new Error(`phase ${name} tasks must be an array`);
  return {
    id: slugify(name),
    name,
    status: "pending",
    tasks,
    ...options
  };
}

/** A phase whose tasks the concurrent driver fulfills as one deterministic batch
 *  (up to limits.maxConcurrentAgents at a time) — the authoring analog of the
 *  Workflow tool's parallel() barrier. Sugar over phase() with mode:"parallel";
 *  plain phase() stays sequential, so existing apps are unaffected. */
export function parallel(name: string, tasks: WorkflowTaskDefinition[], options: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition {
  return phase(name, tasks, { mode: "parallel", ...options });
}

/** A BOUNDED DYNAMIC LOOP phase: `tasks` are a per-round template. After each round
 *  completes, the registered `until` predicate decides whether to run another round
 *  (a fresh appended phase with the same tasks, round-suffixed ids) or stop; capped
 *  at `maxRounds`. Sugar over phase() that sets `loop`; plain phases are unaffected. */
export function loop(
  name: string,
  tasks: WorkflowTaskDefinition[],
  spec: { maxRounds: number; until: LoopUntil },
  options: Partial<WorkflowPhaseDefinition> = {}
): WorkflowPhaseDefinition {
  if (!spec || typeof spec.maxRounds !== "number" || spec.maxRounds < 1) {
    throw new Error(`loop ${name} requires a positive integer maxRounds`);
  }
  const until = spec.until;
  const valid = until
    && ((until.kind === "predicate" && Boolean(until.ref))
      || (until.kind === "budget-target" && typeof until.target === "number" && until.target > 0));
  if (!valid) {
    throw new Error(`loop ${name} requires until: { kind: "predicate", ref } or { kind: "budget-target", target }`);
  }
  return phase(name, tasks, { loop: { maxRounds: Math.floor(spec.maxRounds), until }, ...options });
}

export function createWorkflowApi() {
  return {
    workflow,
    phase,
    parallel,
    loop,
    agent,
    artifact,
    subWorkflow,
    input
  };
}

export function agent(id: string, prompt: string, options: Partial<WorkflowTaskDefinition> = {}): WorkflowTaskDefinition {
  return task("agent", id, prompt, options);
}

/** A task fulfilled by an inline SUB-WORKFLOW: instead of spawning an agent, the
 *  drive plans + drives the child `appId` and binds its report back as this task's
 *  result. The prompt is recorded for provenance but is not sent to an agent. */
export function subWorkflow(
  id: string,
  appId: string,
  options: Partial<WorkflowTaskDefinition> & { inputs?: Record<string, string>; bindResult?: "report" | "verdict-result"; prompt?: string } = {}
): WorkflowTaskDefinition {
  if (!appId) throw new Error(`subWorkflow task ${id} requires an appId`);
  const { inputs, bindResult, prompt, ...rest } = options;
  return task("agent", id, prompt || `Delegate to sub-workflow app: ${appId}`, {
    ...rest,
    subWorkflow: { appId, ...(inputs ? { inputs } : {}), ...(bindResult ? { bindResult } : {}) }
  });
}

export function artifact(id: string, prompt: string, options: Partial<WorkflowTaskDefinition> = {}): WorkflowTaskDefinition {
  return task("artifact", id, prompt, options);
}

export function input(name: string, options: Partial<WorkflowInputDefinition> = {}): WorkflowInputDefinition {
  if (!name) throw new Error("input name is required");
  return {
    name,
    ...options
  };
}

function task(kind: "agent" | "artifact", id: string, prompt: string, options: Partial<WorkflowTaskDefinition>): WorkflowTaskDefinition {
  if (!id) throw new Error(`${kind} task id is required`);
  if (!prompt) throw new Error(`${kind} task ${id} prompt is required`);
  return {
    id,
    kind,
    prompt,
    status: "pending",
    sandboxProfileId: typeof options.sandboxProfileId === "string"
      ? options.sandboxProfileId
      : typeof (options as { sandboxProfile?: unknown }).sandboxProfile === "string"
        ? String((options as { sandboxProfile: string }).sandboxProfile)
        : undefined,
    ...options
  };
}

export function slugify(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-{2,}/g, "-");
}
