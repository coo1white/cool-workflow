// core/trust/ledger.ts — the cross-agent handoff ledger kernel.
//
// MILESTONE 8 (v2/PLAN.md build order, step 8; SPEC/ledger-trust.md in
// full). Pure: computeLedgerDigest, buildLedgerProposal/Review,
// verifyLedgerEntry, applyLedgerProposal. Directory reads
// (listLedgerEntries/unionLedgerEntries) live in shell/ledger-io.ts, NOT
// here — this file touches no fs.
//
// Byte-exact port of the old build's src/ledger.ts. Uses
// core/hash.ts's `ledgerStableStringify` (byte-identical to
// `stableStringify`, kept as its own named export per PLAN.md's Hash
// dedup rule) rather than reimplementing a private copy.
//
// Evidence: SPEC/ledger-trust.md "Handoff ledger entry", "Exported
// functions", "Edge cases"; plugins/cool-workflow/src/ledger.ts:1-429.

import { ledgerStableStringify, sha256 } from "../hash";

export type LedgerEntryKind = "proposal" | "review";
export type LedgerVerdict = "APPROVED" | "REJECTED";

export interface LedgerProposal {
  kind: "proposal";
  schemaVersion: 1;
  id: string;
  from: string;
  to: string;
  title: string;
  rationale: string;
  targetFiles: string[];
  suggestedDiff: string;
  createdAt: string;
  digest: string;
}

export interface LedgerReview {
  kind: "review";
  schemaVersion: 1;
  id: string;
  from: string;
  to: string;
  target: string;
  verdict: LedgerVerdict;
  findings: string[];
  createdAt: string;
  digest: string;
}

export type LedgerEntry = LedgerProposal | LedgerReview;

export interface LedgerCheck {
  name: string;
  pass: boolean;
  code?: string;
  detail?: string;
}

export interface LedgerVerifyResult {
  ok: boolean;
  id: string | null;
  kind: string | null;
  checks: LedgerCheck[];
  failedChecks: Array<{ name: string; code: string; detail?: string }>;
}

export interface ProposalInput {
  from: string;
  to: string;
  title: string;
  rationale: string;
  targetFiles: string[];
  suggestedDiff?: string;
  createdAt: string;
}

export interface ReviewInput {
  from: string;
  to: string;
  target: string;
  verdict: LedgerVerdict;
  findings: string[];
  createdAt: string;
}

/** sha256 over the canonical content (every field except `id` and
 *  `digest`, which are derived FROM it). Returns the full `sha256:<hex>`
 *  form — the same prefixed spelling every other hash chain uses. */
export function computeLedgerDigest(entry: Omit<LedgerEntry, "id" | "digest">): string {
  return sha256(ledgerStableStringify(entry));
}

/** Content-addressed id: `ldg-` + the first 16 hex chars of the digest. */
function deriveId(digest: string): string {
  return `ldg-${digest.replace(/^sha256:/, "").slice(0, 16)}`;
}

function seal<T extends Omit<LedgerEntry, "id" | "digest">>(content: T): T & { id: string; digest: string } {
  const digest = computeLedgerDigest(content);
  return { ...content, id: deriveId(digest), digest };
}

export function buildLedgerProposal(input: ProposalInput): LedgerProposal {
  const content = {
    kind: "proposal" as const,
    schemaVersion: 1 as const,
    from: input.from,
    to: input.to,
    title: input.title,
    rationale: input.rationale,
    targetFiles: [...input.targetFiles],
    suggestedDiff: input.suggestedDiff || "",
    createdAt: input.createdAt,
  };
  return seal(content) as LedgerProposal;
}

export function buildLedgerReview(input: ReviewInput): LedgerReview {
  const content = {
    kind: "review" as const,
    schemaVersion: 1 as const,
    from: input.from,
    to: input.to,
    target: input.target,
    verdict: input.verdict,
    findings: [...input.findings],
    createdAt: input.createdAt,
  };
  return seal(content) as LedgerReview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROPOSAL_FIELDS = ["from", "to", "title", "rationale", "targetFiles", "suggestedDiff", "createdAt"];
const REVIEW_FIELDS = ["from", "to", "target", "verdict", "findings", "createdAt"];

/** Fail-closed verification. Any structural defect, unknown kind, or
 *  digest mismatch yields `ok:false`. Check names run in this order and
 *  stop at the first failure: structure, kind, schema, digest-present,
 *  fields (verdict nested inside for reviews), digest, id. */
export function verifyLedgerEntry(raw: unknown): LedgerVerifyResult {
  const checks: LedgerCheck[] = [];
  const fail = (name: string, code: string, detail?: string): LedgerVerifyResult => {
    checks.push({ name, pass: false, code, detail });
    return {
      ok: false,
      id: isRecord(raw) && typeof raw.id === "string" ? raw.id : null,
      kind: isRecord(raw) && typeof raw.kind === "string" ? raw.kind : null,
      checks,
      failedChecks: checks
        .filter((c) => !c.pass)
        .map((c) => ({ name: c.name, code: c.code as string, detail: c.detail })),
    };
  };

  if (!isRecord(raw)) return fail("structure", "ledger-not-object", "entry is not a JSON object");
  checks.push({ name: "structure", pass: true });

  const kind = raw.kind;
  if (kind !== "proposal" && kind !== "review") {
    return fail("kind", "ledger-unknown-kind", `kind must be proposal|review, got ${JSON.stringify(kind)}`);
  }
  checks.push({ name: "kind", pass: true });

  if (raw.schemaVersion !== 1) {
    return fail("schema", "ledger-bad-schema", `schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`);
  }
  checks.push({ name: "schema", pass: true });

  if (typeof raw.digest !== "string" || !raw.digest) {
    return fail("digest-present", "ledger-missing-digest", "digest is absent or not a string");
  }
  checks.push({ name: "digest-present", pass: true });

  const fields = kind === "proposal" ? PROPOSAL_FIELDS : REVIEW_FIELDS;
  const content: Record<string, unknown> = { kind, schemaVersion: 1 };
  for (const field of fields) {
    if (!(field in raw)) return fail("fields", "ledger-missing-field", `required field ${field} is absent`);
    content[field] = raw[field];
  }
  if (kind === "review" && raw.verdict !== "APPROVED" && raw.verdict !== "REJECTED") {
    return fail("verdict", "ledger-bad-verdict", `verdict must be APPROVED|REJECTED, got ${JSON.stringify(raw.verdict)}`);
  }
  checks.push({ name: "fields", pass: true });

  const recomputed = computeLedgerDigest(content as Omit<LedgerEntry, "id" | "digest">);
  if (recomputed !== raw.digest) {
    return fail("digest", "ledger-digest-mismatch", `stored digest does not match content (recomputed ${recomputed})`);
  }
  checks.push({ name: "digest", pass: true });

  // Bind the id to the content: it MUST be the content-addressed id
  // derived from the digest. Without this, `id` is a free, unverified
  // field (excluded from the digest) — a forged entry could set `id` to
  // collide with a legit one, and any id-keyed de-duplication (`cw
  // ledger list` union) would silently drop one of them.
  const expectedId = deriveId(raw.digest);
  if (raw.id !== expectedId) {
    return fail(
      "id",
      "ledger-id-mismatch",
      `id ${JSON.stringify(raw.id)} is not the content-addressed id for this digest (expected ${expectedId})`
    );
  }
  checks.push({ name: "id", pass: true });

  return { ok: true, id: expectedId, kind, checks, failedChecks: [] };
}

export interface LedgerApplyResult {
  ok: boolean;
  id: string | null;
  kind: string | null;
  /** The verified proposal's unified diff, present ONLY when `ok` — a
   *  tampered, non-proposal, or diff-less entry yields `diff: null`. */
  diff: string | null;
  failedChecks: Array<{ name: string; code: string; detail?: string }>;
}

/** Fail-closed extraction of a proposal's `suggestedDiff`. The diff can
 *  ONLY escape after the entry verifies: a tampered entry, a review (not
 *  a proposal), or a proposal with no diff all yield `ok:false` and
 *  `diff:null`. */
export function applyLedgerProposal(raw: unknown): LedgerApplyResult {
  const verified = verifyLedgerEntry(raw);
  if (!verified.ok) {
    return { ok: false, id: verified.id, kind: verified.kind, diff: null, failedChecks: verified.failedChecks };
  }
  if (verified.kind !== "proposal") {
    return {
      ok: false,
      id: verified.id,
      kind: verified.kind,
      diff: null,
      failedChecks: [{ name: "kind", code: "ledger-not-a-proposal", detail: "apply expects a proposal entry, not a review" }],
    };
  }
  const rec = isRecord(raw) ? raw : {};
  const diff = typeof rec.suggestedDiff === "string" ? rec.suggestedDiff : "";
  if (!diff) {
    return {
      ok: false,
      id: verified.id,
      kind: verified.kind,
      diff: null,
      failedChecks: [{ name: "diff", code: "ledger-empty-diff", detail: "proposal carries no suggestedDiff to apply" }],
    };
  }
  return { ok: true, id: verified.id, kind: verified.kind, diff, failedChecks: [] };
}

// ---------------------------------------------------------------------------
// Inbox resolution — pure derivation over already-verified entries. The
// directory reads that PRODUCE these LedgerListEntry[] arrays live in
// shell/ledger-io.ts; this function itself touches no fs.
// ---------------------------------------------------------------------------

export interface LedgerListEntry {
  file: string;
  id: string | null;
  kind: string | null;
  from: string | null;
  to: string | null;
  title: string | null;
  target: string | null;
  verdict: string | null;
  ok: boolean;
  failedChecks: Array<{ name: string; code: string; detail?: string }>;
}

export type LedgerResolutionState = "pending" | "approved" | "rejected" | "contested";

export interface LedgerProposalResolution {
  id: string;
  title: string | null;
  resolution: LedgerResolutionState;
  reviews: string[];
}

export interface LedgerInboxResolution {
  proposals: LedgerProposalResolution[];
  pending: number;
  approved: number;
  rejected: number;
  contested: number;
}

/** Derive a machine-actionable inbox summary: pair each proposal with the
 *  review(s) that target it and report whether it is pending, approved,
 *  rejected, or contested. Only VERIFIED entries take part — a tampered
 *  review must never resolve a proposal. */
export function resolveLedgerInbox(entries: LedgerListEntry[]): LedgerInboxResolution {
  const verified = entries.filter((e) => e.ok);
  const reviews = verified.filter((e) => e.kind === "review" && e.target);
  const proposals: LedgerProposalResolution[] = verified
    .filter((e) => e.kind === "proposal" && e.id)
    .map((p) => {
      const answering = reviews.filter((r) => r.target === p.id);
      const verdicts = new Set(answering.map((r) => r.verdict));
      let resolution: LedgerResolutionState;
      if (answering.length === 0) resolution = "pending";
      else if (verdicts.size > 1) resolution = "contested";
      else resolution = verdicts.has("APPROVED") ? "approved" : "rejected";
      return {
        id: p.id as string,
        title: p.title,
        resolution,
        reviews: answering.map((r) => r.id as string).sort(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const tally = (s: LedgerResolutionState) => proposals.filter((p) => p.resolution === s).length;
  return {
    proposals,
    pending: tally("pending"),
    approved: tally("approved"),
    rejected: tally("rejected"),
    contested: tally("contested"),
  };
}
