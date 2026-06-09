# Real Execution Backend Integrations

CW v0.1.34 makes the delegating execution backends REAL. v0.1.29 shipped the
driver layer (`src/execution-backend.ts`) with `node`/`bun`/`shell` really
executing and `container`/`remote`/`ci` as contract-conformant stubs: `delegate()`
built a handle and returned `status: "completed"` with `delegated:`/`handle:`
evidence without running anything. v0.1.34 replaces that no-op so the three
delegating drivers actually drive a container runtime, a remote runner, and a CI
job — opt-in, fail-closed, and recording the SAME canonical evidence as `node`.

The driver model and the sandbox contract are unchanged; only HOW/WHERE a
delegated task runs becomes real.

## Identical Evidence, Any Backend

A real delegated run records the SAME canonical evidence `executeLocal` produces:

```text
command:<command + args>
exitCode:<code>
stdoutSha256:sha256:<hex>
```

The execution handle (`image@digest`, `endpoint#jobId`) lives in
`provenance.handle` and the sandbox attestation in `provenance.attestation` —
NEVER in `evidence`. So a `container` run of the same task is byte-stable against
`node` after stripping provenance: only `provenance.backendId`/`handle`/
`attestation` and ISO timestamps differ. Eval/replay, the verifier gates, the
v0.1.28 registry, and the v0.1.30 Workbench stay backend-agnostic.

## container

Runs `docker` (or `podman`) really, under the sandbox contract:

```text
<runtime> run --rm [--network none] -v <cwd>:<cwd>:ro -w <cwd> [-e NAME=VALUE ...] <image[@digest]> <command> <args>
```

- **network** — `--network none` when the profile restricts it (`network.mode !=
  any`); a container network namespace genuinely enforces this (the dimension is
  declared `enforce`).
- **read/write** — the workspace is mounted read-only at the same path; CW's
  worker-output acceptance still bounds writes. (Write-through mounts are a later
  refinement.)
- **env** — only the profile's explicitly exposed names cross into the container;
  the image supplies its own `PATH`/`HOME`, so host-specific base env is never
  injected.

Selection supplies the image via `--image` / `CW_CONTAINER_IMAGE` (+ optional
`CW_CONTAINER_DIGEST`).

## remote / ci

Real HTTP delegation. The job `{ command, args, env, sandboxProfileId, jobId? }`
is POSTed to the configured endpoint by a self-contained Node child (global
`fetch`, so the driver stays portable and synchronous from CW's view); a returned
`jobId` is polled until `done`. The runner's `{ exitCode, stdout }` becomes the
canonical evidence. Endpoints come from `--endpoint`/`--job` or
`CW_REMOTE_ENDPOINT`/`CW_REMOTE_JOB` / `CW_CI_ENDPOINT`/`CW_CI_JOB`.

## Fail Closed

A delegated run NEVER fabricates a completion. It returns `status: "refused"`
(`attestation.status: "refused"`, a `refused:<code>` evidence line, no
`stdoutSha256:`) when:

- `delegation-target-missing` — no image (container) or no endpoint (remote/ci).
- `no-command` — a delegating backend was asked to run with no command.
- `runtime-unavailable` — no `docker`/`podman` on PATH, or the daemon is
  **unreachable**. A present CLI with a dead daemon is detected by a pre-flight
  `<runtime> version --format {{.Server.Version}}` (which returns the server
  version only when reachable) — the container run's own exit code is NOT a
  reliable daemon-down signal across runtimes, so it is not relied upon.
- `delegation-failed` — the runtime errored (e.g. `docker` exit 125 for a bad
  image), the HTTP POST/poll failed or was unreachable, or the runner returned an
  unparseable response or no `exitCode`.

A container command that genuinely runs and exits non-zero is `failed` (a real
result), distinct from `refused` (never ran).

## Compatibility

The default backend stays `node`; the dispatch path stays a `delegate-host`
execution reproducing pre-v0.1.29 behavior exactly. With no container runtime, no
endpoint, and no credentials, every existing probe and test output is unchanged —
real execution is strictly opt-in. The `ResultEnvelope` schema is unchanged.

## See Also

execution-backends(7), sandbox-profiles(7), cli-mcp-parity(7),
run-registry-control-plane(7)

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any reasonable agent shape (alt keys + prose), CW derives grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure
