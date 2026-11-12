// shell/commands/check-cli.ts — `cw check -- <command>`, `check list`, `check show <id>` (docs/reference.md, "Check: cw check").
import * as os from "node:os";
import * as path from "node:path";
import { judgeReceipt, receiptOutcome } from "../../core/trust/receipt.js";
import { cwdArg } from "../../core/util/cli-args.js";
import { checkPublicKey, judgeStoredReceipt, listReceipts, loadReceipt, readCodeState, runCheck, saveReceipt } from "../receipt-io.js";
import { green, red, yellow } from "../term.js";
const USAGE = "Usage: cw check -- <command> [args...]  (for one: cw check -- npm test)";
export async function checkRunCli(positionals, options) {
    if (!positionals.length)
        throw new Error(USAGE);
    const repo = cwdArg(options, ["repo", "cwd"]);
    const tee = Boolean(options.tee);
    const receipt = await runCheck(positionals, { repo, tee, echo: !tee && !options.quiet && Boolean(process.stderr.isTTY) });
    const file = saveReceipt(repo, receipt);
    const verdict = judgeReceipt(receipt.id, receipt, readCodeState(repo), checkPublicKey());
    const passed = receipt.exitCode === 0;
    const result = {
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
    if (!tee)
        return { json: result, exitCode: passed ? undefined : 1 };
    // --tee: stdout held the command's own output, so the receipt line goes to
    // stderr and the command's exit code comes back unchanged (a signal: 128+n).
    process.stderr.write(`${formatCheckRun(result)}\n`);
    const signalled = receipt.signal ? 128 + (os.constants.signals[receipt.signal] || 0) : 1;
    return { exitCode: receipt.exitCode ?? signalled };
}
/** The one TTY line for `cw check` (piped output stays JSON). */
export function formatCheckRun(json) {
    const r = json;
    const what = `${r.argv.join(" ")} (${receiptOutcome(r)})`;
    if (!r.ok)
        return `${red("✗")} failed: ${what} — receipt ${r.id} records it. Fix the failure, then run: ${r.next}`;
    if (!r.usable)
        return `${yellow("!")} passed: ${what}, but receipt ${r.id} cannot be cited: ${r.reason}. Next: ${r.next}`;
    return `${green("✓")} passed: ${what} — receipt ${r.id}. Cite it as ${r.cite}. Next: ${r.next}`;
}
export function checkListCli(options) {
    return listReceipts(cwdArg(options, ["repo", "cwd"]));
}
export function formatCheckList(json) {
    const entries = json;
    if (!entries.length)
        return "No receipts yet. Next: cw check -- npm test";
    return entries
        .map((e) => `${e.usable ? green("✓") : red("✗")} ${e.id}  ${(e.argv || ["?"]).join(" ")}  ${e.usable ? "usable" : e.reason}${e.startedAt ? `  ${e.startedAt}` : ""}`)
        .join("\n");
}
export function checkShowCli(id, options) {
    if (!id)
        throw new Error("Usage: cw check show <receipt-id>  (see the ids with: cw check list)");
    const clean = id.replace(/^receipt:/, "");
    const repo = cwdArg(options, ["repo", "cwd"]);
    const verdict = judgeStoredReceipt(repo, clean);
    const raw = loadReceipt(repo, clean);
    const json = { id: clean, cite: `receipt:${clean}`, usable: verdict.ok, code: verdict.code || null, reason: verdict.reason, next: verdict.next, receipt: verdict.code === "receipt-not-found" ? null : raw };
    return { json, exitCode: verdict.ok ? undefined : 1 };
}
export function formatCheckShow(json) {
    const r = json;
    const lines = [`${r.usable ? green("✓") : red("✗")} ${r.reason}`];
    if (r.receipt && Array.isArray(r.receipt.argv)) {
        lines.push(`  command: ${r.receipt.argv.join(" ")}`, `  folder:  ${path.basename(String(r.receipt.cwd))}`, `  ran:     ${r.receipt.startedAt} to ${r.receipt.endedAt}`, `  signed:  ${r.receipt.signature ? "yes (ed25519)" : "no"}`);
        if (r.receipt.stdout?.tail)
            lines.push("  last output:", ...r.receipt.stdout.tail.split("\n").slice(-5).map((l) => `    ${l}`));
    }
    lines.push(r.usable ? `  Cite it in a result's evidence as: ${r.cite}` : `  Next: ${r.next}`);
    return lines.join("\n");
}
