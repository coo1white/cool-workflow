# Getting Started

*This page is for people changing CW itself. To USE `cw`, see the wiki
[Getting Started](https://github.com/coo1white/cool-workflow/wiki/Getting-Started).*

Start from a new clone:

```bash
cd plugins/cool-workflow
npm install
npm run build
npm link         # puts the `cw` command on your PATH
cw app list
```

No `npm link`? Every `cw <args>` line on this page also works as
`node scripts/cw.js <args>` from this directory.

## Check your setup first (`cw doctor`)

Like `brew doctor`, this names any setup problem and the fix for it before you
start a run:

```bash
cw doctor          # human-readable
cw doctor --json   # stable payload for scripts
cw doctor --onramp # short path for users and code work
cw doctor --onramp --changed-from origin/main
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

## One run, end to end

Plan a run with a canonical workflow app. `--dryRun true` keeps it safe;
put real version numbers in place of `X.Y.Z` / `X.Y.W`:

```bash
cw plan release-cut \
  --repo "$PWD" \
  --version X.Y.Z \
  --previousVersion X.Y.W \
  --releaseBranch main \
  --dryRun true
```

The plan prints a run id. See where that run is:

```bash
cw status <run-id>
```

Give the next ready task to your agent, one step at a time, in a
read-only sandbox:

```bash
cw dispatch <run-id> --limit 1 --sandbox readonly
```

When the run is complete, read the report, then prove its record chain
offline:

```bash
cw report <run-id> --show
cw telemetry verify <run-id>
```

If a run comes to a stop before the end — an agent error, a Ctrl-C, a
lost session — take it up again from where it stopped:

```bash
cw run resume <run-id> --drive
```

That is the whole loop: plan → status → dispatch → report → verify →
resume. The common command shapes are on the wiki page
[Commands or API](https://github.com/coo1white/cool-workflow/wiki/Commands-or-API);
the complete, generated list of every command — topology, multi-agent,
audit, eval, and the rest — is in [`cli-mcp-parity.7.md`](cli-mcp-parity.7.md).

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
