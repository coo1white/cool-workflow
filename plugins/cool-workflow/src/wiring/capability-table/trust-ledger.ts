// wiring/capability-table/trust-ledger.ts — MILESTONE 8 (ledger, telemetry,
// trust-audit, tamper/bundle demos) CLI bindings: ledger.*, telemetry.verify,
// audit.verify, audit.head, demo.*, report.bundle/verify-bundle. Split out
// of core/capability-table.ts, byte-for-byte (extracted with sed, not
// retyped).

import { attachCliBinding, addCliOnlyCapability, REGISTRY_BY_CAPABILITY } from "./registry-core";
import { required, optionalArg } from "../../cli/io";

// MILESTONE 8 (ledger, telemetry, trust-audit, tamper/bundle demos) CLI
// bindings: ledger propose|review|verify|apply|list, telemetry verify,
// audit verify, demo tamper|bundle, report bundle|verify-bundle. Handler
// BODIES live in shell/ledger-cli.ts, shell/telemetry-cli.ts, shell/
// audit-cli.ts, shell/demo-cli.ts, shell/report-cli.ts (impure — file/
// stdin reads, run-state loads, archive IO); this table only wires argv
// shape -> handler call, per cli/dispatch.ts's generic executor
// contract. `ledger` is intentionally absent from KNOWN_COMMANDS (see
// cli/parseargv.ts) even though dispatchTable now handles it as a real
// row — a known, preserved wart.
// ---------------------------------------------------------------------

import {
  ledgerApplyCli,
  ledgerApplyEntry,
  ledgerListCli,
  ledgerListMcp,
  ledgerProposeCli,
  ledgerProposeMcp,
  ledgerReviewCli,
  ledgerReviewMcp,
  ledgerVerifyCli,
  ledgerVerifyEntry,
} from "../../shell/ledger-cli";
import { telemetryVerifyCli } from "../../shell/telemetry-cli";
import { auditHeadCli, auditVerifyCli } from "../../shell/audit-cli";
import { demoBundleCli, demoTamperCli } from "../../shell/demo-cli";
import { formatTamperDemo, formatBundleDemo, formatTelemetryVerify } from "../../shell/telemetry-demo";
import { reportBundleCli, reportVerifyBundleCli } from "../../shell/report-cli";

attachCliBinding("ledger.propose", {
  path: ["ledger", "propose"],
  jsonMode: "default",
  handler: (args) => ({ json: ledgerProposeCli(args.options) }),
});
REGISTRY_BY_CAPABILITY.get("ledger.propose")!.mcp!.handler = (args) => ledgerProposeMcp(args);

attachCliBinding("ledger.review", {
  path: ["ledger", "review"],
  jsonMode: "default",
  handler: (args) => ({ json: ledgerReviewCli(args.options) }),
});
REGISTRY_BY_CAPABILITY.get("ledger.review")!.mcp!.handler = (args) => ledgerReviewMcp(args);

attachCliBinding("ledger.verify", {
  path: ["ledger", "verify"],
  jsonMode: "default",
  handler: (args) => {
    const result = ledgerVerifyCli(args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("ledger.verify")!.mcp!.handler = (args) => ledgerVerifyEntry(args.entry);

attachCliBinding("ledger.apply", {
  path: ["ledger", "apply"],
  jsonMode: "default",
  handler: (args) => {
    const result = ledgerApplyCli(args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("ledger.apply")!.mcp!.handler = (args) => ledgerApplyEntry(args.entry);

attachCliBinding("ledger.list", {
  path: ["ledger", "list"],
  jsonMode: "default",
  handler: (args) => {
    const result = ledgerListCli(args.options);
    return { json: result, exitCode: result.allOk ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("ledger.list")!.mcp!.handler = (args) => ledgerListMcp(args);

attachCliBinding("telemetry.verify", {
  path: ["telemetry", "verify"],
  jsonMode: "flag",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]) || optionalArg(args.options.runId) || optionalArg(args.options.run), "run id");
    const result = telemetryVerifyCli(runId, args.options);
    return { json: result, text: formatTelemetryVerify(result), exitCode: result.verified ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("telemetry.verify")!.mcp!.handler = (args) =>
  telemetryVerifyCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.verify", {
  path: ["audit", "verify"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const result = auditVerifyCli(runId, args.options);
    return { json: result, exitCode: result.verified ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("audit.verify")!.mcp!.handler = (args) =>
  auditVerifyCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("audit.head", {
  path: ["audit", "head"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    return { json: auditHeadCli(runId, args.options) };
  },
});
REGISTRY_BY_CAPABILITY.get("audit.head")!.mcp!.handler = (args) =>
  auditHeadCli(required(optionalArg(args.runId), "run id"), args);

addCliOnlyCapability(
  "demo.tamper",
  "Prove tamper-evidence: build a signed telemetry ledger, forge it, watch verification fail offline.",
  {
    path: ["demo", "tamper"],
    jsonMode: "flag",
    handler: (args) => {
      const result = demoTamperCli();
      return { json: result, text: formatTamperDemo(result), exitCode: result.proven ? undefined : 1 };
    },
  },
  "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo."
);

addCliOnlyCapability(
  "demo.bundle",
  "Prove portable-bundle verification: export a sealed report bundle, forge it two ways, watch report verify-bundle catch both offline with only the embedded public key.",
  {
    path: ["demo", "bundle"],
    jsonMode: "flag",
    handler: (args) => {
      const result = demoBundleCli();
      return { json: result, text: formatBundleDemo(result), exitCode: result.proven ? undefined : 1 };
    },
  },
  "Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface report.verify-bundle. No agent or MCP client needs to invoke a demo."
);

attachCliBinding("report.bundle", {
  path: ["report", "bundle"],
  jsonMode: "default",
  handler: (args) => {
    const runId = required(optionalArg(args.positionals[0]), "run id");
    const result = reportBundleCli(runId, args.options);
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("report.bundle")!.mcp!.handler = (args) =>
  reportBundleCli(required(optionalArg(args.runId), "run id"), args);

attachCliBinding("report.verify-bundle", {
  path: ["report", "verify-bundle"],
  jsonMode: "default",
  handler: (args) => {
    const archivePath = required(optionalArg(args.positionals[0]), "bundle path");
    const result = reportVerifyBundleCli({ ...args.options, archive: archivePath });
    return { json: result, exitCode: result.ok ? undefined : 1 };
  },
});
REGISTRY_BY_CAPABILITY.get("report.verify-bundle")!.mcp!.handler = (args) => {
  const result = reportVerifyBundleCli(args);
  return result;
};

// ---------------------------------------------------------------------
