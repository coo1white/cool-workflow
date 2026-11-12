#!/usr/bin/env node
// captable-mcp-tool-definitions — pins mcpToolDefinitions()'s exact JSON
// shape: SPEC/mcp.md's toolDefinitions()/mcpToolDefinition() contract
// ("inputSchema.additionalProperties is always true") plus:
//   - the file's own hand-written PROPERTY_OVERRIDES exception
//     (cw_commit's boolean allowUnverifiedCheckpoint) — it wins over
//     COMMON_PROPERTY_TYPES below;
//   - COMMON_PROPERTY_TYPES, which gives every other declared property
//     name a real type and a true, short description (not the bare
//     name-echoing string form);
//   - inputSchema.required, built from each row's AND-only requiredArgs
//     groups (an OR group, joined with "|", never puts any of its names
//     into this flat, AND-only list).

import assert from "node:assert/strict";
import { mcpToolDefinitions } from "../../dist/wiring/capability-table/index.js";
import { COMMON_PROPERTY_TYPES } from "../../dist/core/capability-data.js";

// Every definition has the exact top-level shape: name, description,
// inputSchema:{type:"object", properties, additionalProperties:true}.
{
  const defs = mcpToolDefinitions();
  assert.equal(defs.length, 94, "mcpToolDefinitions() must return exactly 94 entries");
  for (const def of defs) {
    assert.equal(typeof def.name, "string", `${def.name}: name must be a string`);
    assert.equal(typeof def.description, "string", `${def.name}: description must be a string`);
    assert.ok(def.description.trim().length > 0, `${def.name}: description must be non-empty`);
    assert.equal(def.inputSchema.type, "object", `${def.name}: inputSchema.type must be "object"`);
    assert.equal(def.inputSchema.additionalProperties, true, `${def.name}: additionalProperties must always be true`);
  }
}

// cw_list (zero declared properties): properties object is exactly {}.
{
  const defs = mcpToolDefinitions();
  const cwList = defs.find((d) => d.name === "cw_list");
  assert.ok(cwList, "cw_list must be declared");
  assert.deepEqual(cwList.inputSchema.properties, {}, "cw_list must have zero properties");
}

// COMMON_PROPERTY_TYPES form: an ordinary property (no per-tool override)
// now carries its real type plus a true, short description — NOT the old
// plain-string form where description just echoed the property name back.
{
  const defs = mcpToolDefinitions();
  const cwStatus = defs.find((d) => d.name === "cw_status");
  assert.deepEqual(
    cwStatus.inputSchema.properties.runId,
    COMMON_PROPERTY_TYPES.runId,
    "an unoverridden property must match its COMMON_PROPERTY_TYPES entry"
  );
  assert.equal(cwStatus.inputSchema.properties.runId.type, "string", "runId must be typed as a string");
  assert.notEqual(
    cwStatus.inputSchema.properties.runId.description,
    "runId",
    "runId's description must be a true sentence, not the property name echoed back"
  );
  assert.ok(
    cwStatus.inputSchema.properties.runId.description.length > "runId".length,
    "runId's description must be a real, non-trivial sentence"
  );
}

// A numeric property (no per-tool override) gets type "number", not the
// old fake plain-string form.
{
  const defs = mcpToolDefinitions();
  const cwNext = defs.find((d) => d.name === "cw_next");
  assert.ok(cwNext, "cw_next must be declared");
  assert.equal(cwNext.inputSchema.properties.limit.type, "number", "limit must be typed as a number");
  assert.notEqual(
    cwNext.inputSchema.properties.limit.description,
    "limit",
    "limit's description must be a true sentence, not the property name echoed back"
  );
}

// No property anywhere is left with an unhandled/crashing shape: every
// declared property on every tool has a real type and a non-empty,
// non-name-echoing description (PROPERTY_OVERRIDES/COMMON_PROPERTY_TYPES
// cover every name actually used; nothing should fall through as bare).
{
  const defs = mcpToolDefinitions();
  for (const def of defs) {
    for (const [propName, schema] of Object.entries(def.inputSchema.properties)) {
      assert.ok(
        ["string", "number", "boolean", "object", "array"].includes(schema.type),
        `${def.name}.${propName}: type must be a real JSON-schema type, got ${schema.type}`
      );
      assert.ok(schema.description && schema.description.trim().length > 0, `${def.name}.${propName}: description must be non-empty`);
      assert.notEqual(
        schema.description,
        propName,
        `${def.name}.${propName}: description must not just echo the property name back`
      );
    }
  }
}

// inputSchema.required, simple AND-only case: cw_status declares runId as
// its one required argument, so required must contain exactly "runId".
{
  const defs = mcpToolDefinitions();
  const cwStatus = defs.find((d) => d.name === "cw_status");
  assert.deepEqual(cwStatus.inputSchema.required, ["runId"], "cw_status's required must be exactly [\"runId\"]");
}

// inputSchema.required, AND group of two: cw_node_show requires both
// runId AND nodeId.
{
  const defs = mcpToolDefinitions();
  const cwNodeShow = defs.find((d) => d.name === "cw_node_show");
  assert.deepEqual(cwNodeShow.inputSchema.required, ["runId", "nodeId"], "cw_node_show's required must be [\"runId\", \"nodeId\"]");
}

// inputSchema.required, OR-group case: cw_run_import's one requiredArgs
// group is "archive|path|file" — an OR group. JSON Schema's plain
// "required" is AND-only, so none of its three names may be forced in,
// and the raw joined string must never leak through as a literal entry.
// (This case used cw_eval_replay until that tool went with the multi-agent
// family, slim-and-esm step 2.)
{
  const defs = mcpToolDefinitions();
  const cwRunImport = defs.find((d) => d.name === "cw_run_import");
  assert.ok(cwRunImport, "cw_run_import must be declared");
  const required = cwRunImport.inputSchema.required;
  if (required !== undefined) {
    assert.ok(!required.includes("archive|path|file"), "the raw OR-group string must never leak into required");
    assert.ok(!required.includes("archive"), "an OR-group name must not be forced into required");
    assert.ok(!required.includes("path"), "an OR-group name must not be forced into required");
    assert.ok(!required.includes("file"), "an OR-group name must not be forced into required");
  }
}

// PROPERTY_OVERRIDES exception 1: cw_commit's allowUnverifiedCheckpoint is
// a boolean property, not the plain string default.
{
  const defs = mcpToolDefinitions();
  const cwCommit = defs.find((d) => d.name === "cw_commit");
  assert.ok(cwCommit, "cw_commit must be declared");
  assert.deepEqual(
    cwCommit.inputSchema.properties.allowUnverifiedCheckpoint,
    { type: "boolean", description: "Write a non-gated checkpoint instead of committed state" },
    "cw_commit's allowUnverifiedCheckpoint must be the boolean override, not the plain string form"
  );
  // Other cw_commit properties still get their COMMON_PROPERTY_TYPES form.
  assert.deepEqual(
    cwCommit.inputSchema.properties.runId,
    COMMON_PROPERTY_TYPES.runId,
    "cw_commit's runId must still match its COMMON_PROPERTY_TYPES entry"
  );
}

// Overrides are scoped to their OWN tool only — cw_commit's boolean
// override for allowUnverifiedCheckpoint must not leak onto any other
// tool that happens to share a property name (defensive: no other
// declared tool shares "allowUnverifiedCheckpoint", so this stays string
// everywhere else if it ever were reused).
{
  const defs = mcpToolDefinitions();
  for (const def of defs) {
    if (def.name === "cw_commit") continue;
    const prop = def.inputSchema.properties.allowUnverifiedCheckpoint;
    if (prop) {
      assert.equal(prop.type, "string", `${def.name}: allowUnverifiedCheckpoint override must not leak outside cw_commit`);
    }
  }
}

// Order is preserved: declared property order matches the row's own
// `properties` list order (checked via a multi-property tool).
{
  const defs = mcpToolDefinitions();
  const cwPlan = defs.find((d) => d.name === "cw_plan");
  assert.deepEqual(
    Object.keys(cwPlan.inputSchema.properties),
    ["workflowId", "repo", "question"],
    "cw_plan's property key order must match the declared properties list order"
  );
}

// Behavior-hint annotations (MCP_TOOL_ANNOTATIONS): a checked pure read
// carries readOnlyHint true, and a tool NOT in the side table has NO
// annotations key at all — absent beats wrong. No tool carries
// destructiveHint since the delete sweeps went with the frozen surfaces.
{
  const defs = mcpToolDefinitions();
  const byName = new Map(defs.map((d) => [d.name, d]));

  assert.deepEqual(byName.get("cw_node_list").annotations, { readOnlyHint: true }, "cw_node_list is a checked pure read");
  assert.deepEqual(byName.get("cw_status").annotations, { readOnlyHint: true }, "cw_status is a checked pure read");
  for (const def of defs) {
    assert.ok(!(def.annotations && def.annotations.destructiveHint), `${def.name}: no tool is a delete sweep now`);
  }

  // Deliberately unannotated tools: cw_plan and cw_commit mutate;
  // cw_metrics_show / cw_operator_report look like reads but persist a
  // derived report. None may carry a hint.
  for (const name of ["cw_plan", "cw_commit", "cw_metrics_show", "cw_operator_report"]) {
    assert.ok(!("annotations" in byName.get(name)), `${name} must carry NO annotations key`);
  }

  // No tool may ever say readOnlyHint AND destructiveHint are both true.
  for (const def of defs) {
    if (!def.annotations) continue;
    assert.ok(
      !(def.annotations.readOnlyHint === true && def.annotations.destructiveHint === true),
      `${def.name}: readOnlyHint and destructiveHint must not both be true`
    );
  }
}

// "When to use which" cross-references: each of the two status-family
// descriptions names its sibling status tool. A drift guard so a later description edit keeps the
// cross-references. (cw_multi_agent_status went with the multi-agent family, slim-and-esm
// step 2, and cw_workbench_view with the frozen surfaces; no description
// may still name either.)
{
  const defs = mcpToolDefinitions();
  const byName = new Map(defs.map((d) => [d.name, d]));
  for (const def of defs) {
    assert.ok(!/cw_(multi_agent|blackboard|candidate|topology|workbench|schedule|routine|sched|gc|clones|orphans)_/.test(def.description), `${def.name}'s description must not name a removed tool`);
  }
  const statusFamily = ["cw_status", "cw_operator_status"];
  for (const name of statusFamily) {
    const description = byName.get(name).description;
    const siblings = statusFamily.filter((sibling) => sibling !== name);
    assert.ok(
      siblings.some((sibling) => description.includes(sibling)),
      `${name}'s description must name at least one sibling status tool (got: ${description})`
    );
  }
}

process.stdout.write("captable-mcp-tool-definitions: ok\n");
