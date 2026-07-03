// shell/run-export-cli.ts — CLI/MCP-facing entry points for `cw run
// export|import|verify-import|inspect-archive|restore`.
//
// MILESTONE 11 (reporting/observability, run export/bundle). Wires
// shell/run-export.ts into the shapes core/capability-table.ts's CLI/MCP
// bindings call, matching shell/report-cli.ts's pattern.
//
// Evidence: SPEC/reporting-ux.md "Run export / import / restore".

import * as path from "node:path";
import { exportRun, importRun, verifyImportedRun, inspectArchive, ExportResult, ImportResult, RestoreVerificationResult, ArchiveInspectResult } from "./run-export";
import { loadRunFromCwd } from "./run-store";
import { RunRegistry } from "./run-registry-io";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

const SYSTEM_DIRS = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;

/** `cw run export <run-id> [--output|--path|--archive P] [--with-trust-key K] [--cwd P]`. */
export function runExportCli(runId: string, args: Record<string, unknown>): ExportResult {
  const base = invocationCwd(args);
  const run = loadRunFromCwd(runId, base);
  const output = optionalString(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
  const outputPath = path.resolve(base, output);
  if (SYSTEM_DIRS.test(outputPath)) {
    throw new Error(`Refusing to write archive to a system directory: ${output}`);
  }
  const trustKeyArg = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
  return exportRun(run, outputPath, { trustPublicKey: trustKeyArg });
}

/** `cw run import <archive> [--target|--repo|--cwd P]` — prints
 *  ImportResult + `registry` (a repo-registry refresh side effect). */
export function runImportCli(archivePath: string, args: Record<string, unknown>): ImportResult & { registry: unknown } {
  const base = invocationCwd(args);
  const target = optionalString(args.target || args.repo) || base;
  const resolvedArchive = path.resolve(base, archivePath);
  const imported = importRun(resolvedArchive, target);
  const registry = new RunRegistry(target).refresh({ scope: "repo" });
  return { ...imported, registry };
}

/** `cw run verify-import <run-id> [--strict]`. */
export function runVerifyImportCli(runId: string, args: Record<string, unknown>): RestoreVerificationResult {
  const run = loadRunFromCwd(runId, invocationCwd(args));
  return verifyImportedRun(run);
}

/** `cw run inspect-archive <path>` — read-only, never throws. */
export function runInspectArchiveCli(archivePath: string, args: Record<string, unknown>): ArchiveInspectResult {
  const resolved = path.resolve(invocationCwd(args), archivePath);
  return inspectArchive(resolved);
}

export interface RunRestoreResult {
  schemaVersion: 1;
  ok: boolean;
  target: string;
  inspect: ArchiveInspectResult;
  imported: ImportResult["run"] | null;
  verify: RestoreVerificationResult | null;
  registry: unknown | null;
}

/** `cw run restore <path> [--target P]` — fail-closed one step: inspect
 *  (read-only) first, refuse a bad archive with nothing written, then
 *  import, then reuse the import's own verification verdict. */
export function runRestoreCli(archivePath: string, args: Record<string, unknown>): RunRestoreResult {
  const base = invocationCwd(args);
  const target = optionalString(args.target || args.repo) || base;
  const resolvedArchive = path.resolve(base, archivePath);
  const inspect = inspectArchive(resolvedArchive);
  if (!inspect.ok) {
    return { schemaVersion: 1, ok: false, target, inspect, imported: null, verify: null, registry: null };
  }
  const imported = importRun(resolvedArchive, target);
  const registry = new RunRegistry(target).refresh({ scope: "repo" });
  return { schemaVersion: 1, ok: imported.verification.ok, target, inspect, imported: imported.run, verify: imported.verification, registry };
}
