// shell/workflow-app-loader.ts — MINIMAL, REAL workflow-app loader.
//
// See core/workflow-apps/app-schema.ts's file header for the exact
// subset this milestone builds vs. what milestone 12 (workflow-apps.md)
// still needs to add generically. This file `require()`s a real bundled
// app's `app.json` + `workflow.js` (the SAME two files
// plugins/cool-workflow/apps/<id>/ ships today) and interprets the REAL
// manifest — it does not hard-code any specific app's behavior.
//
// Bundled app root resolution: `CW_APPS_DIR` env override (used by
// conformance/tests to point at a fixture tree), else the real
// `plugins/cool-workflow/apps` directory shipped alongside this build
// (walked up from this file's own location), else `<cwd>/apps`.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  agent,
  artifact,
  createWorkflowApi,
  input,
  LoadedWorkflowApp,
  parallel,
  phase,
  WorkflowAppManifest,
  WorkflowDefinition,
  workflow,
} from "../core/workflow-apps/app-schema";

export class WorkflowAppNotFoundError extends Error {
  constructor(appId: string) {
    super(`Workflow app not found: ${appId}`);
    this.name = "WorkflowAppNotFoundError";
  }
}

function candidateAppsRoots(): string[] {
  const roots: string[] = [];
  if (process.env.CW_APPS_DIR) roots.push(path.resolve(process.env.CW_APPS_DIR));
  // Walk up from this file's own location looking for a sibling
  // plugins/cool-workflow/apps tree (the real bundled apps ship there in
  // this monorepo checkout).
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "plugins", "cool-workflow", "apps");
    roots.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  roots.push(path.join(process.cwd(), "apps"));
  return roots;
}

function findAppDir(appId: string): string | undefined {
  for (const root of candidateAppsRoots()) {
    const dir = path.join(root, appId);
    if (fs.existsSync(path.join(dir, "app.json"))) return dir;
  }
  return undefined;
}

/** Load one real bundled workflow app by id: reads its `app.json`
 *  manifest, then `require()`s its declared `workflow.entrypoint` factory
 *  file (the same `({workflow, phase, parallel, agent, artifact, input})
 *  => workflow({...})` shape the old build's workflow-api.ts factories
 *  produce), and returns the interpreted WorkflowDefinition. */
export function loadWorkflowApp(appId: string): LoadedWorkflowApp {
  const dir = findAppDir(appId);
  if (!dir) throw new WorkflowAppNotFoundError(appId);
  const manifestPath = path.join(dir, "app.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as WorkflowAppManifest;
  const entrypointPath = path.resolve(dir, manifest.workflow.entrypoint);
  // Workflow apps are plain runtime JavaScript, not TypeScript.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawExport = require(entrypointPath) as unknown;
  const selected = manifest.workflow.exportName && rawExport && typeof rawExport === "object" ? (rawExport as Record<string, unknown>)[manifest.workflow.exportName] : rawExport;
  if (typeof selected !== "function") {
    throw new Error(`Workflow app entrypoint must export a factory function: ${entrypointPath}`);
  }
  const definition = (selected as (api: ReturnType<typeof createWorkflowApi>) => WorkflowDefinition)({
    ...createWorkflowApi(),
    parallel,
    phase,
    workflow,
    agent,
    artifact,
    input,
  });
  return {
    id: manifest.id,
    title: manifest.title,
    summary: manifest.summary || definition.summary || "",
    version: manifest.version,
    author: manifest.author,
    workflow: definition,
    sandboxProfiles: manifest.sandboxProfiles || definition.sandboxProfiles || [],
    sourcePath: manifestPath,
  };
}
