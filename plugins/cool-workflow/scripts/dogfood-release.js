#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TARGET_VERSION = "0.1.79";
const PREVIOUS_VERSION = "0.1.31";
const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const cli = path.join(pluginRoot, "scripts", "cw.js");
const node = process.execPath;

function main() {
  const options = parseArgs(process.argv.slice(2));
  const dryRun = !options.execute;
  enforceReleaseActionGate(options, dryRun);

  const plan = cwJson(
    [
      "plan",
      "release-cut",
      "--repo",
      repoRoot,
      "--version",
      TARGET_VERSION,
      "--previousVersion",
      PREVIOUS_VERSION,
      "--releaseBranch",
      currentBranch(),
      "--dryRun",
      String(dryRun)
    ],
    repoRoot
  );

  const context = {
    options,
    dryRun,
    runId: plan.runId,
    reportPath: plan.reportPath,
    statePath: plan.statePath,
    commandResults: [],
    workerIds: [],
    taskWorkers: {},
    externalActions: []
  };

  for (const taskId of [
    "preflight:repo-state",
    "audit:versions",
    "notes:update",
    "package:artifacts",
    "verify:package",
    "verdict:release"
  ]) {
    runTask(context, taskId);
  }

  const verdictWorkerId = context.taskWorkers["verdict:release"];
  const allPassed = context.commandResults.every((result) => result.status === 0);
  const candidateId = `dogfood-release-${TARGET_VERSION}`;
  const evidence = compactEvidence(context.commandResults.map((result) => result.locator));

  const candidate = cwJson(
    ["candidate", "register", context.runId, "--worker", verdictWorkerId, "--id", candidateId, "--kind", "release"],
    repoRoot
  );

  const scoreArgs = [
    "candidate",
    "score",
    context.runId,
    candidateId,
    "--criterion",
    `correctness=${allPassed ? 10 : 0}`,
    "--criterion",
    `completeness=${requiredEvidencePresent(context) ? 10 : 0}`,
    "--criterion",
    `releaseSafety=${dryRun && context.externalActions.length === 0 ? 10 : 0}`,
    "--criterion",
    `auditability=${context.workerIds.length >= 6 ? 10 : 0}`,
    "--criterion",
    `reproducibility=${allPassed ? 10 : 4}`,
    "--maxTotal",
    "50",
    "--verdict",
    allPassed ? "pass" : "fail",
    "--notes",
    allPassed
      ? "Dogfood release candidate accepted: all real dry-run evidence commands passed."
      : "Dogfood release candidate held: at least one real evidence command failed."
  ];
  for (const locator of evidence.slice(0, 20)) scoreArgs.push("--evidence", locator);
  const score = cwJson(scoreArgs, repoRoot);

  let selection = null;
  let commit = null;
  let releaseVerdict = "hold";
  if (allPassed) {
    selection = cwJson(
      [
        "candidate",
        "select",
        context.runId,
        candidateId,
        "--reason",
        `Dogfood release ${TARGET_VERSION} selected after verifier-backed dry-run evidence.`
      ],
      repoRoot
    );
    const commitResult = cwJson(
      [
        "commit",
        context.runId,
        "--selection",
        selection.id,
        "--reason",
        `Dogfood One Real Repo ${TARGET_VERSION} verifier-gated checkpoint`
      ],
      repoRoot
    );
    commit = commitResult.commit;
    releaseVerdict = "ready-dry-run";
  } else {
    const checkpoint = cwJson(
      [
        "commit",
        context.runId,
        "--allow-unverified-checkpoint",
        "--reason",
        `Dogfood One Real Repo ${TARGET_VERSION} held; evidence commands failed.`
      ],
      repoRoot
    );
    commit = checkpoint.commit;
  }

  const auditSummary = cwJson(["audit", "summary", context.runId], repoRoot);
  const provenanceArgs = ["audit", "provenance", context.runId];
  if (commit && commit.id) provenanceArgs.push("--commit", commit.id);
  const provenance = cwJson(provenanceArgs, repoRoot);
  const reportPath = cwText(["report", context.runId], repoRoot).trim();

  const summary = {
    ok: allPassed,
    mode: options.smoke ? "smoke" : "full",
    dryRun,
    runId: context.runId,
    statePath: context.statePath,
    reportPath,
    auditSummaryPath: auditSummary.summaryPath,
    auditEventLogPath: auditSummary.eventLogPath,
    auditIndexPath: auditSummary.indexPath,
    provenanceEvidenceCount: provenance.evidence.length,
    provenanceEventCount: provenance.events.length,
    workerIds: context.workerIds,
    candidateId: candidate.id,
    scoreId: score.id,
    selectionId: selection ? selection.id : null,
    commitId: commit ? commit.id : null,
    checkpointId: commit && commit.checkpoint ? commit.id : null,
    releaseVerdict,
    commandResults: context.commandResults.map((result) => ({
      id: result.id,
      command: result.command,
      cwd: result.cwd,
      status: result.status,
      logPath: result.logPath,
      locator: result.locator
    })),
    releaseActions: {
      tag: Boolean(options.tag),
      push: Boolean(options.push),
      publish: Boolean(options.publish),
      skipped: dryRun || context.externalActions.length === 0,
      reason: dryRun
        ? "dry-run mode never creates git tags, pushes, publishes, or mutates external state"
        : "no release action flag requested"
    }
  };
  const summaryPath = path.join(path.dirname(context.statePath), "dogfood-summary.json");
  writeJson(summaryPath, { ...summary, summaryPath });
  summary.summaryPath = summaryPath;

  if (options.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else {
    process.stdout.write(
      [
        `dogfood-release: ${allPassed ? "ok" : "hold"}`,
        `run: ${summary.runId}`,
        `report: ${summary.reportPath}`,
        `audit: ${summary.auditSummaryPath}`,
        `candidate: ${summary.candidateId}`,
        `selection: ${summary.selectionId || "held"}`,
        `commit/checkpoint: ${summary.commitId || summary.checkpointId}`,
        `summary: ${summary.summaryPath}`,
        ""
      ].join("\n")
    );
  }

  if (!allPassed) process.exitCode = 1;
}

function runTask(context, expectedTaskId) {
  const dispatch = cwJson(["dispatch", context.runId, "--limit", "1"], repoRoot);
  if (!dispatch.tasks || dispatch.tasks.length !== 1) {
    throw new Error(`Expected one dispatched task for ${expectedTaskId}`);
  }
  const task = dispatch.tasks[0];
  if (task.id !== expectedTaskId) throw new Error(`Expected ${expectedTaskId}, got ${task.id}`);
  const workerId = task.workerId;
  context.workerIds.push(workerId);
  context.taskWorkers[task.id] = workerId;

  const manifest = cwJson(["worker", "manifest", context.runId, workerId], repoRoot);
  const commandResults = executeCommandsForTask(context, task.id, manifest);
  const taskEvidence = evidenceForTask(task.id, commandResults, context);
  const findings = commandResults
    .filter((result) => result.status !== 0)
    .map((result) => ({
      id: `${result.id}:failed`,
      classification: "real",
      severity: "P1",
      evidence: [result.locator]
    }));

  const resultMarkdown = renderWorkerResult({
    task,
    manifest,
    commandResults,
    findings,
    evidence: taskEvidence,
    dryRun: context.dryRun,
    smoke: context.options.smoke
  });
  fs.writeFileSync(manifest.resultPath, resultMarkdown, "utf8");
  cwJson(["worker", "output", context.runId, workerId, manifest.resultPath], repoRoot);
}

function executeCommandsForTask(context, taskId, manifest) {
  const commands = commandsForTask(taskId, context);
  const results = [];
  for (const command of commands) {
    const result = runEvidenceCommand(command, manifest, context);
    results.push(result);
    context.commandResults.push(result);
    cwJson(
      [
        "audit",
        "attest",
        context.runId,
        "--worker",
        manifest.id,
        "--hostEnforced",
        "true",
        "--command",
        result.command,
        "--note",
        `dogfood ${taskId} command status=${result.status}`
      ],
      repoRoot
    );
    cwJson(["audit", "decision", context.runId, manifest.id, "--command", result.command], repoRoot);
  }
  return results;
}

// Read a release surface from the COMMIT being released (the blob at HEAD), not
// the mutable working tree. A release gate that reads the working tree can
// false-RED when a concurrent writer briefly mutates-then-reverts a surface
// (the read lands in that window) even though the committed tree is correct and
// `git status` is clean — and could false-GREEN on an uncommitted local edit.
// `git show HEAD:<path>` is immutable for the life of the commit, so the gate is
// deterministic. Falls back to the working tree only when the path is not
// tracked at HEAD or we are not in a git work tree. Emitted as a `node -e` body
// so each check stays a separate audited evidence command (cwd: repoRoot).
// node + git only — no ripgrep (CI portability rule).
function releaseSourceReaderSnippet() {
  return [
    "const cp=require('child_process');",
    "const fs=require('fs');",
    "function readHead(f){",
    " const r=cp.spawnSync('git',['show','HEAD:'+f],{encoding:'utf8',maxBuffer:1024*1024*32});",
    " if(r.status===0) return r.stdout;",
    " return null;",
    "}",
    "function readSurface(f){",
    " const h=readHead(f);",
    " if(h!==null) return h;",
    " return fs.existsSync(f)?fs.readFileSync(f,'utf8'):null;",
    "}",
    "function surfaceExists(f){",
    " const r=cp.spawnSync('git',['cat-file','-e','HEAD:'+f],{encoding:'utf8'});",
    " if(r.status===0) return true;",
    " return fs.existsSync(f);",
    "}"
  ].join("");
}

function commandsForTask(taskId, context) {
  const smoke = context.options.smoke;
  const versionCheck = { id: "version-sync", cwd: pluginRoot, command: [node, ["scripts/version-sync-check.js"]] };
  switch (taskId) {
    case "preflight:repo-state":
      return [
        { id: "git-status", cwd: repoRoot, command: ["git", ["status", "--short", "--branch"]] },
        { id: "git-head", cwd: repoRoot, command: ["git", ["rev-parse", "HEAD"]] },
        { id: "node-version", cwd: repoRoot, command: [node, ["--version"]] },
        { id: "npm-version", cwd: pluginRoot, command: ["npm", ["--version"]] }
      ];
    case "audit:versions":
      return [
        versionCheck,
        {
          id: "version-surfaces",
          cwd: repoRoot,
          command: [
            node,
            [
              "-e",
              [
                releaseSourceReaderSnippet(),
                "for (const f of ['plugins/cool-workflow/package.json','plugins/cool-workflow/src/version.ts','CHANGELOG.md','RELEASE.md']) {",
                " const t=readSurface(f);",
                ` if (t===null) throw new Error(f+' missing from release commit');`,
                ` if (!t.includes('${TARGET_VERSION}')) throw new Error(f+' missing ${TARGET_VERSION}');`,
                "}",
                "console.log('version surfaces include target release (from release commit)');"
              ].join("")
            ]
          ]
        }
      ];
    case "notes:update":
      return [
        {
          id: "release-docs",
          cwd: repoRoot,
          command: [
            node,
            [
              "-e",
              [
                releaseSourceReaderSnippet(),
                "const files=['docs/dogfood-one-real-repo.7.md','plugins/cool-workflow/docs/dogfood-one-real-repo.7.md','README.md','plugins/cool-workflow/README.md','CHANGELOG.md','RELEASE.md'];",
                "for (const f of files) { if (!surfaceExists(f)) throw new Error('missing '+f); }",
                "const changelog=readSurface('CHANGELOG.md');",
                "if (changelog===null) throw new Error('CHANGELOG.md missing from release commit');",
                `if (!changelog.includes('## ${TARGET_VERSION}')) throw new Error('changelog missing target');`,
                "console.log('dogfood release docs present (from release commit)');"
              ].join("")
            ]
          ]
        },
        {
          id: "docs-index",
          cwd: repoRoot,
          // Portable docs-index check: assert both files reference the dogfood
          // proof without depending on ripgrep, which is not preinstalled on
          // stock CI runners (an external `rg` would ENOENT and hold the verdict).
          command: [
            node,
            [
              "-e",
              [
                releaseSourceReaderSnippet(),
                "const files=['plugins/cool-workflow/docs/index.md','README.md'];",
                "for (const f of files) { const t=readSurface(f); if (t===null) throw new Error(f+' missing from release commit'); if (!t.toLowerCase().includes('dogfood')) throw new Error(f+' missing dogfood reference'); }",
                "console.log('docs index references dogfood (from release commit)');"
              ].join("")
            ]
          ]
        }
      ];
    case "package:artifacts":
      if (smoke) {
        return [
          { id: "app-validate-release-cut", cwd: pluginRoot, command: [node, ["scripts/cw.js", "app", "validate", "release-cut"]] },
          { id: "npm-pack-dry-run", cwd: pluginRoot, command: packDryRunCommand() }
        ];
      }
      return [
        { id: "build", cwd: pluginRoot, command: ["npm", ["run", "build"]] },
        { id: "npm-pack-dry-run", cwd: pluginRoot, command: packDryRunCommand() }
      ];
    case "verify:package":
      if (smoke) {
        return [
          { id: "canonical-apps", cwd: pluginRoot, command: ["npm", ["run", "canonical-apps"]] },
          { id: "golden-path", cwd: pluginRoot, command: ["npm", ["run", "golden-path"]] }
        ];
      }
      return [
        { id: "check", cwd: pluginRoot, command: ["npm", ["run", "check"]] },
        { id: "test", cwd: pluginRoot, command: ["npm", ["test"]] },
        { id: "fixture-compat", cwd: pluginRoot, command: ["npm", ["run", "fixture-compat"]] },
        { id: "canonical-apps", cwd: pluginRoot, command: ["npm", ["run", "canonical-apps"]] },
        { id: "golden-path", cwd: pluginRoot, command: ["npm", ["run", "golden-path"]] },
        { id: "release-check", cwd: pluginRoot, command: ["npm", ["run", "release:check"]] }
      ];
    case "verdict:release":
      return [
        { id: "cw-status", cwd: repoRoot, command: [node, [cli, "status", context.runId, "--json"]] },
        { id: "cw-graph", cwd: repoRoot, command: [node, [cli, "graph", context.runId, "--json"]] },
        { id: "cw-worker-summary", cwd: repoRoot, command: [node, [cli, "worker", "summary", context.runId, "--json"]] },
        { id: "cw-audit-summary", cwd: repoRoot, command: [node, [cli, "audit", "summary", context.runId]] },
        { id: "cw-audit-provenance", cwd: repoRoot, command: [node, [cli, "audit", "provenance", context.runId]] }
      ];
    default:
      throw new Error(`No dogfood command set for task ${taskId}`);
  }
}

function runEvidenceCommand(spec, manifest, context) {
  const started = new Date().toISOString();
  const [bin, args] = spec.command;
  const commandText = [bin, ...args].join(" ");
  const result = spawnSync(bin, args, {
    cwd: spec.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CW_DOGFOOD_RELEASE: "1",
      CW_DOGFOOD_MODE: context.options.smoke ? "smoke" : "full"
    },
    maxBuffer: 1024 * 1024 * 20
  });
  const ended = new Date().toISOString();
  const logPath = path.join(manifest.logsDir, `${safeName(spec.id)}.log`);
  fs.mkdirSync(manifest.logsDir, { recursive: true });
  fs.writeFileSync(
    logPath,
    [
      `$ ${commandText}`,
      `cwd: ${spec.cwd}`,
      `started: ${started}`,
      `ended: ${ended}`,
      `status: ${result.status === null ? "signal:" + result.signal : result.status}`,
      "",
      "## stdout",
      result.stdout || "",
      "",
      "## stderr",
      result.stderr || "",
      ""
    ].join("\n"),
    "utf8"
  );
  return {
    id: spec.id,
    command: commandText,
    cwd: spec.cwd,
    status: result.status === null ? 1 : result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    logPath,
    locator: `${logPath}:1`
  };
}

function packDryRunCommand() {
  return [
    node,
    [
      "-e",
      [
        "const {spawnSync}=require('child_process');",
        "const r=spawnSync('npm',['pack','--dry-run','--json'],{encoding:'utf8',maxBuffer:1024*1024*20});",
        "process.stdout.write(r.stdout||'');",
        "process.stderr.write(r.stderr||'');",
        "if(r.status!==0) process.exit(r.status);",
        "const pack=JSON.parse(r.stdout)[0];",
        "const files=(pack.files||[]).map(f=>f.path);",
        "const leaked=files.filter(f=>f.startsWith('.cw/')||f.includes('/.cw/'));",
        "if(leaked.length){console.error('npm pack includes .cw files: '+leaked.slice(0,5).join(', '));process.exit(1);}",
        "console.log(JSON.stringify({checked:'npm-pack-dry-run',entryCount:files.length,cwCount:0,filename:pack.filename}));"
      ].join("")
    ]
  ];
}

function evidenceForTask(taskId, commandResults, context) {
  const commandEvidence = commandResults.map((result) => result.locator);
  if (taskId !== "verdict:release") return commandEvidence;
  return compactEvidence([
    ...context.commandResults.map((result) => result.locator),
    context.statePath,
    context.reportPath
  ]);
}

function renderWorkerResult({ task, manifest, commandResults, findings, evidence, dryRun, smoke }) {
  const passed = commandResults.every((result) => result.status === 0);
  const summary = passed
    ? `${task.id} completed with real dogfood evidence.`
    : `${task.id} held because one or more dogfood evidence commands failed.`;
  return [
    `# Dogfood ${task.id}`,
    "",
    `Worker: ${manifest.id}`,
    `Sandbox: ${manifest.sandboxProfileId}`,
    `Mode: ${smoke ? "smoke" : "full"}`,
    `Dry run: ${dryRun}`,
    "",
    "## Commands",
    ...commandResults.map((result) => `- ${result.status === 0 ? "PASS" : "FAIL"} ${result.command} (${result.locator})`),
    "",
    "```cw:result",
    JSON.stringify(
      {
        summary,
        findings,
        evidence
      },
      null,
      2
    ),
    "```",
    ""
  ].join("\n");
}

function requiredEvidencePresent(context) {
  const required = context.options.smoke
    ? ["git-status", "version-sync", "release-docs", "app-validate-release-cut", "canonical-apps", "golden-path"]
    : [
        "git-status",
        "version-sync",
        "release-docs",
        "build",
        "check",
        "test",
        "fixture-compat",
        "canonical-apps",
        "golden-path",
        "release-check",
        "cw-audit-summary",
        "cw-audit-provenance"
      ];
  const passed = new Set(context.commandResults.filter((result) => result.status === 0).map((result) => result.id));
  return required.every((id) => passed.has(id));
}

function enforceReleaseActionGate(options, dryRun) {
  const requestedAction = Boolean(options.tag || options.push || options.publish);
  if (dryRun && requestedAction) {
    throw new Error("--tag, --push, and --publish require --execute");
  }
  if (!dryRun && options.confirmReleaseActions !== TARGET_VERSION) {
    throw new Error(`--execute requires --confirm-release-actions=${TARGET_VERSION}`);
  }
}

function currentBranch() {
  const result = spawnSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" });
  return (result.stdout || "").trim() || "main";
}

function cwJson(args, cwd) {
  const text = cwText(args, cwd);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`cw JSON parse failed for ${args.join(" ")}\n${text}`);
  }
}

function cwText(args, cwd) {
  const result = spawnSync(node, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    throw new Error(`cw ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  const options = {
    smoke: false,
    json: false,
    execute: false,
    tag: false,
    push: false,
    publish: false,
    confirmReleaseActions: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--smoke") options.smoke = true;
    else if (token === "--json") options.json = true;
    else if (token === "--execute") options.execute = true;
    else if (token === "--tag") options.tag = true;
    else if (token === "--push") options.push = true;
    else if (token === "--publish") options.publish = true;
    else if (token.startsWith("--confirm-release-actions=")) options.confirmReleaseActions = token.split("=")[1] || "";
    else if (token === "--confirm-release-actions") options.confirmReleaseActions = argv[++index] || "";
    else if (token === "--dry-run") options.execute = false;
    else throw new Error(`Unknown dogfood-release option: ${token}`);
  }
  return options;
}

function compactEvidence(entries) {
  return [...new Set(entries.filter(Boolean).map(String))];
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "-");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

main();
