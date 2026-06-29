"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrationList = migrationList;
exports.migrationCheck = migrationCheck;
exports.migrationProve = migrationProve;
exports.loadMigrationSnapshot = loadMigrationSnapshot;
// Contract-migration domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner; pure functions (no instance state). Behavior
// is identical to the inline versions.
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const state_1 = require("../state");
const contract_migration_1 = require("../contract-migration");
function migrationList() {
    return { contracts: (0, contract_migration_1.listMigrationContracts)() };
}
function migrationCheck(target, options = {}) {
    const { snapshot, contract } = loadMigrationSnapshot(target, options);
    return (0, contract_migration_1.checkMigration)(contract, snapshot);
}
function migrationProve(target, options = {}) {
    const { snapshot, contract, dir } = loadMigrationSnapshot(target, options);
    const proof = (0, contract_migration_1.proveMigration)(contract, snapshot);
    // Append-only: persist the proof beside the target, NEVER overwriting source.
    try {
        (0, state_1.writeJson)(node_path_1.default.join(dir, "migration", `${proof.fingerprint.replace("sha256:", "").slice(0, 16)}.json`), proof);
    }
    catch {
        /* read-only target — the proof is still returned */
    }
    return proof;
}
function loadMigrationSnapshot(target, options) {
    const contract = options.contract === "workflow-app" ? "workflow-app" : "run-state";
    const file = node_fs_1.default.existsSync(target) && node_fs_1.default.statSync(target).isFile()
        ? node_path_1.default.resolve(target)
        : node_path_1.default.join(process.cwd(), ".cw", "runs", target, "state.json");
    if (!node_fs_1.default.existsSync(file))
        throw new Error(`Migration target not found: ${target}`);
    return { snapshot: (0, state_1.readJson)(file), contract, dir: node_path_1.default.dirname(file) };
}
