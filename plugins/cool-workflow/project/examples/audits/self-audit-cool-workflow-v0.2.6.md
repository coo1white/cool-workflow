<!-- Cool Workflow self-audit — committed, line-cited example -->
<!-- Repo: cool-workflow @ 4121cb01 | Package version: 0.2.6 -->
<!-- Produced by: an 18-agent Claude Code Workflow — 8 agents independently re-verified every finding in the
     v0.1.42 self-audit against the current tree; 5 agents mapped new risks across 5 assessment lenses
     (security/enforcement-boundary, data-correctness/replay, failure-modes/fail-closed, scale-ops/concurrency,
     maintainability/dead-code); a further agent per new candidate finding adversarially re-verified it
     (refute-by-default). Then CURATED + WRITTEN UP by hand against the working tree. -->
<!-- Agent-reported model: claude-sonnet-5 (the session's own model — not self-reported by a delegated CW
     execution backend; see P1-2 below for why that distinction matters). -->

# Self-Audit — Cool Workflow Architecture (v0.2.6)

> **What this is.** The v0.1.42 self-audit (`self-audit-cool-workflow-v0.1.42.md`, in this same directory) is
> a historical snapshot whose citations no longer resolve — the core/shell `src/` split moved every file it
> cited. This is a fresh audit at the current version: every one of that audit's 8 findings was independently
> re-checked against the current tree (still open, fixed, or changed), and 5 new assessment lenses swept for
> risks in subsystems that didn't exist or weren't in scope at v0.1.42 (the eval/replay harness, run retention
> / reclamation, control-plane scheduling, the onramp contract checker). Every citation below was verified
> against the current tree — file exists, cited line is in range, and (for every finding kept below) an
> independent agent re-read the actual code and confirmed the claim, not just the locator. Re-run the checker
> yourself; see "Reproduce" at the bottom.

## Scope

- **Repository:** `cool-workflow` (this repo), `plugins/cool-workflow/src/` is the kernel.
- **Subject:** CW's own control-plane architecture — is it sound against its stated positioning (an *auditable
  control plane that delegates execution and never executes models*; see AGENTS.md's
  [Product Direction & Moat](../../../../../AGENTS.md#product-direction--moat))?
- **Stated invariants under test:** durable/auditable state; deterministic replay; evidence-gated commit ("no
  silent pass"); fail-closed on corrupt/unverifiable input; "CW enforces write acceptance, the host enforces OS
  isolation"; "CW is not an auth server, the trust boundary is the OS user."

## Short answer

**Still no P0.** Of the v0.1.42 audit's 8 findings, 4 are genuinely fixed (scheduler read-modify-write is now
lock-guarded, the trust-audit log read tolerates corrupt lines instead of bricking, the delegated-agent env leak
is closed for the CLI-binary spawn path, and a real unit-test suite now sits alongside the smoke suite). The
other 4 are still open, and one (the review/commit separation-of-duties gate) got a *wider* self-declaration
surface rather than a narrower one. The five new assessment lenses — run against subsystems that didn't exist or
weren't in scope at v0.1.42 — surfaced 4 more real, currently-exploitable findings, two of them P1: the
eval/replay harness's staleness check is a path-equality comparison that is vacuously true on every rerun (so a
real regression between a replay and the next `score`/`report`/`gate` call can be reported as a stale pass), and
`cw gc run` writes `state.json` through a code path with no lock, racing every other writer of that file. As
with the prior audit, the open findings are not durability bugs in the write-primitive sense — they are places
where the record can read as more verified/enforced than it is, or where a cache/lock boundary was extended to a
new writer without extending the invariant that protects it.

## Ranked risks

**P1-1 — Sandbox command/network/read restrictions are still only *attested* on the default dispatch path — and
the current code makes this explicit and unconditional.** `recordWorkerOutput`'s boundary check and its
`validateWorkerBoundary` helper both still call solely `validateSandboxWrite`
(`shell/worker-isolation.ts:671`, `:622`); nothing in `worker-isolation.ts`, `dispatch.ts`, or `drive.ts` calls
the sibling `validateSandboxCommand` (`shell/sandbox-profile.ts:301-323`) or `validateSandboxNetwork`
(`shell/sandbox-profile.ts:325-347`) — their only callers anywhere in `src/` are inside the manual, opt-in
`cw audit decision --command|--network` CLI path (`shell/audit-cli.ts:19,288-313`). `attestSandbox`
(`shell/execution-backend/registry.ts:321-364`) force-downgrades every dimension except `write` to `"attest"`
whenever called with `mode: "delegate-host"` (shell/execution-backend/registry.ts:335-337) — and `allocateWorkerScope`, which
`shell/dispatch.ts:88` calls for every worker on the standard path, calls it with exactly that mode
(`shell/worker-isolation.ts:498-504`), its own comment stating the design plainly: "the backend enforces only
CW's own worker-output acceptance and attests the rest." *One real improvement since v0.1.42*: `runBackend` now
checks a `commandDenied` allowlist before spawning (`shell/execution-backend/registry.ts:397-407,461-466`), so the literal argv CW
itself invokes is enforced — but `network`/`read` have no equivalent check anywhere in `runBackend`, `delegate()`,
or `executeLocal` (`shell/execution-backend/local.ts:84-165`), and once an external agent process is running,
nothing enforces what it reads or which hosts it talks to. *Real — documented host-delegation, but the record's
"enforce" language for command/network/read on the default path should read host-attested-not-CW-enforced.*

**P1-2 — Agent model provenance is still self-reported, unchanged in substance.** `parseAgentReport`
(`shell/execution-backend/agent.ts:203-254`) does a best-effort JSON parse of the agent child's own stdout — its
own doc comment: "SOLELY the agent's own report." Both the CLI-binary and HTTP-endpoint delegation paths
(`shell/execution-backend/agent.ts:616-618`, `:673-674`) thread the parsed `reportedModel` into `recordedAgentHandle`
(`shell/execution-backend/agent.ts:277-303`), and `shell/worker-isolation.ts:924,933-941` writes it into the durable usage record with
`source: "host-attested"` — a value whose only origin is the child process choosing to print a JSON field, now
labeled as attested in durable state. CW never fabricates or substitutes a fallback model id (disclaimed
explicitly at `shell/execution-backend/agent.ts:12-17`, `shell/worker-isolation.ts:925-927`), which bounds the blast radius, but does not
close the finding. *Real; bounded by the delegation model. Label the field as agent-self-reported, not
CW-verified.*

**P1 — `cw gc run` persists `state.json` through a write path with no lock, racing every other writer of that
file.** `saveCheckpoint` and `withRunStateLock` (`shell/run-store.ts:343-348`, `:199-201`) — the paths every
`cw worker output`/`fail` call goes through — wrap their `state.json` write in `withFileLock(run.paths.state,
...)`. `runReclamation`'s own lock (`shell/reclamation-io.ts:936-942`) guards only `reclaimedLogPath` (a
*different* file, `reclaimed.json`) and is released before `prepareFree` runs. `prepareFree`
(`shell/reclamation-io.ts:774-816`) mutates the in-memory `run` object and calls `persistRunDurable(run)`
(`shell/reclamation-io.ts:793`) — a bare `writeJson(run.paths.state, run, {durable:true})` with **no lock at all**
(`persistRunDurable` at `shell/reclamation-io.ts:288-291`; `withRunLock` at `:293-295` confirms it locks only the
reclaim log) — before `freeBulk` (`:836-856`) deletes the freed files unconditionally. `gcRunCli`
(`shell/registry-cli.ts:260-269`, wired to `cw gc run` and the `gc.run` MCP tool) calls straight through with no
lock wrap of its own. Two overlapping writers of `state.json` — a `cw worker output` call and a `cw gc run`
pass, or two overlapping `gc run` invocations — can land in either order with no error; last writer wins.
`prepareFree`'s own dangling-reference proof (`shell/reclamation-io.ts:795-816`) checks only the in-memory object it
just mutated, not what actually reached disk, so a lost write is undetected and `freeBulk` still deletes the
freed paths regardless — `state.json` can end up pointing at now-deleted files with no signal. This fires on
essentially every ordinary `cw gc run` against a run with worker scratch dirs (the default, first-freed
category — `shell/reclamation-io.ts:537-552`; opted out only by `--keep-scratch`), not a rare corner case. *Real,
current, directly contradicts "state is durable and deterministically replayable."*

**P1 — Eval-replay's staleness check is a path-equality comparison that is vacuously true on every rerun, so a
real regression can be reported as a stale pass.** `loadOrCompareForTarget`'s freshness check
(`shell/eval-io.ts:374-383`) is `comparison.paths.replayPath === replayPath` (line 380) — but `replayPath` is
always the same deterministic `path.join(suiteDir, "replay-run.json")` for a given suite
(`shell/eval-io.ts:53-58`), and `replayMultiAgentSnapshot` always overwrites that same path in place on every rerun
(`shell/eval-io.ts:309-337`). The identical pattern recurs in `loadScoreForTarget` (`shell/eval-io.ts:396-406`), and
`gateMultiAgentEval`'s own staleness guard (`core/multi-agent/eval-replay.ts:380-386`) checks the same static
paths/replay-id, not content. `MultiAgentEvalComparison`'s `paths` object (`core/multi-agent/eval-replay.ts:186-195`) carries
plain path strings — no hash or fingerprint of `replay-run.json`'s actual content anywhere. Concretely: run
`cw eval snapshot` → `replay` → `score` (passing). Later, rerun `cw eval replay` on the same suite after the
underlying baseline changed (a worker now fails — exactly the drift scenario
`eval-replay-detects-drift.case.js` exercises); `replay-run.json` is overwritten with new content at the same
path. `cw eval score`/`report` — normal, unprivileged commands that don't require an explicit prior
`eval compare` (`shell/multi-agent-cli.ts:993-995,1003-1005`) — hits the cache branch and silently returns the
OLD score/comparison, never re-diffing the new content. Neither conformance case
(`eval-replay-happy-path.case.js`, `eval-replay-detects-drift.case.js`) exercises this cache-hit branch — both
call `eval compare` explicitly right before `score`, so the bug is untested. The codebase does content-based
freshness correctly elsewhere (`node-snapshot.ts`'s `sourceFingerprint`-keyed ids; `state-explosion-cli.ts`'s
fingerprint-vs-persisted check), underscoring this is an omission, not a design choice. *Real, directly
undermines "no silent pass" for the harness meant to prove replay determinism — narrower blast radius than
P1-1/P1-2 (scoped to `cw eval`, not the live worker-dispatch/commit path), but a P1 against its own stated job.*

**P1-advisory — Review/commit separation-of-duties is still caller-asserted, and the self-declaration surface
is now wider.** `normalizeActor` (`core/multi-agent/collaboration.ts:177`) still derives attestation straight
from caller input, but the type grew a second, more direct route: `ActorAttestation` now accepts a
caller-settable `attestation` string (`"host-attested" | "operator-recorded" | "unattributed" |
"runtime-derived" | "cw-validated"`) taken verbatim, with no runtime membership check. `shell/multi-agent-cli.ts`
passes it straight through at the CLI/MCP boundary (`optionalString(args.attestation) as never` at lines
`:911`, `:919`) — the `as never` cast discards TypeScript's own enum check at the one place it could have
caught a bad value. `disqualify` (`core/multi-agent/collaboration.ts:381-386`) still trusts `actor.kind`/`attested`/`roleId`/`id`
verbatim, no independent verifier. Net: a caller — including, per CW's own delegation model, an external agent
driving `cw approve --attestation host-attested` — can self-declare a host attestation with one flag, and the
kernel accepts it as-is; that was true at v0.1.42 too, but the flag is now a direct string instead of a boolean.
*Bounded by the stated OS-user trust boundary, so still advisory by design — but the self-declaration path
got more direct, not less, and deserves the same "advisory, not authenticated" labeling as before.*

## P2 / P3

**P2 — Corrupted `reclaimed.json` fail-opens through both the GC eligibility gate and the tombstone-chain
write, silently destroying reclamation history.** `loadReclamationLog` (`shell/reclamation-io.ts:303-315`)
catches any parse/shape failure and returns `tombstones: []` — a documented fail-open choice for *reads*. But
the same function backs the *write* path: `buildTombstone` (`:705-706,717`) treats a corrupted file as "no
prior tombstones" and mints a fresh genesis id, and `commitTombstone` (`:734-737`) durably overwrites the file
with only the new tombstone. `run-registry-io.ts`'s `loadReclaimedFromDir` (`:439-451`) has the identical
fail-open catch and feeds `RunRecord.tier` (`:760-763`), so a corrupted-but-present `reclaimed.json` makes an
already-reclaimed run report `tier: "live"` — bypassing `reclaimEligibility`'s first, doc-claimed fail-closed
gate (`:1051-1052`). `RunRegistry.buildIndex` always derives fresh from source on every `cw gc` invocation
(doesn't consult the cache), so this is live on every real call, not hypothetical. Neither existing safeguard
catches the result: `verifyReclamation`'s chain check treats index 0 as self-anchoring (`:986-992`), so the
lone post-overwrite tombstone verifies as internally consistent, and `gcVerify`'s witness check
(`:1234-1241`) only fires when `!result.reclaimed` — which is false again right after the overwrite. *Real; the
v0.1.80 FreeBSD-philosophy audit cited `verifyReclamation` as the *good* counter-example to this exact bug class
in `telemetry-ledger.ts` — this finding shows that comparison was incomplete: `reclamation.ts`'s own append
path uses the identical fail-open reader, one hop further away (through `gc`'s eligibility check) but reachable.*

**P2 — `shell` backend still runs joined argv via `shell:true`; a metacharacter denylist now guards it, but the
pattern is unchanged.** `spawnSync([command, ...args].join(" "), {...options, shell:true})` for the `shell`
driver, vs. argv-style `shell:false` for `node`/`bun` — unchanged, same shape, now at
`shell/execution-backend/local.ts:127-130`, wired by `shell/execution-backend/registry.ts:253-255`. New since v0.1.42:
`checkShellGuard` (`shell/execution-backend/local.ts:63-71`, called at `:119-121`) rejects the joined string if it matches
`/[;&|`$(){}<>!\n\r#*?~]/` before the `shell:true` spawn runs. A denylist narrows exploitability but is
inherently more brittle than argv-style spawning would be — still a P2, with materially less urgency than the
v0.1.42 finding since the guard didn't exist then.

**P2 — Onramp's surface-change detector (`isSurfaceFile`) is still keyed to three pre-rebuild file names, two
of which no longer exist anywhere in the tree.** `isSurfaceFile` (`shell/onramp.ts:555-566`) gates both the
"surface-docs-required" contract issue (`shell/onramp.ts:390-397`) and the `parity:check`/`gen:manifests` hint
(`:443-444`). Its exact-name literals are `src/capability-registry.ts`, `src/mcp-server.ts`, and
`src/mcp-surface.ts` (`shell/onramp.ts:561`). `mcp-server.ts` is still real and current; the other two are not —
`capability-registry.ts` was split into `core/capability-data.ts` plus `wiring/capability-table/*.ts` (PR
#368), and `mcp-surface.ts` was replaced by `mcp/server.ts`, `mcp/dispatch.ts`, `mcp/tool-process.ts` at the v2
cutover. `src/orchestrator.ts` (also checked by `isSurfaceFile`) is likewise stale — the real file is
`shell/orchestrator.ts`. None of `wiring/capability-table/*`, `core/capability-table.ts`,
`core/capability-data.ts`, or `mcp/*` are matched. Confirmed by running the built code directly: a change to
only real, current capability/MCP files plus one smoke test (no doc file) gives `evaluateOnrampContract(...).ok
=== true` — no warning, no recommendation. The only test coverage, `plugins/cool-workflow/test/onramp-check-smoke.js:90,117,122`,
still checks the dead `"src/capability-registry.ts"` literal, so nothing catches the drift. *Contradicts the
module's own header claim ("the old flat paths... still classify correctly even though the real files
moved") for exactly the cases that matter today. (Same pattern this audit's authoring session already found and
fixed once in this same file's `isDocFile` — see the 2026-08-04 root-consolidation PRs; `isSurfaceFile` is a
second, separate instance of the same drift class in the same module.)*

## Resolved since the v0.1.42 audit (do NOT cite these as live risks)

- **Scheduler store read-modify-write** → now fully lock-guarded. `Scheduler`'s `locked()` helper
  (`shell/scheduler-io.ts:93-95`) wraps `withFileLock` (`shell/fs-atomic.ts:398-516`) around every mutating
  method's full load→mutate→save sequence, including `setStatus` (`shell/scheduler-io.ts:241-250`), the exact method
  the prior finding named.
- **Trust-audit log read bricked by one bad line** → `readEventsRawCounted` (`shell/trust-audit.ts:243-257`)
  now per-line try/catches `JSON.parse`, counting corrupt lines instead of throwing; the doc comment
  (`:239-242`) states the intent explicitly.
- **Delegated agent env leak on `env.inherit`** → closed for the CLI-binary vendor-binary spawn.
  `buildAgentChildEnv` (`shell/execution-backend/agent.ts:93-125`) now scopes the child env to
  PATH/HOME/expose plus an explicit provider-key-prefix allowlist, applied at the real spawn site
  (`shell/execution-backend/agent.ts:547,556-560`) and the concurrent batch path (`shell/drive.ts:834-839`) alike — no more raw
  `{...process.env}` for this path. *(Residual, different-scope note: the HTTP-endpoint delegation path's
  internal Node forwarder script still gets a policy-independent env — `shell/execution-backend/agent.ts:735-741` and its concurrent
  sibling — but that script only reads `CW_DELEGATE_ENDPOINT` and forwards the job JSON; it is not the external
  vendor CLI process this finding was about, and matches the documented `execution-backend.md` spec for
  endpoint mode.)*
- **Smoke-only test suite** → `test/run-unit.js` now discovers and fails closed on `test/*.test.js`
  (`plugins/cool-workflow/test/run-unit.js:25,29`), wired as its own `npm run test:unit` (`plugins/cool-workflow/package.json:75`), 171 files strong alongside
  the 255-file smoke suite.

## Non-issues (correctly classed within the local-first, OS-user model)

- **Unauthenticated MCP/CLI** — by design; the trust boundary is the OS user (AGENTS.md's
  [Product Direction & Moat](../../../../../AGENTS.md#product-direction--moat)). CW is not an auth server.
- **No model SDK / no API key in the control plane** — the red line, unchanged. The `agent` backend spawns an
  external child argv-style and imports no model SDK.
- **Symlink escape past the lexical write boundary** — the v0.1.42 fix (realpath resolution) was not touched by
  any of this audit's findings; still mitigated.

## What CW enforces vs. what CW attests (the enforcement boundary)

| Dimension | Default `node`/`bun`/`shell`/`agent` path | Where enforced |
| --- | --- | --- |
| Write (result-output acceptance) | **CW-enforced** (`validateSandboxWrite`, `shell/worker-isolation.ts:671`) | CW kernel |
| Command (CW's own spawned argv) | **CW-enforced** — `commandDenied` allowlist (`shell/execution-backend/registry.ts:397-407`) *(new since v0.1.42)* | CW kernel |
| Command/network past that (what a delegated process itself does) | **Attested only** — `validateSandboxCommand`/`validateSandboxNetwork` exist (`shell/sandbox-profile.ts:301-323,325-347`) but are reachable only via manual `cw audit decision` | Host / container backend |
| Env exposure | Scoped by `buildAgentChildEnv`/`buildChildEnv` unless `env.inherit` (`shell/execution-backend/agent.ts:93-125`, `shell/execution-backend/local.ts:34-55`) | CW filters / host |
| Model provenance | **Agent self-reported** (`shell/execution-backend/agent.ts:203-254`) | Agent host |
| Review SoD | **Caller-asserted**, now via a direct `attestation` string (`core/multi-agent/collaboration.ts:177`) | OS user |
| GC/reclamation record integrity | **Fail-open on corruption** — treats a corrupted `reclaimed.json` as empty on both read and write (`shell/reclamation-io.ts:303-315`) | Not enforced |
| Eval/replay pass verdict | **Path/id-equality cached**, not content-verified (`shell/eval-io.ts:374-383`) | Not enforced |

> For command/network/read to be enforced past CW's own spawn, run the worker under the `container` backend or
> an OS-level sandbox. Read the per-backend support matrix and sandbox attestation in CW's own record — don't
> assume a profile's declared restriction was actually applied by CW.

## Recommended changes (in priority order)

1. **Surface the enforcement boundary in the record**, same recommendation as v0.1.42: label command/network/read
   as host-attested-not-CW-enforced on the default dispatch path, and model provenance as agent-self-reported.
2. **Lock `state.json` around `prepareFree`'s write**, the same way `saveCheckpoint`/`withRunStateLock` do
   (`shell/run-store.ts:343-348`) — ideally hold the lock across the whole `runReclamation` transaction so two
   racing `gc run` passes can't step on each other either.
3. **Make eval-replay's freshness check content-based**, not path/id-equality — fingerprint `replay-run.json`
   the same way `node-snapshot.ts` and `state-explosion-cli.ts` already fingerprint their own inputs.
4. **Validate the `attestation` string at the CLI/MCP boundary** (`shell/multi-agent-cli.ts:911,919`) against
   the real `ActorAttestation` enum instead of casting through `as never`.
5. **Distinguish "absent" from "corrupted"** in `loadReclamationLog` and `loadReclaimedFromDir`; fail closed on
   a corrupted (not missing) `reclaimed.json` on both the read and the write/eligibility path.
6. **Extend `isSurfaceFile()`** to match the real current MCP (`mcp/*`) and capability
   (`core/capability-table.ts`, `core/capability-data.ts`, `wiring/capability-table/*`) paths, and update
   `test/onramp-check-smoke.js` to exercise a real file instead of the dead `capability-registry.ts` literal.
7. **Keep tightening the `shell` backend** — the new denylist guard helps, but argv-style spawning
   (`shell:false`) would be structurally safer than any denylist.
8. **Confirm the new unit-test suite (`test/*.test.js`) covers the enforcement-boundary paths** in
   `worker-isolation.ts`/`execution-backend/*.ts` specifically, not just the modules it happened to land on
   first.

## Verification log

| Risk | Classification | Evidence | Notes |
| --- | --- | --- | --- |
| Command/network/read attested-only on dispatch path | real (P1) | `shell/worker-isolation.ts:622,671,498-504`, `shell/dispatch.ts:88`, `shell/sandbox-profile.ts:293-295,301-323,325-347`, `shell/audit-cli.ts:19,288-313`, `shell/execution-backend/registry.ts:75,87,99,123,135,147,321-364,397-407,461-466`, `shell/execution-backend/local.ts:84-165` | Still open; command-argv enforcement is new since v0.1.42 |
| Model provenance self-reported | real (P1) | `shell/execution-backend/agent.ts:203-254,277-303,616-618,673-674`, `shell/worker-isolation.ts:924,933-941` | Unchanged in substance |
| `state.json` written outside its lock during GC | real (P1) | `shell/reclamation-io.ts:288-291,293-295,734-737,774,793,795-816,924-949,1140-1174,1412-1448`, `shell/registry-cli.ts:260-269`, `shell/run-store.ts:343-348` | Fires on nearly every ordinary `cw gc run` |
| Eval-replay staleness check is path/id-equality, not content | real (P1) | `shell/eval-io.ts:374-383,385-394,396-406`, `core/multi-agent/eval-replay.ts:380-386` | Untested by existing conformance cases |
| Review/commit SoD caller-asserted | real (P1-advisory) | `core/multi-agent/collaboration.ts:177,381-386`, `shell/multi-agent-cli.ts:911,919` | Bounded by OS-user trust boundary; surface widened |
| Corrupted `reclaimed.json` fail-opens on read AND write | real (P2) | `shell/reclamation-io.ts:303-315,705-706,717,734-737,986-992,1051-1052,1234-1241`, `shell/run-registry-io.ts:439-451,760-763` | Corrects an incomplete comparison in the v0.1.80 audit |
| `shell:true` joined argv | conditional (P2) | `shell/execution-backend/local.ts:63-71,119-121,127-130`, `shell/execution-backend/registry.ts:253-255` | New metacharacter denylist guard narrows this since v0.1.42 |
| `isSurfaceFile()` keyed to 2 dead + 1 stale pre-rebuild path | real (P2) | `shell/onramp.ts:1-11,390-397,443-444,555-566,563`, `plugins/cool-workflow/test/onramp-check-smoke.js:90,117,122` | Confirmed by running `evaluateOnrampContract()` directly |
| Scheduler store RMW | fixed | `shell/scheduler-io.ts:93-95,130-135,143-151,153-155,182-201,203-220,222-234,241-250,252-265`, `shell/fs-atomic.ts:398-516` | — |
| Trust-audit log read all-or-nothing | fixed | `shell/trust-audit.ts:239-242,243-257,266-268` | — |
| Delegated agent full-host-env leak | fixed (CLI-binary path) | `shell/execution-backend/agent.ts:93-125,547,556-560`, `shell/execution-backend/local.ts:34-55`, `shell/drive.ts:834-839` | HTTP-endpoint forwarder script residual noted, out of scope |
| Smoke-only test suite | fixed | `plugins/cool-workflow/test/run-unit.js:25,29`, `plugins/cool-workflow/package.json:75` | 171 `*.test.js` alongside 255 smoke scripts |

## Reproduce

```bash
# 1. Pin to the audited commit.
git -C /path/to/cool-workflow checkout 4121cb01

# 2. Re-verify every cite resolves, from the repo root. Default search root is plugins/cool-workflow/src.
node plugins/cool-workflow/project/docs/scripts/verify-audit-cites.js \
  plugins/cool-workflow/project/examples/audits/self-audit-cool-workflow-v0.2.6.md

# 3. Run the suite that regression-tests the resolved findings.
cd plugins/cool-workflow && npm test && npm run test:unit
```
