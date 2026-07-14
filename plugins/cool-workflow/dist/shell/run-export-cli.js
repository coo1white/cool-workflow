"use strict";
// shell/run-export-cli.ts — CLI/MCP-facing entry points for `cw run
// export|import|verify-import|inspect-archive|restore`.
//
// MILESTONE 11 (reporting/observability, run export/bundle). Wires
// shell/run-export.ts into the shapes core/capability-table.ts's CLI/MCP
// bindings call, matching shell/report-cli.ts's pattern.
//
// Evidence: SPEC/reporting-ux.md "Run export / import / restore".
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runExportCli = runExportCli;
exports.runImportCli = runImportCli;
exports.runVerifyImportCli = runVerifyImportCli;
exports.runInspectArchiveCli = runInspectArchiveCli;
exports.runRestoreCli = runRestoreCli;
const path = __importStar(require("node:path"));
const run_export_1 = require("./run-export");
const run_store_1 = require("./run-store");
const run_registry_io_1 = require("./run-registry-io");
function optionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
const SYSTEM_DIRS = /^\/(etc|bin|sbin|usr|Library|System|Applications|boot|dev|proc|sys|root|var\/log|var\/run)\//;
/** `cw run export <run-id> [--output|--path|--archive P] [--with-trust-key K] [--cwd P]`. */
function runExportCli(runId, args) {
    const base = invocationCwd(args);
    const run = (0, run_store_1.loadRunFromCwd)(runId, base);
    const output = optionalString(args.output || args.path || args.archive) || `${runId}.cwrun.json`;
    const outputPath = path.resolve(base, output);
    if (SYSTEM_DIRS.test(outputPath)) {
        throw new Error(`Refusing to write archive to a system directory: ${output}`);
    }
    const trustKeyArg = optionalString(args["with-trust-key"] || args.withTrustKey || args.trustKey) || process.env.CW_AGENT_ATTEST_PUBKEY;
    return (0, run_export_1.exportRun)(run, outputPath, { trustPublicKey: trustKeyArg });
}
/** `cw run import <archive> [--target|--repo|--cwd P]` — prints
 *  ImportResult + `registry` (a repo-registry refresh side effect). */
function runImportCli(archivePath, args) {
    const base = invocationCwd(args);
    const target = optionalString(args.target || args.repo) || base;
    const resolvedArchive = path.resolve(base, archivePath);
    const imported = (0, run_export_1.importRun)(resolvedArchive, target);
    const registry = new run_registry_io_1.RunRegistry(target).refresh({ scope: "repo" });
    return { ...imported, registry };
}
/** `cw run verify-import <run-id> [--strict]`. */
function runVerifyImportCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, run_export_1.verifyImportedRun)(run);
}
/** `cw run inspect-archive <path>` — read-only, never throws. */
function runInspectArchiveCli(archivePath, args) {
    const resolved = path.resolve(invocationCwd(args), archivePath);
    return (0, run_export_1.inspectArchive)(resolved);
}
/** `cw run restore <path> [--target P]` — fail-closed one step: inspect
 *  (read-only) first, refuse a bad archive with nothing written, then
 *  import, then reuse the import's own verification verdict. */
function runRestoreCli(archivePath, args) {
    const base = invocationCwd(args);
    const target = optionalString(args.target || args.repo) || base;
    const resolvedArchive = path.resolve(base, archivePath);
    const inspect = (0, run_export_1.inspectArchive)(resolvedArchive);
    if (!inspect.ok) {
        return { schemaVersion: 1, ok: false, target, inspect, imported: null, verify: null, registry: null };
    }
    const restored = (0, run_export_1.restoreRunAtomically)(resolvedArchive, target);
    if (!restored.imported) {
        return { schemaVersion: 1, ok: false, target, inspect, imported: null, verify: restored.verification, registry: null };
    }
    const registry = new run_registry_io_1.RunRegistry(target).refresh({ scope: "repo" });
    return { schemaVersion: 1, ok: true, target, inspect, imported: restored.imported.run, verify: restored.verification, registry };
}
