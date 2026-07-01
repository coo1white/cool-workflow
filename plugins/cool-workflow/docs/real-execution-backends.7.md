# Real Execution Backend Integrations

CW v0.1.34 makes the delegating execution backends REAL. v0.1.29 gave us the
driver layer (`src/execution-backend.ts`), with `node`/`bun`/`shell` really
executing and `container`/`remote`/`ci` as contract-conformant stubs: `delegate()`
made a handle and gave back `status: "completed"` with `delegated:`/`handle:`
evidence, but ran nothing. v0.1.34 takes the place of that no-op, so the three
delegating drivers truly drive a container runtime, a remote runner, and a CI
job — opt-in, fail-closed, and keeping the SAME canonical evidence as `node`.

The driver model and the sandbox contract do not change; only HOW/WHERE a
delegated task runs becomes real.

## Identical Evidence, Any Backend

A real delegated run keeps the SAME canonical evidence `executeLocal` makes:

```text
command:<command + args>
exitCode:<code>
stdoutSha256:sha256:<hex>
```

The execution handle (`image@digest`, `endpoint#jobId`) lives in
`provenance.handle` and the sandbox attestation in `provenance.attestation` —
NEVER in `evidence`. So a `container` run of the same task is byte-stable against
`node` once you take provenance away: only `provenance.backendId`/`handle`/
`attestation` and ISO timestamps are not the same. Eval/replay, the verifier gates, the
v0.1.28 registry, and the v0.1.30 Workbench all stay backend-agnostic.

## container

Runs `docker` (or `podman`) for real, under the sandbox contract:

```text
<runtime> run --rm [--network none] -v <cwd>:<cwd>:ro -w <cwd> [-e NAME=VALUE ...] <image[@digest]> <command> <args>
```

- **network** — `--network none` when the profile holds it back (`network.mode !=
  any`); a container network namespace truly puts this in force (the dimension is
  marked `enforce`).
- **read/write** — the workspace is mounted read-only at the same path; CW's
  worker-output acceptance still keeps writes inside limits. (Write-through mounts
  will come later.)
- **env** — only the names the profile makes open cross into the container;
  the image gives its own `PATH`/`HOME`, so host-specific base env is never
  put in.

Selection gives the image through `--image` / `CW_CONTAINER_IMAGE` (+ optional
`CW_CONTAINER_DIGEST`).

## remote / ci

Real HTTP delegation. The job `{ command, args, env, sandboxProfileId, jobId? }`
is POSTed to the set endpoint by a self-contained Node child (global
`fetch`, so the driver stays portable and synchronous from CW's view); a returned
`jobId` is polled until `done`. The runner's `{ exitCode, stdout }` becomes the
canonical evidence. Endpoints come from `--endpoint`/`--job` or
`CW_REMOTE_ENDPOINT`/`CW_REMOTE_JOB` / `CW_CI_ENDPOINT`/`CW_CI_JOB`.

## Fail Closed

A delegated run NEVER makes up a completion. It returns `status: "refused"`
(`attestation.status: "refused"`, a `refused:<code>` evidence line, no
`stdoutSha256:`) when:

- `delegation-target-missing` — no image (container) or no endpoint (remote/ci).
- `no-command` — a delegating backend was asked to run with no command.
- `runtime-unavailable` — no `docker`/`podman` on PATH, or the daemon cannot
  be **reached**. A CLI that is there but with a dead daemon is found by a pre-flight
  `<runtime> version --format {{.Server.Version}}` (which gives back the server
  version only when it can be reached) — the container run's own exit code is NOT a
  sure daemon-down sign across runtimes, so it is not used for this.
- `delegation-failed` — the runtime gave an error (e.g. `docker` exit 125 for a bad
  image), the HTTP POST/poll did not work or could not be reached, or the runner gave back an
  unparseable response or no `exitCode`.

A container command that truly runs and exits non-zero is `failed` (a real
result), not the same as `refused` (never ran).

## Compatibility

The default backend stays `node`; the dispatch path stays a `delegate-host`
execution that copies pre-v0.1.29 behavior exactly. With no container runtime, no
endpoint, and no credentials, every probe and test output that is there now does not
change — real execution is strictly opt-in. The `ResultEnvelope` schema does not change.

## See Also

execution-backends(7), sandbox-profiles(7), cli-mcp-parity(7),
run-registry-control-plane(7)

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, again using the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

start an outside agent process for each worker, take in result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take in findings/evidence from any sensible agent shape (alt keys + prose), CW works out grounded evidence itself, give a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate that stops empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) and not the changeable working tree — taking away false-red/false-green that came from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter that gives any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the real execution backends in v0.1.81._
_No behavioral change in v0.1.82 (delegated child programs moved out to `scripts/children/`; spawn behavior byte-identical)._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

_No behavioral change in v0.1.88 (the container/remote/ci delegating integrations and their canonical evidence are unchanged; the streaming-default and incremental-resume work this release lives in the agent execution path and the drive, not in these backends)._

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
