# VERIFIER-GATED-COMMIT(7)

## NAME

Verifier-Gated Commit - commit only state that got past an evidence-backed verifier

## SYNOPSIS

```text
node dist/cli.js commit <run-id> --verifier <node-id> --reason "verified result"
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

Verifier-Gated Commit is the CW rule that keeps committed state apart from
normal checkpoints:

```text
only verified state becomes committed state
```

A verifier-gated commit needs a `verifier` state node with `verified` status
and evidence, named with `--verifier <node-id>` (or found from a
`result:<task-id>` reason whose task has a verifier node).

The verifier gate has the final say.

The `--candidate` and `--selection` inputs went with the multi-agent family
(see release-and-migration(7), "Removed Surfaces"). A commit that passes
one of them now fails closed with `commit-verifier-required`.

## CHECKPOINTS

CW still writes inside snapshots for planning, dispatch, result recording, and
operator checkpoints. These records are checkpoints. They are good for audit,
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

A verifier-gated commit writes gate metadata in the commit JSON and state node:

```json
{
  "verifierGated": true,
  "checkpoint": false,
  "verifierNodeId": "run:verifier:task",
  "evidence": []
}
```

The `evidence` field is copied from the verifier node. A commit record that an
older CW wrote may still carry `candidateId` and `selectionId`; they are kept
as data and read by `cw audit provenance`.

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/commits/<commit-id>.json
.cw/runs/<run-id>/nodes/<commit-node-id>.json
.cw/runs/<run-id>/feedback/<feedback-id>.json
.cw/runs/<run-id>/report.md
```

Every blocked commit try writes an `error` state node and an ErrorFeedback
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
commit-verifier-evidence-ungrounded
commit-verifier-evidence-unresolvable
commit-rationale-empty-capture
```

Use `cw feedback list <run-id>` and `cw node graph <run-id>` to look at
the failed transition.

## COMPATIBILITY

Verifier-Gated Commit comes in with CW v0.1.7. It adds optional fields to
commit records and keeps older run state readable.

Programmatic snapshots that do not ask for a verifier gate stay checkpoints.
The CLI `commit` command is more strict: a plain by-hand commit fails closed unless
the operator passes `--allow-unverified-checkpoint`.
0.1.51
