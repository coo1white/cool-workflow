// shell/run-export-cli.ts — CLI/MCP-facing entry points for `cw run
// export|import|verify-import|inspect-archive|restore`.
//
// Wires shell/run-export.ts into the shapes core/capability-table.ts's
// CLI/MCP bindings call, matching shell/report-cli.ts's pattern.
//
// Evidence: SPEC/reporting-ux.md "Run export / import / restore".
import * as path from "node:path";
import { cwdArg, optionalArg } from "../core/util/cli-args.js";
import { exportRun, importRun, restoreRunAtomically, verifyImportedRun, inspectArchive } from "./run-export.js";
import { loadRunFromCwd } from "./run-store.js";
import { RunRegistry } from "./run-registry-io.js";
const SYSTEM_DIRS = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;
/** `cw run export <run-id> [--output|--path|--archive P] [--with-trust-key K] [--cwd P]`. */
export function runExportCli(runId, args) {
    const base = cwdArg(args);
    const run = loadRunFromCwd(runId, base);
    const output = optionalArg(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
    const outputPath = path.resolve(base, output);
    if (SYSTEM_DIRS.test(outputPath)) {
        throw new Error(`Refusing to write archive to a system directory: ${output}`);
    }
    const trustKeyArg = optionalArg(args["with-trust-key"] || args.withTrustKey || args.trustKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    return exportRun(run, outputPath, { trustPublicKey: trustKeyArg });
}
/** `cw run import <archive> [--target|--repo|--cwd P]` — prints
 *  ImportResult + `registry` (a repo-registry refresh side effect). */
export function runImportCli(archivePath, args) {
    const base = cwdArg(args);
    const target = optionalArg(args.target || args.repo) || base;
    const resolvedArchive = path.resolve(base, archivePath);
    const imported = importRun(resolvedArchive, target);
    const registry = new RunRegistry(target).refresh({ scope: "repo" });
    return { ...imported, registry };
}
/** `cw run verify-import <run-id> [--strict]`. */
export function runVerifyImportCli(runId, args) {
    const run = loadRunFromCwd(runId, cwdArg(args));
    return verifyImportedRun(run);
}
/** `cw run inspect-archive <path>` — read-only, never throws. */
export function runInspectArchiveCli(archivePath, args) {
    const resolved = path.resolve(cwdArg(args), archivePath);
    return inspectArchive(resolved);
}
/** `cw run restore <path> [--target P]` — fail-closed one step: inspect
 *  (read-only) first, refuse a bad archive with nothing written, then
 *  import, then reuse the import's own verification verdict. */
export function runRestoreCli(archivePath, args) {
    const base = cwdArg(args);
    const target = optionalArg(args.target || args.repo) || base;
    const resolvedArchive = path.resolve(base, archivePath);
    const inspect = inspectArchive(resolvedArchive);
    if (!inspect.ok) {
        return { schemaVersion: 1, ok: false, target, inspect, imported: null, verify: null, registry: null };
    }
    const restored = restoreRunAtomically(resolvedArchive, target);
    if (!restored.imported) {
        return { schemaVersion: 1, ok: false, target, inspect, imported: null, verify: restored.verification, registry: null };
    }
    const registry = new RunRegistry(target).refresh({ scope: "repo" });
    return { schemaVersion: 1, ok: true, target, inspect, imported: restored.imported.run, verify: restored.verification, registry };
}
