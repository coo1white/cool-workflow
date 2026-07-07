#!/usr/bin/env node
// captable-status-and-sandbox-data — pins the two small pure data bodies
// capability-table.ts exports directly (statusPayload's no-run-id branch,
// listBundledSandboxProfiles' literal 4-profile list), plus the declared
// jsonMode value per capability (SPEC/cli-surface.md: "--json and --format
// json are the same switch... Verbs are one of three JSON modes, declared
// per capability in the registry (default, flag, human)").

const assert = require("node:assert/strict");
const { statusPayload, listBundledSandboxProfiles, findCapability } = require("../dist/core/capability-table");

// statusPayload(undefined): the exact no-run-id shape SPEC/cli-surface.md
// pins ({runId:null, nextActions}) — no disk access on this branch, safe
// to call as a pure in-memory function.
{
  const payload = statusPayload(undefined);
  assert.equal(payload.runId, null, "no-run-id statusPayload must have runId:null");
  assert.ok(Array.isArray(payload.nextActions), "nextActions must be an array");
  assert.ok(payload.nextActions.length > 0, "nextActions must be non-empty when there is no run");
  const first = payload.nextActions[0];
  assert.equal(typeof first.command, "string", "each nextAction must carry a string command");
  assert.equal(typeof first.reason, "string", "each nextAction must carry a string reason");
  assert.equal(typeof first.priority, "string", "each nextAction must carry a string priority");
}

// statusPayload treats an empty string the same as undefined (both are
// "falsy", both take the no-run-id branch) — this is the `!runId` guard's
// documented behavior, not just undefined-strict.
{
  const a = statusPayload(undefined);
  const b = statusPayload("");
  assert.deepEqual(a, b, "statusPayload('') must equal statusPayload(undefined)");
}

// listBundledSandboxProfiles(): the exact literal 4-profile list this
// milestone reproduces (PLACEHOLDER per the file's own doc comment, ahead
// of milestone 5's real resolveSandboxProfile-backed version).
{
  const profiles = listBundledSandboxProfiles();
  assert.deepEqual(
    profiles,
    [
      { schemaVersion: 1, id: "default", title: "Default Worker Boundary" },
      { schemaVersion: 1, id: "readonly", title: "Readonly Workspace" },
      { schemaVersion: 1, id: "workspace-write", title: "Workspace Write" },
      { schemaVersion: 1, id: "locked-down", title: "Locked Down" },
    ],
    "listBundledSandboxProfiles() must return the exact pinned 4-profile literal list"
  );
}

// listBundledSandboxProfiles() is a pure function: calling it twice gives
// two structurally-equal but not object-identical results (a fresh array
// each call, not a shared mutable singleton a caller could corrupt).
{
  const a = listBundledSandboxProfiles();
  const b = listBundledSandboxProfiles();
  assert.deepEqual(a, b, "two calls must be structurally equal");
  a.push({ schemaVersion: 1, id: "mutated", title: "should not leak" });
  const c = listBundledSandboxProfiles();
  assert.equal(c.length, 4, "mutating one call's returned array must not affect a later call");
}

// jsonMode is declared per the exact three-value enum SPEC/cli-surface.md
// pins, and specific capabilities carry the specific mode their handler
// needs: status is "flag" (only a --json/--format json flag switches
// modes on an otherwise-human command), list/sandbox.list/version are
// "default" (bare JSON output).
{
  const status = findCapability("status");
  assert.equal(status.cli.jsonMode, "flag", "status's jsonMode must be 'flag'");
  const list = findCapability("list");
  assert.equal(list.cli.jsonMode, "default", "list's jsonMode must be 'default'");
  const sandboxList = findCapability("sandbox.list");
  assert.equal(sandboxList.cli.jsonMode, "default", "sandbox.list's jsonMode must be 'default'");
  const version = findCapability("version");
  assert.equal(version.cli.jsonMode, "default", "version's jsonMode must be 'default'");
}

// Every declared cli.jsonMode across the whole table is one of exactly
// the three allowed values — a stray fourth value would be a silent typo
// with no compiler catch at the JS runtime layer.
{
  const { REGISTRY } = require("../dist/core/capability-table");
  const allowed = new Set(["default", "flag", "human"]);
  const bad = REGISTRY.filter((row) => row.cli && !allowed.has(row.cli.jsonMode));
  assert.deepEqual(
    bad.map((row) => row.capability),
    [],
    "every cli-bound row's jsonMode must be one of default|flag|human"
  );
}

process.stdout.write("captable-status-and-sandbox-data: ok\n");
