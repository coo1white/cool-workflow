// shell/app-run-cli.ts — `cw_app_run` and `cw_sandbox_choose`.
//
// Thin shell bodies over the same `plan` + `showSandboxProfileCli` the CLI
// front door uses.
import { plan } from "./pipeline.js";
import { loadWorkflowApp } from "./workflow-app-loader.js";
import { showSandboxProfileCli } from "./exec-backend-cli.js";
import { summarizeOperatorRun } from "./operator-ux.js";
import { loadRunFromCwd } from "./run-store.js";
import { optionalArg, isRecord } from "../core/util/cli-args.js";
/** Keys that steer the run/tool call itself, never workflow inputs. */
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
function sandboxProfileIdFrom(args) {
    return optionalArg(args.sandbox || args.sandboxProfile || args.sandboxProfileId || args.profileId);
}
/** `cw_sandbox_choose` — resolve + validate a profile choice: defaults
 *  to "readonly", returns the resolved profile object under `profile`. */
export function sandboxChooseCli(args) {
    const profileId = sandboxProfileIdFrom(args) || "readonly";
    const profile = showSandboxProfileCli(profileId, args);
    return {
        profileId,
        sandboxProfileId: profile.id,
        valid: true,
        profile,
    };
}
/** `cw_app_run` — create a run from an app id + structured inputs:
 *  merges `inputs` with the non-runtime args, plans a fresh run, and
 *  returns the run descriptor + a compact operator status. */
export function appRunCli(args) {
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
    const resolvedSandbox = sandboxProfileId ? showSandboxProfileCli(sandboxProfileId, args) : undefined;
    const app = loadWorkflowApp(appId);
    const run = plan(app, planOptions);
    const status = summarizeOperatorRun(loadRunFromCwd(run.id, run.cwd));
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
