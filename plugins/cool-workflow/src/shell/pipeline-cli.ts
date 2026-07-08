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

import * as fs from "node:fs";
import * as path from "node:path";
import { requiredNumberFlag } from "../core/util/numeric-flag";
import { plan } from "./pipeline";
import { loadWorkflowApp, showWorkflowApp, loadWorkflowAppRecordById, WorkflowAppNotFoundError } from "./workflow-app-loader";
import { LoadedWorkflowApp } from "../core/workflow-apps/app-schema";
import { drive, DriveOptions, drivePreview } from "./drive";
import { createDispatchManifest } from "./dispatch";
import { commitState } from "./commit";
import { recordWorkerOutput, showWorkerManifest, getWorkerScope } from "./worker-isolation";
import { parseUsageFromArgs } from "./observability";
import { loadRunFromCwd, saveCheckpoint, withRunStateLock } from "./run-store";
import { writeReport } from "./report";
import { WorkflowRun } from "../core/state/types";
import { agentConfigured, resolveAgentConfig } from "./agent-config";
import { materializeRemote, isRemoteUrl, validateRemoteUrl, gitAvailable, RemoteSource } from "./remote-source";
import { recordTrustAuditEvent } from "./trust-audit";
import { reportBundleCli, ReportBundleResult } from "./report-cli";

const QUICKSTART_DEFAULT_APP = "architecture-review";

/** True when `value` is a truthy CLI flag (present, or "true"/"1"/"yes"/"on"). */
function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return /^(1|true|yes|on)$/i.test(value.trim());
  return false;
}

/** First non-empty string among the given arg values (mirrors the old
 *  build's optionalString read over several alias keys). */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** Shell-quote a token for a copy-pasteable next command (byte-exact to the
 *  old build's shellWord). */
function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The copy-pasteable `cw quickstart …` line the `--check` payload echoes,
 *  weaving in --bundle / --with-trust-key / --strict-signatures so the
 *  suggested resume preserves bundle intent. Byte-exact port of the old
 *  build's quickstartNextCommand. */
function quickstartNextCommand(appId: string, repo: string, args: Record<string, unknown>): string {
  const parts = ["cw", "quickstart", shellWord(appId), "--repo", shellWord(repo)];
  const question = firstString(args.question);
  if (question) parts.push("--question", shellWord(question));
  const command = firstString(args.agentCommand, args["agent-command"]);
  if (command) parts.push("--agent-command", shellWord(command));
  if (truthyFlag(args.bundle)) parts.push("--bundle");
  const trustKey = firstString(args["with-trust-key"], args.withTrustKey, args.trustKey);
  if (trustKey) parts.push("--with-trust-key", shellWord(trustKey));
  if (truthyFlag(args["strict-signatures"]) || truthyFlag(args.strictSignatures) || truthyFlag(args.strictSigs)) parts.push("--strict-signatures");
  return parts.join(" ");
}

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
function planInputsFor(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "arg") {
      const pairs = Array.isArray(value) ? value : [value];
      for (const pair of pairs) {
        const [argKey, ...rest] = String(pair).split("=");
        out[argKey] = rest.join("=");
      }
      continue;
    }
    if (RUNTIME_KEYS.has(key)) continue;
    out[key] = value;
  }
  if (typeof args.repo === "string") out.repo = args.repo;
  if (typeof args.question === "string") out.question = args.question;
  // An explicit --cwd is stripped by RUNTIME_KEYS above, but the old build
  // honored it for the run anchor. Re-add it (like repo) so a caller-supplied
  // cwd is not silently dropped to process.cwd() — a cross-request bleed.
  if (typeof args.cwd === "string" && args.cwd.trim()) out.cwd = args.cwd;
  if (out.repo && !out.cwd) out.cwd = out.repo;
  return out;
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

/** True for a value that counts as "not supplied" — byte-exact to the old
 *  build's cli-options.isMissing (undefined / null / empty string). */
function isMissingInput(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Resolve a workflow app for `plan`/`run --drive` over the SAME surface `cw
 *  list` shows — bundled apps AND legacy `<name>.workflow.js` files. The old
 *  build's plan() resolved via loadWorkflowAppById (full discovery over both the
 *  workflows/ and apps/ roots — app-operations.ts:64), so any id `cw list`
 *  surfaces is plannable. v2's fast-path loadWorkflowApp only reads
 *  apps/<id>/app.json, so a legacy workflow-file wrapper (e.g.
 *  legacy-research-synthesis) that `list` CAN resolve died with "Workflow app
 *  not found". Fall back to the full-discovery record (loadWorkflowAppRecordById)
 *  and adapt it to the minimal LoadedWorkflowApp plan() consumes. */
function resolveWorkflowAppForPlan(appId: string): LoadedWorkflowApp {
  try {
    return loadWorkflowApp(appId);
  } catch (error) {
    if (!(error instanceof WorkflowAppNotFoundError)) throw error;
    const record = loadWorkflowAppRecordById(appId);
    const author = typeof record.app.author === "string" ? record.app.author : record.app.author?.name;
    return {
      id: record.app.id,
      title: record.app.title,
      summary: record.app.summary || record.app.workflow.summary || "",
      version: record.app.version,
      ...(author !== undefined ? { author } : {}),
      workflow: record.app.workflow,
      sandboxProfiles: record.app.sandboxProfiles || record.app.workflow.sandboxProfiles || [],
      sourcePath: record.source.manifestPath || record.source.path,
    };
  }
}

/** `cw plan <workflowId>` — real: loads the app, plans a fresh run,
 *  returns the canonical plan summary. */
export function planRun(args: Record<string, unknown>): Record<string, unknown> {
  const appId = String(args.workflowId || args.app || QUICKSTART_DEFAULT_APP);
  // POLA: `cw plan <app>` does NOT default repo to the caller's cwd (unlike the
  // one-command quickstart). The old build validated required inputs FIRST
  // (lifecycle-operations.ts validateInputs, message `Missing required input
  // --<name>`), so a missing --repo surfaces the copy-pasteable `-dir` recovery
  // line (cli/entry.ts recoveryHint's "missing"+"repo" branch) instead of a
  // silent cwd-anchored run. Auto-filling repo here would hide that recovery.
  const app = resolveWorkflowAppForPlan(appId);
  const planInputs = planInputsFor(args);
  for (const declared of app.workflow.inputs || []) {
    if (declared.required && isMissingInput(planInputs[declared.name])) {
      throw new Error(`Missing required input --${declared.name}`);
    }
  }
  const run = plan(app, planInputs);
  // `pendingTasks` is the canonical plan-payload key both `cw plan` and
  // `cw_plan` carry (old build src/capability-core.ts:79 planSummary:
  // `pendingTasks: run.tasks.filter(status === "pending").length`, and
  // SPEC/workflow-apps.md). `taskCount` stays as a harmless extra.
  const pendingTasks = run.tasks.filter((task) => task.status === "pending").length;
  return { schemaVersion: 1, runId: run.id, workflowId: run.workflow.id, statePath: run.paths.state, reportPath: run.paths.report, pendingTasks, taskCount: run.tasks.length };
}

export function runDrivePreview(args: Record<string, unknown>): ReturnType<typeof drivePreview> {
  const runId = String(args.runId || args.run || "");
  const cwd = invocationCwd(args);
  return drivePreview(runId, cwd, args);
}

/** `cw run <app|--run id> --drive [--once]` — plans a fresh run (unless
 *  `--run` continues an existing one) and drives it. */
export function runDriveStep(args: Record<string, unknown>): ReturnType<typeof drive> {
  const existingRunId = String(args.runId || args.run || "");
  const options: DriveOptions = {
    once: Boolean(args.once),
    now: typeof args.now === "string" ? args.now : undefined,
    args,
    concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
    incremental: Boolean(args.incremental),
  };
  if (existingRunId) {
    const cwd = invocationCwd(args);
    const run = loadRunFromCwd(existingRunId, cwd);
    return drive(existingRunId, run.cwd, options);
  }
  const appId = String(args.appId || args.app || args.positionalApp || "");
  if (!appId) throw new Error("run --drive requires an app id (or --run <run-id> to continue)");
  if (!args.repo && !args.cwd) args.repo = invocationCwd(args);
  const app = loadWorkflowApp(appId);
  const run = plan(app, planInputsFor(args));
  return drive(run.id, run.cwd, options);
}

interface QuickstartCheck {
  name: string;
  status: "ok" | "blocked" | "warn";
  detail: string;
  fix?: string;
}

interface QuickstartCheckResult {
  schemaVersion: 1;
  mode: "check";
  ok: boolean;
  appId: string;
  repo: string;
  checks: QuickstartCheck[];
  nextCommand: string;
}

/** `cw quickstart [app] --check` — read-only preflight: does the app
 *  resolve, is the repo readable/writable, is a question set, is an
 *  agent backend configured. Never plans or writes a run. Byte-exact
 *  port of the old build's `quickstartCheck` (src/capability-core.ts),
 *  local-repo path only (the --link/remote preflight variant is not
 *  ported — no conformance case exercises it). */
function quickstartCheck(appId: string, args: Record<string, unknown>, remoteCandidate?: string): QuickstartCheckResult {
  // `--link`/URL preflight: validate the URL SHAPE + tooling WITHOUT fetching
  // (a clone is heavy + side-effecting; --check stays read-only). Swaps the
  // local-repo readability checks for link + tooling. `repo` carries the
  // sanitized URL so the result reports what would be reviewed.
  if (remoteCandidate) return remoteQuickstartCheck(appId, args, remoteCandidate);
  const base = invocationCwd(args);
  const repoArg = typeof args.repo === "string" && args.repo.trim() ? args.repo : base;
  const repo = path.resolve(base, repoArg);
  const checks: QuickstartCheck[] = [];

  try {
    showWorkflowApp(appId);
    checks.push({ name: "app", status: "ok", detail: `Workflow app ${appId} is available.` });
  } catch {
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
    if (!repoReadable) throw new Error("not a directory");
    fs.accessSync(repo, fs.constants.R_OK);
    checks.push({ name: "repo", status: "ok", detail: `Repository path is readable (${repo}).` });
  } catch {
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
  } catch {
    checks.push({
      name: "repo-state",
      status: "blocked",
      detail: "Run state location is not writable.",
      fix: "Use a writable repo, fix directory permissions, or pass --repo to a writable checkout.",
    });
  }

  if (typeof args.question === "string" && args.question.trim()) {
    checks.push({ name: "question", status: "ok", detail: "Question is set." });
  } else {
    checks.push({ name: "question", status: "blocked", detail: "Question is missing.", fix: "Pass --question TEXT." });
  }

  if (agentConfigured(args)) {
    checks.push({ name: "agent", status: "ok", detail: "Agent backend is configured." });
  } else {
    checks.push({
      name: "agent",
      status: "blocked",
      detail: "No agent backend is configured.",
      fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.',
    });
  }

  // --bundle preflight: a completed run sealed into a bundle re-verifies offline
  // only with a public trust key. Warn (not block) by default; block only under
  // --strict-signatures where an unkeyed bundle would fail verification.
  if (truthyFlag(args.bundle)) {
    const trustKey = firstString(args["with-trust-key"], args.withTrustKey, args.trustKey, args.pubkey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    if (trustKey) {
      checks.push({ name: "bundle-trust-key", status: "ok", detail: "Bundle trust public key is configured." });
    } else if (truthyFlag(args["strict-signatures"]) || truthyFlag(args.strictSignatures) || truthyFlag(args.strictSigs)) {
      checks.push({ name: "bundle-trust-key", status: "blocked", detail: "Strict signature verification needs a public trust key.", fix: "Pass --with-trust-key PATH or set $CW_AGENT_ATTEST_PUBKEY." });
    } else {
      checks.push({ name: "bundle-trust-key", status: "warn", detail: "No public trust key is configured; unsigned or unkeyed bundles may verify with reduced signature proof.", fix: "Pass --with-trust-key PATH to embed the public key." });
    }
  }

  const ok = checks.every((check) => check.status !== "blocked") && repoStateWritable;
  return { schemaVersion: 1, mode: "check", ok, appId, repo, checks, nextCommand: quickstartNextCommand(appId, repo, args) };
}

/** `--check` for a `--link`/URL review: validates the URL shape + git tooling
 *  WITHOUT fetching (byte-behavior port of the old build's remoteQuickstartCheck).
 *  `repo` carries the sanitized URL. */
function remoteQuickstartCheck(appId: string, args: Record<string, unknown>, candidate: string): QuickstartCheckResult {
  const validation = validateRemoteUrl(candidate);
  const checks: QuickstartCheck[] = [];

  try {
    showWorkflowApp(appId);
    checks.push({ name: "app", status: "ok", detail: `Workflow app ${appId} is available.` });
  } catch {
    checks.push({ name: "app", status: "blocked", detail: `Workflow app ${appId} is not available.`, fix: "Run `cw app list` and choose one of the listed app ids." });
  }

  if (validation.ok) {
    checks.push({ name: "link", status: "ok", detail: `Remote source is a valid ${validation.kind} URL (${validation.url}).` });
  } else {
    checks.push({ name: "link", status: "blocked", detail: `Remote source is not usable: ${validation.reason}.`, fix: "Pass a git URL (https/ssh/git/file or git@host:repo)." });
  }

  if (gitAvailable()) {
    checks.push({ name: "tooling", status: "ok", detail: "git is available to clone the remote." });
  } else {
    checks.push({ name: "tooling", status: "blocked", detail: "git was not found on PATH.", fix: "Install git, then re-run." });
  }

  if (typeof args.question === "string" && args.question.trim()) {
    checks.push({ name: "question", status: "ok", detail: "Question is set." });
  } else {
    checks.push({ name: "question", status: "blocked", detail: "Question is missing.", fix: "Pass --question TEXT." });
  }

  if (agentConfigured(args)) {
    checks.push({ name: "agent", status: "ok", detail: "Agent backend is configured." });
  } else {
    checks.push({ name: "agent", status: "blocked", detail: "No agent backend is configured.", fix: 'Pass --agent-command "claude -p", set $CW_AGENT_COMMAND, or use --agent-command builtin:claude.' });
  }

  const ok = checks.every((check) => check.status !== "blocked");
  const question = firstString(args.question);
  const nextCommand = `cw quickstart ${shellWord(appId)} --link ${shellWord(validation.url)}${question ? ` --question ${shellWord(question)}` : ""}`;
  return { schemaVersion: 1, mode: "check", ok, appId, repo: validation.url, checks, nextCommand };
}

type QuickstartResult = ReturnType<typeof drive> & { appId: string; hint?: string; resumedFrom?: string; bundle?: ReportBundleResult };

/** `cw quickstart [app] --question ...` — composes plan -> runDrive ->
 *  report in one call. Default app is architecture-review. `--check` is a
 *  read-only preflight that never plans/drives/writes (see
 *  `quickstartCheck` above). `--preview` is a read-only next-step
 *  projection (never drives), `--resume` advances one step (no --run) or
 *  continues a named run to completion (--run <id>) — both ported byte-for-
 *  byte from the old build's src/capability-core.ts quickstart(). */
export function quickstartRun(
  args: Record<string, unknown>
): QuickstartResult | QuickstartCheckResult | ReturnType<typeof drivePreview> {
  const appId = String(args.appId || args.app || args.workflowId || QUICKSTART_DEFAULT_APP);
  // Remote source: a `--link <url>` — or a URL passed to `--repo`/`-dir` — is
  // materialized to a LOCAL checkout HERE (capability/shell layer). Cloning is
  // non-deterministic network I/O and must never enter the replay-deterministic
  // core, so we rewrite `args.repo`/`args.cwd` to the local path; everything
  // downstream is a normal local run.
  const linkArg = typeof args.link === "string" && args.link.trim() ? args.link.trim() : undefined;
  const repoArgRaw = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined;
  const remoteCandidate = linkArg || (repoArgRaw && isRemoteUrl(repoArgRaw) ? repoArgRaw : undefined);
  if (!remoteCandidate && !args.repo && !args.cwd) args.repo = invocationCwd(args);
  if (Boolean(args.check)) return quickstartCheck(appId, args, remoteCandidate);

  // Materialize the remote NOW — after `--check` (never fetches) and before any
  // plan/drive — so the core only ever sees the local checkout. Fails closed: a
  // bad URL / blocked scheme / missing git / fetch failure throws here.
  let remoteSource: RemoteSource | undefined;
  if (remoteCandidate) {
    remoteSource = materializeRemote(remoteCandidate, {
      ref: typeof args.ref === "string" ? args.ref : typeof args.branch === "string" ? args.branch : undefined,
      refresh: Boolean(args.refresh),
    });
    args.repo = remoteSource.localPath;
    args.cwd = remoteSource.localPath;
    // Record the origin as plan INPUTS so it rides into run.inputs → the report
    // header (report.ts renders `- Source: url@sha` from run.inputs.sourceUrl).
    args.sourceUrl = remoteSource.url;
    args.sourceCommit = remoteSource.commit;
    if (remoteSource.ref) args.sourceRef = remoteSource.ref;
  }

  // `--resume`: a discoverability flag over the existing continuation. With no
  // `--run`, advance exactly ONE step (reuse the `--once` path) and print a
  // copy-pasteable continue line; with `--run <id>`, continue that run to
  // completion (the default drive). It adds no new execution path. Byte-exact to
  // the old build's src/capability-core.ts quickstart().
  const resume = Boolean(args.resume);
  const existingRunId = String(args.runId || args.run || "");
  const resumeRunId = resume && existingRunId ? existingRunId : undefined;

  // `--preview`: read-only, deterministic next-step projection (no spawn, no
  // commit). Plan a fresh run (the read-only first verb) then project the next
  // drive step. Never drives.
  if (Boolean(args.preview)) {
    let previewRunId = existingRunId;
    let repoCwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : typeof args.repo === "string" ? args.repo : undefined;
    if (!previewRunId) {
      const run = resolveWorkflowAppForPlan(appId);
      const planned = plan(run, planInputsFor(args));
      previewRunId = planned.id;
      repoCwd = planned.cwd;
    }
    const target = repoCwd && fs.existsSync(repoCwd) ? repoCwd : invocationCwd(args);
    return drivePreview(previewRunId, target, args);
  }

  const options: DriveOptions = {
    // `--resume` with no run id advances a SINGLE step (reuse `--once`), so a
    // newcomer WITNESSES the stop-then-resume; `--resume --run <id>` continues to
    // completion (the default drive). Non-resume paths keep the caller's --once.
    once: Boolean(args.once) || (resume && !resumeRunId),
    now: typeof args.now === "string" ? args.now : undefined,
    args,
    concurrency: args.concurrency !== undefined ? Number(args.concurrency) : undefined,
    incremental: Boolean(args.incremental),
  };
  let run: WorkflowRun;
  if (existingRunId) {
    run = loadRunFromCwd(existingRunId, invocationCwd(args));
  } else {
    run = plan(resolveWorkflowAppForPlan(appId), planInputsFor(args));
  }
  const result = drive(run.id, run.cwd, options);
  const finalRun = loadRunFromCwd(run.id, run.cwd);
  writeReport(finalRun);

  // Tamper-evident provenance: bind the remote origin (url@sha) into the run's
  // hash-chained trust-audit log so `cw audit verify` re-proves where the code
  // came from. Best-effort — the origin is already in run.inputs/report/result.
  if (remoteSource) {
    try {
      recordTrustAuditEvent(finalRun, {
        kind: remoteSource.kind === "archive" ? "source.download" : "source.clone",
        decision: "recorded",
        source: "operator-recorded",
        metadata: { url: remoteSource.url, commit: remoteSource.commit, ref: remoteSource.ref || null, kind: remoteSource.kind, depth: 1 },
      });
    } catch {
      /* provenance is additive; never fail a completed review over an audit hiccup */
    }
  }

  // --bundle: after a COMPLETE drive, seal the run into a portable, self-verified
  // bundle so the one command yields a client-verifiable artifact. Pure composition
  // of reportBundleCli (export sealed + offline self-verify); spawns nothing. Gated
  // on completion: a partial/blocked run is NEVER sealed. Run-state resolution
  // anchors to the run's OWN repo (run.cwd) — quickstart runs cross-directory — but
  // OUTPUT paths resolve against the CALLER's cwd so artifacts land where the
  // operator ran the command. Byte-behavior port of the old build's quickstart().
  const wantsBundle = truthyFlag(args.bundle);
  let bundle: ReportBundleResult | undefined;
  if (wantsBundle && result.status === "complete") {
    const callerBase = invocationCwd(args);
    const outArg = firstString(args.output, args.path, args.archive);
    const extractArg = firstString(args["extract-report"], args.extractReport, args.extractReportTo);
    bundle = reportBundleCli(result.runId, {
      ...args,
      cwd: run.cwd,
      output: path.resolve(callerBase, outArg || `${result.runId}.cwrun.json`),
      ...(extractArg ? { "extract-report": path.resolve(callerBase, extractArg) } : {}),
    });
  }

  // Human-facing triage `hint` (stderr-side; absent on a clean completion so the
  // default payload is byte-identical). Byte-exact wording to the old build's
  // src/capability-core.ts quickstart(): the fail-closed "not configured …
  // DELEGATES" line reaffirms the red line; the resume/once lines are copy-paste
  // continue commands.
  let hint: string | undefined;
  if (!result.agentConfigured) {
    hint =
      "agent backend not configured — set CW_AGENT_COMMAND (e.g. \"claude -p\") or pass --agent-command, then re-run. The one command DELEGATES worker execution to YOUR agent; it never executes a model itself.";
  } else if (result.status === "parked") {
    hint = `a worker parked past its retry budget — inspect: cw run show ${result.runId}`;
  } else if (result.status === "blocked") {
    hint = `the drive is blocked — inspect: cw run drive ${result.runId}`;
  } else if (result.status === "in-progress") {
    hint = resume
      ? `one step advanced — continue: cw quickstart ${appId} --run ${result.runId} --resume${wantsBundle ? " --bundle" : ""}`
      : `one step advanced (--once) — continue: cw quickstart ${appId} --run ${result.runId} --once`;
  }
  // --bundle on a run that did not complete is a NO-OP, not silence: tell the
  // operator why nothing was sealed (the Rule of Silence permits a human hint).
  if (wantsBundle && result.status !== "complete") {
    hint = `${hint ? `${hint} ` : ""}--bundle skipped: the run did not complete (status=${result.status}); no bundle was sealed.`;
  }

  // Byte-exact to the old build's quickstart() return shape
  // (src/capability-core.ts): `appId` is the resolved app id (the
  // argument, or its architecture-review default), distinct from
  // `workflowId` which is the driven run's own workflow id (equal for a
  // top-level run, different for a sub-workflow hop). `remote` is present only
  // for a --link/URL source, so a local-repo run stays byte-identical.
  // `resumedFrom` is stamped ONLY when an explicit --run was continued
  // (conditional spread keeps the key absent on the fresh/default path).
  return {
    appId,
    ...result,
    hint,
    ...(resumeRunId ? { resumedFrom: resumeRunId } : {}),
    // `bundle` is present only when --bundle sealed a completed run (conditional
    // spread keeps the key absent on the default path → byte-identical output).
    ...(bundle ? { bundle } : {}),
    ...(remoteSource
      ? { remote: { url: remoteSource.url, commit: remoteSource.commit, kind: remoteSource.kind, cached: remoteSource.cached, ...(remoteSource.ref ? { ref: remoteSource.ref } : {}) } }
      : {}),
  };
}

export function dispatchRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  // The whole load -> change -> save cycle holds the state.json lock so a
  // concurrent dispatch/result on the same run cannot drop this update.
  return withRunStateLock(runId, invocationCwd(args), (run) => {
    // parseArgv keys long flags in kebab-case; accept camelCase as a fallback.
    const flag = (kebab: string, camel: string): string | undefined => {
      const v = args[kebab] ?? args[camel];
      return typeof v === "string" && v.trim() ? v : undefined;
    };
    const manifest = createDispatchManifest(run, requiredNumberFlag(args.limit, "--limit"), {
      sandboxProfileId: typeof args.sandbox === "string" ? args.sandbox : undefined,
      sandbox: typeof args.sandbox === "string" ? args.sandbox : undefined,
      backendId: typeof args.backend === "string" ? args.backend : undefined,
      multiAgentRunId: flag("multi-agent-run", "multiAgentRun"),
      multiAgentGroupId: flag("multi-agent-group", "multiAgentGroup"),
      multiAgentRoleId: flag("multi-agent-role", "multiAgentRole"),
      multiAgentFanoutId: flag("multi-agent-fanout", "multiAgentFanout"),
    });
    if (manifest.dispatchId) {
      commitState(run, `dispatch:${manifest.dispatchId}`);
      saveCheckpoint(run);
      writeReport(run);
    }
    return manifest as unknown as Record<string, unknown>;
  });
}

export function recordResultRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  const taskId = String(args.taskId);
  const resultPath = String(args.resultPath);
  // Two processes recording results for two tasks of the SAME run used to
  // race: both loaded, and the later saveCheckpoint dropped the earlier
  // task's completion. The lock now covers the whole cycle.
  return withRunStateLock(runId, invocationCwd(args), (run) => {
    const task = run.tasks.find((t) => t.id === taskId);
    if (!task || !task.workerId) throw new Error(`Unknown task id for run ${runId}: ${taskId}`);
    const absolute = path.resolve(resultPath);
    // A result path inside a system directory is never accepted (POLA): the
    // operator file gets copied into the worker's result.md, so a /etc/passwd
    // source would smuggle system content into a run. Byte-behavior port of the
    // old build's recordResult system-directory blacklist.
    if (/^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//.test(absolute)) {
      throw new Error(`Result path must not be a system directory: ${resultPath}`);
    }
    if (!fs.existsSync(absolute)) throw new Error(`Result file does not exist: ${resultPath}`);
    const workerId = String(task.workerId);

    // Host-attested `cw result <run> <task> <file>` intake: the operator hands CW
    // an EXTERNAL result file that lives OUTSIDE the worker's read-only write
    // boundary. The old task-level recordResult (lifecycle-operations.ts:279-280)
    // COPIED that external file into the run's results area and recorded the
    // internal path — it never ran the external path through validateSandboxWrite.
    // v2 collapsed the two intakes into recordWorkerOutput, which sandbox-validates
    // its input against the worker boundary, so a bare external path is rejected
    // ("write path is outside sandbox profile <id>"). Restore the copy-in: stage
    // the operator file at the worker's OWN result.md (which IS inside the write
    // boundary), then record that internal path exactly like a driven worker.
    const manifest = showWorkerManifest(run, workerId);
    fs.mkdirSync(path.dirname(manifest.resultPath), { recursive: true });
    fs.copyFileSync(absolute, manifest.resultPath);
    const output = recordWorkerOutput(run, workerId, manifest.resultPath, {
      requireAttestedTelemetry: resolveAgentConfig(args).requireAttestedTelemetry,
      allowUnattested: Boolean(args.allowUnattested ?? args["allow-unattested"]),
    });

    // Host-attested token usage (v0.1.31): record it verbatim as provenance when
    // the operator supplied `--usage-*` flags; CW never synthesizes usage. The old
    // task-level recordResult set `task.usage = usage` (lifecycle-operations.ts:286)
    // and its unit was the TASK. v2 records through recordWorkerOutput, which gives
    // the worker an `output` record — so the observability usage UNIT becomes the
    // WORKER (deriveUsageTotals reads worker.usage for workers with output, and
    // EXCLUDES that task). Attach the usage to the worker scope so the report counts
    // it as an attested unit; also stamp task.usage for byte-parity with the old
    // task-level record.
    const usage = parseUsageFromArgs(args, new Date().toISOString());
    if (usage) {
      task.usage = usage;
      const scope = getWorkerScope(run, workerId);
      if (scope) (scope as unknown as { usage?: unknown }).usage = usage;
    }

    // Byte-exact to the old build's orchestrator recordWorkerOutput()
    // wrapper: an accepted result is its own checkpoint commit, not just a
    // bare saveCheckpoint (SPEC/pipeline-run.md's persist-ordering rule).
    commitState(run, `worker:${workerId}:result`);
    saveCheckpoint(run);
    writeReport(run);
    return output;
  });
}

/** `cw commit <run-id>` — byte-exact port of the old build's
 *  `orchestrator/lifecycle-operations.ts`'s `commit()`: the CLI/MCP
 *  payload wraps the commit record as `{runId, commit}` (NOT the commit
 *  record at top level). Both the success AND the throw path write the
 *  report + checkpoint before returning/re-throwing — a gate failure
 *  still leaves the run's report/state current on disk. */
export function commitRun(args: Record<string, unknown>): Record<string, unknown> {
  const runId = String(args.runId);
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const allowCheckpoint = Boolean(args.allowUnverifiedCheckpoint || args["allow-unverified-checkpoint"]);
  const hasGateOption = Boolean(
    args.verifier || args.verifierNode || args["verifier-node"] || args.candidate || args.selection
  );
  try {
    const commit = commitState(run, {
      reason: typeof args.reason === "string" && args.reason ? args.reason : "manual",
      verifierNodeId:
        (typeof args.verifier === "string" && args.verifier) ||
        (typeof args.verifierNode === "string" && args.verifierNode) ||
        (typeof args["verifier-node"] === "string" && args["verifier-node"]) ||
        undefined,
      candidateId: typeof args.candidate === "string" ? args.candidate : undefined,
      selectionId: typeof args.selection === "string" ? args.selection : undefined,
      verifierGated: hasGateOption || !allowCheckpoint,
      allowUnverifiedCheckpoint: allowCheckpoint,
      source: "cli",
    });
    writeReport(run);
    saveCheckpoint(run);
    return { runId: run.id, commit };
  } catch (error) {
    writeReport(run);
    saveCheckpoint(run);
    throw error;
  }
}
