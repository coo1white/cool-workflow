#!/usr/bin/env node
// statecore-upsert-run-contract (milestone 3) — pins upsertRunContract:
// validates before upserting, replaces an existing contract by id (map,
// not in-place mutation of the array like appendRunNode), appends a new
// one. SPEC/state-core.md "upsertRunContract(run, contract) — validates
// then upserts into run.contracts".

const assert = require("node:assert/strict");
const { upsertRunContract, PipelineContractError } = require("../dist/core/state/state-node");

function validContract(id, title) {
  return {
    schemaVersion: 1,
    id,
    title: title || id,
    stages: [
      { id: "s1", name: "S1", acceptedInputKinds: ["task"], acceptedInputStatuses: ["pending"], producedOutputKind: "result" },
    ],
    compatibility: { minSchemaVersion: 1, maxSchemaVersion: 1 },
  };
}

// A new contract (run.contracts starts empty/undefined) is appended.
{
  const run = { id: "r1" };
  const contract = validContract("c1");
  const returned = upsertRunContract(run, contract);
  assert.equal(returned, contract, "upsertRunContract must return the contract it was given");
  assert.deepEqual(run.contracts, [contract]);
}

// An existing contract (same id) is REPLACED, not duplicated.
{
  const run = { id: "r1", contracts: [validContract("c1", "Old Title")] };
  const updated = validContract("c1", "New Title");
  upsertRunContract(run, updated);
  assert.equal(run.contracts.length, 1, "an update must not add a second entry");
  assert.equal(run.contracts[0].title, "New Title");
}

// Multiple distinct contracts coexist; updating one leaves the others
// untouched.
{
  const run = { id: "r1", contracts: [validContract("c1"), validContract("c2")] };
  upsertRunContract(run, validContract("c1", "Updated"));
  assert.equal(run.contracts.length, 2);
  assert.equal(run.contracts.find((c) => c.id === "c1").title, "Updated");
  assert.equal(run.contracts.find((c) => c.id === "c2").title, "c2");
}

// An invalid contract throws BEFORE touching run.contracts at all.
{
  const run = { id: "r1", contracts: [] };
  const invalid = { schemaVersion: 1, id: "", title: "x", stages: [], compatibility: { minSchemaVersion: 1, maxSchemaVersion: 1 } };
  assert.throws(() => upsertRunContract(run, invalid), PipelineContractError);
  assert.deepEqual(run.contracts, [], "run.contracts must be untouched when validation fails");
}

process.stdout.write("statecore-upsert-run-contract: ok\n");
