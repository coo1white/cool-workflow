#!/usr/bin/env node
// formatapps-appschema-validate-manifest — pins validateWorkflowApp's core
// required-field checks: schemaVersion, app id, title, semver version,
// the workflow field (entrypoint vs inline definition), phase shape
// (id/name/tasks), task shape (id/kind/prompt), and that a genuinely
// malformed manifest is REJECTED (not silently accepted) for each of
// these, one issue code per case.
//
// Evidence: SPEC/workflow-apps.md "App framework" + the validation rules
// list; src/core/workflow-apps/app-schema.ts's validateWorkflowApp.

const assert = require("node:assert/strict");
const { validateWorkflowApp, workflow, phase, agent, artifact, assertValidWorkflowApp, WorkflowAppValidationError, validationIssuesFromError } = require("../dist/core/workflow-apps/app-schema");

const CTX = { bundledSandboxProfileIds: ["default", "locked-down", "readonly", "workspace-write"], currentCoolWorkflowVersion: "0.1.98" };

function validApp(overrides = {}) {
  const wf = workflow({ id: "my-app", title: "My App", phases: [phase("Map", [agent("map:one", "do the thing")])] });
  return { schemaVersion: 1, id: "my-app", title: "My App", version: "0.1.0", workflow: wf, ...overrides };
}

// A well-formed manifest with an inline workflow definition validates
// clean: valid true, zero issues, appId echoed back.
{
  const result = validateWorkflowApp(validApp(), CTX);
  assert.deepEqual(result, { valid: true, appId: "my-app", appPath: undefined, issues: [] }, "a well-formed manifest validates with zero issues");
}

// Non-object candidate: rejected immediately with a single top-level
// issue, no crash.
{
  for (const bad of [null, undefined, "a string", 42, []]) {
    const result = validateWorkflowApp(bad, CTX);
    assert.equal(result.valid, false, `a non-object candidate (${JSON.stringify(bad)}) must be rejected`);
    assert.equal(result.issues[0].code, "workflow-app-invalid", "the top-level issue code is workflow-app-invalid");
  }
}

// schemaVersion: only the literal 1 is accepted.
{
  for (const bad of [2, 0, "1", undefined, null]) {
    const result = validateWorkflowApp(validApp({ schemaVersion: bad }), CTX);
    assert.equal(result.valid, false, `schemaVersion ${JSON.stringify(bad)} must be rejected`);
    assert.ok(result.issues.some((i) => i.code === "workflow-app-schema-version"), "rejection carries the workflow-app-schema-version code");
  }
}

// App id: required, and must match the id pattern.
{
  const missing = validateWorkflowApp(validApp({ id: undefined }), CTX);
  assert.ok(missing.issues.some((i) => i.code === "workflow-app-id" && i.message === "Workflow app id is required"), "a missing app id is rejected with the exact required message");

  const malformed = validateWorkflowApp(validApp({ id: "Not Valid!" }), CTX);
  assert.ok(malformed.issues.some((i) => i.code === "workflow-app-id" && i.message.includes("malformed")), "an id with spaces/punctuation is rejected as malformed");

  const ok = validateWorkflowApp(validApp({ id: "valid-id.2" }), CTX);
  assert.ok(!ok.issues.some((i) => i.code === "workflow-app-id"), "a dotted/hyphenated lowercase id is accepted");
}

// Title: required non-empty string.
{
  const result = validateWorkflowApp(validApp({ title: "" }), CTX);
  assert.ok(result.issues.some((i) => i.code === "workflow-app-title"), "an empty title is rejected");
  const missing = validateWorkflowApp(validApp({ title: undefined }), CTX);
  assert.ok(missing.issues.some((i) => i.code === "workflow-app-title"), "a missing title is rejected");
}

// Version: must be semver.
{
  for (const bad of ["1.0", "v1.0.0", "not-a-version", "", undefined]) {
    const result = validateWorkflowApp(validApp({ version: bad }), CTX);
    assert.ok(result.issues.some((i) => i.code === "workflow-app-version"), `version ${JSON.stringify(bad)} must be rejected as non-semver`);
  }
  const withPrerelease = validateWorkflowApp(validApp({ version: "1.2.3-beta.1" }), CTX);
  assert.ok(!withPrerelease.issues.some((i) => i.code === "workflow-app-version"), "a semver with a prerelease suffix is accepted");
}

// Workflow field entirely absent: rejected with workflow-app-workflow.
{
  const result = validateWorkflowApp(validApp({ workflow: undefined }), CTX);
  assert.ok(result.issues.some((i) => i.code === "workflow-app-workflow"), "a missing workflow field is rejected");
}

// Workflow as an entrypoint reference (not inline): validated via
// validateEntrypoint, not validateWorkflowDefinition.
{
  const ok = validateWorkflowApp(validApp({ workflow: { entrypoint: "workflow.js" } }), CTX);
  assert.equal(ok.valid, true, "a valid entrypoint-style workflow field validates clean");

  // isWorkflowEntrypoint requires the literal key "entrypoint" to be
  // PRESENT (even if empty) AND "phases" to be absent — a bare `{}` has
  // neither key, so it is instead treated as an (invalid) inline workflow
  // definition, not an entrypoint reference. Use an explicit empty string
  // to land in the entrypoint branch and hit validateEntrypoint's own
  // required-field check.
  const missingEntrypoint = validateWorkflowApp(validApp({ workflow: { entrypoint: "" } }), CTX);
  assert.ok(missingEntrypoint.issues.some((i) => i.code === "workflow-app-entrypoint"), "an entrypoint object with an empty entrypoint string is rejected");
}

// Phase shape: must be a non-empty array; each phase needs a well-formed
// unique id, a name, and a non-empty tasks array.
{
  const noPhasesArray = validateWorkflowApp(validApp({ workflow: { ...workflow({ id: "my-app", title: "My App", phases: [] }) } }), CTX);
  assert.ok(noPhasesArray.issues.some((i) => i.code === "workflow-phases"), "an empty phases array is rejected");

  const badPhaseObject = validateWorkflowApp(
    validApp({ workflow: { ...workflow({ id: "my-app", title: "My App", phases: ["not-an-object"] }) } }),
    CTX
  );
  assert.ok(badPhaseObject.issues.some((i) => i.code === "workflow-phase"), "a non-object phase entry is rejected");

  const noTasks = validateWorkflowApp(validApp({ workflow: workflow({ id: "my-app", title: "My App", phases: [phase("Map", [])] }) }), CTX);
  assert.ok(noTasks.issues.some((i) => i.code === "workflow-phase-tasks"), "a phase with an empty tasks array is rejected");

  const dupPhaseIds = validateWorkflowApp(
    validApp({
      workflow: workflow({
        id: "my-app",
        title: "My App",
        phases: [phase("Map", [agent("t1", "x")]), { ...phase("Map", [agent("t2", "y")]) }],
      }),
    }),
    CTX
  );
  assert.ok(dupPhaseIds.issues.some((i) => i.code === "workflow-phase-duplicate"), "two phases slugifying to the same id are rejected as duplicates");
}

// Task shape: id pattern + uniqueness across the WHOLE workflow (not just
// within one phase), kind must be agent|artifact, prompt required.
{
  const dupAcrossPhases = validateWorkflowApp(
    validApp({
      workflow: workflow({
        id: "my-app",
        title: "My App",
        phases: [phase("Map", [agent("shared-id", "x")]), phase("Assess", [artifact("shared-id", "y")])],
      }),
    }),
    CTX
  );
  assert.ok(dupAcrossPhases.issues.some((i) => i.code === "workflow-task-duplicate"), "a task id reused in a DIFFERENT phase is still rejected as a duplicate");

  const badKind = validateWorkflowApp(
    validApp({ workflow: workflow({ id: "my-app", title: "My App", phases: [phase("Map", [{ id: "t1", kind: "bogus", prompt: "x" }])] }) }),
    CTX
  );
  assert.ok(badKind.issues.some((i) => i.code === "workflow-task-kind"), "a task kind outside agent|artifact is rejected");

  const missingPrompt = validateWorkflowApp(
    validApp({ workflow: workflow({ id: "my-app", title: "My App", phases: [phase("Map", [{ id: "t1", kind: "agent", prompt: "" }])] }) }),
    CTX
  );
  assert.ok(missingPrompt.issues.some((i) => i.code === "workflow-task-prompt"), "a task with an empty prompt is rejected");

  const malformedTaskId = validateWorkflowApp(
    validApp({ workflow: workflow({ id: "my-app", title: "My App", phases: [phase("Map", [{ id: "bad id!", kind: "agent", prompt: "x" }])] }) }),
    CTX
  );
  assert.ok(malformedTaskId.issues.some((i) => i.code === "workflow-task-id"), "a task id with a space is rejected as malformed");
}

// assertValidWorkflowApp: throws WorkflowAppValidationError carrying the
// full issues array; validationIssuesFromError recovers those issues from
// the thrown error (the {valid:false, issues} catch-branch shape).
{
  assert.throws(() => assertValidWorkflowApp({ schemaVersion: 2 }, CTX), WorkflowAppValidationError, "assertValidWorkflowApp throws on an invalid candidate");
  try {
    assertValidWorkflowApp({ schemaVersion: 2 }, CTX);
    assert.fail("must have thrown");
  } catch (error) {
    assert.ok(error instanceof WorkflowAppValidationError);
    assert.ok(error.issues.length > 0, "the thrown error carries a non-empty issues array");
    const recovered = validationIssuesFromError(error);
    assert.equal(recovered, error.issues, "validationIssuesFromError recovers the exact same issues array off a WorkflowAppValidationError");
  }
  // A non-WorkflowAppValidationError still yields a single generic issue,
  // never throws itself.
  const genericIssues = validationIssuesFromError(new Error("boom"));
  assert.deepEqual(genericIssues, [{ code: "workflow-app-invalid", message: "boom" }], "a plain Error is wrapped into one generic issue");
  const nonError = validationIssuesFromError("just a string");
  assert.deepEqual(nonError, [{ code: "workflow-app-invalid", message: "just a string" }], "a non-Error thrown value is stringified into the message");
}

process.stdout.write("formatapps-appschema-validate-manifest: ok\n");
