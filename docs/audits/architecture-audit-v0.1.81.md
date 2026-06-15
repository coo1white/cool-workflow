# cool-workflow v0.1.81 — Architecture Audit

**Date:** 2026-06-15
**Scope:** Comprehensive — software structure/maintainability **and** red-line / moat adherence.
**Method:** Multi-agent fan-out (10 subsystem maps + targeted dimension audits) with per-claim adversarial verification, plus direct grep corroboration. ~40k LOC TypeScript, 58 source files, 87 smoke tests.

> Provenance note: the initial 19-agent workflow run was killed mid-Audit after 1.4M tokens; 8 subsystem maps were recovered from its journal and the remainder completed via a leaner targeted fan-out. Findings below were each read against the actual code; adversarial verifiers were used on the two highest-value dimensions (replay determinism, fail-closed gates).

---

## 1. Executive summary

CW is, structurally, a **genuinely faithful control-plane**: the central red line — *delegate, never execute* — holds cleanly. No model SDK, inference endpoint, or network call to a model exists anywhere in `src/`; every execution path spawns an external agent out-of-process (`shell:false`), records self-reported usage verbatim, and holds only a public verification key. Fail-closed gating is real and multi-layered (no *live* false-green path was found), tamper-evidence is honestly documented, and the type boundary (`types/boundary.ts` one-way weld) is excellent.

The single biggest risk is **not** in production gating but in the **replay-determinism guarantee CW sells**: the headline multi-agent replay eval (`multi-agent-eval.ts:350`) compares the baseline projection against a byte-copy of *itself* rather than re-deriving from raw captured state — so a determinism regression in the projection logic would still report `pass`. That is a false-green on the exact property that is CW's moat. A second, lower-blast determinism hole bakes wall-clock into persisted topology ids whenever `topology apply` runs without an explicit `--id`.

Secondary themes: **god-modules and duplicated cross-carve logic** (the small-kernel red line is the one most eroded — `mcp-server.ts` 1591 LOC, `state-explosion.ts` 1419, three `sha256`/`createId` implementations, sync-by-comment gate copies), and **unvalidated `JSON.parse(...) as T` reads of persisted per-record types** that bypass the otherwise-excellent run-state migration machinery.

**One-line red-line verdict:** delegate-not-execute ✅, evidence-gated commit ✅, fail-closed ✅ (one drift hazard), **replay determinism ⚠️ AT-RISK→VIOLATION**, cross-vendor ✅ (partial parity probe), **small-kernel ⚠️ AT-RISK**.

---

## 2. Architecture as-built

CW is a layered, single-kernel control plane. Both surfaces (CLI, MCP) route through one shared core via a capability registry that is the single source of truth for parity.

```
        CLI (cli.ts 1317)        MCP (mcp-server.ts 1591)
              \                      /
            capability-registry.ts  ──  parity gate (cw <cmd> --json == cw_<tool>)
              \                      /
            capability-core.ts (799)  ── mechanism junction (both surfaces call this)
                        |
         ┌──────────────┼───────────────────────────────┐
   orchestrator (1009, fan-out 30)              run-registry (950)
   drive / dispatch / pipeline-runner            + gc / queue / policy
         |                                              |
   execution-backend (1188) + worker-isolation (1084) + sandbox-profile
         |   (spawns EXTERNAL agent, shell:false — the only execution edge)
         |
   ── persisted explicit state ──
   state.ts (45 in-deg) · state-node · state-explosion (1419) · state-migrations · node-snapshot · topology
         |
   evidence/commit gate: commit.ts · candidate-scoring · evidence-reasoning · error-feedback
         |
   trust spine: trust-audit (23 in-deg) · telemetry-attestation · telemetry-ledger · multi-agent-trust
         |
   multi-agent: multi-agent · coordinator(blackboard) · multi-agent-host · multi-agent-eval
         |
   collab/retention: collaboration · reclamation (946) · run-export

   types/* (78 in-deg, the keystone) underpins everything.
```

- **Hubs (in-degree):** `types` (78) — keystone, cohesive, well-split by domain; `state` (45) — but it mixes run-path layout + atomic IO + symlink containment + advisory locking into one hub; `trust-audit` (23) — the auditable spine.
- **God-modules (LOC):** `mcp-server` 1591, `state-explosion` 1419, `cli` 1317, `execution-backend` 1188, `coordinator` 1136, `multi-agent` 1131, `worker-isolation` 1084, `orchestrator` 1009, `run-registry` 950, `reclamation` 946.
- **Highest fan-out:** `orchestrator.ts` imports 30 internal modules (knowingly-accepted per FreeBSD-audit R3).

---

## 3. Red-line / moat adherence verdict

| Red line | Verdict | Evidence |
|---|---|---|
| **1. Delegate-not-execute** | ✅ **PASS** | No `anthropic`/`openai`/model-SDK/inference-URL anywhere in `src/` (grep-confirmed across all 10 subsystems). `runAgentProcess` (`execution-backend.ts:895-967`) and the batch child (`execution-backend/agent.ts:312`) spawn an external binary `shell:false`; the model runs in the agent's own process (`drive.ts:11-13`). Usage is recorded verbatim and verified against an operator **public** key only — CW never measures or signs usage in the runtime (`worker-isolation.ts:381-417`). |
| **2. Replay determinism** | ⚠️ **AT-RISK → VIOLATION** | Ids in `state-node`/trust/commit are deterministic content-hash/seq (FreeBSD-L12/L13). BUT: **(F1)** `multi-agent-eval.ts:350` replay copies the baseline instead of re-deriving → the multi-agent replay eval cannot catch a projection-determinism regression (false-green). **(F2)** `topology.ts:545` `timestampId()` default folds wall-clock into persisted topology run id/node ids/edges/audit events/filenames on any `topology apply` without `--id`. **(F3)** `Math.random()` in persisted ids (`dispatch.ts:222`, `scheduler.ts:258/264/269`, `lifecycle-operations.ts:497`). Hash-bound `createdAt`/`recordedAt` (Claim 1) verified **NOT** a problem — intended edge-stamp, walled off from all cross-run digests. |
| **3. Evidence-gated commit** | ✅ **PASS** | `commit.ts resolveCommitGate` (187-418) refuses any verifier-gated commit lacking a verified verifier node + grounded evidence + complete acceptance rationale; `pipeline-runner.ts:272-289` won't mint a commit node without verifier status + evidence. A "done" claim alone cannot land. |
| **4. Fail-closed gates** | ✅ **PASS** (1 drift hazard) | No *live* false-green found. Empty-capture no-false-green gate blocks both selection and commit; `release-check.js` gates on real process exit status (`status !== 0` throws, missing binary → `null !== 0` → fail). **Hazard (F4):** the `emptyCaptureWarning` gate is duplicated sync-by-comment in `commit.ts:159-166` and `candidate-scoring.ts:785-792` — functionally equal today, but drift could pass an empty-capture result through one surface. |
| **5. Cross-vendor** | ✅ **PASS** (partial probe) | One kernel generates all vendor manifests; capability-registry parity gate blocks undeclared tools/unreachable commands and reasonless exceptions. **Gap (F6):** payload-identity probe covers ~30 read-only capabilities; ~170 write/complex-arg capabilities are parity-declared but not payload-probed for marshalling drift. |
| **6. Small kernel** | ⚠️ **AT-RISK** | 10 god-modules; duplicated logic across carves (3× `sha256`, 3× `createId`, duplicated gate helpers, 3× node-projection field list); inverted dependencies (audit core depends on telemetry sibling for its hash primitive; `node-snapshot` depends on the eval harness). See §5. |

---

## 4. Findings by severity (confirmed)

### P1 — serious (fix soon)

- **F1 · Multi-agent replay eval is verification theater** — `multi-agent-eval.ts:350` sets `replay = snapshot.normalized` (copies the baseline) rather than re-deriving the projection from `snapshot.capture`. `compareMultiAgentReplay` (`:361-371`) then compares the baseline against a byte-copy of itself, so it proves snapshot round-trip but **cannot** catch a determinism regression in `normalizeRun`/summarizers — the `capture` field is dead weight in the compare path. This is a false-green on CW's headline determinism guarantee. (Contrast `node-snapshot.ts:237`, which *does* re-derive — that one is sound.) **Fix:** `replay: normalizeRun(reconstructRunFromCapture(snapshot.capture))` so the compare pits an independent re-derivation against the baseline. *(Borderline P0 — it's a false-green on a red-line property; P1 because it weakens a guard rather than shipping wrong state.)*

- **F2 · Wall-clock baked into persisted topology ids** — `topology.ts:545-546` `timestampId() = new Date().toISOString()` is the default for the topology run id (`:216`), woven into node ids, graph edges, audit events, and on-disk filenames. The default fires on a normal `topology apply` with no `--id` (id is optional in both CLI `cli.ts:255` and MCP `mcp-server.ts:273`), so two replays diverge. Aggravator: the lowercase-`t` format `20260615t144745` doesn't even match the eval normalizer's strip regex. **Fix:** default the id to a content hash of `{definition.id, sorted taskIds, run.id, seq}`; keep `input.id` as explicit override.

- **F3 · `Math.random()` in persisted ids** — `dispatch.ts:222`, `scheduler.ts:258/264/269`, `lifecycle-operations.ts:497`. These are edge id-stamps today, but a PRNG in a persisted identifier is a latent replay hazard (the worker-id path was already de-clocked per the v0.1.40 self-audit; these weren't). **Fix:** replace with seq/content-hash ids, mirroring the de-clocking already done in `worker-isolation/paths.ts`.

- **F4 · Duplicated no-false-green gate (sync-by-comment)** — `emptyCaptureWarning` in `commit.ts:159-166` and `candidate-scoring.ts:785-792`; both carry a "kept in SYNC" comment. The no-false-green property is currently correct but guaranteed only by convention. **Fix:** export one shared gate helper; delete the copy so drift is structurally impossible. *(Also: `sandboxProfileForCandidate` is duplicated `commit.ts:596` / `candidate-scoring.ts:830`.)*

- **F5 · Unvalidated `JSON.parse(...) as T` on persisted per-record types** — `worker-isolation.ts:309/905` (`WorkerScope`), `candidate-scoring.ts:164/631/641` (`CandidateRecord`/`CandidateScore`), `node-snapshot.ts:121/133` (`NodeSnapshot`/`NodeReplayRun`), `multi-agent-operator-ux.ts:502`, `evidence-reasoning.ts:750`. The top-level run-state migration is fail-closed and excellent, but these per-record reads cast straight from disk and `upsert*` immediately, with no shape validation — on-disk drift/tamper corrupts in-memory state silently. **Fix:** a `validate*` guard per persisted type (a `src/validation.ts`), fail-closed before upsert. *(Right-sized to P1: requires drift/tamper of CW-written files to exploit; the run-state envelope itself is already guarded.)*

- **F7 · `process.chdir` for control flow is non-reentrant under the concurrent driver** — `capability-core.ts` `withInvocationCwd` (194-204), `runDrive` (468-485), `quickstart` (512-552) chdir the whole process and restore in `finally`. CW now ships a concurrent driver; a parallel invocation or a throw mid-block can leak/cross cwd globally. **Fix:** thread an explicit `cwd` through the call chain instead of mutating `process.cwd()`.

### P2 — real maintainability / robustness

- **F6 · Parity payload probe covers ~30/200 capabilities** — `capability-registry.ts:513`; ~170 write/complex-arg capabilities are parity-declared but not payload-probed, so a surface-side marshalling drift (e.g. `cw_candidate_score` accepts `criteria` object *and* `criterion` array; CLI only the array form) would pass undetected. **Fix:** extend the payload-identity probe to all `surface:"both"` capabilities, or add roundtrip marshalling tests.
- **F8 · `recordWorkerOutput` is a ~320-line accept-path hub** — `worker-isolation.ts:314-635` fans out to state-node, trust-audit, both telemetry chains, multi-agent, blackboard, pipeline-runner, and the verifier in one method; high blast radius. **Fix:** decompose into ordered, named steps (validate → attest → ledger → verify → record).
- **F9 · Triplicated node-projection field list** — `node-snapshot.ts` projection vs `reclamation.ts:399-417` `snapshotProjectionDigest` vs `reclamation.ts:421-441` `nodeBodyDigest` (header itself says "Mirror node-snapshot.ts"). Three hand-synced copies of one contract → silent drift. **Fix:** single exported projection function.
- **F10 · Triple `sha256`/`createId` entry points** — `multi-agent-trust.ts:417-419` defines its own `hashText` while siblings import `execution-backend.sha256`; three `createId` impls across multi-agent carves (`multi-agent/helpers.ts:130`, `coordinator/util.ts:63`, callers). **Fix:** one shared hashing + id-seq util.
- **F11 · Embedded child programs as template-literal source** — `HTTP_DELEGATE_CHILD` (`execution-backend.ts:787-811`) and `BATCH_DELEGATE_CHILD` (`agent.ts:290-331`) are whole Node programs in strings spawned via `node -e`; untestable as units, no type-checking. **Fix:** extract to real `.js` files in a `scripts/children/` and spawn by path.
- **F12 · Trust-audit god-struct + shotgun surgery** — `RecordTrustAuditInput` (40+ fields, `trust-audit.ts:156-195`) is re-spread in 4+ hand-kept field lists; adding one correlation id means editing all of them in lockstep. **Fix:** group correlation ids into a sub-object threaded as a unit.

### P3 — minor

- `commit.ts:187-418 resolveCommitGate` is a 230-line branch-heavy function (decompose for reviewability).
- `multi-agent-host.ts:460-510 envelope()` recomputes ~11 full O(state) summaries on every host call incl. plain status (no memoization).
- Inverted deps: `trust-audit.ts:18` imports `stableStringify` from `telemetry-attestation` (audit core depends on a sibling for its own integrity primitive); `node-snapshot.ts:25-28` (state) imports from `multi-agent-eval` + `pipeline-runner`.

*Investigated, not confirmed:* the hash-bound `createdAt`/`recordedAt` "non-reproducible chain" concern (intended edge-stamp, walled off — NOT a problem); the `reclamation.ts:625` `|| new Date()` tombstone fallback (only a replay nicety; `verifyReclamation` recomputes from persisted `reclaimedAt`, integrity intact); swallowed errors in `maybeCompactRun`/`hashArtifactFile`/registry loaders (best-effort, not gates).

---

## 5. Structural debt & god-module carve priorities

The small-kernel red line is the most eroded. Recommended one-module-per-PR carve order (highest value first), in the established "carve campaign" style:

1. **`state-explosion.ts` (1419)** — split the 6 bundled concerns (state-size, blackboard digest, compact-graph, operator digest, combined report, eval-normalization); the prior helpers/format carve only peeled off primitives. Reduces the 5-subsystem reach-in coupling.
2. **`reclamation.ts` (946)** — separate content-addressing, classifier/planner, tombstone hash-chain, the 5-step transaction, reconstruction, and verification; fold the 3 duplicated node-projection digests into one (F9).
3. **`worker-isolation.ts` recordWorkerOutput (F8)** — decompose the accept hub into ordered steps.
4. **`capability-core.ts` (799)** — the "junction drawer"; the chdir-for-control-flow (F7) should die here too.
5. **Shared-util extraction** — kill the cross-carve duplication (F4, F9, F10): one gates module, one projection fn, one hashing/id-seq util. This is *de-duplication*, the inverse of the carve, and directly restores the small-kernel property.

`mcp-server.ts` (1591) and `orchestrator.ts` (1009) are **knowingly-accepted** (FreeBSD-audit R1/R3 closed won't-fix); leave them unless you revisit those decisions, but note `mcp-server` could still cleanly split tool-schema definitions from the dispatch switch for reviewability.

---

## 6. Prioritized recommendations

1. **Fix F1 first** — make `replayMultiAgentSnapshot` re-derive from `snapshot.capture`. It is a false-green on the determinism property that *is* the moat; everything else is secondary. Add a regression test that injects a determinism bug into a projection and asserts the eval now fails.
2. **Close the determinism edges (F2, F3)** — content-hash the topology default id; de-clock the `Math.random()` persisted ids. Then add a grep gate to `release-check.js` that fails on `Math.random(` / `timestampId(` inside persisted-id construction.
3. **De-duplicate the no-false-green gate (F4)** into one exported function — convert a conventional guarantee into a structural one.
4. **Add a persisted-record validation layer (F5)** — `validate*` guards, fail-closed before `upsert*`. Pairs naturally with the reclamation/worker-isolation carves.
5. **Fix the chdir reentrancy (F7)** before leaning harder on the concurrent driver — this is a real latent concurrency bug, not just style.
6. **Broaden the parity payload probe (F6)** to all both-surface capabilities.
7. **Then proceed with the §5 carve campaign** (state-explosion → reclamation → worker-isolation accept path → capability-core) plus the shared-util extraction.

---

## 7. What's healthy (credit where due)

- **The core red line is genuinely held.** Delegate-not-execute is not aspirational here — it is grep-clean across every subsystem, spawn is `shell:false`, usage is verified against a public key only, and the kernel mints no model anchor. This is the hard part and it's done right.
- **Fail-closed gating is real and layered** — verifier gate + grounded-evidence + empty-capture + acceptance-rationale, stacked; review gate can only *add* constraints; `release-check.js` gates on real exit status. No live false-green exists.
- **`types/boundary.ts` one-way type weld** — `OneWayData<T>` poisons any callable to `never` at compile time, mechanically preventing executor/SDK handles from crossing into persisted/result envelopes. Excellent, underused-elsewhere idea.
- **Run-state migration machinery** (`contract-migration.ts`, `state-migrations.ts`) is fail-closed on unknown/newer schema versions and supports forward/reverse edges via BFS — the top-level persistence contract is well-defended.
- **Tamper-evidence with an honest ceiling** — two independent hash chains, each re-provable from persisted fields, and the code *documents* that a determined local re-chainer isn't stopped because CW holds no private anchor. Honesty about limits is itself an auditability virtue.
- **`state.ts` durability primitives** — symlink-hardened path containment (resolves deepest existing ancestor to defeat planted symlinks), atomic temp+rename writes, advisory file locking. The substrate the whole kernel sits on is solid.
- **Deterministic ids where it counts** — `state-node` content-hash ids and seq-based ids elsewhere are correct; the determinism gaps (F1–F3) are at the edges, not the spine.
