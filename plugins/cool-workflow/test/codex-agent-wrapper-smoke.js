#!/usr/bin/env node
"use strict";

// codex-agent-wrapper-smoke -- the Codex builtin agent adapter works without a
// live Codex login. A PATH shim stands in for `codex exec`.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "codex-agent.js");

const RESULT = `# Analysis

codex shim answer

\`\`\`cw:result
{
  "summary": "codex shim answer",
  "findings": [],
  "evidence": ["README.md:1"]
}
\`\`\`
`;

function shimDir(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-codex-shim-"));
  const shim = path.join(dir, "codex");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify({ args, input }));
  if (${JSON.stringify(behavior)} === "crash") {
    process.stderr.write("codex shim boom");
    process.exit(3);
  }
  const finalPath = args[args.indexOf("--output-last-message") + 1];
  if (${JSON.stringify(behavior)} === "garbage") {
    fs.writeFileSync(finalPath, ${JSON.stringify(RESULT)});
    process.stdout.write("not-json\\n");
    process.exit(0);
  }
  // Real codex exec --json (>=0.139) schema: thread/turn events + usage, NO model field.
  process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "thr_shim" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.started" }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "tool_call", name: "Read", input: { file_path: "README.md" } } }) + "\\n");
  process.stdout.write(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 13, output_tokens: 8 } }) + "\\n");
  if (${JSON.stringify(behavior)} !== "nofinal") fs.writeFileSync(finalPath, ${JSON.stringify(RESULT)});
  process.exit(0);
});
`;
  fs.writeFileSync(shim, source, "utf8");
  fs.chmodSync(shim, 0o755);
  return dir;
}

// A throwaway CODEX_HOME with a known configured model, so the wrapper's config
// fallback (real codex emits no model in its JSONL) is exercised deterministically.
let codexHome;
function makeCodexHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-codex-home-"));
  fs.writeFileSync(path.join(dir, "config.toml"), 'model = "codex-config-model"\n', "utf8");
  return dir;
}

function runWrapper(dir, inputPath, resultPath, extraEnv = {}) {
  return spawnSync(process.execPath, [wrapper, inputPath, resultPath], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: codexHome, ...extraEnv, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
    timeout: 30000
  });
}

function readInvocation(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));
}

function main() {
  codexHome = makeCodexHome();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-codex-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-codex-42.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `codex wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.deepEqual(invocation.args.slice(0, 2), ["exec", "--json"], "codex runs in exec JSONL mode");
    assert.ok(invocation.args.includes("--output-last-message"), "codex final response is written to a file");
    assert.deepEqual(invocation.args.slice(invocation.args.indexOf("--sandbox"), invocation.args.indexOf("--sandbox") + 2), ["--sandbox", "read-only"]);
    // codex exec is non-interactive and never prompts; it has no --ask-for-approval flag.
    // Passing one makes `codex exec` exit 2 ("unexpected argument"). Keep it absent.
    assert.ok(!invocation.args.includes("--ask-for-approval"), "codex exec must NOT receive --ask-for-approval (rejected by codex >=0.139)");
    assert.equal(invocation.args[invocation.args.length - 1], "-", "prompt is fed on stdin");
    assert.ok(invocation.input.includes(marker), "worker input reaches codex stdin");
    assert.ok(invocation.input.includes("cw:result"), "cw result contract is appended");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message is persisted to result.md");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "codex-config-model", "model falls back to CODEX_HOME/config.toml (codex JSONL carries none)");
    assert.equal(report.usage.input_tokens, 13, "usage comes from codex turn.completed");
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream codex wrapper exits 0 (stderr: ${child.stderr})`);
    assert.ok(!/\x1b\[/.test(child.stderr), "non-TTY trace carries NO ANSI/cursor escapes");
    assert.match(child.stderr, /→ codex: reading/, "CW_AGENT_STREAM=1 opts non-TTY into a plain append-only trace");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "stream path persists final message");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const crash = runWrapper(shimDir("crash"), inputPath, resultPath);
    assert.notEqual(crash.status, 0, "crashing codex exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on crash");

    const nofinal = runWrapper(shimDir("nofinal"), inputPath, resultPath);
    assert.notEqual(nofinal.status, 0, "missing final output fails closed");
    assert.ok(!fs.existsSync(resultPath), "no result.md when final output is missing");

    const garbage = runWrapper(shimDir("garbage"), inputPath, resultPath);
    assert.notEqual(garbage.status, 0, "non-JSONL codex stdout fails closed");
  }

  {
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "agent-config.js"));
    const cfg = resolveAgentConfig({ "agent-command": "builtin:codex" }, {});
    assert.ok(cfg.command && cfg.command.includes("codex-agent.js"), "builtin:codex expands to the packaged wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");
    assert.throws(() => resolveAgentConfig({ "agent-command": "builtin:nope" }, {}), /Unknown builtin agent template/, "unknown builtin fails closed");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("codex-agent-wrapper-smoke: ok");
}

main();
