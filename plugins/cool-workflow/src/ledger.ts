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

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

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

  // Bind the id to the content: it MUST be the content-addressed id derived from
  // the digest. Without this, `id` is a free, unverified field (it is excluded
  // from the digest) — a forged entry could set `id` to collide with a legit
  // one, and any id-keyed de-duplication (`cw ledger list` union) would silently
  // drop one of them. Fail closed so a spoofed or absent id is refused, not
  // trusted.
  const expectedId = deriveId(raw.digest);
  if (raw.id !== expectedId) {
    return fail("id", "ledger-id-mismatch", `id ${JSON.stringify(raw.id)} is not the content-addressed id for this digest (expected ${expectedId})`);
  }
  checks.push({ name: "id", pass: true });

  return { ok: true, id: expectedId, kind, checks, failedChecks: [] };
}

export interface LedgerApplyResult {
  ok: boolean;
  id: string | null;
  kind: string | null;
  /** The verified proposal's unified diff, present ONLY when `ok` — a tampered,
   *  non-proposal, or diff-less entry yields `diff: null`. */
  diff: string | null;
  failedChecks: Array<{ name: string; code: string; detail?: string }>;
}

/** Fail-closed extraction of a proposal's `suggestedDiff` for `git apply`. The
 *  diff can ONLY escape after the entry verifies: a tampered entry, a review
 *  (not a proposal), or a proposal with no diff all yield `ok:false` and
 *  `diff:null`, so `cw ledger apply <file> | git apply` can never feed an
 *  unverified patch to git. The kernel never shells out to git — turning the
 *  diff into a patch stays the operator's step (mechanism, not policy). */
export function applyLedgerProposal(raw: unknown): LedgerApplyResult {
  const verified = verifyLedgerEntry(raw);
  if (!verified.ok) {
    return { ok: false, id: verified.id, kind: verified.kind, diff: null, failedChecks: verified.failedChecks };
  }
  if (verified.kind !== "proposal") {
    return { ok: false, id: verified.id, kind: verified.kind, diff: null, failedChecks: [{ name: "kind", code: "ledger-not-a-proposal", detail: "apply expects a proposal entry, not a review" }] };
  }
  const rec = isRecord(raw) ? raw : {};
  const diff = typeof rec.suggestedDiff === "string" ? rec.suggestedDiff : "";
  if (!diff) {
    return { ok: false, id: verified.id, kind: verified.kind, diff: null, failedChecks: [{ name: "diff", code: "ledger-empty-diff", detail: "proposal carries no suggestedDiff to apply" }] };
  }
  return { ok: true, id: verified.id, kind: verified.kind, diff, failedChecks: [] };
}

// ---------------------------------------------------------------------------
// Stage-2 git transport: a "ledger directory" is a folder (the working tree of
// a shared handoff repo both agents are scoped to) holding one `<id>.json` per
// entry. Writing is composition through files — `cw ledger propose > dir/x.json`
// then `git add/commit/push`, kept OUT of this kernel. Reading is the mechanism
// below: verify the whole inbox fail-closed before acting on any of it.
// ---------------------------------------------------------------------------

export interface LedgerListEntry {
  file: string;
  id: string | null;
  kind: string | null;
  from: string | null;
  to: string | null;
  /** Proposal title (proposals only); null otherwise. Additive triage field so
   *  an inbox is readable without opening each file. */
  title: string | null;
  /** The proposal id / PR ref a review answers (reviews only); null otherwise. */
  target: string | null;
  /** A review's verdict, APPROVED|REJECTED (reviews only); null otherwise. */
  verdict: string | null;
  ok: boolean;
  failedChecks: Array<{ name: string; code: string; detail?: string }>;
}

/** How a proposal stands, derived from the review(s) that target it. */
export type LedgerResolutionState = "pending" | "approved" | "rejected" | "contested";

export interface LedgerProposalResolution {
  id: string;
  title: string | null;
  /** pending = no verified review targets it; approved/rejected = every verified
   *  review targeting it agrees; contested = verified reviews disagree. */
  resolution: LedgerResolutionState;
  /** ids of the verified reviews whose `target` is this proposal. */
  reviews: string[];
}

/** A machine-actionable summary of an inbox: which proposals are still open and
 *  which are decided. Reports the decision; it does NOT enforce policy (whether a
 *  REJECTED verdict blocks a merge stays outside the kernel — mechanism, not
 *  policy). */
export interface LedgerInboxResolution {
  proposals: LedgerProposalResolution[];
  pending: number;
  approved: number;
  rejected: number;
  contested: number;
}

export interface LedgerListResult {
  dir: string;
  count: number;
  allOk: boolean;
  entries: LedgerListEntry[];
  resolution: LedgerInboxResolution;
}

/** Read every `*.json` in `dir`, verify each entry fail-closed, and report.
 *  `allOk` is false if any entry is tampered, malformed, or unreadable — so the
 *  receiving side refuses the whole inbox rather than acting on a mixed batch. */
export function listLedgerEntries(dir: string): LedgerListResult {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (error) {
    const entry: LedgerListEntry = { file: dir, id: null, kind: null, from: null, to: null, title: null, target: null, verdict: null, ok: false, failedChecks: [{ name: "dir", code: "ledger-dir-unreadable", detail: (error as Error).message }] };
    return { dir, count: 0, allOk: false, entries: [entry], resolution: resolveLedgerInbox([entry]) };
  }
  const entries: LedgerListEntry[] = names.map((name) => {
    const file = path.join(dir, name);
    let raw: unknown;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) {
        return { file: name, id: null, kind: null, from: null, to: null, title: null, target: null, verdict: null, ok: false, failedChecks: [{ name: "file", code: "ledger-entry-not-regular" }] };
      }
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return { file: name, id: null, kind: null, from: null, to: null, title: null, target: null, verdict: null, ok: false, failedChecks: [{ name: "parse", code: "ledger-bad-json" }] };
    }
    const result = verifyLedgerEntry(raw);
    const rec = isRecord(raw) ? raw : {};
    return {
      file: name,
      id: result.id,
      kind: result.kind,
      from: typeof rec.from === "string" ? rec.from : null,
      to: typeof rec.to === "string" ? rec.to : null,
      title: typeof rec.title === "string" ? rec.title : null,
      target: typeof rec.target === "string" ? rec.target : null,
      verdict: typeof rec.verdict === "string" ? rec.verdict : null,
      ok: result.ok,
      failedChecks: result.failedChecks
    };
  });
  return { dir, count: entries.length, allOk: entries.every((e) => e.ok), entries, resolution: resolveLedgerInbox(entries) };
}

export interface LedgerUnionEntry extends LedgerListEntry {
  /** Which mirror directories this entry appeared in (a verified entry can be in
   *  several mirrors; content-addressing guarantees they are the same entry). */
  dirs: string[];
}

export interface LedgerUnionResult {
  dirs: string[];
  count: number;
  allOk: boolean;
  entries: LedgerUnionEntry[];
  resolution: LedgerInboxResolution;
}

/** Union-verify several mirror directories into ONE fail-closed inbox. Verified
 *  entries are de-duplicated by their content-addressed id (the same entry
 *  mirrored to N hosts collapses to one, recording every mirror it came from);
 *  failing entries are kept per-occurrence so every problem in every mirror is
 *  visible. `allOk` is false if ANY entry in ANY mirror does not verify — a
 *  tampered mirror fails the whole batch. Safe because entries are immutable and
 *  content-addressed, so a union is a conflict-free set-union, not a merge. */
export function unionLedgerEntries(dirs: string[]): LedgerUnionResult {
  const byId = new Map<string, LedgerUnionEntry>();
  const failures: LedgerUnionEntry[] = [];
  let allOk = true;
  for (const dir of dirs) {
    const listed = listLedgerEntries(dir);
    if (!listed.allOk) allOk = false;
    for (const entry of listed.entries) {
      if (entry.ok && entry.id) {
        const existing = byId.get(entry.id);
        if (existing) {
          if (!existing.dirs.includes(dir)) existing.dirs.push(dir);
        } else {
          byId.set(entry.id, { ...entry, dirs: [dir] });
        }
      } else {
        failures.push({ ...entry, dirs: [dir] });
      }
    }
  }
  const entries = [...byId.values(), ...failures];
  return { dirs, count: entries.length, allOk, entries, resolution: resolveLedgerInbox(entries) };
}

/** Derive a machine-actionable inbox summary: pair each proposal with the
 *  review(s) that target it and report whether it is pending, approved,
 *  rejected, or contested. Only VERIFIED entries take part — a tampered review
 *  must never resolve a proposal, so a proposal with only a failing review
 *  stays `pending` (fail-closed). Pure derivation over content-addressed
 *  entries: no git, no network, no policy (it reports the decision, it does not
 *  enforce one). */
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
        reviews: answering.map((r) => r.id as string).sort()
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const tally = (s: LedgerResolutionState) => proposals.filter((p) => p.resolution === s).length;
  return {
    proposals,
    pending: tally("pending"),
    approved: tally("approved"),
    rejected: tally("rejected"),
    contested: tally("contested")
  };
}
