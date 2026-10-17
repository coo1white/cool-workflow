#!/usr/bin/env node
// agent-multiword-command — pins how the drive path builds argv for an agent
// command of more than one word that comes with explicit args.
//
// The fault this guards: `--agent-command "claude -p" --agent-args x` (or an
// agent-config.json {"command":"claude -p","args":["x"]}) resolves to
// command "claude -p" + args ["x"]. resolveAgentInvocation kept the command
// whole when explicit args were set, so drive spawned a binary literally
// named "claude -p" and failed with ENOENT. The release reviewer
// (release-flow.mjs) already built `claude -p x`. Now drive builds the same
// argv: the command's first word is the binary, its other words go first,
// then the explicit args. Every other shape stays as it was.

import assert from "node:assert/strict";
import path from "node:path";
import { resolveAgentInvocation } from "../../../dist/shell/execution-backend/agent.js";

const resolve = (request, env = {}) => {
  const r = resolveAgentInvocation(request, env);
  return { binary: r.binary, rawArgs: r.rawArgs };
};

// 1. The fault: a multi-word command with explicit delegation args.
assert.deepEqual(
  resolve({ delegation: { command: "claude -p", args: ["x"] } }),
  { binary: "claude", rawArgs: ["-p", "x"] },
  "a multi-word command must not be spawned as one binary name"
);
assert.deepEqual(
  resolve({ delegation: { command: "node  ./wrap.js\t--fast", args: ["{{input}}"] } }),
  { binary: "node", rawArgs: ["./wrap.js", "--fast", "{{input}}"] },
  "any white space splits, inline words first"
);
assert.deepEqual(
  resolve({ delegation: { command: "claude -p", args: [] } }),
  { binary: "claude", rawArgs: ["-p"] },
  "an empty explicit args list still splits the command"
);

// 2. Unchanged shapes.
assert.deepEqual(
  resolve({ delegation: { command: "claude -p {{input}}" } }),
  { binary: "claude", rawArgs: ["-p", "{{input}}"] },
  "a multi-word command with no explicit args splits as before"
);
assert.deepEqual(
  resolve({ delegation: { command: "claude", args: ["-p", "x"] } }),
  { binary: "claude", rawArgs: ["-p", "x"] },
  "a one-word command keeps its explicit args"
);
assert.deepEqual(
  resolve({ command: "claude -p", args: ["ignored"] }),
  { binary: "claude", rawArgs: ["-p"] },
  "request args are still dropped for a multi-word request command"
);
assert.deepEqual(
  resolve({}, { CW_AGENT_COMMAND: "grok-review {{input}}" }),
  { binary: "grok-review", rawArgs: ["{{input}}"] },
  "CW_AGENT_COMMAND splits as before"
);
assert.deepEqual(
  resolve({ delegation: { args: ["y"] } }, { CW_AGENT_COMMAND: "claude -p" }),
  { binary: "claude", rawArgs: ["y"] },
  "CW_AGENT_COMMAND with explicit args keeps its old rule"
);

console.log("agent-multiword-command: ok");
