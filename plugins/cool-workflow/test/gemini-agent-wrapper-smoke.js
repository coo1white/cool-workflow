#!/usr/bin/env node
"use strict";

// gemini-agent-wrapper-smoke -- the Gemini builtin agent adapter works without
// a live Gemini login. A PATH shim stands in for `gemini`.
//
// The prompt goes to gemini on STDIN, never as an argument: gemini is run
// headless with NO -p and no positional prompt (`--output-format stream-json
// --approval-mode plan` only), and the wrapper writes the whole prompt to the
// child's stdin. Before spawning, a prompt over 8 MiB is refused outright
// (gemini itself would cut anything past that many stdin bytes), so the
// wrapper never starts gemini on a prompt it would silently truncate.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const wrapper = path.join(pluginRoot, "scripts", "agents", "gemini-agent.js");

const RESULT = `# Analysis

gemini shim answer

\`\`\`cw:result
{
  "summary": "gemini shim answer",
  "findings": [],
  "evidence": ["README.md:1"]
}
\`\`\`
`;

function shimDir(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-shim-"));
  const shim = path.join(dir, "gemini");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(path.join(__dirname, "invocation.json"), JSON.stringify(args));
fs.writeFileSync(path.join(__dirname, "stdin.txt"), fs.readFileSync(0));
if (${JSON.stringify(behavior)} === "crash") {
  process.stderr.write("gemini shim boom");
  process.exit(3);
}
if (${JSON.stringify(behavior)} === "garbage") {
  process.stdout.write("not-json\\n");
  process.exit(0);
}
if (${JSON.stringify(behavior)} === "auth-error") {
  // Real gemini failures (auth, rate limit) are reported as a stream-json
  // result event with is_error:true on STDOUT, then the process exits
  // nonzero with EMPTY real stderr — the shape that used to collapse to a
  // bare "gemini exited 1" with no reason at all.
  const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  emit({ type: "system", subtype: "init" });
  emit({ type: "result", subtype: "error", is_error: true, result: "Gemini API error: please re-authenticate" });
  process.exit(1);
}
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
emit({ type: "system", subtype: "init" });
emit({ type: "assistant", message: { model: "gemini-shim-model", content: "reading repo..." } });
emit({ type: "tool_call", name: "Read", args: { file_path: "README.md" } });
emit({ type: "delta", text: "# Analysis\\n\\ngemini shim answer" });
emit({ type: "turn_completed", usage: { input_tokens: 15, output_tokens: 9 }, status: "done" });
emit({ type: "result", subtype: "success", result: ${JSON.stringify(RESULT)} });
process.exit(0);
`;
  fs.writeFileSync(shim, source, "utf8");
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

function readInvocation(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "invocation.json"), "utf8"));
}

function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-wrapper-smoke-"));
  const inputPath = path.join(work, "input.md");
  const resultPath = path.join(work, "result.md");
  const marker = "Check release path marker-gemini-99.";
  fs.writeFileSync(inputPath, `# Worker w-1\n\n- Result: ${resultPath}\n\n## Task\n\n${marker}\n`, "utf8");

  {
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath);
    assert.equal(child.status, 0, `gemini wrapper exits 0 (stderr: ${child.stderr})`);
    const invocation = readInvocation(dir);
    assert.ok(!invocation.includes("-p"), "gemini runs with NO -p (headless stdin mode)");
    assert.deepEqual(invocation, ["--output-format", "stream-json", "--approval-mode", "plan"], "gemini argv carries ONLY the fixed flags, no prompt");
    const prompt = fs.readFileSync(path.join(dir, "stdin.txt"), "utf8");
    assert.ok(prompt.includes(marker), "worker input reaches gemini on stdin");
    assert.ok(prompt.includes("cw:result"), "cw result contract is appended");
    assert.ok(!invocation.some((arg) => arg.includes(marker)), "the prompt is never passed as an argument");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "final message persisted to result.md");
    assert.equal(child.stderr, "", "default piped success is silent on stderr");
    const report = JSON.parse(child.stdout);
    assert.equal(report.model, "gemini-shim-model", "model extracted from JSONL events");
    assert.equal(report.usage.input_tokens, 15, "usage extracted from JSONL events");
    assert.equal(report.result, RESULT, "stdout report carries final result for CW provenance");
    console.log("gemini: default stdin prompt delivery + stream-json + approval-mode plan + result persistence OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const dir = shimDir("ok");
    const child = runWrapper(dir, inputPath, resultPath, { CW_AGENT_STREAM: "1" });
    assert.equal(child.status, 0, `stream gemini wrapper exits 0 (stderr: ${child.stderr})`);
    assert.ok(!/\x1b\[/.test(child.stderr), "non-TTY trace carries NO ANSI/cursor escapes");
    assert.match(child.stderr, /→ gemini: reading/, "CW_AGENT_STREAM=1 opts non-TTY into a plain append-only trace");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "stream path persists final message");
    console.log("gemini: CW_AGENT_STREAM=1 piped success OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const crash = runWrapper(shimDir("crash"), inputPath, resultPath);
    assert.notEqual(crash.status, 0, "crashing gemini exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on crash");

    const garbage = runWrapper(shimDir("garbage"), inputPath, resultPath);
    assert.notEqual(garbage.status, 0, "non-JSONL gemini stdout fails closed");
    console.log("gemini: fail-closed on crash + garbage output OK");
  }

  {
    fs.rmSync(resultPath, { force: true });
    const authErr = runWrapper(shimDir("auth-error"), inputPath, resultPath);
    assert.notEqual(authErr.status, 0, "auth-error shim exits nonzero");
    assert.ok(!fs.existsSync(resultPath), "no result.md on an auth-style failure");
    assert.ok(authErr.stderr.includes("Gemini API error: please re-authenticate"), "wrapper's own stderr carries the PARSED stdout result, not just the bare exit code");
    const logPath = path.join(work, "logs", "agent-stderr.log");
    assert.ok(fs.existsSync(logPath), "agent-stderr.log persisted for the failed hop");
    const log = fs.readFileSync(logPath, "utf8");
    assert.ok(log.includes("Gemini API error: please re-authenticate"), "persisted log carries the PARSED stdout result");
    console.log("gemini: empty-stderr failure surfaces parsed stdout result (auth-style) OK");
  }

  {
    // A 1.2 MB prompt is WELL past Linux's 131072-byte argument limit (and
    // macOS's ~1 MB for all arguments combined), but since the prompt never
    // goes on argv anymore — it goes on stdin — this now just works: no
    // E2BIG, no refusal, the whole prompt reaches gemini.
    fs.rmSync(resultPath, { force: true });
    const bigInput = path.join(work, "big-input.md");
    const BIG_MARKER = "end of a 1.2 MB worker input (marker-9e4).";
    fs.writeFileSync(bigInput, `# Worker w-big\n\n${"earlier phase result line\n".repeat(48000)}\n${BIG_MARKER}\n`, "utf8");
    const dir = shimDir("ok");
    const child = runWrapper(dir, bigInput, resultPath);
    assert.equal(child.status, 0, `a 1.2 MB prompt completes (stderr: ${child.stderr.slice(0, 300)})`);
    const stdinBytes = fs.readFileSync(path.join(dir, "stdin.txt"));
    assert.ok(stdinBytes.length >= 1200000, "the whole 1.2 MB prompt arrives on stdin (byte length at least matches the input)");
    assert.ok(stdinBytes.toString("utf8").includes(BIG_MARKER), "the big prompt's tail marker reaches gemini on stdin");
    assert.equal(fs.readFileSync(resultPath, "utf8"), RESULT, "result.md written for the big prompt");
    console.log("gemini: a 1.2 MB prompt goes on stdin, no E2BIG OK");
  }

  {
    // gemini itself reads at most 8 MiB (8388608 bytes) of stdin and silently
    // cuts the rest. A prompt over that limit is refused BEFORE gemini is
    // ever spawned — never a silently truncated prompt.
    fs.rmSync(resultPath, { force: true });
    const logPath = path.join(work, "logs", "agent-stderr.log");
    fs.rmSync(logPath, { force: true });
    const hugeInput = path.join(work, "huge-input.md");
    const HUGE_LINE_BYTES = Buffer.byteLength("earlier phase result line\n", "utf8");
    const repeatCount = Math.ceil((9 * 1024 * 1024) / HUGE_LINE_BYTES);
    fs.writeFileSync(hugeInput, `# Worker w-huge\n\n${"earlier phase result line\n".repeat(repeatCount)}`, "utf8");
    const dir = shimDir("ok");
    const child = runWrapper(dir, hugeInput, resultPath);
    assert.equal(child.status, 1, "a prompt over 8 MiB is refused with exit 1");
    assert.ok(!fs.existsSync(resultPath), "no result.md when the prompt is refused");
    assert.ok(!fs.existsSync(path.join(dir, "invocation.json")), "gemini is never spawned for an over-limit prompt");
    assert.ok(fs.existsSync(logPath), "agent-stderr.log persisted for the refused hop");
    const log = fs.readFileSync(logPath, "utf8");
    assert.ok(log.includes("8388608 bytes gemini reads from stdin"), "the log names gemini's exact 8 MiB stdin limit");
    assert.ok(child.stderr.includes("8388608 bytes gemini reads from stdin"), "stderr carries the same reason");
    console.log("gemini: a prompt over 8 MiB is refused before gemini starts, fail closed OK");
  }

  {
    // v2 moved agent-config under dist/shell/.
    const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "shell", "agent-config.js"));
    // builtin:gemini now routes through opencode (where the user's key lives);
    // the native Gemini CLI wrapper is preserved as builtin:gemini-cli.
    const cfg = resolveAgentConfig({ "agent-command": "builtin:gemini-cli" }, {});
    assert.ok(cfg.command && cfg.command.includes("gemini-agent.js"), "builtin:gemini-cli expands to the native Gemini CLI wrapper");
    assert.ok(cfg.command.includes("{{input}}") && cfg.command.includes("{{result}}"), "expanded template carries worker substitutions");
    assert.throws(() => resolveAgentConfig({ "agent-command": "builtin:nope" }, {}), /Unknown builtin agent template/, "unknown builtin fails closed");
    console.log("gemini: builtin:gemini-cli alias resolution OK");
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log("gemini-agent-wrapper-smoke: ok");
}

main();
