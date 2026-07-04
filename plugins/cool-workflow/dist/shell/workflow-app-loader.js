"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowAppNotFoundError = void 0;
exports.loadWorkflowApp = loadWorkflowApp;
exports.listWorkflowAppRecords = listWorkflowAppRecords;
exports.loadWorkflowAppRecordById = loadWorkflowAppRecordById;
exports.listWorkflowApps = listWorkflowApps;
exports.listWorkflowsShallow = listWorkflowsShallow;
exports.showWorkflowApp = showWorkflowApp;
exports.validateWorkflowAppTarget = validateWorkflowAppTarget;
exports.initWorkflowApp = initWorkflowApp;
exports.packageWorkflowApp = packageWorkflowApp;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const app_schema_1 = require("../core/workflow-apps/app-schema");
const sandbox_profile_1 = require("./sandbox-profile");
const version_1 = require("../core/version");
class WorkflowAppNotFoundError extends Error {
    constructor(appId) {
        super(`Workflow app not found: ${appId}`);
        this.name = "WorkflowAppNotFoundError";
    }
}
exports.WorkflowAppNotFoundError = WorkflowAppNotFoundError;
function walkUpFor(...tail) {
    const roots = [];
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        roots.push(path.join(dir, "plugins", "cool-workflow", ...tail));
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return roots;
}
function candidateAppsRoots() {
    const roots = [];
    if (process.env.CW_APPS_DIR)
        roots.push(path.resolve(process.env.CW_APPS_DIR));
    // Walk up from this file's own location looking for a sibling
    // plugins/cool-workflow/apps tree (the real bundled apps ship there in
    // this monorepo checkout).
    roots.push(...walkUpFor("apps"));
    roots.push(path.join(process.cwd(), "apps"));
    return roots;
}
function candidateWorkflowsRoots() {
    const roots = [];
    if (process.env.CW_WORKFLOWS_DIR)
        roots.push(path.resolve(process.env.CW_WORKFLOWS_DIR));
    roots.push(...walkUpFor("workflows"));
    roots.push(path.join(process.cwd(), "workflows"));
    return roots;
}
function findAppDir(appId) {
    for (const root of candidateAppsRoots()) {
        const dir = path.join(root, appId);
        if (fs.existsSync(path.join(dir, "app.json")))
            return dir;
    }
    return undefined;
}
function validationContext() {
    return { bundledSandboxProfileIds: (0, sandbox_profile_1.bundledSandboxProfileIds)(), currentCoolWorkflowVersion: version_1.CURRENT_COOL_WORKFLOW_VERSION };
}
function authorNameOf(author) {
    if (typeof author === "string")
        return author;
    if (author && typeof author === "object" && typeof author.name === "string")
        return author.name;
    return undefined;
}
/** Load one real bundled workflow app by id: reads its `app.json`
 *  manifest, then `require()`s its declared `workflow.entrypoint` factory
 *  file (the same `({workflow, phase, parallel, agent, artifact, input})
 *  => workflow({...})` shape the old build's workflow-api.ts factories
 *  produce), and returns the interpreted WorkflowDefinition. */
function loadWorkflowApp(appId) {
    const dir = findAppDir(appId);
    if (!dir)
        throw new WorkflowAppNotFoundError(appId);
    const manifestPath = path.join(dir, "app.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entrypointPath = path.resolve(dir, manifest.workflow.entrypoint);
    // Workflow apps are plain runtime JavaScript, not TypeScript.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rawExport = require(entrypointPath);
    const selected = manifest.workflow.exportName && rawExport && typeof rawExport === "object" ? rawExport[manifest.workflow.exportName] : rawExport;
    if (typeof selected !== "function") {
        throw new Error(`Workflow app entrypoint must export a factory function: ${entrypointPath}`);
    }
    const definition = selected({
        ...(0, app_schema_1.createWorkflowApi)(),
        parallel: app_schema_1.parallel,
        phase: app_schema_1.phase,
        workflow: app_schema_1.workflow,
        agent: app_schema_1.agent,
        artifact: app_schema_1.artifact,
        input: app_schema_1.input,
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
    };
}
// ---------------------------------------------------------------------
// Full discovery: apps/*/app.json + legacy workflows/*.workflow.js
// (MILESTONE 12). Byte-exact in spirit to
// src/orchestrator/app-operations.ts's loadWorkflowApps/listApps/showApp/
// validateApp/initApp/packageApp.
// ---------------------------------------------------------------------
const FACTORY_API = { ...(0, app_schema_1.createWorkflowApi)(), parallel: app_schema_1.parallel, phase: app_schema_1.phase, loop: app_schema_1.loop, workflow: app_schema_1.workflow, agent: app_schema_1.agent, artifact: app_schema_1.artifact, subWorkflow: app_schema_1.subWorkflow, input: app_schema_1.input };
function materializeFactoryExport(entrypointPath, exportName) {
    if (!fs.existsSync(entrypointPath)) {
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app entrypoint", [
            { code: "workflow-app-entrypoint-not-found", message: `Workflow app entrypoint does not exist: ${entrypointPath}`, path: entrypointPath },
        ]);
    }
    // Workflow apps are plain runtime JavaScript, not TypeScript.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rawExport = require(entrypointPath);
    const selected = exportName && rawExport && typeof rawExport === "object" ? rawExport[exportName] : rawExport;
    if (exportName && selected === undefined) {
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app entrypoint", [
            { code: "workflow-app-entrypoint-export", message: `Workflow app entrypoint does not export ${exportName}`, path: entrypointPath },
        ]);
    }
    if (typeof selected === "function") {
        return selected(FACTORY_API);
    }
    return selected;
}
function isWorkflowDefinitionShape(value) {
    return Boolean(value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        Array.isArray(value.phases));
}
function isWorkflowAppDefinitionShape(value) {
    return Boolean(value && typeof value === "object" && value.schemaVersion === 1 && "workflow" in value);
}
function extractFactoryExport(value, file) {
    if (isWorkflowAppDefinitionShape(value) && isWorkflowDefinitionShape(value.workflow)) {
        return { app: value, workflow: value.workflow };
    }
    if (isWorkflowDefinitionShape(value)) {
        return { workflow: value };
    }
    throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app entrypoint", [
        { code: "workflow-app-entrypoint-export", message: "Workflow app entrypoint must export a workflow definition, workflow app, or factory", path: file },
    ]);
}
function collectWorkflowSandboxProfiles(definition) {
    const profiles = new Set();
    for (const phaseDefinition of definition.phases) {
        for (const taskDefinition of phaseDefinition.tasks) {
            if (taskDefinition.sandboxProfileId)
                profiles.add(taskDefinition.sandboxProfileId);
        }
    }
    return [...profiles].sort();
}
function createLegacyWorkflowApp(definition, source) {
    return {
        schemaVersion: 1,
        id: definition.id,
        title: definition.title,
        summary: definition.summary || "",
        version: "0.0.0",
        workflow: definition,
        inputs: definition.inputs || [],
        sandboxProfiles: definition.sandboxProfiles || collectWorkflowSandboxProfiles(definition),
        compatibility: { maxVersion: version_1.CURRENT_COOL_WORKFLOW_VERSION, notes: "Compatibility wrapper for legacy .workflow.js factory files." },
        metadata: { legacyWorkflow: true, sourcePath: source.path },
    };
}
/** Loads one workflow app from a legacy `<name>.workflow.js` entrypoint
 *  (no `app.json`). Ported from `loadWorkflowAppFromEntrypoint`. */
function loadWorkflowAppFromEntrypoint(file) {
    const entrypointPath = path.resolve(file);
    const materialized = materializeFactoryExport(entrypointPath);
    const loaded = extractFactoryExport(materialized, entrypointPath);
    const source = { kind: "workflow-file", path: entrypointPath, entrypointPath };
    if (loaded.app) {
        const app = { ...loaded.app, workflow: loaded.workflow };
        assertValid(app, { appPath: entrypointPath });
        return { app, source, legacy: false };
    }
    const app = createLegacyWorkflowApp(loaded.workflow, source);
    assertValid(app, { appPath: entrypointPath });
    return { app, source, legacy: true };
}
function validateEntrypointAppMatchesManifest(entrypointApp, manifest, manifestPath) {
    const issues = [];
    for (const key of ["schemaVersion", "id", "title", "version"]) {
        if (entrypointApp[key] !== manifest[key]) {
            issues.push({ code: "workflow-app-manifest-mismatch", message: `Entrypoint app ${key} must match manifest ${key}`, path: `${manifestPath}.${key}` });
        }
    }
    if (issues.length)
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app manifest", issues);
}
function assertValid(app, options) {
    const result = (0, app_schema_1.validateWorkflowApp)(app, validationContext(), options);
    if (!result.valid)
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app", result.issues);
}
/** Loads one workflow app from an `app.json` manifest path. Ported from
 *  `loadWorkflowAppFromManifest`. */
function loadWorkflowAppFromManifest(manifestPath) {
    const absoluteManifestPath = path.resolve(manifestPath);
    if (!fs.existsSync(absoluteManifestPath)) {
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app manifest", [
            { code: "workflow-app-manifest-not-found", message: `Workflow app manifest does not exist: ${absoluteManifestPath}`, path: absoluteManifestPath },
        ]);
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(absoluteManifestPath, "utf8"));
    }
    catch (error) {
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app manifest", [
            {
                code: "workflow-app-manifest-json",
                message: `Workflow app manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
                path: absoluteManifestPath,
            },
        ]);
    }
    const manifestValidation = (0, app_schema_1.validateWorkflowApp)(manifest, validationContext(), { appPath: absoluteManifestPath });
    if (!manifestValidation.valid) {
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app manifest", manifestValidation.issues);
    }
    const workflowField = manifest.workflow;
    const isEntrypoint = Boolean(workflowField && typeof workflowField === "object" && "entrypoint" in workflowField && !("phases" in workflowField));
    if (!isEntrypoint) {
        throw new app_schema_1.WorkflowAppValidationError("Invalid workflow app manifest", [
            { code: "workflow-app-entrypoint", message: "Manifest workflow must be an entrypoint object", path: `${absoluteManifestPath}.workflow` },
        ]);
    }
    const entrypointPath = path.resolve(path.dirname(absoluteManifestPath), manifest.workflow.entrypoint);
    const materialized = materializeFactoryExport(entrypointPath, manifest.workflow.exportName);
    const loaded = extractFactoryExport(materialized, entrypointPath);
    const workflowDefinition = loaded.workflow;
    const source = {
        kind: path.basename(absoluteManifestPath) === "app.json" ? "app-directory" : "app-manifest",
        path: path.dirname(absoluteManifestPath),
        manifestPath: absoluteManifestPath,
        entrypointPath,
    };
    if (loaded.app) {
        validateEntrypointAppMatchesManifest(loaded.app, manifest, absoluteManifestPath);
    }
    const app = { ...manifest, workflow: workflowDefinition };
    assertValid(app, { appPath: absoluteManifestPath, loadedWorkflow: workflowDefinition });
    return { app, source, legacy: false };
}
function loadWorkflowFiles(workflowsDir) {
    if (!fs.existsSync(workflowsDir))
        return [];
    return fs
        .readdirSync(workflowsDir)
        .filter((file) => file.endsWith(".workflow.js"))
        .sort()
        .map((file) => path.join(workflowsDir, file));
}
function loadAppManifestFiles(appsDir) {
    if (!fs.existsSync(appsDir))
        return [];
    return fs
        .readdirSync(appsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(appsDir, entry.name, "app.json"))
        .filter((file) => fs.existsSync(file))
        .sort();
}
function sourcePathOf(record) {
    return record.source.manifestPath || record.source.entrypointPath || record.source.path;
}
/** Full discovery over every real bundled app + legacy workflow file: one
 *  root each, walked up from this file's own location (or `CW_APPS_DIR`/
 *  `CW_WORKFLOWS_DIR`). Sorted by app id then source path; a duplicate id
 *  across BOTH roots is a fail-closed error, matching
 *  `loadWorkflowApps` in the old build. */
function listWorkflowAppRecords() {
    const appsDir = candidateAppsRoots().find((root) => fs.existsSync(root)) || candidateAppsRoots()[0];
    const workflowsDir = candidateWorkflowsRoots().find((root) => fs.existsSync(root)) || candidateWorkflowsRoots()[0];
    const records = [
        ...loadWorkflowFiles(workflowsDir).map((file) => loadWorkflowAppFromEntrypoint(file)),
        ...loadAppManifestFiles(appsDir).map((file) => loadWorkflowAppFromManifest(file)),
    ].sort((left, right) => {
        const byId = left.app.id.localeCompare(right.app.id);
        if (byId)
            return byId;
        return sourcePathOf(left).localeCompare(sourcePathOf(right));
    });
    const seen = new Map();
    for (const record of records) {
        const previous = seen.get(record.app.id);
        if (previous) {
            throw new Error(`Duplicate workflow app id ${record.app.id}: ${sourcePathOf(previous)} and ${sourcePathOf(record)}`);
        }
        seen.set(record.app.id, record);
    }
    return records;
}
function loadWorkflowAppRecordById(appId) {
    const record = listWorkflowAppRecords().find((candidate) => candidate.app.id === appId);
    if (!record)
        throw new WorkflowAppNotFoundError(appId);
    return record;
}
/** Resolves a `cw app validate <path-or-id>` / `cw app show <path-or-id>`
 *  target: an existing directory/`app.json`/other-file path wins over an
 *  id lookup, matching `loadWorkflowAppTarget` in the old build. */
function loadWorkflowAppRecordTarget(target) {
    if (!target)
        throw new Error("Missing workflow app path or id");
    const resolved = path.resolve(target);
    if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isDirectory())
            return loadWorkflowAppFromManifest(path.join(resolved, "app.json"));
        if (path.basename(resolved) === "app.json" || resolved.endsWith(".json"))
            return loadWorkflowAppFromManifest(resolved);
        return loadWorkflowAppFromEntrypoint(resolved);
    }
    return loadWorkflowAppRecordById(target);
}
function summarizeWorkflowAppRecord(record) {
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
        compatible: (0, app_schema_1.isWorkflowAppCompatible)(record.app, validationContext()),
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
function listWorkflowApps() {
    return listWorkflowAppRecords().map((record) => summaryToJson(summarizeWorkflowAppRecord(record)));
}
function summaryToJson(summary) {
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
function listWorkflowsShallow() {
    return listWorkflowAppRecords().map((record) => {
        const summary = summarizeWorkflowAppRecord(record);
        return { id: summary.id, title: summary.title, summary: summary.summary, file: summary.file };
    });
}
/** `cw app show <id>` / `cw_app_show`. Throws `WorkflowAppNotFoundError`
 *  on an unknown id (`recoveryHint` in cli/entry.ts turns this into the
 *  `Try: cw app list` tip). */
function showWorkflowApp(appId) {
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
function validateWorkflowAppTarget(target) {
    const resolvedTarget = path.resolve(target);
    try {
        const record = loadWorkflowAppRecordTarget(target);
        const result = (0, app_schema_1.validateWorkflowApp)(record.app, validationContext(), { appPath: sourcePathOf(record) });
        return { ...result, summary: summarizeWorkflowAppRecord(record) };
    }
    catch (error) {
        return { valid: false, appId: target, appPath: resolvedTarget, issues: (0, app_schema_1.validationIssuesFromError)(error) };
    }
}
const SYSTEM_DIR_PATTERN = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;
function titleize(value) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
function renderManifestTemplate(id, title) {
    return `${JSON.stringify({
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
    }, null, 2)}\n`;
}
function renderEntrypointTemplate(id, title) {
    return `module.exports = ({ workflow, phase, agent, artifact, input }) => {\n  const inputs = [\n    input("question", { type: "string", required: true, description: "Question or task this workflow should answer." })\n  ];\n\n  return workflow({\n    id: ${JSON.stringify(id)},\n    title: ${JSON.stringify(title)},\n    summary: "Describe what this workflow app does.",\n    limits: {\n      maxAgents: 8,\n      maxConcurrentAgents: 4\n    },\n    inputs,\n    sandboxProfiles: ["readonly"],\n    phases: [\n      phase("Map", [\n        agent("map:context", "Map the task context, constraints, and evidence needed for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Assess", [\n        agent("assess:risks", "Assess risks, tradeoffs, and unknowns for {{question}}.", { sandboxProfileId: "readonly" })\n      ]),\n      phase("Synthesize", [\n        artifact("synthesis:report", "Synthesize the final answer for {{question}}.", { requiresEvidence: true, sandboxProfileId: "readonly" })\n      ])\n    ]\n  });\n};\n`;
}
/** `cw app init <id>` / `cw_app_init`. Writes `app.json` + `workflow.js`
 *  from the templates, refusing system directories and (without
 *  `--force`) an existing app. Ported from `initApp`. */
function initWorkflowApp(appId, options = {}) {
    const id = (0, app_schema_1.slugify)(appId);
    if (!id)
        throw new Error("App id must include at least one letter or digit");
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
    const validation = validateWorkflowAppTarget(manifestPath);
    if (!validation.valid) {
        throw new app_schema_1.WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
    }
    return { id, manifestPath, entrypointPath };
}
/** `cw app package <id>` / `cw_app_package`. Ported from `packageApp`. */
function packageWorkflowApp(appId, options = {}, cwd = process.cwd()) {
    const record = loadWorkflowAppRecordById(appId);
    const destination = path.resolve(cwd, String(options.output || path.join(".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`)));
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
