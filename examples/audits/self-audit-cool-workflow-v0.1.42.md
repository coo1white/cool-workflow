<!-- Cool Workflow self-audit — committed, line-cited example -->
<!-- Repo: cool-workflow @ 46fdd55 | Package version: 0.1.42 -->
<!-- Produced by: CW's own architecture-review workflow, then CURATED + RE-VERIFIED by hand against the working tree -->
<!-- Agent-reported model on the producing run: claude-opus-4-8[1m] (self-reported provenance — see P1-2) -->

# Self-Audit — Cool Workflow Architecture (v0.1.42)

> **What this is.** A real, line-cited architecture-risk report of *this* repository,
> curated from CW's prior architecture-review verdicts (`docs/audits/architecture-review-verdict.md`
> @ v0.1.38, `docs/audits/architecture-review-verdict-v0.1.39.md`) and **re-verified, finding by
> finding, against the v0.1.42 source tree** at commit `46fdd55`. Findings the prior
> verdicts raised that are now FIXED were removed (or moved to "Resolved since prior
> verdicts"), and every remaining cite was re-opened and confirmed to resolve to a real
> `file:line` under `plugins/cool-workflow/src/`. This is the worked example referenced
> by [`docs/publishing-audits.md`](../../docs/publishing-audits.md); use the pre-publish
> validation script there to re-check every cite before republishing.
>
> **Findings verified against the tree.** Each P1/P2 below names an exact locator. They
> were all confirmed present at the cited line in `46fdd55`. Citations are pinned to that
> commit because they WILL drift after refactoring — re-audit and re-pin after any major
> version (see the publishing guide's "Citations go stale" note).

## Scope

- **Repository:** `cool-workflow` (this repo), `plugins/cool-workflow/src/` is the kernel.
- **Subject:** CW's own control-plane architecture — is it sound against its stated
  positioning (an *auditable control plane that delegates execution and never executes
  models*; see [`DIRECTION.md`](../../DIRECTION.md))?
- **Stated invariants under test:** durable/auditable state; evidence-gated commit;
  fail-closed delegation; deterministic replay; "CW enforces write acceptance, the host
  enforces OS isolation"; "CW is not an auth server, the trust boundary is the OS user".

## Short answer

**No P0. The system holds against its own standard, and the durability/auditability
layer the earlier verdicts flagged has been largely closed.** Since the v0.1.38/v0.1.39
verdicts, CW made its core write primitive atomic (temp→rename, optionally fsync),
grounded the evidence gate (machine-shaped locators only, no bare prose), added a
portable cross-process file lock on the shared queue and reclamation chain, made the
trust-audit append durable, made worker ids deterministic for replay, hardened the path
boundary against symlink escape, and decomposed the former ~2142-line orchestrator
god-class into a thin per-domain router. The remaining real risks are **not durability
bugs** — they are **enforcement-boundary truthfulness** risks: places where the audit
record can read as if CW *enforced* a restriction it only *attested*, or where an
identity/provenance field an auditor would trust is in fact caller-asserted or
self-reported. These are inherent to the "delegate, don't execute / not an auth server"
red line; the fix is to **surface the boundary in the record**, not to internalize
enforcement. Two P1s and one P1-advisory remain; everything else is P2/P3.

## Ranked risks (real P1s first)

**P1-1 — Sandbox command/network/env restrictions are only *attested* on the default
dispatch path, not enforced.** The result-acceptance boundary check calls **solely**
`validateSandboxWrite` (`worker-isolation.ts:622`). The sibling enforcers
`validateSandboxCommand` (`sandbox-profile.ts:271`) and `validateSandboxNetwork`
(`sandbox-profile.ts:285`) exist but are **never invoked** on that path, and the default
`node`/`bun`/`shell`/`remote`/`ci` backends declare `network:"attest"` / `read:"attest"`
/ `write:"attest"` in their support matrix (`execution-backend.ts:93`). When a backend
cannot enforce a required dimension it *downgrades it to `attest`* rather than failing —
every dimension except `write` becomes `attest` (`execution-backend.ts:407`). So a
profile that declares `execute:{mode:"none"}` / `network:{mode:"none"}`
(`sandbox-profile.ts:92-93`) yields an audit record that *looks contained* while CW
enforced only the write boundary; the OS host (or a container backend) is what actually
contains the rest. *Real — documented host-delegation, but a false-containment reading
surface. This is the single most important thing the audit record must label honestly.*

**P1-2 — Agent model provenance is self-reported.** On the `agent` backend the model id
recorded as `host-attested` provenance is parsed best-effort from the agent child's own
stdout: `parseAgentReport(stdout)` → `reportedModel` → recorded on the handle
(`execution-backend.ts:1126-1128`). This is *correct* for the red line — CW refuses to
assert the operator-chosen model and records `"unreported"` rather than backfilling — but
the one field an auditor uses to prove *which model did the work* is only as trustworthy
as the agent's self-report. *Real; bounded by the delegation model. Label the field as
agent-self-reported, not CW-verified.*

**P1-advisory — Review/commit separation-of-duties is caller-asserted.** The review gate
counts distinct, attested, authorized, non-self approvals — but `attested` is derived
straight from caller input (`collaboration.ts:144-147`: `input?.attested ?
"host-attested" : "operator-recorded"`), and `disqualify` trusts the actor's `kind`,
`attested`, `roleId`, and `id` verbatim (`collaboration.ts:392-397`). Any CLI/MCP caller
can post N distinct fabricated `attested:true` approvals under different ids and clear the
gate. This is **bounded by the OS-user trust boundary** ("CW is not an auth server"), so
it is *advisory by design* — the gate is a recorded workflow control, not an
authentication boundary. Keep as **P1-advisory**: it is the one place a reader might
assume a security property (unforgeable SoD) that is not actually delivered. The fix is
honest labeling (and optionally a host-verifiable attestation), not adding an auth server.

## P2 / P3

**P2 — The scheduler store read-modify-write is unlocked.** The v0.1.40 portable lock
(`withFileLock`, `state.ts:218`) was applied to the home queue and the reclamation chain
(`run-registry.ts:299`, `run-registry.ts:1049`; `reclamation.ts:152`) but **not** to the
scheduler store: `setStatus` does `load()` → mutate → `save()` as separate, unsynchronized
calls (`scheduler.ts:143-148`), and `save` writes atomically+durably but takes no lock
(`scheduler.ts:162-165`). Two concurrent scheduler mutations are still last-writer-wins
even though the *write itself* can no longer tear. *Real, narrower than the original
cross-store P1 (which is now fixed for the queue).*

**P2 — `shell` backend runs joined argv via `shell:true`.** The shell driver spawns
`[command, ...args].join(" ")` with `shell:true`, while node/bun spawn argv-style with
`shell:false` (`execution-backend.ts:622-624`). A trusted-config surface today, but an
injection sink the moment templated task params reach the shell backend's command.

**P2 — One malformed line bricks the entire trust-audit log read.**
`listTrustAuditEvents` does `.map((line) => JSON.parse(line))` with no per-line guard
(`trust-audit.ts:187-193`); a single corrupt JSONL line throws and makes every audit
summary/query fail. The *append* is now durable (`durableAppendFileSync`,
`trust-audit.ts:142`), but the *read* is still all-or-nothing — undercutting the
"auditable" claim under partial corruption. (No hash-chain on the trust-audit log either;
the reclamation chain has one, the event log does not.)

**P2 — Delegated execution inherits the full host env when `env.inherit` is set.**
`buildChildEnv` returns `{...process.env}` whole when `policy.env.inherit` is true
(`execution-backend.ts:1361-1362`), and the agent child is always spawned with
`env:{...process.env}` so its own credentials resolve (`execution-backend.ts:1112`).
Default-safe (inherit is opt-in and the default profiles filter env), but pairing
`env.inherit:true` with a remote/ci/agent endpoint can carry host secrets off-box. Refuse
that combination without an explicit opt-in.

**P3 — Smoke-only test suite; no `*.test.ts` unit tests.** Coverage is ~40 end-to-end
smoke scripts under `plugins/cool-workflow/test/` (e.g. `self-audit-hardening-smoke.js`,
`durable-atomic-write-smoke.js`) run by `npm test`. Good behavioral coverage, but the
absence of fine-grained unit tests raises the risk of any future refactor of the
enforcement-boundary code above. *(The earlier verdict's "zero tests" is stale — it is
smoke-only, not zero.)*

## Resolved since prior verdicts (do NOT cite these as live risks)

These were P1/P2 in `docs/audits/architecture-review-verdict.md` / `-v0.1.39.md` and are **fixed** in
`46fdd55`. Listed so a reader cross-referencing the old verdicts does not re-flag them:

- **Non-atomic, un-fsync'd `writeJson`** → now atomic temp→rename, optional fsync of file
  and dir (`state.ts:114-146`); `saveCheckpoint` writes `state.json` durably
  (`state.ts:82-86`).
- **Presence-only evidence gate** → now *grounded*: evidence must be a URL, path-like
  locator, or `namespace:value` token, not free prose (`evidence-grounding.ts:48`,
  enforced at `verifier.ts:40` and per-finding `verifier.ts:73`), with opt-in on-disk
  resolution via `CW_REQUIRE_RESOLVABLE_EVIDENCE` (`evidence-grounding.ts:53`).
- **Unlocked cross-process queue/reclamation RMW** → portable advisory lock
  (`withFileLock`, `state.ts:218`) on the queue (`run-registry.ts:299`,
  `run-registry.ts:1049`) and reclamation chain (`reclamation.ts:152`). *(Scheduler RMW
  still open — see P2.)*
- **No GC / unbounded run-state growth** → `reclamation.ts` + `gc plan|run|verify` with a
  write-ahead, hash-chained tombstone.
- **Non-durable audit append** → `durableAppendFileSync` fsyncs each event
  (`trust-audit.ts:142`, primitive at `state.ts:157`).
- **`Math.random` worker ids vs. replay determinism** → ids are now a deterministic
  `task + per-task sequence` (`worker-isolation.ts:888-899`).
- **Lexical (non-realpath) write boundary / symlink escape** → `realResolve` /
  `isContainedPath` resolve the deepest existing ancestor via `realpathSync`
  (`state.ts:180-201`).
- **~2142-line `CoolWorkflowRunner` god-class** → decomposed into per-domain operation
  modules behind a thin router (`orchestrator.ts:30-38` imports `audit-operations`,
  `lifecycle-operations`, etc.; the class is now ~986 lines of delegation).

## Non-issues (correctly classed within the local-first, OS-user model)

- **Unauthenticated MCP/CLI** — by design; the trust boundary is the OS user
  ([`DIRECTION.md`](../../DIRECTION.md)). CW is not an auth server.
- **No model SDK / no API key in the control plane** — the red line. The `agent` backend
  spawns an external child argv-style (`shell:false`) and imports no model SDK.
- **Symlink escape past the lexical boundary** — now mitigated by realpath resolution
  (`state.ts:180-201`); residual OS-level isolation is explicitly host-delegated.

## What CW enforces vs. what CW attests (the enforcement boundary)

This table is the audit's load-bearing disclaimer. An auditor reading a CW run record
must not over-trust the "attest" column.

| Dimension | Default `node`/`bun`/`shell` path | Where enforced |
| --- | --- | --- |
| Write (result-output acceptance) | **CW-enforced** (`validateSandboxWrite`, `worker-isolation.ts:622`) | CW kernel |
| Command allow/deny | **Attested only** — `validateSandboxCommand` exists (`sandbox-profile.ts:271`) but is not on the dispatch path | Host / container backend |
| Network allow/deny | **Attested only** — `validateSandboxNetwork` exists (`sandbox-profile.ts:285`) but is not on the dispatch path | Host / container backend |
| Env exposure | Filtered by `buildChildEnv` unless `env.inherit` (`execution-backend.ts:1361-1362`) | CW filters / host |
| Model provenance | **Agent self-reported** (`execution-backend.ts:1126-1128`) | Agent host |
| Review SoD | **Caller-asserted** (`collaboration.ts:144-147`, `collaboration.ts:392-397`) | OS user |

> For `network:none` / `execute:none` to be *enforced* (not just attested), run the worker
> under the `container` backend or an OS-level sandbox. CW's own record tells you which
> dimensions it enforced via the per-backend support matrix and the sandbox attestation —
> read that, don't assume the profile's declared restriction was applied by CW.

## Recommended changes (in priority order)

1. **Surface the enforcement boundary in the record.** Where a profile declares
   `network:none` / `execute:none` / env limits but the backend only `attest`s them, the
   audit record should read host-attested-not-CW-enforced (it already carries the support
   matrix and attestation — make the human-facing summary say it plainly). Likewise mark
   the model-provenance field as agent-self-reported and the review/commit SoD gate as
   advisory.
2. **Lock the scheduler store RMW** with `withFileLock` (`state.ts:218`), the same
   primitive already used for the queue and reclamation chain — closes the last
   unsynchronized cross-process store (P2).
3. **Per-line guard the trust-audit read** so one bad JSONL line cannot brick the whole
   log (`trust-audit.ts:187-193`), and add a hash-chain to the event log for
   tamper-evidence (the reclamation chain already demonstrates the technique).
4. **Refuse `env.inherit:true` + a remote/ci/agent endpoint** without an explicit opt-in
   flag, so delegated execution cannot silently carry host secrets off-box
   (`execution-backend.ts:1361-1362`).
5. **Quote/argv the `shell` backend** (`execution-backend.ts:622-624`) before any path
   lets templated task params reach it.
6. **Add unit tests around the enforcement-boundary code** (P1-1/P1-2 paths) before the
   next refactor of `worker-isolation.ts` / `execution-backend.ts`.

## Verification log

| Risk | Classification | Evidence | Notes |
| --- | --- | --- | --- |
| Command/network/env attested-only | real (P1) | `worker-isolation.ts:622`, `sandbox-profile.ts:271`, `sandbox-profile.ts:285`, `execution-backend.ts:93`, `execution-backend.ts:407` | Dispatch path calls only `validateSandboxWrite` |
| Model provenance self-reported | real (P1) | `execution-backend.ts:1126-1128` | Recorded `host-attested`, parsed from agent stdout |
| SoD caller-asserted | real (P1-advisory) | `collaboration.ts:144-147`, `collaboration.ts:392-397` | Bounded by OS-user trust boundary |
| Scheduler RMW unlocked | real (P2) | `scheduler.ts:143-148`, `scheduler.ts:162-165` | Queue is locked; scheduler is not |
| `shell:true` joined argv | conditional (P2) | `execution-backend.ts:622-624` | Injection sink if params templated in |
| One bad line bricks audit read | real (P2) | `trust-audit.ts:187-193` | Append is durable; read is all-or-nothing |
| Full host env on `inherit` | conditional (P2) | `execution-backend.ts:1361-1362`, `execution-backend.ts:1112` | Default-safe; opt-in inherit |
| Smoke-only suite | real (P3) | `plugins/cool-workflow/test/*-smoke.js` | No `*.test.ts` unit tests |

## Reproduce

```bash
# 1. Pin to the audited commit.
git -C /path/to/cool-workflow checkout 46fdd55

# 2. Re-verify every cite resolves (see docs/publishing-audits.md for the full script).
bash docs/scripts/verify-audit-cites.sh examples/audits/self-audit-cool-workflow-v0.1.42.md

# 3. Run the suite that regression-tests the resolved findings.
cd plugins/cool-workflow && npm test
```
