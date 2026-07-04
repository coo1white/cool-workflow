"use strict";
// shell/pipeline-cli.ts — CLI-facing entry points for the pipeline/drive
// spine: planRun, runDrivePreview, runDriveStep, quickstartRun,
// dispatchRun, recordResultRun, commitRun.
//
// MILESTONE 6+7 (combined). Wires the pieces built in shell/pipeline.ts,
// shell/drive.ts, shell/dispatch.ts, shell/commit.ts, shell/worker-
// isolation.ts, shell/workflow-app-loader.ts into the shapes
// core/capability-table.ts's CLI bindings call.
//
// Evidence: SPEC/pipeline-run.md "CLI / MCP surface (capability layer)".
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
exports.planRun = planRun;
exports.runDrivePreview = runDrivePreview;
exports.runDriveStep = runDriveStep;
exports.quickstartRun = quickstartRun;
exports.dispatchRun = dispatchRun;
exports.recordResultRun = recordResultRun;
exports.commitRun = commitRun;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const pipeline_1 = require("./pipeline");
const workflow_app_loader_1 = require("./workflow-app-loader");
const drive_1 = require("./drive");
const dispatch_1 = require("./dispatch");
const commit_1 = require("./commit");
const worker_isolation_1 = require("./worker-isolation");
const run_store_1 = require("./run-store");
const report_1 = require("./report");
const agent_config_1 = require("./agent-config");
const remote_source_1 = require("./remote-source");
const trust_audit_1 = require("./trust-audit");
const QUICKSTART_DEFAULT_APP = "architecture-review";
/** Runtime keys that must NEVER leak into run.inputs (they are drive/CLI
 *  plumbing, not workflow-declared inputs). Byte-exact to the old
 *  build's DRIVE_RUNTIME_KEYS list. */
const RUNTIME_KEYS = new Set([
    "once", "now", "preview", "step", "drive", "json", "format", "run", "runId", "cwd",
    "agentCommand", "agent-command", "agentArgs", "agent-args", "agentEndpoint", "agent-endpoint",
    "agentModel", "agent-model", "agentTimeoutMs", "agent-timeout-ms", "resume", "incremental",
    "concurrency", "link", "ref", "branch", "refresh", "check", "app", "appId", "workflowId", "question", "repo",
]);
/** Byte-exact port of the old build's `normalizeInputs`
 *  (src/orchestrator/lifecycle-operations.ts:465-480): repeated `--arg
 *  key=value` pairs unpack into inputs (key = text before the first "=",
 *  value = the rest re-joined with "="); `repo` copies to `cwd` when `cwd`
 *  is not already set. Per SPEC/orchestrator.md's "Plan input rules" and
 *  SPEC/workflow-apps.md. */
function planInputsFor(args) {
    const out = {};
    for (const [key, value] of Object.entries(args)) {
        if (key === "arg") {
            const pairs = Array.isArray(value) ? value : [value];
            for (const pair of pairs) {
                const [argKey, ...rest] = String(pair).split("=");
                out[argKey] = rest.join("=");
            }
            continue;
        }
        if (RUNTIME_KEYS.has(key))
            continue;
        out[key] = value;
    }
    if (typeof args.repo === "string")
        out.repo = args.repo;
    if (typeof args.question === "string")
        out.question = args.question;
    // An explicit --cwd is stripped by RUNTIME_KEYS above, but the old build
    // honored it for the run anchor. Re-add it (like repo) so a caller-supplied
    // cwd is not silently dropped to process.cwd() — a cross-request bleed.
    if (typeof args.cwd === "string" && args.cwd.trim())
        out.cwd = args.cwd;
    if (out.repo && !out.cwd)
        out.cwd = out.repo;
    return out;
}
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
/** `cw plan <workflowId>` — real: loads the app, plans a fresh run,
 *  returns the canonical plan summary. */
function planRun(args) {
    const appId = String(args.workflowId || args.app || QUICKSTART_DEFAULT_APP);
    if (!args.repo && !args.cwd)
        args.repo = invocationCwd(args);
    const app = (0, workflow_app_loader_1.loadWorkflowApp)(appId);
    const run = (0, pipeline_1.plan)(app, planInputsFor(args));
    return { schemaVersion: 1, runId: run.id, workflowId: run.workflow.id, statePath: run.paths.state, reportPath: run.paths.report, taskCount: run.tasks.length };
}
function runDrivePreview(args) {
    const runId = String(args.runId || args.run || "");
    const cwd = invocationCwd(args);
    return (0, drive_1.drivePreview)(runId, cwd, args);
}
/** `cw run <app|--run id> --drive [--once]` — plans a fresh run (unless
 *  `--run` continues an existing one) and drives it. */
function runDriveStep(args) {
    const existingRunId = String(args.runId || args.run || "");
    const options = {
        once: Boolean(args.once),
        now: typeof args.now === "string" ? args.now : undefined,
        args,
        concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
        incremental: Boolean(args.incremental),
    };
    if (existingRunId) {
        const cwd = invocationCwd(args);
        const run = (0, run_store_1.loadRunFromCwd)(existingRunId, cwd);
        return (0, drive_1.drive)(existingRunId, run.cwd, options);
    }
    const appId = String(args.appId || args.app || args.positionalApp || "");
    if (!appId)
        throw new Error("run --drive requires an app id (or --run <run-id> to continue)");
    if (!args.repo && !args.cwd)
        args.repo = invocationCwd(args);
    const app = (0, workflow_app_loader_1.loadWorkflowApp)(appId);
    const run = (0, pipeline_1.plan)(app, planInputsFor(args));
    return (0, drive_1.drive)(run.id, run.cwd, options);
}
/** `cw quickstart [app] --check` — read-only preflight: does the app
 *  resolve, is the repo readable/writable, is a question set, is an
 *  agent backend configured. Never plans or writes a run. Byte-exact
 *  port of the old build's `quickstartCheck` (src/capability-core.ts),
 *  local-repo path only (the --link/remote preflight variant is not
 *  ported — no conformance case exercises it). */
function quickstartCheck(appId, args, remoteCandidate) {
    // `--link`/URL preflight: validate the URL SHAPE + tooling WITHOUT fetching
    // (a clone is heavy + side-effecting; --check stays read-only). Swaps the
    // local-repo readability checks for link + tooling. `repo` carries the
    // sanitized URL so the result reports what would be reviewed.
    if (remoteCandidate)
        return remoteQuickstartCheck(appId, args, remoteCandidate);
    const base = invocationCwd(args);
    const repoArg = typeof args.repo === "string" && args.repo.trim() ? args.repo : base;
    const repo = path.resolve(base, repoArg);
    const checks = [];
    try {
        (0, workflow_app_loader_1.showWorkflowApp)(appId);
        checks.push({ name: "app", status: "ok", detail: `Workflow app ${appId} is available.` });
    }
    catch {
        checks.push({
            name: "app",
            status: "blocked",
            detail: `Workflow app ${appId} is not available.`,
            fix: "Run `cw app list` and choose one of the listed app ids.",
        });
    }
    let repoReadable = false;
    let repoStateWritable = false;
    try {
        const stat = fs.statSync(repo);
        repoReadable = stat.isDirectory();
        if (!repoReadable)
            throw new Error("not a directory");
        fs.accessSync(repo, fs.constants.R_OK);
        checks.push({ name: "repo", status: "ok", detail: `Repository path is readable (${repo}).` });
    }
    catch {
        checks.push({
            name: "repo",
            status: "blocked",
            detail: `Repository path is not readable (${repo}).`,
            fix: "Pass --repo PATH for a readable repository directory.",
        });
    }
    try {
        const cwDir = path.join(repo, ".cw");
        fs.accessSync(fs.existsSync(cwDir) ? cwDir : repo, fs.constants.W_OK);
        repoStateWritable = repoReadable;
        checks.push({ name: "repo-state", status: "ok", detail: "Run state location is writable." });
    }
    catch {
        checks.push({
            name: "repo-state",
            status: "blocked",
            detail: "Run state location is not writable.",
            fix: "Use a writable repo, fix directory permissions, or pass --repo to a writable checkout.",
        });
    }
    if (typeof args.question === "string" && args.question.trim()) {
        checks.push({ name: "question", status: "ok", detail: "Question is set." });
    }
    else {
        checks.push({ name: "question", status: "blocked", detail: "Question is missing.", fix: "Pass --question TEXT." });
    }
    if ((0, agent_config_1.agentConfigured)(args)) {
        checks.push({ name: "agent", status: "ok", detail: "Agent backend is configured." });
    }
    else {
        checks.push({
            name: "agent",
            status: "blocked",
            detail: "No agent backend is configured.",
            fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.',
        });
    }
    const ok = checks.every((check) => check.status !== "blocked") && repoStateWritable;
    return { schemaVersion: 1, mode: "check", ok, appId, repo, checks };
}
/** `--check` for a `--link`/URL review: validates the URL shape + git tooling
 *  WITHOUT fetching (byte-behavior port of the old build's remoteQuickstartCheck).
 *  `repo` carries the sanitized URL. */
function remoteQuickstartCheck(appId, args, candidate) {
    const validation = (0, remote_source_1.validateRemoteUrl)(candidate);
    const checks = [];
    try {
        (0, workflow_app_loader_1.showWorkflowApp)(appId);
        checks.push({ name: "app", status: "ok", detail: `Workflow app ${appId} is available.` });
    }
    catch {
        checks.push({ name: "app", status: "blocked", detail: `Workflow app ${appId} is not available.`, fix: "Run `cw app list` and choose one of the listed app ids." });
    }
    if (validation.ok) {
        checks.push({ name: "link", status: "ok", detail: `Remote source is a valid ${validation.kind} URL (${validation.url}).` });
    }
    else {
        checks.push({ name: "link", status: "blocked", detail: `Remote source is not usable: ${validation.reason}.`, fix: "Pass a git URL (https/ssh/git/file or git@host:repo)." });
    }
    if ((0, remote_source_1.gitAvailable)()) {
        checks.push({ name: "tooling", status: "ok", detail: "git is available to clone the remote." });
    }
    else {
        checks.push({ name: "tooling", status: "blocked", detail: "git was not found on PATH.", fix: "Install git, then re-run." });
    }
    if (typeof args.question === "string" && args.question.trim()) {
        checks.push({ name: "question", status: "ok", detail: "Question is set." });
    }
    else {
        checks.push({ name: "question", status: "blocked", detail: "Question is missing.", fix: "Pass --question TEXT." });
    }
    if ((0, agent_config_1.agentConfigured)(args)) {
        checks.push({ name: "agent", status: "ok", detail: "Agent backend is configured." });
    }
    else {
        checks.push({ name: "agent", status: "blocked", detail: "No agent backend is configured.", fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.' });
    }
    const ok = checks.every((check) => check.status !== "blocked");
    return { schemaVersion: 1, mode: "check", ok, appId, repo: validation.url, checks };
}
/** `cw quickstart [app] --question ...` — composes plan -> runDrive ->
 *  report in one call. Default app is architecture-review. `--check` is a
 *  read-only preflight that never plans/drives/writes (see
 *  `quickstartCheck` above). */
function quickstartRun(args) {
    const appId = String(args.appId || args.app || args.workflowId || QUICKSTART_DEFAULT_APP);
    // Remote source: a `--link <url>` — or a URL passed to `--repo`/`-dir` — is
    // materialized to a LOCAL checkout HERE (capability/shell layer). Cloning is
    // non-deterministic network I/O and must never enter the replay-deterministic
    // core, so we rewrite `args.repo`/`args.cwd` to the local path; everything
    // downstream is a normal local run.
    const linkArg = typeof args.link === "string" && args.link.trim() ? args.link.trim() : undefined;
    const repoArgRaw = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined;
    const remoteCandidate = linkArg || (repoArgRaw && (0, remote_source_1.isRemoteUrl)(repoArgRaw) ? repoArgRaw : undefined);
    if (!remoteCandidate && !args.repo && !args.cwd)
        args.repo = invocationCwd(args);
    if (Boolean(args.check))
        return quickstartCheck(appId, args, remoteCandidate);
    // Materialize the remote NOW — after `--check` (never fetches) and before any
    // plan/drive — so the core only ever sees the local checkout. Fails closed: a
    // bad URL / blocked scheme / missing git / fetch failure throws here.
    let remoteSource;
    if (remoteCandidate) {
        remoteSource = (0, remote_source_1.materializeRemote)(remoteCandidate, {
            ref: typeof args.ref === "string" ? args.ref : typeof args.branch === "string" ? args.branch : undefined,
            refresh: Boolean(args.refresh),
        });
        args.repo = remoteSource.localPath;
        args.cwd = remoteSource.localPath;
        // Record the origin as plan INPUTS so it rides into run.inputs → the report
        // header (report.ts renders `- Source: url@sha` from run.inputs.sourceUrl).
        args.sourceUrl = remoteSource.url;
        args.sourceCommit = remoteSource.commit;
        if (remoteSource.ref)
            args.sourceRef = remoteSource.ref;
    }
    const options = {
        once: Boolean(args.once),
        now: typeof args.now === "string" ? args.now : undefined,
        args,
        concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
        incremental: Boolean(args.incremental),
    };
    const existingRunId = String(args.runId || args.run || "");
    let run;
    if (existingRunId) {
        run = (0, run_store_1.loadRunFromCwd)(existingRunId, invocationCwd(args));
    }
    else {
        const app = (0, workflow_app_loader_1.loadWorkflowApp)(appId);
        run = (0, pipeline_1.plan)(app, planInputsFor(args));
    }
    const result = (0, drive_1.drive)(run.id, run.cwd, options);
    const finalRun = (0, run_store_1.loadRunFromCwd)(run.id, run.cwd);
    (0, report_1.writeReport)(finalRun);
    // Tamper-evident provenance: bind the remote origin (url@sha) into the run's
    // hash-chained trust-audit log so `cw audit verify` re-proves where the code
    // came from. Best-effort — the origin is already in run.inputs/report/result.
    if (remoteSource) {
        try {
            (0, trust_audit_1.recordTrustAuditEvent)(finalRun, {
                kind: remoteSource.kind === "archive" ? "source.download" : "source.clone",
                decision: "recorded",
                source: "operator-recorded",
                metadata: { url: remoteSource.url, commit: remoteSource.commit, ref: remoteSource.ref || null, kind: remoteSource.kind, depth: 1 },
            });
        }
        catch {
            /* provenance is additive; never fail a completed review over an audit hiccup */
        }
    }
    // Byte-exact to the old build's quickstart() return shape
    // (src/capability-core.ts): `appId` is the resolved app id (the
    // argument, or its architecture-review default), distinct from
    // `workflowId` which is the driven run's own workflow id (equal for a
    // top-level run, different for a sub-workflow hop). `remote` is present only
    // for a --link/URL source, so a local-repo run stays byte-identical.
    return {
        appId,
        ...result,
        ...(remoteSource
            ? { remote: { url: remoteSource.url, commit: remoteSource.commit, kind: remoteSource.kind, cached: remoteSource.cached, ...(remoteSource.ref ? { ref: remoteSource.ref } : {}) } }
            : {}),
    };
}
function dispatchRun(args) {
    const runId = String(args.runId);
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const manifest = (0, dispatch_1.createDispatchManifest)(run, args.limit !== undefined ? Number(args.limit) : undefined, { sandboxProfileId: typeof args.sandbox === "string" ? args.sandbox : undefined, backendId: typeof args.backend === "string" ? args.backend : undefined });
    if (manifest.dispatchId) {
        (0, commit_1.commitState)(run, `dispatch:${manifest.dispatchId}`);
        (0, run_store_1.saveCheckpoint)(run);
        (0, report_1.writeReport)(run);
    }
    return manifest;
}
function recordResultRun(args) {
    const runId = String(args.runId);
    const taskId = String(args.taskId);
    const resultPath = String(args.resultPath);
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const task = run.tasks.find((t) => t.id === taskId);
    if (!task || !task.workerId)
        throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
    const absolute = path.resolve(resultPath);
    if (!fs.existsSync(absolute))
        throw new Error(`Result file does not exist: ${resultPath}`);
    const workerId = String(task.workerId);
    const output = (0, worker_isolation_1.recordWorkerOutput)(run, workerId, absolute);
    // Byte-exact to the old build's orchestrator recordWorkerOutput()
    // wrapper: an accepted result is its own checkpoint commit, not just a
    // bare saveCheckpoint (SPEC/pipeline-run.md's persist-ordering rule).
    (0, commit_1.commitState)(run, `worker:${workerId}:result`);
    (0, run_store_1.saveCheckpoint)(run);
    (0, report_1.writeReport)(run);
    return output;
}
/** `cw commit <run-id>` — byte-exact port of the old build's
 *  `orchestrator/lifecycle-operations.ts`'s `commit()`: the CLI/MCP
 *  payload wraps the commit record as `{runId, commit}` (NOT the commit
 *  record at top level). Both the success AND the throw path write the
 *  report + checkpoint before returning/re-throwing — a gate failure
 *  still leaves the run's report/state current on disk. */
function commitRun(args) {
    const runId = String(args.runId);
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const allowCheckpoint = Boolean(args.allowUnverifiedCheckpoint || args["allow-unverified-checkpoint"]);
    const hasGateOption = Boolean(args.verifier || args.verifierNode || args["verifier-node"] || args.candidate || args.selection);
    try {
        const commit = (0, commit_1.commitState)(run, {
            reason: typeof args.reason === "string" && args.reason ? args.reason : "manual",
            verifierNodeId: (typeof args.verifier === "string" && args.verifier) ||
                (typeof args.verifierNode === "string" && args.verifierNode) ||
                (typeof args["verifier-node"] === "string" && args["verifier-node"]) ||
                undefined,
            candidateId: typeof args.candidate === "string" ? args.candidate : undefined,
            selectionId: typeof args.selection === "string" ? args.selection : undefined,
            verifierGated: hasGateOption || !allowCheckpoint,
            allowUnverifiedCheckpoint: allowCheckpoint,
            source: "cli",
        });
        (0, report_1.writeReport)(run);
        (0, run_store_1.saveCheckpoint)(run);
        return { runId: run.id, commit };
    }
    catch (error) {
        (0, report_1.writeReport)(run);
        (0, run_store_1.saveCheckpoint)(run);
        throw error;
    }
}
