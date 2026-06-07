# Getting Started

From a fresh clone:

```bash
cd plugins/cool-workflow
npm install
npm run build
node scripts/cw.js app list
```

Create a run with a canonical workflow app:

```bash
node scripts/cw.js plan release-cut \
  --repo "$PWD" \
  --version 0.1.23 \
  --previousVersion 0.1.22 \
  --releaseBranch main \
  --dryRun true
```

Use the returned run id:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js dispatch <run-id> --limit 1 --sandbox readonly
node scripts/cw.js worker summary <run-id>
node scripts/cw.js topology list
node scripts/cw.js topology apply <run-id> map-reduce --task <task-id>
node scripts/cw.js topology summary <run-id>
node scripts/cw.js multi-agent run <run-id> --topology judge-panel --task <task-id>
node scripts/cw.js multi-agent status <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js multi-agent dependencies <run-id>
node scripts/cw.js multi-agent failures <run-id>
node scripts/cw.js multi-agent evidence <run-id>
node scripts/cw.js multi-agent step <run-id> --sandbox readonly
node scripts/cw.js multi-agent blackboard <run-id> summary
node scripts/cw.js multi-agent score <run-id> <candidate-id> --criterion correctness=1 --evidence <ref>
node scripts/cw.js multi-agent select <run-id> <candidate-id> --reason "verified winner"
node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js blackboard summary <run-id>
node scripts/cw.js audit summary <run-id>
node scripts/cw.js audit multi-agent <run-id>
node scripts/cw.js audit policy <run-id>
node scripts/cw.js audit blackboard <run-id>
node scripts/cw.js audit judge <run-id>
node scripts/cw.js eval snapshot <run-id> --id <suite-id>
node scripts/cw.js eval replay .cw/evals/<suite-id>/snapshot.json
node scripts/cw.js eval compare .cw/evals/<suite-id>/snapshot.json .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js eval score .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js eval gate .cw/evals/<suite-id>
node scripts/cw.js eval report .cw/evals/<suite-id>/replay-run.json
node scripts/cw.js report <run-id> --show
```

Run the deterministic regression commands:

```bash
npm run check
npm test
npm run canonical-apps
npm run golden-path
npm run eval:replay
npm run fixture-compat
```

Before cutting a release, run the full dry-run gate:

```bash
npm run release:check
npm run dogfood:release
```

The release check is non-destructive. It builds, type-checks, runs tests,
validates canonical apps and golden path behavior, checks old fixture
compatibility, verifies docs, runs the dogfood smoke proof, and checks version
synchronization. It does not tag, push, publish, or rewrite fixture files.

`npm run dogfood:release` is the real-repository release proof. It uses the
canonical `release-cut` app against this repository in dry-run mode, records CW
worker outputs from real command logs, scores and selects a release candidate,
creates a verifier-gated CW state commit, and writes
`.cw/runs/<run-id>/dogfood-summary.json`.

Trust audit records live under `.cw/runs/<run-id>/audit/`. CW records the
sandbox profile used by each worker, allowed and denied decisions, evidence
provenance, and why selected candidates or verifier-gated commits were
accepted. Multi-agent trust records add role policy, blackboard write audit,
message provenance, judge rationale, and policy violations. Inspect them with
`audit summary`, `audit worker`, `audit provenance`, `audit multi-agent`,
`audit policy`, `audit blackboard`, and `audit judge`.

Eval/replay artifacts live under `.cw/evals/<suite-id>/`. They let a release
gate prove replay completion, graph/dependency parity, evidence adoption,
trust/policy/audit parity, judge rationale, candidate scoring, selection, and
verifier-gated commit readiness without running live agents.
