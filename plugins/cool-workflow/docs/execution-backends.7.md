# EXECUTION-BACKENDS(7)

## NAME

Execution Backends - pluggable, swappable execution drivers for Cool Workflow (v0.1.29)

## SYNOPSIS

```text
node dist/cli.js backend list
node dist/cli.js backend show shell
node dist/cli.js backend probe container
node dist/cli.js dispatch <run-id> --sandbox readonly --backend shell
node dist/cli.js worker manifest <run-id> <worker-id>
```

## DESCRIPTION

An execution backend is a CW driver: a thin adapter that runs a dispatched
task/worker somewhere, under the requested sandbox profile, and keeps a record of
a canonical result envelope plus a sandbox attestation. v0.1.29 takes execution
out of the kernel and puts it into this driver layer.

The model is a BSD VFS / device-driver layer. There is ONE narrow
`ExecutionBackend` interface (the mechanism) and many drivers you can swap in and out
(`node`, `bun`, `shell`, `container`, `remote`, `ci`). The kernel —
orchestrator, dispatch, and pipeline-runner — never learns which backend ran a
task. WHAT to run and which evidence to keep is kernel policy; HOW and WHERE
it runs is the driver's business.

```text
selected backend -> sandbox attestation -> execution/delegation -> canonical envelope
```

The result envelope, evidence refs, and provenance a task makes are
schema-identical no matter which backend ran it. The backend id and its sandbox
attestation are kept AS provenance, so eval/replay, the verifier gates, and
the v0.1.28 run registry do not care which backend ran a run.

## THE CONTRACT

The `ExecutionBackend` interface is three members:

```text
descriptor   the capability descriptor: which sandbox dimensions it enforces vs
             attests, local vs remote, kind (local/delegating), readiness
probe(ctx)   live, deterministic readiness check
run(request) execute (or delegate) under a sandbox profile and return a
             canonical ExecutionResultEnvelope { status, result, evidence, provenance }
```

`run` takes a dispatch/worker manifest plus a fixed sandbox profile and
gives back `{ result, evidence }` (byte-stable across backends) and `provenance`
(backend id + `SandboxAttestation` + an optional delegation handle).

## THE SANDBOX PROFILE IS THE CONTRACT

Every backend MUST honor the five sandbox-profile dimensions: read, write,
command, network, env. For each dimension a driver says it does one of:

`enforce`
: the driver itself limits the dimension at execution time.

`attest`
: the driver keeps a claim you can check, but it is up to the host/runner to
  enforce it (this is the same split as the existing `sandbox.hostRequired`).

`unsupported`
: the driver can not enforce it or attest it.

A profile needs a dimension when it limits it (`command` when
`execute.mode != any`, `network` when `network.mode != any`, `env` when
`env.inherit` is false; read/write are always bounded). If a needed dimension
is `unsupported`, or the backend is not ready, or the profile says no to the
command, the backend FAILS CLOSED: `run` returns `status: "refused"` with an
attestation whose `status` is `refused`. It never quietly drops down to an
unsandboxed execution.

## DRIVERS

`node` (default)
: Does pre-v0.1.29 behavior exactly. The host runs the worker in-process
  under CW's worker-output acceptance (a delegate-host execution). When it
  runs a command it enforces command + env through the Node child process and
  attests read/write/network to the host.

`bun`
: Node-compatible by default, Bun-friendly. Runs through the Node-compatible
  runtime so evidence is byte-stable with `node`, and attests that Bun is there
  in provenance. Enforces command + env; attests read/write/network.

`shell`
: Runs a command/worker through the system shell (`/bin/sh -c`) under the sandbox
  contract. Enforces command + env; attests read/write/network.

`container`
: Delegates to a container runtime (docker/podman) and keeps the
  `image@digest` handle + attestation + result. A container can enforce all
  five dimensions. Fails closed when you give no image.

`remote`
: Delegates to a remote runner and keeps the endpoint + job handle +
  attestation + result. Fails closed when no endpoint is set
  (`CW_REMOTE_ENDPOINT` or `--endpoint`).

`ci`
: Delegates to a CI runner and keeps the job handle + attestation + result.
  Fails closed when no CI job target is set (`CW_CI_ENDPOINT` or
  `--job`).

CW DELEGATES; IT DOES NOT BECOME THE EXECUTOR. The local drivers run a thin
child process to take in evidence you can check (exit code + an output digest). The
container/remote/ci drivers delegate and keep a handle + attestation +
result; they never build a container runtime or a CI system over again.

## SELECTION

Backend selection parallels `--sandbox`:

```text
--backend <id>   (flag)   > CW_BACKEND   (env)   > node   (default)
```

Selection is kept in run state (dispatch manifest, worker scope, worker
manifest, the RunDispatch) and shown in the v0.1.28 run registry as the
record's `backends` field. A per-task `backendId` takes the place of the run default.
`backend list|show|probe` and the `--backend` flag are set out once in
`src/capability-registry.ts`, so `cw <cmd> --json` and `cw_<cmd>` use one
data source and get past the v0.1.27 parity gate.

## EVIDENCE PARITY

The canonical evidence a local driver keeps for a command run does not depend on the
backend:

```text
command:<command + args>
exitCode:<code>
stdoutSha256:sha256:<hex>
```

Running CW's own self-verify (`node dist/cli.js list`) through `node`, `shell`,
and `bun` gives byte-identical `result` and `evidence`; only
`provenance.backendId` (and the attestation detail) is not the same. The
`test/execution-backends-smoke.js` gate proves this, proves the fail-closed
refusals, proves the kept provenance and delegation handles, and proves the
verifier/registry stay backend-agnostic.

## ATTESTATION SHAPE

```json
{
  "backendId": "shell",
  "locality": "local",
  "kind": "local",
  "sandboxProfileId": "readonly",
  "required": ["read", "write", "network", "env"],
  "enforced": ["command", "env"],
  "attested": ["read", "write", "network"],
  "unenforceable": [],
  "status": "enforced",
  "enforcedByCW": ["..."],
  "hostRequired": ["..."]
}
```

A delegating driver also keeps `handle` (for example
`{ "kind": "container", "ref": "img@sha256:..." }`).

## FILES

```text
.cw/runs/<run-id>/state.json
.cw/runs/<run-id>/dispatches/<dispatch-id>.json
.cw/runs/<run-id>/workers/<worker-id>/worker.json
.cw/runs/<run-id>/workers/<worker-id>/manifest.json
.cw/registry/index.json
```

## FAILURE MODES

Backends it does not know fail closed with `backend-not-found` (CLI/dispatch/`CW_BACKEND`).

`run` returns `status: "refused"` with `attestation.status: "refused"` when:

- the sandbox profile says no to the command (`sandbox-command-denied`),
- a needed sandbox dimension is `unsupported` (`sandbox-unenforceable`),
- a local backend is not ready (`backend-not-ready`),
- a delegating backend has no delegation target (`delegation-target-missing`).

CW never quietly drops down a backend you asked for, and never runs a task
unsandboxed when it can not honor the profile you asked for.

## COMPATIBILITY

Execution Backends come in with CW v0.1.29. The default (`node`) backend
does pre-v0.1.29 behavior exactly; runs with no backend picked keep
working and old run state loads unchanged (the backend fields are added on and
optional). The `ResultEnvelope` schema (`summary`, `findings`, `evidence`) is
unchanged — the backend id and attestation live in provenance and run state,
never in the result envelope.

## SEE ALSO

sandbox-profiles(7), worker-isolation(7), cli-mcp-parity(7),
run-registry-control-plane(7), security-trust-hardening(7)
```
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that shows this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR next to
the CLI and MCP that keeps no authoritative state and forks no schema: each panel
is the same as its `cw <cmd> --json` payload byte-for-byte (parity-gated), and refresh
works everything out from disk over again. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from existing durable run state
— no metrics database, no collector daemon, no hidden counter. Usage is added on
and optional (when not there ⇒ `unreported`, never 0); cost is `attested` (attested usage
× a kept pricing policy) or clearly `estimated`, with pricing as policy. Both
verbs are parity-gated and show read-only in the v0.1.30 Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — needed approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
keeping a record of who approved the very artifact that went out. Policy (required approvals,
authorized roles, self-approval) is data, default off (pre-v0.1.32 behavior
unchanged). The verbs are parity-gated and show read-only in the v0.1.30
Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no copies in it. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends truly run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, using the v0.1.23 eval harness over again; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an outside agent process per worker, take in result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take in findings/evidence from any sensible agent shape (alt keys + prose), CW works out grounded evidence itself, give a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate stopping empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — doing away with false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the execution-backends surface in v0.1.81._
_No behavioral change in v0.1.82 (the delegated child programs moved from inline `node -e` strings to `scripts/children/`; spawn argv and shell:false behavior are the same byte for byte)._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

Agent stderr live-streaming is now on by default when stderr is a TTY (CW_AGENT_STREAM=0 / CW_NO_STREAM=1 force it off; CI and pipes stay silent); stdout is still always captured as data and the driver model / sandbox contract are unchanged.

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93
