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
    // Exits 0 but emits no `result` event ⇒ wrapper must fail closed.
    lines.push('process.stdout.write("not json at all\\n");');
  } else {
    // A stream-json `claude`: capture the invocation for assertions, then emit
    // NDJSON events (assistant text + tool_use, then the final result) exactly as
    // `claude -p --output-format stream-json` does, so the wrapper renders a live
    // trace and reconstructs {model, usage, result}.
    lines.push(
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "fs.writeFileSync(path.join(__dirname, 'invocation.json'), JSON.stringify(args));",
      "const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
      "emit({ type: 'system', subtype: 'init', tools: ['Read'] });",
      "emit({ type: 'assistant', message: { model: 'claude-shim-model', content: [ { type: 'tool_use', name: 'Read', input: { file_path: 'app.js' } }, { type: 'text', text: '# Analysis\\n\\nstub markdown answer' } ] } });",
      "emit({ type: 'system', subtype: 'post_turn_summary', status_detail: 'analyzed app.js' });",
      "emit({ type: 'result', subtype: 'success', is_error: false, result: '# Analysis\\n\\nstub markdown answer', usage: { input_tokens: 11, output_tokens: 7 } });"
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
    assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json", "claude runs in stream-json mode (live trace)");

    assert.equal(fs.readFileSync(resultPath, "utf8"), "# Analysis\n\nstub markdown answer", "claude's result text persisted to result.md by the wrapper");
    // STDOUT is the data channel: a single {model, usage, result} object CW consumes.
    const forwarded = JSON.parse(child.stdout);
    assert.equal(forwarded.model, "claude-shim-model", "model reconstructed from the assistant event (the attested model)");
    assert.equal(forwarded.usage.input_tokens, 11, "usage reconstructed from the result event (provenance)");
    assert.equal(forwarded.result, "# Analysis\n\nstub markdown answer", "result text reconstructed for CW");
    // STDERR is the diagnostics channel: a human-readable LIVE trace, never data.
    assert.ok(/claude:|→ Read|stub markdown|done/.test(child.stderr || ""), `wrapper streams a live trace to stderr: ${JSON.stringify((child.stderr || "").slice(0, 120))}`);
    assert.ok(!/\{.*"result".*\}/.test(child.stderr || ""), "the {model,usage,result} data object is NOT on stderr (data/diagnostics kept separate)");
    console.log("wrapper: prompt delivery + read-only stream-json + live stderr trace + result/provenance on stdout ok");
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
    assert.ok(readme.includes("builtin:claude"), "root README uses the working builtin agent template alias");
    assert.ok(!/--agent-command "claude -p"\s*$/m.test(readme), "root README does not advertise the broken bare claude -p agent command");
    // The explicit wrapper path is documented on the authoritative technical doc
    // (the beginner root README intentionally hides it behind builtin:claude).
    const doc = fs.readFileSync(path.join(pluginRoot, "docs", "agent-delegation-drive.7.md"), "utf8");
    assert.ok(doc.includes("claude-p-agent.js"), "agent-delegation-drive doc points at the wrapper the alias resolves to");
    console.log("wrapper: doc-drift guard ok");
  }

  // ---- 5: builtin:claude alias resolves to THIS wrapper (npx-safe config) ----
  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:claude" }, {});
    assert.ok(cfg.command && cfg.command.includes("claude-p-agent.js"), "builtin:claude expands to the packaged wrapper (absolute path — npx/global installs work)");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries the worker substitutions");
    assert.throws(() => resolveAgentConfig({ "agent-command": "builtin:nope" }, {}), /Unknown builtin agent template/, "unknown builtin fails closed with the available list");
    console.log("wrapper: builtin:claude alias resolution ok");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("claude-p-agent-wrapper-smoke: ok (input.md → prompt; read-only claude; result persisted; provenance forwarded; fail-closed; docs guarded)");
}

main();
