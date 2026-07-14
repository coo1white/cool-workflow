"use strict";
// shell/metrics-cli.ts — CLI/MCP-facing entry points for `cw metrics
// show`/`cw metrics summary`.
//
// MILESTONE 11 (reporting/observability). Wires shell/observability.ts
// into the shapes core/capability-table.ts's CLI/MCP bindings call.
//
// Evidence: SPEC/reporting-ux.md "cw metrics show" / "cw metrics
// summary".
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
exports.metricsShowCli = metricsShowCli;
exports.metricsSummaryCli = metricsSummaryCli;
const path = __importStar(require("node:path"));
const numeric_flag_1 = require("../core/util/numeric-flag");
const run_store_1 = require("./run-store");
const observability_1 = require("./observability");
const run_registry_io_1 = require("./run-registry-io");
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function pluginRoot() {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, "plugins", "cool-workflow");
        if (require("node:fs").existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return process.cwd();
}
function nowOf(args) {
    return typeof args.now === "string" && args.now.trim() ? args.now : new Date().toISOString();
}
/** `cw metrics show <run-id> [--json] [--pricing ...] [--now ISO]`. */
function metricsShowCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const policy = (0, observability_1.loadCostPolicy)(args, pluginRoot());
    return (0, observability_1.showMetricsReport)(run, { now: nowOf(args), policy, persist: args.__cwWorkbenchReadOnlyProjection !== true });
}
/** `cw metrics summary [--scope repo|home] [--pricing ...] [--now ISO] [--limit N]`.
 *  `--limit` defaults to RunRegistry.list()'s own 50-record floor when omitted. */
function metricsSummaryCli(args) {
    const cwd = invocationCwd(args);
    const scope = args.scope === "home" ? "home" : "repo";
    const registry = new run_registry_io_1.RunRegistry(cwd);
    const limit = (0, numeric_flag_1.requiredNumberFlag)(args.limit, "--limit");
    const listing = registry.list({ scope, includeArchived: true, limit });
    const inputs = [];
    let unreadableRuns = 0;
    for (const record of listing.records) {
        try {
            const result = (0, run_store_1.loadRunStateFile)(record.statePath, { dryRun: true });
            if (result.report.status === "unsupported") {
                unreadableRuns++;
                continue;
            }
            inputs.push({ run: result.run, repo: record.repo, persistedFingerprint: (0, observability_1.loadPersistedMetricsFingerprint)(result.run) });
        }
        catch {
            unreadableRuns++;
        }
    }
    const policy = (0, observability_1.loadCostPolicy)(args, pluginRoot());
    return (0, observability_1.deriveMetricsSummary)(inputs, { now: nowOf(args), scope, policy, unreadableRuns });
}
