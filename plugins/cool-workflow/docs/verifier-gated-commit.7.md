# VERIFIER-GATED-COMMIT(7)

## NAME

Verifier-Gated Commit - commit only state that passed an evidence-backed verifier

## SYNOPSIS

```text
node dist/cli.js commit <run-id> --verifier <node-id> --reason "verified result"
node dist/cli.js commit <run-id> --candidate <candidate-id> --reason "promote selected candidate"
node dist/cli.js commit <run-id> --selection <selection-id> --reason "promote selected candidate"
node dist/cli.js commit <run-id> --allow-unverified-checkpoint --reason "operator checkpoint"
```

```ts
import { commitState } from "./commit";

commitState(run, {
  reason: "verified result",
  verifierNodeId: `${run.id}:verifier:task-one`,
  verifierGated: true
});
```

## DESCRIPTION

Verifier-Gated Commit is the CW rule that separates committed state from
ordinary checkpoints:

```text
only verified state becomes committed state
```

A verifier-gated commit requires one of these inputs:

- a `verifier` state node with `verified` status and evidence
- a verified candidate selection that references such a verifier node
- a selected candidate whose selection references such a verifier node

The verifier gate is authoritative. Candidate scores are evidence for operator
choice, not authority to commit state.

## CHECKPOINTS

CW still writes internal snapshots for planning, dispatch, result recording, and
operator checkpoints. These records are checkpoints. They are useful for audit,
resume, and rollback, but they are not verifier-gated committed state.

Checkpoint records have:

```json
{
  "verifierGated": false,
  "checkpoint": true
}
```

Checkpoint state nodes use `kind: "commit"` and `status: "completed"`. A
verifier-gated commit state node uses `status: "committed"`.

## COMMIT RECORDS

A verifier-gated commit records gate metadata in the commit JSON and state node:

```json
{
  "verifierGated": true,
  "checkpoint": false,
  "verifierNodeId": "run:verifier:task",
  "candidateId": "candidate-one",
  "selectionId": "selection-candidate-one-...",
  "evidence": []
}
```

The `candidateId` and `selectionId` fields are present when the commit promotes
a candidate or candidate selection. The `evidence` field is copied from the
verifier node.

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/commits/<commit-id>.json
.cw/runs/<run-id>/nodes/<commit-node-id>.json
.cw/runs/<run-id>/feedback/<feedback-id>.json
.cw/runs/<run-id>/report.md
```

Every blocked commit attempt records an `error` state node and an ErrorFeedback
record before the command exits.

## FAILURE MODES

The commit gate fails closed.

Common feedback codes:

```text
commit-verifier-required
commit-verifier-not-found
commit-verifier-wrong-kind
commit-verifier-not-verified
commit-verifier-missing-evidence
commit-candidate-not-found
commit-candidate-not-selectable
commit-candidate-unscored
commit-candidate-not-verified
commit-candidate-selection-missing
commit-selection-not-found
commit-selection-node-missing
commit-selection-not-verified
commit-verifier-linkage-mismatch
```

Use `cw.js feedback list <run-id>` and `cw.js node graph <run-id>` to inspect
the failed transition.

## CANDIDATES

A candidate can become committed state only after selection passes the verifier
gate. Rejected, failed, unscored, unselected, or unverified candidates are
blocked.

The normal candidate path is:

```text
candidate record -> score record -> verified selection -> verifier-gated commit
```

## COMPATIBILITY

Verifier-Gated Commit is introduced in CW v0.1.7. It adds optional fields to
commit records and keeps older run state readable.

Programmatic snapshots that do not request a verifier gate remain checkpoints.
The CLI `commit` command is stricter: a plain manual commit fails closed unless
the operator passes `--allow-unverified-checkpoint`.
0.1.51
