// core/state/contract-migration.ts — declared migration registry + prover.
//
// MILESTONE 3. Byte-exact port of the old build's src/contract-migration.ts
// (renamed target per v2/PLAN.md's module layout note — listed there as
// `pipeline/contract-migration.ts`, kept here under state/ since every
// symbol it needs — RUN_STATE_MIGRATIONS, migrateRunState,
// findMigrationPath — is this milestone's own state kernel and nothing in
// `pipeline/` exists yet). Pure: proofs are sha256-fingerprinted; no
// wall-clock in the payload.
//
// Evidence: SPEC/state-core.md "src/contract-migration.ts — declared
// migration registry + prover", "MigrationVerdict / MigrationProof JSON",
// "Contract-migration prover invariants".

import { stableHash } from "../hash";
import {
  CURRENT_RUN_STATE_SCHEMA_VERSION,
  LEGACY_RUN_STATE_SCHEMA_VERSION,
  MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
  WORKFLOW_APP_SCHEMA_VERSION,
} from "../version";
import { findMigrationPath, migrateRunState, RUN_STATE_MIGRATIONS, StateCompatibilityStatus } from "./migrations";

export const CONTRACT_MIGRATION_SCHEMA_VERSION = 1;

export type MigrationContractId = "run-state" | "workflow-app";

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

const RUN_STATE_EDGES: MigrationEdge[] = RUN_STATE_MIGRATIONS.map((step) => ({
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

export function listMigrationContracts(): MigrationContract[] {
  return [
    {
      contract: "run-state",
      currentVersion: CURRENT_RUN_STATE_SCHEMA_VERSION,
      minVersion: MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
      edges: RUN_STATE_EDGES,
    },
    {
      contract: "workflow-app",
      currentVersion: WORKFLOW_APP_SCHEMA_VERSION,
      minVersion: WORKFLOW_APP_SCHEMA_VERSION,
      edges: [],
    },
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

/** Fail-closed reachability: detected -> current using the DAG path
 *  resolver (run-state) or a simple edge walk (workflow-app). */
export function resolveChain(
  contract: MigrationContract,
  detected: number
): { reachable: boolean; chain: number[]; error?: string } {
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
    const resolved = findMigrationPath(RUN_STATE_MIGRATIONS, detected, contract.currentVersion);
    if (!resolved.reachable) return { reachable: false, chain: [], error: resolved.error };
    const chain = [detected];
    let v = detected;
    for (const step of resolved.path) {
      v = step.reverse ? step.edge.from : step.edge.to;
      chain.push(v);
    }
    return { reachable: true, chain };
  }
  if (contract.edges.length === 0) {
    if (detected === contract.currentVersion) return { reachable: true, chain: [detected] };
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
    chain: resolved.chain,
  };
  if (!resolved.reachable) {
    return { ...base, status: "unsupported", changes: 0, errors: [resolved.error || "unreachable"] };
  }
  if (contractId === "run-state") {
    const { report } = migrateRunState(snapshot, { dryRun: true });
    return { ...base, status: report.status, changes: report.changes.length, errors: report.errors };
  }
  return { ...base, status: "current", changes: 0, errors: [] };
}

/** Append-only proof: every key in the source survives into the output
 *  (recursive). */
function keysSurvive(source: unknown, output: unknown): boolean {
  if (!isRecord(source)) return true;
  if (!isRecord(output)) return false;
  for (const key of Object.keys(source)) {
    if (!(key in output)) return false;
    if (!keysSurvive(source[key], output[key])) return false;
  }
  return true;
}

/** Round-trip / non-destruction prover. Fail-closed: an unsupported
 *  verdict never transforms and never claims a positive proof. */
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
        migrated.report.status !== "unsupported" && isRecord(result) && result.schemaVersion === CURRENT_RUN_STATE_SCHEMA_VERSION;
      appendOnly = keysSurvive(snapshot, result);
      const reRun = migrateRunState(result, { dryRun: true });
      idempotent = reRun.report.changes.length === 0 && reRun.report.status === "current";
    } else {
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
