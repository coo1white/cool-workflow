// core/workflow-apps/app-schema.ts — workflow-app manifest + workflow DSL
// types, a pure builder API (`workflow`, `phase`, `parallel`, `loop`,
// `agent`, `artifact`, `subWorkflow`, `input`), and full manifest
// validation (`validateWorkflowApp`).
//
// MILESTONE 12 (v2/PLAN.md build order; workflow-apps.md). Milestone 6+7
// built the minimal real subset needed to load ONE app and drive it
// end to end (see git history / the old header note this replaces).
// This milestone adds, on top of that, WITHOUT changing any existing
// exported function's signature or behavior:
//   - `loop()` — sugar over `phase()` that sets a bounded dynamic loop
//     spec, byte-exact to src/workflow-api.ts.
//   - `subWorkflow()` — sugar over `agent()` that adds a `subWorkflow`
//     field, byte-exact to src/workflow-api.ts.
//   - `validateWorkflowApp`/`assertValidWorkflowApp`/
//     `validateWorkflowDefinition` — the full WorkflowAppValidationIssue
//     taxonomy `cw app validate` needs, ported byte-for-byte from
//     src/workflow-app-framework.ts.
//   - `WorkflowAppValidationError` — thrown by a fail-closed manifest
//     load (see shell/workflow-app-loader.ts's discovery functions).
//
// Pure factory + validation functions (this file, no `fs`/`child_process`/
// `process.env`); the actual `require()`/fs read of an app's manifest +
// entrypoint, and `cw app list/show/validate/init/package` discovery,
// live in shell/ (see shell/workflow-app-loader.ts), per the core/shell
// split.

export interface WorkflowInputDefinition {
  name: string;
  type?: string;
  required?: boolean;
  repeated?: boolean;
  description?: string;
  default?: unknown;
}

export interface WorkflowSubWorkflowSpec {
  appId: string;
  inputs?: Record<string, unknown>;
  bindResult?: "report" | "verdict-result";
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
  subWorkflow?: WorkflowSubWorkflowSpec;
  [key: string]: unknown;
}

export type LoopUntil = { kind: "predicate"; ref: string } | { kind: "budget-target"; target: number };

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
  metadata?: Record<string, unknown>;
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

/** A BOUNDED DYNAMIC LOOP phase: `tasks` are a per-round template. After each
 *  round completes, the registered `until` predicate decides whether to run
 *  another round (a fresh appended phase with the same tasks, round-suffixed
 *  ids) or stop; capped at `maxRounds`. Sugar over phase() that sets `loop`;
 *  plain phases are unaffected. Byte-exact to src/workflow-api.ts's loop(). */
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
  const valid =
    until &&
    ((until.kind === "predicate" && Boolean(until.ref)) ||
      (until.kind === "budget-target" && typeof until.target === "number" && until.target > 0));
  if (!valid) {
    throw new Error(`loop ${name} requires until: { kind: "predicate", ref } or { kind: "budget-target", target }`);
  }
  return phase(name, tasks, { loop: { maxRounds: Math.floor(spec.maxRounds), until }, ...options });
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

/** A task fulfilled by an inline SUB-WORKFLOW: instead of spawning an agent,
 *  the drive plans + drives the child `appId` and binds its report back as
 *  this task's result. The prompt is recorded for provenance but is not sent
 *  to an agent. Byte-exact to src/workflow-api.ts's subWorkflow(). */
export function subWorkflow(
  id: string,
  appId: string,
  options: Partial<WorkflowTaskDefinition> & { inputs?: Record<string, unknown>; bindResult?: "report" | "verdict-result"; prompt?: string } = {}
): WorkflowTaskDefinition {
  if (!appId) throw new Error(`subWorkflow task ${id} requires an appId`);
  const { inputs, bindResult, prompt, ...rest } = options;
  return task("agent", id, prompt || `Delegate to sub-workflow app: ${appId}`, {
    ...rest,
    subWorkflow: { appId, ...(inputs ? { inputs } : {}), ...(bindResult ? { bindResult } : {}) },
  });
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
  loop: typeof loop;
  agent: typeof agent;
  artifact: typeof artifact;
  subWorkflow: typeof subWorkflow;
  input: typeof input;
} {
  return { workflow, phase, parallel, loop, agent, artifact, subWorkflow, input };
}

export type WorkflowAppAuthor = string | { name: string; url?: string; email?: string };

export interface WorkflowAppCompatibility {
  minVersion?: string;
  maxVersion?: string;
  coolWorkflow?: string;
  workflowSchemaVersion?: 1;
  node?: string;
  notes?: string;
}

export interface WorkflowAppEntrypoint {
  entrypoint: string;
  exportName?: string;
}

export interface WorkflowAppManifest {
  schemaVersion: number;
  id: string;
  title: string;
  summary?: string;
  version?: string;
  author?: WorkflowAppAuthor;
  inputs?: WorkflowInputDefinition[];
  sandboxProfiles?: string[];
  compatibility?: WorkflowAppCompatibility;
  workflow: WorkflowAppEntrypoint;
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

// ---------------------------------------------------------------------
// Full manifest validation (`cw app validate`) — ported byte-for-byte
// from src/workflow-app-framework.ts. `WorkflowAppDefinition` is the
// richer "candidate manifest, possibly with an inline workflow" shape
// `validateWorkflowApp` accepts; `WorkflowAppSource`/`LoadedWorkflowAppRecord`
// are the discovery-time record shape shell/workflow-app-loader.ts's
// list/show/validate functions build (distinct from the minimal
// `LoadedWorkflowApp` above, which stays exactly as milestone 6+7 left it
// for `loadWorkflowApp`/plan/drive).
// ---------------------------------------------------------------------

export type WorkflowAppWorkflowField = WorkflowDefinition | WorkflowAppEntrypoint;

export interface WorkflowAppDefinition {
  schemaVersion: number;
  id: string;
  title: string;
  summary?: string;
  version: string;
  author?: WorkflowAppAuthor;
  workflow: WorkflowAppWorkflowField;
  inputs?: WorkflowInputDefinition[];
  sandboxProfiles?: string[];
  compatibility?: WorkflowAppCompatibility;
  metadata?: Record<string, unknown>;
}

export type WorkflowAppSourceKind = "app-directory" | "app-manifest" | "workflow-file";

export interface WorkflowAppSource {
  kind: WorkflowAppSourceKind;
  path: string;
  manifestPath?: string;
  entrypointPath?: string;
}

export interface LoadedWorkflowAppRecord {
  app: WorkflowAppDefinition & { workflow: WorkflowDefinition };
  source: WorkflowAppSource;
  legacy: boolean;
}

export interface WorkflowAppSummary {
  id: string;
  title: string;
  summary: string;
  version: string;
  author?: WorkflowAppAuthor;
  file: string;
  sourceKind: WorkflowAppSourceKind;
  legacy: boolean;
  compatible: boolean;
  inputs: WorkflowInputDefinition[];
  sandboxProfiles: string[];
  phases: Array<{ id: string; name: string; taskCount: number }>;
  taskCount: number;
}

export interface WorkflowAppValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface WorkflowAppValidationResult {
  valid: boolean;
  appId?: string;
  appPath?: string;
  issues: WorkflowAppValidationIssue[];
  summary?: WorkflowAppSummary;
}

export interface WorkflowAppRunMetadataFull {
  schemaVersion: number;
  id: string;
  title: string;
  summary?: string;
  version: string;
  author?: WorkflowAppAuthor;
  compatibility?: WorkflowAppCompatibility;
  sandboxProfiles?: string[];
  source?: WorkflowAppSource;
  metadata?: Record<string, unknown>;
}

export class WorkflowAppValidationError extends Error {
  issues: WorkflowAppValidationIssue[];

  constructor(message: string, issues: WorkflowAppValidationIssue[]) {
    super(`${message}: ${issues.map((one) => one.message).join("; ")}`);
    this.name = "WorkflowAppValidationError";
    this.issues = issues;
  }
}

function issue(code: string, message: string, pathName?: string): WorkflowAppValidationIssue {
  return { code, message, path: pathName };
}

function joinPath(basePath: string | undefined, segment: string): string | undefined {
  if (!basePath) return segment;
  return `${basePath}.${segment}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function semverParts(value: string): [number, number, number] {
  const [major, minor, patch] = value
    .split(/[+-]/)[0]
    .split(".")
    .map((part) => Number(part));
  return [major || 0, minor || 0, patch || 0];
}

function compareSemver(left: string, right: string): number {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    Array.isArray(value.phases) &&
    isRecord(value.limits) &&
    Array.isArray(value.inputs)
  );
}

function isWorkflowEntrypoint(value: unknown): value is WorkflowAppEntrypoint {
  return isRecord(value) && "entrypoint" in value && !("phases" in value);
}

function validateAppId(value: unknown, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (!isNonEmptyString(value)) {
    issues.push(issue("workflow-app-id", "Workflow app id is required", pathName));
    return;
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)) {
    issues.push(issue("workflow-app-id", `Workflow app id is malformed: ${value}`, pathName));
  }
}

function validateWorkflowId(value: unknown, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (!isNonEmptyString(value)) {
    issues.push(issue("workflow-id", "Workflow id is required", pathName));
    return;
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)) {
    issues.push(issue("workflow-id", `Workflow id is malformed: ${value}`, pathName));
  }
}

function validateAuthor(value: unknown, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (value === undefined) return;
  if (isNonEmptyString(value)) return;
  if (isRecord(value) && isNonEmptyString(value.name)) return;
  issues.push(issue("workflow-app-author", "Workflow app author must be a string or object with name", pathName));
}

function validateLimits(value: unknown, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (!isRecord(value)) {
    issues.push(issue("workflow-limits", "Workflow limits are required", pathName));
    return;
  }
  const maxAgents = Number(value.maxAgents);
  const maxConcurrentAgents = Number(value.maxConcurrentAgents);
  if (!Number.isInteger(maxAgents) || maxAgents < 1) {
    issues.push(issue("workflow-limits", "Workflow limits.maxAgents must be a positive integer", joinPath(pathName, "maxAgents")));
  }
  if (!Number.isInteger(maxConcurrentAgents) || maxConcurrentAgents < 1) {
    issues.push(issue("workflow-limits", "Workflow limits.maxConcurrentAgents must be a positive integer", joinPath(pathName, "maxConcurrentAgents")));
  }
  if (Number.isInteger(maxAgents) && Number.isInteger(maxConcurrentAgents) && maxConcurrentAgents > maxAgents) {
    issues.push(
      issue("workflow-limits", "Workflow limits.maxConcurrentAgents must be less than or equal to maxAgents", joinPath(pathName, "maxConcurrentAgents"))
    );
  }
}

function validateInputDefinitions(
  inputs: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName?: string,
  options: { optional: boolean } = { optional: false }
): void {
  if (inputs === undefined && options.optional) return;
  if (!Array.isArray(inputs)) {
    issues.push(issue("workflow-inputs", "Workflow inputs must be an array", pathName));
    return;
  }
  const seen = new Set<string>();
  for (const [index, inputDefinition] of inputs.entries()) {
    const inputPath = joinPath(pathName, String(index));
    if (!isRecord(inputDefinition)) {
      issues.push(issue("workflow-input", "Workflow input must be an object", inputPath));
      continue;
    }
    const name = inputDefinition.name;
    if (!isNonEmptyString(name) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      issues.push(issue("workflow-input-name", `Workflow input name is malformed: ${String(name || "")}`, joinPath(inputPath, "name")));
    } else if (seen.has(name)) {
      issues.push(issue("workflow-input-duplicate", `Duplicate workflow input name: ${name}`, joinPath(inputPath, "name")));
    } else {
      seen.add(name);
    }
    if (inputDefinition.type !== undefined && !["string", "number", "boolean", "path", "json"].includes(String(inputDefinition.type))) {
      issues.push(issue("workflow-input-type", `Workflow input ${String(name || index)} has invalid type`, joinPath(inputPath, "type")));
    }
    if (inputDefinition.required !== undefined && typeof inputDefinition.required !== "boolean") {
      issues.push(issue("workflow-input-required", `Workflow input ${String(name || index)} required must be boolean`, joinPath(inputPath, "required")));
    }
    if (inputDefinition.repeated !== undefined && typeof inputDefinition.repeated !== "boolean") {
      issues.push(issue("workflow-input-repeated", `Workflow input ${String(name || index)} repeated must be boolean`, joinPath(inputPath, "repeated")));
    }
  }
}

function validateMatchingInputs(
  appInputs: WorkflowInputDefinition[],
  workflowInputs: WorkflowInputDefinition[],
  issues: WorkflowAppValidationIssue[],
  pathName?: string
): void {
  if (JSON.stringify(appInputs) !== JSON.stringify(workflowInputs)) {
    issues.push(issue("workflow-app-inputs-mismatch", "Workflow app inputs must match workflow.inputs when both are present", pathName));
  }
}

function validateSandboxProfileReferences(
  profiles: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName: string | undefined,
  bundledIds: string[],
  options: { optional: boolean } = { optional: false }
): void {
  if (profiles === undefined && options.optional) return;
  if (!Array.isArray(profiles)) {
    issues.push(issue("workflow-sandbox-profiles", "Workflow sandboxProfiles must be an array", pathName));
    return;
  }
  const seen = new Set<string>();
  for (const [index, value] of profiles.entries()) {
    const profilePath = joinPath(pathName, String(index));
    if (!isNonEmptyString(value)) {
      issues.push(issue("workflow-sandbox-profile", "Sandbox profile reference must be a non-empty string", profilePath));
      continue;
    }
    if (seen.has(value)) {
      issues.push(issue("workflow-sandbox-profile-duplicate", `Duplicate sandbox profile reference: ${value}`, profilePath));
    }
    seen.add(value);
    if (!bundledIds.includes(value)) {
      issues.push(issue("workflow-sandbox-profile-unknown", `Unknown sandbox profile ${value}; bundled profiles: ${bundledIds.join(", ")}`, profilePath));
    }
  }
}

function validateCompatibility(
  value: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName: string | undefined,
  currentVersion: string
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(issue("workflow-app-compatibility", "Workflow app compatibility must be an object", pathName));
    return;
  }
  if (value.workflowSchemaVersion !== undefined && value.workflowSchemaVersion !== 1) {
    issues.push(issue("workflow-app-compatibility", "Workflow schema version must be 1", joinPath(pathName, "workflowSchemaVersion")));
  }
  for (const key of ["coolWorkflow", "node", "notes"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      issues.push(issue("workflow-app-compatibility", `Compatibility ${key} must be a string`, joinPath(pathName, key)));
    }
  }
  if (value.minVersion !== undefined) {
    if (!isSemver(value.minVersion)) {
      issues.push(issue("workflow-app-compatibility", "Compatibility minVersion must be semver", joinPath(pathName, "minVersion")));
    } else if (compareSemver(currentVersion, value.minVersion as string) < 0) {
      issues.push(
        issue(
          "workflow-app-incompatible",
          `Workflow app requires Cool Workflow >= ${value.minVersion}; current is ${currentVersion}`,
          joinPath(pathName, "minVersion")
        )
      );
    }
  }
  if (value.maxVersion !== undefined) {
    if (!isSemver(value.maxVersion)) {
      issues.push(issue("workflow-app-compatibility", "Compatibility maxVersion must be semver", joinPath(pathName, "maxVersion")));
    } else if (compareSemver(currentVersion, value.maxVersion as string) > 0) {
      issues.push(
        issue(
          "workflow-app-incompatible",
          `Workflow app supports Cool Workflow <= ${value.maxVersion}; current is ${currentVersion}`,
          joinPath(pathName, "maxVersion")
        )
      );
    }
  }
}

function validateEntrypoint(value: WorkflowAppEntrypoint, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (!isNonEmptyString(value.entrypoint)) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.entrypoint is required", joinPath(pathName, "entrypoint")));
  }
  if (value.entrypoint && /^([a-zA-Z]:)?[/\\]/.test(value.entrypoint)) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.entrypoint must be relative", joinPath(pathName, "entrypoint")));
  }
  if (value.entrypoint && value.entrypoint.split(/[\\/]/).includes("..")) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.entrypoint must not contain traversal", joinPath(pathName, "entrypoint")));
  }
  if (value.exportName !== undefined && !isNonEmptyString(value.exportName)) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.exportName must be a string", joinPath(pathName, "exportName")));
  }
}

function validateTask(
  taskDefinition: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName: string | undefined,
  seenTaskIds: Set<string>,
  options: { appSandboxProfiles?: string[]; bundledIds: string[] }
): void {
  if (!isRecord(taskDefinition)) {
    issues.push(issue("workflow-task", "Workflow task must be an object", pathName));
    return;
  }
  const taskValue = taskDefinition as Partial<WorkflowTaskDefinition>;
  if (!isNonEmptyString(taskValue.id) || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(taskValue.id)) {
    issues.push(issue("workflow-task-id", `Workflow task id is malformed: ${String(taskValue.id || "")}`, joinPath(pathName, "id")));
  } else if (seenTaskIds.has(taskValue.id)) {
    issues.push(issue("workflow-task-duplicate", `Duplicate workflow task id: ${taskValue.id}`, joinPath(pathName, "id")));
  } else {
    seenTaskIds.add(taskValue.id);
  }
  if (!["agent", "artifact"].includes(String(taskValue.kind))) {
    issues.push(issue("workflow-task-kind", `Workflow task ${String(taskValue.id || "")} kind must be agent or artifact`, joinPath(pathName, "kind")));
  }
  if (!isNonEmptyString(taskValue.prompt)) {
    issues.push(issue("workflow-task-prompt", `Workflow task ${String(taskValue.id || "")} prompt is required`, joinPath(pathName, "prompt")));
  }
  if (taskValue.requiresEvidence !== undefined && typeof taskValue.requiresEvidence !== "boolean") {
    issues.push(
      issue("workflow-task-evidence", `Workflow task ${String(taskValue.id || "")} requiresEvidence must be boolean`, joinPath(pathName, "requiresEvidence"))
    );
  }
  const sandboxProfileId = taskValue.sandboxProfileId;
  if (sandboxProfileId !== undefined) {
    if (!isNonEmptyString(sandboxProfileId)) {
      issues.push(
        issue("workflow-task-sandbox-profile", `Workflow task ${String(taskValue.id || "")} sandboxProfileId must be a string`, joinPath(pathName, "sandboxProfileId"))
      );
    } else if (!options.bundledIds.includes(sandboxProfileId)) {
      issues.push(
        issue(
          "workflow-task-sandbox-profile",
          `Workflow task ${String(taskValue.id || "")} references unknown sandbox profile ${sandboxProfileId}`,
          joinPath(pathName, "sandboxProfileId")
        )
      );
    } else if (options.appSandboxProfiles && !options.appSandboxProfiles.includes(sandboxProfileId)) {
      issues.push(
        issue(
          "workflow-task-sandbox-profile",
          `Workflow task ${String(taskValue.id || "")} sandbox profile ${sandboxProfileId} must be listed in app sandboxProfiles`,
          joinPath(pathName, "sandboxProfileId")
        )
      );
    }
  }
}

function validatePhase(
  phaseDefinition: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName: string | undefined,
  seenPhaseIds: Set<string>
): void {
  if (!isRecord(phaseDefinition)) {
    issues.push(issue("workflow-phase", "Workflow phase must be an object", pathName));
    return;
  }
  const phaseValue = phaseDefinition as Partial<WorkflowPhaseDefinition>;
  if (!isNonEmptyString(phaseValue.id) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(phaseValue.id)) {
    issues.push(issue("workflow-phase-id", `Workflow phase id is malformed: ${String(phaseValue.id || "")}`, joinPath(pathName, "id")));
  } else if (seenPhaseIds.has(phaseValue.id)) {
    issues.push(issue("workflow-phase-duplicate", `Duplicate workflow phase id: ${phaseValue.id}`, joinPath(pathName, "id")));
  } else {
    seenPhaseIds.add(phaseValue.id);
  }
  if (!isNonEmptyString(phaseValue.name)) {
    issues.push(issue("workflow-phase-name", "Workflow phase name is required", joinPath(pathName, "name")));
  }
  if (!Array.isArray(phaseValue.tasks) || !phaseValue.tasks.length) {
    issues.push(issue("workflow-phase-tasks", `Workflow phase ${String(phaseValue.id || phaseValue.name || "")} must have tasks`, joinPath(pathName, "tasks")));
  }
  if (phaseValue.loop !== undefined) {
    const loopValue = phaseValue.loop as { maxRounds?: unknown; until?: { kind?: unknown; ref?: unknown; target?: unknown } };
    if (!isRecord(loopValue)) {
      issues.push(issue("workflow-phase-loop", "Workflow phase loop must be an object", joinPath(pathName, "loop")));
    } else {
      if (typeof loopValue.maxRounds !== "number" || !Number.isInteger(loopValue.maxRounds) || loopValue.maxRounds < 1) {
        issues.push(issue("workflow-phase-loop-maxrounds", "loop.maxRounds must be a positive integer", joinPath(pathName, "loop.maxRounds")));
      }
      const until = loopValue.until;
      const validUntil =
        isRecord(until) &&
        ((until.kind === "predicate" && isNonEmptyString(until.ref)) ||
          (until.kind === "budget-target" && typeof until.target === "number" && until.target > 0));
      if (!validUntil) {
        issues.push(
          issue("workflow-phase-loop-until", 'loop.until must be { kind: "predicate", ref } or { kind: "budget-target", target }', joinPath(pathName, "loop.until"))
        );
      }
    }
  }
}

function validatePhases(
  phases: unknown,
  limits: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName: string | undefined,
  options: { appSandboxProfiles?: string[]; bundledIds: string[] }
): void {
  if (!Array.isArray(phases) || !phases.length) {
    issues.push(issue("workflow-phases", "Workflow phases must be a non-empty array", pathName));
    return;
  }
  const seenPhaseIds = new Set<string>();
  const seenTaskIds = new Set<string>();
  let taskCount = 0;
  for (const [phaseIndex, phaseDefinition] of phases.entries()) {
    const phasePath = joinPath(pathName, String(phaseIndex));
    validatePhase(phaseDefinition, issues, phasePath, seenPhaseIds);
    if (!isRecord(phaseDefinition) || !Array.isArray(phaseDefinition.tasks)) continue;
    for (const [taskIndex, taskDefinition] of phaseDefinition.tasks.entries()) {
      taskCount += 1;
      validateTask(taskDefinition, issues, joinPath(joinPath(phasePath, "tasks"), String(taskIndex)), seenTaskIds, options);
    }
  }
  if (isRecord(limits) && Number.isInteger(Number(limits.maxAgents)) && taskCount > Number(limits.maxAgents)) {
    issues.push(issue("workflow-limits", `Workflow defines ${taskCount} tasks but limits.maxAgents is ${String(limits.maxAgents)}`, joinPath(pathName, "limits.maxAgents")));
  }
}

/** Options every validation entry point needs from its shell caller (pure
 *  core cannot read the bundled sandbox-profile ids or the running CW
 *  version itself — both are passed in, never read from disk/env here). */
export interface WorkflowAppValidationContext {
  bundledSandboxProfileIds: string[];
  currentCoolWorkflowVersion: string;
}

export function validateWorkflowDefinition(
  candidate: unknown,
  context: WorkflowAppValidationContext,
  issues: WorkflowAppValidationIssue[] = [],
  basePath = "workflow",
  options: { appId?: string; appTitle?: string; appSandboxProfiles?: string[] } = {}
): WorkflowAppValidationIssue[] {
  if (!isRecord(candidate)) {
    issues.push(issue("workflow-invalid", "Workflow definition must be an object", basePath));
    return issues;
  }

  const workflowDefinition = candidate as Partial<WorkflowDefinition>;
  validateWorkflowId(workflowDefinition.id, issues, joinPath(basePath, "id"));
  if (!isNonEmptyString(workflowDefinition.title)) {
    issues.push(issue("workflow-title", "Workflow title is required", joinPath(basePath, "title")));
  }
  if (options.appId && workflowDefinition.id !== options.appId) {
    issues.push(issue("workflow-app-id-mismatch", `Workflow id must match app id ${options.appId}`, joinPath(basePath, "id")));
  }
  if (options.appTitle && workflowDefinition.title !== options.appTitle) {
    issues.push(issue("workflow-app-title-mismatch", `Workflow title must match app title ${options.appTitle}`, joinPath(basePath, "title")));
  }
  validateLimits(workflowDefinition.limits, issues, joinPath(basePath, "limits"));
  validateInputDefinitions(workflowDefinition.inputs, issues, joinPath(basePath, "inputs"), { optional: false });
  validateSandboxProfileReferences(workflowDefinition.sandboxProfiles, issues, joinPath(basePath, "sandboxProfiles"), context.bundledSandboxProfileIds, {
    optional: true,
  });
  validatePhases(workflowDefinition.phases, workflowDefinition.limits, issues, joinPath(basePath, "phases"), {
    appSandboxProfiles: options.appSandboxProfiles || workflowDefinition.sandboxProfiles,
    bundledIds: context.bundledSandboxProfileIds,
  });
  return issues;
}

/** The full `cw app validate` check: byte-exact issue codes/messages to
 *  src/workflow-app-framework.ts's `validateWorkflowApp`. Never throws. */
export function validateWorkflowApp(
  candidate: unknown,
  context: WorkflowAppValidationContext,
  options: { appPath?: string; loadedWorkflow?: WorkflowDefinition } = {}
): WorkflowAppValidationResult {
  const issues: WorkflowAppValidationIssue[] = [];
  const appPath = options.appPath;

  if (!isRecord(candidate)) {
    return { valid: false, appPath, issues: [issue("workflow-app-invalid", "Workflow app must be an object", appPath)] };
  }

  const app = candidate as Partial<WorkflowAppDefinition>;
  if (app.schemaVersion !== 1) {
    issues.push(issue("workflow-app-schema-version", "Workflow app schemaVersion must be 1", joinPath(appPath, "schemaVersion")));
  }
  validateAppId(app.id, issues, joinPath(appPath, "id"));
  if (!isNonEmptyString(app.title)) {
    issues.push(issue("workflow-app-title", "Workflow app title is required", joinPath(appPath, "title")));
  }
  if (!isSemver(app.version)) {
    issues.push(issue("workflow-app-version", "Workflow app version must be a semver string such as 0.1.0", joinPath(appPath, "version")));
  }
  validateAuthor(app.author, issues, joinPath(appPath, "author"));
  validateInputDefinitions(app.inputs, issues, joinPath(appPath, "inputs"), { optional: true });
  validateSandboxProfileReferences(app.sandboxProfiles, issues, joinPath(appPath, "sandboxProfiles"), context.bundledSandboxProfileIds, { optional: true });
  validateCompatibility(app.compatibility, issues, joinPath(appPath, "compatibility"), context.currentCoolWorkflowVersion);

  const workflowValue = options.loadedWorkflow || app.workflow;
  if (!workflowValue) {
    issues.push(issue("workflow-app-workflow", "Workflow app workflow is required", joinPath(appPath, "workflow")));
  } else if (isWorkflowEntrypoint(workflowValue)) {
    validateEntrypoint(workflowValue, issues, joinPath(appPath, "workflow"));
  } else {
    validateWorkflowDefinition(workflowValue, context, issues, joinPath(appPath, "workflow"), {
      appId: isNonEmptyString(app.id) ? app.id : undefined,
      appTitle: isNonEmptyString(app.title) ? app.title : undefined,
      appSandboxProfiles: app.sandboxProfiles,
    });
    if (Array.isArray(app.inputs) && isWorkflowDefinition(workflowValue)) {
      validateMatchingInputs(app.inputs, workflowValue.inputs || [], issues, joinPath(appPath, "inputs"));
    }
  }

  return {
    valid: issues.length === 0,
    appId: isNonEmptyString(app.id) ? app.id : undefined,
    appPath,
    issues,
  };
}

export function assertValidWorkflowApp(
  candidate: unknown,
  context: WorkflowAppValidationContext,
  options: { appPath?: string; loadedWorkflow?: WorkflowDefinition } = {}
): asserts candidate is WorkflowAppDefinition {
  const result = validateWorkflowApp(candidate, context, options);
  if (!result.valid) {
    throw new WorkflowAppValidationError("Invalid workflow app", result.issues);
  }
}

/** `isAppCompatible` (WorkflowAppSummary.compatible): re-validate and check
 *  ONLY for a `workflow-app-incompatible` issue — see PLAN.md rebuild risk
 *  #3. */
export function isWorkflowAppCompatible(app: WorkflowAppDefinition, context: WorkflowAppValidationContext): boolean {
  return !validateWorkflowApp(app, context).issues.some((one) => one.code === "workflow-app-incompatible");
}

/** `validationIssuesFromError` — turns any thrown error (typically a
 *  `WorkflowAppValidationError`) into an issues array for the
 *  `{valid:false, issues}` catch-branch shape `cw app validate` needs on
 *  an unresolvable target. */
export function validationIssuesFromError(error: unknown): WorkflowAppValidationIssue[] {
  if (error instanceof WorkflowAppValidationError) return error.issues;
  return [{ code: "workflow-app-invalid", message: error instanceof Error ? error.message : String(error) }];
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
