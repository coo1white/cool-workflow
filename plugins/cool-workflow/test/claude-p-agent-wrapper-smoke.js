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
//      --output-format json by default;
//   2. claude's `result` markdown is persisted to the worker's result.md and
//      claude's JSON (model + usage) is forwarded verbatim on stdout — so CW
//      records the agent-reported model/usage as provenance;
//   3. CW_AGENT_STREAM=1 is an opt-in stream-json path; default piped success is
//      silent on stderr (Rule of Silence);
//   4. FAIL CLOSED: a crashing claude ⇒ nonzero exit + NO result.md (CW counts a
//      failed hop); non-JSON claude output ⇒ the same;
//   5. doc-drift guard: the README quickstart references the wrapper and no doc
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
    // Capture invocation for assertions, then emit either the legacy JSON object
    // or stream-json NDJSON depending on the requested output format.
    lines.push(
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const args = process.argv.slice(2);",
      "fs.writeFileSync(path.join(__dirname, 'invocation.json'), JSON.stringify(args));",
      "const format = args[args.indexOf('--output-format') + 1];",
      "if (format !== 'stream-json') { process.stdout.write(JSON.stringify({ result: '# Analysis\\n\\nstub markdown answer', model: 'claude-shim-model', usage: { input_tokens: 11, output_tokens: 7 }, extra: 'legacy-verbatim' })); process.exit(0); }",
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

function runWrapper(dir, inputPath, resultPath, extraEnv = {}) {
  return spawnSync(process.execPath, [wrapper, inputPath, resultPath], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
    timeout: 30000
  });
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const INPUT_MARKER = "Map the server boundaries of demo-repo (marker-7c1).";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${INPUT_MARKER}\n`, "utf8");

  // ---- 1+2: default happy path (legacy stdout/stderr contract) ---------------
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
    assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json", "default wrapper uses stream-json mode by default");

    assert.equal(fs.readFileSync(resultPath, "utf8"), "# Analysis\n\nstub markdown answer", "claude's result markdown persisted to result.md by the wrapper");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const forwarded = JSON.parse(child.stdout);
    assert.equal(forwarded.model, "claude-shim-model", "claude's JSON carries the attested model");
    assert.equal(forwarded.usage.input_tokens, 11, "usage tokens forwarded for provenance");
    assert.equal(forwarded.result, "# Analysis\n\nstub markdown answer", "stream result reconstructed for CW");
    console.log("wrapper: default stream-json prompt delivery + read-only + result persistence + provenance ok");
  }

  // ---- 3: opt-in stream-json path ------------------------------------------
  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream wrapper exits 0 (stderr: ${child.stderr})`);
    const argv = JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));
    assert.equal(argv[argv.indexOf("--output-format") + 1], "stream-json", "CW_AGENT_STREAM=1 opts into stream-json mode");
    assert.equal(fs.readFileSync(resultPath, "utf8"), "# Analysis\n\nstub markdown answer", "stream result text persisted to result.md");
    assert.equal(child.stderr, "", "piped stream success remains silent on stderr by default");
    const forwarded = JSON.parse(child.stdout);
    assert.equal(forwarded.model, "claude-shim-model", "stream model reconstructed from assistant event");
    assert.equal(forwarded.usage.input_tokens, 11, "stream usage reconstructed from result event");
    assert.equal(forwarded.result, "# Analysis\n\nstub markdown answer", "stream result reconstructed for CW");
    console.log("wrapper: opt-in stream-json reconstruction ok");
  }

  // ---- 4: fail closed --------------------------------------------------------
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

  // ---- 5: doc-drift guard ----------------------------------------------------
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
