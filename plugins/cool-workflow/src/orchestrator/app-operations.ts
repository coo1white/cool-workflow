// Workflow-app management domain operations (v0.1.40 self-audit router pattern).
// Carved out of CoolWorkflowRunner; pure functions (no instance state). Behavior
// is identical to the inline versions — the runner-owned calls (resolveFromBase,
// validateApp) are passed as callbacks so the bodies stay byte-identical.
import fs from "node:fs";
import path from "node:path";
import { LoadedWorkflowApp, WorkflowAppSummary, WorkflowAppValidationResult } from "../types";
import { slugify } from "../workflow-api";
import { writeJson } from "../state";
import {
  WorkflowAppValidationError,
  loadWorkflowAppFromEntrypoint,
  loadWorkflowAppFromManifest,
  renderWorkflowAppEntrypointTemplate,
  renderWorkflowAppManifestTemplate,
  summarizeWorkflowApp,
  validateWorkflowApp,
  workflowAppRunMetadata
} from "../workflow-app-framework";
import { validationIssuesFromError } from "./cli-options";

export function loadWorkflowFiles(workflowsDir: string): string[] {
  if (!fs.existsSync(workflowsDir)) return [];
  return fs
    .readdirSync(workflowsDir)
    .filter((file) => file.endsWith(".workflow.js"))
    .sort()
    .map((file) => path.join(workflowsDir, file));
}

export function loadAppManifestFiles(appsDir: string): string[] {
  if (!fs.existsSync(appsDir)) return [];
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name, "app.json"))
    .filter((file) => fs.existsSync(file))
    .sort();
}

export function loadWorkflowApps(workflowsDir: string, appsDir: string): LoadedWorkflowApp[] {
  const records = [
    ...loadWorkflowFiles(workflowsDir).map((file) => loadWorkflowAppFromEntrypoint(file)),
    ...loadAppManifestFiles(appsDir).map((file) => loadWorkflowAppFromManifest(file))
  ].sort((left, right) => {
    const byId = left.app.id.localeCompare(right.app.id);
    if (byId) return byId;
    return (left.source.manifestPath || left.source.entrypointPath || left.source.path)
      .localeCompare(right.source.manifestPath || right.source.entrypointPath || right.source.path);
  });
  const seen = new Map<string, LoadedWorkflowApp>();
  for (const record of records) {
    const previous = seen.get(record.app.id);
    if (previous) {
      throw new Error(
        `Duplicate workflow app id ${record.app.id}: ${previous.source.manifestPath || previous.source.entrypointPath || previous.source.path} and ${record.source.manifestPath || record.source.entrypointPath || record.source.path}`
      );
    }
    seen.set(record.app.id, record);
  }
  return records;
}

export function loadWorkflowAppById(workflowsDir: string, appsDir: string, appId: string): LoadedWorkflowApp {
  const record = loadWorkflowApps(workflowsDir, appsDir).find((candidate) => candidate.app.id === appId);
  if (!record) throw new Error(`Workflow app not found: ${appId}`);
  return record;
}

// The runner pre-resolves `target` via resolveFromBase and passes the resolved
// path; the original `target` is still used for the id-fallback lookup.
export function loadWorkflowAppTarget(workflowsDir: string, appsDir: string, resolved: string, target: string): LoadedWorkflowApp {
  if (!target) throw new Error("Missing workflow app path or id");
  if (fs.existsSync(resolved)) {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return loadWorkflowAppFromManifest(path.join(resolved, "app.json"));
    if (path.basename(resolved) === "app.json" || resolved.endsWith(".json")) return loadWorkflowAppFromManifest(resolved);
    return loadWorkflowAppFromEntrypoint(resolved);
  }
  return loadWorkflowAppById(workflowsDir, appsDir, target);
}

export function listWorkflows(workflowsDir: string, appsDir: string): Array<{ id: string; title: string; summary: string; file: string }> {
  return loadWorkflowApps(workflowsDir, appsDir).map((record) => {
    const summary = summarizeWorkflowApp(record);
    return {
      id: summary.id,
      title: summary.title,
      summary: summary.summary,
      file: summary.file
    };
  });
}

export function listApps(workflowsDir: string, appsDir: string): WorkflowAppSummary[] {
  return loadWorkflowApps(workflowsDir, appsDir).map((record) => summarizeWorkflowApp(record));
}

export function showApp(workflowsDir: string, appsDir: string, appId: string): Record<string, unknown> {
  const record = loadWorkflowAppById(workflowsDir, appsDir, appId);
  const summary = summarizeWorkflowApp(record);
  return {
    ...summary,
    source: record.source,
    app: {
      schemaVersion: record.app.schemaVersion,
      id: record.app.id,
      title: record.app.title,
      summary: record.app.summary || "",
      version: record.app.version,
      author: record.app.author,
      inputs: record.app.inputs || record.app.workflow.inputs,
      sandboxProfiles: record.app.sandboxProfiles || record.app.workflow.sandboxProfiles || [],
      compatibility: record.app.compatibility,
      metadata: record.app.metadata || {}
    },
    workflow: {
      id: record.app.workflow.id,
      title: record.app.workflow.title,
      summary: record.app.workflow.summary || "",
      limits: record.app.workflow.limits,
      inputs: record.app.workflow.inputs,
      sandboxProfiles: record.app.workflow.sandboxProfiles || [],
      phases: record.app.workflow.phases.map((phase) => ({
        id: phase.id,
        name: phase.name,
        status: phase.status,
        tasks: phase.tasks.map((task) => ({
          id: task.id,
          kind: task.kind,
          requiresEvidence: Boolean(task.requiresEvidence),
          sandboxProfileId: task.sandboxProfileId
        }))
      }))
    }
  };
}

// The runner pre-resolves `target` via resolveFromBase and passes the resolved
// path; both the try-loader and the catch-branch appPath use resolvedTarget.
export function validateApp(workflowsDir: string, appsDir: string, target: string, resolvedTarget: string): WorkflowAppValidationResult {
  try {
    const record = loadWorkflowAppTarget(workflowsDir, appsDir, resolvedTarget, target);
    const result = validateWorkflowApp(record.app, {
      appPath: record.source.manifestPath || record.source.entrypointPath || record.source.path
    });
    return {
      ...result,
      summary: summarizeWorkflowApp(record)
    };
  } catch (error) {
    const issues = validationIssuesFromError(error);
    return {
      valid: false,
      appId: target,
      appPath: resolvedTarget,
      issues
    };
  }
}

// resolveFromBase and validateApp are passed as callbacks so the body stays
// byte-identical to the runner method (resolveFromBase(...) and validateApp(manifestPath)).
export function initApp(
  appsDir: string,
  appId: string,
  options: Record<string, unknown>,
  resolveFromBase: (target: string) => string,
  validateApp: (manifestPath: string) => WorkflowAppValidationResult
): { id: string; manifestPath: string; entrypointPath: string } {
  const id = slugify(appId);
  if (!id) throw new Error("App id must include at least one letter or digit");
  const title = String(options.title || titleize(id));
  const destinationDir = resolveFromBase(String(options.directory || options.output || path.join(appsDir, id)));
  const manifestPath = path.join(destinationDir, "app.json");
  const entrypointPath = path.join(destinationDir, "workflow.js");
  if (!options.force && (fs.existsSync(manifestPath) || fs.existsSync(entrypointPath))) {
    throw new Error(`Refusing to overwrite existing workflow app: ${destinationDir}`);
  }
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.writeFileSync(manifestPath, renderWorkflowAppManifestTemplate(id, title), "utf8");
  fs.writeFileSync(entrypointPath, renderWorkflowAppEntrypointTemplate(id, title), "utf8");
  const validation = validateApp(manifestPath);
  if (!validation.valid) {
    throw new WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
  }
  return { id, manifestPath, entrypointPath };
}

// resolveFromBase is passed as a callback so the body stays byte-identical.
export function packageApp(
  workflowsDir: string,
  appsDir: string,
  appId: string,
  options: Record<string, unknown>,
  resolveFromBase: (target: string) => string
): { id: string; version: string; path: string } {
  const record = loadWorkflowAppById(workflowsDir, appsDir, appId);
  const destination = resolveFromBase(
    String(options.output || path.join(".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`))
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  writeJson(destination, {
    schemaVersion: 1,
    app: workflowAppRunMetadata(record),
    workflow: record.app.workflow,
    packagedAt: new Date().toISOString()
  });
  return { id: record.app.id, version: record.app.version, path: destination };
}

function titleize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
