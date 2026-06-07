import fs from "node:fs";
import path from "node:path";
import {
  LoadedWorkflowApp,
  WorkflowAppDefinition,
  WorkflowAppEntrypoint,
  WorkflowAppRunMetadata,
  WorkflowAppSource,
  WorkflowAppSummary,
  WorkflowAppValidationIssue,
  WorkflowAppValidationResult,
  WorkflowDefinition,
  WorkflowInputDefinition,
  WorkflowPhaseDefinition,
  WorkflowTaskDefinition
} from "./types";
import {
  agent,
  artifact,
  createWorkflowApi,
  input,
  phase,
  slugify,
  workflow
} from "./workflow-api";
import { bundledSandboxProfileIds, isBundledSandboxProfileId } from "./sandbox-profile";
import {
  CURRENT_COOL_WORKFLOW_VERSION,
  WORKFLOW_APP_SCHEMA_VERSION
} from "./version";

export {
  agent,
  artifact,
  createWorkflowApi,
  input,
  phase,
  slugify,
  workflow
};

export class WorkflowAppValidationError extends Error {
  issues: WorkflowAppValidationIssue[];

  constructor(message: string, issues: WorkflowAppValidationIssue[]) {
    super(`${message}: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "WorkflowAppValidationError";
    this.issues = issues;
  }
}

export function defineWorkflowApp(definition: WorkflowAppDefinition): WorkflowAppDefinition {
  assertValidWorkflowApp(definition, { appPath: "inline" });
  return definition;
}

export function validateWorkflowApp(
  candidate: unknown,
  options: { appPath?: string; loadedWorkflow?: WorkflowDefinition } = {}
): WorkflowAppValidationResult {
  const issues: WorkflowAppValidationIssue[] = [];
  const appPath = options.appPath;

  if (!isRecord(candidate)) {
    return {
      valid: false,
      appPath,
      issues: [issue("workflow-app-invalid", "Workflow app must be an object", appPath)]
    };
  }

  const app = candidate as Partial<WorkflowAppDefinition>;
  if (app.schemaVersion !== WORKFLOW_APP_SCHEMA_VERSION) {
    issues.push(issue("workflow-app-schema-version", `Workflow app schemaVersion must be ${WORKFLOW_APP_SCHEMA_VERSION}`, joinPath(appPath, "schemaVersion")));
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
  validateSandboxProfileReferences(app.sandboxProfiles, issues, joinPath(appPath, "sandboxProfiles"), { optional: true });
  validateCompatibility(app.compatibility, issues, joinPath(appPath, "compatibility"));

  const workflowValue = options.loadedWorkflow || app.workflow;
  if (!workflowValue) {
    issues.push(issue("workflow-app-workflow", "Workflow app workflow is required", joinPath(appPath, "workflow")));
  } else if (isWorkflowEntrypoint(workflowValue)) {
    validateEntrypoint(workflowValue, issues, joinPath(appPath, "workflow"));
  } else {
    validateWorkflowDefinition(workflowValue, issues, joinPath(appPath, "workflow"), {
      appId: isNonEmptyString(app.id) ? app.id : undefined,
      appTitle: isNonEmptyString(app.title) ? app.title : undefined,
      appSandboxProfiles: app.sandboxProfiles
    });
    if (Array.isArray(app.inputs) && isWorkflowDefinition(workflowValue)) {
      validateMatchingInputs(app.inputs, workflowValue.inputs || [], issues, joinPath(appPath, "inputs"));
    }
  }

  return {
    valid: issues.length === 0,
    appId: isNonEmptyString(app.id) ? app.id : undefined,
    appPath,
    issues
  };
}

export function assertValidWorkflowApp(
  candidate: unknown,
  options: { appPath?: string; loadedWorkflow?: WorkflowDefinition } = {}
): asserts candidate is WorkflowAppDefinition {
  const result = validateWorkflowApp(candidate, options);
  if (!result.valid) {
    throw new WorkflowAppValidationError("Invalid workflow app", result.issues);
  }
}

export function validateWorkflowDefinition(
  candidate: unknown,
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
  validateSandboxProfileReferences(workflowDefinition.sandboxProfiles, issues, joinPath(basePath, "sandboxProfiles"), { optional: true });
  validatePhases(workflowDefinition.phases, workflowDefinition.limits, issues, joinPath(basePath, "phases"), {
    appSandboxProfiles: options.appSandboxProfiles || workflowDefinition.sandboxProfiles
  });
  return issues;
}

export function loadWorkflowAppFromEntrypoint(file: string, options: { exportName?: string; sourceKind?: WorkflowAppSource["kind"] } = {}): LoadedWorkflowApp {
  const entrypointPath = path.resolve(file);
  const materialized = materializeModuleExport(entrypointPath, options.exportName);
  const loaded = extractWorkflowAppExport(materialized, entrypointPath);
  const source: WorkflowAppSource = {
    kind: options.sourceKind || "workflow-file",
    path: entrypointPath,
    entrypointPath
  };

  if (loaded.app) {
    const app = {
      ...loaded.app,
      workflow: loaded.workflow
    } as WorkflowAppDefinition & { workflow: WorkflowDefinition };
    assertValidWorkflowApp(app, { appPath: entrypointPath });
    return { app, source, legacy: false };
  }

  const app = createLegacyWorkflowApp(loaded.workflow, source);
  assertValidWorkflowApp(app, { appPath: entrypointPath });
  return { app, source, legacy: true };
}

export function loadWorkflowAppFromManifest(manifestPath: string): LoadedWorkflowApp {
  const absoluteManifestPath = path.resolve(manifestPath);
  if (!fs.existsSync(absoluteManifestPath)) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", [
      issue("workflow-app-manifest-not-found", `Workflow app manifest does not exist: ${absoluteManifestPath}`, absoluteManifestPath)
    ]);
  }

  let manifest: WorkflowAppDefinition;
  try {
    manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8")) as WorkflowAppDefinition;
  } catch (error) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", [
      issue("workflow-app-manifest-json", `Workflow app manifest is not valid JSON: ${messageOf(error)}`, absoluteManifestPath)
    ]);
  }

  const manifestValidation = validateWorkflowApp(manifest, { appPath: absoluteManifestPath });
  if (!manifestValidation.valid) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", manifestValidation.issues);
  }
  if (!isWorkflowEntrypoint(manifest.workflow)) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", [
      issue("workflow-app-entrypoint", "Manifest workflow must be an entrypoint object", joinPath(absoluteManifestPath, "workflow"))
    ]);
  }

  const entrypointPath = path.resolve(path.dirname(absoluteManifestPath), manifest.workflow.entrypoint);
  const materialized = materializeModuleExport(entrypointPath, manifest.workflow.exportName);
  const loaded = extractWorkflowAppExport(materialized, entrypointPath);
  const workflowDefinition = loaded.workflow;
  const source: WorkflowAppSource = {
    kind: path.basename(absoluteManifestPath) === "app.json" ? "app-directory" : "app-manifest",
    path: path.dirname(absoluteManifestPath),
    manifestPath: absoluteManifestPath,
    entrypointPath
  };

  if (loaded.app) {
    validateEntrypointAppMatchesManifest(loaded.app, manifest, absoluteManifestPath);
  }

  const app = {
    ...manifest,
    workflow: workflowDefinition
  } as WorkflowAppDefinition & { workflow: WorkflowDefinition };
  assertValidWorkflowApp(app, {
    appPath: absoluteManifestPath,
    loadedWorkflow: workflowDefinition
  });
  return { app, source, legacy: false };
}

export function summarizeWorkflowApp(record: LoadedWorkflowApp): WorkflowAppSummary {
  const workflowDefinition = record.app.workflow;
  const sandboxProfiles = record.app.sandboxProfiles || workflowDefinition.sandboxProfiles || [];
  const summary: WorkflowAppSummary = {
    id: record.app.id,
    title: record.app.title,
    summary: record.app.summary || workflowDefinition.summary || "",
    version: record.app.version,
    author: record.app.author,
    file: record.source.entrypointPath || record.source.manifestPath || record.source.path,
    sourceKind: record.source.kind,
    legacy: record.legacy,
    compatible: isAppCompatible(record.app),
    inputs: record.app.inputs || workflowDefinition.inputs || [],
    sandboxProfiles,
    phases: workflowDefinition.phases.map((phaseDefinition) => ({
      id: phaseDefinition.id,
      name: phaseDefinition.name,
      taskCount: phaseDefinition.tasks.length
    })),
    taskCount: workflowDefinition.phases.reduce((total, phaseDefinition) => total + phaseDefinition.tasks.length, 0)
  };
  return summary;
}

export function workflowAppRunMetadata(record: LoadedWorkflowApp): WorkflowAppRunMetadata {
  return {
    schemaVersion: WORKFLOW_APP_SCHEMA_VERSION,
    id: record.app.id,
    title: record.app.title,
    summary: record.app.summary || record.app.workflow.summary || "",
    version: record.app.version,
    author: record.app.author,
    compatibility: record.app.compatibility,
    sandboxProfiles: record.app.sandboxProfiles || record.app.workflow.sandboxProfiles,
    source: record.source,
    metadata: record.app.metadata
  };
}

export function createLegacyWorkflowApp(
  workflowDefinition: WorkflowDefinition,
  source: WorkflowAppSource
): WorkflowAppDefinition & { workflow: WorkflowDefinition } {
  return {
    schemaVersion: WORKFLOW_APP_SCHEMA_VERSION,
    id: workflowDefinition.id,
    title: workflowDefinition.title,
    summary: workflowDefinition.summary || "",
    version: "0.0.0",
    workflow: workflowDefinition,
    inputs: workflowDefinition.inputs || [],
    sandboxProfiles: workflowDefinition.sandboxProfiles || collectWorkflowSandboxProfiles(workflowDefinition),
    compatibility: {
      maxVersion: CURRENT_COOL_WORKFLOW_VERSION,
      notes: "Compatibility wrapper for legacy .workflow.js factory files."
    },
    metadata: {
      legacyWorkflow: true,
      sourcePath: source.path
    }
  };
}

export function renderWorkflowAppTemplate(id: string, title: string): string {
  return `const { defineWorkflowApp, workflow, phase, agent, artifact, input } = require("../dist/workflow-app-sdk");\n\nconst inputs = [\n  input("question", { required: true, description: "Question or task this workflow should answer." })\n];\n\nmodule.exports = defineWorkflowApp({\n  schemaVersion: 1,\n  id: ${JSON.stringify(id)},\n  title: ${JSON.stringify(title)},\n  summary: "Describe what this workflow app does.",\n  version: "0.1.0",\n  author: "COOLWHITE LLC",\n  inputs,\n  sandboxProfiles: ["readonly"],\n  compatibility: {\n    minVersion: "0.1.9"\n  },\n  workflow: workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow app does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs,\n    sandboxProfiles: ["readonly"],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true, sandboxProfileId: "readonly" })\n      ])\n    ]\n  })\n});\n`;
}

export function renderWorkflowAppManifestTemplate(id: string, title: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: WORKFLOW_APP_SCHEMA_VERSION,
      id,
      title,
      summary: "Describe what this workflow app does.",
      version: "0.1.0",
      author: "COOLWHITE LLC",
      inputs: [
        {
          name: "question",
          type: "string",
          required: true,
          description: "Question or task this workflow should answer."
        }
      ],
      sandboxProfiles: ["readonly"],
      compatibility: {
        minVersion: "0.1.9"
      },
      workflow: {
        entrypoint: "workflow.js"
      }
    },
    null,
    2
  )}\n`;
}

export function renderWorkflowAppEntrypointTemplate(id: string, title: string): string {
  return `module.exports = ({ workflow, phase, agent, artifact, input }) => {\n  const inputs = [\n    input("question", { type: "string", required: true, description: "Question or task this workflow should answer." })\n  ];\n\n  return workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow app does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs,\n    sandboxProfiles: ["readonly"],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true, sandboxProfileId: "readonly" })\n      ])\n    ]\n  });\n};\n`;
}

function materializeModuleExport(file: string, exportName?: string): unknown {
  if (!fs.existsSync(file)) {
    throw new WorkflowAppValidationError("Invalid workflow app entrypoint", [
      issue("workflow-app-entrypoint-not-found", `Workflow app entrypoint does not exist: ${file}`, file)
    ]);
  }
  // Workflow apps are plain runtime JavaScript, not TypeScript.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawExport = require(file) as unknown;
  const selectedExport = exportName && isRecord(rawExport) ? rawExport[exportName] : rawExport;
  if (exportName && selectedExport === undefined) {
    throw new WorkflowAppValidationError("Invalid workflow app entrypoint", [
      issue("workflow-app-entrypoint-export", `Workflow app entrypoint does not export ${exportName}`, file)
    ]);
  }
  if (typeof selectedExport === "function") {
    return selectedExport({
      ...createWorkflowApi(),
      defineWorkflowApp
    });
  }
  return selectedExport;
}

function extractWorkflowAppExport(value: unknown, file: string): { app?: WorkflowAppDefinition; workflow: WorkflowDefinition } {
  if (isWorkflowAppDefinition(value) && isWorkflowDefinition(value.workflow)) {
    return {
      app: value,
      workflow: value.workflow
    };
  }
  if (isWorkflowDefinition(value)) {
    return { workflow: value };
  }
  throw new WorkflowAppValidationError("Invalid workflow app entrypoint", [
    issue("workflow-app-entrypoint-export", "Workflow app entrypoint must export a workflow definition, workflow app, or factory", file)
  ]);
}

function validateEntrypointAppMatchesManifest(
  entrypointApp: WorkflowAppDefinition,
  manifest: WorkflowAppDefinition,
  manifestPath: string
): void {
  const issues: WorkflowAppValidationIssue[] = [];
  for (const key of ["schemaVersion", "id", "title", "version"] as const) {
    if (entrypointApp[key] !== manifest[key]) {
      issues.push(issue("workflow-app-manifest-mismatch", `Entrypoint app ${key} must match manifest ${key}`, joinPath(manifestPath, key)));
    }
  }
  if (issues.length) throw new WorkflowAppValidationError("Invalid workflow app manifest", issues);
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
    issues.push(issue("workflow-limits", "Workflow limits.maxConcurrentAgents must be less than or equal to maxAgents", joinPath(pathName, "maxConcurrentAgents")));
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
  pathName?: string,
  options: { optional: boolean } = { optional: false }
): void {
  if (profiles === undefined && options.optional) return;
  if (!Array.isArray(profiles)) {
    issues.push(issue("workflow-sandbox-profiles", "Workflow sandboxProfiles must be an array", pathName));
    return;
  }
  const seen = new Set<string>();
  const bundled = bundledSandboxProfileIds();
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
    if (!isBundledSandboxProfileId(value)) {
      issues.push(issue("workflow-sandbox-profile-unknown", `Unknown sandbox profile ${value}; bundled profiles: ${bundled.join(", ")}`, profilePath));
    }
  }
}

function validateCompatibility(value: unknown, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push(issue("workflow-app-compatibility", "Workflow app compatibility must be an object", pathName));
    return;
  }
  if (value.workflowSchemaVersion !== undefined && value.workflowSchemaVersion !== WORKFLOW_APP_SCHEMA_VERSION) {
    issues.push(issue("workflow-app-compatibility", `Workflow schema version must be ${WORKFLOW_APP_SCHEMA_VERSION}`, joinPath(pathName, "workflowSchemaVersion")));
  }
  for (const key of ["coolWorkflow", "node", "notes"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      issues.push(issue("workflow-app-compatibility", `Compatibility ${key} must be a string`, joinPath(pathName, key)));
    }
  }
  if (value.minVersion !== undefined) {
    if (!isSemver(value.minVersion)) {
      issues.push(issue("workflow-app-compatibility", "Compatibility minVersion must be semver", joinPath(pathName, "minVersion")));
    } else if (compareSemver(CURRENT_COOL_WORKFLOW_VERSION, value.minVersion) < 0) {
      issues.push(issue("workflow-app-incompatible", `Workflow app requires Cool Workflow >= ${value.minVersion}; current is ${CURRENT_COOL_WORKFLOW_VERSION}`, joinPath(pathName, "minVersion")));
    }
  }
  if (value.maxVersion !== undefined) {
    if (!isSemver(value.maxVersion)) {
      issues.push(issue("workflow-app-compatibility", "Compatibility maxVersion must be semver", joinPath(pathName, "maxVersion")));
    } else if (compareSemver(CURRENT_COOL_WORKFLOW_VERSION, value.maxVersion) > 0) {
      issues.push(issue("workflow-app-incompatible", `Workflow app supports Cool Workflow <= ${value.maxVersion}; current is ${CURRENT_COOL_WORKFLOW_VERSION}`, joinPath(pathName, "maxVersion")));
    }
  }
}

function validateEntrypoint(value: WorkflowAppEntrypoint, issues: WorkflowAppValidationIssue[], pathName?: string): void {
  if (!isNonEmptyString(value.entrypoint)) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.entrypoint is required", joinPath(pathName, "entrypoint")));
  }
  if (value.entrypoint && path.isAbsolute(value.entrypoint)) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.entrypoint must be relative", joinPath(pathName, "entrypoint")));
  }
  if (value.entrypoint && value.entrypoint.split(/[\\/]/).includes("..")) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.entrypoint must not contain traversal", joinPath(pathName, "entrypoint")));
  }
  if (value.exportName !== undefined && !isNonEmptyString(value.exportName)) {
    issues.push(issue("workflow-app-entrypoint", "Workflow app workflow.exportName must be a string", joinPath(pathName, "exportName")));
  }
}

function validatePhases(
  phases: unknown,
  limits: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName?: string,
  options: { appSandboxProfiles?: string[] } = {}
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
}

function validateTask(
  taskDefinition: unknown,
  issues: WorkflowAppValidationIssue[],
  pathName: string | undefined,
  seenTaskIds: Set<string>,
  options: { appSandboxProfiles?: string[] }
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
    issues.push(issue("workflow-task-evidence", `Workflow task ${String(taskValue.id || "")} requiresEvidence must be boolean`, joinPath(pathName, "requiresEvidence")));
  }
  const sandboxProfileId = taskValue.sandboxProfileId;
  if (sandboxProfileId !== undefined) {
    if (!isNonEmptyString(sandboxProfileId)) {
      issues.push(issue("workflow-task-sandbox-profile", `Workflow task ${String(taskValue.id || "")} sandboxProfileId must be a string`, joinPath(pathName, "sandboxProfileId")));
    } else if (!isBundledSandboxProfileId(sandboxProfileId)) {
      issues.push(issue("workflow-task-sandbox-profile", `Workflow task ${String(taskValue.id || "")} references unknown sandbox profile ${sandboxProfileId}`, joinPath(pathName, "sandboxProfileId")));
    } else if (options.appSandboxProfiles && !options.appSandboxProfiles.includes(sandboxProfileId)) {
      issues.push(issue("workflow-task-sandbox-profile", `Workflow task ${String(taskValue.id || "")} sandbox profile ${sandboxProfileId} must be listed in app sandboxProfiles`, joinPath(pathName, "sandboxProfileId")));
    }
  }
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

function isWorkflowAppDefinition(value: unknown): value is WorkflowAppDefinition {
  return isRecord(value) && value.schemaVersion === WORKFLOW_APP_SCHEMA_VERSION && isNonEmptyString(value.id) && "workflow" in value;
}

function isWorkflowEntrypoint(value: unknown): value is WorkflowAppEntrypoint {
  return isRecord(value) && "entrypoint" in value && !("phases" in value);
}

function isAppCompatible(app: WorkflowAppDefinition): boolean {
  return !validateWorkflowApp(app).issues.some((compatIssue) => compatIssue.code === "workflow-app-incompatible");
}

function collectWorkflowSandboxProfiles(workflowDefinition: WorkflowDefinition): string[] {
  const profiles = new Set<string>();
  for (const phaseDefinition of workflowDefinition.phases) {
    for (const taskDefinition of phaseDefinition.tasks) {
      if (taskDefinition.sandboxProfileId) profiles.add(taskDefinition.sandboxProfileId);
    }
  }
  return [...profiles].sort();
}

function compareSemver(left: string, right: string): number {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function semverParts(value: string): [number, number, number] {
  const [major, minor, patch] = value.split(/[+-]/)[0].split(".").map((part) => Number(part));
  return [major || 0, minor || 0, patch || 0];
}

function isSemver(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function issue(code: string, message: string, pathName?: string): WorkflowAppValidationIssue {
  return {
    code,
    message,
    path: pathName
  };
}

function joinPath(basePath: string | undefined, segment: string): string | undefined {
  if (!basePath) return segment;
  return `${basePath}.${segment}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
