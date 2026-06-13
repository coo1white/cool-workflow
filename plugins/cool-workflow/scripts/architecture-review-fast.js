#!/usr/bin/env node
"use strict";

// architecture-review-fast — userland accelerator wrapper.
//
// Mechanism only: prepare one cached JSONL source context, pass its digest into
// the opt-in fast app, then optionally create a background schedule for the full
// architecture-review app. The model still runs only through CW's external agent
// backend; this script imports no model SDK and holds no key.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const node = process.execPath;
const cw = path.join(pluginRoot, "scripts", "cw.js");
const sourceContext = path.join(pluginRoot, "scripts", "source-context.js");

function main() {
  const started = nowNs();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage(0);

  const repo = path.resolve(required(args.repo, "repo"));
  const question = required(args.question, "question");
  const profile = stringArg(args.profile) || "core";
  const ref = stringArg(args.ref) || "HEAD";
  const profileFile = stringArg(args.profileFile || args["profile-file"]);
  const cacheDir = path.resolve(stringArg(args.cacheDir || args["cache-dir"]) || path.join(repo, ".cw", "cache", "source-context"));
  const contextOut = path.resolve(stringArg(args.contextOut || args["context-out"]) || path.join(repo, ".cw", "context", `${profile}-source.jsonl`));
  const includeMetrics = truthy(args.metrics);
  const fastModel = stringArg(args.fastModel || args["fast-model"]);
  const strongModel = stringArg(args.strongModel || args["strong-model"]);
  const modelEnv = modelPolicyEnv(fastModel, strongModel);

  const contextExport = timed(() => exportSourceContext({
    repo,
    profile,
    ref,
    profileFile,
    cacheDir
  }));
  const contextText = contextExport.value;
  fs.mkdirSync(path.dirname(contextOut), { recursive: true });
  fs.writeFileSync(contextOut, contextText, "utf8");
  const digest = `sha256:${crypto.createHash("sha256").update(contextText, "utf8").digest("hex")}`;

  const reviewArgs = [
    "quickstart",
    "architecture-review-fast",
    "--repo",
    repo,
    "--question",
    question,
    "--sourceContext",
    contextOut,
    "--sourceContextDigest",
    digest
  ];
  appendRepeated(reviewArgs, "--invariant", args.invariant);
  appendOption(reviewArgs, "--focus", args.focus);
  appendPassThrough(reviewArgs, args, [
    "agent-command",
    "agentCommand",
    "agent-endpoint",
    "agentEndpoint",
    "agent-model",
    "agentModel",
    "agent-timeout-ms",
    "agentTimeoutMs",
    "once",
    "preview",
    "now"
  ]);

  const fastReviewRun = timed(() => runCwJson(reviewArgs, repo, modelEnv));
  const fastReview = fastReviewRun.value;
  const sourceContextMeta = {
    path: contextOut,
    digest,
    profile,
    ref,
    cacheDir
  };
  const fullReviewScheduleRun = truthy(args.scheduleFull || args["schedule-full"])
    ? timed(() => scheduleFullReview(repo, question, args, fastReview, sourceContextMeta))
    : undefined;
  const fullReviewSchedule = fullReviewScheduleRun?.value;

  writeJson({
    schemaVersion: 1,
    appId: "architecture-review-fast",
    sourceContext: sourceContextMeta,
    fastReview,
    ...(fastModel || strongModel ? { modelPolicy: { ...(fastModel ? { fastModel } : {}), ...(strongModel ? { strongModel } : {}) } } : {}),
    ...(fullReviewSchedule ? { fullReviewSchedule } : {}),
    ...(includeMetrics ? { metrics: buildMetrics(started, contextText, contextExport.elapsedMs, fastReview, fastReviewRun.elapsedMs, fullReviewScheduleRun?.elapsedMs) } : {})
  });
}

function exportSourceContext(options) {
  const argv = [
    sourceContext,
    "export",
    "--profile",
    options.profile,
    "--ref",
    options.ref,
    "--repo-root",
    options.repo,
    "--cache-dir",
    options.cacheDir
  ];
  if (options.profileFile) argv.push("--profile-file", path.resolve(options.profileFile));
  const result = spawnSync(node, argv, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128
  });
  if (result.status !== 0) die(result.stderr || result.stdout || "source context export failed");
  return result.stdout;
}

function scheduleFullReview(repo, question, args, fastReview, sourceContextMeta) {
  const delayMinutes = stringArg(args.fullDelayMinutes || args["full-delay-minutes"]) || "1";
  const prompt = [
    `Run full architecture-review for ${repo}.`,
    `Question: ${question}`,
    args.focus ? `Focus: ${args.focus}` : "",
    `Fast review run: ${fastReview?.runId || "unknown"}.`,
    fastReview?.reportPath ? `Fast review report: ${fastReview.reportPath}.` : "",
    `Fast review status: ${fastReview?.status || "unknown"} (${fastReview?.completedWorkers || 0}/${fastReview?.plannedWorkers || 0} workers completed).`,
    `Source context: ${sourceContextMeta.path} (${sourceContextMeta.digest}, profile ${sourceContextMeta.profile}, ref ${sourceContextMeta.ref}).`,
    "Use the completed architecture-review-fast report as the foreground triage result; write the full review report path and digest when the background review finishes."
  ].filter(Boolean).join(" ");
  return runCwJson([
    "schedule",
    "create",
    "--cwd",
    repo,
    "--kind",
    "reminder",
    "--delayMinutes",
    delayMinutes,
    "--maxRuns",
    "1",
    "--workflowId",
    "architecture-review",
    "--prompt",
    prompt
  ], repo);
}

function runCwJson(args, cwd, extraEnv = {}) {
  const result = spawnSync(node, [cw, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    maxBuffer: 1024 * 1024 * 64
  });
  if (result.status !== 0) die(result.stderr || result.stdout || `cw ${args.join(" ")} failed`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    die(`cw returned non-JSON output: ${error.message}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      (args._ ||= []).push(token);
      continue;
    }
    const raw = token.slice(2);
    const eq = raw.indexOf("=");
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const value = eq >= 0 ? raw.slice(eq + 1) : argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    if (args[key] === undefined) args[key] = value;
    else if (Array.isArray(args[key])) args[key].push(value);
    else args[key] = [args[key], value];
  }
  return args;
}

function appendPassThrough(argv, args, keys) {
  for (const key of keys) {
    if (args[key] === undefined) continue;
    const flag = key.includes("-") ? `--${key}` : `--${key}`;
    if (args[key] === true) argv.push(flag);
    else appendRepeated(argv, flag, args[key]);
  }
}

function appendRepeated(argv, flag, value) {
  if (value === undefined || value === false) return;
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) argv.push(flag, String(entry));
}

function appendOption(argv, flag, value) {
  if (value === undefined || value === false || value === true || value === "") return;
  argv.push(flag, String(value));
}

function required(value, name) {
  const text = stringArg(value);
  if (!text) die(`missing required --${name}`);
  return text;
}

function stringArg(value) {
  if (value === undefined || value === null || value === true || value === false) return "";
  return Array.isArray(value) ? String(value[value.length - 1] || "") : String(value);
}

function truthy(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function modelPolicyEnv(fastModel, strongModel) {
  return {
    ...(fastModel ? { CW_ARCHITECTURE_REVIEW_FAST_MODEL: fastModel } : {}),
    ...(strongModel ? { CW_ARCHITECTURE_REVIEW_STRONG_MODEL: strongModel } : {})
  };
}

function nowNs() {
  return process.hrtime.bigint();
}

function elapsedMs(started) {
  return Number((process.hrtime.bigint() - started) / 1000000n);
}

function timed(fn) {
  const started = nowNs();
  const value = fn();
  return { value, elapsedMs: elapsedMs(started) };
}

function buildMetrics(started, contextText, sourceContextElapsedMs, fastReview, fastReviewElapsedMs, fullReviewScheduleElapsedMs) {
  const steps = Array.isArray(fastReview?.steps) ? fastReview.steps : [];
  const handleKinds = countBy(steps.map((step) => step && step.handleKind).filter(Boolean));
  const actions = countBy(steps.map((step) => step && step.action).filter(Boolean));
  return {
    totalElapsedMs: elapsedMs(started),
    sourceContext: {
      elapsedMs: sourceContextElapsedMs,
      bytes: Buffer.byteLength(contextText, "utf8")
    },
    fastReview: {
      elapsedMs: fastReviewElapsedMs,
      status: fastReview?.status,
      plannedWorkers: fastReview?.plannedWorkers,
      completedWorkers: fastReview?.completedWorkers,
      steps: steps.length,
      actions,
      handleKinds,
      resultCacheHits: Number(handleKinds["result-cache"] || 0),
      agentSpawns: steps.filter((step) => step && step.backendId === "agent" && step.handleKind && step.handleKind !== "result-cache").length
    },
    ...(fullReviewScheduleElapsedMs === undefined ? {} : { fullReviewSchedule: { elapsedMs: fullReviewScheduleElapsedMs } })
  };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[String(value)] = (counts[String(value)] || 0) + 1;
  return counts;
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(code) {
  process.stderr.write([
    "usage:",
    "  node scripts/architecture-review-fast.js --repo PATH --question TEXT [--agent-command CMD]",
    "",
    "options:",
    "  --profile core --ref HEAD --profile-file PATH --cache-dir DIR --context-out PATH",
    "  --fast-model MODEL --strong-model MODEL",
    "  --invariant TEXT --focus TEXT --preview --once",
    "  --schedule-full [--full-delay-minutes N]",
    "  --metrics"
  ].join("\n") + "\n");
  process.exitCode = code;
}

function die(message) {
  process.stderr.write(`architecture-review-fast: ${String(message).trim()}\n`);
  process.exit(1);
}

main();
