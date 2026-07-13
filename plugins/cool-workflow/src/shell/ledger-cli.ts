// shell/ledger-cli.ts — CLI/MCP-reachable bodies for `cw ledger
// propose|review|verify|apply|list`.
//
// MILESTONE 8. Byte-exact port of the old build's src/cli/handlers/
// ledger.ts argv shape, now calling core/trust/ledger.ts's pure
// functions + shell/ledger-io.ts's directory reads. Impure (fs: stdin/
// file reads for verify/apply, directory scans for list) — this is the
// shell layer the capability-table's CLI/MCP handlers delegate to.
//
// Evidence: SPEC/ledger-trust.md "CLI: `cw ledger`", "Edge cases";
// plugins/cool-workflow/src/cli/handlers/ledger.ts:1-133.

import * as fs from "node:fs";
import {
  applyLedgerProposal,
  buildLedgerProposal,
  buildLedgerReview,
  LedgerApplyResult,
  LedgerVerdict,
  LedgerVerifyResult,
  verifyLedgerEntry,
} from "../core/trust/ledger";
import { listLedgerEntries, LedgerListResult, LedgerUnionResult, unionLedgerEntries } from "./ledger-io";

/** Coerce a repeatable/comma-joined list option to a clean string[]. */
function listOption(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return parts.map((p) => String(p).trim()).filter(Boolean);
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function ledgerProposeCli(options: Record<string, unknown>): ReturnType<typeof buildLedgerProposal> {
  return buildLedgerProposal({
    from: required(stringOption(options.from), "--from <agent/repo>"),
    to: required(stringOption(options.to), "--to <agent/repo>"),
    title: required(stringOption(options.title), "--title <text>"),
    rationale: required(stringOption(options.rationale), "--rationale <text>"),
    targetFiles: listOption(options.files),
    // Do NOT trim the diff: it is a unified patch (payload, not a
    // label), and trimming strips the trailing newline `git apply`
    // requires. Presence is detected with a trimmed test, but the bytes
    // are passed through verbatim.
    suggestedDiff: typeof options.diff === "string" && options.diff.trim() ? options.diff : undefined,
    createdAt: nowIso(),
  });
}

/** MCP-facing `cw_ledger_propose`: `files` is a comma string; `diff` is
 *  passed through as-is (undefined only when the arg itself is absent),
 *  a slightly looser shape than the CLI handler's flag-labeled
 *  requireds (byte-exact to the old build's src/mcp/tool-call.ts). */
export function ledgerProposeMcp(args: Record<string, unknown>): ReturnType<typeof buildLedgerProposal> {
  return buildLedgerProposal({
    from: String(args.from || ""),
    to: String(args.to || ""),
    title: String(args.title || ""),
    rationale: String(args.rationale || ""),
    targetFiles: String(args.files || "").split(",").map((f) => f.trim()).filter(Boolean),
    suggestedDiff: args.diff === undefined ? undefined : String(args.diff),
    createdAt: nowIso(),
  });
}

export function ledgerReviewCli(options: Record<string, unknown>): ReturnType<typeof buildLedgerReview> {
  const verdictRaw = required(stringOption(options.verdict), "--verdict <approved|rejected>").toUpperCase();
  if (verdictRaw !== "APPROVED" && verdictRaw !== "REJECTED") {
    throw new Error('--verdict must be "approved" or "rejected".');
  }
  return buildLedgerReview({
    from: required(stringOption(options.from), "--from <agent/repo>"),
    to: required(stringOption(options.to), "--to <agent/repo>"),
    target: required(stringOption(options.target), "--target <proposal-id|pr-ref>"),
    verdict: verdictRaw as LedgerVerdict,
    findings: listOption(options.findings),
    createdAt: nowIso(),
  });
}

/** MCP-facing `cw_ledger_review`: same verdict check, but WITHOUT the
 *  `--verdict` CLI-flag framing in the error message (byte-exact to the
 *  old build's src/mcp/tool-call.ts, a separate call site from the CLI
 *  handler's own message). */
export function ledgerReviewMcp(args: Record<string, unknown>): ReturnType<typeof buildLedgerReview> {
  const verdict = String(args.verdict || "").toUpperCase();
  if (verdict !== "APPROVED" && verdict !== "REJECTED") {
    throw new Error('verdict must be "approved" or "rejected".');
  }
  return buildLedgerReview({
    from: String(args.from || ""),
    to: String(args.to || ""),
    target: String(args.target || ""),
    verdict: verdict as LedgerVerdict,
    findings: String(args.findings || "").split(",").map((f) => f.trim()).filter(Boolean),
    createdAt: nowIso(),
  });
}

const BAD_JSON_VERIFY: LedgerVerifyResult = {
  ok: false,
  id: null,
  kind: null,
  checks: [{ name: "parse", pass: false, code: "ledger-bad-json" }],
  failedChecks: [{ name: "parse", code: "ledger-bad-json" }],
};

const BAD_JSON_APPLY: LedgerApplyResult = {
  ok: false,
  id: null,
  kind: null,
  diff: null,
  failedChecks: [{ name: "parse", code: "ledger-bad-json" }],
};

function readLedgerEntryInput(options: Record<string, unknown>): string {
  const file = stringOption(options.file);
  try {
    // --file <path>, else read the entry from stdin (fd 0).
    return fs.readFileSync(file || 0, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ledger entry${file ? ` from ${file}` : " from stdin"}: ${(error as Error).message}`);
  }
}

export function ledgerVerifyCli(options: Record<string, unknown>): LedgerVerifyResult {
  let text: string;
  try {
    text = readLedgerEntryInput(options);
  } catch (error) {
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return BAD_JSON_VERIFY;
  }
  return verifyLedgerEntry(parsed);
}

export function ledgerApplyCli(options: Record<string, unknown>): LedgerApplyResult {
  const text = readLedgerEntryInput(options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return BAD_JSON_APPLY;
  }
  return applyLedgerProposal(parsed);
}

export function ledgerListCli(options: Record<string, unknown>): LedgerListResult | LedgerUnionResult {
  // `--ledger-dir` is the preferred flag: the global CLI front door
  // (cli/entry.ts) treats `--dir` as an alias of `--repo` for EVERY
  // command, so `cw ledger list --dir X` made one flag mean two things.
  // `--dir` keeps working unchanged as the legacy spelling; when both are
  // given, `--ledger-dir` wins. Repeated flags become an array via
  // parseArgv's append behavior, same as `--dir` always has.
  const input = options["ledger-dir"] ?? options.dir;
  const dirs = Array.isArray(input) ? input.map(String).filter(Boolean) : [];
  if (dirs.length > 1) return unionLedgerEntries(dirs);
  const dir = required(dirs[0] || stringOption(input), "--ledger-dir <ledger-directory>");
  return listLedgerEntries(dir);
}

/** MCP-facing verify/apply take the entry OBJECT directly (not a file/
 *  stdin path). */
export function ledgerVerifyEntry(entry: unknown): LedgerVerifyResult {
  return verifyLedgerEntry(entry);
}

export function ledgerApplyEntry(entry: unknown): LedgerApplyResult {
  return applyLedgerProposal(entry);
}

export function ledgerListMcp(args: Record<string, unknown>): LedgerListResult | LedgerUnionResult {
  const dirsArg = args.dirs;
  const dirs = Array.isArray(dirsArg) ? dirsArg.map(String).filter(Boolean) : [];
  if (dirs.length > 1) return unionLedgerEntries(dirs);
  const dir = required(dirs[0] || stringOption(args.dir), "dir");
  return listLedgerEntries(dir);
}
