# Roadmap Build Prompts

Bootstrap development prompts for upcoming Cool Workflow releases. Each is a
self-contained spec to develop one version by **dogfooding the live plugin**
(`claude --plugin-dir`), following the project's FreeBSD discipline and the
v0.1.33 Release Tooling flow (`bump:version` / `new:feature` / `forward-ref`).

These were generated grounded in the actual modules each feature touches, then
adversarially verified against the source for code-accuracy.

| Version | Prompt | Builds on |
| --- | --- | --- |
| v0.1.34 | [Real Execution Backend Integrations](v0.1.34-real-execution-backends.md) | v0.1.29 ExecutionBackend driver layer — make container/remote/ci really drive docker/podman, a remote runner, a CI job; opt-in, fail-closed, byte-stable evidence vs `node`. |
| v0.1.35 | [Node Snapshot / Diff / Replay](v0.1.35-node-snapshot-diff-replay.md) | v0.1.23 eval/replay — per-node snapshot, diff, and deterministic single-node replay. |
| v0.1.36 | [Contract Migration Tooling](v0.1.36-contract-migration-tooling.md) | `state-migrations.ts` — a declared migration registry with compatibility proofs, fail-closed, append-only. |
| v0.1.37 | [Control-Plane Scheduling](v0.1.37-control-plane-scheduling.md) | v0.1.28 Run Registry queue — priority, concurrency limits, retry/backoff as policy-as-data. |
| v0.1.38 | [Agent Delegation Drive](v0.1.38-agent-delegation-drive.md) | v0.1.29/34 delegating backends — an `agent` driver that spawns an external agent process per worker (`claude -p` / `codex exec` / HTTP), captures result.md + attestation, and auto-drives plan→dispatch→fulfill→accept→commit. First turnkey product: architecture-review. |
| v0.1.39 | [Run Retention & Provable Reclamation](v0.1.39-run-retention-provable-reclamation.md) | v0.1.28 archive overlay + v0.1.35 snapshot + v0.1.37 policy — tiered, append-only, cryptographically-verifiable disk reclamation: seal the audit skeleton, free the reconstructable bulk, prove it (`gc plan/run/verify`). |
| v0.1.40 | [Reclamation Durability Hardening](v0.1.40-reclamation-durability-hardening.md) | v0.1.39 reclamation self-audit — close the durability seams: re-point inside the write-ahead boundary (durable persist + dangling-ref proof), per-run lock on the tombstone chain, atomic `writeJson` everywhere, content-validated skeleton. |

Run them in order: each assumes the previous version has shipped.
