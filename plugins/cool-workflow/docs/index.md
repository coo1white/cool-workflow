# Cool Workflow Docs

Start with the first run. Use the developer loop when you change code. Read the
advanced pages only when you need those parts.

To find the page for one command, see [Find by command](#find-by-command).

## First Run

1. [Getting Started](getting-started.md) - clone, install, run `doctor --onramp`, run one workflow, inspect it, and run the right check.
2. [End-to-End Golden Path](end-to-end-golden-path.7.md) - deterministic proof of app, worker, verifier, commit, and report flow.
3. [Verifiable Report Bundle](report-verifiable-bundle.7.md) - make a portable report bundle and verify it offline.
4. [Trust Model & Limitations](trust-model.md) - what the ed25519 and hash-chain proof does and does not prove.

## Developer Loop

1. [Project Index](project-index.md) - code-derived map of source modules, workflow apps, docs, tests, and sync targets.
2. [Workflow App framework](workflow-app-framework.7.md) - userland app manifests, entrypoints, compatibility, and validation.
3. [Sandbox Profiles](sandbox-profiles.7.md) - named worker policy contracts for read/write/execute/network/env handling.
4. [CLI <-> MCP Parity](cli-mcp-parity.7.md) - the capability registry and fail-closed gate proving the CLI and MCP surfaces render one data source.
5. [Release And Migration](release-and-migration.7.md) - release and migration discipline for durable run state.
6. [Release Tooling](release-tooling.7.md) - version bump, feature scaffold, forward-reference docs, and release gates.
7. [Cool Workflow Release History](release-history.md) - long capability notes moved out of the README.

## Advanced

1. [Agent Delegation Drive](agent-delegation-drive.7.md) - the `agent` backend delegates workers to an external process and drives plan -> report.
2. [Run Registry / Control Plane](run-registry-control-plane.7.md) - search, resume, archive, queue, history, and rerun across repos.
3. [Execution Backends](execution-backends.7.md) - node/bun/shell/container/remote/ci drivers, sandbox attestation, and fail-closed delegation.

## Reference

- [Operator UX](operator-ux.7.md) - `status`, `graph`, reports, worker, feedback, commit, and trust summaries.
- [MCP App Surface](mcp-app-surface.7.md) - JSON tool parity for agent hosts.
- [Dogfood One Real Repo](dogfood-one-real-repo.7.md) - dry-run release proof against this repository.
- [Web / Desktop Workbench](web-desktop-workbench.7.md) - read-only localhost console over existing run state.
- [Observability + Cost Accounting](observability-cost-accounting.7.md) - derived durations, rates, token usage, and cost.
- [Multi-Vendor Agent Standards](multi-vendor-agent-standards.7.md) - rules for any vendor agent calling CW as a client, and for vendor agents working together to build CW.
- [Real Execution Backend Integrations](real-execution-backends.7.md) - real container/remote/ci execution under the sandbox contract.
- [Node Snapshot / Diff / Replay](node-snapshot-diff-replay.7.md) - per-node snapshots, structural diff, and deterministic replay.
- [Contract Migration Tooling](contract-migration-tooling.7.md) - declared migration registry and compatibility proofs.
- [Control-Plane Scheduling](control-plane-scheduling.7.md) - priority, leases, retry/backoff, and scheduling policy.
- [Run Retention & Provable Reclamation](run-retention-reclamation.7.md) - tiered, hash-chained disk reclamation.
- [Durable State & Locking](durable-state-and-locking.7.md) - atomic writes, fsync durability, and portable file locks.
- [Source Context Profiles](source-context-profiles.7.md) - opt-in JSONL source exports for context slimming.
- [Security / Trust Hardening](security-trust-hardening.7.md) - audit records, provenance, and sandbox attestations.
- [Trust Audit Anchor](trust-audit-anchor.7.md) - head anchor that makes a cut-off audit-log tail visible.
- [Pipeline Runner](pipeline-runner.7.md) - the plan/dispatch/result/commit state machine at the kernel's center.
- [Pipeline Verbs](pipeline-verbs.7.md) - `cw plan|dispatch|result` and the worker result contract.
- [Verifier-Gated Commit](verifier-gated-commit.7.md) - evidence checks that let a commit through or refuse it.
- [Worker Isolation](worker-isolation.7.md) - worker-local state, write acceptance, and the isolation boundary.
- [Error Feedback](error-feedback.7.md) - structured error records fed back into the next attempt.
- [State Node](state-node.7.md) - the durable node record every run is made of.
- [Capability / Topology Registry](capability-topology-registry.7.md) - the one data source behind CLI, MCP, and help.
- [Cross-Agent Ledger](cross-agent-ledger.7.md) - digest-sealed proposals and reviews between two agents (`cw ledger`).
- [Routine Triggers](routine.7.md) - `cw routine` local trigger bridge for API/GitHub events.
- [Remote Source Review](remote-source-review.7.md) - reviewing a repository the agent cannot clone.
- [Vendor Manifest Loadability](vendor-manifest-loadability.7.md) - proving generated vendor manifests actually load.
- [Canonical Workflow Apps](canonical-workflow-apps.7.md) - the official app matrix and its checks.
- [Doctor](doctor.7.md) - environment and onramp diagnosis (`cw doctor`).
- [Demo](demo.7.md) - the tamper-evidence demo (`cw demo`).
- [Fix](fix.7.md) - `cw fix` guided recovery for a blocked run.
- [Init](init.7.md) - `cw init` repository bootstrap.

## Find by command

One row for each `cw` command that `cw help` names. The right column is the
man page, and the part of it, that says what the command does and how to
give it. `cw help <command>` prints its sub-commands; `cw man <page>` prints
a page from this folder (give the page name without `.7.md`).

| Command | What it does | Where it is documented |
|---|---|---|
| `cw -q "<question>"` | Asks one question about a repo and makes a cited report | [Agent Delegation Drive: CLI](agent-delegation-drive.7.md#cli) |
| `cw app` | Makes, checks, lists, and runs workflow apps | [Workflow App framework: CLI](workflow-app-framework.7.md#cli) |
| `cw audit` | Reads and records the trust-audit records of a run | [Security / Trust Hardening: CLI](security-trust-hardening.7.md#cli) |
| `cw audit-run` | The same as `cw quickstart` (another name for it) | — (no page); nearest: [Agent Delegation Drive: CLI](agent-delegation-drive.7.md#cli) |
| `cw backend` | Lists, shows, and tests execution backends; sets the agent | [Execution Backends: SYNOPSIS](execution-backends.7.md#synopsis), [Agent Delegation Drive: CLI](agent-delegation-drive.7.md#cli) |
| `cw check` | Runs your test command and keeps a done receipt a result can cite | [Verifier-Gated Commit: DONE RECEIPTS](verifier-gated-commit.7.md#done-receipts) |
| `cw clones` | Lists and clears the cache of remote-source copies | [Remote Source Review: Cache](remote-source-review.7.md#cache--cw-clones) |
| `cw commit` | Makes a verifier-gated commit or checkpoint | [Verifier-Gated Commit: SYNOPSIS](verifier-gated-commit.7.md#synopsis) |
| `cw completion` | Prints a shell-completion script (bash, zsh, fish) | — (no page); nearest: [CLI <-> MCP Parity: Surface-Specific Capabilities](cli-mcp-parity.7.md#surface-specific-capabilities) |
| `cw contract` | Shows the pipeline contract of a run | [Pipeline Runner: FILES](pipeline-runner.7.md#files) |
| `cw demo` | Proves the tamper checks with no agent (`tamper`, `bundle`) | [Demo](demo.7.md#synopsis) |
| `cw dispatch` | Gives ready tasks of a run to an agent | [Pipeline Verbs: DISPATCH](pipeline-verbs.7.md#dispatch) |
| `cw doctor` | Checks your setup and gives a fix for each problem | [Doctor](doctor.7.md#synopsis) |
| `cw feedback` | Gets, shows, and clears error feedback of a run | [Error Feedback: EXAMPLES](error-feedback.7.md#examples) |
| `cw fix` | Prints the fix commands for setup problems | [Fix](fix.7.md#synopsis) |
| `cw gc` | Plans, runs, and checks the freeing of old run space | [Run Retention: CLI](run-retention-reclamation.7.md#cli) |
| `cw graph` | Shows the graph of a run | [Operator UX: Graph](operator-ux.7.md#graph) |
| `cw help` | Prints the help page, or one command's sub-commands | — (no page); nearest: [Unix Principles: D2. The CLI scale](unix-principles.md#d2-the-cli-scale) |
| `cw history` | One timeline of runs across repos, newest first | [Run Registry: Cross-repo history](run-registry-control-plane.7.md#cross-repo-history) |
| `cw info` | Shows the contract of a workflow app as a card | — (no page); nearest: [Workflow App framework: App Contract](workflow-app-framework.7.md#app-contract) |
| `cw init` | Makes a new workflow definition | [Init](init.7.md#synopsis) |
| `cw ledger` | Hands sealed proposals and reviews between two agents | [Cross-Agent Ledger: Commands](cross-agent-ledger.7.md#commands) |
| `cw list` | Lists the workflow apps you have | [Workflow App framework: CLI](workflow-app-framework.7.md#cli) |
| `cw loop` | Short form of `cw schedule create --kind loop` | [Control-Plane Scheduling: Scheduled Tasks In Practice](control-plane-scheduling.7.md#scheduled-tasks-in-practice) |
| `cw man` | Prints a man page from this folder | — (no page); nearest: this page |
| `cw metrics` | Times, rates, token use, and cost of a run | [Observability + Cost Accounting: Commands](observability-cost-accounting.7.md#commands) |
| `cw migration` | Lists, checks, and proves state migrations | [Contract Migration Tooling: Surfaces & Compatibility](contract-migration-tooling.7.md#surfaces--compatibility) |
| `cw next` | Reads the next tasks to do in a run | — (no page); nearest: [Pipeline Verbs: SEE ALSO](pipeline-verbs.7.md#see-also) |
| `cw node` | Lists, snapshots, compares, and replays the nodes of a run | [Pipeline Runner: FILES](pipeline-runner.7.md#files), [Node Snapshot / Diff / Replay](node-snapshot-diff-replay.7.md#surfaces--compatibility) |
| `cw operator` | The full operator view and report of a run | — (no page); nearest: [Operator UX: Inspect A Run](operator-ux.7.md#inspect-a-run) |
| `cw orphans` | Lists and clears run folders that have no state | [Run Retention: Orphan runs](run-retention-reclamation.7.md#orphan-runs--a-second-pure-scratch-case-outside-this-transaction) |
| `cw plan` | Makes a run and gives its plan | [Pipeline Verbs: PLAN](pipeline-verbs.7.md#plan) |
| `cw queue` | Puts runs in order and takes them out | [Run Registry: Queue](run-registry-control-plane.7.md#queue) |
| `cw quickstart` | Plan, drive, and report in one command | [Agent Delegation Drive: CLI](agent-delegation-drive.7.md#cli), [Verifiable Report Bundle: Usage](report-verifiable-bundle.7.md#usage) |
| `cw registry` | Builds and shows the index of runs | [Run Registry: CLI](run-registry-control-plane.7.md#cli) |
| `cw report` | Makes and shows the report of a run; makes and checks a bundle | [Operator UX: Console Report](operator-ux.7.md#console-report), [Verifiable Report Bundle: Usage](report-verifiable-bundle.7.md#usage) |
| `cw result` | Records an agent's result file for a task | [Pipeline Verbs: RESULT](pipeline-verbs.7.md#result) |
| `cw routine` | Triggers for API and GitHub events | [Routine Triggers: COMMANDS](routine.7.md#commands) |
| `cw run` | Search, resume, drive, archive, export, and import runs | [Run Registry: CLI](run-registry-control-plane.7.md#cli) |
| `cw sandbox` | Lists, shows, checks, and picks sandbox profiles | [Sandbox Profiles: SYNOPSIS](sandbox-profiles.7.md#synopsis) |
| `cw sched` | Leases on the run queue (take, complete, give back) | [Control-Plane Scheduling: The lease lifecycle](control-plane-scheduling.7.md#the-lease-lifecycle) |
| `cw schedule` | Cron, loop, and reminder tasks on your desktop | [Control-Plane Scheduling: Scheduled Tasks In Practice](control-plane-scheduling.7.md#scheduled-tasks-in-practice) |
| `cw search` | Searches the workflow apps by a word | — (no page); nearest: [Workflow App framework: CLI](workflow-app-framework.7.md#cli) |
| `cw state` | Checks if a run's saved state can be loaded | [Release And Migration: Dry Run](release-and-migration.7.md#dry-run) |
| `cw status` | The first look at one run: stage, counts, next step | [Operator UX: Inspect A Run](operator-ux.7.md#inspect-a-run) |
| `cw telemetry` | Checks a run's telemetry ledger again, offline | [Trust Model: How to verify for yourself](trust-model.md#how-to-verify-for-yourself) |
| `cw version` | Prints the version | — (no page); nearest: [CLI <-> MCP Parity: Surface-Specific Capabilities](cli-mcp-parity.7.md#surface-specific-capabilities) |
| `cw workbench` | The read-only Workbench on localhost | [Web / Desktop Workbench: Surfaces](web-desktop-workbench.7.md#surfaces) |
| `cw worker` | Lists, shows, and records the workers of a run | [Worker Isolation: SYNOPSIS](worker-isolation.7.md#synopsis) |

### Commands with no page yet

These commands have a row above but no man page part of their own. The
row says which page is nearest. The list may only get shorter: a new
command comes with its page.

- `cw audit-run` (another name for `cw quickstart`)
- `cw completion`
- `cw help`
- `cw info`
- `cw man`
- `cw next`
- `cw operator`
- `cw search`
- `cw version`

CW is the base system. Workflow apps are userland. Release and migration rules
must keep that line clear: stable contracts, clear compatibility checks, and
state you can look at.
