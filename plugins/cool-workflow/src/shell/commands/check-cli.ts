// shell/commands/check-cli.ts — `cw check -- <command>`, `check list`, `check show <id>` (docs/verifier-gated-commit.7.md, DONE RECEIPTS).

import * as path from "node:path";
import type { CliHandlerResult } from "../../core/capability-data.js";
import { CheckReceipt, judgeReceipt, receiptOutcome } from "../../core/trust/receipt.js";
import { cwdArg, optionalArg } from "../../core/util/cli-args.js";
import { checkPublicKey, judgeStoredReceipt, listReceipts, loadReceipt, readCodeState, ReceiptListEntry, runCheck, saveReceipt } from "../receipt-io.js";
import { green, red, yellow } from "../term.js";

export interface CheckRunResult {
  schemaVersion: 1;
  ok: boolean;
  id: string;
  cite: string;
  path: string;
  argv: string[];
  exitCode: number | null;
  signal: string | null;
  gitHead: string | null;
  dirty: boolean;
  signed: boolean;
  usable: boolean;
  code: string | null;
  reason: string;
  next: string;
}

const USAGE = "Usage: cw check -- <command> [args...]  (for one: cw check -- npm test)";

export async function checkRunCli(positionals: string[], options: Record<string, unknown>): Promise<CliHandlerResult> {
  if (!positionals.length) throw new Error(USAGE);
  const repo = cwdArg(options, ["repo", "cwd"]);
  const receipt = await runCheck(positionals, { repo, echo: !options.quiet });
  const file = saveReceipt(repo, receipt);
  const verdict = judgeReceipt(receipt.id, receipt, readCodeState(repo), checkPublicKey());
  const passed = receipt.exitCode === 0;
  const result: CheckRunResult = {
    schemaVersion: 1,
    ok: passed,
    id: receipt.id,
    cite: `receipt:${receipt.id}`,
    path: file,
    argv: receipt.argv,
    exitCode: receipt.exitCode,
    signal: receipt.signal,
    gitHead: receipt.gitHead,
    dirty: receipt.dirty,
    signed: Boolean(receipt.signature),
    usable: verdict.ok,
    code: verdict.code || null,
    reason: verdict.reason,
    next: passed && verdict.ok ? `cw check show ${receipt.id}` : verdict.next,
  };
  return { json: result, exitCode: passed ? undefined : 1 };
}

/** The one TTY line for `cw check` (piped output stays JSON). */
export function formatCheckRun(json: unknown): string {
  const r = json as CheckRunResult;
  const what = `${r.argv.join(" ")} (${receiptOutcome(r as unknown as CheckReceipt)})`;
  if (!r.ok) return `${red("✗")} failed: ${what} — receipt ${r.id} records it. Fix the failure, then run: ${r.next}`;
  if (!r.usable) return `${yellow("!")} passed: ${what}, but receipt ${r.id} cannot be cited: ${r.reason}. Next: ${r.next}`;
  return `${green("✓")} passed: ${what} — receipt ${r.id}. Cite it as ${r.cite}. Next: ${r.next}`;
}

export function checkListCli(options: Record<string, unknown>): ReceiptListEntry[] {
  return listReceipts(cwdArg(options, ["repo", "cwd"]));
}

export function formatCheckList(json: unknown): string {
  const entries = json as ReceiptListEntry[];
  if (!entries.length) return "No receipts yet. Next: cw check -- npm test";
  return entries
    .map((e) => `${e.usable ? green("✓") : red("✗")} ${e.id}  ${(e.argv || ["?"]).join(" ")}  ${e.usable ? "usable" : e.reason}${e.startedAt ? `  ${e.startedAt}` : ""}`)
    .join("\n");
}

export interface CheckShowResult {
  id: string;
  cite: string;
  usable: boolean;
  code: string | null;
  reason: string;
  next: string;
  receipt: CheckReceipt | null;
}

export function checkShowCli(id: string | undefined, options: Record<string, unknown>): CliHandlerResult & { json: CheckShowResult } {
  if (!id) throw new Error("Usage: cw check show <receipt-id>  (see the ids with: cw check list)");
  const clean = id.replace(/^receipt:/, "");
  const repo = cwdArg(options, ["repo", "cwd"]);
  const verdict = judgeStoredReceipt(repo, clean);
  const raw = loadReceipt(repo, clean);
  const json: CheckShowResult = { id: clean, cite: `receipt:${clean}`, usable: verdict.ok, code: verdict.code || null, reason: verdict.reason, next: verdict.next, receipt: verdict.code === "receipt-not-found" ? null : (raw as CheckReceipt) };
  return { json, exitCode: verdict.ok ? undefined : 1 };
}

export function formatCheckShow(json: unknown): string {
  const r = json as CheckShowResult;
  const lines = [`${r.usable ? green("✓") : red("✗")} ${r.reason}`];
  if (r.receipt && Array.isArray(r.receipt.argv)) {
    lines.push(`  command: ${r.receipt.argv.join(" ")}`, `  folder:  ${path.basename(String(r.receipt.cwd))}`, `  ran:     ${r.receipt.startedAt} to ${r.receipt.endedAt}`, `  signed:  ${r.receipt.signature ? "yes (ed25519)" : "no"}`);
    if (r.receipt.stdout?.tail) lines.push("  last output:", ...r.receipt.stdout.tail.split("\n").slice(-5).map((l) => `    ${l}`));
  }
  lines.push(r.usable ? `  Cite it in a result's evidence as: ${r.cite}` : `  Next: ${r.next}`);
  return lines.join("\n");
}

/** MCP bodies: the same payloads as `--json`. */
export function checkListMcp(args: Record<string, unknown>): ReceiptListEntry[] {
  return checkListCli(args);
}

export function checkShowMcp(args: Record<string, unknown>): CheckShowResult {
  return checkShowCli(optionalArg(args.id), args).json;
}
