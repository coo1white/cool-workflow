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
// Pure + zero-dependency: only node:crypto. No run state, no I/O — the CLI
// handler owns reading/printing; this module only builds and verifies.

import * as crypto from "crypto";

export type LedgerEntryKind = "proposal" | "review";
export type LedgerVerdict = "APPROVED" | "REJECTED";

/** A change proposal handed from one agent/repo to another. A proposal never
 *  mutates the target repo by itself — the write-capable side turns it into a
 *  real PR. */
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

/** A review verdict handed back on a proposal or a PR/diff. */
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

/** Deterministic JSON with recursively sorted object keys, so the digest is a
 *  function of content only — never key insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}

/** sha256 over the canonical content (every field except `id` and `digest`,
 *  which are derived FROM it). Returns the full `sha256:<hex>` form. */
export function computeLedgerDigest(entry: Omit<LedgerEntry, "id" | "digest">): string {
  const hash = crypto.createHash("sha256");
  hash.update(stableStringify(entry));
  return `sha256:${hash.digest("hex")}`;
}

/** Content-addressed id: `ldg-` + the first 16 hex chars of the digest. Two
 *  entries with the same content (and createdAt) get the same id. */
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
    createdAt: input.createdAt
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
    createdAt: input.createdAt
  };
  return seal(content) as LedgerReview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROPOSAL_FIELDS = ["from", "to", "title", "rationale", "targetFiles", "suggestedDiff", "createdAt"];
const REVIEW_FIELDS = ["from", "to", "target", "verdict", "findings", "createdAt"];

/** Fail-closed verification. Any structural defect, unknown kind, or digest
 *  mismatch yields `ok:false` — the caller refuses to act on it. */
export function verifyLedgerEntry(raw: unknown): LedgerVerifyResult {
  const checks: LedgerCheck[] = [];
  const fail = (name: string, code: string, detail?: string): LedgerVerifyResult => {
    checks.push({ name, pass: false, code, detail });
    return {
      ok: false,
      id: isRecord(raw) && typeof raw.id === "string" ? raw.id : null,
      kind: isRecord(raw) && typeof raw.kind === "string" ? raw.kind : null,
      checks,
      failedChecks: checks.filter((c) => !c.pass).map((c) => ({ name: c.name, code: c.code as string, detail: c.detail }))
    };
  };

  if (!isRecord(raw)) return fail("structure", "ledger-not-object", "entry is not a JSON object");
  checks.push({ name: "structure", pass: true });

  const kind = raw.kind;
  if (kind !== "proposal" && kind !== "review") return fail("kind", "ledger-unknown-kind", `kind must be proposal|review, got ${JSON.stringify(kind)}`);
  checks.push({ name: "kind", pass: true });

  if (raw.schemaVersion !== 1) return fail("schema", "ledger-bad-schema", `schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`);
  checks.push({ name: "schema", pass: true });

  if (typeof raw.digest !== "string" || !raw.digest) return fail("digest-present", "ledger-missing-digest", "digest is absent or not a string");
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

  return { ok: true, id: typeof raw.id === "string" ? raw.id : null, kind, checks, failedChecks: [] };
}
