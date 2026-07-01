// `cw ledger propose|review|verify` — the cross-agent handoff ledger CLI surface.
// A proposing agent prints a proposal or a review verdict as a verifiable JSON
// entry; the receiving side verifies it fail-closed before acting. See
// docs/cross-agent-ledger.7.md and docs/designs/handoff-ledger.md.

import * as fs from "fs";
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { buildLedgerProposal, buildLedgerReview, verifyLedgerEntry, listLedgerEntries, LedgerVerdict } from "../../ledger";
import { required, printJson } from "../io";

type ParsedArgs = ReturnType<typeof parseArgv>;

/** Coerce a repeatable/comma-joined list option to a clean string[]. */
function listOption(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return parts.map((p) => String(p).trim()).filter(Boolean);
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function handleLedger(args: ParsedArgs, _runner: CoolWorkflowRunner): void {
  const [subcommand] = args.positionals;
  const opts = args.options;
  switch (subcommand) {
    case "propose": {
      const entry = buildLedgerProposal({
        from: required(stringOption(opts.from), "--from <agent/repo>"),
        to: required(stringOption(opts.to), "--to <agent/repo>"),
        title: required(stringOption(opts.title), "--title <text>"),
        rationale: required(stringOption(opts.rationale), "--rationale <text>"),
        targetFiles: listOption(opts.files),
        suggestedDiff: stringOption(opts.diff),
        createdAt: nowIso()
      });
      printJson(entry);
      return;
    }
    case "review": {
      const verdictRaw = required(stringOption(opts.verdict), "--verdict <approved|rejected>").toUpperCase();
      if (verdictRaw !== "APPROVED" && verdictRaw !== "REJECTED") {
        throw new Error('--verdict must be "approved" or "rejected".');
      }
      const entry = buildLedgerReview({
        from: required(stringOption(opts.from), "--from <agent/repo>"),
        to: required(stringOption(opts.to), "--to <agent/repo>"),
        target: required(stringOption(opts.target), "--target <proposal-id|pr-ref>"),
        verdict: verdictRaw as LedgerVerdict,
        findings: listOption(opts.findings),
        createdAt: nowIso()
      });
      printJson(entry);
      return;
    }
    case "verify": {
      const file = stringOption(opts.file);
      let text: string;
      try {
        // --file <path>, else read the entry from stdin (fd 0).
        text = fs.readFileSync(file || 0, "utf8");
      } catch (error) {
        throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${(error as Error).message}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // A non-JSON input is itself a fail-closed refusal, not a crash.
        printJson({ ok: false, id: null, kind: null, checks: [{ name: "parse", pass: false, code: "ledger-bad-json" }], failedChecks: [{ name: "parse", code: "ledger-bad-json" }] });
        process.exitCode = 1;
        return;
      }
      const result = verifyLedgerEntry(parsed);
      printJson(result);
      // Fail-closed: a tampered/malformed entry exits non-zero so
      // `cw ledger verify <file> && open-pr` cannot proceed on a lie.
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "list": {
      const dir = required(stringOption(opts.dir), "--dir <ledger-directory>");
      const result = listLedgerEntries(dir);
      printJson(result);
      // Fail-closed inbox: refuse the whole batch if any entry does not verify.
      if (!result.allOk) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw ledger propose|review|verify|list [options]");
  }
}
