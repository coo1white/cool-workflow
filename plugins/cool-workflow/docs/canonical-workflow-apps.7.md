# Canonical Workflow Apps

Canonical Workflow Apps are the official CW userland apps kept up with the
runtime. They are not loose examples. Each one is in a first-class app
directory:

```text
apps/<app-id>/app.json
apps/<app-id>/workflow.js
```

The runner is still the base system. Canonical apps add domain behavior:
inputs, phases, task prompts, evidence gates, sandbox profile hints, and app
metadata.

## Apps

`architecture-review`

Map out a repository architecture, weigh the risks, check the important
findings, and put together an evidence-backed verdict.

```bash
node scripts/cw.js plan architecture-review \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --invariant "public API stays stable" \
  --focus "runtime"
```

`architecture-review-fast`

Run a shorter architecture review for a fast first result. The app keeps the
full `architecture-review` contract open under its first id, but uses two
parallel Map workers, two parallel Assess workers, one verifier, and one verdict
worker. Operators may give a pinned JSONL source context and send
mapping/assessment work to a faster model while keeping stronger models for
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

The wrapper gets one cached JSONL source context ready, passes its sha256 digest to
the fast app, runs `quickstart architecture-review-fast`, and may make
a one-shot background schedule for the full `architecture-review` app. When run
against an outside repo without `--profile` or `--profile-file`, it writes a
small repo-local `repo` profile that covers common tracked text surfaces such as
README/package metadata, `src/`, `lib/`, `apps/`, `scripts/`, docs, and tests.
If the picked profile sends out zero records, the wrapper fails closed in place of
passing an empty context digest to the app.
`--fast-model` and `--strong-model` are userland policy flags; inside, they
set the same task-level hints as `CW_ARCHITECTURE_REVIEW_FAST_MODEL` and
`CW_ARCHITECTURE_REVIEW_STRONG_MODEL`.
`--metrics` is opt-in; when it is there the wrapper adds elapsed-time, worker-step,
agent-spawn, and result-cache-hit counts to the JSON payload so operators can
measure foreground wait cuts without changing the default output shape.

For long full reviews, use the routine or schedule surfaces you have to run
`architecture-review` in the background after the fast report has come back.

`pr-review-fix-ci`

Review a pull request or branch, look at CI failures, work out the issues
you can act on, patch when `--mode fix` is allowed, check the outcomes, and
give a short account with evidence.

```bash
node scripts/cw.js plan pr-review-fix-ci \
  --repo /path/to/repo \
  --pr 123 \
  --base main \
  --ci "unit-tests" \
  --mode review
```

`release-cut`

Get a release ready with checklist discipline: version checks, changelog, tests,
packaging, release notes, and a last verification.

```bash
node scripts/cw.js plan release-cut \
  --repo /path/to/repo \
  --version 0.1.13 \
  --previousVersion 0.1.11 \
  --dryRun true
```

`research-synthesis`

Break a research question into claims, look into sources, cross-check
the evidence, check the claims, and put together a short answer.

When you point it at a folder, it reads the local files there as primary
sources. So this app works over any corpus — your own docs, notes, or
papers — not only a git code repo. The working directory is the corpus,
so the agent can back its answer with your own files.

```bash
node scripts/cw.js plan research-synthesis \
  --cwd /tmp/research-run \
  --question "What does the evidence support?" \
  --source "official-docs" \
  --scope "local sources first" \
  --freshness "as of today"
```

Over a local corpus folder, point `--repo` at it:

```bash
cw quickstart research-synthesis --repo /path/to/papers \
  --question "What do these papers conclude?"
```

## Validation Matrix

Run the canonical app matrix from the plugin root directory:

```bash
cd plugins/cool-workflow
npm run canonical-apps
```

The command uses only Node.js standard library APIs and local temporary
workspaces. It validates each canonical app, shows its app metadata, plans it
with sample inputs, checks app id/version metadata in run state, checks
evidence-required verification or synthesis/verdict tasks, checks sandbox
profile hints, checks unique task ids, and checks that duplicate ids do not break
discovery.

`npm test` takes in `test/canonical-workflow-apps-smoke.js`, which does the
same core assertions again against generated `dist/`.

## Framework Pressure

The apps put weight on different parts of the Workflow App framework on purpose:

- named required, optional, and repeated inputs
- app-directory discovery and app metadata
- readonly, locked-down, and workspace-write sandbox hints
- evidence-required verifier, synthesis, summary, and verdict tasks
- deterministic planning into temporary workspaces
- compatibility between canonical app ids and legacy workflow-file wrappers

The legacy `workflows/architecture-review.workflow.js` and
`workflows/research-synthesis.workflow.js` files can still be loaded with named
compatibility ids:

```text
legacy-architecture-review
legacy-research-synthesis
```

The public `architecture-review` and `research-synthesis` ids are now held by
the canonical app directories.

## Relationship To The Golden Path

`npm run canonical-apps` shows that the official userland app matrix validates and
plans the right way. It does not run every worker for every app.

`npm run golden-path` is still the full integration proof:

```text
workflow app -> plan -> dispatch -> isolated worker -> candidate scoring
-> verifier -> gated commit -> report
```

Together they keep the kernel small while making the kept-up userland dull,
easy to inspect, and useful.

Use the Operator UX commands to look at any canonical app run:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js graph <run-id>
node scripts/cw.js report <run-id> --summary
```
0.1.51
