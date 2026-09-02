# Historical architecture-review verdicts (v0.1.38 and v0.1.39)

Two raw verdicts from CW's own architecture-review runs against this
repository, kept word for word as audit records. Findings here may be
fixed by now. They were two files until 2026-09-02; they are one file now
so the .md count stays inside the growth budget.

---

## Verdict at v0.1.38 (first agent-delegation drive)

<!-- Cool Workflow architecture-review — agent-delegation drive (v0.1.38) -->
<!-- Repo: cool-workflow | Agent-reported model: claude-opus-4-8[1m] | 14/14 workers, verifier-gated commit -->

# Architecture Verdict — Audit CW's Architecture

## Short answer

**Cool Workflow is a well-designed system being audited against the right standard, and it holds up: there is no P0.** It is a local-first, file-backed *control plane* that delegates execution and records an audit trail — there is no database, no embedded model SDK, no stored API key, and no network listener beyond an optional loopback read-only workbench. Its logical design is genuinely strong (fail-closed delegation, deterministic replay, bounded retry/park scheduling, a CLI↔MCP capability registry that fails closed on drift). The real risks cluster in two places: **(A) a physical-durability layer that doesn't match the "durable, auditable state" promise** — every authoritative write is a non-atomic, unlocked `fs.writeFileSync` — and **(B) trust-gaps where an auditor can over-trust what CW actually enforced** — the evidence gate checks presence not grounding, sandbox command/network/env restrictions are only *attested* on the default dispatch path, agent model provenance is self-reported, and the review/commit separation-of-duties gate is caller-asserted. Every one of these was independently re-verified against current source by the verification lens; **six are P1, all the rest P2/P3.** Most are inherent to the documented "delegate, don't execute / CW is not an auth server" red line — the fix for those is to *surface the boundary*, not to internalize execution.

## Architecture map

```
 Entry surfaces (no authN — trust boundary is the OS user)
 ┌────────────┬───────────────┬──────────────────────────────┐
 │ MCP server │     CLI       │  Workbench host (optional)     │
 │ JSON-RPC   │   argv        │  HTTP 127.0.0.1, GET-only,     │
 │ over stdio │               │  read-only, DNS-rebind guard   │
 └─────┬──────┴──────┬────────┴───────────────┬───────────────┘
       │             │   (parity-gated against │
       └──────┬──────┘    capability-registry) │
              ▼                                 ▼
   ┌───────────────────────────────────────────────────┐
   │   CoolWorkflowRunner  (orchestrator.ts — god class) │  ← single coupling hub
   │   + capability-core                                │
   └───┬───────────────┬───────────────┬────────────────┘
       ▼               ▼               ▼
  Execution-backend  Scheduling     Trust / collaboration
  (mechanism/policy   kernel +       gate, verifier,
   seam, fail-closed) drive loop     trust-audit log
   node/bun/shell │   lease/retry/   (commit requires
   container/     │   park (pure)    verified+evidence)
   remote/ci/     │
   AGENT ←red line: spawns external agent argv-style,
                   imports no SDK, holds no key
       ▼
  Worker isolation + sandbox profile
   • CW enforces: result-write acceptance (lexical path check)
   • Host enforces: OS read/write/exec/network/env isolation
       ▼
  Persistence: plain JSON under .cw/  (gitignored, 0 runtime deps)
   • per-run state.json = single source of truth
   • home registry queue.json, scheduler store, trust-audit JSONL
   • all writes via one primitive: writeJson → fs.writeFileSync
```

The factoring is clean and the seams are real (mechanism vs. policy, CW-enforced vs. host-required, evidence vs. provenance). The red line holds: no model SDK or key anywhere in the control plane.

## Ranked risks (real P1s first)

**P1 — Non-atomic, un-fsync'd durable writes corrupt authoritative state.** `writeJson` is the single persistence primitive for `state.json`, registry overlays, nodes, and the schedule store — it does in-place `fs.writeFileSync` with no temp-file+rename or fsync (`state.ts:97`). A crash/kill/`ENOSPC` mid-write truncates the file; reload throws `Invalid JSON` (`state.ts:87`) and the run is wedged with no `.bak`/journal. Repo-wide grep confirms *no* `renameSync`/`mkdtemp`/`O_EXCL` anywhere. This directly undercuts the "durable, auditable state" value proposition. *Real.*

**P1 — Unlocked read-modify-write on shared cross-process stores.** The home queue (`run-registry.ts:290`/`:300`), scheduler store (`scheduler.ts:152`), and daemon inbox (`daemon.ts:34`) are last-writer-wins with no `flock`. The long-running daemon and the CLI mutate the same files concurrently, so a newly-added task can vanish and `queueDrain` can double-drain — despite the scheduling kernel *promising* a concurrency ceiling it cannot uphold across processes. *Real.*

**P1 — Evidence gate is presence-only, not grounded.** `hasEvidence` only checks the evidence array is non-empty with some trimmed string (`verifier.ts:80`), and the commit gate requires a verifier node with a non-empty evidence array (`commit.ts:255`). Fabricated `file.ts:42` locators satisfy the entire gate. For the flagship "auditable risk-analysis" use case this means the guarantee is *presence of evidence*, not *correctness of evidence* — weaker than the positioning implies. *Real, structurally central.*

**P1 — Sandbox command/network/env restrictions are only attested on the dispatch path.** `validateWorkerBoundary` calls *solely* `validateSandboxWrite` (`worker-isolation.ts:581`); `validateSandboxCommand`/`validateSandboxNetwork` exist (`sandbox-profile.ts:270`) but are never invoked there, and `delegate-host` mode downgrades every dimension except `write` to `attest` (`execution-backend.ts:293`). A `network:none`/`execute:none` profile (`sandbox-profile.ts:91`) produces an audit record that *looks* contained while CW enforced none of it. *Real (documented host-delegation, but a false-containment misuse surface).*

**P1 — Agent model provenance is self-reported.** The attested model id recorded as `host-attested` provenance is parsed best-effort from the agent child's own stdout (`execution-backend.ts:855` → `worker-isolation.ts:407`). Correct for the red line (CW refuses to assert the operator-chosen model), but the one field an auditor uses to prove *which model did the work* is only as trustworthy as the agent's self-report. *Real.*

**P1 — `CoolWorkflowRunner` god class is the single coupling hub.** `orchestrator.ts:231` — ~2142 lines / ~141 methods spanning every subsystem, depended on by the CLI (`cli.ts:76`), MCP (`mcp-server.ts:54`), capability-core, drive, and workbench. The chokepoint for nearly all change and the testability bottleneck (compounded by zero unit tests). *Real — highest future-change-risk.*

**P1 (conditional, by-design) — Review/commit separation-of-duties is caller-asserted.** The gate implies enforced SoD, but `attested` is taken straight from caller input (`collaboration.ts:142`) and `disqualify` trusts the actor verbatim (`collaboration.ts:392`). Any CLI/MCP caller can post N distinct fabricated `attested:true` approvals. Bounded by the OS-user trust boundary ("CW is not an auth server") — keep as **P1-advisory**: the one place a *security property a reader would assume* is not actually delivered.

**P2 (conditional) — remote/ci delegation can exfiltrate the full host env** when a remote backend is configured *and* `policy.env.inherit:true` (`execution-backend.ts:733`/`:1206`); two conditions must hold, default-safe otherwise.
**P2 (conditional) — `shell` backend runs joined argv via `shell:true`** (`execution-backend.ts:479`) while node/bun use `shell:false`; trusted-config surface today, injection sink if templated task params reach it.
**P2 (conditional) — unvalidated `runId` reaches `path.join`** in `loadRunFromCwd` (`state.ts:51`), reachable from MCP `cw_status` (`mcp-server.ts:121`); bounded info-disclosure of `state.json`-named files.
**P2 (conditional) — non-reproducible supply chain:** committed/shipped `dist/` built via `npm install --no-package-lock` (`ci.yml:21`) with gitignored lockfile (`.gitignore:5`) and floating devDeps; drift gate catches output, not inputs.
**P2 (real) — durability/integrity cluster:** corruption masked-then-overwritten in the registry (`run-registry.ts:296`/`:300`); one malformed line bricks the entire trust-audit log and blocks all future events (`trust-audit.ts:189`/`:140`/`:462`); non-transactional 3-file commit drifts the source of truth on crash (`commit.ts:115`); coordinator message log fully rewritten non-atomically (`coordinator.ts:903`); in-place migration with no backup (`state.ts:74`); daemon has no graceful shutdown/singleton (`daemon.ts:47`).
**P2 (real) — scale:** unbounded run-state growth, archive is overlay-mark-only with no GC (`run-registry.ts:670`; measured **1.0 GB / 259 runs / ~29,882 files**); registry full-re-scan + re-parse of every `state.json` per op, uncached (`run-registry.ts:376`).
**P2 (real) — maintainability:** capability wiring hand-duplicated across 4 touchpoints (`cli.ts:88`, `mcp-server.ts:114`, `capability-registry.ts:1`); several oversized modules; default-path verifier node auto-advances to `verified`/`accepted` on mere result acceptance (`worker-isolation.ts:432`, compounds the evidence-gate P1); zero `*.test.ts`.
**P2 (latent) — wall-clock/`Math.random` ids vs. replay determinism** (`worker-isolation.ts:847`, `node-snapshot.ts:90`): not a live break today (replay reuses captured bodies), but any future path regenerating ids during replay silently violates the byte-identical invariant.

## Non-issues (correctly classed within the local-first, OS-user model)

- **Lexical (non-realpath) write boundary** — `..` and control chars are rejected and the prefix is resolved (`sandbox-profile.ts:336`/`:509`); only symlink escape remains, explicitly delegated to the host OS sandbox.
- **Workbench `process.chdir()` race** (`workbench-host.ts:116`) — a real *reliability* bug, but localhost/GET-only/read-only: no privilege crossing, not a security issue.
- **No CSP header** — DOM-XSS already mitigated by `textContent` rendering; localhost read-only.
- **Unauthenticated MCP/CLI** — by design; the trust boundary is the OS user.
- **Non-crypto `Math.random` ids** — not used as auth/capability tokens (the replay-determinism angle is the only live concern, captured above).

## Recommended changes (in priority order)

1. **Make `writeJson` atomic + add locking.** Temp-file → `fsync` → `rename` for every authoritative write, and a lockfile/`O_EXCL` (or single-writer discipline) on the cross-process queue/scheduler stores. This single change retires two P1s and most of the P2 durability cluster.
2. **Ground the evidence gate.** Verify locators resolve to real files (and ideally that cited lines exist) before accepting evidence; stop auto-advancing the default-path verifier node to `verified` without an independent check.
3. **Surface the enforcement boundary honestly.** Where a profile declares `network:none`/`execute:none`/env limits but CW only *attests* them, label the audit record as host-attested-not-CW-enforced; likewise mark the review/commit SoD gate as advisory (or add a host-verifiable, unforgeable attestation).
4. **Harden the audit log.** Per-line parse guard so one bad line can't brick the log or block future events; add a hash-chain for tamper-evidence to back the "auditable" claim.
5. **Add a GC/prune path + a cached registry index.** Retire the unbounded-growth and O(runs) re-scan P2s before the 1.0 GB store gets worse.
6. **Config-gated hardening:** scheme/allowlist on delegation endpoints, refuse `env.inherit:true` + remote endpoint without explicit opt-in, validate `runId`/reject lone `..` in `safeFileName`, quote/argv the `shell` backend, and commit the lockfile (`npm ci`) for a reproducible `dist/`.
7. **Decompose `CoolWorkflowRunner`** into per-domain services behind a thin facade, and add unit tests — sequence this *after* (1)–(2) since the smoke-only suite raises the refactor's risk.

## Evidence links

Core P1 locators verified verbatim this session: `state.ts:97` (non-atomic write), `verifier.ts:38-50,75-82` (presence-only evidence), `worker-isolation.ts:574-582` (dispatch validates only write), `collaboration.ts:142-147` (attested-from-input), `execution-backend.ts:479-480` (shell:true vs shell:false). Full chains in the per-lens worker results under `.cw/runs/architecture-review-20260609T023238Z-k3yfhl/workers/`.


---

## Verdict at v0.1.39

<!-- Cool Workflow architecture-review — Run Retention & Provable Reclamation (v0.1.39) -->
<!-- Repo: cool-workflow @ bc1473a | Agent-reported model: claude-opus-4-8[1m] | adversarial self-audit of the v0.1.39 surface -->

# Architecture Verdict — Audit CW's Architecture @ v0.1.39

## Short answer

**Still no P0. The system holds, and the v0.1.39 reclamation feature is well-factored — but it introduces a real durability seam that the rest of the transaction's rigor does not cover.** The happy path is sound and was re-verified live: `gc verify` on a real reclaimed run returns `verified=true`, the hash chain recomputes independently, and the audit allow-list (`state.json`, `audit/`, `commits/`, `reclaimed.json`) is never freed. The write-ahead ordering (seal skeleton → write tombstone with pre-deletion sha256 → **fsync** → free) genuinely makes the *tombstone* crash-safe, and `writeJsonDurable` is the **first atomic durable write in the codebase** — a direct, if scoped, answer to the prior verdict's #1 recommendation. The real v0.1.39 risks cluster in one place: **the result-node re-point that scratch reclamation depends on lives OUTSIDE the write-ahead durability boundary** — it mutates `state.json` in memory and is persisted only *after* the bytes are already gone (or never, for direct callers), so a crash in that window or a primitive misuse leaves a node referencing a freed path with a tombstone that claims capability is unchanged. Three P1s, all real and grounded; everything else P2/P3. The prior top P1 (non-atomic, unlocked `writeJson` for `state.json`/registry/scheduler) is **unaddressed** and now has a sibling on the new `reclaimed.json`.

## What v0.1.39 got right (addressed since the prior verdict)

- **A GC/prune path now exists** (`reclamation.ts` + `gc plan|run|verify`) — the prior P2 "unbounded run-state growth, archive overlay-mark-only, 1.0 GB / 260 runs" has a remedy, dry-run-first and fail-closed.
- **First atomic durable write** — `writeJsonDurable` (temp → `fsync` → `rename` → dir `fsync`, `reclamation.ts:143`) makes the tombstone commit crash-safe. This is exactly the technique the prior verdict's recommendation #1 asked for, applied (so far) only to `reclaimed.json`.
- **Tamper-evident audit** — the hash-chained tombstone (`computeTombstoneHash` recomputed independently by `verifyReclamation`, `reclamation.ts:790`) is a partial answer to recommendation #4. Confirmed: flipping a manifest sha or a chain link is caught with distinct codes.
- **Capability downgrade is explicit and queryable** — `run show` surfaces `tier`/`capability`/`capabilityReason` from a closed enum, not prose.

## Ranked risks (real P1s first)

**P1 — The scratch re-point lives OUTSIDE the write-ahead durability boundary.** `freeBulk` re-points the result node's `worker-result` artifact in memory and then deletes the scratch bytes (`reclamation.ts` `freeBulk`), but the `state.json` write that makes the re-point durable happens *afterward* — `saveCheckpoint(run)` runs only once `runReclamation` returns, in `run-registry.ts:905`. The transaction guarantees the *tombstone* is fsynced before any free, but the *node mutation the free depends on* is not. A crash between `freeBulk` and `saveCheckpoint` leaves: tombstone committed, scratch deleted, and `state.json` still pointing the result node's `worker-result` artifact at the freed scratch path. On reload `loadNodeSnapshot` returns `absent` (a silent replay downgrade) — while the tombstone advertises `capability: re-runnable, scratch-only-reclaimed`, i.e. *unchanged*. The audit record and reality diverge. *Real; the one place the write-ahead invariant has a hole.*

**P1 — `freeBulk` never enforces the spec's "prove the snapshot stays valid BEFORE freeing" precondition.** The design requires proving the result-node snapshot is `valid` (not `absent`) before deleting scratch. `repointResultNodeArtifacts` is best-effort: it re-points only when it finds a sibling `result` artifact whose path still exists, and if it doesn't, it **deletes the scratch anyway** (`freeBulk` loops unconditionally). There is no `loadNodeSnapshot === valid` assertion gating the delete. For today's result nodes a retained `result` artifact always exists, so this is latent — but it is an unchecked invariant, not an enforced one. *Real, latent.*

**P1 — Unlocked cross-process read-modify-write on `reclaimed.json` (inherits the prior queue/scheduler P1).** `commitTombstone` does `loadReclamationLog` → `push` → `writeJsonDurable` with no `flock`/`O_EXCL` (`reclamation.ts:636`), and `buildTombstone` separately re-reads the log for `prevTombstoneHash` (`reclamation.ts:606`) — two unsynchronized reads. Two concurrent `gc run` passes over the same run can both read the same prior chain and last-writer-wins: one tombstone is lost, so bytes freed by the losing pass have **no surviving proof** — a direct violation of the append-only "every freed byte leaves a tombstone" invariant. `writeJsonDurable` made the *write* atomic; it did nothing for the *read-modify-write*. Repo-wide grep confirms **no** locking primitive anywhere. *Real; same class as the original, now on the reclamation path.*

**P1 (inherited, unaddressed) — `state.ts:writeJson` is still non-atomic and unlocked.** The single persistence primitive for `state.json`, the registry overlays, and the scheduler store remains in-place `fs.writeFileSync` (`state.ts` `writeJson`). v0.1.39 hardened only its own tombstone; the prior verdict's #1 P1 stands for every other authoritative write, and `gcRun`'s post-free `saveCheckpoint` rides on exactly this non-atomic primitive — compounding P1-A. *Real, carried forward.*

## P2 / P3

**P2 — `validateSkeleton` is presence-of-keys, not presence-of-content.** `commits: []` and `evidenceDigests: []` satisfy the "complete skeleton" gate (`reclamation.ts` `validateSkeleton`), so a run with zero audit content reclaims with an *empty-but-complete* skeleton, and a future extraction bug that silently drops real commits/evidence would not be caught. This echoes the prior verdict's "evidence gate checks presence not grounding" P1, now on the reclamation seal.

**P2 — Direct-primitive callers must `saveCheckpoint` manually.** `runReclamation` mutates `run.nodes` (the re-point) but never persists it; any caller of the primitive that forgets the follow-up `saveCheckpoint` silently loses the re-point (the smoke remembers; nothing enforces it). The API frees bytes but does not persist the state change those freed bytes require.

**P2 — `bytesFreed` is recorded at build time but re-measured at free time.** `buildTombstone` records `dirBytes` per path; `freeBulk` re-measures at delete and returns that sum. Under a concurrent writer appending to scratch the two diverge — the tombstone's `bytesFreed` and the reported freed total disagree.

**P3 — `dirBytes` follows symlinks (`statSync`) while `rmSync` removes the link, not the target.** A symlinked scratch entry would have its *target* size counted into the freed-manifest while only the link is deleted — overstating freed bytes. Not a normal scratch shape; noted for completeness.

## Non-issues (correctly classed)

- **Hash-chain verification trusts nothing stored** — `gc verify` recomputes `tombstoneHash`/`prevTombstoneHash` independently; confirmed 0 failing checks on the real reclaimed run.
- **Allow-list never freed** — `state.json`, `audit/`, `commits/`, `reclaimed.json` retained; confirmed on disk after a live reclaim.
- **Reconstruction vs. re-point conflict** — correctly avoided by retaining any snapshot whose source node is re-pointed in the same pass (fail-closed).
- **`gc run` reclaiming archived terminal runs with `reclaimAfterArchiveDays=0`** — by design for an explicit operator action; it is not a daemon, and defaults reclaim nothing.

## Recommended changes (in priority order)

1. **Pull the re-point INTO the write-ahead transaction.** Make "re-point result-node artifacts + durably persist `state.json` + assert every re-pointed node's `loadNodeSnapshot === valid`" a committed step BEFORE `freeBulk`, and fail closed if any assertion fails. This retires P1-A and P1-B together.
2. **Lock the `reclaimed.json` read-modify-write** (`flock`/`O_EXCL` or single-writer discipline), and generalize the fix to the queue/scheduler/`state.json` writes — closing P1-C and the carried-forward P1-D in one pass (and most of the prior durability cluster).
3. **Strengthen `validateSkeleton` to content, not just keys** — when the run has commits/evidence, require the skeleton to seal them; always seal the terminal verdict.
4. **Make `runReclamation` persist its own mutation** (`saveCheckpoint` inside the transaction) so the primitive is safe by default, not by caller convention.

## Evidence links

Verified verbatim this session against `bc1473a`: `reclamation.ts` `freeBulk` (re-point + unconditional delete), `run-registry.ts:897-905` (`runReclamation` then `saveCheckpoint` — the crash window), `reclamation.ts:636` (`commitTombstone` unlocked RMW), `reclamation.ts:606` (second unsynchronized log read), `state.ts` `writeJson` (still non-atomic), `grep` for `flock|O_EXCL|lockfile` (none). Live happy-path: `gc verify release-cut-…-4va6p2` → `verified=true, tier=reclaimed, 0 failing checks`.
