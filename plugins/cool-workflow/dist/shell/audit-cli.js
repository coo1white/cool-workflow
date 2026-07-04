"use strict";
// shell/audit-cli.ts — CLI/MCP-reachable body for `cw audit verify`.
//
// MILESTONE 8. Byte-exact port of the old build's capability-core.ts's
// `auditVerify`. A run id with no run directory at all is a hard load
// failure (loadRunFromCwd throws) — absence-is-ok only applies once a
// run exists but never wrote a trust-audit chain file, not to a missing
// run entirely.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw audit verify`";
// plugins/cool-workflow/src/capability-core.ts:1223-1249.
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
exports.auditVerifyCli = auditVerifyCli;
exports.auditSummaryCli = auditSummaryCli;
exports.auditMultiAgentCli = auditMultiAgentCli;
exports.auditPolicyCli = auditPolicyCli;
exports.auditJudgeCli = auditJudgeCli;
const path = __importStar(require("node:path"));
const trust_audit_1 = require("./trust-audit");
const run_store_1 = require("./run-store");
const trust_policy_io_1 = require("./trust-policy-io");
function invocationCwd(args) {
    return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}
function auditVerifyCli(runId, args) {
    if (!runId)
        throw new Error("audit verify requires a run id (cw audit verify <run-id>)");
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const v = (0, trust_audit_1.verifyTrustAudit)(run);
    return {
        schemaVersion: 1,
        runId: run.id,
        present: v.present,
        verified: v.verified,
        eventCount: v.eventCount,
        chained: v.chained,
        unchained: v.unchained,
        corruptLines: v.corruptLines,
        failedChecks: v.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code })),
    };
}
/** MILESTONE 11 (reporting/observability, workbench audit panels) —
 *  `cw audit summary`/`audit multi-agent`/`audit policy`/`audit judge`.
 *  These read the same trust-audit summary functions the report.md
 *  writer and multi-agent trust-policy layer already build, so panel
 *  data can never drift from the standalone commands' output. */
function auditSummaryCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, trust_audit_1.summarizeTrustAudit)(run);
}
function auditMultiAgentCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    return (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
}
function auditPolicyCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const summary = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    return { schemaVersion: 1, runId: run.id, rolePolicies: summary.rolePolicies, permissionDecisions: summary.permissionDecisions, policyViolations: summary.policyViolations };
}
function auditJudgeCli(runId, args) {
    const run = (0, run_store_1.loadRunFromCwd)(runId, invocationCwd(args));
    const summary = (0, trust_policy_io_1.summarizeMultiAgentTrust)(run);
    return { schemaVersion: 1, runId: run.id, judgeRationales: summary.judgeRationales, panelDecisions: summary.panelDecisions };
}
