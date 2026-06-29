"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWorkflowFiles = loadWorkflowFiles;
exports.loadAppManifestFiles = loadAppManifestFiles;
exports.loadWorkflowApps = loadWorkflowApps;
exports.loadWorkflowAppById = loadWorkflowAppById;
exports.loadWorkflowAppTarget = loadWorkflowAppTarget;
exports.listWorkflows = listWorkflows;
exports.listApps = listApps;
exports.showApp = showApp;
exports.validateApp = validateApp;
exports.initApp = initApp;
exports.packageApp = packageApp;
// Workflow-app management domain operations (v0.1.40 self-audit router pattern).
// Carved out of CoolWorkflowRunner; pure functions (no instance state). Behavior
// is identical to the inline versions — the runner-owned calls (resolveFromBase,
// validateApp) are passed as callbacks so the bodies stay byte-identical.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const workflow_api_1 = require("../workflow-api");
const state_1 = require("../state");
const workflow_app_framework_1 = require("../workflow-app-framework");
const cli_options_1 = require("./cli-options");
function loadWorkflowFiles(workflowsDir) {
    if (!node_fs_1.default.existsSync(workflowsDir))
        return [];
    return node_fs_1.default
        .readdirSync(workflowsDir)
        .filter((file) => file.endsWith(".workflow.js"))
        .sort()
        .map((file) => node_path_1.default.join(workflowsDir, file));
}
function loadAppManifestFiles(appsDir) {
    if (!node_fs_1.default.existsSync(appsDir))
        return [];
    return node_fs_1.default
        .readdirSync(appsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => node_path_1.default.join(appsDir, entry.name, "app.json"))
        .filter((file) => node_fs_1.default.existsSync(file))
        .sort();
}
function loadWorkflowApps(workflowsDir, appsDir) {
    const records = [
        ...loadWorkflowFiles(workflowsDir).map((file) => (0, workflow_app_framework_1.loadWorkflowAppFromEntrypoint)(file)),
        ...loadAppManifestFiles(appsDir).map((file) => (0, workflow_app_framework_1.loadWorkflowAppFromManifest)(file))
    ].sort((left, right) => {
        const byId = left.app.id.localeCompare(right.app.id);
        if (byId)
            return byId;
        return (left.source.manifestPath || left.source.entrypointPath || left.source.path)
            .localeCompare(right.source.manifestPath || right.source.entrypointPath || right.source.path);
    });
    const seen = new Map();
    for (const record of records) {
        const previous = seen.get(record.app.id);
        if (previous) {
            throw new Error(`Duplicate workflow app id ${record.app.id}: ${previous.source.manifestPath || previous.source.entrypointPath || previous.source.path} and ${record.source.manifestPath || record.source.entrypointPath || record.source.path}`);
        }
        seen.set(record.app.id, record);
    }
    return records;
}
function loadWorkflowAppById(workflowsDir, appsDir, appId) {
    const record = loadWorkflowApps(workflowsDir, appsDir).find((candidate) => candidate.app.id === appId);
    if (!record)
        throw new Error(`Workflow app not found: ${appId}`);
    return record;
}
// The runner pre-resolves `target` via resolveFromBase and passes the resolved
// path; the original `target` is still used for the id-fallback lookup.
function loadWorkflowAppTarget(workflowsDir, appsDir, resolved, target) {
    if (!target)
        throw new Error("Missing workflow app path or id");
    if (node_fs_1.default.existsSync(resolved)) {
        const stat = node_fs_1.default.statSync(resolved);
        if (stat.isDirectory())
            return (0, workflow_app_framework_1.loadWorkflowAppFromManifest)(node_path_1.default.join(resolved, "app.json"));
        if (node_path_1.default.basename(resolved) === "app.json" || resolved.endsWith(".json"))
            return (0, workflow_app_framework_1.loadWorkflowAppFromManifest)(resolved);
        return (0, workflow_app_framework_1.loadWorkflowAppFromEntrypoint)(resolved);
    }
    return loadWorkflowAppById(workflowsDir, appsDir, target);
}
function listWorkflows(workflowsDir, appsDir) {
    return loadWorkflowApps(workflowsDir, appsDir).map((record) => {
        const summary = (0, workflow_app_framework_1.summarizeWorkflowApp)(record);
        return {
            id: summary.id,
            title: summary.title,
            summary: summary.summary,
            file: summary.file
        };
    });
}
function listApps(workflowsDir, appsDir) {
    return loadWorkflowApps(workflowsDir, appsDir).map((record) => (0, workflow_app_framework_1.summarizeWorkflowApp)(record));
}
function showApp(workflowsDir, appsDir, appId) {
    const record = loadWorkflowAppById(workflowsDir, appsDir, appId);
    const summary = (0, workflow_app_framework_1.summarizeWorkflowApp)(record);
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
function validateApp(workflowsDir, appsDir, target, resolvedTarget) {
    try {
        const record = loadWorkflowAppTarget(workflowsDir, appsDir, resolvedTarget, target);
        const result = (0, workflow_app_framework_1.validateWorkflowApp)(record.app, {
            appPath: record.source.manifestPath || record.source.entrypointPath || record.source.path
        });
        return {
            ...result,
            summary: (0, workflow_app_framework_1.summarizeWorkflowApp)(record)
        };
    }
    catch (error) {
        const issues = (0, cli_options_1.validationIssuesFromError)(error);
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
function initApp(appsDir, appId, options, resolveFromBase, validateApp) {
    const id = (0, workflow_api_1.slugify)(appId);
    if (!id)
        throw new Error("App id must include at least one letter or digit");
    const title = String(options.title || titleize(id));
    const destinationDir = resolveFromBase(String(options.directory || options.output || node_path_1.default.join(appsDir, id)));
    // Reject writes to system-owned directories. The operator may provide any
    // output path, but writing to /etc, /bin, /usr etc. is never valid.
    const sysDirs = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;
    if (sysDirs.test(node_path_1.default.resolve(destinationDir))) {
        throw new Error(`Refusing to create app in a system directory: ${destinationDir}`);
    }
    const manifestPath = node_path_1.default.join(destinationDir, "app.json");
    const entrypointPath = node_path_1.default.join(destinationDir, "workflow.js");
    if (!options.force && (node_fs_1.default.existsSync(manifestPath) || node_fs_1.default.existsSync(entrypointPath))) {
        throw new Error(`Refusing to overwrite existing workflow app: ${destinationDir}`);
    }
    node_fs_1.default.mkdirSync(destinationDir, { recursive: true });
    node_fs_1.default.writeFileSync(manifestPath, (0, workflow_app_framework_1.renderWorkflowAppManifestTemplate)(id, title), "utf8");
    node_fs_1.default.writeFileSync(entrypointPath, (0, workflow_app_framework_1.renderWorkflowAppEntrypointTemplate)(id, title), "utf8");
    const validation = validateApp(manifestPath);
    if (!validation.valid) {
        throw new workflow_app_framework_1.WorkflowAppValidationError("Generated workflow app is invalid", validation.issues);
    }
    return { id, manifestPath, entrypointPath };
}
// resolveFromBase is passed as a callback so the body stays byte-identical.
function packageApp(workflowsDir, appsDir, appId, options, resolveFromBase) {
    const record = loadWorkflowAppById(workflowsDir, appsDir, appId);
    const destination = resolveFromBase(String(options.output || node_path_1.default.join(".cw", "packages", `${record.app.id}-${record.app.version}.cwapp.json`)));
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(destination), { recursive: true });
    (0, state_1.writeJson)(destination, {
        schemaVersion: 1,
        app: (0, workflow_app_framework_1.workflowAppRunMetadata)(record),
        workflow: record.app.workflow,
        packagedAt: new Date().toISOString()
    });
    return { id: record.app.id, version: record.app.version, path: destination };
}
function titleize(value) {
    return value
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
