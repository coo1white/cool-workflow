# Getting Started

Start from a new clone:

```bash
cd plugins/cool-workflow
npm install
npm run build
node scripts/cw.js app list
```

## Check your setup first (`cw doctor`)

Like `brew doctor`, this names any setup problem and the fix for it before you
start a run:

```bash
node scripts/cw.js doctor          # human-readable
node scripts/cw.js doctor --json   # stable payload for scripts
node scripts/cw.js doctor --onramp # short path for users and code work
node scripts/cw.js doctor --onramp --changed-from origin/main
```

It checks the Node version (v18+), whether an agent backend is set up (and its
binary is on `$PATH`), whether `git` is there (for commit provenance), and
whether the home registry and the working-dir `.cw` state are writable. It is
read-only — it makes nothing on disk. It exits non-zero only on a blocking
problem; a missing agent is a warning (you are still able to run `demo` and
`--preview`).

Use `--onramp` when you are not certain what to do next. It keeps the main path
small:

1. `cw demo tamper` - prove the trust check with no agent.
2. `cw quickstart architecture-review --check ...` - check a real run with no
   writes.
3. `cw quickstart architecture-review ...` - make the report.
4. `cw quickstart architecture-review ... --bundle` - make a portable report
   file for another person.
5. `cw report verify-bundle report.cwrun.json` - check that file offline.
6. `npm run test:fast` - use the fast code check while you work.
7. `npm run release:check` - use the full gate only when the batch is ready.

Add `--changed-from origin/main` in a source checkout to get the nearest smoke
tests and guard checks for your current change.

Make a run with a canonical workflow app:

```bash
node scripts/cw.js plan release-cut \
  --repo "$PWD" \
  --version 0.1.25 \
  --previousVersion 0.1.24 \
  --releaseBranch main \
  --dryRun true
```

Use the run id you get back:

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

Run the smallest check that fits the change:

```bash
npm run check
npm run build
node test/<nearest-smoke>.js
npm run onramp:check
npm run test:fast
npm test                    # slow serial backstop
npm run canonical-apps
npm run golden-path
npm run eval:replay
npm run fixture-compat
```

When a test run is slow, make a read-only timing report:

```bash
npm run test:ci -- --json-summary /tmp/cw-test-summary.json
```

Use the `slowest` list in that file to choose one test-speed cycle. This is a
guide, not a release gate.

For a CLI or MCP surface change, also run:

```bash
npm run parity:check
npm run gen:manifests -- --check
```

Before you cut a release, run the full dry-run gate:

```bash
npm run release:check
npm run dogfood:release
```

The release check does not damage anything. It builds, type-checks, runs tests,
validates canonical apps and golden path behavior, checks old fixture
compatibility, verifies docs, runs the dogfood smoke proof, and checks that the
version numbers are in agreement. It does not tag, push, publish, or rewrite fixture files.

`npm run dogfood:release` is the release proof on the real repository. It uses the
canonical `release-cut` app against this repository in dry-run mode, records CW
worker outputs from real command logs, scores and picks a release candidate,
makes a verifier-gated CW state commit, and writes
`.cw/runs/<run-id>/dogfood-summary.json`.

Trust audit records are kept under `.cw/runs/<run-id>/audit/`. CW records the
sandbox profile used by each worker, allowed and denied decisions, where the
evidence came from, and why picked candidates or verifier-gated commits were
taken. Multi-agent trust records add role policy, blackboard write audit,
where each message came from, judge reasons, and policy violations. Look at them with
`audit summary`, `audit worker`, `audit provenance`, `audit multi-agent`,
`audit policy`, `audit blackboard`, and `audit judge`.

Eval/replay artifacts are kept under `.cw/evals/<suite-id>/`. They let a release
gate prove replay completion, graph/dependency parity, evidence adoption,
trust/policy/audit parity, judge reasons, candidate scoring, selection, and
verifier-gated commit readiness without running live agents.
