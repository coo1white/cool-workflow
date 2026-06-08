import type { PhaseStatus, TaskKind, TaskStatus } from "./core";

export interface WorkflowLimits {
  maxAgents: number;
  maxConcurrentAgents: number;
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
}

export interface WorkflowPhaseDefinition {
  id: string;
  name: string;
  status: PhaseStatus;
  tasks: WorkflowTaskDefinition[];
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
