// core/workflow-apps/app-schema.ts — MINIMAL workflow-app manifest +
// workflow DSL types, and a pure builder API (`workflow`, `phase`,
// `parallel`, `agent`, `artifact`, `input`).
//
// SCOPE NOTE (read before extending): milestone 12 (workflow-apps.md) owns
// the FULL workflow-app framework — app validation, init/package, the
// loop()/subWorkflow() DSL helpers, and the full capability registry of
// apps. This milestone builds ONLY the minimal REAL subset the combined
// milestone-6/7 conformance gate actually needs: enough to load ONE real
// app manifest (architecture-review / end-to-end-golden-path) and derive
// its declared phases/tasks. Specifically built here:
//   - `workflow()`/`phase()`/`parallel()`/`agent()`/`artifact()`/`input()`
//     factory functions, byte-exact to src/workflow-api.ts's shape.
//   - A loader that `require()`s a real app's `workflow.js` entrypoint
//     (the factory-function form: `module.exports = ({workflow, phase,
//     parallel, agent, artifact, input}) => workflow({...})`) and reads
//     its `app.json` manifest for id/title/summary/inputs — this is the
//     REAL manifest format the bundled apps under plugins/cool-workflow/
//     apps/*/ actually use (verified against architecture-review/app.json
//     and end-to-end-golden-path/app.json).
// NOT built here (left for milestone 12 to add generically):
//   - `loop()`/`subWorkflow()` DSL sugar (no case in this gate exercises
//     either — architecture-review and end-to-end-golden-path use only
//     phase()/parallel()/agent()/artifact()).
//   - App manifest schema VALIDATION (validateWorkflowApp's full issue
//     list) — this loader trusts a well-formed bundled app.json/workflow.js
//     pair (real files, not fabricated) and throws a plain Error on a
//     structurally broken one, rather than reproducing the old build's
//     full WorkflowAppValidationIssue taxonomy.
//   - `cw app list/show/validate/init/package` capability rows.
//   - Custom per-app pipeline contracts (`appRecord.app.pipeline`).
//
// Pure factory functions (this file); the actual `require()`/fs read of
// an app's manifest+entrypoint lives in shell/ (see shell/workflow-app-
// loader.ts), per the core/shell split.

export interface WorkflowInputDefinition {
  name: string;
  type?: string;
  required?: boolean;
  repeated?: boolean;
  description?: string;
  default?: unknown;
}

export interface WorkflowTaskDefinition {
  id: string;
  kind: "agent" | "artifact";
  prompt: string;
  status?: string;
  requiresEvidence?: boolean;
  sandboxProfileId?: string;
  label?: string;
  model?: string;
  agentType?: string;
  [key: string]: unknown;
}

export interface WorkflowPhaseDefinition {
  id: string;
  name: string;
  status: "pending";
  tasks: WorkflowTaskDefinition[];
  mode?: "sequential" | "parallel";
  loop?: { maxRounds: number; until: { kind: string; ref?: string; target?: number } };
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  summary?: string;
  limits: { maxAgents: number; maxConcurrentAgents: number; tokenBudget?: number };
  inputs: WorkflowInputDefinition[];
  sandboxProfiles?: string[];
  phases: WorkflowPhaseDefinition[];
}

export function slugify(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-{2,}/g, "-");
}

export function workflow(
  definition: Partial<WorkflowDefinition> & Pick<WorkflowDefinition, "id" | "title" | "phases">
): WorkflowDefinition {
  if (!definition.id) throw new Error("workflow.id is required");
  if (!definition.title) throw new Error("workflow.title is required");
  if (!Array.isArray(definition.phases)) throw new Error("workflow.phases must be an array");
  return {
    limits: { maxAgents: 20, maxConcurrentAgents: 4, ...(definition.limits || {}) },
    inputs: [],
    summary: "",
    ...definition,
  } as WorkflowDefinition;
}

export function phase(name: string, tasks: WorkflowTaskDefinition[], options: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition {
  if (!name) throw new Error("phase name is required");
  if (!Array.isArray(tasks)) throw new Error(`phase ${name} tasks must be an array`);
  return { id: slugify(name), name, status: "pending", tasks, ...options };
}

export function parallel(name: string, tasks: WorkflowTaskDefinition[], options: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition {
  return phase(name, tasks, { mode: "parallel", ...options });
}

function task(kind: "agent" | "artifact", id: string, prompt: string, options: Partial<WorkflowTaskDefinition>): WorkflowTaskDefinition {
  if (!id) throw new Error(`${kind} task id is required`);
  if (!prompt) throw new Error(`${kind} task ${id} prompt is required`);
  return {
    id,
    kind,
    prompt,
    status: "pending",
    sandboxProfileId: typeof options.sandboxProfileId === "string" ? options.sandboxProfileId : undefined,
    ...options,
  };
}

export function agent(id: string, prompt: string, options: Partial<WorkflowTaskDefinition> = {}): WorkflowTaskDefinition {
  return task("agent", id, prompt, options);
}

export function artifact(id: string, prompt: string, options: Partial<WorkflowTaskDefinition> = {}): WorkflowTaskDefinition {
  return task("artifact", id, prompt, options);
}

export function input(name: string, options: Partial<WorkflowInputDefinition> = {}): WorkflowInputDefinition {
  if (!name) throw new Error("input name is required");
  return { name, ...options };
}

export function createWorkflowApi(): {
  workflow: typeof workflow;
  phase: typeof phase;
  parallel: typeof parallel;
  agent: typeof agent;
  artifact: typeof artifact;
  input: typeof input;
} {
  return { workflow, phase, parallel, agent, artifact, input };
}

export interface WorkflowAppManifest {
  schemaVersion: number;
  id: string;
  title: string;
  summary?: string;
  version?: string;
  author?: string;
  inputs?: WorkflowInputDefinition[];
  sandboxProfiles?: string[];
  workflow: { entrypoint: string; exportName?: string };
  metadata?: Record<string, unknown>;
}

export interface LoadedWorkflowApp {
  id: string;
  title: string;
  summary: string;
  version?: string;
  author?: string;
  workflow: WorkflowDefinition;
  sandboxProfiles: string[];
  sourcePath: string;
}

/** Byte-exact render of the workflow-app run-metadata block that lands in
 *  `run.workflow.app` (report.md's "Workflow App:" line reads
 *  `run.workflow.app.id`/`.version`). */
export function workflowAppRunMetadata(app: LoadedWorkflowApp): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: app.id,
    title: app.title,
    summary: app.summary,
    version: app.version,
    author: app.author,
    sandboxProfiles: app.sandboxProfiles,
    source: { manifestPath: app.sourcePath },
  };
}
