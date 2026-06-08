# Team Collaboration

CW v0.1.32 adds Team Collaboration: a host-attested actor, append-only approvals,
rejections, comments, and handoffs, and a review gate that STACKS ON the verifier
gate. Before v0.1.32 there was no review/approval/comment/handoff/identity concept
anywhere; the foundations already existed — trust-audit recorded every decision
with an `actor`, candidate selection carried `selectedBy`, role policies existed,
and commits were verifier-gated. This release adds the human-decision layer ON TOP
of those mechanisms, without changing them and without taking ownership of source
truth.

The design follows the same base-system discipline as
[Security / Trust Hardening](security-trust-hardening.7.md) and the
[Verifier-Gated Commit](verifier-gated-commit.7.md):

- the per-run `.cw/runs/<id>/state.json` is the SINGLE source of truth
- collaboration records are an APPEND-ONLY log, never mutated in place
- identity is ATTESTED provenance, never authenticated; CW is not an auth server
- the review gate is POLICY layered on the verifier MECHANISM — never a bypass
- fail closed: missing authority, ambiguous role, or self-approval is a denial
- policy (required approvals, authorized roles, self-approval) is data, not kernel
- backward compatible; every collaboration field is additive and optional

## Identity is attested, not authenticated

An `Actor` is host-attested provenance, not an authenticated principal. CW records
WHO acted; it does not verify a password, a token, or a signature — that is a host
trust-boundary concern. `normalizeActor` maps an actor input to one of three
provenances: `host-attested` (the host vouched, `--attested`), `operator-recorded`
(supplied unverified), or `unattributed` (no identity supplied). An absent identity
becomes the explicit `unattributed` actor — `{ kind: "unattributed", id:
"unattributed", attested: false }` — never a fabricated one. Spoofing is recorded
honestly as whatever provenance the host attested, not hidden. This extends the
existing trust-audit `actor` string and the v0.1.29/v0.1.31 attestation pattern.

## Approvals and rejections are append-only and provenance-linked

`approve` and `reject` append an `ApprovalRecord` to `run.collaboration.approvals`.
Each record carries the actor, the decision, the durable target it attaches to, an
optional rationale, the role the actor claims, and `auditEventIds` linking it to a
`collaboration.approval`/`collaboration.rejection` event in the trust-audit log —
exactly as `candidate.selection` records both a `CandidateSelection` and an audit
event. The approved artifact (candidate/commit/selection) is NEVER edited in place:
"who approved what" is a provenance link, not a field overwrite. A correction is a
NEW record carrying `supersedes` (git-style); the superseded record stays in the
log, no longer counts, and the original is unchanged.

A target is one of `run | task | candidate | selection | commit | node`. "Who
approved which candidate/commit" is answered by filtering the append-only records
by target.

## The review gate stacks on the verifier gate

The verifier-gated commit is the MECHANISM (see
[Verifier-Gated Commit](verifier-gated-commit.7.md)): `resolveCommitGate` accepts a
commit only when a verified verifier node, a scored+verified candidate, and a
complete acceptance rationale are present. A review gate is POLICY layered on top.
`reviewGateErrors` runs INSIDE `resolveCommitGate`, AFTER the verifier checks, and
can only ADD errors — required approvals from authorized roles — never remove the
verifier's. The same call guards candidate selection in `selectCandidate`.

Data flow for a gated commit:

1. `resolveCommitGate` resolves the candidate/selection and runs every verifier
   check; if any fail the commit is blocked as before.
2. If a `ReviewGatePolicy` applies to `commit` (or `selection`), `reviewGateErrors`
   derives the review state over the approvals targeting the commit AND its
   underlying selection/candidate (you approve the candidate; the commit honors it).
3. If the review state is not `approved`, a single `review-gate-missing-approvals`
   StateNodeError is appended, listing exactly which approvals are missing.
   `commitState` throws `CommitGateError`, recorded as append-only feedback.
4. Only when BOTH gates pass is the commit written — and it is stamped with a
   `CommitReviewProvenance` recording WHO approved the very artifact that shipped.

Because the review errors are appended after the verifier errors and never replace
them, an approval can never turn an unverified result into a committed one: an
approved-but-unverified candidate is still blocked by the verifier gate.

## Fail closed on authority and quorum

`deriveReviewState` is a pure, deterministic projection of the append-only records
plus a policy. It counts ONLY approvals that are, all at once: from an attested
identity (when `requireAttestedActor`), from a role in `authorizedRoles` (or `*`),
and not a self-approval (when `allowSelfApproval` is false; "self" is the
candidate's producing worker and its selector). Distinct counted approvers must
reach `requiredApprovals`. Anything short is not auto-passed; the status is:

- `approved` — requirement met (or the target is not gated)
- `pending` — gated, no blocking reject, fewer than required counted approvals
- `blocked` — recorded approvals exist but none count (authority/self)
- `unattributed` — the only recorded approvals are from unattributed actors
- `rejected` — an authorized, attested reject is a blocking veto

Every disqualified approval is surfaced with its reason (`unattributed`,
`unauthorized-role`, `self-approval`, `superseded`), so a reader can audit why an
approval did not count. A target requiring N approvals with fewer recorded is
BLOCKED, and the block records exactly what is missing.

## Comments and handoffs are state, not chat

A `comment` appends a `CommentRecord` to a durable target with an actor, a thread
id, and an audit link; threads are ordered by `createdAt` and never edited in
place. A `handoff` appends a `HandoffRecord` — an explicit ownership transfer with
a from-actor, a to-actor, and a reason — and the current owner of a run/task is
DERIVED from the latest handoff, never an overwritten field. There is no side
channel: the collaboration IS the durable, inspectable state, consistent with CW's
no-hidden-dashboard-database rule.

## Policy as data, kept out of the kernel

`review policy <run-id>` writes a `ReviewGatePolicy` to `run.collaboration.policy`:
`requiredApprovals` (0 = no gate), `authorizedRoles` (`*` = any), `allowSelfApproval`,
`requireAttestedActor`, and `appliesTo` (target kinds). The default — absent policy
or `requiredApprovals: 0` — requires no approvals, so pre-v0.1.32 runs and any run
without a policy behave exactly as before. The policy is data; the kernel only
enforces the mechanism.

## One source, every surface

Each collaboration verb is declared once in `src/capability-registry.ts`, so
`cw <cmd> --json` is schema-identical to `cw_<cmd>` and passes the parity gate. The
read-only `review status` and `comment list` are byte-for-byte identical across CLI
and MCP (the payload-identity probe strips only ISO timestamps; the only
now-derived field in a review report is `generatedAt`). The v0.1.30 Workbench
renders the review timeline and per-target approval state read-only as a sixth
panel, embedding the `review status` payload verbatim. The v0.1.31 metrics report
adds derived approval-rate, time-to-approval, handoff-count, and reviewer-count,
all from recorded timestamps — deterministic over a fixed snapshot.

## Commands

```
cw review policy <run-id> --requiredApprovals N --authorizedRoles a,b --appliesTo commit,selection [--allowSelfApproval] [--requireAttestedActor]
cw approve <kind> <run-id> <target-id> --actor <id> --role <role> --attested [--rationale <text>]
cw reject  <kind> <run-id> <target-id> --actor <id> --role <role> --attested [--rationale <text>]
cw comment add <kind> <run-id> <target-id> --actor <id> --body <text>
cw comment list <run-id> [--json]
cw handoff <kind> <run-id> [target-id] --from <id> --to <id> --reason <text>
cw review status <run-id> [--json]
```

`<kind>` is one of `run | task | candidate | selection | commit | node`. Approve a
candidate (or selection), then commit `--candidate`/`--selection`; the commit gate
honors the candidate's approvals and records who approved the shipped commit.

CW is the base system. Workflow apps are userland. Collaboration adds the human
decision as durable, attested, append-only state — never a hidden dashboard, never
a bypass of the verifier gate.

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really execute (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is unavailable. See real-execution-backends(7).
