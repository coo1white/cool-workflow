// core/trust/receipt.ts — the "done receipt" kernel: seal, verify, judge. Pure; the
// shell runs the command and reads git (shell/receipt-io.ts). Digest/id rule as ledger.ts.
import * as crypto from "node:crypto";
import { ledgerStableStringify, sha256 } from "../hash.js";
import { isRecord } from "../util/cli-args.js";
export const RECEIPT_ID_RE = /^rc-[0-9a-f]{16}$/;
const BODY_FIELDS = ["kind", "schemaVersion", "argv", "cwd", "gitHead", "dirty", "treeDigest", "exitCode", "signal", "startedAt", "endedAt", "stdout", "stderr", "cwVersion"];
/** sha256 over every body field (never id, digest or signature). */
export function computeReceiptDigest(body) {
    const content = {};
    for (const field of BODY_FIELDS)
        content[field] = body[field];
    return sha256(ledgerStableStringify(content));
}
function receiptIdFor(digest) {
    return `rc-${digest.replace(/^sha256:/, "").slice(0, 16)}`;
}
export function sealReceipt(body) {
    const digest = computeReceiptDigest(body);
    return { ...body, id: receiptIdFor(digest), digest };
}
/** ed25519 over the digest text. The key is the caller's (CW_CHECK_PRIVKEY). */
export function signReceipt(receipt, privateKeyPem) {
    const value = crypto.sign(null, Buffer.from(receipt.digest, "utf8"), crypto.createPrivateKey(privateKeyPem)).toString("base64");
    return { ...receipt, signature: { algorithm: "ed25519", value } };
}
/** Whether the stored digest and id still match the body; never throws. */
export function receiptIntact(raw) {
    if (!isRecord(raw) || raw.kind !== "check-receipt" || raw.schemaVersion !== 1 || typeof raw.digest !== "string")
        return false;
    if (!Array.isArray(raw.argv) || !raw.argv.every((a) => typeof a === "string") || !isRecord(raw.stdout) || !isRecord(raw.stderr))
        return false;
    try {
        const digest = computeReceiptDigest(raw);
        return digest === raw.digest && raw.id === receiptIdFor(digest);
    }
    catch {
        return false;
    }
}
export function receiptSignatureValid(receipt, publicKeyPem) {
    const sig = receipt.signature;
    if (!sig || sig.algorithm !== "ed25519" || typeof sig.value !== "string" || !sig.value)
        return false;
    try {
        return crypto.verify(null, Buffer.from(receipt.digest, "utf8"), crypto.createPublicKey(publicKeyPem), Buffer.from(sig.value, "base64"));
    }
    catch {
        return false;
    }
}
/** One argv word as a POSIX shell would need it, so a "next" line can be pasted. */
export function shellWord(word) {
    return /^[A-Za-z0-9_\-.,/:=@+%]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}
export function checkCommandLine(argv) {
    return ["cw", "check", "--", ...argv.map(shellWord)].join(" ");
}
function shortSha(sha) {
    return sha ? sha.slice(0, 7) : "no commit";
}
/** "exit 0 at abc1234" (plus "+ changes" when the tree was dirty). */
export function receiptOutcome(receipt) {
    const exit = receipt.exitCode === null ? `signal ${receipt.signal || "?"}` : `exit ${receipt.exitCode}`;
    return `${exit} at ${shortSha(receipt.gitHead)}${receipt.dirty ? " + changes" : ""}`;
}
/** The fail-closed decision for one cited receipt. Order: found, intact,
 *  signed (only when a public key is set), passed, tied to git, current. */
export function judgeReceipt(id, raw, code, publicKeyPem) {
    const refuse = (c, reason, next) => ({ id, ok: false, code: c, reason, next });
    if (raw === undefined)
        return refuse("receipt-not-found", `receipt ${id} was not found in .cw/receipts`, "cw check list");
    if (!receiptIntact(raw) || raw.id !== id)
        return refuse("receipt-tampered", `receipt ${id} does not match its own digest (it was changed after it was made)`, "cw check list");
    const again = checkCommandLine(raw.argv);
    if (publicKeyPem && !receiptSignatureValid(raw, publicKeyPem)) {
        return refuse("receipt-unsigned", `receipt ${id} has no valid signature for the key in CW_CHECK_PUBKEY`, again);
    }
    if (raw.exitCode !== 0)
        return refuse("receipt-failed", `receipt ${id} shows the check failed (${receiptOutcome(raw)})`, again);
    if (!raw.gitHead || !raw.treeDigest) {
        return refuse("receipt-no-git", `receipt ${id} was made outside a git repo with a commit, so it cannot be tied to the code`, `git add -A && git commit -m "save work" && ${again}`);
    }
    if (raw.gitHead !== code.gitHead || raw.treeDigest !== code.treeDigest) {
        const now = raw.gitHead !== code.gitHead ? `now ${shortSha(code.gitHead)}` : "files changed since";
        return refuse("receipt-stale", `the code changed since receipt ${id} was made (it ran at ${shortSha(raw.gitHead)}, ${now})`, again);
    }
    return { id, ok: true, reason: `verified by receipt ${id} (${receiptOutcome(raw)})`, next: "" };
}
