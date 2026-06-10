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

// --check  : verify the committed docs/project-index.md still matches a fresh
//            scan of the source tree, write nothing, exit non-zero on drift.
// --repo-only : write ONLY the committed repo doc; skip the optional personal
//            sync targets (Obsidian vault, GitHub wiki working tree).
// CW_PROJECT_INDEX_PATH : override the doc path that --check compares against
//            (used by the smoke to point at throwaway fixtures).
const CHECK = process.argv.includes("--check");
const REPO_ONLY = process.argv.includes("--repo-only");
const indexPathOverride = process.env.CW_PROJECT_INDEX_PATH || "";

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
    ["workflow-app-framework.ts", "Validates app manifests and loads app entrypoints."],
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

  // Fail closed if the hand-maintained moduleCatalog references a src module that
  // no longer exists. Without this the generator emits a dead `../src/<file>` link
  // and --check would bless it: the catalog region renders identically from the
  // (stale) constant on both sides, so it is invisible to the diff. This closes
  // the STRUCTURAL half of the catalog blind spot. Responsibility-PROSE staleness
  // (a cataloged file whose contents changed) is not auto-derivable from source
  // and remains out of scope by design — see the PR notes.
  const catalogedFiles = Object.values(moduleCatalog).flat().map(([file]) => file);
  const missingCataloged = catalogedFiles.filter((file) => !sourceFiles.includes(file));
  if (missingCataloged.length > 0) {
    process.stderr.write(
      `project-index FAILED: moduleCatalog references src module(s) that no longer exist: ${missingCataloged.join(", ")}.\n` +
      `A rename/delete must be reflected in moduleCatalog (scripts/sync-project-index.js).\n`
    );
    process.exitCode = 1;
    return;
  }

  const repoDoc = indexPathOverride
    ? path.resolve(indexPathOverride)
    : path.join(pluginRoot, "docs", "project-index.md");
  const rendered = renderIndex("repo", context);

  // Gate mode: compare the committed doc against a fresh render and exit
  // non-zero on drift. Writes nothing and never touches the personal targets.
  // Deliberately reads the WORKING TREE (not git HEAD like version-sync-check.js):
  // this gate is meant to catch "you changed source but forgot to regenerate the
  // index" BEFORE you commit. CI checks out a clean HEAD, so working tree == HEAD
  // there; there is no concurrent-mutation race here (unlike the release-cut flow).
  if (CHECK) {
    checkInSync(repoDoc, rendered);
    return;
  }

  const outputs = [];
  writeFile(repoDoc, rendered);
  outputs.push(repoDoc);

  if (!REPO_ONLY && obsidianDir) {
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

  if (!REPO_ONLY && fs.existsSync(wikiDir)) {
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
  // Keep absolute / personal local paths OUT of the committed doc: describe the
  // optional sync targets generically. The actual destinations are resolved at
  // run time from CW_OBSIDIAN_VAULT / CW_GITHUB_WIKI_DIR (see top of this file).
  lines.push(`- Repository docs: ${link("docs/project-index.md", "docs/project-index.md")}`);
  lines.push("- Obsidian vault (optional): set `CW_OBSIDIAN_VAULT` to your local vault path.");
  lines.push("- GitHub Wiki: the `cool-workflow.wiki` working tree (override with `CW_GITHUB_WIKI_DIR`).");
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

function normalizeForCompare(text) {
  // Strip ONLY the values derived from the runtime ENVIRONMENT (not the source
  // tree), so the gate compares purely source-derived content — it can neither
  // false-RED across machines/forks nor false-GREEN by over-normalizing. Mirrors
  // the parity payload-identity rule: normalize now/env-derived fields, nothing
  // else. Exactly two such fields exist in the rendered index:
  //   1. the generated date ("Generated on <date>") — changes every day;
  //   2. the Repository URL — derived from `git remote get-url origin`, so it
  //      differs on every fork/mirror clone of an otherwise in-sync tree.
  // The Snapshot COUNTS are source-derived and MUST NOT be normalized — a wrong
  // count is exactly the drift this gate exists to catch.
  return text
    .replace(/\r\n/g, "\n")
    .replace(
      /(Generated from the current repository code on )\d{4}-\d{2}-\d{2}( by)/,
      "$1<DATE>$2"
    )
    .replace(/^(- Repository: ).*$/m, "$1<REPO>");
}

function checkInSync(repoDoc, rendered) {
  const rel = path.relative(repoRoot, repoDoc);
  if (!fs.existsSync(repoDoc)) {
    process.stderr.write(`project-index check FAILED: ${rel} does not exist.\nRun: (cd plugins/cool-workflow && npm run sync:project-index)\n`);
    process.exitCode = 1;
    return;
  }
  const committed = normalizeForCompare(fs.readFileSync(repoDoc, "utf8"));
  const fresh = normalizeForCompare(rendered);
  if (committed === fresh) {
    process.stdout.write(`${JSON.stringify({ ok: true, check: true, version: packageJson.version, doc: rel }, null, 2)}\n`);
    return;
  }
  const a = committed.split("\n");
  const b = fresh.split("\n");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  process.stderr.write(
    `project-index check FAILED: ${rel} is stale (does not match a fresh source scan).\n` +
    `First difference at line ${i + 1}:\n` +
    `  committed: ${JSON.stringify(a[i] ?? "<missing>")}\n` +
    `  expected:  ${JSON.stringify(b[i] ?? "<missing>")}\n` +
    `Regenerate with: (cd plugins/cool-workflow && npm run sync:project-index)\n`
  );
  process.exitCode = 1;
}

main();
