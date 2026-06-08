"use strict";
// contract-migration-tooling-smoke (v0.1.36). Proves the declared migration
// registry + round-trip prover over a REAL on-disk run-state file:
//   1. the registry declares run-state + workflow-app contracts with edges+proofs.
//   2. a legacy (schemaVersion-less) run-state migrates to current; the prover
//      proves validates-at-current + append-only + idempotent + source-immutable,
//      and the source file on disk is BYTE-UNCHANGED.
//   3. FAIL CLOSED: a newer-than-runtime state is `unsupported` and the prover
//      never claims a positive proof; an older workflow-app (no edge) is
//      `unsupported` with a reason.
//   4. the proof fingerprint is deterministic; prove persists append-only.
//   5. the CLI front door (`cw migration list|check|prove`) works end-to-end.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const cli = path.join(pluginRoot, "dist", "cli.js");
const m = require(path.join(pluginRoot, "dist/contract-migration.js"));

// 1. registry
const contracts = m.listMigrationContracts();
assert.deepEqual(contracts.map((c) => c.contract).sort(), ["run-state", "workflow-app"], "registry declares both contracts");
const runState = contracts.find((c) => c.contract === "run-state");
assert.ok(runState.edges.length >= 1 && runState.edges[0].proof.dropsNothing, "run-state edge carries a dropsNothing proof");

// 2. legacy run-state migrates + prover passes; source byte-immutable
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cw-migration-")));
const stateFile = path.join(tmp, "state.json");
const legacy = { id: "legacy-run", tasks: [{ id: "t1", status: "completed" }], nested: { keep: true } };
fs.writeFileSync(stateFile, JSON.stringify(legacy, null, 2));
const beforeBytes = fs.readFileSync(stateFile);

const verdict = m.checkMigration("run-state", JSON.parse(fs.readFileSync(stateFile, "utf8")));
assert.equal(verdict.status, "migrated", "legacy run-state is migrated");
assert.deepEqual(verdict.chain, [0, 1], "chain is 0 -> 1");

const proof = m.proveMigration("run-state", JSON.parse(fs.readFileSync(stateFile, "utf8")));
assert.equal(proof.pass, true, "prover passes for a legacy migration");
assert.ok(proof.validatesAtCurrent && proof.appendOnly && proof.idempotent && proof.sourceImmutable, "all four properties proven");
assert.ok(beforeBytes.equals(fs.readFileSync(stateFile)), "source state.json is byte-unchanged by check/prove");

// 3. FAIL CLOSED — newer-than-runtime + older workflow-app
const future = m.checkMigration("run-state", { id: "r", schemaVersion: 99 });
assert.equal(future.status, "unsupported", "above-current is unsupported");
assert.equal(future.reachable, false);
assert.equal(m.proveMigration("run-state", { id: "r", schemaVersion: 99 }).pass, false, "prover refuses an unsupported target");
assert.equal(m.checkMigration("workflow-app", { schemaVersion: 0 }).status, "unsupported", "older workflow-app fails closed (no edge)");
assert.equal(m.checkMigration("workflow-app", { schemaVersion: 1 }).status, "current", "current workflow-app is current");

// 4. determinism
assert.equal(
  m.proveMigration("run-state", legacy).fingerprint,
  m.proveMigration("run-state", legacy).fingerprint,
  "proof fingerprint is deterministic"
);

// 5. CLI front door end-to-end
const j = (args) => JSON.parse(cp.execFileSync("node", [cli, ...args], { cwd: tmp, encoding: "utf8" }));
const cliList = j(["migration", "list"]);
assert.equal(cliList.contracts.length, 2, "cw migration list returns the registry");
const cliCheck = j(["migration", "check", stateFile]);
assert.equal(cliCheck.status, "migrated", "cw migration check migrates the legacy file");
const cliProve = j(["migration", "prove", stateFile]);
assert.equal(cliProve.pass, true, "cw migration prove passes");
assert.ok(beforeBytes.equals(fs.readFileSync(stateFile)), "source state.json still byte-unchanged after CLI prove");
assert.ok(fs.existsSync(path.join(tmp, "migration")), "prove persisted an append-only proof beside the target");

fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write("contract-migration-tooling-smoke: ok (declared registry, round-trip prover, fail-closed, byte-immutable source, CLI front door)\n");
