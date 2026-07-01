// `cw ledger propose|review|verify` — the cross-agent handoff ledger CLI surface.
// A proposing agent prints a proposal or a review verdict as a verifiable JSON
// entry; the receiving side verifies it fail-closed before acting. See
// docs/cross-agent-ledger.7.md and docs/designs/handoff-ledger.md.

import * as fs from "fs";
import { CoolWorkflowRunner, parseArgv } from "../../orchestrator";
import { buildLedgerProposal, buildLedgerReview, verifyLedgerEntry, applyLedgerProposal, listLedgerEntries, unionLedgerEntries, LedgerVerdict } from "../../ledger";
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
        // Do NOT trim the diff: it is a unified patch (payload, not a label), and
        // trimming strips the trailing newline `git apply` requires — a trimmed
        // diff is a corrupt patch. Presence is detected with a trimmed test, but
        // the bytes are passed through verbatim (matching the MCP propose path).
        suggestedDiff: typeof opts.diff === "string" && opts.diff.trim() ? opts.diff : undefined,
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
    case "apply": {
      const file = stringOption(opts.file);
      let text: string;
      try {
        // --file <path>, else read the entry from stdin (fd 0), same as verify.
        text = fs.readFileSync(file || 0, "utf8");
      } catch (error) {
        throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${(error as Error).message}`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        printJson({ ok: false, id: null, kind: null, diff: null, failedChecks: [{ name: "parse", code: "ledger-bad-json" }] });
        process.exitCode = 1;
        return;
      }
      const result = applyLedgerProposal(parsed);
      printJson(result);
      // Fail-closed: the diff only comes out (ok:true) when the proposal verifies,
      // so `cw ledger apply <file> | git apply` never feeds git an unverified patch.
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "list": {
      // `--dir` is repeatable: 2+ dirs union-verify multiple mirrors into one
      // inbox; a single --dir keeps the original single-directory output (POLA).
      const dirs = Array.isArray(opts.dir) ? opts.dir.map(String).filter(Boolean) : [];
      if (dirs.length > 1) {
        const union = unionLedgerEntries(dirs);
        printJson(union);
        if (!union.allOk) process.exitCode = 1;
        return;
      }
      const dir = required(dirs[0] || stringOption(opts.dir), "--dir <ledger-directory>");
      const result = listLedgerEntries(dir);
      printJson(result);
      // Fail-closed inbox: refuse the whole batch if any entry does not verify.
      if (!result.allOk) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Usage: cw ledger propose|review|verify|apply|list [options]");
  }
}
