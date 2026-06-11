#!/usr/bin/env node
"use strict";

// claude-p-agent-wrapper-smoke — the documented onboarding agent template works.
//
// An independent audit of v0.1.77 found the README advertised an agent command
// (bare `claude -p`) that can NEVER complete a worker: headless claude received
// no prompt content and had no way to produce result.md. The bundled wrapper
// (scripts/agents/claude-p-agent.js — the template the docs now point at) is the
// working path: it feeds input.md to claude READ-ONLY, persists claude's final
// markdown to result.md itself, and forwards claude's JSON for provenance.
//
// Hermetic: a PATH-shimmed fake `claude` binary stands in for the real CLI (CI
// has no live agent). Proves:
//   1. the wrapper delivers the WORKER'S FULL input.md content as the -p prompt
//      (plus the cw:result contract), runs claude with READ-ONLY allowedTools
//      (no Write — the readonly sandbox profile stays honest), and requests
//      --output-format json;
//   2. claude's `result` markdown is persisted to the worker's result.md and
//      claude's JSON (model + usage) is forwarded verbatim on stdout — so CW
//      records the agent-reported model/usage as provenance;
//   3. FAIL CLOSED: a crashing claude ⇒ nonzero exit + NO result.md (CW counts a
//      failed hop); non-JSON claude output ⇒ the same;
//   4. doc-drift guard: the README quickstart references the wrapper and no doc
//      re-advertises the broken bare `--agent-command "claude -p"`.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "claude-p-agent.js");

function shimDir(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-claude-shim-"));
  const shim = path.join(dir, "claude");
  const lines = ["#!/usr/bin/env node"];
  if (behavior === "crash") {
    lines.push('process.stderr.write("shim boom"); process.exit(3);');
  } else if (behavior === "garbage") {
    lines.push('process.stdout.write("not json at all");');
  } else {
    // Echo enough of the invocation back for the assertions: capture the -p
    // prompt + flags into a side file, output a claude-shaped JSON result.
    lines.push(
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "fs.writeFileSync(path.join(__dirname, 'invocation.json'), JSON.stringify(args));",
      'process.stdout.write(JSON.stringify({ result: "# Analysis\\n\\nstub markdown answer", model: "claude-shim-model", usage: { input_tokens: 11, output_tokens: 7 } }));'
    );
  }
  fs.writeFileSync(shim, lines.join("\n"), "utf8");
  fs.chmodSync(shim, 0o755);
  return dir;
}

function runWrapper(dir, inputPath, resultPath) {
  return spawnSync(process.execPath, [wrapper, inputPath, resultPath], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
    timeout: 30000
  });
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const INPUT_MARKER = "Map the server boundaries of demo-repo (marker-7c1).";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${INPUT_MARKER}\n`, "utf8");

  // ---- 1+2: happy path ------------------------------------------------------
  {
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `wrapper exits 0 (stderr: ${child.stderr})`);

    const argv = JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));
    const pIndex = argv.indexOf("-p");
    assert.ok(pIndex >= 0, "claude invoked with -p");
    const prompt = argv[pIndex + 1];
    assert.ok(prompt.includes(INPUT_MARKER), "the worker's FULL input.md content reaches the prompt");
    assert.ok(prompt.includes("cw:result"), "the cw:result contract is appended to the prompt");
    const allowed = argv[argv.indexOf("--allowedTools") + 1];
    assert.ok(allowed && !/write/i.test(allowed), `claude stays READ-ONLY (no Write tool): ${allowed}`);
    assert.ok(argv.includes("--output-format") && argv.includes("json"), "claude asked for JSON output (model+usage provenance)");

    assert.equal(fs.readFileSync(resultPath, "utf8"), "# Analysis\n\nstub markdown answer", "claude's result markdown persisted to result.md by the wrapper");
    const forwarded = JSON.parse(child.stdout);
    assert.equal(forwarded.model, "claude-shim-model", "claude's JSON forwarded verbatim (CW reads the attested model from it)");
    assert.equal(forwarded.usage.input_tokens, 11, "usage tokens forwarded for provenance");
    console.log("wrapper: prompt delivery + read-only flags + result persistence + provenance forwarding ok");
  }

  // ---- 3: fail closed --------------------------------------------------------
  {
    fs.rmSync(resultPath, { force: true });
    const crash = runWrapper(shimDir("crash"), inputPath, resultPath);
    assert.notEqual(crash.status, 0, "crashing claude ⇒ wrapper exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on crash (CW records a failed hop, never a fabricated one)");

    const garbage = runWrapper(shimDir("garbage"), inputPath, resultPath);
    assert.notEqual(garbage.status, 0, "non-JSON claude output ⇒ wrapper exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on garbage output");
    console.log("wrapper: fail-closed on crash + garbage output ok");
  }

  // ---- 4: doc-drift guard ----------------------------------------------------
  {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    assert.ok(readme.includes("claude-p-agent.js"), "README quickstart references the working wrapper template");
    assert.ok(!/--agent-command "claude -p"\s*$/m.test(readme), "README no longer advertises the broken bare claude -p agent command");
    const doc = fs.readFileSync(path.join(pluginRoot, "docs", "agent-delegation-drive.7.md"), "utf8");
    assert.ok(doc.includes("claude-p-agent.js"), "agent-delegation-drive doc points at the wrapper");
    console.log("wrapper: doc-drift guard ok");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("claude-p-agent-wrapper-smoke: ok (input.md → prompt; read-only claude; result persisted; provenance forwarded; fail-closed; docs guarded)");
}

main();
