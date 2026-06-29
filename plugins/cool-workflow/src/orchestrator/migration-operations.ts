// Contract-migration domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner; pure functions (no instance state). Behavior
// is identical to the inline versions.
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../state";
import { listMigrationContracts, checkMigration, proveMigration, MigrationContractId } from "../contract-migration";

export function migrationList(): { contracts: ReturnType<typeof listMigrationContracts> } {
  return { contracts: listMigrationContracts() };
}

export function migrationCheck(target: string, options: Record<string, unknown> = {}): ReturnType<typeof checkMigration> {
  const { snapshot, contract } = loadMigrationSnapshot(target, options);
  return checkMigration(contract, snapshot);
}

export function migrationProve(target: string, options: Record<string, unknown> = {}): ReturnType<typeof proveMigration> {
  const { snapshot, contract, dir } = loadMigrationSnapshot(target, options);
  const proof = proveMigration(contract, snapshot);
  // Append-only: persist the proof beside the target, NEVER overwriting source.
  try {
    writeJson(path.join(dir, "migration", `${proof.fingerprint.replace("sha256:", "").slice(0, 16)}.json`), proof);
  } catch {
    /* read-only target — the proof is still returned */
  }
  return proof;
}

export function loadMigrationSnapshot(target: string, options: Record<string, unknown>): { snapshot: unknown; contract: MigrationContractId; dir: string } {
  const contract: MigrationContractId = options.contract === "workflow-app" ? "workflow-app" : "run-state";
  const file =
    fs.existsSync(target) && fs.statSync(target).isFile()
      ? path.resolve(target)
      : path.join(process.cwd(), ".cw", "runs", target, "state.json");
  if (!fs.existsSync(file)) throw new Error(`Migration target not found: ${target}`);
  return { snapshot: readJson(file), contract, dir: path.dirname(file) };
}
