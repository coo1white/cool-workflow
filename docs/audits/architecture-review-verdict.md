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
