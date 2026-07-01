"use strict";
// Cross-agent handoff ledger — the core mechanism for two agents scoped to two
// separate repos to hand each other a CHANGE PROPOSAL or a REVIEW VERDICT as
// verifiable data, not chat. Design: docs/designs/handoff-ledger.md.
//
// Stage 1 (human-relay transport): a ledger entry is a self-contained JSON
// object carrying its own sha256 content digest. The producing side prints one;
// the operator carries it to the other session; the consuming side VERIFIES it
// fail-closed (a tampered or malformed entry is refused, never acted on) before
// turning a proposal into a real PR or recording a verdict.
//
// Zero-dependency (only node stdlib). `build*`/`verify*` are pure; the stage-2
// git transport adds `listLedgerEntries`, a READ-ONLY scan of a shared ledger
// directory (the working tree of a handoff repo) that verifies every entry
// fail-closed. No run state, no writes, no network.
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
exports.computeLedgerDigest = computeLedgerDigest;
exports.buildLedgerProposal = buildLedgerProposal;
exports.buildLedgerReview = buildLedgerReview;
exports.verifyLedgerEntry = verifyLedgerEntry;
exports.listLedgerEntries = listLedgerEntries;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Deterministic JSON with recursively sorted object keys, so the digest is a
 *  function of content only — never key insertion order. */
function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(",")}]`;
    const keys = Object.keys(value).sort();
    const body = keys
        .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
        .join(",");
    return `{${body}}`;
}
/** sha256 over the canonical content (every field except `id` and `digest`,
 *  which are derived FROM it). Returns the full `sha256:<hex>` form. */
function computeLedgerDigest(entry) {
    const hash = crypto.createHash("sha256");
    hash.update(stableStringify(entry));
    return `sha256:${hash.digest("hex")}`;
}
/** Content-addressed id: `ldg-` + the first 16 hex chars of the digest. Two
 *  entries with the same content (and createdAt) get the same id. */
function deriveId(digest) {
    return `ldg-${digest.replace(/^sha256:/, "").slice(0, 16)}`;
}
function seal(content) {
    const digest = computeLedgerDigest(content);
    return { ...content, id: deriveId(digest), digest };
}
function buildLedgerProposal(input) {
    const content = {
        kind: "proposal",
        schemaVersion: 1,
        from: input.from,
        to: input.to,
        title: input.title,
        rationale: input.rationale,
        targetFiles: [...input.targetFiles],
        suggestedDiff: input.suggestedDiff || "",
        createdAt: input.createdAt
    };
    return seal(content);
}
function buildLedgerReview(input) {
    const content = {
        kind: "review",
        schemaVersion: 1,
        from: input.from,
        to: input.to,
        target: input.target,
        verdict: input.verdict,
        findings: [...input.findings],
        createdAt: input.createdAt
    };
    return seal(content);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
const PROPOSAL_FIELDS = ["from", "to", "title", "rationale", "targetFiles", "suggestedDiff", "createdAt"];
const REVIEW_FIELDS = ["from", "to", "target", "verdict", "findings", "createdAt"];
/** Fail-closed verification. Any structural defect, unknown kind, or digest
 *  mismatch yields `ok:false` — the caller refuses to act on it. */
function verifyLedgerEntry(raw) {
    const checks = [];
    const fail = (name, code, detail) => {
        checks.push({ name, pass: false, code, detail });
        return {
            ok: false,
            id: isRecord(raw) && typeof raw.id === "string" ? raw.id : null,
            kind: isRecord(raw) && typeof raw.kind === "string" ? raw.kind : null,
            checks,
            failedChecks: checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code, detail: c.detail }))
        };
    };
    if (!isRecord(raw))
        return fail("structure", "ledger-not-object", "entry is not a JSON object");
    checks.push({ name: "structure", pass: true });
    const kind = raw.kind;
    if (kind !== "proposal" && kind !== "review")
        return fail("kind", "ledger-unknown-kind", `kind must be proposal|review, got ${JSON.stringify(kind)}`);
    checks.push({ name: "kind", pass: true });
    if (raw.schemaVersion !== 1)
        return fail("schema", "ledger-bad-schema", `schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`);
    checks.push({ name: "schema", pass: true });
    if (typeof raw.digest !== "string" || !raw.digest)
        return fail("digest-present", "ledger-missing-digest", "digest is absent or not a string");
    checks.push({ name: "digest-present", pass: true });
    const fields = kind === "proposal" ? PROPOSAL_FIELDS : REVIEW_FIELDS;
    const content = { kind, schemaVersion: 1 };
    for (const field of fields) {
        if (!(field in raw))
            return fail("fields", "ledger-missing-field", `required field ${field} is absent`);
        content[field] = raw[field];
    }
    if (kind === "review" && raw.verdict !== "APPROVED" && raw.verdict !== "REJECTED") {
        return fail("verdict", "ledger-bad-verdict", `verdict must be APPROVED|REJECTED, got ${JSON.stringify(raw.verdict)}`);
    }
    checks.push({ name: "fields", pass: true });
    const recomputed = computeLedgerDigest(content);
    if (recomputed !== raw.digest) {
        return fail("digest", "ledger-digest-mismatch", `stored digest does not match content (recomputed ${recomputed})`);
    }
    checks.push({ name: "digest", pass: true });
    return { ok: true, id: typeof raw.id === "string" ? raw.id : null, kind, checks, failedChecks: [] };
}
/** Read every `*.json` in `dir`, verify each entry fail-closed, and report.
 *  `allOk` is false if any entry is tampered, malformed, or unreadable — so the
 *  receiving side refuses the whole inbox rather than acting on a mixed batch. */
function listLedgerEntries(dir) {
    let names;
    try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
    }
    catch (error) {
        return { dir, count: 0, allOk: false, entries: [{ file: dir, id: null, kind: null, from: null, to: null, ok: false, failedChecks: [{ name: "dir", code: "ledger-dir-unreadable", detail: error.message }] }] };
    }
    const entries = names.map((name) => {
        const file = path.join(dir, name);
        let raw;
        try {
            raw = JSON.parse(fs.readFileSync(file, "utf8"));
        }
        catch {
            return { file: name, id: null, kind: null, from: null, to: null, ok: false, failedChecks: [{ name: "parse", code: "ledger-bad-json" }] };
        }
        const result = verifyLedgerEntry(raw);
        const rec = isRecord(raw) ? raw : {};
        return {
            file: name,
            id: result.id,
            kind: result.kind,
            from: typeof rec.from === "string" ? rec.from : null,
            to: typeof rec.to === "string" ? rec.to : null,
            ok: result.ok,
            failedChecks: result.failedChecks
        };
    });
    return { dir, count: entries.length, allOk: entries.every((e) => e.ok), entries };
}
