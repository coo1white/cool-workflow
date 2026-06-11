#!/usr/bin/env node
"use strict";

// Dogfood: architecture-review driven END-TO-END by the agent backend (v0.1.38).
//
// TWO HALVES (mirrors dogfood-one-real-repo.7.md discipline):
//   --smoke  : CI-VERIFIABLE. A hermetic STUB agent (no live binary, no second
//              repo, no network) drives the real architecture-review app to
//              completion. Emits { ok, mode:"smoke", reportPath, auditSummaryPath,
//              verdictAccepted, agentDelegationEvents }. Run under `npm test`.
//   (default): MAINTAINER-RUN, OUT OF CI. A REAL configured agent (CW_AGENT_COMMAND
//              / --agent-command, e.g. `claude -p` / `codex exec`) drives ONE real
//              external repo (--repo) and writes a committed audited report +
//              a docs/dogfood/architecture-review-<repo>.md provenance note. This
//              depends on a live agent binary + a second repo, which CI cannot have.
//
// THE RED LINE: the model runs in the external agent's process. This script spawns
// the agent and records its attested output; it imports no model SDK and holds no
// API key.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { CoolWorkflowRunner } = require(path.join(pluginRoot, "dist/orchestrator.js"));
const { drive } = require(path.join(pluginRoot, "dist/drive.js"));
const { resolveAgentConfig } = require(path.join(pluginRoot, "dist/agent-config.js"));

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const json = flags.has("--json");
const smoke = flags.has("--smoke");

function argValue(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

// Deterministic injected now keeps the smoke reproducible (scheduling/backoff).
const FIXED_NOW = "2026-06-09T00:00:00.000Z";

function writeStubAgent(dir) {
  const file = path.join(dir, "stub-agent.js");
  // A vendor-neutral stub standing in for `claude -p` / `codex exec`: it reads the
  // worker result path (argv[2]), writes a VALID cw:result with durable evidence,
  // and reports a model + usage on stdout (the attested model, never CW_AGENT_MODEL).
  fs.writeFileSync(
    file,
    [
      'const fs = require("fs");',
      "const fence = String.fromCharCode(96).repeat(3);",
      "const resultPath = process.argv[2];",
      "const evidence = [process.cwd() + '/README.md:1'];",
      'const body = "# Worker Result\\n\\nStub agent synthesized this audited section.\\n\\n" + fence + "cw:result\\n" + JSON.stringify({ summary: "stub agent audited section", findings: [], evidence }) + "\\n" + fence + "\\n";',
      "fs.writeFileSync(resultPath, body);",
      'process.stdout.write(JSON.stringify({ model: "stub-agent/architecture-review", usage: { input_tokens: 12, output_tokens: 8 } }));'
    ].join("\n"),
    "utf8"
  );
  return file;
}

function auditSummaryFor(runner, run) {
  const audit = runner.auditSummary(run.id);
  const byKind = audit.byKind || (audit.summary && audit.summary.byKind) || {};
  const auditDir = path.join(run.paths.runDir, "audit");
  fs.mkdirSync(auditDir, { recursive: true });
  const auditSummaryPath = path.join(auditDir, "summary.json");
  fs.writeFileSync(auditSummaryPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  return { audit, byKind, auditSummaryPath };
}

function runSmoke() {
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-dogfood-archreview-")));
  fs.writeFileSync(path.join(work, "README.md"), "# smoke target repo\n", "utf8");
  const stub = writeStubAgent(work);
  const cwd0 = process.cwd();
  process.chdir(work);
  try {
    // The run artifacts (report + audit summary) are LEFT IN PLACE under `work` so
    // the gate can existsSync them — the caller cleans up `summary.workspace`.
    const runner = new CoolWorkflowRunner({ pluginRoot });
    const run = runner.plan("architecture-review", { repo: work, question: "Smoke: is the control plane sound?" });
    const result = drive(runner, run.id, {
      now: FIXED_NOW,
      agentConfig: { schemaVersion: 1, command: process.execPath, args: [stub, "{{result}}"], model: "smoke-operator-pick", source: "flag" }
    });
    const final = runner.loadRun(run.id);
    const { byKind, auditSummaryPath } = auditSummaryFor(runner, final);
    const verdict = final.tasks.find((task) => /^verdict[:/]/i.test(task.id));
    const verdictAccepted = Boolean(verdict && verdict.status === "completed");
    const agentDelegationEvents = byKind["worker.agent-delegation"] || 0;
    const reportedModels = Array.from(
      new Set(
        final.nodes
          .filter((node) => node.kind === "result" && node.metadata && node.metadata.agentDelegation)
          .map((node) => node.metadata.agentDelegation.model)
      )
    );
    const ok =
      result.status === "complete" &&
      result.completedWorkers === result.plannedWorkers &&
      verdictAccepted &&
      agentDelegationEvents >= 1 &&
      Boolean(result.commitId) &&
      fs.existsSync(final.paths.report) &&
      fs.existsSync(auditSummaryPath);
    const summary = {
      ok,
      mode: "smoke",
      runId: run.id,
      workflowId: final.workflow.id,
      workspace: work,
      plannedWorkers: result.plannedWorkers,
      completedWorkers: result.completedWorkers,
      verdictAccepted,
      agentDelegationEvents,
      reportedModels,
      commitId: result.commitId,
      statePath: final.paths.state,
      reportPath: final.paths.report,
      auditSummaryPath
    };
    return summary;
  } finally {
    process.chdir(cwd0);
  }
}

function runLive() {
  const repo = argValue("--repo");
  const question = argValue("--question", "Audit this repository's architecture and rank the real risks.");
  if (!repo) throw new Error("live dogfood requires --repo <path-to-real-repo> (and a configured agent via CW_AGENT_COMMAND or --agent-command)");
  const repoAbs = path.resolve(repo);
  if (!fs.existsSync(repoAbs) || !fs.statSync(repoAbs).isDirectory()) {
    throw new Error(`--repo is not an existing directory: ${repoAbs} (pass a real repository path, e.g. --repo "$(pwd)/../..")`);
  }
  const agentConfig = resolveAgentConfig({
    agentCommand: argValue("--agent-command"),
    agentEndpoint: argValue("--agent-endpoint"),
    agentModel: argValue("--agent-model")
  });
  if (!agentConfig.command && !agentConfig.endpoint) {
    throw new Error("live dogfood requires a configured agent: set CW_AGENT_COMMAND or pass --agent-command (a wrapper that reads {{input}} and writes {{result}} — see docs/agent-delegation-drive.7.md)");
  }
  const runner = new CoolWorkflowRunner({ pluginRoot });
  const run = runner.plan("architecture-review", { repo: repoAbs, question });
  // The run lives under the repo's .cw/ and every runner verb resolves a run from
  // the process cwd, so drive WITH the repo as cwd (the agent also reads the repo).
  const cwd0 = process.cwd();
  let result;
  let final;
  let byKind;
  let auditSummaryPath;
  try {
    if (repoAbs !== process.cwd()) process.chdir(repoAbs);
    result = drive(runner, run.id, { now: argValue("--now"), agentConfig });
    final = runner.loadRun(run.id);
    ({ byKind, auditSummaryPath } = auditSummaryFor(runner, final));
  } finally {
    if (process.cwd() !== cwd0) process.chdir(cwd0);
  }
  const reportedModels = Array.from(
    new Set(
      final.nodes
        .filter((node) => node.kind === "result" && node.metadata && node.metadata.agentDelegation)
        .map((node) => node.metadata.agentDelegation.model)
    )
  );
  // Maintainer/self-referential artifact: a committed file recording the repo name
  // + the agent-reported model id (the proof, OUT of CI).
  const repoName = path.basename(path.resolve(repo));
  const provenanceDir = path.join(pluginRoot, "docs", "dogfood");
  fs.mkdirSync(provenanceDir, { recursive: true });
  const provenancePath = path.join(provenanceDir, `architecture-review-${repoName}.md`);
  // The committed proof artifact: self-contained (CW version, date, agent-reported
  // usage totals), so the note evidences WHICH pipeline completed with a REAL
  // agent without needing the local run directory.
  const cwVersion = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")).version;
  const usageTotals = (final.workers || [])
    .filter((worker) => worker.usage)
    .reduce(
      (acc, worker) => ({
        workers: acc.workers + 1,
        inputTokens: acc.inputTokens + (worker.usage.inputTokens || 0),
        outputTokens: acc.outputTokens + (worker.usage.outputTokens || 0)
      }),
      { workers: 0, inputTokens: 0, outputTokens: 0 }
    );
  fs.writeFileSync(
    provenancePath,
    [
      `# Dogfood: architecture-review --drive on ${repoName} (CW v${cwVersion})`,
      "",
      "Maintainer-run live proof (OUT of CI): a real external agent drove the whole",
      "architecture-review workflow end-to-end with zero hand-written result.md. The",
      "model ran in the agent's process; CW spawned it and recorded the attested",
      "output. CW holds no API key and imports no model SDK.",
      "",
      `- Date: ${new Date().toISOString().slice(0, 10)}`,
      `- Run: ${run.id}`,
      `- Status: ${result.status}`,
      `- Workers driven: ${result.completedWorkers}/${result.plannedWorkers} (zero hand-written result.md)`,
      `- Agent-reported model(s): ${reportedModels.join(", ") || "unreported"} — sourced solely from the agent's own report, never CW_AGENT_MODEL`,
      `- Agent-reported usage: ${usageTotals.workers}/${result.plannedWorkers} workers reported tokens (${usageTotals.inputTokens} in / ${usageTotals.outputTokens} out)`,
      `- agent-delegation audit events: ${byKind["worker.agent-delegation"] || 0}`,
      `- Commit: ${result.commitId || "none"}`,
      `- Agent template: scripts/agents/claude-p-agent.js (read-only claude; the wrapper persists result.md and forwards model+usage)`,
      ""
    ].join("\n"),
    "utf8"
  );
  return {
    ok: result.status === "complete",
    mode: "live",
    runId: run.id,
    repo: path.resolve(repo),
    plannedWorkers: result.plannedWorkers,
    completedWorkers: result.completedWorkers,
    reportedModels,
    commitId: result.commitId,
    reportPath: final.paths.report,
    auditSummaryPath,
    provenancePath
  };
}

function main() {
  const summary = smoke ? runSmoke() : runLive();
  if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else process.stdout.write(`dogfood-architecture-review (${summary.mode}): ${summary.ok ? "ok" : "FAILED"} — ${summary.completedWorkers}/${summary.plannedWorkers} workers, commit ${summary.commitId || "none"}\n`);
  if (!summary.ok) process.exitCode = 1;
  return summary;
}

main();
