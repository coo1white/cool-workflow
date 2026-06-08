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

import crypto from "node:crypto";
import {
  CURRENT_RUN_STATE_SCHEMA_VERSION,
  LEGACY_RUN_STATE_SCHEMA_VERSION,
  MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
  WORKFLOW_APP_SCHEMA_VERSION
} from "./version";
import { RUN_STATE_MIGRATIONS, migrateRunState, StateCompatibilityStatus } from "./state-migrations";

export const CONTRACT_MIGRATION_SCHEMA_VERSION = 1;

export type MigrationContractId = "run-state" | "workflow-app";

/** Mechanically-checkable compatibility proof for one edge (data, not prose). */
export interface MigrationCompatibilityProof {
  invariant: string;
  addsDefaulted: string[];
  dropsNothing: boolean;
}

export interface MigrationEdge {
  contract: MigrationContractId;
  from: number;
  to: number;
  description: string;
  proof: MigrationCompatibilityProof;
}

export interface MigrationContract {
  contract: MigrationContractId;
  currentVersion: number;
  minVersion: number;
  edges: MigrationEdge[];
}

export interface MigrationVerdict {
  schemaVersion: 1;
  contract: MigrationContractId;
  status: StateCompatibilityStatus;
  detectedVersion: number;
  currentVersion: number;
  reachable: boolean;
  chain: number[];
  changes: number;
  errors: string[];
}

export interface MigrationProof {
  schemaVersion: 1;
  contract: MigrationContractId;
  verdict: MigrationVerdict;
  validatesAtCurrent: boolean;
  appendOnly: boolean;
  idempotent: boolean;
  sourceImmutable: boolean;
  pass: boolean;
  sourceHash: string;
  resultHash: string;
  fingerprint: string;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Deterministic, key-sorted, EXACT content hash (not normalized — used to prove
 *  the source snapshot was not mutated). */
function stableHash(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : isRecord(v)
        ? Object.keys(v)
            .sort()
            .reduce((out: Record<string, unknown>, key) => {
              out[key] = sort(v[key]);
              return out;
            }, {})
        : v;
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(sort(value))).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// The declared registry. run-state edges ARE RUN_STATE_MIGRATIONS (no fork). The
// workflow-app contract is declared with its current version; it has no edges yet
// (only schema 1 exists) — an older app fails closed with a precise reason rather
// than being silently accepted or flatly rejected.
// ---------------------------------------------------------------------------

const RUN_STATE_EDGES: MigrationEdge[] = RUN_STATE_MIGRATIONS.map((step) => ({
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

export function listMigrationContracts(): MigrationContract[] {
  return [
    {
      contract: "run-state",
      currentVersion: CURRENT_RUN_STATE_SCHEMA_VERSION,
      minVersion: MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
      edges: RUN_STATE_EDGES
    },
    {
      contract: "workflow-app",
      currentVersion: WORKFLOW_APP_SCHEMA_VERSION,
      minVersion: WORKFLOW_APP_SCHEMA_VERSION,
      edges: []
    }
  ];
}

function getContract(contractId: MigrationContractId): MigrationContract {
  const contract = listMigrationContracts().find((entry) => entry.contract === contractId);
  if (!contract) throw new Error(`Unknown migration contract: ${contractId}`);
  return contract;
}

function detectVersion(contractId: MigrationContractId, snapshot: unknown): number {
  const declared = isRecord(snapshot) && typeof snapshot.schemaVersion === "number" ? snapshot.schemaVersion : undefined;
  if (typeof declared === "number") return declared;
  return contractId === "run-state" ? LEGACY_RUN_STATE_SCHEMA_VERSION : 0;
}

/** Fail-closed reachability: detected -> current, or a named refusal with no write. */
export function resolveChain(contract: MigrationContract, detected: number): { reachable: boolean; chain: number[]; error?: string } {
  if (detected < contract.minVersion) {
    return { reachable: false, chain: [], error: `${contract.contract} schemaVersion ${detected} is below the minimum supported ${contract.minVersion}` };
  }
  if (detected > contract.currentVersion) {
    return { reachable: false, chain: [], error: `${contract.contract} schemaVersion ${detected} is newer than this runtime (${contract.currentVersion})` };
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

/** Dry-run verdict: detect, resolve, and (run-state) run the migration to report. */
export function checkMigration(contractId: MigrationContractId, snapshot: unknown): MigrationVerdict {
  const contract = getContract(contractId);
  const detectedVersion = detectVersion(contractId, snapshot);
  const resolved = resolveChain(contract, detectedVersion);
  const base = {
    schemaVersion: 1 as const,
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
    const { report } = migrateRunState(snapshot, { dryRun: true });
    return { ...base, status: report.status, changes: report.changes.length, errors: report.errors };
  }
  // workflow-app: reachable + no edges => detected === current.
  return { ...base, status: "current", changes: 0, errors: [] };
}

/** Round-trip / non-destruction prover. Fail-closed: an unsupported verdict never
 *  transforms and never claims a positive proof. */
export function proveMigration(contractId: MigrationContractId, snapshot: unknown): MigrationProof {
  const verdict = checkMigration(contractId, snapshot);
  const sourceHash = stableHash(snapshot);
  const errors = [...verdict.errors];

  let validatesAtCurrent = false;
  let appendOnly = false;
  let idempotent = false;
  let result: unknown = snapshot;

  if (verdict.status !== "unsupported") {
    if (contractId === "run-state") {
      const migrated = migrateRunState(snapshot);
      result = migrated.run;
      validatesAtCurrent =
        migrated.report.status !== "unsupported" &&
        isRecord(result) &&
        result.schemaVersion === CURRENT_RUN_STATE_SCHEMA_VERSION;
      appendOnly = keysSurvive(snapshot, result);
      const reRun = migrateRunState(result, { dryRun: true });
      idempotent = reRun.report.changes.length === 0 && reRun.report.status === "current";
    } else {
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
function keysSurvive(source: unknown, output: unknown): boolean {
  if (!isRecord(source)) return true;
  if (!isRecord(output)) return false;
  for (const key of Object.keys(source)) {
    if (!(key in output)) return false;
    if (!keysSurvive(source[key], output[key])) return false;
  }
  return true;
}
