#!/usr/bin/env node
"use strict";

// agent-auto-detect-gemini-native-smoke — auto-detect must use the binary it
// found. detectAgentFromPath sees a file named "gemini" on PATH; the old
// resolve then expanded builtin:gemini, which is the OPENCODE-routed wrapper
// (gemini-opencode-agent.js) — not the binary it just found. A machine with
// only the native gemini CLI (no opencode) was told "agent found" and then
// failed at spawn time on a missing opencode. The fix maps the auto path to
// builtin:gemini-cli (gemini-agent.js), the wrapper that runs the found
// binary itself. The explicit -gemini flag keeps its opencode route (the
// --help text says "via opencode" there), so this smoke pins BOTH sides.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { resolveAgentConfig } = require(path.join(pluginRoot, "dist", "shell", "agent-config.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-gemini-detect-"));

try {
  // A PATH dir with ONLY a fake native gemini binary — no opencode, no claude.
  const shimDir = path.join(tmp, "bin");
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(path.join(shimDir, "gemini"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const env = { PATH: shimDir, HOME: tmp };

  // 1. Auto-detect: found the native gemini binary -> must resolve to the
  //    wrapper that runs THAT binary (gemini-agent.js), never the
  //    opencode-routed one.
  {
    const resolved = resolveAgentConfig({}, env);
    assert.equal(resolved.source, "auto", "the fake gemini binary must be auto-detected");
    assert.match(resolved.command || "", /gemini-agent\.js/, "auto-detected gemini must resolve to the native wrapper (gemini-agent.js)");
    assert.doesNotMatch(resolved.command || "", /gemini-opencode-agent\.js/, "auto-detected gemini must NOT resolve to the opencode-routed wrapper");
    assert.equal(resolved.model, "builtin:gemini-cli", "the auto model label must name the template that was really used");
  }

  // 2. Explicit -gemini flag: stays on the opencode route (--help says "via
  //    opencode") — the fix must not change the explicit path.
  {
    const resolved = resolveAgentConfig({ "agent-command": "builtin:gemini" }, env);
    assert.equal(resolved.source, "flag");
    assert.match(resolved.command || "", /gemini-opencode-agent\.js/, "explicit builtin:gemini keeps the opencode-routed wrapper");
  }

  // 3. CW_NO_AUTO_AGENT=1 still turns detection off.
  {
    const resolved = resolveAgentConfig({}, { ...env, CW_NO_AUTO_AGENT: "1" });
    assert.equal(resolved.command, undefined, "CW_NO_AUTO_AGENT=1 must block auto-detect");
  }

  process.stdout.write("agent-auto-detect-gemini-native-smoke: ok\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
