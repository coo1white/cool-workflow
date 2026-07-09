#!/usr/bin/env node
// captable-mcp-tool-definitions — pins mcpToolDefinitions()'s exact JSON
// shape: SPEC/mcp.md's toolDefinitions()/mcpToolDefinition() contract
// ("inputSchema.additionalProperties is always true") plus the file's own
// two hand-written PROPERTY_OVERRIDES exceptions (cw_commit's boolean
// allowUnverifiedCheckpoint, cw_routine_fire's object payload) — every
// other property on every other tool is the plain string form.

const assert = require("node:assert/strict");
const { mcpToolDefinitions } = require("../dist/core/capability-table");

// Every definition has the exact top-level shape: name, description,
// inputSchema:{type:"object", properties, additionalProperties:true}.
{
  const defs = mcpToolDefinitions();
  assert.equal(defs.length, 198, "mcpToolDefinitions() must return exactly 198 entries");
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

// Plain string property form: an ordinary property (no override) is
// exactly { type: "string", description: <same as the property name> }.
{
  const defs = mcpToolDefinitions();
  const cwStatus = defs.find((d) => d.name === "cw_status");
  assert.deepEqual(
    cwStatus.inputSchema.properties.runId,
    { type: "string", description: "runId" },
    "an unoverridden property must be the plain string form with description === property name"
  );
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
  // Other cw_commit properties are still the plain string form.
  assert.deepEqual(
    cwCommit.inputSchema.properties.runId,
    { type: "string", description: "runId" },
    "cw_commit's runId must still be the plain string form"
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

process.stdout.write("captable-mcp-tool-definitions: ok\n");
