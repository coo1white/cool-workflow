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

import * as path from "node:path";
import { verifyTrustAudit } from "./trust-audit";
import { loadRunFromCwd } from "./run-store";

export interface AuditVerifyResult {
  schemaVersion: 1;
  runId: string;
  present: boolean;
  verified: boolean;
  eventCount: number;
  chained: number;
  unchained: number;
  corruptLines: number;
  failedChecks: Array<{ name: string; code?: string }>;
}

function invocationCwd(args: Record<string, unknown>): string {
  return typeof args.cwd === "string" && args.cwd.trim() ? path.resolve(args.cwd) : process.cwd();
}

export function auditVerifyCli(runId: string, args: Record<string, unknown>): AuditVerifyResult {
  if (!runId) throw new Error("audit verify requires a run id (cw audit verify <run-id>)");
  const run = loadRunFromCwd(runId, invocationCwd(args));
  const v = verifyTrustAudit(run);
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
