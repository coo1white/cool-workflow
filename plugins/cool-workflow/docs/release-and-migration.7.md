# Release And Migration Discipline

CW v0.1.14 made release checks and durable run-state compatibility clear.
Batch 5 (2026-11-12) dropped old-state migration: see
[Removed in batch 5](#removed-in-batch-5).

## Who Is Affected

Maintainers cutting CW releases should use `npm run release:check` from
`plugins/cool-workflow`. Anyone can see which CW they have with:

```bash
cw version
```

## State Policy

The durable run-state schema is `2`, set by `RUN_STATE_SCHEMA_VERSION` in
`src/core/state/types.ts`. A run folder whose `state.json` has any other
`schemaVersion` is refused with one line:

```text
cw: Run <id> was made by an older cw and cannot be read by this one; start a new run: cw -q "<question>"
```

CW does not migrate, normalize or rewrite old state. The old folder is left
on disk as it was; delete it by hand if you want the space.

## Release Check

`npm run release:check` is the release gate. It runs, in order: docs
presence, `npm run dist:check`, `npm run purity:check`, `npm run lang:check`,
`npm run check` (type check and the 10,000-line size gate), `npm run test:ci`,
`npm run test:unit`, `npm run gen:manifests -- --check`,
`npm run version:sync`, and `npm run readme:check`. `--skip-tests` skips the
two test steps.

The command is dry-run and non-destructive. Patch releases are tagged by the
`auto-patch` job on green `main`; a minor or major is the operator's signed
cut (see [Release Tooling](release-tooling.7.md)).

## Removed Surfaces: The Multi-Agent Family

The multi-agent family was taken out (slim-and-esm program, step 2; the
operator's yes of 2026-09-28, decision D1). These are no longer part of CW, on the CLI or over MCP:

- CLI verbs: `cw multi-agent`, `cw topology`, `cw blackboard`,
  `cw coordinator`, `cw candidate`, `cw eval`, `cw summary`, `cw approve`,
  `cw reject`, `cw comment`, `cw handoff`, `cw review`, and the audit views
  `cw audit multi-agent|policy|role|blackboard|judge`. Each now fails closed:
  `Unknown command` (or the `cw audit` usage line), exit 1.
- MCP tools: the 75 `cw_multi_agent_*`, `cw_topology_*`, `cw_blackboard_*`,
  `cw_coordinator_*`, `cw_candidate_*`, `cw_eval_*`, `cw_summary_*`,
  `cw_evidence_reasoning*`, `cw_approve`, `cw_reject`, `cw_comment_*`,
  `cw_handoff`, `cw_review_*` and `cw_audit_multi_agent|policy|role|blackboard|judge`
  tools. `tools/list` with `CW_MCP_TOOLS=full` now names 123 tools.
- `cw commit` keeps its verifier gate and evidence check, but takes no
  `--candidate`/`--selection` and has no review gate.
- `cw dispatch` takes no `--multi-agent-*` flags.
- report.md has no State Size & Compaction, Multi-Agent Runtime,
  Blackboard / Coordinator, Acceptance Rationale, or Candidates part.
- `cw operator status --json` has no `candidates`, `multiAgent`,
  `multiAgentOperator`, `multiAgentTrust`, or `blackboard` keys.
- The `pdca-blackboard-loop` example app.

A state file written by an older CW with `multiAgent`, `blackboard`,
`topologies`, `candidates`, or `candidateSelections` data still loads,
checks, reports, exports, and resumes. Those fields are kept as data, just as
CW keeps any other user data; no command reads them as live state any more.
`test/legacy-multi-agent-state-smoke.mjs` holds this.

## Removed Surfaces: The Frozen Surfaces (2026-11-12)

The surfaces that were frozen (fixes and deletions only) were taken out on
the owner's word of 2026-11-12 (large deletions and breaking changes are
open while CW is on 0.x). These are no longer part of CW:

- Scheduling: `cw schedule`, `cw loop`, `cw routine`, `cw sched`, the
  scheduling policy file (`registry/scheduling-policy.json` under the CW
  home), and `scripts/architecture-review-fast.js --schedule-full` (now
  refused, exit 1). The run queue (`cw queue`, `cw registry`, `cw run`,
  `cw history`) stays.
- Workbench: `cw workbench`, the `ui/workbench` sub-package, and the
  `build:ui`, `prepack` and `bench:workbench:deep` npm scripts. `report.html`
  stays; its Tailwind input is now `scripts/report.css`.
- Orchestrator: `src/shell/orchestrator.ts`.
- Telemetry demo: `cw demo bundle`. `cw demo tamper` stays (now
  `src/shell/tamper-demo.ts`), and so does `cw report verify-bundle`.
  `cw doctor --onramp` lists `cw check -- npm test` as its second quick-start
  step in place of `cw demo bundle`.
- Observability intake: `--pricing` on `cw metrics show|summary` (and the
  `pricing` MCP argument), the bundled `manifest/pricing.policy.json`, and the
  `--usage-*` flags on `cw result`. Cost is now `unpriced` or `unreported`
  only; `attestedUsd` and `estimatedUsd` are always `null`.
- Reclamation: `cw gc`, `cw orphans`, `cw clones`.
- MCP tools: the 31 `cw_schedule_*`, `cw_routine_*`, `cw_sched_*`,
  `cw_workbench_*`, `cw_gc_*`, `cw_orphans_*` and `cw_clones_*` tools.
  `tools/list` with `CW_MCP_TOOLS=full` now names 94 tools.

Each removed verb now fails closed: `cw: Unknown command: <verb>`, exit 1.
`cw help` no longer names them under "More commands".

Old state still loads. A run folder that an older CW reclaimed (its
`reclaimed.json`) still reads, and a remote-source clone cache still works.
Files only the removed verbs wrote (`.cw/schedules/`, `.cw/routines/`, the
scheduling policy file) are left on disk and no longer read; delete them
by hand if you want the space.

## Removed in batch 5

Batch 5 (2026-11-12, the owner's word: large deletions and breaking changes
are open while CW is on 0.x) cut `src/` from 31,802 to under 10,000 lines.
CW now does one thing: ask, run, report, check, verify.

What stays:

- `cw -q "<question>"` with `-claude -codex -gemini -opencode -deepseek -muse
  -copilot -antigravity -grok`, `-r/--repo`, `-d/--dir`, `--json`, `--quiet`,
  `--verbose`, `--no-color`, and `--resume --run <id>`.
- `cw report [run-id] [--show|--open]`, `cw report bundle`,
  `cw report verify-bundle`.
- `cw check -- <cmd>`, `cw check list`, `cw check show`.
- `cw demo tamper`, `cw doctor`, `cw fix`, `cw version`, `cw help`.

What is gone (each verb now fails closed: `cw: Unknown command: <verb>`,
exit 1):

- The MCP server (`scripts/mcp-server.js`, `.mcp.json`, `server.json`, the
  vendor `mcp.json` files, `mcpName`), the CLI/MCP parity gate and its doc.
- `--link`, the step verbs (`plan`, `dispatch`, `result`, `next`, `commit`),
  `quickstart`, `audit-run`, `app`, `list`, `search`, `info`, `init`,
  `status`, `run` and all its sub-verbs, `registry`, `queue`, `history`,
  `sandbox`, `backend`, `worker`, `feedback`, `audit`, `metrics`,
  `operator`, `telemetry`, `migration`, `state`, `contract`, `node`,
  `ledger`, `graph`, `man`, `completion`.
- Worker isolation, sandbox profiles, and the container, remote and CI
  execution backends. Workers are agent processes, spawned argv-style.
- Old-state migration (see [State Policy](#state-policy)).
- `cw commit`, unverified checkpoints, state nodes and node snapshots,
  ErrorFeedback records, and the HTTP agent endpoint (`CW_AGENT_ENDPOINT`).
- Observability, perf traces, cost accounting, error feedback.
- The trust-audit chain. The telemetry ledger chain stays and is what
  `cw report verify-bundle` re-proves.
- Every workflow app except `architecture-review`.

`--json` changes for kept verbs:

- `cw doctor --json`: same keys; the `checks` list no longer has
  `sandbox-enforceability`, `home-registry` or `audit-integrity` (nor the
  `agent-sandbox` check). `cw doctor --onramp`, `--changed-from` and
  `--conformance` are gone.
- `cw report verify-bundle --json` and `cw report bundle --json`
  (`verification`): `trustAuditVerified` is gone.
- `cw -q --json`: same keys. A run now makes one state commit when it is
  done (`commitId` is `state-0001`), not one per phase. `reopenedWorkers` is
  added when `--resume` reopens parked workers.
- A refused final commit is now a step with action `commit` and status
  `blocked` (it was action `blocked`); its reason starts `final commit
  refused:`.
- `--fast` and `--concurrency` are no longer read; a parallel phase runs
  up to the workflow's `maxConcurrentAgents` at once.

## Node Floor: 22.13

The release after 0.3.1 needs Node.js 22.13 or newer; 0.3.1 is the last
release for Node 18 and 20 (slim-and-esm program, step 4; the operator's yes
of 2026-09-28 is decision D4).

- `package.json` `engines.node` is `>=22.13.0`. npm gives a warning when the
  Node in use is older.
- `cw doctor` gives `fail` on the `node` check below 22.13, with the text
  `(>= 22.13)` in place of `(>= 18)` (see doctor(7)).
- CI tests Node 22 and 24. The checks the release gate takes are
  `check (22)` and `check (24)` (see release-tooling(7)).
- Why 22.13: it is the first Node 22 in which `require()` of an ES module
  works with no flag and writes nothing to stderr. 22.11 cannot do it, and
  22.12 does it but writes an `ExperimentalWarning`.
  `test/node-floor-require-esm-smoke.mjs` loads an ES module with `require()`
  on the Node in use and fails on any stderr output.

Saved run state is not changed by this: a run made on an older Node loads,
checks and resumes the same way on 22.13 or newer.

## Module Form: ES Modules in dist/

From the release after 0.3.1, `dist/` is ES modules (`"type": "module"` in
`package.json`; slim-and-esm program, step 5, decision D5). The commands,
their exit codes and the MCP tools do not change. Their output does not
change, with these exceptions, which go out in 0.3.2 with the operator's
dated yes of 2026-10-17 (see doctor(7)):

- `cw doctor`'s node check says `(>= 22.13)` where it said `(>= 18)`, and
  its fail text and fix say `v22.13` and `22.13+` where they said `v18`
  and `18+` (the Node floor above).
- `cw doctor --onramp`, in a CW checkout, names `.mjs` test and script
  paths (`test/doctor-smoke.mjs`, `test/onramp-check-smoke.mjs`) where it
  named `.js` ones.

The module form itself:

- A CommonJS file that does `require()` of a `dist/` file goes on working
  on Node 22.13 or newer: it gets the module's namespace, with its named
  exports. The exports are fixed: putting a new value on a `dist/` export
  throws a `TypeError` in strict code and does nothing in other code, so it
  no longer changes what CW does inside.
  `test/node-floor-require-esm-smoke.mjs` loads the real `dist/` this way
  and fails if it is CommonJS or if such an assignment takes effect.
- Workflow app files stay CommonJS (`module.exports = ...`, decision D6):
  `apps/` and `workflows/` each have a `package.json` that says
  `"type": "commonjs"`, and the loader reads app files with `require()`.
  An app outside the package loads as before.
- `scripts/` is ES modules too (step 6). The tools for this repo (release,
  gates, generators, bench) are now `scripts/<name>.mjs`, and `npm run`
  names them. A path a user may put in a config or run by hand keeps its
  name and is an ES module under the same `package.json`:
  `scripts/cw.js` (the `cw` and `cool-workflow` bins),
  `scripts/mcp-server.js`, `scripts/architecture-review-fast.js`,
  `scripts/source-context.js`, the agent wrappers in `scripts/agents/`
  (`builtin:<name>` and a saved `agent-config.json` point at them), and
  `scripts/children/http-delegate-child.js` (named in backend probe output).

## Installing with npm and npx (0.3.3)

From 0.2.8 to 0.3.2 the package carried a `preinstall` script meant only
for this source checkout (it uses bun). It ran on every user's install,
so `npm i cool-workflow` (a local, not global, install) failed with "This
project must be set up with bun", and `npx cool-workflow ...` exited 1
with no message. Only `npm i -g` worked. 0.3.3 ships no install-time
script: both commands now install and run, with exit 0. `npm i -g` is
unchanged. A contributor who runs `npm install` in the checkout is
caught by the test gate and CI instead (`package-manager-gate-smoke`).
The operator said yes to it for 0.3.3.

## Unsupported Cases

CW does not quietly load:

- non-object JSON run state
- run state with a schema version newer than the runtime
- run state with a schema version below the supported minimum
- state that cannot be normalized into the required runtime fields

Each is refused with one line. When compatibility is not clear, hold the
release.
## v0.1.27 — CLI ↔ MCP Parity

v0.1.27 adds a declared capability registry and a fail-closed `npm run
parity:check` (wired into `release:check`) that makes sure the CLI and MCP surfaces
are two views of one data source. No run-state schema change: pre-0.1.27
runs load unchanged, and every pre-0.1.27 CLI command and MCP tool keeps working.
cli-mcp-parity(7) was removed in batch 5.

## Run Registry / Control Plane (v0.1.28)

v0.1.28 adds a derived, rebuildable run registry over the same durable run state.
No run-state schema change: pre-0.1.28 single-repo runs and existing `.cw/runs/`
layouts keep working with an empty registry (`registry show` reports `absent`
until the first `registry refresh`), and the registry, archive/provenance
overlays, queue, and home discovery set are all derivable files that can be
deleted and rebuilt from source. run-registry-control-plane(7) was removed in batch 5.

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with interchangeable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, picked by `--backend` (parallel to `--sandbox`) and inspected via
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is unchanged no matter which backend executed a run. execution-backends(7) was removed in batch 5.
## Web / Desktop Workbench (v0.1.30, removed)

v0.1.30 added the Web / Desktop Workbench, a read-only localhost console over run state. It was removed on 2026-11-12; see release-and-migration(7), "Removed Surfaces".

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
derive time/duration, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and token/cost from existing durable run state — no metrics
database, no collector daemon, no hidden counter. The migration is ADDITIVE and
backward compatible: an optional, host-attested `UsageRecord` rides on the
task/worker record via the EXISTING result/worker intake (absent ⇒ `unreported`,
never 0); `ResultEnvelope` and the run-state schema are unchanged (schema version
stays 1), so old runs load and report `unreported` cost while still giving
correct time and rate metrics from their recorded timestamps and outcomes. Cost
is `attested` only from attested usage × a recorded pricing policy; guessed
pricing is a separate `estimated` figure. Pricing is POLICY given as data
(`--pricing <path>|default`), out of the kernel. The per-run report keeps a
rebuildable, fingerprinted snapshot under `.cw/runs/<id>/metrics/`, and the
cross-repo summary reports each snapshot's `valid|stale|absent` freshness against
current source. observability-cost-accounting(7) was removed in batch 5.

Since 2026-11-12 CW no longer prices usage: the pricing policy (`--pricing`) and the hand-recorded usage flags went with the observability intake module, and cost is `unpriced` or `unreported` only.

## Team Collaboration (v0.1.32, removed)

v0.1.32 added Team Collaboration (approvals, rejections, comments, handoffs,
and a review gate on the commit). It went with the multi-agent family; see
release-and-migration(7), "Removed Surfaces".

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a de-duplicated release gate. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37, removed)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue. Removed 2026-11-12; see release-and-migration(7), "Removed Surfaces".

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39, removed)

tiered, append-only, hash-chained run reclamation (`cw gc`, `cw orphans`). Removed 2026-11-12; see release-and-migration(7), "Removed Surfaces".

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that blocks empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now validate the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — taking away false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, actionable background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Migration Compatibility (v0.1.81)

v0.1.81 is additive: every change is a new flag/verb/env (`audit verify`, `run inspect-archive`, `verify-import --strict`, `CW_REQUIRE_ARCHIVE_INTEGRITY`, `quickstart --resume`, `run resume --drive`) or an internal behavior-preserving carve. Run-state schema, existing outputs, files, and exit codes are byte-identical, so runs and archives from earlier versions load and verify unchanged. No migration action is needed.
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No behavioral change in v0.1.88 (`release:check` and the durable run-state compatibility/`state check` path are unchanged; this release's release-flow verdict-capture work lives in the Release Tooling scripts, not in the release-check or migration discipline)._

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97

0.1.98

0.2.0

0.2.1

0.2.2

0.2.3

0.2.4

0.2.5

0.2.6

0.2.7

0.2.8

0.3.0

0.3.1

0.3.2

0.3.3

0.4.0

0.4.1

0.4.2

0.4.3

0.4.4
