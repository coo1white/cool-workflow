import type { PhaseStatus, TaskKind, TaskStatus } from "./core";
import type { PipelineContract } from "./pipeline";

export interface WorkflowLimits {
  maxAgents: number;
  maxConcurrentAgents: number;
  /** Optional ceiling on total delegated agent tokens for the run. Enforced by the
   *  drive loop against ATTESTED usage, not measured by CW. Declared in v0.1.x;
   *  enforcement lands with the metrics-join slice. */
  tokenBudget?: number;
}

export interface WorkflowInputDefinition {
  name: string;
  type?: "string" | "number" | "boolean" | "path" | "json";
  description?: string;
  required?: boolean;
  repeated?: boolean;
  default?: unknown;
}

export interface WorkflowTaskDefinition {
  id: string;
  kind: TaskKind;
  prompt: string;
  status: TaskStatus;
  requiresEvidence?: boolean;
  sandboxProfileId?: string;
  /** Human-facing display label for the agent in progress/operator views. */
  label?: string;
  /** Operator model-policy hint passed to the delegated agent ({{model}}); NEVER
   *  the attested model — that comes only from the agent's own report. */
  model?: string;
  /** Names which delegating backend driver fulfills this task (default: "agent"). */
  agentType?: string;
  /** Optional declared output schema for the agent's result. Carried through the
   *  plan; validation enforcement lands with the schema-validation slice. */
  schema?: Record<string, unknown>;
  /** Optional result-cache mechanism. A task may opt in to reusing a previously
   *  accepted result when the named input (for example `sourceContextDigest`) and
   *  rendered prompt digest match. Policy stays in the app; the drive loop only
   *  provides the mechanism. */
  resultCache?: WorkflowTaskResultCache;
  /** Optional inline SUB-WORKFLOW. When set, this task is fulfilled by planning and
   *  driving a CHILD app run (not by spawning an agent directly); the child's report
   *  becomes this task's result, so the parent's verifier/schema gate and downstream
   *  tasks consume it like any other result. Composition stays declarative; the leaf
   *  work is still external-agent delegation at every nesting level. */
  subWorkflow?: WorkflowSubWorkflowDefinition;
}

export interface WorkflowSubWorkflowDefinition {
  /** Child app id to plan + drive. */
  appId: string;
  /** Child input templates, rendered against the PARENT run's inputs (so the child's
   *  inputs are a pure function of recorded parent inputs — deterministic). When
   *  omitted, the child inherits the parent's `repo`/`cwd` and `question`. */
  inputs?: Record<string, string>;
  /** Which child bytes become the parent result: the rendered `report` (default) or
   *  the child's verdict/synthesis `result`. */
  bindResult?: "report" | "verdict-result";
}

export interface WorkflowTaskResultCache {
  mode?: "read-write";
  keyInput: string;
  /** Optional stable dependency scope folded into the cache key. Use
   *  `previous-phases` for tasks whose result summarizes earlier completed
   *  workers; cache hits then require those result bytes to match too. */
  includeCompletedResults?: "previous-phases";
}

export interface WorkflowPhaseDefinition {
  id: string;
  name: string;
  status: PhaseStatus;
  tasks: WorkflowTaskDefinition[];
  /** How the drive loop fulfills this phase's tasks. "sequential" (default) keeps
   *  the existing one-agent-at-a-time behavior; "parallel" lets the concurrent
   *  driver fulfill the phase's pending tasks as one deterministic batch. */
  mode?: "sequential" | "parallel";
}

export interface WorkflowDefinition {
  id: string;
  title: string;
  summary?: string;
  limits: WorkflowLimits;
  inputs: WorkflowInputDefinition[];
  phases: WorkflowPhaseDefinition[];
  sandboxProfiles?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkflowAppEntrypoint {
  entrypoint: string;
  exportName?: string;
}

export type WorkflowAppWorkflow = WorkflowDefinition | WorkflowAppEntrypoint;

export interface WorkflowAppCompatibility {
  minVersion?: string;
  maxVersion?: string;
  coolWorkflow?: string;
  workflowSchemaVersion?: 1;
  node?: string;
  notes?: string;
}

export interface WorkflowAppDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  summary?: string;
  version: string;
  author?: string | { name: string; url?: string; email?: string };
  workflow: WorkflowAppWorkflow;
  inputs?: WorkflowInputDefinition[];
  sandboxProfiles?: string[];
  compatibility?: WorkflowAppCompatibility;
  /** Optional custom pipeline contract. Fields override the default pipeline.
   *  Apps can tune stages, failure policy, evidence policy, and commit policy
   *  without replacing the entire contract (v0.1.56). */
  pipeline?: Partial<PipelineContract>;
  metadata?: Record<string, unknown>;
}

export type WorkflowAppSourceKind = "app-directory" | "app-manifest" | "workflow-file";

export interface WorkflowAppSource {
  kind: WorkflowAppSourceKind;
  path: string;
  manifestPath?: string;
  entrypointPath?: string;
}

export interface LoadedWorkflowApp {
  app: WorkflowAppDefinition & { workflow: WorkflowDefinition };
  source: WorkflowAppSource;
  legacy: boolean;
}

export interface WorkflowAppSummary {
  id: string;
  title: string;
  summary: string;
  version: string;
  author?: WorkflowAppDefinition["author"];
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

export interface WorkflowAppRunMetadata {
  schemaVersion: 1;
  id: string;
  title: string;
  summary?: string;
  version: string;
  author?: WorkflowAppDefinition["author"];
  compatibility?: WorkflowAppCompatibility;
  sandboxProfiles?: string[];
  source?: WorkflowAppSource;
  metadata?: Record<string, unknown>;
}
