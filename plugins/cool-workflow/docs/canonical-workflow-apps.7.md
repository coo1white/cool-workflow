# Canonical Workflow Apps

Canonical Workflow Apps are the official CW userland apps maintained with the
runtime. They are not loose examples. Each one lives in a first-class app
directory:

```text
apps/<app-id>/app.json
apps/<app-id>/workflow.js
```

The runner remains the base system. Canonical apps carry domain behavior:
inputs, phases, task prompts, evidence gates, sandbox profile hints, and app
metadata.

## Apps

`architecture-review`

Map a repository architecture, assess risks, verify important findings, and
synthesize an evidence-backed verdict.

```bash
node scripts/cw.js plan architecture-review \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --invariant "public API stays stable" \
  --focus "runtime"
```

`architecture-review-fast`

Run a shorter architecture review for a fast first result. The app keeps the
full `architecture-review` contract available under its original id, but uses two
parallel Map workers, two parallel Assess workers, one verifier, and one verdict
worker. Operators can optionally provide a pinned JSONL source context and route
mapping/assessment work to a faster model while reserving stronger models for
verification and synthesis.

```bash
node scripts/architecture-review-fast.js \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --fast-model gpt-5.5-high \
  --strong-model gpt-5.5-extra-high \
  --metrics \
  --schedule-full
```

The wrapper prepares one cached JSONL source context, passes its sha256 digest to
the fast app, runs `quickstart architecture-review-fast`, and optionally creates
a one-shot background schedule for the full `architecture-review` app. When run
against an external repo without `--profile` or `--profile-file`, it writes a
small repo-local `repo` profile covering common tracked text surfaces such as
README/package metadata, `src/`, `lib/`, `apps/`, `scripts/`, docs, and tests.
If the selected profile exports zero records, the wrapper fails closed instead of
passing an empty context digest to the app.
`--fast-model` and `--strong-model` are userland policy flags; internally they
set the same task-level hints as `CW_ARCHITECTURE_REVIEW_FAST_MODEL` and
`CW_ARCHITECTURE_REVIEW_STRONG_MODEL`.
`--metrics` is opt-in; when present the wrapper adds elapsed-time, worker-step,
agent-spawn, and result-cache-hit counts to the JSON payload so operators can
measure foreground wait reductions without changing the default output shape.

For long full reviews, use the existing routine or schedule surfaces to run
`architecture-review` in the background after the fast report has returned.

`pr-review-fix-ci`

Review a pull request or branch, inspect CI failures, diagnose actionable
issues, optionally patch when `--mode fix` is allowed, verify outcomes, and
summarize with evidence.

```bash
node scripts/cw.js plan pr-review-fix-ci \
  --repo /path/to/repo \
  --pr 123 \
  --base main \
  --ci "unit-tests" \
  --mode review
```

`release-cut`

Prepare a release with checklist discipline: version checks, changelog, tests,
packaging, release notes, and final verification.

```bash
node scripts/cw.js plan release-cut \
  --repo /path/to/repo \
  --version 0.1.13 \
  --previousVersion 0.1.11 \
  --dryRun true
```

`research-synthesis`

Split a research question into claims, investigate sources, cross-check
evidence, verify claims, and synthesize a concise answer.

```bash
node scripts/cw.js plan research-synthesis \
  --cwd /tmp/research-run \
  --question "What does the evidence support?" \
  --source "official-docs" \
  --scope "local sources first" \
  --freshness "as of today"
```

## Validation Matrix

Run the canonical app matrix from the plugin root:

```bash
cd plugins/cool-workflow
npm run canonical-apps
```

The command uses only Node.js standard library APIs and local temporary
workspaces. It validates each canonical app, shows its app metadata, plans it
with representative inputs, checks app id/version metadata in run state, checks
evidence-required verification or synthesis/verdict tasks, checks sandbox
profile hints, checks unique task ids, and checks duplicate ids do not break
discovery.

`npm test` includes `test/canonical-workflow-apps-smoke.js`, which repeats the
same core assertions against generated `dist/`.

## Framework Pressure

The apps intentionally stress different parts of the Workflow App framework:

- declared required, optional, and repeated inputs
- app-directory discovery and app metadata
- readonly, locked-down, and workspace-write sandbox hints
- evidence-required verifier, synthesis, summary, and verdict tasks
- deterministic planning into temporary workspaces
- compatibility between canonical app ids and legacy workflow-file wrappers

The legacy `workflows/architecture-review.workflow.js` and
`workflows/research-synthesis.workflow.js` files remain loadable with explicit
compatibility ids:

```text
legacy-architecture-review
legacy-research-synthesis
```

The public `architecture-review` and `research-synthesis` ids are now owned by
the canonical app directories.

## Relationship To The Golden Path

`npm run canonical-apps` proves the official userland app matrix validates and
plans correctly. It does not run every worker for every app.

`npm run golden-path` remains the full integration proof:

```text
workflow app -> plan -> dispatch -> isolated worker -> candidate scoring
-> verifier -> gated commit -> report
```

Together they keep the kernel small while making the maintained userland boring,
inspectable, and useful.

Use the Operator UX commands to inspect any canonical app run:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --summary
```
0.1.51
