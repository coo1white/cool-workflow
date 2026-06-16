# CANDIDATE-SCORING(7)

## NAME

Candidate Scoring - decision support you can look into for competing CW outputs

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

Candidate Scoring is the small decision-support layer that sits between isolated
worker outputs, result nodes, verifier evidence, candidate scores, selected
winners, ErrorFeedback, and commit/report.

It does not put code together, take the place of verifier judgment, start
workers, or give a domain-specific way to rank. A score is evidence, not power
to decide.

The normal flow is:

```text
worker output -> candidate record -> score record -> ranking
-> verifier-gated selection -> checkpoint/report
```

Each step writes plain JSON. Rejected and failed candidates are still open to view.

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

Candidate records point at worker, result, verifier, and artifact paths that
are already there. They do not make a copy of large worker outputs by default.

## SELECTION GATE

Selection is careful by default:

- score records need evidence
- selection needs a linked verifier node with `verified` status
- selection failures become ErrorFeedback records
- rejected candidates stay on disk

Operators can record an unverified selection only with a clear option. That
records selection state but does not make the candidate into committed state.

Committed state has a harder rule. A candidate can be moved up by
`cw.js commit --candidate` or `cw.js commit --selection` only when it has score
evidence, a verified selection, and a linked verifier node with evidence.
Rejected, failed, unscored, unselected, and unverified candidates are stopped
and produce ErrorFeedback.

## FAILURE MODES

Missing score evidence makes scoring fail and records feedback.

Selecting a failed or rejected candidate fails and records feedback.

Selecting without a verified verifier node fails unless it is clearly allowed.

Tie-breaking works in a way you can be certain of: the higher normalized score
wins; equal scores use the configured tie breaker, which goes by default to the
earlier candidate creation time.

## COMPATIBILITY

Candidate Scoring comes in with CW v0.1.6. It adds optional candidate paths
and arrays to run state. Older runs are still readable because missing candidate
fields are initialized when state loads.

Existing workflow, worker, feedback, node, contract, result, commit, and report
commands go on working as before.
0.1.51
