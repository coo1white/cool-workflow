"use strict";
// shell/app-run-cli.ts — `cw_app_run` and `cw_sandbox_choose`/`cw_sandbox_resolve`.
//
// GAP #24 port: v2 declared the cw_app_run + cw_sandbox_choose/resolve MCP
// tool rows but left their handlers as notYetImplemented. This restores the
// old build's `appRun` + `sandboxChoose` (capability-core module) as thin
// shell bodies over the same v2 `plan` + `showSandboxProfileCli` the CLI
// front door already uses, so the MCP surface no longer throws.
//
// Both are MCP-only in the old build (no CLI path row), so only an
// mcp.handler is wired for them in capability-table.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.sandboxChooseCli = sandboxChooseCli;
exports.appRunCli = appRunCli;
const pipeline_1 = require("./pipeline");
const workflow_app_loader_1 = require("./workflow-app-loader");
const exec_backend_cli_1 = require("./exec-backend-cli");
const operator_ux_1 = require("./operator-ux");
const run_store_1 = require("./run-store");
/** Keys that steer the run/tool call itself, never workflow inputs — the
 *  old build's `withoutRuntimeKeys` (capability-core module). */
const RUNTIME_KEYS = new Set(["cwd", "sandbox", "sandboxProfile", "sandboxProfileId", "appId", "workflowId", "inputs"]);
function withoutRuntimeKeys(args) {
    const out = {};
    for (const [key, value] of Object.entries(args)) {
        if (RUNTIME_KEYS.has(key))
            continue;
        out[key] = value;
    }
    return out;
}
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function sandboxProfileIdFrom(args) {
    return optionalString(args.sandbox || args.sandboxProfile || args.sandboxProfileId || args.profileId);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** `cw_sandbox_choose` / `cw_sandbox_resolve` — resolve + validate a profile
 *  choice. Byte-exact port of the old build's `sandboxChoose`
 *  (capability-core module): defaults to "readonly", returns the resolved
 *  profile object under `profile`. */
function sandboxChooseCli(args) {
    const profileId = sandboxProfileIdFrom(args) || "readonly";
    const profile = (0, exec_backend_cli_1.showSandboxProfileCli)(profileId, args);
    return {
        profileId,
        sandboxProfileId: profile.id,
        valid: true,
        profile,
    };
}
/** `cw_app_run` — create a run from an app id + structured inputs. Byte-exact
 *  port of the old build's `appRun` (capability-core module): merges
 *  `inputs` with the non-runtime args, plans a fresh run, and returns the
 *  run descriptor + a compact operator status. */
function appRunCli(args) {
    const appId = String(args.appId || args.workflowId || "");
    if (!appId)
        throw new Error("cw_app_run requires an app id (appId)");
    const inputs = isRecord(args.inputs) ? args.inputs : {};
    const planOptions = { ...inputs, ...withoutRuntimeKeys(args) };
    if (typeof args.cwd === "string" && args.cwd.trim())
        planOptions.cwd = args.cwd;
    if (planOptions.repo && !planOptions.cwd)
        planOptions.cwd = planOptions.repo;
    const sandboxProfileId = sandboxProfileIdFrom(args);
    const resolvedSandbox = sandboxProfileId ? (0, exec_backend_cli_1.showSandboxProfileCli)(sandboxProfileId, args) : undefined;
    const app = (0, workflow_app_loader_1.loadWorkflowApp)(appId);
    const run = (0, pipeline_1.plan)(app, planOptions);
    const status = (0, operator_ux_1.summarizeOperatorRun)((0, run_store_1.loadRunFromCwd)(run.id, run.cwd));
    const appMeta = (run.workflow.app || {});
    return {
        runId: run.id,
        workflowId: run.workflow.id,
        appId: appMeta.id || appId,
        appVersion: appMeta.version,
        statePath: run.paths.state,
        reportPath: run.paths.report,
        pendingTasks: run.tasks.filter((task) => task.status === "pending").length,
        operatorStatus: status,
        nextActions: status.nextActions,
        sandboxProfileId,
        sandboxProfile: resolvedSandbox,
    };
}
