// shell/workflow-app-loader.ts — the real workflow-app loader + discovery.
//
// See core/workflow-apps/app-schema.ts's file header for the validation
// half this file calls into. This file `require()`s real bundled apps'
// `app.json` + `workflow.js` (the SAME files
// plugins/cool-workflow/apps/<id>/ ships today, plus the legacy
// `workflows/<name>.workflow.js` factory files) and interprets the REAL
// manifest — it does not hard-code any specific app's behavior.
//
// Bundled app root resolution: `CW_APPS_DIR` env override (used by
// conformance/tests to point at a fixture tree), else the real
// `plugins/cool-workflow/apps` directory shipped alongside this build
// (walked up from this file's own location), else `<cwd>/apps`. The
// legacy `workflows/` root sits alongside `apps/` (one level up), same
// walk-up resolution, `CW_WORKFLOWS_DIR` override.
//
// MILESTONE 12 additions on top of the milestone 6+7 minimal loader
// (`loadWorkflowApp`, kept byte-for-byte — `shell/drive.ts` and
// `shell/pipeline-cli.ts` call it directly and must keep working):
//   - `listWorkflowApps()` / `listWorkflows()` — full discovery over BOTH
//     `apps/*/app.json` and legacy `workflows/*.workflow.js`, sorted by
//     id then source path, fail-closed on a duplicate app id.
//   - `loadWorkflowAppRecordById()` — the full LoadedWorkflowAppRecord
//     (source kind, legacy flag, compatibility) `app show`/`app validate`
//     need, vs. the minimal `LoadedWorkflowApp` `plan`/`drive` use.
//   - `showWorkflowApp()` / `validateWorkflowAppTarget()` / `initApp()` /
//     `packageApp()` — the `cw app show|validate|init|package` bodies.

import * as fs from "node:fs";
import * as path from "node:path";
import {
  agent,
  artifact,
  createWorkflowApi,
  input,
  isWorkflowAppCompatible,
  LoadedWorkflowApp,
  LoadedWorkflowAppRecord,
  loop,
  parallel,
  phase,
  slugify,
  subWorkflow,
  validateWorkflowApp,
  validationIssuesFromError,
  WorkflowAppAuthor,
  WorkflowAppDefinition,
  WorkflowAppManifest,
  WorkflowAppSource,
  WorkflowAppSummary,
  WorkflowAppValidationContext,
  WorkflowAppValidationError,
  WorkflowAppValidationResult,
  WorkflowDefinition,
  workflow,
} from "../core/workflow-apps/app-schema";
import { bundledSandboxProfileIds } from "./sandbox-profile";
import { CURRENT_COOL_WORKFLOW_VERSION } from "../core/version";
import { stableCompare } from "../core/util/collate";

export class WorkflowAppNotFoundError extends Error {
  constructor(appId: string) {
    super(`Workflow app not found: ${appId}`);
    this.name = "WorkflowAppNotFoundError";
  }
}

function walkUpFor(...tail: string[]): string[] {
  const roots: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    roots.push(path.join(dir, "plugins", "cool-workflow", ...tail));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

/** Walk up from this file's own location and, at each ancestor that looks
 *  like the package root (has a package.json), yield `<pkgRoot>/<tail>`.
 *  On a published/globally-installed package the bundled `apps/`+`workflows/`
 *  sit at the PACKAGE ROOT (`<pkg>/apps`), NOT under a nested
 *  `plugins/cool-workflow/` segment — walkUpFor above only ever builds the
 *  nested monorepo path, so a global install found 0 apps. This restores the
 *  old build's resolvePluginRoot behavior (find the dir with package.json,
 *  then read `<pluginRoot>/apps`). The loader lives at
 *  `<pkg>/dist/shell/workflow-app-loader.js`, so `<pkg>` is two hops up. */
function walkUpForPackageRoot(...tail: string[]): string[] {
  const roots: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      roots.push(path.join(dir, ...tail));
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return roots;
}

function candidateAppsRoots(): string[] {
  const roots: string[] = [];
  if (process.env.CW_APPS_DIR) roots.push(path.resolve(process.env.CW_APPS_DIR));
  // Walk up from this file's own location looking for a sibling
  // plugins/cool-workflow/apps tree (the real bundled apps ship there in
  // this monorepo checkout).
  roots.push(...walkUpFor("apps"));
  // ...and for the package-root `<pkg>/apps` tree an npm-installed (global or
  // local) package ships. Placed before the cwd fallback so bundled apps win.
  roots.push(...walkUpForPackageRoot("apps"));
  roots.push(path.join(process.cwd(), "apps"));
  return roots;
}

function candidateWorkflowsRoots(): string[] {
  const roots: string[] = [];
  if (process.env.CW_WORKFLOWS_DIR) roots.push(path.resolve(process.env.CW_WORKFLOWS_DIR));
  roots.push(...walkUpFor("workflows"));
  roots.push(...walkUpForPackageRoot("workflows"));
  roots.push(path.join(process.cwd(), "workflows"));
  return roots;
}

/** Whether `candidate` resolves to `root` itself or a real descendant of it
 *  (not an ancestor, sibling, or anywhere reached only via `..` segments). */
function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findAppDir(appId: string): string | undefined {
  for (const root of candidateAppsRoots()) {
    const dir = path.join(root, appId);
    // appId is caller-controlled (MCP app.run, `cw plan`/`run --drive`, a
    // sub-workflow's spec.appId). Without this check a traversal id like
    // "../../../tmp/evil-app" walks path.join right out of every trusted
    // root and loadWorkflowApp below require()s whatever app.json it finds
    // there with NO manifest/entrypoint validation — the fast path this
    // function feeds skips validateWorkflowApp entirely (see loadWorkflowApp).
    if (!isWithinRoot(root, dir)) continue;
    if (fs.existsSync(path.join(dir, "app.json"))) return dir;
  }
  return undefined;
}

/** Every root candidateAppsRoots()/candidateWorkflowsRoots() would search:
 *  bundled apps/workflows, an installed package's apps/workflows, an
 *  operator-set CW_APPS_DIR/CW_WORKFLOWS_DIR, and the caller's cwd/apps +
 *  cwd/workflows (the "cw app init" default — must stay unwarned, it is
 *  the normal flow for a user's own local apps). */
export function isTrustedAppSourcePath(resolvedPath: string): boolean {
  const roots = [...candidateAppsRoots(), ...candidateWorkflowsRoots()];
  return roots.some((root) => isWithinRoot(path.resolve(root), resolvedPath));
}

function validationContext(): WorkflowAppValidationContext {
  return { bundledSandboxProfileIds: bundledSandboxProfileIds(), currentCoolWorkflowVersion: CURRENT_COOL_WORKFLOW_VERSION };
}

function authorNameOf(author: WorkflowAppAuthor | undefined): string | undefined {
  if (typeof author === "string") return author;
  if (author && typeof author === "object" && typeof author.name === "string") return author.name;
  return undefined;
}

/** Convert a discovery record (from listWorkflowAppRecords) into the minimal
 *  LoadedWorkflowApp shape `plan`/`drive` consume. Used as the fallback path
 *  in loadWorkflowApp so a legacy `<name>.workflow.js` wrapper — which `cw
 *  list`/`cw app list` already resolve as a record but which has no
 *  `apps/<id>/app.json` directory — can also be planned by id. Without this,
 *  `cw plan legacy-research-synthesis` died "Workflow app not found" even
 *  though `cw list` shows it. */
function loadedAppFromRecord(record: LoadedWorkflowAppRecord): LoadedWorkflowApp {
  const workflowDefinition = record.app.workflow as WorkflowDefinition;
  const entrypointPath = record.source.entrypointPath || record.source.path;
  return {
    id: record.app.id,
    title: record.app.title,
    summary: record.app.summary || workflowDefinition.summary || "",
    version: record.app.version,
    author: authorNameOf(record.app.author),
    workflow: workflowDefinition,
    sandboxProfiles: record.app.sandboxProfiles || workflowDefinition.sandboxProfiles || [],
    sourcePath: sourcePathOf(record),
    entrypointPath,
    trustedRoot: isTrustedAppSourcePath(entrypointPath),
    compatibility: record.app.compatibility,
    metadata: record.app.metadata,
  };
}

/** Load one real bundled workflow app by id: reads its `app.json`
 *  manifest, then `require()`s its declared `workflow.entrypoint` factory
 *  file (the same `({workflow, phase, parallel, agent, artifact, input})
 *  => workflow({...})` shape the old build's workflow-api.ts factories
 *  produce), and returns the interpreted WorkflowDefinition. A legacy
 *  workflow-file id (no `apps/<id>/app.json`) resolves through the record
 *  fallback below. */
export function loadWorkflowApp(appId: string): LoadedWorkflowApp {
  const dir = findAppDir(appId);
  if (!dir) {
    // No `apps/<id>/app.json` directory: fall back to the full discovery set
    // (app directories + legacy `<name>.workflow.js` wrappers) so a legacy
    // workflow-file app id resolves for plan/drive the same way `cw list`
    // resolves it. loadWorkflowAppRecordById throws WorkflowAppNotFoundError
    // when nothing matches, preserving the not-found contract.
    return loadedAppFromRecord(loadWorkflowAppRecordById(appId));
  }
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
    author: authorNameOf(manifest.author),
    workflow: definition,
    sandboxProfiles: manifest.sandboxProfiles || definition.sandboxProfiles || [],
    sourcePath: manifestPath,
    entrypointPath,
    trustedRoot: isTrustedAppSourcePath(entrypointPath),
    // Thread the manifest's compatibility window + metadata (incl. domain)
    // into the loaded app so workflowAppRunMetadata can stamp them onto
    // run.workflow.app — this is what lets report.md label a research-domain
    // run's source line "Source:" instead of "Repository:".
    compatibility: manifest.compatibility,
    metadata: manifest.metadata,
  };
}

// ---------------------------------------------------------------------
// Full discovery: apps/*/app.json + legacy workflows/*.workflow.js
// (MILESTONE 12). Byte-exact in spirit to
// src/orchestrator/app-operations.ts's loadWorkflowApps/listApps/showApp/
// validateApp/initApp/packageApp.
// ---------------------------------------------------------------------

const FACTORY_API = { ...createWorkflowApi(), parallel, phase, loop, workflow, agent, artifact, subWorkflow, input };

function materializeFactoryExport(entrypointPath: string, exportName?: string): unknown {
  if (!fs.existsSync(entrypointPath)) {
    throw new WorkflowAppValidationError("Invalid workflow app entrypoint", [
      { code: "workflow-app-entrypoint-not-found", message: `Workflow app entrypoint does not exist: ${entrypointPath}`, path: entrypointPath },
    ]);
  }
  // Workflow apps are plain runtime JavaScript, not TypeScript.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawExport = require(entrypointPath) as unknown;
  const selected =
    exportName && rawExport && typeof rawExport === "object" ? (rawExport as Record<string, unknown>)[exportName] : rawExport;
  if (exportName && selected === undefined) {
    throw new WorkflowAppValidationError("Invalid workflow app entrypoint", [
      { code: "workflow-app-entrypoint-export", message: `Workflow app entrypoint does not export ${exportName}`, path: entrypointPath },
    ]);
  }
  if (typeof selected === "function") {
    return (selected as (api: typeof FACTORY_API) => unknown)(FACTORY_API);
  }
  return selected;
}

function isWorkflowDefinitionShape(value: unknown): value is WorkflowDefinition {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as WorkflowDefinition).id === "string" &&
      typeof (value as WorkflowDefinition).title === "string" &&
      Array.isArray((value as WorkflowDefinition).phases)
  );
}

function isWorkflowAppDefinitionShape(value: unknown): value is WorkflowAppDefinition {
  return Boolean(value && typeof value === "object" && (value as WorkflowAppDefinition).schemaVersion === 1 && "workflow" in (value as object));
}

function extractFactoryExport(value: unknown, file: string): { app?: WorkflowAppDefinition; workflow: WorkflowDefinition } {
  if (isWorkflowAppDefinitionShape(value) && isWorkflowDefinitionShape((value as WorkflowAppDefinition).workflow)) {
    return { app: value, workflow: (value as WorkflowAppDefinition).workflow as WorkflowDefinition };
  }
  if (isWorkflowDefinitionShape(value)) {
    return { workflow: value };
  }
  throw new WorkflowAppValidationError("Invalid workflow app entrypoint", [
    { code: "workflow-app-entrypoint-export", message: "Workflow app entrypoint must export a workflow definition, workflow app, or factory", path: file },
  ]);
}

function collectWorkflowSandboxProfiles(definition: WorkflowDefinition): string[] {
  const profiles = new Set<string>();
  for (const phaseDefinition of definition.phases) {
    for (const taskDefinition of phaseDefinition.tasks) {
      if (taskDefinition.sandboxProfileId) profiles.add(taskDefinition.sandboxProfileId);
    }
  }
  return [...profiles].sort();
}

function createLegacyWorkflowApp(definition: WorkflowDefinition, source: WorkflowAppSource): WorkflowAppDefinition & { workflow: WorkflowDefinition } {
  return {
    schemaVersion: 1,
    id: definition.id,
    title: definition.title,
    summary: definition.summary || "",
    version: "0.0.0",
    workflow: definition,
    inputs: definition.inputs || [],
    sandboxProfiles: definition.sandboxProfiles || collectWorkflowSandboxProfiles(definition),
    compatibility: { maxVersion: CURRENT_COOL_WORKFLOW_VERSION, notes: "Compatibility wrapper for legacy .workflow.js factory files." },
    metadata: { legacyWorkflow: true, sourcePath: source.path },
  };
}

/** Loads one workflow app from a legacy `<name>.workflow.js` entrypoint
 *  (no `app.json`). Ported from `loadWorkflowAppFromEntrypoint`. */
function loadWorkflowAppFromEntrypoint(file: string): LoadedWorkflowAppRecord {
  const entrypointPath = path.resolve(file);
  const materialized = materializeFactoryExport(entrypointPath);
  const loaded = extractFactoryExport(materialized, entrypointPath);
  const source: WorkflowAppSource = { kind: "workflow-file", path: entrypointPath, entrypointPath };

  if (loaded.app) {
    const app = { ...loaded.app, workflow: loaded.workflow } as WorkflowAppDefinition & { workflow: WorkflowDefinition };
    assertValid(app, { appPath: entrypointPath });
    return { app, source, legacy: false };
  }
  const app = createLegacyWorkflowApp(loaded.workflow, source);
  assertValid(app, { appPath: entrypointPath });
  return { app, source, legacy: true };
}

function validateEntrypointAppMatchesManifest(entrypointApp: WorkflowAppDefinition, manifest: WorkflowAppManifest, manifestPath: string): void {
  const issues: WorkflowAppValidationResult["issues"] = [];
  for (const key of ["schemaVersion", "id", "title", "version"] as const) {
    if ((entrypointApp as unknown as Record<string, unknown>)[key] !== (manifest as unknown as Record<string, unknown>)[key]) {
      issues.push({ code: "workflow-app-manifest-mismatch", message: `Entrypoint app ${key} must match manifest ${key}`, path: `${manifestPath}.${key}` });
    }
  }
  if (issues.length) throw new WorkflowAppValidationError("Invalid workflow app manifest", issues);
}

function assertValid(app: WorkflowAppDefinition & { workflow: WorkflowDefinition }, options: { appPath?: string; loadedWorkflow?: WorkflowDefinition }): void {
  const result = validateWorkflowApp(app, validationContext(), options);
  if (!result.valid) throw new WorkflowAppValidationError("Invalid workflow app", result.issues);
}

/** Loads one workflow app from an `app.json` manifest path. Ported from
 *  `loadWorkflowAppFromManifest`. */
function loadWorkflowAppFromManifest(manifestPath: string): LoadedWorkflowAppRecord {
  const absoluteManifestPath = path.resolve(manifestPath);
  if (!fs.existsSync(absoluteManifestPath)) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", [
      { code: "workflow-app-manifest-not-found", message: `Workflow app manifest does not exist: ${absoluteManifestPath}`, path: absoluteManifestPath },
    ]);
  }
  let manifest: WorkflowAppManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8")) as WorkflowAppManifest;
  } catch (error) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", [
      {
        code: "workflow-app-manifest-json",
        message: `Workflow app manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        path: absoluteManifestPath,
      },
    ]);
  }

  const manifestValidation = validateWorkflowApp(manifest, validationContext(), { appPath: absoluteManifestPath });
  if (!manifestValidation.valid) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", manifestValidation.issues);
  }
  const workflowField = manifest.workflow as unknown;
  const isEntrypoint = Boolean(workflowField && typeof workflowField === "object" && "entrypoint" in (workflowField as object) && !("phases" in (workflowField as object)));
  if (!isEntrypoint) {
    throw new WorkflowAppValidationError("Invalid workflow app manifest", [
      { code: "workflow-app-entrypoint", message: "Manifest workflow must be an entrypoint object", path: `${absoluteManifestPath}.workflow` },
    ]);
  }

  const entrypointPath = path.resolve(path.dirname(absoluteManifestPath), manifest.workflow.entrypoint);
  const materialized = materializeFactoryExport(entrypointPath, manifest.workflow.exportName);
  const loaded = extractFactoryExport(materialized, entrypointPath);
  const workflowDefinition = loaded.workflow;
  const source: WorkflowAppSource = {
    kind: path.basename(absoluteManifestPath) === "app.json" ? "app-directory" : "app-manifest",
    path: path.dirname(absoluteManifestPath),
    manifestPath: absoluteManifestPath,
    entrypointPath,
  };

  if (loaded.app) {
    validateEntrypointAppMatchesManifest(loaded.app, manifest, absoluteManifestPath);
  }

  const app = { ...manifest, workflow: workflowDefinition } as WorkflowAppDefinition & { workflow: WorkflowDefinition };
  assertValid(app, { appPath: absoluteManifestPath, loadedWorkflow: workflowDefinition });
  return { app, source, legacy: false };
}

function loadWorkflowFiles(workflowsDir: string): string[] {
  if (!fs.existsSync(workflowsDir)) return [];
  return fs
    .readdirSync(workflowsDir)
    .filter((file) => file.endsWith(".workflow.js"))
    .sort()
    .map((file) => path.join(workflowsDir, file));
}

function loadAppManifestFiles(appsDir: string): string[] {
  if (!fs.existsSync(appsDir)) return [];
  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDir, entry.name, "app.json"))
    .filter((file) => fs.existsSync(file))
    .sort();
}

function sourcePathOf(record: LoadedWorkflowAppRecord): string {
  return record.source.manifestPath || record.source.entrypointPath || record.source.path;
}

/** Full discovery over every real bundled app + legacy workflow file: one
 *  root each, walked up from this file's own location (or `CW_APPS_DIR`/
 *  `CW_WORKFLOWS_DIR`). Sorted by app id then source path; a duplicate id
 *  across BOTH roots is a fail-closed error, matching
 *  `loadWorkflowApps` in the old build. */
export function listWorkflowAppRecords(): LoadedWorkflowAppRecord[] {
  const appsDir = candidateAppsRoots().find((root) => fs.existsSync(root)) || candidateAppsRoots()[0];
  const workflowsDir = candidateWorkflowsRoots().find((root) => fs.existsSync(root)) || candidateWorkflowsRoots()[0];
  const records = [
    ...loadWorkflowFiles(workflowsDir).map((file) => loadWorkflowAppFromEntrypoint(file)),
    ...loadAppManifestFiles(appsDir).map((file) => loadWorkflowAppFromManifest(file)),
  ].sort((left, right) => {
    const byId = stableCompare(left.app.id, right.app.id);
    if (byId) return byId;
    return stableCompare(sourcePathOf(left), sourcePathOf(right));
  });
  const seen = new Map<string, LoadedWorkflowAppRecord>();
  for (const record of records) {
    const previous = seen.get(record.app.id);
    if (previous) {
      throw new Error(`Duplicate workflow app id ${record.app.id}: ${sourcePathOf(previous)} and ${sourcePathOf(record)}`);
    }
    seen.set(record.app.id, record);
  }
  return records;
}

export function loadWorkflowAppRecordById(appId: string): LoadedWorkflowAppRecord {
  const record = listWorkflowAppRecords().find((candidate) => candidate.app.id === appId);
  if (!record) throw new WorkflowAppNotFoundError(appId);
  return record;
}

/** Resolves a `cw app validate <path-or-id>` / `cw app show <path-or-id>`
 *  target: an existing directory/`app.json`/other-file path wins over an
 *  id lookup, matching `loadWorkflowAppTarget` in the old build. */
function loadWorkflowAppRecordTarget(target: string): LoadedWorkflowAppRecord {
  if (!target) throw new Error("Missing workflow app path or id");
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) {
    // `validate`/`show` on a real path is the one loader entrypoint whose
    // whole point is to let a caller inspect an app BEFORE deciding to
    // trust it — but inspecting it means require()-ing its workflow.js
    // (validateWorkflowApp needs the returned WorkflowDefinition, which
    // only exists after the factory runs). A path outside every root CW
    // already trusts (bundled apps, an installed package, CW_APPS_DIR, or
    // the caller's own cwd/apps from `cw app init`) gets arbitrary code
    // executed by "validate", with no OS-level containment — a warning
    // printed after that require() call would be too late to matter, so
    // this fails closed instead: refuse by default, and only proceed
    // (still with a visible warning) when the caller explicitly opts in.
    // Mirrors the existing --allow-unattested precedent in
    // worker-isolation.ts: unsafe-but-explicit, never silent.
    if (!isTrustedAppSourcePath(resolved)) {
      if (!process.env.CW_ALLOW_EXTERNAL_APP_CODE) {
        throw new WorkflowAppValidationError("Untrusted workflow app source", [
          {
            code: "workflow-app-untrusted-source",
            message: `Refusing to load workflow app code outside CW's trusted app roots: ${resolved}. Its workflow.js would run as ordinary Node.js code with full host privileges — CW does not sandbox app code, only delegated agent workers. Set CW_ALLOW_EXTERNAL_APP_CODE=1 to load and execute it anyway.`,
            path: resolved,
          },
        ]);
      }
      process.stderr.write(`cw: loading external workflow app code from ${resolved} — its workflow.js runs as ordinary Node.js code with full host privileges, not sandboxed.\n`);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return loadWorkflowAppFromManifest(path.join(resolved, "app.json"));
    if (path.basename(resolved) === "app.json" || resolved.endsWith(".json")) return loadWorkflowAppFromManifest(resolved);
    return loadWorkflowAppFromEntrypoint(resolved);
  }
  return loadWorkflowAppRecordById(target);
}

function summarizeWorkflowAppRecord(record: LoadedWorkflowAppRecord): WorkflowAppSummary {
  const workflowDefinition = record.app.workflow;
  const sandboxProfiles = record.app.sandboxProfiles || workflowDefinition.sandboxProfiles || [];
  return {
    id: record.app.id,
    title: record.app.title,
    summary: record.app.summary || workflowDefinition.summary || "",
    version: record.app.version,
    author: record.app.author,
    file: sourcePathOf(record),
    sourceKind: record.source.kind,
    legacy: record.legacy,
    compatible: isWorkflowAppCompatible(record.app, validationContext()),
    inputs: record.app.inputs || workflowDefinition.inputs || [],
    sandboxProfiles,
    phases: workflowDefinition.phases.map((phaseDefinition) => ({ id: phaseDefinition.id, name: phaseDefinition.name, taskCount: phaseDefinition.tasks.length })),
    taskCount: workflowDefinition.phases.reduce((total, phaseDefinition) => total + phaseDefinition.tasks.length, 0),
  };
}

/** `cw app list` / `cw_app_list`. Key order matches `WorkflowAppSummary`;
 *  a legacy app's `author` key is OMITTED (never present, never null) —
 *  callers must build the JSON object with the same conditional-spread
 *  discipline used here. */
export function listWorkflowApps(): Array<Record<string, unknown>> {
  return listWorkflowAppRecords().map((record) => summaryToJson(summarizeWorkflowAppRecord(record)));
}

function summaryToJson(summary: WorkflowAppSummary): Record<string, unknown> {
  const { author, ...rest } = summary;
  return {
    id: rest.id,
    title: rest.title,
    summary: rest.summary,
    version: rest.version,
    ...(author !== undefined ? { author } : {}),
    file: rest.file,
    sourceKind: rest.sourceKind,
    legacy: rest.legacy,
    compatible: rest.compatible,
    inputs: rest.inputs,
    sandboxProfiles: rest.sandboxProfiles,
    phases: rest.phases,
    taskCount: rest.taskCount,
  };
}

/** `cw list` / `cw_list` — the lighter {id,title,summary,file} view over
 *  the SAME discovered app set. */
export function listWorkflowsShallow(): Array<{ id: string; title: string; summary: string; file: string }> {
  return listWorkflowAppRecords().map((record) => {
    const summary = summarizeWorkflowAppRecord(record);
    return { id: summary.id, title: summary.title, summary: summary.summary, file: summary.file };
  });
}

/** `cw app show <id>` / `cw_app_show`. Throws `WorkflowAppNotFoundError`
 *  on an unknown id (`recoveryHint` in cli/entry.ts turns this into the
 *  `Try: cw app list` tip). */
export function showWorkflowApp(appId: string): Record<string, unknown> {
  const record = loadWorkflowAppRecordById(appId);
  const summary = summarizeWorkflowAppRecord(record);
  return {
    ...summaryToJson(summary),
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
      metadata: record.app.metadata || {},
    },
    workflow: {
      id: record.app.workflow.id,
      title: record.app.workflow.title,
      summary: record.app.workflow.summary || "",
      limits: record.app.workflow.limits,
      inputs: record.app.workflow.inputs,
      sandboxProfiles: record.app.workflow.sandboxProfiles || [],
      phases: record.app.workflow.phases.map((phaseDefinition) => ({
        id: phaseDefinition.id,
        name: phaseDefinition.name,
        status: phaseDefinition.status,
        tasks: phaseDefinition.tasks.map((taskDefinition) => ({
          id: taskDefinition.id,
          kind: taskDefinition.kind,
          requiresEvidence: Boolean(taskDefinition.requiresEvidence),
          sandboxProfileId: taskDefinition.sandboxProfileId,
        })),
      })),
    },
  };
}

/** `cw app validate <path-or-id>` / `cw_app_validate`. Never throws — an
 *  unresolvable target gives `{valid:false, appId:target, appPath:target,
 *  issues}`, matching `validateApp` in the old build. */
export function validateWorkflowAppTarget(target: string): WorkflowAppValidationResult {
  const resolvedTarget = path.resolve(target);
  try {
    const record = loadWorkflowAppRecordTarget(target);
    const result = validateWorkflowApp(record.app, validationContext(), { appPath: sourcePathOf(record) });
    return { ...result, summary: summarizeWorkflowAppRecord(record) };
  } catch (error) {
    return { valid: false, appId: target, appPath: resolvedTarget, issues: validationIssuesFromError(error) };
  }
}

const SYSTEM_DIR_PATTERN = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;

function titleize(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderManifestTemplate(id: string, title: string): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      id,
      title,
      summary: "Describe what this workflow app does.",
      version: "0.1.0",
      author: "COOLWHITE LLC",
      inputs: [{ name: "question", type: "string", required: true, description: "Question or task this workflow should answer." }],
      sandboxProfiles: ["readonly"],
      compatibility: { minVersion: "0.1.9" },
      workflow: { entrypoint: "workflow.js" },
    },
    null,
    2
  )}\n`;
}

function renderEntrypointTemplate(id: string, title: string): string {
  return `module.exports = ({ workflow, phase, agent, artifact, input }) => {\n  const inputs = [\n    input("question", { type: "string", required: true, description: "Question or task this workflow should answer." })\n  ];\n\n  return workflow({\n    id: ${JSON.stringify(
    id
  )},\n    title: ${JSON.stringify(
    title
  )},\n    summary: "Describe what this workflow app does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs,\n    sandboxProfiles: ["readonly"],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true, sandboxProfileId: "readonly" })\n      ])\n    ]\n  });\n};\n`;
}

/** Validates a manifest CW itself just wrote to disk (from `initWorkflowApp`
 *  below) — deliberately bypasses `loadWorkflowAppRecordTarget`'s
 *  untrusted-source gate. That gate exists for `cw app validate <path>`,
 *  where the caller is inspecting code someone else wrote before deciding
 *  whether to trust it; `app init --directory <anywhere>` is the opposite
 *  case (the caller is authoring new code, from CW's own template, in a
 *  location they chose on purpose) and must keep working regardless of
 *  where `--directory` points. */
function validateGeneratedManifest(manifestPath: string): WorkflowAppValidationResult {
  try {
    const record = loadWorkflowAppFromManifest(manifestPath);
    const result = validateWorkflowApp(record.app, validationContext(), { appPath: sourcePathOf(record) });
    return { ...result, summary: summarizeWorkflowAppRecord(record) };
  } catch (error) {
    return { valid: false, appId: manifestPath, appPath: path.resolve(manifestPath), issues: validationIssuesFromError(error) };
  }
}

/** `cw app init <id>` / `cw_app_init`. Writes `app.json` + `workflow.js`
 *  from the templates, refusing system directories and (without
 *  `--force`) an existing app. Ported from `initApp`. */
export function initWorkflowApp(appId: string, options: Record<string, unknown> = {}): { id: string; manifestPath: string; entrypointPath: string } {
  const id = slugify(appId);
  if (!id) throw new Error("App id must include at least one letter or digit");
  const title = String(options.title || titleize(id));
  const appsDir = candidateAppsRoots().find((root) => fs.existsSync(root)) || candidateAppsRoots()[0];
  const destinationDir = path.resolve(String(options.directory || options.output || path.join(appsDir, id)));
  if (SYSTEM_DIR_PATTERN.test(destinationDir)) {
    throw new Error(`Refusing to create app in a system directory: ${destinationDir}`);
  }
  const manifestPath = path.join(destinationDir, "app.json");
  const entrypointPath = path.join(destinationDir, "workflow.js");
  if (!options.force && (fs.existsSync(manifestPath) || fs.existsSync(entrypointPath))) {
    throw new Error(`Refusing to overwrite existing workflow app: ${destinationDir}`);
  }
  fs.mkdirSync(destinationDir, { recursive: true });
  fs.writeFileSync(manifestPath, renderManifestTemplate(id, title), "utf8");
  fs.writeFileSync(entrypointPath, renderEntrypointTemplate(id, title), "utf8");
  const validation = validateGeneratedManifest(manifestPath);
  if (!validation.valid) {
    throw new WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
  }
  return { id, manifestPath, entrypointPath };
}

/** `cw app package <id>` / `cw_app_package`. Ported from `packageApp`. The
 *  default package path is anchored under the caller's explicit `cwd`
 *  (`options.cwd`) so the CLI/MCP surfaces never write into the process cwd
 *  when a different working directory was requested — and never chdir. */
export function packageWorkflowApp(appId: string, options: Record<string, unknown> = {}, cwd?: string): { id: string; version: string; path: string } {
  const base = cwd || (typeof options.cwd === "string" && options.cwd.trim() ? path.resolve(String(options.cwd)) : process.cwd());
  const record = loadWorkflowAppRecordById(appId);
  const destination = path.resolve(base, String(options.output || path.join(".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`)));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const payload = {
    schemaVersion: 1,
    app: {
      schemaVersion: 1,
      id: record.app.id,
      title: record.app.title,
      summary: record.app.summary || record.app.workflow.summary || "",
      version: record.app.version,
      author: record.app.author,
      compatibility: record.app.compatibility,
      sandboxProfiles: record.app.sandboxProfiles || record.app.workflow.sandboxProfiles,
      source: record.source,
      metadata: record.app.metadata,
    },
    workflow: record.app.workflow,
    packagedAt: new Date().toISOString(),
  };
  fs.writeFileSync(destination, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { id: record.app.id, version: record.app.version, path: destination };
}
