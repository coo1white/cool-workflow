#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const packageJson = readJson(path.join(pluginRoot, "package.json"));
const repoRemote = git(["config", "--get", "remote.origin.url"]).trim();
const repoUrl = normalizeGitRemote(repoRemote) || "https://github.com/coo1white/cool-workflow";
const wikiDir = process.env.CW_GITHUB_WIKI_DIR || path.resolve(repoRoot, "..", "cool-workflow.wiki");
const obsidianVault = process.env.CW_OBSIDIAN_VAULT || detectObsidianVault();
const obsidianDir = obsidianVault ? path.join(obsidianVault, "Cool Workflow") : "";
const generatedDate = new Date().toISOString().slice(0, 10);

const moduleCatalog = {
  "Core runtime": [
    ["orchestrator.ts", "Plans runs, loads workflows, records results, writes reports, and exposes runner commands."],
    ["state.ts", "Persists run checkpoints, JSON state, run paths, and state migration entrypoints."],
    ["state-node.ts", "Defines explicit state nodes, pipeline transitions, evidence checks, and node persistence."],
    ["pipeline-contract.ts", "Builds the default pipeline contract used by run state."],
    ["pipeline-runner.ts", "Finds runnable stages and advances/fails pipeline nodes with retry-aware errors."],
    ["types.ts", "Owns the shared workflow, run, app, evidence, worker, candidate, audit, and topology types."]
  ],
  "Verification and state gates": [
    ["verifier.ts", "Validates result envelopes, findings, evidence, and run gate completion."],
    ["commit.ts", "Creates verifier-gated commits and explicit manual checkpoints."],
    ["candidate-scoring.ts", "Registers, scores, ranks, selects, rejects, and summarizes candidate outputs."],
    ["error-feedback.ts", "Turns failures into persisted feedback records and correction tasks."],
    ["trust-audit.ts", "Records provenance, sandbox decisions, host attestations, and acceptance rationale."]
  ],
  "Workers and policy": [
    ["dispatch.ts", "Selects runnable tasks and writes dispatch manifests."],
    ["worker-isolation.ts", "Allocates worker scopes, writes manifests, records worker outputs, and validates boundaries."],
    ["sandbox-profile.ts", "Resolves named sandbox policy contracts and validates read/write/command/network boundaries."],
    ["harness.ts", "Renders task files for dispatched work."]
  ],
  "Multi-agent layer": [
    ["multi-agent.ts", "Persists multi-agent runs, roles, groups, memberships, fanouts, and fanins."],
    ["coordinator.ts", "Owns blackboard topics, messages, context, artifacts, snapshots, and coordinator decisions."],
    ["topology.ts", "Defines and applies official map-reduce, debate, and judge-panel topologies."],
    ["multi-agent-host.ts", "Provides the preferred host loop for run, status, step, blackboard, score, and select."]
  ],
  "User and host surfaces": [
    ["cli.ts", "Routes human CLI commands to runtime, app, topology, multi-agent, and operator flows."],
    ["mcp-server.ts", "Exposes JSON-RPC/MCP tool parity for agent hosts."],
    ["operator-ux.ts", "Formats status, reports, graph, worker, candidate, feedback, commit, and trust summaries."],
    ["workflow-app-sdk.ts", "Validates app manifests and loads app entrypoints."],
    ["workflow-api.ts", "Provides the fluent workflow, phase, task, artifact, and input API."],
    ["daemon.ts", "Runs scheduled tasks through the desktop scheduler daemon."],
    ["scheduler.ts", "Creates, stores, computes, and runs schedules."],
    ["triggers.ts", "Bridges routine triggers to explicit workflow events."],
    ["version.ts", "Defines current package and state schema versions."]
  ]
};

function main() {
  const apps = listApps();
  const docs = listMarkdown(path.join(pluginRoot, "docs"));
  const sourceFiles = listFiles(path.join(pluginRoot, "src"), ".ts");
  const smokeTests = listFiles(path.join(pluginRoot, "test"), ".js").filter((file) => file.endsWith("-smoke.js"));
  const context = { apps, docs, sourceFiles, smokeTests };

  const outputs = [];
  const repoDoc = path.join(pluginRoot, "docs", "project-index.md");
  writeFile(repoDoc, renderIndex("repo", context));
  outputs.push(repoDoc);

  if (obsidianDir) {
    fs.mkdirSync(obsidianDir, { recursive: true });
    const obsidianDoc = path.join(obsidianDir, "CW Project Index.md");
    writeFile(obsidianDoc, renderIndex("obsidian", context));
    ensureLine(
      path.join(obsidianDir, "Cool Workflow - MOC.md"),
      "- [[CW Project Index]]",
      "## 核心笔记"
    );
    outputs.push(obsidianDoc);
  }

  if (fs.existsSync(wikiDir)) {
    const wikiDoc = path.join(wikiDir, "Project-Index.md");
    writeFile(wikiDoc, renderIndex("wiki", context));
    ensureLine(path.join(wikiDir, "_Sidebar.md"), "- [[Project Index]]", "# Cool Workflow");
    outputs.push(wikiDoc);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    generatedDate,
    package: packageJson.name,
    version: packageJson.version,
    sourceModules: sourceFiles.length,
    workflowApps: apps.length,
    docs: docs.length,
    smokeTests: smokeTests.length,
    outputs: outputs.map((file) => path.relative(repoRoot, file))
  }, null, 2)}\n`);
}

function listApps() {
  const appsDir = path.join(pluginRoot, "apps");
  return fs.readdirSync(appsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const appDir = path.join(appsDir, entry.name);
      const manifest = readJson(path.join(appDir, "app.json"));
      return {
        id: manifest.id,
        title: manifest.title,
        summary: manifest.summary,
        version: manifest.version,
        inputs: (manifest.inputs || []).map((input) => input.name),
        sandboxProfiles: manifest.sandboxProfiles || [],
        canonical: Boolean(manifest.metadata && manifest.metadata.canonical),
        example: Boolean(manifest.metadata && manifest.metadata.example),
        manifestPath: path.relative(pluginRoot, path.join(appDir, "app.json")),
        workflowPath: path.relative(pluginRoot, path.join(appDir, manifest.workflow && manifest.workflow.entrypoint || "workflow.js"))
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function listMarkdown(dir) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const absolute = path.join(dir, file);
      const text = fs.readFileSync(absolute, "utf8");
      const title = (text.match(/^#\s+(.+)$/m) || [null, file])[1];
      return { file, title };
    });
}

function listFiles(dir, extension) {
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .sort();
}

function renderIndex(target, context) {
  const link = linkFactory(target);
  const lines = [];
  lines.push("# Cool Workflow Project Index");
  lines.push("");
  lines.push(`Generated from the current repository code on ${generatedDate} by \`npm run sync:project-index\`.`);
  lines.push("");
  lines.push("## Snapshot");
  lines.push("");
  lines.push(`- Package: \`${packageJson.name}\``);
  lines.push(`- Version: \`${packageJson.version}\``);
  lines.push(`- Source modules: \`${context.sourceFiles.length}\``);
  lines.push(`- Workflow apps: \`${context.apps.length}\``);
  lines.push(`- Docs: \`${context.docs.length}\``);
  lines.push(`- Smoke tests: \`${context.smokeTests.length}\``);
  lines.push(`- Repository: ${repoUrl}`);
  lines.push("");
  lines.push("## Architecture");
  lines.push("");
  lines.push("```text");
  lines.push("workflow app -> runner -> dispatch -> isolated workers");
  lines.push("    -> results -> feedback/candidates -> verifier gate");
  lines.push("    -> commit/checkpoint -> report/trust audit");
  lines.push("");
  lines.push("multi-agent host -> topology -> blackboard/coordinator");
  lines.push("    -> fanout/fanin -> candidate score/select");
  lines.push("```");
  lines.push("");
  lines.push("## Source Map");
  lines.push("");
  for (const [area, modules] of Object.entries(moduleCatalog)) {
    lines.push(`### ${area}`);
    lines.push("");
    lines.push("| Module | Responsibility |");
    lines.push("| --- | --- |");
    for (const [file, responsibility] of modules) {
      lines.push(`| ${link(`src/${file}`, file)} | ${responsibility} |`);
    }
    lines.push("");
  }
  const cataloged = new Set(Object.values(moduleCatalog).flat().map(([file]) => file));
  const uncataloged = context.sourceFiles.filter((file) => !cataloged.has(file));
  if (uncataloged.length > 0) {
    lines.push("### Other Source Modules");
    lines.push("");
    for (const file of uncataloged) lines.push(`- ${link(`src/${file}`, file)}`);
    lines.push("");
  }
  lines.push("## Workflow Apps");
  lines.push("");
  lines.push("| App | Type | Inputs | Sandbox | Source |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const app of context.apps) {
    const type = app.canonical ? "canonical" : app.example ? "example" : "userland";
    lines.push(`| \`${app.id}\` - ${app.summary} | ${type} | ${inlineList(app.inputs)} | ${inlineList(app.sandboxProfiles)} | ${link(app.manifestPath, "manifest")} / ${link(app.workflowPath, "workflow")} |`);
  }
  lines.push("");
  lines.push("## Documentation Map");
  lines.push("");
  for (const doc of context.docs) {
    lines.push(`- ${link(`docs/${doc.file}`, doc.title)}`);
  }
  lines.push("");
  lines.push("## Test Surface");
  lines.push("");
  lines.push("Smoke tests mirror the public contracts. The high-signal suites are:");
  lines.push("");
  for (const file of context.smokeTests) lines.push(`- ${link(`test/${file}`, file)}`);
  lines.push("");
  lines.push("## Sync Targets");
  lines.push("");
  lines.push(`- Repository docs: ${link("docs/project-index.md", "docs/project-index.md")}`);
  if (obsidianDir) lines.push(`- Obsidian: \`${path.join(obsidianDir, "CW Project Index.md")}\``);
  if (fs.existsSync(wikiDir)) lines.push(`- GitHub Wiki: \`${path.join(wikiDir, "Project-Index.md")}\``);
  lines.push("");
  lines.push("## Maintenance");
  lines.push("");
  lines.push("Run this after changing source modules, workflow app manifests, public docs, or smoke test coverage:");
  lines.push("");
  lines.push("```bash");
  lines.push("cd plugins/cool-workflow");
  lines.push("npm run sync:project-index");
  lines.push("```");
  lines.push("");
  lines.push("Then review the Obsidian page and GitHub Wiki working tree before publishing wiki changes.");
  lines.push("");
  return lines.join("\n");
}

function linkFactory(target) {
  if (target === "repo") {
    return (relativePath, label) => `[${label}](${relativeLinkFromDocs(relativePath)})`;
  }
  if (target === "wiki") {
    return (relativePath, label) => `[${label}](${repoUrl}/blob/main/plugins/cool-workflow/${relativePath})`;
  }
  return (relativePath, label) => `[${label}](${path.join(pluginRoot, relativePath)})`;
}

function relativeLinkFromDocs(relativePath) {
  if (relativePath.startsWith("docs/")) return relativePath.slice("docs/".length);
  return `../${relativePath}`;
}

function inlineList(values) {
  if (!values || values.length === 0) return "-";
  return values.map((value) => `\`${value}\``).join(", ");
}

function ensureLine(file, line, afterHeading) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes(line)) return;
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((entry) => entry.trim() === afterHeading);
  if (index === -1) {
    lines.push("", line);
  } else {
    lines.splice(index + 1, 0, line);
  }
  writeFile(file, lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function detectObsidianVault() {
  const candidate = path.join(process.env.HOME || "", "Documents", "Nick");
  return fs.existsSync(path.join(candidate, ".obsidian")) ? candidate : "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function normalizeGitRemote(remote) {
  if (!remote) return "";
  if (remote.endsWith(".git")) remote = remote.slice(0, -4);
  const sshMatch = remote.match(/^git@github\.com:(.+)$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  return remote;
}

main();
