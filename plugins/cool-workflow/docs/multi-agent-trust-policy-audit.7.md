# Multi-Agent Trust / Policy / Audit

CW v0.1.22 extends the existing trust-audit layer with first-class
multi-agent policy, provenance, blackboard write audit, and judge rationale.
It does not introduce a second audit subsystem.
CW v0.1.24 includes these trust projections in eval/replay comparison so
missing provenance, changed policy violations, or missing judge rationale fail
the regression gate.

## Model

Multi-agent trust state is plain JSON attached to existing records:

- `AgentRole.policy`
- `AgentGroup.policy`
- `AgentMembership.policy`
- blackboard message `provenance`
- candidate score and selection audit links
- append-friendly trust events in `.cw/runs/<run-id>/audit/events.jsonl`

Policies describe explicit authority:

- allowed blackboard topic ids
- allowed write operations: `message`, `context`, `artifact`, `snapshot`,
  `coordinator-decision`
- allowed candidate operations: `register`, `score`, `select`
- allowed judge operations: `verdict`, `rationale`, `panel-decision`
- sandbox profile hints
- required evidence refs for privileged actions
- denied operations and reasons

Missing policy, missing role authority, out-of-scope topics, missing evidence,
or missing judge rationale fail closed and create audit records.

## Audit Events

The existing audit log records multi-agent dimensions with stable ids:

- `multi-agent.role-policy`
- `multi-agent.permission`
- `blackboard.write`
- `blackboard.message-provenance`
- `judge.rationale`
- `judge.panel-decision`
- `policy.violation`

Events carry ids such as `multiAgentRunId`, `agentRoleId`, `agentGroupId`,
`agentMembershipId`, `agentFanoutId`, `agentFaninId`, blackboard record ids,
candidate/score/selection/commit ids, topology ids, `sandboxProfileId`, and
`policyRef` when relevant.

Audit events do not copy large blackboard bodies. Message provenance stores
author kind/id, role/group/membership/worker ids when known, source, linked
evidence refs, parent message ids, topic scope, a body hash, and a short
summary.

## Blackboard Writes

Every blackboard write is audited:

- topic create/update
- message post
- context put/supersede/conflict
- artifact add
- snapshot create
- coordinator decision

The audit record says who wrote, under which role or membership, which policy
allowed or denied it, what evidence was cited, what record changed, and whether
the write was accepted, denied, superseded, conflicting, or blocked.

Denied writes are rejected before state mutation and are visible through
`policy.violation` and `blackboard.write` audit projections.

## Judge Rationale

Judge-panel scoring requires evidence and rationale. Panel selection requires
score evidence and chair rationale. Accepted judge and panel records cite the
score, candidate, evidence refs, role policy, and parent audit events.

Missing rationale or evidence blocks score, selection, fanin readiness, and
verifier-gated commit readiness where those gates depend on judge evidence.

## CLI

Existing commands remain compatible:

```bash
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit provenance <run-id>
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent evidence <run-id>
```

Focused views:

```bash
node scripts/cw.js audit multi-agent <run-id>
node scripts/cw.js audit policy <run-id>
node scripts/cw.js audit role <run-id> <role-id>
node scripts/cw.js audit blackboard <run-id>
node scripts/cw.js audit judge <run-id>
```

Use `--json` or `--format json` for deterministic machine output.

Human output includes stable panels:

- Multi-Agent Trust
- Role Policies
- Permission Decisions
- Blackboard Write Audit
- Message Provenance
- Judge Rationales
- Policy Violations
- Next Action

## Verify (fail-closed)

`audit summary` embeds an `integrity` field but is a *reader* — it always exits 0,
so it cannot gate a script. `audit verify` is the gate:

```bash
node scripts/cw.js audit verify <run-id>        # exit 1 if the chain is forged
node scripts/cw.js audit verify <run-id> --json
```

It re-proves the run's trust-audit hash chain offline: it recomputes every event
hash from genesis, checks `prevEventHash` linkage, and catches the unchained-event
forgery (an `eventHash`-less line slipped into a chained log to be waved through as
"legacy"). The JSON reports `present`, `verified`, `eventCount`, `chained`,
`unchained`, `corruptLines`, and `failedChecks[]`.

Exit-code contract (the peer of `telemetry verify`):

- ANY **unverified** chain exits **1** — forged / edited / truncated / unchained-injected,
  *and* a fully-corrupt log (every line unparseable, which reports `present:false` but
  `verified:false`). The gate keys on `verified`, not `present`, so the most severe
  tamper — garbling the whole log — cannot escape by looking "absent". So
  `cw audit verify <run> && deploy` stops on tampering.
- Only a truly **absent / empty** chain is `verified:true` / exit **0** — a run with
  no audit log (or a blank one) has nothing to prove (no false-red).

## MCP

MCP parity tools:

- `cw_audit_multi_agent`
- `cw_audit_policy`
- `cw_audit_role`
- `cw_audit_blackboard`
- `cw_audit_judge`

The older audit tools remain available:

- `cw_audit_summary`
- `cw_audit_verify` — fail-closed re-prove of the trust-audit hash chain (peer of `cw_telemetry_verify`)
- `cw_audit_worker`
- `cw_audit_provenance`
- `cw_audit_attest`
- `cw_audit_decision`

## Operator Questions

The combined `multi-agent status`, `multi-agent evidence`, `report --show`,
`audit summary`, and `audit provenance` views answer:

- Which role was allowed to do this?
- Which blackboard message came from which role, member, or worker?
- Which write was denied and why?
- Which judge rationale was accepted?
- Why was this selected result trusted?

## Regression

`test/multi-agent-trust-policy-audit-smoke.js` creates a judge-panel run with
allowed and denied blackboard writes, message provenance, role/membership/worker
links, accepted judge rationale, missing-rationale and missing-evidence failure
paths, CLI output assertions, MCP parity assertions, report assertions, and
audit provenance assertions.
0.1.51
