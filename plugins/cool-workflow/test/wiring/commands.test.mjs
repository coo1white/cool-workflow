#!/usr/bin/env node
// wiring/commands — the command table: the kept verbs and only those, each
// path found exactly, and the ask row reachable only through -q / --resume.

import assert from "node:assert/strict";
import { ASK, COMMANDS, findCommand } from "../../dist/wiring/commands.js";

const paths = COMMANDS.map((row) => row.path.join(" ")).sort();
assert.deepEqual(paths, ["check", "check list", "check show", "report", "report bundle", "report verify-bundle", "version"]);
assert.ok(!COMMANDS.includes(ASK), "ask has no verb of its own");
assert.equal(findCommand(["report", "bundle"]).path.join(" "), "report bundle");
assert.equal(findCommand(["report", "nope"]), undefined);
assert.equal(findCommand(["quickstart"]), undefined);

const modes = Object.fromEntries(COMMANDS.map((row) => [row.path.join(" "), row.jsonMode]));
assert.deepEqual(modes, {
  version: "default",
  report: "flag",
  "report bundle": "default",
  "report verify-bundle": "flag",
  check: "default",
  "check list": "default",
  "check show": "default",
});
assert.equal(ASK.jsonMode, "default");
assert.equal(typeof ASK.humanRender, "function");

// The handlers that need no run or agent.
assert.match(findCommand(["version"]).handler({ positionals: [], options: {} }).text, /^\d+\.\d+\.\d+\n$/);
for (const gone of [["doctor"], ["fix"], ["demo"], ["demo", "tamper"]]) assert.equal(findCommand(gone), undefined, `${gone.join(" ")} is cut`);

console.log("wiring/commands: ok");
