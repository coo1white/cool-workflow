#!/usr/bin/env node
// captable-shared-path-and-helppath — pins the documented edge case in
// CliBinding's own doc comment: several capability rows deliberately
// SHARE the same dispatch `cli.path` (the sub-action lives in a
// positional the handler reads), and carry a longer `helpPath` purely
// for display. Also pins `hiddenFromHelp`, the milestone-10 addition that
// keeps a 1-token usage-fallback row off its own `cw help <verb>` line
// without affecting dispatch.

const assert = require("node:assert/strict");
const { REGISTRY, findCapabilityByCliPath } = require("../dist/core/capability-table");

// backend.agent.config.show and backend.agent.config.set share the exact
// same 2-token dispatch path ["backend","agent"], but each carries its
// own distinct, longer helpPath for display.
{
  const show = REGISTRY.find((r) => r.capability === "backend.agent.config.show");
  const set = REGISTRY.find((r) => r.capability === "backend.agent.config.set");
  assert.ok(show && set, "both backend.agent.config rows must be declared");
  assert.deepEqual(show.cli.path, ["backend", "agent"], "show's dispatch path must be [backend,agent]");
  assert.deepEqual(set.cli.path, ["backend", "agent"], "set's dispatch path must be [backend,agent] too (shared)");
  assert.deepEqual(show.cli.helpPath, ["backend", "agent", "config"], "show's helpPath must be the fuller display path");
  assert.deepEqual(set.cli.helpPath, ["backend", "agent", "config"], "set's helpPath must be the fuller display path too");
}

// findCapabilityByCliPath on a shared path deterministically resolves to
// exactly ONE row — the first-declared one in REGISTRY order (dispatch.ts
// depends on this being deterministic, not "whichever object property
// iteration order happens to produce").
{
  const resolved = findCapabilityByCliPath(["backend", "agent"]);
  assert.ok(resolved, "[backend,agent] must resolve to a row");
  assert.equal(resolved.capability, "backend.agent.config.show", "the first-declared row (show) must win the shared-path lookup");
}

// blackboard.message.post and blackboard.message.list share dispatch path
// ["blackboard","message"] the same way.
{
  const post = REGISTRY.find((r) => r.capability === "blackboard.message.post");
  const list = REGISTRY.find((r) => r.capability === "blackboard.message.list");
  assert.ok(post && list, "both blackboard.message rows must be declared");
  assert.deepEqual(post.cli.path, ["blackboard", "message"], "post's dispatch path must be [blackboard,message]");
  assert.deepEqual(list.cli.path, ["blackboard", "message"], "list's dispatch path must be [blackboard,message] too");
  assert.notDeepEqual(post.cli.helpPath, list.cli.helpPath, "post and list must have DISTINCT helpPath display sequences");
}

// hiddenFromHelp: a 1-token usage-fallback row (sandbox.usage) exists to
// own the unknown-subcommand error, and is flagged hiddenFromHelp so it
// does not also get its own cw help line — but it is still fully
// resolvable via findCapabilityByCliPath (dispatch is untouched by the flag).
{
  const usageRow = REGISTRY.find((r) => r.capability === "sandbox.usage");
  assert.ok(usageRow, "sandbox.usage must be declared");
  assert.equal(usageRow.cli.hiddenFromHelp, true, "sandbox.usage must be flagged hiddenFromHelp");
  assert.deepEqual(usageRow.cli.path, ["sandbox"], "sandbox.usage's path must be the bare 1-token [sandbox]");
  const resolved = findCapabilityByCliPath(["sandbox"]);
  assert.equal(resolved.capability, "sandbox.usage", "the hidden usage-fallback row must still resolve via dispatch lookup");
}

// A normal (non-shared, non-hidden) row has hiddenFromHelp left undefined,
// not explicitly false — distinguishing "never set" from "set false".
{
  const versionRow = REGISTRY.find((r) => r.capability === "version");
  assert.equal(versionRow.cli.hiddenFromHelp, undefined, "an ordinary row's hiddenFromHelp must be undefined, not false");
}

process.stdout.write("captable-shared-path-and-helppath: ok\n");
