#!/usr/bin/env node
// formatapps-appschema-validate-edgecases — pins the rest of
// validateWorkflowApp's rules named in SPEC/workflow-apps.md's "Rebuild
// risks"-adjacent invariants list: limits (positive ints,
// maxConcurrentAgents <= maxAgents, task-count vs maxAgents), input
// definitions (name pattern, uniqueness, type enum), sandbox profile
// references (bundled-id allowlist, per-task cross-check against app
// sandboxProfiles), workflow/app id+title mismatch, app-inputs-vs-
// workflow-inputs equality, and compatibility min/max version gating.
//
// Evidence: SPEC/workflow-apps.md "App loading fails closed" bullet list;
// src/core/workflow-apps/app-schema.ts's validate* helpers.

const assert = require("node:assert/strict");
const { validateWorkflowApp, validateWorkflowDefinition, workflow, phase, agent, isWorkflowAppCompatible } = require("../dist/core/workflow-apps/app-schema");

const CTX = { bundledSandboxProfileIds: ["default", "locked-down", "readonly", "workspace-write"], currentCoolWorkflowVersion: "0.1.98" };

function baseWorkflow(overrides = {}) {
  return workflow({ id: "my-app", title: "My App", phases: [phase("Map", [agent("map:one", "do it")])], ...overrides });
}

function validApp(overrides = {}) {
  return { schemaVersion: 1, id: "my-app", title: "My App", version: "0.1.0", workflow: baseWorkflow(), ...overrides };
}

// Limits: maxAgents/maxConcurrentAgents must be positive integers.
{
  const badMax = validateWorkflowDefinition(baseWorkflow({ limits: { maxAgents: 0, maxConcurrentAgents: 1 } }), CTX);
  assert.ok(badMax.some((i) => i.code === "workflow-limits" && i.message.includes("maxAgents")), "maxAgents 0 is rejected as non-positive");

  const nonInt = validateWorkflowDefinition(baseWorkflow({ limits: { maxAgents: 3.5, maxConcurrentAgents: 1 } }), CTX);
  assert.ok(nonInt.some((i) => i.code === "workflow-limits"), "a fractional maxAgents is rejected as non-integer");

  // maxConcurrentAgents must be <= maxAgents.
  const inverted = validateWorkflowDefinition(baseWorkflow({ limits: { maxAgents: 2, maxConcurrentAgents: 5 } }), CTX);
  assert.ok(
    inverted.some((i) => i.code === "workflow-limits" && i.message.includes("must be less than or equal to")),
    "maxConcurrentAgents greater than maxAgents is rejected"
  );

  // Equal is fine (boundary, not a strict <).
  const equalOk = validateWorkflowDefinition(baseWorkflow({ limits: { maxAgents: 4, maxConcurrentAgents: 4 } }), CTX);
  assert.ok(!equalOk.some((i) => i.message && i.message.includes("less than or equal to")), "maxConcurrentAgents === maxAgents is accepted (boundary case)");
}

// Limits vs total task count: task count over limits.maxAgents is rejected
// with the exact named-count message.
{
  const manyTasks = phase("Map", [agent("t1", "x"), agent("t2", "y"), agent("t3", "z")]);
  const issues = validateWorkflowDefinition(baseWorkflow({ limits: { maxAgents: 2, maxConcurrentAgents: 1 }, phases: [manyTasks] }), CTX);
  assert.ok(
    issues.some((i) => i.code === "workflow-limits" && i.message === "Workflow defines 3 tasks but limits.maxAgents is 2"),
    "a task count over limits.maxAgents is rejected with the exact templated message"
  );
}

// Input definitions: name pattern, uniqueness, type enum, required/
// repeated must be boolean.
{
  const badName = validateWorkflowDefinition(baseWorkflow({ inputs: [{ name: "1bad" }] }), CTX);
  assert.ok(badName.some((i) => i.code === "workflow-input-name"), "an input name starting with a digit is rejected");

  const dupName = validateWorkflowDefinition(baseWorkflow({ inputs: [{ name: "q" }, { name: "q" }] }), CTX);
  assert.ok(dupName.some((i) => i.code === "workflow-input-duplicate"), "a duplicate input name is rejected");

  const badType = validateWorkflowDefinition(baseWorkflow({ inputs: [{ name: "q", type: "float" }] }), CTX);
  assert.ok(badType.some((i) => i.code === "workflow-input-type"), "an input type outside the closed set is rejected");

  const goodTypes = ["string", "number", "boolean", "path", "json"];
  for (const type of goodTypes) {
    const ok = validateWorkflowDefinition(baseWorkflow({ inputs: [{ name: "q", type }] }), CTX);
    assert.ok(!ok.some((i) => i.code === "workflow-input-type"), `input type "${type}" must be accepted`);
  }

  const badRequired = validateWorkflowDefinition(baseWorkflow({ inputs: [{ name: "q", required: "yes" }] }), CTX);
  assert.ok(badRequired.some((i) => i.code === "workflow-input-required"), "a non-boolean 'required' is rejected");
}

// Sandbox profile references: must be one of the bundled ids; a
// per-TASK sandboxProfileId must ALSO be listed in the app's own
// sandboxProfiles when that list exists (a stricter, narrower check than
// just "is it a bundled id").
{
  const unknownProfile = validateWorkflowDefinition(baseWorkflow({ sandboxProfiles: ["not-a-real-profile"] }), CTX);
  assert.ok(unknownProfile.some((i) => i.code === "workflow-sandbox-profile-unknown"), "a sandbox profile outside the bundled set is rejected");

  const dupProfile = validateWorkflowDefinition(baseWorkflow({ sandboxProfiles: ["readonly", "readonly"] }), CTX);
  assert.ok(dupProfile.some((i) => i.code === "workflow-sandbox-profile-duplicate"), "a duplicate sandbox profile reference is rejected");

  // Task references a bundled+valid profile id, but one NOT listed in the
  // app's own (narrower) sandboxProfiles array -> rejected.
  const taskProfileNotInApp = validateWorkflowApp(
    validApp({
      sandboxProfiles: ["readonly"],
      workflow: baseWorkflow({ phases: [phase("Map", [agent("t1", "x", { sandboxProfileId: "workspace-write" })])] }),
    }),
    CTX
  );
  assert.ok(
    taskProfileNotInApp.issues.some((i) => i.code === "workflow-task-sandbox-profile"),
    "a task sandboxProfileId not listed in the app's own sandboxProfiles is rejected, even though it's a valid bundled id"
  );

  // Same profile IS listed in the app's sandboxProfiles -> accepted.
  const taskProfileInApp = validateWorkflowApp(
    validApp({
      sandboxProfiles: ["readonly", "workspace-write"],
      workflow: baseWorkflow({ phases: [phase("Map", [agent("t1", "x", { sandboxProfileId: "workspace-write" })])] }),
    }),
    CTX
  );
  assert.ok(!taskProfileInApp.issues.some((i) => i.code === "workflow-task-sandbox-profile"), "a task profile listed in the app's sandboxProfiles is accepted");
}

// Workflow id/title must equal app id/title when both an app id/title and
// an inline workflow definition are present.
{
  const idMismatch = validateWorkflowApp(validApp({ id: "different-id" }), CTX);
  assert.ok(idMismatch.issues.some((i) => i.code === "workflow-app-id-mismatch"), "an app id that differs from the inline workflow id is rejected");

  const titleMismatch = validateWorkflowApp(validApp({ title: "Different Title" }), CTX);
  assert.ok(titleMismatch.issues.some((i) => i.code === "workflow-app-title-mismatch"), "an app title that differs from the inline workflow title is rejected");
}

// App-level inputs, when present alongside an inline workflow, must be
// JSON-equal to workflow.inputs.
{
  const mismatchedInputs = validateWorkflowApp(
    validApp({ inputs: [{ name: "q", required: true }], workflow: baseWorkflow({ inputs: [{ name: "q", required: false }] }) }),
    CTX
  );
  assert.ok(mismatchedInputs.issues.some((i) => i.code === "workflow-app-inputs-mismatch"), "app.inputs that differ from workflow.inputs are rejected");

  const matchedInputs = validateWorkflowApp(
    validApp({ inputs: [{ name: "q", required: true }], workflow: baseWorkflow({ inputs: [{ name: "q", required: true }] }) }),
    CTX
  );
  assert.ok(!matchedInputs.issues.some((i) => i.code === "workflow-app-inputs-mismatch"), "identical app.inputs and workflow.inputs are accepted");
}

// Compatibility: minVersion/maxVersion must be semver; current version
// outside the [min,max] window is rejected as workflow-app-incompatible.
{
  const tooOld = validateWorkflowApp(validApp({ compatibility: { minVersion: "99.0.0" } }), CTX);
  assert.ok(tooOld.issues.some((i) => i.code === "workflow-app-incompatible"), "current version below compatibility.minVersion is rejected");

  const tooNew = validateWorkflowApp(validApp({ compatibility: { maxVersion: "0.0.1" } }), CTX);
  assert.ok(tooNew.issues.some((i) => i.code === "workflow-app-incompatible"), "current version above compatibility.maxVersion is rejected");

  const withinWindow = validateWorkflowApp(validApp({ compatibility: { minVersion: "0.1.0", maxVersion: "1.0.0" } }), CTX);
  assert.ok(!withinWindow.issues.some((i) => i.code === "workflow-app-incompatible"), "a version within [min,max] is accepted");

  const badSemver = validateWorkflowApp(validApp({ compatibility: { minVersion: "not-semver" } }), CTX);
  assert.ok(badSemver.issues.some((i) => i.code === "workflow-app-compatibility"), "a non-semver minVersion is rejected on its own shape, before the version-window check");
}

// isWorkflowAppCompatible: true only checks for the workflow-app-
// incompatible code specifically — an otherwise-broken app (e.g. missing
// title) can still be "compatible" by this narrower definition, since it's
// a version-gate check, not a full validity check.
{
  const app = validApp({ compatibility: { minVersion: "99.0.0" } });
  assert.equal(isWorkflowAppCompatible(app, CTX), false, "isWorkflowAppCompatible is false when minVersion isn't met");

  const compatibleButOtherwiseInvalid = validApp({ compatibility: { minVersion: "0.0.1" }, title: "" });
  assert.equal(
    isWorkflowAppCompatible(compatibleButOtherwiseInvalid, CTX),
    true,
    "isWorkflowAppCompatible only cares about the incompatible code, not overall validity (an empty title does not flip it false)"
  );
}

process.stdout.write("formatapps-appschema-validate-edgecases: ok\n");
