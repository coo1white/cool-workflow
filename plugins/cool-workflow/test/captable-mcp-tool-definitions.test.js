#!/usr/bin/env node
// captable-mcp-tool-definitions — pins mcpToolDefinitions()'s exact JSON
// shape: SPEC/mcp.md's toolDefinitions()/mcpToolDefinition() contract
// ("inputSchema.additionalProperties is always true") plus:
//   - the file's own two hand-written PROPERTY_OVERRIDES exceptions
//     (cw_commit's boolean allowUnverifiedCheckpoint, cw_routine_fire's
//     object payload) — these win over COMMON_PROPERTY_TYPES below;
//   - COMMON_PROPERTY_TYPES, which gives every other declared property
//     name a real type and a true, short description (not the bare
//     name-echoing string form);
//   - inputSchema.required, built from each row's AND-only requiredArgs
//     groups (an OR group, joined with "|", never puts any of its names
//     into this flat, AND-only list).

const assert = require("node:assert/strict");
const { mcpToolDefinitions } = require("../dist/core/capability-table");
const { COMMON_PROPERTY_TYPES } = require("../dist/core/capability-data");

// Every definition has the exact top-level shape: name, description,
// inputSchema:{type:"object", properties, additionalProperties:true}.
{
  const defs = mcpToolDefinitions();
  assert.equal(defs.length, 199, "mcpToolDefinitions() must return exactly 199 entries");
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

// inputSchema.required, OR-group case: cw_eval_replay's one requiredArgs
// group is "snapshot|snapshotId|path" — an OR group. JSON Schema's plain
// "required" is AND-only, so none of its three names may be forced in,
// and the raw joined string must never leak through as a literal entry.
{
  const defs = mcpToolDefinitions();
  const cwEvalReplay = defs.find((d) => d.name === "cw_eval_replay");
  assert.ok(cwEvalReplay, "cw_eval_replay must be declared");
  const required = cwEvalReplay.inputSchema.required;
  if (required !== undefined) {
    assert.ok(!required.includes("snapshot|snapshotId|path"), "the raw OR-group string must never leak into required");
    assert.ok(!required.includes("snapshot"), "an OR-group name must not be forced into required");
    assert.ok(!required.includes("snapshotId"), "an OR-group name must not be forced into required");
    assert.ok(!required.includes("path"), "an OR-group name must not be forced into required");
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

// PROPERTY_OVERRIDES exception 2: cw_routine_fire's payload is an object
// property, not the plain string default.
{
  const defs = mcpToolDefinitions();
  const cwRoutineFire = defs.find((d) => d.name === "cw_routine_fire");
  assert.ok(cwRoutineFire, "cw_routine_fire must be declared");
  assert.deepEqual(
    cwRoutineFire.inputSchema.properties.payload,
    { type: "object", description: "Event payload" },
    "cw_routine_fire's payload must be the object override, not the plain string form"
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
// carries readOnlyHint true, a checked delete sweep carries
// destructiveHint true (with readOnlyHint false), and a tool NOT in the
// side table has NO annotations key at all — absent beats wrong.
{
  const defs = mcpToolDefinitions();
  const byName = new Map(defs.map((d) => [d.name, d]));

  assert.deepEqual(byName.get("cw_node_list").annotations, { readOnlyHint: true }, "cw_node_list is a checked pure read");
  assert.deepEqual(byName.get("cw_status").annotations, { readOnlyHint: true }, "cw_status is a checked pure read");
  assert.deepEqual(
    byName.get("cw_gc_run").annotations,
    { readOnlyHint: false, destructiveHint: true },
    "cw_gc_run is a checked delete sweep"
  );
  assert.deepEqual(
    byName.get("cw_schedule_delete").annotations,
    { readOnlyHint: false, destructiveHint: true },
    "cw_schedule_delete is a checked delete sweep"
  );

  // Deliberately unannotated tools: cw_plan and cw_commit mutate;
  // cw_metrics_show / cw_workbench_view / cw_operator_report look like
  // reads but persist a derived report; cw_schedule_due marks expired
  // tasks. None may carry a hint.
  for (const name of ["cw_plan", "cw_commit", "cw_metrics_show", "cw_workbench_view", "cw_operator_report", "cw_schedule_due"]) {
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

// "When to use which" cross-references: each of the four status-family
// descriptions names at least one sibling status tool, and
// cw_sandbox_resolve's description says it is an alias and names the
// preferred tool. A drift guard so a later description edit keeps the
// cross-references.
{
  const defs = mcpToolDefinitions();
  const byName = new Map(defs.map((d) => [d.name, d]));
  const statusFamily = ["cw_status", "cw_operator_status", "cw_workbench_view", "cw_multi_agent_status"];
  for (const name of statusFamily) {
    const description = byName.get(name).description;
    const siblings = statusFamily.filter((sibling) => sibling !== name);
    assert.ok(
      siblings.some((sibling) => description.includes(sibling)),
      `${name}'s description must name at least one sibling status tool (got: ${description})`
    );
  }
  const resolveDescription = byName.get("cw_sandbox_resolve").description;
  assert.ok(/alias/i.test(resolveDescription), "cw_sandbox_resolve's description must say it is an alias");
  assert.ok(resolveDescription.includes("cw_sandbox_choose"), "cw_sandbox_resolve's description must name cw_sandbox_choose");
}

process.stdout.write("captable-mcp-tool-definitions: ok\n");
