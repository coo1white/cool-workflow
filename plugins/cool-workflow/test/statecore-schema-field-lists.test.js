#!/usr/bin/env node
// statecore-schema-field-lists (milestone 3) — pins the exact field-list
// constants in core/state/schema.ts against SPEC/state-core.md's
// "src/run-state-schema.ts — the single field-list source" section.

const assert = require("node:assert/strict");
const {
  REQUIRED_TOP_LEVEL_KEYS,
  REQUIRED_ARRAY_KEYS,
  REQUIRED_RECORD_KEYS,
  OPTIONAL_TOP_LEVEL_KEYS,
} = require("../dist/core/state/schema");

// REQUIRED_TOP_LEVEL_KEYS: exact 13-key list, in SPEC order.
{
  assert.deepEqual(
    REQUIRED_TOP_LEVEL_KEYS,
    ["schemaVersion", "id", "createdAt", "updatedAt", "cwd", "workflow", "inputs", "loopStage", "phases", "tasks", "dispatches", "commits", "paths"],
    "REQUIRED_TOP_LEVEL_KEYS must match SPEC exactly, in order"
  );
}

// REQUIRED_ARRAY_KEYS: exact 4-key list.
{
  assert.deepEqual(
    REQUIRED_ARRAY_KEYS,
    ["phases", "tasks", "dispatches", "commits"],
    "REQUIRED_ARRAY_KEYS must match SPEC exactly"
  );
}

// REQUIRED_RECORD_KEYS: exact 5-key list.
{
  assert.deepEqual(
    REQUIRED_RECORD_KEYS,
    ["workflow", "paths", "multiAgent", "blackboard", "topologies"],
    "REQUIRED_RECORD_KEYS must match SPEC exactly"
  );
}

// OPTIONAL_TOP_LEVEL_KEYS: exact 14-key list (13 from SPEC + "links",
// added by the run <-> PR linkage work, the same way "collaboration" was
// added on top of the original SPEC count).
{
  assert.deepEqual(
    OPTIONAL_TOP_LEVEL_KEYS,
    [
      "nodes",
      "contracts",
      "feedback",
      "audit",
      "workers",
      "sandboxProfiles",
      "customSandboxProfiles",
      "candidates",
      "candidateSelections",
      "multiAgent",
      "blackboard",
      "topologies",
      "collaboration",
      "links",
    ],
    "OPTIONAL_TOP_LEVEL_KEYS must match SPEC plus later, deliberate additions"
  );
}

// REQUIRED_TOP_LEVEL_KEYS (the "must exist" list) and OPTIONAL_TOP_LEVEL_KEYS
// (the "may be absent" list) are disjoint — a key cannot be both mandatory
// AND optional to exist. REQUIRED_RECORD_KEYS is a DIFFERENT axis (shape
// when present) and legitimately overlaps OPTIONAL_TOP_LEVEL_KEYS for
// multiAgent/blackboard/topologies: those three are optional to exist but
// must be records if they do exist. That overlap is correct, not a bug.
{
  const required = new Set(REQUIRED_TOP_LEVEL_KEYS);
  const overlap = OPTIONAL_TOP_LEVEL_KEYS.filter((key) => required.has(key));
  assert.deepEqual(overlap, [], "no key should appear in both the required-to-exist and optional-to-exist lists");
}

// multiAgent/blackboard/topologies legitimately appear in BOTH
// REQUIRED_RECORD_KEYS (shape guard) and OPTIONAL_TOP_LEVEL_KEYS (existence
// guard) — pin this intersection explicitly so it reads as intentional.
{
  const recordKeys = new Set(REQUIRED_RECORD_KEYS);
  const optionalKeys = new Set(OPTIONAL_TOP_LEVEL_KEYS);
  const intersection = REQUIRED_RECORD_KEYS.filter((key) => optionalKeys.has(key)).sort();
  assert.deepEqual(
    intersection,
    ["blackboard", "multiAgent", "topologies"],
    "multiAgent/blackboard/topologies are optional to exist but must be records when present"
  );
  assert.ok(recordKeys.has("workflow") && !optionalKeys.has("workflow"), "workflow is required to exist AND must be a record");
  assert.ok(recordKeys.has("paths") && !optionalKeys.has("paths"), "paths is required to exist AND must be a record");
}

process.stdout.write("statecore-schema-field-lists: ok\n");
