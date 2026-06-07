# CANDIDATE-SCORING(7)

## NAME

Candidate Scoring - inspectable decision support for competing CW outputs

## SYNOPSIS

```ts
import {
  registerCandidate,
  scoreCandidate,
  rankCandidates,
  selectCandidate
} from "./candidate-scoring";

registerCandidate(run, { workerId, taskId, resultNodeId, verifierNodeId });
scoreCandidate(run, candidateId, {
  scorer: "verifier",
  criteria: { correctness: 4, evidence: 4, fit: 2 },
  maxTotal: 10,
  evidence: [{ id: "score:evidence", source: "test", locator: "test/file.js:1" }]
});
rankCandidates(run);
selectCandidate(run, candidateId);
```

```text
node dist/cli.js candidate register <run-id> --worker <worker-id>
node dist/cli.js candidate score <run-id> <candidate-id> --criterion correctness=4 --evidence path:line
node dist/cli.js candidate rank <run-id>
node dist/cli.js candidate select <run-id> <candidate-id>
```

## DESCRIPTION

Candidate Scoring is the small decision-support layer between isolated worker
outputs, result nodes, verifier evidence, candidate scores, selected winners,
ErrorFeedback, and commit/report.

It does not merge code, replace verifier judgment, spawn workers, or provide a
domain-specific ranking policy. A score is evidence, not authority.

The normal flow is:

```text
worker output -> candidate record -> score record -> ranking
-> verifier-gated selection -> checkpoint/report
```

Each step writes plain JSON. Rejected and failed candidates remain inspectable.

## FILES

```text
.cw/runs/<run-id>/candidates/index.json
.cw/runs/<run-id>/candidates/ranking.json
.cw/runs/<run-id>/candidates/<candidate-id>/candidate.json
.cw/runs/<run-id>/candidates/<candidate-id>/scores/<score-id>.json
.cw/runs/<run-id>/candidates/selections/<selection-id>.json
.cw/runs/<run-id>/nodes/
.cw/runs/<run-id>/feedback/
.cw/runs/<run-id>/report.md
```

Candidate records point at existing worker, result, verifier, and artifact
paths. They do not copy large worker outputs by default.

## SELECTION GATE

Selection is conservative by default:

- score records require evidence
- selection requires a linked verifier node with `verified` status
- selection failures become ErrorFeedback records
- rejected candidates remain on disk

Operators can record an unverified selection only with an explicit option. That
records selection state but does not turn the candidate into committed state.

## FAILURE MODES

Missing score evidence fails scoring and records feedback.

Selecting a failed or rejected candidate fails and records feedback.

Selecting without a verified verifier node fails unless explicitly allowed.

Tie-breaking is predictable: higher normalized score wins; equal scores use the
configured tie breaker, defaulting to earlier candidate creation time.

## COMPATIBILITY

Candidate Scoring is introduced in CW v0.1.6. It adds optional candidate paths
and arrays to run state. Older runs remain readable because missing candidate
fields are initialized when state loads.

Existing workflow, worker, feedback, node, contract, result, commit, and report
commands remain compatible.
