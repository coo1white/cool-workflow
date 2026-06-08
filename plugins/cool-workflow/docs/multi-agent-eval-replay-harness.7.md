# Multi-Agent Eval & Replay Harness

CW v0.1.23 added a deterministic replay harness for topology-backed
multi-agent runs. It turns a completed run into plain JSON evidence that can be
replayed without live agents, compared with normalized rules, scored, and used
as a release gate.

CW v0.1.25 extends the harness with State Explosion Management metrics so the
derived summary layer is regression-gated alongside the raw run:
`summary_freshness`, `compact_graph_parity`, `blackboard_digest_parity`,
`critical_path_parity`, `evidence_digest_parity`, and `expansion_ref_integrity`.
Pre-0.1.25 snapshots load with empty summary sections, so old fixtures stay
backward compatible. See
[state-explosion-management.7.md](state-explosion-management.7.md).

CW v0.1.26 adds Evidence Adoption Reasoning Chain metrics: `reasoning_freshness`,
`reasoning_chain_parity`, and `reasoning_unexplained_parity`. Pre-0.1.26
snapshots load with empty reasoning sections. See
[evidence-adoption-reasoning-chain.7.md](evidence-adoption-reasoning-chain.7.md).

The harness is intentionally file-first:

- snapshots, replay runs, comparisons, scores, findings, gates, and reports are
  stored under `.cw/evals/<suite-id>/`
- the baseline run is not mutated during replay
- replay output is written to an isolated `replay/` directory
- every CLI command supports deterministic JSON with `--json` or
  `--format json`
- MCP tools return JSON only and include generated artifact paths

## Commands

Create a snapshot from a multi-agent run:

```bash
node scripts/cw.js eval snapshot <run-id> --id <suite-id>
node scripts/cw.js eval snapshot <run-id> --id <suite-id> --json
```

Replay without live agents:

```bash
node scripts/cw.js eval replay .cw/evals/<suite-id>/snapshot.json
```

Compare, score, gate, and report:

```bash
node scripts/cw.js eval compare \
  .cw/evals/<suite-id>/snapshot.json \
  .cw/evals/<suite-id>/replay-run.json

node scripts/cw.js eval score .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js eval gate .cw/evals/<suite-id>
node scripts/cw.js eval report .cw/evals/<suite-id>/replay-run.json
```

`npm run eval:replay` runs the deterministic smoke suite and is included in
`npm test` and `npm run release:check`.

Human output uses stable panels:

```text
Eval Suite
Replay Status
Graph Comparison
Evidence Comparison
Trust / Policy / Audit Comparison
Candidate Score Comparison
Selection / Commit Gate
Regression Findings
Final Verdict
Next Action
```

## Artifacts

Each suite writes predictable files:

- `suite.json`
- `snapshot.json`
- `replay-run.json`
- `comparison.json`
- `score.json`
- `findings.json`
- `gate.json`
- `report.md`

The snapshot captures workflow app identity, inputs, topology shape, roles,
groups, memberships, fanout/fanin state, blackboard records, worker outputs,
candidate scores, selection rationale, verifier-gated commit inputs,
trust/policy/audit records, expected operator summaries, evidence adoption, and
report sections.

## Comparison Rules

The comparison checks:

- topology id and topology run shape
- roles, groups, memberships, fanout, and fanin records
- dependency edges and failure rows
- blackboard records and message provenance
- role policies, permission decisions, write audit, judge rationale, panel
  decisions, and policy violations
- evidence adoption status
- candidate scores, selected candidate, and selection rationale
- verifier-gated commit readiness
- report sections

Normalization removes unstable paths, timestamps, generated temp roots, and
machine-local directories. It does not hide changed evidence, policy,
selection, scoring, or commit-gate behavior.

## Scoring

Scores are deterministic metrics:

- `replay_completed`
- `graph_parity`
- `role_parity`
- `group_parity`
- `membership_parity`
- `fanout_parity`
- `fanin_parity`
- `dependency_parity`
- `failure_parity`
- `blackboard_record_parity`
- `evidence_adoption_parity`
- `trust_audit_parity`
- `role_policy_parity`
- `permission_decision_parity`
- `policy_violation_parity`
- `blackboard_provenance_parity`
- `judge_rationale_parity`
- `panel_decision_parity`
- `candidate_score_parity`
- `selection_parity`
- `verifier_commit_gate_parity`
- `report_parity`

Each metric returns `id`, `status`, `score`, `maxScore`, `reason`, evidence
refs, baseline refs, and replay refs.

## Gate

`eval gate` fails closed when replay artifacts are missing or when comparison
findings show a regression. This includes missing judge rationale, changed
selected candidate, changed evidence adoption, changed policy violations,
missing provenance, lost verifier-gated commit readiness, or graph/dependency
loss.

Improvements can be represented as changed findings in future suites, but they
must be visible in `score.json`, `findings.json`, and `report.md` before a
release gate can accept them.

## MCP Parity

The MCP surface mirrors the CLI:

- `cw_eval_snapshot`
- `cw_eval_replay`
- `cw_eval_compare`
- `cw_eval_score`
- `cw_eval_gate`
- `cw_eval_report`

MCP responses are deterministic JSON and include artifact paths.

## Release Use

Use this harness after a topology-backed run reaches score, selection, and a
verifier-gated commit:

```bash
node scripts/cw.js eval snapshot <run-id> --id release-replay
node scripts/cw.js eval replay .cw/evals/release-replay/snapshot.json
node scripts/cw.js eval compare .cw/evals/release-replay/snapshot.json .cw/evals/release-replay/replay-run.json
node scripts/cw.js eval score .cw/evals/release-replay/replay-run.json
node scripts/cw.js eval gate .cw/evals/release-replay
node scripts/cw.js eval report .cw/evals/release-replay/replay-run.json
```

The gate proves the replay completed, graph/dependencies stayed stable,
evidence adoption stayed traceable, trust/policy/audit records remained
explainable, judge rationale is present, scoring/selection did not regress, and
verifier-gated commit readiness still holds.
## CLI ↔ MCP Parity (v0.1.27)

Every command and tool referenced above is declared in the v0.1.27 capability
registry (`src/capability-registry.ts`) and validated by `npm run parity:check`,
so `cw <cmd> --json` and the matching `cw_<tool>` result render one data source.
See [cli-mcp-parity.7.md](cli-mcp-parity.7.md).
