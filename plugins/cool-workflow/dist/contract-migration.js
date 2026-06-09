"use strict";
// Contract Migration Tooling (v0.1.36) — a first-class, declared migration
// subsystem over the existing run-state migration pipeline, extended to the
// workflow-app schema.
//
// BSD discipline:
//  - MECHANISM, not policy: a declared registry of edges per contract is the
//    single source for "what versions exist and how to advance them". The caller
//    names the contract + snapshot; nothing guesses.
//  - FAIL CLOSED ON REACHABILITY [load-bearing]: before transforming, resolve the
//    full chain detected -> CURRENT. Below minimum, above current, or no chained
//    path REFUSES with a named unsupported verdict and NO write — never a
//    best-effort partial migration.
//  - REUSE, don't fork: run-state edges ARE RUN_STATE_MIGRATIONS; the chain runner
//    wraps the existing migrateRunState. No transform logic is duplicated.
//  - APPEND-ONLY / NON-DESTRUCTIVE: the prover proves every source key survives,
//    the result validates at CURRENT, re-running is idempotent, and the source
//    snapshot is byte-immutable (hash-before == hash-after).
//  - DETERMINISTIC: proofs are sha256-fingerprinted; no wall-clock in the payload.
//
// See docs/contract-migration-tooling.7.md.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_MIGRATION_SCHEMA_VERSION = void 0;
exports.listMigrationContracts = listMigrationContracts;
exports.resolveChain = resolveChain;
exports.checkMigration = checkMigration;
exports.proveMigration = proveMigration;
const node_crypto_1 = __importDefault(require("node:crypto"));
const version_1 = require("./version");
const state_migrations_1 = require("./state-migrations");
exports.CONTRACT_MIGRATION_SCHEMA_VERSION = 1;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/** Deterministic, key-sorted, EXACT content hash (not normalized — used to prove
 *  the source snapshot was not mutated). */
function stableHash(value) {
    const sort = (v) => Array.isArray(v)
        ? v.map(sort)
        : isRecord(v)
            ? Object.keys(v)
                .sort()
                .reduce((out, key) => {
                out[key] = sort(v[key]);
                return out;
            }, {})
            : v;
    return `sha256:${node_crypto_1.default.createHash("sha256").update(JSON.stringify(sort(value))).digest("hex")}`;
}
// ---------------------------------------------------------------------------
// The declared registry. run-state edges ARE RUN_STATE_MIGRATIONS (no fork). The
// workflow-app contract is declared with its current version; it has no edges yet
// (only schema 1 exists) — an older app fails closed with a precise reason rather
// than being silently accepted or flatly rejected.
// ---------------------------------------------------------------------------
const RUN_STATE_EDGES = state_migrations_1.RUN_STATE_MIGRATIONS.map((step) => ({
    contract: "run-state",
    from: step.from,
    to: step.to,
    description: step.description,
    proof: {
        invariant: `run-state ${step.from} -> ${step.to}: adds defaults only, drops no existing key`,
        addsDefaulted: ["schemaVersion"],
        dropsNothing: true
    }
}));
function listMigrationContracts() {
    return [
        {
            contract: "run-state",
            currentVersion: version_1.CURRENT_RUN_STATE_SCHEMA_VERSION,
            minVersion: version_1.MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
            edges: RUN_STATE_EDGES
        },
        {
            contract: "workflow-app",
            currentVersion: version_1.WORKFLOW_APP_SCHEMA_VERSION,
            minVersion: version_1.WORKFLOW_APP_SCHEMA_VERSION,
            edges: []
        }
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
/** Fail-closed reachability: detected -> current using the DAG path resolver. */
function resolveChain(contract, detected) {
    if (detected < contract.minVersion) {
        return { reachable: false, chain: [], error: `${contract.contract} schemaVersion ${detected} is below the minimum supported ${contract.minVersion}` };
    }
    if (detected > contract.currentVersion) {
        return { reachable: false, chain: [], error: `${contract.contract} schemaVersion ${detected} is newer than this runtime (${contract.currentVersion})` };
    }
    // Use the run-state migration DAG path resolver when applicable
    if (contract.contract === "run-state") {
        const resolved = (0, state_migrations_1.findMigrationPath)(state_migrations_1.RUN_STATE_MIGRATIONS, detected, contract.currentVersion);
        if (!resolved.reachable)
            return { reachable: false, chain: [], error: resolved.error };
        // Derive the version chain from the path
        const chain = [detected];
        let v = detected;
        for (const step of resolved.path) {
            v = step.reverse ? step.edge.from : step.edge.to;
            chain.push(v);
        }
        return { reachable: true, chain };
    }
    // workflow-app: no edges yet, simple check
    if (contract.edges.length === 0) {
        if (detected === contract.currentVersion)
            return { reachable: true, chain: [detected] };
        return { reachable: false, chain: [], error: `${contract.contract} schemaVersion ${detected} is not current (${contract.currentVersion}) and no migration edges exist` };
    }
    // Generic edge-based chain resolution
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
/** Dry-run verdict: detect, resolve, and (run-state) run the migration to report. */
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
        chain: resolved.chain
    };
    if (!resolved.reachable) {
        return { ...base, status: "unsupported", changes: 0, errors: [resolved.error || "unreachable"] };
    }
    if (contractId === "run-state") {
        const { report } = (0, state_migrations_1.migrateRunState)(snapshot, { dryRun: true });
        return { ...base, status: report.status, changes: report.changes.length, errors: report.errors };
    }
    // workflow-app: reachable + no edges => detected === current.
    return { ...base, status: "current", changes: 0, errors: [] };
}
/** Round-trip / non-destruction prover. Fail-closed: an unsupported verdict never
 *  transforms and never claims a positive proof. */
function proveMigration(contractId, snapshot) {
    const verdict = checkMigration(contractId, snapshot);
    const sourceHash = stableHash(snapshot);
    const errors = [...verdict.errors];
    let validatesAtCurrent = false;
    let appendOnly = false;
    let idempotent = false;
    let result = snapshot;
    if (verdict.status !== "unsupported") {
        if (contractId === "run-state") {
            const migrated = (0, state_migrations_1.migrateRunState)(snapshot);
            result = migrated.run;
            validatesAtCurrent =
                migrated.report.status !== "unsupported" &&
                    isRecord(result) &&
                    result.schemaVersion === version_1.CURRENT_RUN_STATE_SCHEMA_VERSION;
            appendOnly = keysSurvive(snapshot, result);
            const reRun = (0, state_migrations_1.migrateRunState)(result, { dryRun: true });
            idempotent = reRun.report.changes.length === 0 && reRun.report.status === "current";
        }
        else {
            // workflow-app at current: pass-through, nothing to transform.
            validatesAtCurrent = verdict.status === "current";
            appendOnly = true;
            idempotent = true;
        }
    }
    const sourceImmutable = stableHash(snapshot) === sourceHash;
    const resultHash = stableHash(result);
    const pass = validatesAtCurrent && appendOnly && idempotent && sourceImmutable && errors.length === 0;
    const fingerprint = stableHash({
        contract: contractId,
        detectedVersion: verdict.detectedVersion,
        chain: verdict.chain,
        status: verdict.status,
        validatesAtCurrent,
        appendOnly,
        idempotent,
        sourceImmutable,
        sourceHash,
        resultHash
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
        errors
    };
}
/** Append-only proof: every key in the source survives into the output (recursive). */
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
