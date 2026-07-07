#!/usr/bin/env node
// statecore-validate-pipeline-contract (milestone 3) — pins
// validatePipelineContract's error codes from SPEC/state-core.md
// "PipelineContractError codes (error.structured.code)": invalid-contract-
// schema, invalid-contract-id, invalid-contract-title, invalid-contract-
// stages, invalid-contract-compatibility, incompatible-contract, plus the
// per-stage codes (invalid-contract-stage-id, duplicate-contract-stage,
// invalid-contract-stage-name, invalid-contract-stage-kinds, invalid-
// contract-stage-statuses, invalid-contract-stage-output).

const assert = require("node:assert/strict");
const { validatePipelineContract, PipelineContractError } = require("../dist/core/state/state-node");

function baseContract(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "default-contract",
    title: "Default Contract",
    stages: [
      {
        id: "stage-1",
        name: "Stage One",
        acceptedInputKinds: ["task"],
        acceptedInputStatuses: ["pending"],
        producedOutputKind: "result",
      },
    ],
    compatibility: { minSchemaVersion: 1, maxSchemaVersion: 1 },
    ...overrides,
  };
}

function codeOf(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    assert.ok(err instanceof PipelineContractError, "must throw PipelineContractError");
    return err.structured.code;
  }
}

// A well-formed contract validates with no throw.
{
  assert.doesNotThrow(() => validatePipelineContract(baseContract()));
}

// invalid-contract-schema: wrong schemaVersion.
{
  const code = codeOf(() => validatePipelineContract(baseContract({ schemaVersion: 2 })));
  assert.equal(code, "invalid-contract-schema");
}

// invalid-contract-id: missing id.
{
  const code = codeOf(() => validatePipelineContract(baseContract({ id: "" })));
  assert.equal(code, "invalid-contract-id");
}

// invalid-contract-title: missing title.
{
  const code = codeOf(() => validatePipelineContract(baseContract({ title: "" })));
  assert.equal(code, "invalid-contract-title");
}

// invalid-contract-stages: empty stages array.
{
  const code = codeOf(() => validatePipelineContract(baseContract({ stages: [] })));
  assert.equal(code, "invalid-contract-stages");
}
{
  const code = codeOf(() => validatePipelineContract(baseContract({ stages: undefined })));
  assert.equal(code, "invalid-contract-stages", "a non-array stages must also fail invalid-contract-stages");
}

// invalid-contract-compatibility: missing compatibility.
{
  const code = codeOf(() => validatePipelineContract(baseContract({ compatibility: undefined })));
  assert.equal(code, "invalid-contract-compatibility");
}

// incompatible-contract: compatibility.minSchemaVersion above the current
// StateNode schema version (1).
{
  const code = codeOf(() =>
    validatePipelineContract(baseContract({ compatibility: { minSchemaVersion: 2, maxSchemaVersion: 2 } }))
  );
  assert.equal(code, "incompatible-contract");
}

// invalid-contract-stage-id: a stage without id.
{
  const code = codeOf(() =>
    validatePipelineContract(
      baseContract({
        stages: [{ name: "no id", acceptedInputKinds: ["task"], acceptedInputStatuses: ["pending"], producedOutputKind: "result" }],
      })
    )
  );
  assert.equal(code, "invalid-contract-stage-id");
}

// duplicate-contract-stage: two stages sharing an id.
{
  const stage = { id: "dup", name: "Dup", acceptedInputKinds: ["task"], acceptedInputStatuses: ["pending"], producedOutputKind: "result" };
  const code = codeOf(() => validatePipelineContract(baseContract({ stages: [stage, { ...stage }] })));
  assert.equal(code, "duplicate-contract-stage");
}

// invalid-contract-stage-name: a stage without name.
{
  const code = codeOf(() =>
    validatePipelineContract(
      baseContract({
        stages: [{ id: "s1", acceptedInputKinds: ["task"], acceptedInputStatuses: ["pending"], producedOutputKind: "result" }],
      })
    )
  );
  assert.equal(code, "invalid-contract-stage-name");
}

// invalid-contract-stage-kinds: empty/missing acceptedInputKinds.
{
  const code = codeOf(() =>
    validatePipelineContract(
      baseContract({ stages: [{ id: "s1", name: "S1", acceptedInputKinds: [], acceptedInputStatuses: ["pending"], producedOutputKind: "result" }] })
    )
  );
  assert.equal(code, "invalid-contract-stage-kinds");
}

// invalid-contract-stage-statuses: empty/missing acceptedInputStatuses.
{
  const code = codeOf(() =>
    validatePipelineContract(
      baseContract({ stages: [{ id: "s1", name: "S1", acceptedInputKinds: ["task"], acceptedInputStatuses: [], producedOutputKind: "result" }] })
    )
  );
  assert.equal(code, "invalid-contract-stage-statuses");
}

// invalid-contract-stage-output: missing producedOutputKind.
{
  const code = codeOf(() =>
    validatePipelineContract(
      baseContract({ stages: [{ id: "s1", name: "S1", acceptedInputKinds: ["task"], acceptedInputStatuses: ["pending"] }] })
    )
  );
  assert.equal(code, "invalid-contract-stage-output");
}

// Per-stage checks run in declared order — a stage missing BOTH name and
// kinds reports invalid-contract-stage-name FIRST (name is checked before
// kinds in validateStage).
{
  const code = codeOf(() =>
    validatePipelineContract(
      baseContract({ stages: [{ id: "s1", acceptedInputKinds: [], acceptedInputStatuses: [], producedOutputKind: undefined }] })
    )
  );
  assert.equal(code, "invalid-contract-stage-name", "name check must fire before kinds/statuses/output checks");
}

process.stdout.write("statecore-validate-pipeline-contract: ok\n");
