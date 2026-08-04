"use strict";
// core/state/contract-migration.ts — declared migration registry + prover.
//
// MILESTONE 3. Byte-exact port of the old build's src/contract-migration.ts
// (renamed target per plugins/cool-workflow/project/docs/rebuild/PLAN.md's module layout note — listed there as
// `pipeline/contract-migration.ts`, kept here under state/ since every
// symbol it needs — RUN_STATE_MIGRATIONS, migrateRunState,
// findMigrationPath — is this milestone's own state kernel and nothing in
// `pipeline/` exists yet). Pure: proofs are sha256-fingerprinted; no
// wall-clock in the payload.
//
// Evidence: SPEC/state-core.md "src/contract-migration.ts — declared
// migration registry + prover", "MigrationVerdict / MigrationProof JSON",
// "Contract-migration prover invariants".
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_MIGRATION_SCHEMA_VERSION = void 0;
exports.listMigrationContracts = listMigrationContracts;
exports.resolveChain = resolveChain;
exports.checkMigration = checkMigration;
exports.proveMigration = proveMigration;
const hash_1 = require("../hash");
const version_1 = require("../version");
const migrations_1 = require("./migrations");
exports.CONTRACT_MIGRATION_SCHEMA_VERSION = 1;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const RUN_STATE_EDGES = migrations_1.RUN_STATE_MIGRATIONS.map((step) => ({
    contract: "run-state",
    from: step.from,
    to: step.to,
    description: step.description,
    proof: {
        invariant: `run-state ${step.from} -> ${step.to}: adds defaults only, drops no existing key`,
        addsDefaulted: ["schemaVersion"],
        dropsNothing: true,
    },
}));
function listMigrationContracts() {
    return [
        {
            contract: "run-state",
            currentVersion: version_1.CURRENT_RUN_STATE_SCHEMA_VERSION,
            minVersion: version_1.MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
            edges: RUN_STATE_EDGES,
        },
        {
            contract: "workflow-app",
            currentVersion: version_1.WORKFLOW_APP_SCHEMA_VERSION,
            minVersion: version_1.WORKFLOW_APP_SCHEMA_VERSION,
            edges: [],
        },
    ];
}
function getContract(contractId) {
    const contract = listMigrationContracts().find((entry) => entry.contract === contractId);
    if (!contract)
        throw new Error(`Unknown migration contract: ${contractId}`);
    return contract;
}
function detectVersion(contractId, snapshot) {
    const declared = isRecord(snapshot) && typeof snapshot.schemaVersion === "number" ? snapshot.schemaVersion : undefined;
    if (typeof declared === "number")
        return declared;
    return contractId === "run-state" ? version_1.LEGACY_RUN_STATE_SCHEMA_VERSION : 0;
}
/** Fail-closed reachability: detected -> current using the DAG path
 *  resolver (run-state) or a simple edge walk (workflow-app). */
function resolveChain(contract, detected) {
    if (detected < contract.minVersion) {
        return {
            reachable: false,
            chain: [],
            error: `${contract.contract} schemaVersion ${detected} is below the minimum supported ${contract.minVersion}`,
        };
    }
    if (detected > contract.currentVersion) {
        return {
            reachable: false,
            chain: [],
            error: `${contract.contract} schemaVersion ${detected} is newer than this runtime (${contract.currentVersion})`,
        };
    }
    if (contract.contract === "run-state") {
        const resolved = (0, migrations_1.findMigrationPath)(migrations_1.RUN_STATE_MIGRATIONS, detected, contract.currentVersion);
        if (!resolved.reachable)
            return { reachable: false, chain: [], error: resolved.error };
        const chain = [detected];
        let v = detected;
        for (const step of resolved.path) {
            v = step.reverse ? step.edge.from : step.edge.to;
            chain.push(v);
        }
        return { reachable: true, chain };
    }
    if (contract.edges.length === 0) {
        if (detected === contract.currentVersion)
            return { reachable: true, chain: [detected] };
        return {
            reachable: false,
            chain: [],
            error: `${contract.contract} schemaVersion ${detected} is not current (${contract.currentVersion}) and no migration edges exist`,
        };
    }
    const chain = [detected];
    let version = detected;
    while (version < contract.currentVersion) {
        const edge = contract.edges.find((candidate) => candidate.from === version);
        if (!edge) {
            return { reachable: false, chain, error: `no migration edge from ${contract.contract} schemaVersion ${version}` };
        }
        version = edge.to;
        chain.push(version);
    }
    return { reachable: true, chain };
}
/** Dry-run verdict: detect, resolve, and (run-state) run the migration to
 *  report. */
function checkMigration(contractId, snapshot) {
    const contract = getContract(contractId);
    const detectedVersion = detectVersion(contractId, snapshot);
    const resolved = resolveChain(contract, detectedVersion);
    const base = {
        schemaVersion: 1,
        contract: contractId,
        detectedVersion,
        currentVersion: contract.currentVersion,
        reachable: resolved.reachable,
        chain: resolved.chain,
    };
    if (!resolved.reachable) {
        return { ...base, status: "unsupported", changes: 0, errors: [resolved.error || "unreachable"] };
    }
    if (contractId === "run-state") {
        const { report } = (0, migrations_1.migrateRunState)(snapshot, { dryRun: true });
        return { ...base, status: report.status, changes: report.changes.length, errors: report.errors };
    }
    return { ...base, status: "current", changes: 0, errors: [] };
}
/** Append-only proof: every key in the source survives into the output
 *  (recursive). */
function keysSurvive(source, output) {
    if (!isRecord(source))
        return true;
    if (!isRecord(output))
        return false;
    for (const key of Object.keys(source)) {
        if (!(key in output))
            return false;
        if (!keysSurvive(source[key], output[key]))
            return false;
    }
    return true;
}
/** Round-trip / non-destruction prover. Fail-closed: an unsupported
 *  verdict never transforms and never claims a positive proof. */
function proveMigration(contractId, snapshot) {
    const verdict = checkMigration(contractId, snapshot);
    const sourceHash = (0, hash_1.stableHash)(snapshot);
    const errors = [...verdict.errors];
    let validatesAtCurrent = false;
    let appendOnly = false;
    let idempotent = false;
    let result = snapshot;
    if (verdict.status !== "unsupported") {
        if (contractId === "run-state") {
            const migrated = (0, migrations_1.migrateRunState)(snapshot);
            result = migrated.run;
            validatesAtCurrent =
                migrated.report.status !== "unsupported" && isRecord(result) && result.schemaVersion === version_1.CURRENT_RUN_STATE_SCHEMA_VERSION;
            appendOnly = keysSurvive(snapshot, result);
            const reRun = (0, migrations_1.migrateRunState)(result, { dryRun: true });
            idempotent = reRun.report.changes.length === 0 && reRun.report.status === "current";
        }
        else {
            validatesAtCurrent = verdict.status === "current";
            appendOnly = true;
            idempotent = true;
        }
    }
    const sourceImmutable = (0, hash_1.stableHash)(snapshot) === sourceHash;
    const resultHash = (0, hash_1.stableHash)(result);
    const pass = validatesAtCurrent && appendOnly && idempotent && sourceImmutable && errors.length === 0;
    const fingerprint = (0, hash_1.stableHash)({
        contract: contractId,
        detectedVersion: verdict.detectedVersion,
        chain: verdict.chain,
        status: verdict.status,
        validatesAtCurrent,
        appendOnly,
        idempotent,
        sourceImmutable,
        sourceHash,
        resultHash,
    });
    return {
        schemaVersion: 1,
        contract: contractId,
        verdict,
        validatesAtCurrent,
        appendOnly,
        idempotent,
        sourceImmutable,
        pass,
        sourceHash,
        resultHash,
        fingerprint,
        errors,
    };
}
