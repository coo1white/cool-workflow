# Security / Trust Hardening

CW v0.1.15 adds a local trust audit layer for worker sandbox decisions,
evidence provenance, candidate selection, and verifier-gated commits.
CW v0.1.22 uses this same layer again for multi-agent role policy, blackboard
write audit, message provenance, judge rationale, panel decisions, and policy
violations.

## Audit Records

Every run has an audit directory of its own:

```text
.cw/runs/<run-id>/audit/
  events.jsonl
  index.json
  summary.json
```

`events.jsonl` is made so you can add to the end. `index.json` and `summary.json` are
fixed, repeatable look files that CW commands make again.

Each event keeps a record of:

- schema version, event id, timestamp, run id, kind, decision, and source
- actor, worker id, task id, node id, candidate id, score id, selection id, or commit id when it has a part to play
- sandbox profile id and policy snapshot/reference
- normalized path, command, network target, or env variable names when they have a part to play
- evidence references and parent audit event ids
- feedback ids for denied or failed decisions

Event sources are clear:

- `cw-validated`: CW checked a policy or gate on the local machine.
- `host-attested`: the agent host or operator put down a record of what the host made certain.
- `operator-recorded`: a person or caller gave the record.
- `runtime-derived`: CW got the event from run state.

CW does not keep secrets or raw environment values. Environment audit records
keep names only.

## Enforcement Boundary

CW checks sandbox profiles, normalizes paths, checks worker output
acceptance, checks command/network/env decisions when asked, and keeps
lasting feedback for denied worker decisions.

The agent host must still make certain of OS-level read isolation, write isolation,
limits on process execution, limits on network, and environment filtering.
The audit layer lets you look at that boundary; it is not a kernel.

## CLI

```bash
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit worker <run-id> <worker-id>
node scripts/cw.js audit provenance <run-id> [--worker ID|--candidate ID|--commit ID]
node scripts/cw.js audit multi-agent <run-id>
node scripts/cw.js audit policy <run-id>
node scripts/cw.js audit role <run-id> <role-id>
node scripts/cw.js audit blackboard <run-id>
node scripts/cw.js audit judge <run-id>
node scripts/cw.js audit attest <run-id> --worker <worker-id> --hostEnforced true
node scripts/cw.js audit decision <run-id> <worker-id> --path <path>
node scripts/cw.js audit decision <run-id> <worker-id> --command "npm test"
node scripts/cw.js audit decision <run-id> <worker-id> --network example.com
node scripts/cw.js audit decision <run-id> <worker-id> --env SECRET_NAME
```

Denied audit decisions are put into audit files and joined to feedback/error
records. Environment values are cut back to names.

## Evidence Provenance

`StateEvidence` still works with older versions. v0.1.15 adds optional
`provenance` metadata that can point from:

```text
worker result -> result node -> verifier node -> candidate -> score -> selection -> commit
```

Candidate scores, selections, and verifier-gated commits keep provenance
links in place of only copying evidence arrays.

## Why Accepted

Selected candidates and verifier-gated commits come with an acceptance rationale:

- selected candidate id
- score id and score criteria
- verifier node id
- evidence count
- sandbox profile id
- worker id
- commit gate result
- audit event ids

Verifier-gated commits fail closed when the acceptance rationale is not able to make clear
the evidence chain.

## MCP

The MCP server gives these like tools:

- `cw_audit_summary`
- `cw_audit_worker`
- `cw_audit_provenance`
- `cw_audit_multi_agent`
- `cw_audit_policy`
- `cw_audit_role`
- `cw_audit_blackboard`
- `cw_audit_judge`
- `cw_audit_attest`
- `cw_audit_decision`

MCP tool names that are already there do not change.
0.1.51
