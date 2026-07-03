# Cool Workflow v2 — rebuild plan

## Why this rebuild

The old build at `plugins/cool-workflow` (166 `src/` files, ~46,620 lines) is the SPEC, not
code to edit. It says, in full, what CW must keep doing. v2 must do the same outer job —
same CLI, same MCP tools, same `.cw/` file shapes, same exit codes — in far less code, with
a clear kernel/shell split and a much faster inner test loop. The `v2/conformance/` suite
(black-box, drives the built CLI, "green on old first") is the only judge of "same job." No
claim of success counts unless that suite says so.

## Revision note

This plan's first pass compared three independent proposals; one (the "minimal kernel +
generated surfaces" lens) failed a schema-validated tool call 5 times in a row and was silently
dropped by the judge panel, so only two proposals were actually compared and synthesized. It was
re-run standalone (writing straight to a file instead of a large JSON field, which fixed the
failure) and is kept in full at `v2/DESIGN_MINIMAL_KERNEL.md`. Its central idea — most of which
the surviving "kernel-first-thin-shells" proposal already converged on independently — is folded
in below. Its one genuinely new, concrete improvement over the first synthesis: **build the
capability registry and its two generic CLI/MCP dispatchers in milestone 2, immediately after
CLI parsing, instead of as a late milestone.** The first pass deferred this to a late "milestone
7," which meant hand-writing CLI/MCP glue through several milestones only to delete it later —
re-opening exactly the hand-sync window this design exists to close. The build order and targets
below reflect that correction; see `v2/BUILD_ORDER.json` for the machine-readable form.

## Non-negotiables

- **POLA.** Never change the byte content of an existing output, file format, exit code, or flag.
- **Mechanism, not policy.** The kernel gives mechanisms; vendor-specific logic stays in shells/wrappers.
- **Rule of Silence.** stdout is data, stderr is diagnostics, silent on success when piped.
- **Fail closed.** Unconfigured or unverifiable input is a visible refusal, never a fabricated success.
- **Zero runtime dependencies.** No package.json dependency, no model SDK, ever.
- **Tools not frameworks.** Composition through files under `.cw/`, not hidden in-process coupling.
- **Deterministic, replayable.** Every step is plain JSON; replay must stay byte-stable.
- **Delegate, not execute — permanently.** CW never calls a model API and never runs the work itself.

## Target shape

Two top-level trees under `v2/src/`: `core/` (pure — no `fs`, `child_process`, `crypto.sign`,
`net`, `process.env`, `Date.now()`, `Math.random()` — every such input is a function
parameter) and `shell/` (impure — the only place those calls are allowed). This split is
enforced by a lint rule, not just a convention. Two front doors, `cli/` and `mcp/`, both
generated readers over one data table.

```text
v2/src/
  core/
    hash.ts                 # THE one hash/stringify module: sha256 (prefixed, 64 hex),
                             # fingerprintStrings (prefixed, SORTED, 32 hex), stableHash
                             # (prefixed, 64 hex, key-sorted), sha256Bytes (bare hex, archives
                             # only), stableStringify. Named export per spelling — mixing them
                             # is a review red flag. See "Hash dedup" in Byte-compat below —
                             # this file must model THREE divergent shapes, not one.
    state/
      run-paths.ts           # createRunPaths, ensureRunDirs (16-key RunPaths, pure path math)
      migrations.ts          # RUN_STATE_MIGRATIONS, findMigrationPath (BFS), migrateRunState,
                              # reverseRunState, normalizeRunState defaults
      schema.ts               # REQUIRED_TOP_LEVEL_KEYS / arrays / records — the field-list source
      state-node.ts           # createStateNode, transitionStateNode (matrix + commit gate),
                              # validatePipelineContract, assertNodeSatisfiesContract,
                              # recordNodeError, linkStateNodes, deterministic node-id fallback
      node-projection.ts      # rawNodeProjection (13-field list), projectNodeBody, digest input
      node-snapshot.ts        # snapshotNode/diffNodeSnapshots/replayNodeSnapshot/verifyNodeReplay
                               # (pure given a run + a clock value)
      state-explosion/        # computeStateSize, buildCompactGraph, summarizeBlackboardDigest,
                               # collapse rules, thresholds, helpers (parentMap/unique/truncate/slug)
      contract-migration.ts   # listMigrationContracts, resolveChain, checkMigration, proveMigration
      schema-validate.ts      # dependency-free JSON-schema subset
      validation.ts           # RecordValidationError + per-record shape guards
    pipeline/
      contract.ts             # DEFAULT_PIPELINE_CONTRACT_ID, createDefaultPipelineContract
      runner.ts                # findRunnablePipelineStages, runPipelineStage (pure transform of
                                # run+contract+clock in, {run, result} out — actual disk writes
                                # happen in shell/run-store.ts), advancePipeline, failPipelineStage
      dispatch.ts               # nextDispatchTasks, firstRunnablePhase, updatePhaseStatuses,
                                 # formatDispatchTask, dispatch-id formatting (pure given a clock)
      commit-gate.ts             # commitState's gate resolution + all ~25 error codes (pure
                                  # decision function; the actual snapshot/audit writes are shell)
      result-normalize.ts        # normalizeResultEnvelope, isEmptyCapture (already pure upstream)
      error-feedback.ts          # classifyFeedback, recordFeedback (decision half), dedup key
      loop-expansion.ts          # registerLoopPredicate/getLoopPredicate, maxLoopExpansion,
                                  # maybeExpandLoop's decision half (round clone, stop reasons)
      drive-decide.ts            # driveStep/driveConcurrentRound's PURE decision core: task
                                  # selection, terminal/gate logic, token-budget check, retry/park
                                  # math, cache-key formulas — every branch that does not itself
                                  # spawn a process or touch disk
    trust/
      ledger.ts                 # computeLedgerDigest, buildLedgerProposal/Review,
                                 # verifyLedgerEntry, applyLedgerProposal (pure; dir reads live
                                 # in shell/ledger-io.ts)
      telemetry-ledger.ts        # genesisPrevHash, computeRecordHash, reportedUsageDigest,
                                  # verifyTelemetryLedger (pure verify; append is shell)
      telemetry-attestation.ts    # canonicalTelemetryPayload, normalizeReportedUsage,
                                   # verifyTelemetryAttestation, verifyTelemetrySignatures
                                   # (crypto.verify is allowed in core per the lint carve-out
                                   # below — see Byte-compat note 2)
      trust-audit.ts               # eventHash, verifyTrustAudit, evidence/metadata scrub,
                                    # id formatting (append itself is shell)
      evidence-grounding.ts         # isGroundedEvidence, confidence tiers, extractEvidenceContent
      evidence-reasoning.ts         # buildEvidenceReasoningReport, fail-closed "unexplained" roll-up
      verifier.ts / gates.ts        # assertTaskCanComplete, validateResultEnvelope, validateRunGates
    multi-agent/
      runtime.ts               # multi-agent record kernel: run/role/group/membership/fanout/fanin
                                # create+transition (persist calls delegate to shell/run-store)
      topology.ts               # OFFICIAL_TOPOLOGIES, applyTopology's decision half, role-width math
      coordinator.ts            # blackboard/topic/message/context/artifact/decision kernel
      trust-policy.ts           # policyForRole/Group/Membership, authorizeMultiAgentAction
      candidate-scoring.ts       # registerCandidate/scoreCandidate/rankCandidates/selectCandidate
      collaboration.ts           # approvals/comments/handoffs, deriveReviewState (pure projection)
      host-decide.ts              # hostStep/hostScore/hostSelect's decision core (classifyHostState)
      operator-ux.ts               # summarizeMultiAgentOperator, dependency/failure/evidence rows
      eval-replay.ts                # normalizeValue, replayStableStringify, the 31-metric compare
    workflow-apps/
      app-schema.ts             # WorkflowApp manifest validation (pure)
    capability-table.ts        # THE one data table: one row per capability. Replaces
                                # capability-registry.ts (940 lines) + the 40 CLI handler files +
                                # the 196-arm MCP switch + the 1000-line tool-definitions array.
                                # Row shape carries a SEPARATE cli.handler and mcp.handler entry
                                # point (not one shared "entry") — see Byte-compat note 5 on the
                                # 12 capabilities where CLI and MCP call different functions.
    format/
      help.ts                  # formatHelp, formatCommandHelp, formatSearchResults, formatInfo —
                                # byte-exact, pure functions of already-loaded data
      report.ts                 # report.md section writer + the ten byte-exact fallback lines
      state-explosion-text.ts    # formatStateExplosionReport, formatCompactGraph, digest text
      cli-text.ts                 # every other human-readable CLI text renderer
  shell/
    fs-atomic.ts              # writeJson (temp+fsync+rename), durableAppendFileSync, readJson,
                               # withFileLock (O_EXCL, 30s steal window, 240x25ms wait)
    run-store.ts               # loadRunFromCwd, saveCheckpoint, compactCheckpoint — the ONLY
                                # place state.json is read or written
    node-store.ts               # writeRunNode, snapshot/replay persistence (the disk half)
    ledger-io.ts                 # listLedgerEntries/unionLedgerEntries directory reads
    execution-backend/
      registry.ts               # DRIVER_SPECS, registerBackend, resolveBackendSelection
      local.ts                   # executeLocal, the shell-guard regex check
      container.ts, remote.ts, ci.ts   # delegating drivers (spawn a child, build a handle)
      agent.ts                   # resolveAgentInvocation, spawnSync + stdout capture,
                                  # parseAgentReport, stripSecretArgs (mechanism only — see
                                  # non-negotiable: vendor prompt/report shaping stays OUT of here)
      probes.ts                   # PATH/daemon/env liveness checks
    agent-config.ts            # env/file/flag resolution, CW_HOME resolution, builtin expansion
    sandbox-profile.ts          # profile file IO + the runtime read/write/command/network checks
    worker-isolation.ts          # worker scope files, accept-path IO
    scheduler.ts / daemon.ts      # cw schedule / cw loop — wall-clock, ticking
    triggers.ts                   # cw routine — file-backed trigger store
    run-registry/                 # index/queue/gc/orphans/clones — all disk-scanning IO
    remote-source.ts               # --link/URL checkout materialization
    run-export.ts                   # bundle archive write/read, verify-bundle restore-to-tmpdir
    workbench-host.ts                # localhost read-only server (spawns nothing, but is IO)
    reporter.ts / doctor.ts           # end-of-run TTY summary, cw doctor/fix host probes
    clock.ts                          # the ONE `new Date()` / `Date.now()` call site core
                                       # functions receive `now` through, so replay stays pinned
  cli/
    dispatch.ts               # ~150-line generic executor: parseArgv, read capability-table row,
                               # call cli.handler, printJson/format per row's jsonMode
    parseargv.ts                # parseArgv, KNOWN_COMMANDS, suggestCommand (byte-exact, kept as
                                 # its own file since it is heavily pinned by tests)
    entry.ts                     # ~40-line real entry point (`cw`/`cool-workflow` binaries)
  mcp/
    server.ts                  # stdio JSON-RPC loop: initialize / tools/list / tools/call
    dispatch.ts                 # generic tool-call reader over capability-table.ts
    tool-definitions.gen.ts      # GENERATED from capability-table.ts (see Generated, below)
  scripts/
    gen-manifests.js          # unchanged in spirit: vendor manifests from plugin.manifest.json
    gen-tool-definitions.js     # NEW, zero-dependency: capability-table.ts -> mcp tool-definitions
    gen-parity-doc.js            # unchanged in spirit: doc marker regions from capability-table.ts
    children/                     # http-delegate-child.js, batch-delegate-child.js — copied
                                   # forward byte-for-byte; these are an external process contract
    agents/                        # vendor agent wrapper scripts — copied forward unchanged
```

## What gets deleted, kept, and generated

**Deleted as hand-written source (behavior absorbed into `core/`+`shell/`, or made
structurally impossible):**

- `src/capability-registry.ts` (~940 lines, 209 hand-authored descriptors) — replaced by
  `core/capability-table.ts` as a data table.
- `src/cli/command-surface.ts` + all of `src/cli/handlers/*.ts` (17+ handler files, the
  hand-written dispatch switch) — replaced by `cli/dispatch.ts`'s generic executor over the
  capability table.
- `src/mcp/tool-call.ts`'s 196-arm switch and `src/mcp/tool-definitions.ts`'s 1000+ line
  hand-written array — both become generated output (`mcp/tool-definitions.gen.ts`,
  `mcp/dispatch.ts`'s generic reader) from `core/capability-table.ts`.
- `src/orchestrator.ts` (1000+ lines) and every `src/orchestrator/*-operations.ts` delegate
  file — the 141 capability METHODS are preserved as documented behaviors, each with a real
  `core/` or `shell/` entry point reachable from both front doors, but the class-and-forward
  boilerplate is replaced by the generic dispatcher plus the capability table. (This overrides
  the letter of the "don't shrink the facade" anti-goal but keeps its intent — every method
  stays reachable from both surfaces, so parity is structural, not merely gated. This is a
  judgment call; per the Revision note above, the dispatcher now lands at milestone 2, so flag
  it to a human reviewer THERE — early, against a near-empty registry — rather than at a late
  milestone after hand-written CLI/MCP glue has piled up on top of it.)
- `scripts/parity-check.js`'s cross-surface drift diff — shrinks to a structural
  self-consistency check on the one table (unique tool names, resolvable handler references),
  since there is only one surface to typo now. The LIVE payload-identical probe (running both
  `cw <cmd> --json` and the matching MCP call and diffing bytes) is KEPT — a data table proves
  shape parity, not runtime byte parity; both checks are needed.
- The 3 separate `stableStringify`/hash near-duplicates (`src/ledger.ts`, `src/telemetry-
  attestation.ts`, `src/contract-migration.ts`) — collapsed into `core/hash.ts`'s named
  exports (see Byte-compat, "Hash dedup" below for the full, corrected list of divergences).

**Kept byte-for-byte (POLA — no output, format, or code changes intended):**

- Every on-disk JSON/markdown shape: `state.json`, `report.md`, node files, snapshots,
  replays, dispatch manifests, ledger entries, telemetry records, trust-audit events, bundle
  archives, migration proofs, state-explosion summaries, ranking.json, evidence-reasoning
  records.
- Every exit code and its triggering condition (the ~25 fail-closed exit sites in
  `cli-surface.md` and the per-subsystem verify/check/prove/gate verbs).
- Every vendor backend driver's actual spawn/config logic (moved under `shell/execution-
  backend/`, logic unchanged) — mechanism/policy split unchanged.
- The wall-clock scheduler, daemon tick logic, routine trigger semantics — inherently
  imperative, ported as literal behavior into `shell/scheduler.ts` / `shell/daemon.ts` /
  `shell/triggers.ts`.
- All deterministic id formats and their exact string templates: run ids, node ids
  (`<runId>:task:<id>` etc.), dispatch ids, commit ids (`state-<seq>`), loop-round ids
  (`@r<n>`), snapshot/replay ids, telemetry `tel-<seq>` ids, trust-audit `audit-<kind>-<seq>`
  ids, candidate/score/selection ids.
- `test/*-smoke.js` equivalents are NOT rewritten as v2 source; the black-box conformance
  suite (`v2/conformance/`) is the judge and stays untouched by this build.
- Known, intentionally-preserved warts — do NOT "clean these up," carry a one-line preserving
  comment at each: `KNOWN_COMMANDS` excludes `"ledger"` even though the dispatcher handles it;
  `coordinatorSummary` is a pure alias of `blackboardSummary` (two names, one body);
  `applyTopology` accepts `debateRounds` but never reads it; `formatHelp`'s "More commands"
  note line uses a 4-space indent specifically so the 2-space parity-token parser skips it.

**Generated (new, zero-dependency, small — same spirit as today's `gen-manifests.js`):**

- `mcp/tool-definitions.gen.ts` and the tool-name/schema half of `mcp/dispatch.ts`, from
  `core/capability-table.ts`.
- The CLI's "More commands" help-token list and `formatCommandHelp`'s per-verb subcommand
  rows, from `core/capability-table.ts` (continuity — v1 already derives these from a
  registry; this is one fewer registry to keep in sync, not a new idea).
- Vendor plugin manifests (`scripts/gen-manifests.js`, reading `manifest/plugin.manifest.json`)
  — unchanged input and unchanged output.
- `docs/cli-mcp-parity.7.md`'s four marker regions (`scripts/gen-parity-doc.js`), now sourced
  from `core/capability-table.ts` instead of `capability-registry.ts`.

## Byte-compat strategy

Every byte-exact invariant the SPEC's "Rebuild risks" sections flag is covered here, by name,
with the mechanism that keeps it exact. A builder should not need to re-derive any of this.

1. **Write bytes.** Every JSON file on disk is `JSON.stringify(value, null, 2) + "\n"` —
   2-space indent, one trailing newline, no exceptions. This is ONE function,
   `shell/fs-atomic.ts`'s `writeJson`, and every writer in `core/`+`shell/` goes through it.
   A golden-fixture unit test locks the exact bytes for at least one file of each shape
   (`state.json`, a node file, a snapshot, a ledger entry, a telemetry record, a trust-audit
   line, a ranking.json) sourced from the SPEC's own "Exact outputs" JSON blocks.

2. **Hash dedup — three shapes, not one edge case.** `core/hash.ts` must model THREE
   divergent implementations exactly, with loud, separately-named exports:
   - `sha256(value)` — prefixed `sha256:` + all 64 hex chars. Used by both hash chains,
     `promptDigest`, `resultDigest`, `reportedUsageDigest`, the ledger digest.
   - `fingerprintStrings(values)` — prefixed `sha256:` + only the FIRST 32 hex chars, over
     **sorted** JSON-array input. Used by snapshot ids, state-explosion fingerprints,
     evidence-reasoning fingerprints.
   - `stableHash(value)` — prefixed `sha256:` + all 64 hex chars, **key-sorted** JSON. Used by
     the contract-migration prover.
   - `sha256Bytes` — BARE hex, no prefix. Archive file digests only (`run-export.ts`). Never
     mix with the other three.
   - The stringify-before-hash step has THREE real divergent behaviors, not the one
     top-level-`undefined` edge case a naive reading suggests. Model each as its own named,
     unit-tested function, not one shared helper with a flag:
     - `ledger.ts`'s `stableStringify` — sorts keys recursively, NO special-casing of
       `undefined` (a top-level `undefined` input is not a real call site here in practice,
       but do not assume it behaves like the other two).
     - `telemetry-attestation.ts`'s `stableStringify` — sorts keys recursively, AND maps a
       top-level `undefined` input to the literal string `"null"`.
     - `trust-audit.ts`'s `eventHash` — hashes `stableStringify(JSON.parse(JSON.stringify(event
       sans eventHash)))`: the JSON round-trip DROPS every key (nested or top-level) whose
       value is `undefined`, before the sort-and-stringify step runs. This is not the same
       operation as the other two — it is a pre-pass that changes the shape being hashed, not
       just a formatting rule on the same shape.
     - Also distinct: which keys are OMITTED vs. serialized as `null` when absent. In
       `telemetry-ledger.ts`'s `recordHash` input, `reportedUsage` and `resultDigest` are
       OMITTED when absent (not `null`), while `usageSignature`/`attestationReason` become
       `null`. Getting the omit-vs-null choice wrong for either key changes every record hash
       and breaks back-compat with old ledgers.
   - `core/hash.ts` therefore exports the one canonical sort-and-stringify primitive
     PLUS three named, independently unit-tested wrapper behaviors (`ledgerStableStringify`,
     `telemetryStableStringify`, `eventHashInput`) rather than pretending they collapse to one
     function with a single flag. Golden-fixture tests for each, sourced from the SPEC's own
     hash-input field lists (`ledger-trust.md` sections "Handoff ledger entry", "Telemetry
     ledger record", "Trust-audit chain"), are the proof.
   - This directly answers the judge panel's strongest finding against the winning proposal:
     do not under-deliver on this dedup by modeling only one edge case.

3. **The `unique()` dedup counter-case — do NOT collapse.** `multi-agent.md`'s own rebuild
   risk #1 (not restated in full spec text pulled here, but load-bearing) is that two
   near-identical `unique()`-style helpers — one that sorts its output, one that does not —
   must stay SEPARATE, because collapsing them changes persisted record ordering and eval
   parity (`replay_completed`/`graph_parity`/etc. in the 31-metric eval harness compare
   byte-for-byte via `replayStableStringify`). The general rule this plan follows: a helper is
   safe to dedup into `core/hash.ts` ONLY when the SPEC evidence shows its output is a
   hash/digest string consumed as an opaque value; a helper is NOT safe to dedup when its
   output is a data VALUE that gets persisted, sorted, or compared structurally elsewhere
   (list ordering, id sequencing, graph node/edge order). `core/state-explosion/helpers.ts`'s
   `unique` (drops falsy, sorts) and any sibling ordering helper in `multi-agent/` or
   `eval-replay.ts` are ported as literal, separately-named functions — never merged on the
   assumption that "it's just dedup."

4. **Normalization defaults.** `normalizeRunState`'s exact defaults are pinned by fixture:
   epoch-0 ISO `1970-01-01T00:00:00.000Z` for `createdAt`/`updatedAt` (each copies the other
   first), `cwd` = three directories above the run dir else `process.cwd()`, `workflow.limits`
   = `{ maxAgents: 8, maxConcurrentAgents: 4 }`, `loopStage` = `"interpret"` (any unknown value
   is overwritten to this), derived `phases` grouped by `task.phase` (else `"Workflow"`) with
   slugified ids. `core/state/migrations.ts` ports these as literal constants, tested against
   `test/fixtures/runs/`-equivalent golden fixtures captured from the old build.

5. **Projected/dual-handler capabilities — do not collapse to one entry point.** 12 of the 209
   capabilities have CLI and MCP calling genuinely DIFFERENT functions with DIFFERENT payload
   shapes (example: `cw_app_run` calls `appRun`, not `validateApp`; `cw_commit` calls
   `commitEnvelope`, not `commit`). `core/capability-table.ts`'s row schema carries **two**
   handler fields, `cli.handler` and `mcp.handler` (both optional; default to one shared
   `entry` when identical), never a single shared `handler` field. This directly closes the
   gap the runner-up proposal's judges flagged as its one real hole. A capability marked
   `payloadIdentical: false` in the table is exempt from the live payload-probe diff by
   construction; the payload-probe plan (`payloadProbePlan()`, 73 targets: 7 global + 23 run +
   43 scenario) is ported as literal data.

6. **Lock protocol.** `shell/fs-atomic.ts`'s `withFileLock`: O_EXCL lockfile body
   `"<pid>@<ISO>\n"`, up to 240 tries at 25ms `Atomics.wait` sleeps, a lock older than
   `FILE_LOCK_STALE_MS = 30_000` is stolen (deleted, retried at once), refresh-before (best
   effort `utimesSync`), verify-after (if the lock body no longer starts with `"<pid>@"` after
   `fn()` returns, throw the "stolen" error and do NOT delete the thief's lock). A rebuild that
   releases unconditionally corrupts the thief's critical section — this is tested directly by
   a two-process race fixture.

7. **StateNode transition matrix + double commit gate.** The matrix (`pending -> running |
   blocked | failed | completed | verified | rejected`, etc., `committed` terminal) plus the
   SECOND gate — `committed` is refused unless status is exactly `verified`
   (`commit-without-verifier`), checked AFTER the matrix — are ported as one literal table in
   `core/state/state-node.ts`, unit-tested against every legal and illegal edge named in
   `state-core.md`.

8. **Raw vs. normalized fingerprints.** `NodeSnapshot.sourceFingerprint` is RAW (includes
   `updatedAt`, real paths) so any transition invalidates it; the snapshot `body` and
   `outputFingerprint` are NORMALIZED (no timestamps, scrubbed paths) so replay output is byte-
   stable. These two code paths must stay visibly distinct functions in `core/state/node-
   snapshot.ts`, never merged into one "fingerprint" call.

9. **Collapse protections in state-explosion.** Never-collapse set: failed/blocked/rejected/
   conflicting status, critical-path nodes, reasoning-critical nodes, failure-linked nodes.
   Collapsible KINDS only: `blackboard-message`, `blackboard-context`, `agent-membership`,
   `worker`, `score`, `blackboard-snapshot`, `agent-role`. A bucket under 6 (`collapseBucket`)
   stays expanded except in the `critical-path` view. Ported as literal predicate functions
   with a unit test per protected category.

10. **Migration status ladder + write gate.** `unsupported` beats `migrated` beats
    `normalized` beats `current`; a write happens ONLY on `--write` AND `writeRequired` AND
    NOT `unsupported`; dry-run is the default everywhere. One decision function in
    `core/state/migrations.ts`, tested against all four ladder outcomes.

11. **Two-arm telemetry signature verify.** `verifyTelemetryAttestation` tries the 5-field
    payload (with `resultDigest`) first, retries the 4-field payload on a miss, and sets
    `coversResult` ONLY on a first-arm match. `resultBound` must exclude any 4-field match even
    when a `resultDigest` sits on the record — else an injected digest gets falsely trusted.
    Ported as one literal two-branch function with both branches unit-tested.

12. **Absent vs. corrupt telemetry ledger.** An absent `telemetry.json` is an empty, clean-
    verifying chain (`present:false`). A PRESENT but unparseable one is corrupt: reads report
    `telemetry-ledger-corrupt`, and an append THROWS `TelemetryLedgerCorruptError` — it must
    never re-genesis over a poisoned file. This exact split was a real historical bug; it gets
    its own fixture (a hand-corrupted `telemetry.json`) in the golden set.

13. **Exit-code map.** Every fail-closed exit-1 condition (`state check`, `migration check`/
    `prove`, `node verify`, `ledger verify`/`apply`/`list`, `telemetry verify`, `audit verify`,
    `demo tamper`/`bundle`, `report verify-bundle`/`bundle`, `gc verify`, `eval gate`, `sandbox
    validate`, `topology validate`, `run verify-import` with `--strict`, `run inspect-archive`,
    `run restore`) and every "absent chain / nothing to prove is a clean exit 0" exception is
    carried as one literal table in `cli/dispatch.ts`, cross-checked against `cli-surface.md`'s
    exit-code table and `test-inventory.md`'s smoke-name-to-behavior map.

14. **`formatHelp`/`formatCommandHelp` layout.** The 2-space command-line indent (parsed by the
    parity help-token checker) versus the 4-space "note" line indent (deliberately invisible to
    that same parser) must survive unchanged. `core/format/help.ts` keeps these as literal
    string templates with an inline comment citing this exact load-bearing distinction.

15. **`parseArgv` flag-value rules.** A flag's value is the next token ONLY when that token
    does not start with `-`; `--key=value` and everything after a bare `--` are the two ways to
    pass a dash-leading value; the short-flag table (`q/r/d/l/a/h/v`) and repeated-key-becomes-
    array are pinned. Ported as one literal function in `cli/parseargv.ts`, unit-tested against
    every rule named in `cli-surface.md` and `orchestrator.md`.

16. **The cross-cutting enforcement mechanism.** All of the above are checked at TWO layers:
    (a) golden-fixture unit tests in `core/`'s own test tree (fast, run every save), sourced
    directly from each SPEC file's "Exact outputs" JSON/text blocks — never hand-typed fresh
    strings that could drift from the SPEC's own evidence; (b) the `v2/conformance/` black-box
    suite, run against the actual built CLI, per its own rule: **"green on old first"** — a
    case that fails against the OLD build is a wrong case, not a real regression, and must be
    fixed in the case file before it is trusted against v2.

## Build order

Ordered for maximum early signal: simplest surfaces first (so parser/dispatcher bugs show up
immediately and cheaply), then the state/hash/ledger core everything else depends on for its
exact byte formats, then the execution/agent-spawn boundary, then the pipeline run+commit
spine, then the CLI/MCP parity layer built on top of a now-stable capability set, then multi-
agent/topology, then scheduling/registry/reclamation, then reporting/observability/workbench,
then workflow apps last (they compose everything below them).

Each milestone names its SPEC subsystem(s) and the `v2/conformance/run.js --filter <pattern>`
that must go green — against the REAL BUILT v2 CLI — before the next milestone starts. Per the
conformance README's own rule, a filter that fails against v2 but ALSO fails replayed against
the old build is a wrong case, fix the case first.

0. **Foundations: ids, fingerprint, atomic write, lock.** No CLI surface yet — gated by
   golden-fixture unit tests captured from the running old binary, not a conformance filter,
   because every later byte format depends on this being exactly right first. Draws from:
   `state-core.md` (write bytes, lock protocol, safe ids), `ledger-trust.md` (the three hash
   spellings). Done when: `core/hash.ts` and `shell/fs-atomic.ts` unit tests are 100%
   green and their wall-clock time is measured and reported (this is the early, falsifiable
   check on the "sub-15s unit loop" target — measure it now, not at the end).

1. **CLI parsing, version, help, top-level flags.** The simplest possible real surface: no run
   state at all. Draws from: `cli-surface.md` (`parseArgv`, top-level flag redirects,
   `formatHelp`/`formatCommandHelp`), `orchestrator.md` (`KNOWN_COMMANDS`, `suggestCommand`).
   Conformance filter: `version-basic|cli-argv-parsing|cli-help-topics|cli-exit-codes`.

2. **Capability table + generic CLI/MCP dispatchers (near-empty).** Build `core/capability-
   table.ts` (the row data shape + lookup helpers) and both generic interpreters —
   `cli/dispatch.ts` and `mcp/dispatch.ts` — NOW, wired to only a handful of capabilities
   (version/help/list). `formatHelp`/`formatCommandHelp` become pure projections of the table.
   This is the one structural correction from the Revision note above: build the one-source
   mechanism BEFORE any real capability exists, so every milestone from here on adds
   capabilities as table rows only — `dispatch.ts` is never touched again, and the hand-sync
   risk this design exists to remove never gets a chance to open up mid-build. Draws from:
   `orchestrator.md` (the existing instinct, `CAPABILITY_REGISTRY`), `mcp.md`
   (`declaredMcpTools`), `cli-surface.md` (`declaredCliTokens`). Conformance filter:
   `version-basic|cli-argv-parsing|cli-help-topics|cli-exit-codes|mcp-basic`. Done when: a CLI
   `--help` walk and an MCP `tools/list` round-trip read the SAME table rows — if the
   generic-dispatch thesis does not hold here, with almost nothing built on it yet, revisit it
   before milestone 3, not after.

3. **State kernel: schema, migration, StateNode lifecycle, node snapshot/diff/replay.**
   Everything above this needs run state to load/save byte-identically. Any CLI-facing state
   verb lands as a registry row against milestone 2's dispatcher, never a hand-written handler.
   Draws from: `state-core.md` in full. Conformance filter:
   `state-migration-unsupported|state-normalize-defaults` — see Open risk 10:
   `state-json-bytes`/`state-node-snapshot-replay`/half of `state-migration-prove` also belong to
   this milestone's subject matter but use `-q` in their own setup, so they are deferred to
   milestone 7's combined gate rather than gating milestone 3 itself.

4. **State-explosion summaries + contract-migration prover.** Layered directly on the state
   kernel; exercises the hash module's `fingerprintStrings`/`stableHash` split for real.
   Draws from: `state-core.md` ("state-explosion" and "contract-migration" sections).
   Conformance filter: same reduced state-* filter as milestone 3, expanded once dedicated
   summary-specific conformance cases exist (author them here if the case set is thin — see Open
   risk on case coverage — and prefer a setup path that avoids `-q` per Open risk 10's lesson).

5. **Execution backend + agent spawn + sandbox.** The delegate-not-execute boundary: driver
   registry, local/shell/container/remote/ci drivers, the agent driver's spawn+parse+redact
   path, sandbox profile resolution and runtime checks. `scripts/agents/*` and
   `scripts/children/*` are copied byte-identical, not rewritten. Draws from:
   `execution-backend.md` in full. Conformance filter (CORRECTED — see Open risk 10; the first
   pass's claim that all 5 originally-listed cases were independently gatable was verified false
   during real implementation):
   `exec-backend-registry|exec-agent-config-file|exec-agent-probe-and-autodetect|exec-sandbox-profile-fail-closed|exec-doctor-agent-config|exechard-codex-sandbox-fail-closed`.
   The other 3 cases from the first pass's list (`exec-agent-substitution`,
   `exec-agent-secret-redaction`, `exec-sandbox-readonly-boundary`) plus 2 `exechard-*` gap-fill
   cases all invoke `quickstart`/`run --drive`, so they defer to milestone 7's combined gate.

6. **Pipeline run + commit gate.** The `plan -> dispatch -> result -> verify -> commit` spine:
   default contract, one-step pipeline runner, dispatch manifests, result-envelope
   normalization, the commit gate's ~25 error codes, task-file rendering, error-feedback
   classification. Draws from: `pipeline-run.md` (contract, dispatch, commit sections).
   Conformance filter: `pipeline-question-basic` — per Open risk 10, this filter will NOT go
   green until milestone 7 is also built (the case uses `-q`, which always routes through the
   full `drive()`); implement this milestone's code fully, but expect its filter to stay red
   until milestone 7 completes, and do not treat that as a milestone-6 regression.

7. **Drive loop, sub-workflow, loop() expansion, incremental cache.** The largest and most
   tangled behavioral surface, built once the pipeline spine under it is proven. Draws from:
   `pipeline-run.md` (drive, sub-workflow, loop-expansion, incremental-cache sections).
   Conformance filter — the REAL combined gate for milestones 5+6+7 (Open risk 10), plus the 3
   state-core cases deferred from milestone 3 and the 5 execution-backend cases deferred from
   milestone 5:
   `pipeline-question-basic|state-json-bytes|state-node-snapshot-replay|state-migration-prove|exec-agent-substitution|exec-agent-secret-redaction|exec-sandbox-readonly-boundary|exechard-evidence-triple-hygiene|exechard-model-attestation-unreported`.
   Re-check after this milestone whether any of these still need milestone 12 (workflow-apps) —
   some invoke a named app rather than the default one, so a residual dependency there is
   plausible; defer further rather than building workflow-app resolution early if so.
   Author drive-specific cases here too; these are exactly the cases the "conformance-porting
   keeping pace" risk targets — see Open risks.

8. **Ledger, telemetry, trust-audit, tamper/bundle demos.** The trust layer, reachable from both
   front doors via milestone 2's dispatcher the moment its registry rows land. Draws from:
   `ledger-trust.md` in full. Conformance filter: `demo-tamper` (expand with ledger/telemetry/
   audit-specific cases authored here — a clear gap in the current case set; see Open risks).

9. **Multi-agent, topology, coordinator/blackboard, candidate scoring, collaboration.** The
   largest single domain, built on a proven state+trust base. Draws from: `multi-agent.md` in
   full. Conformance filter: author multi-agent-specific cases at this step (none exist yet in
   `v2/conformance/cases/`; this is the single biggest case-authoring gap named in Open risks).

10. **Scheduling, registry, gc/reclamation, orphans, clones.** Largely orthogonal read/write-
    index layers over already-stable run state. Draws from: `scheduling-registry.md` in full.
    Conformance filter:
    `sched-clones-gc|sched-corrupt-fail-closed|sched-gc-plan-run|sched-gc-reclaim-verify|sched-orphans-clean|sched-orphans-sweep|sched-registry-after-run`.

11. **Reporting, observability, doctor/fix, workbench, run export/bundle.** The read-side and
    portability layer over everything below it. Draws from: `reporting-ux.md` in full.
    Conformance filter: extend with report/doctor/workbench-specific cases (author here; no
    dedicated case file exists yet beyond what tamper/bundle already covers).

12. **Workflow apps.** Composes everything below it (manifests reference workflows that drive
    the full pipeline+multi-agent+trust stack). Draws from: `workflow-apps.md` in full.
    Conformance filter: author app-lifecycle-specific cases here (list/show/validate/init/
    package/run).

13. **Full capability-registry completion + full-suite cutover gate.** Fill in every remaining
    registry row (candidate/audit/collaboration/workbench/feedback-view capabilities — thin
    read-projections over state already built in milestones 3-12) as PURELY additive data,
    since milestone 2 already built the dispatch mechanism — no dispatch code changes at this
    step. Confirm the live payload-identical probe (`payloadProbePlan()`, ported literally)
    matches `--json` bytes to MCP `tools/call` bytes for every capability marked
    `payloadIdentical`. Then run `v2/conformance/run.js --bin <v2 build>` with NO filter. 100%
    green, both against v2 directly and re-confirmed green against the old build for any case
    touched during authoring, is the definition of done for the rebuild.

## Targets

| | Old build | v2 target |
|---|---|---|
| `src/` files | 166 | **~95-250**, span across the two independently-estimated proposals behind this plan — the recovered third proposal (`v2/DESIGN_MINIMAL_KERNEL.md`) counts 95-110 by merging small per-purity files as well as deleting dispatch glue; the winning synthesis counted 220-250 by keeping business-logic files at roughly today's granularity. Do not treat either as measured; report the REAL count once milestone 3 (state kernel, the first big real chunk of code) lands, and again at milestone 13. |
| `src/` lines | ~46,620 | **~18,000-32,000** (a 31-61% cut) — same two-estimate caveat as file count above; the spread is mostly about how literally business logic (collapse rules, gate error-code tables, hash-chain math) gets ported vs. reorganized, not about the CLI/MCP dedup, which both proposals agree removes ~3,500-4,800 lines. Measure the real number at milestone 3 and milestone 13, do not keep repeating an unmeasured range in later reporting. |
| CLI/MCP hand-written surface | ~3,200 lines (40 handler files + 196-arm switch + 1000-line tool-definitions array), kept in sync by a separate drift-check script | ~600 lines of table data + ~300 lines of generic dispatcher/generator code; parity is structural, checked once by a self-consistency assertion plus the live payload-probe |
| Orchestrator facade | 1000+ line class, 141 forwarding methods | 0 forwarding boilerplate lines; the same 141 behaviors reachable as `core/`/`shell/` functions through the generic dispatcher |
| Test files | 173 `test/*-smoke.js` (black-box, one child process each) | ~90-120 pure-function unit test files (`core/**/*.test.js`, `node --test`, no subprocess/disk) + the existing/expanded `v2/conformance/cases/*.case.js` black-box set (target ~140 cases, up from the 26 that exist today) |
| Unit test loop (pure `core/` only) | n/a (did not exist as a separable tier) | under 15 seconds, no subprocess, no disk — measured directly after milestone 0, not assumed |
| Full black-box conformance loop | ~12 minutes (this is the ENTIRE old suite, process-per-smoke) | comparable per-case cost (child-process overhead does not shrink with a smaller kernel), run once per PR/release/milestone gate — not on every save |
| TypeScript build | one slow, unbroken step (no baseline number given) | directional target: materially faster from fewer, smaller, less-duplicated files; no incremental/project-references claim made without a measured baseline — treat as "verify after milestone 3 (the first milestone with real code volume), do not promise before" |

Reasoning: the SPEC's own ~2167 surface items split roughly 70% pure decision-over-loaded-data
(state/schema/migration ~300, pipeline/dispatch/drive ~400, trust/ledger/audit math ~350,
multi-agent/topology/candidate ~450 — all expressible as `f(alreadyLoadedData) -> result`) and
30% CLI/MCP wiring plus IO glue (~650) that inherently needs a process boundary or a real
filesystem. The LOC cut is concentrated in exactly the two duplication classes the SPEC itself
names: the CLI/MCP hand-kept dual surface (~4,400-4,800 lines across `capability-registry.ts` +
`mcp/tool-definitions.ts` + `cli/handlers/*` + `orchestrator.ts`'s facade-and-formatters) and the
three hash/stringify near-duplicates. This plan does not claim the cut by rewriting business
logic smaller — collapse rules, gate error-code tables, hash-chain math, and fail-closed checks
are kept as literal ports at their current size, because they are complex FOR A REASON.

## Open risks

1. **Hash dedup under-delivery.** The single biggest named judge risk: collapsing the three
   `stableStringify` variants (ledger / telemetry-attestation / trust-audit) into "one
   canonical implementation with a flag for the one edge case" would silently change
   `eventHash`'s chain-verification behavior, because the trust-audit version is a
   JSON-round-trip PRE-PASS (drops nested `undefined`), not a formatting flag on the same
   input shape. **Mitigated by:** Byte-compat item 2 above, which names all three shapes
   explicitly and requires three separately-named, separately-tested functions in
   `core/hash.ts` rather than one flagged function. Golden-fixture tests at milestone 0
   are the proof; do not proceed past milestone 0 until all three pass independently.

2. **The `unique()` counter-example to "duplication is bad."** `multi-agent.md` flags a
   sorted-vs-unsorted `unique()` pair that must stay separate because collapsing it changes
   persisted record order and eval parity. **Mitigated by:** Byte-compat item 3's explicit
   rule (hash/digest output = safe to dedup; persisted/compared VALUE output = not safe) plus a
   standing instruction to check every proposed dedup against that rule before merging it, not
   just the three named hash functions.

3. **The 12 projected-payload capabilities (CLI calls X, MCP calls Y).** A single-handler-per-
   row capability table cannot represent "CLI and MCP call different functions with different
   payloads." **Mitigated by:** Byte-compat item 5 — the table schema carries distinct
   `cli.handler`/`mcp.handler` fields from the start, not a `customHandler` escape hatch bolted
   on later. This is the runner-up proposal's own flagged gap in the winning proposal; closed
   here by construction.

4. **Facade-collapse as a judgment call, not silent compliance.** Shrinking the 141-method
   class into a table+dispatcher is a real, documented anti-goal override. **Mitigated by:**
   explicitly calling this out at milestone 2 in the build order (moved earlier per the
   Revision note, so the judgment call is reviewed against a near-empty table before any
   hand-written CLI/MCP glue accumulates on top of it — not after, as the first pass had it),
   with the instruction to surface it to a human reviewer before that milestone's PR merges —
   not to assume "tests pass" is sufficient sign-off, since the anti-goal's intent (parity can
   never silently drift) is preserved but its letter (one wide class) is not.

5. **Conformance case-authoring keeping pace with the build order.** Only 26 case files exist
   today in `v2/conformance/cases/`, covering CLI parsing, MCP basics, exec/sandbox, a few
   scheduling/gc/orphans paths, one pipeline case, state migration/snapshot, tamper demo, and
   version. There is close to ZERO existing coverage for: dispatch/commit-gate error codes,
   drive/sub-workflow/loop-expansion, ledger/telemetry/trust-audit (beyond the one tamper demo),
   multi-agent/topology/coordinator/candidate-scoring, collaboration, reporting/workbench/
   doctor, and workflow-apps. **Accepted as a first-class task, not a footnote:** each build
   milestone above (6, 7, 8, 9, 11, 12) explicitly includes "author cases here" in its own
   text. This is the single biggest buildability threat in the whole plan — treat case-writing
   time as part of the milestone's own budget, not a follow-up.

6. **Structural-assertion smokes that should NOT become black-box conformance cases.** Some old
   `test/*-smoke.js` files test internal wiring (e.g. `dead-export-removal-guard-smoke.js`,
   which asserts specific functions stay exported) rather than externally observable behavior.
   **Mitigated by:** the conformance suite's own rule 1 ("black box only... never test inner
   structure") already excludes these by construction; when authoring new cases at milestones
   6/7/8/9/11/12, check each candidate old smoke file against that rule before porting it, and
   cover anything that fails the rule with a `core/` unit test instead.

7. **Zero-dependency constraint on new codegen scripts.** `scripts/gen-tool-definitions.js` is
   new. **Mitigated by:** writing it in the same plain-Node, no-`require`-beyond-`fs`/`path`
   style as the existing `scripts/gen-manifests.js`, which is the working precedent; no new
   package.json dependency is acceptable under any circumstance.

8. **TypeScript build-time target has no measured baseline.** Unlike the 12-minute test-suite
   number (a real, stated fact), no current build-time number was given for the old build.
   **Accepted as directional, not promised:** state the build-time target as "materially
   faster, verify after milestone 3" rather than a hard number, and measure the actual v2
   build time at that checkpoint before repeating any specific claim in later reporting.

9. **Drive loop's resistance to a clean pure/impure split.** `drive.ts` interleaves decision
   logic (task selection, retry/park math) with real IO (spawning agent children, writing the
   incremental-cache file, committing state) more tightly than most of the rest of the
   codebase. **Mitigated by:** `core/pipeline/drive-decide.ts` is scoped explicitly to the
   PURE decision half only (as named in the Target shape section); the actual spawn/commit/
   cache-write calls stay in `shell/`, called by a thin loop that feeds `drive-decide.ts`'s
   output back in. If milestone 7 finds a decision that cannot be cleanly separated without
   changing behavior, keep the mixed function in `shell/` rather than force a bad split — a
   `shell/`-housed function that is 90% pure is still better than a `core/` function that lies
   about being pure.

10. **Milestones 5, 6, and 7 are not independently conformance-gatable — discovered during
    milestone 3's implementation, CONFIRMED WIDER during milestone 5's (an earlier version of
    this very risk entry claimed milestone 5 stood alone; that claim was itself wrong, caught
    only once milestone 5 was actually built and 3 of its 5 originally-listed cases turned out
    to need the same missing machinery).** Every `-q`/quickstart/`run --drive` conformance case
    (`pipeline-question-basic`; `state-json-bytes`/`state-node-snapshot-replay`/half of
    `state-migration-prove` from milestone 3; and `exec-agent-substitution`/`exec-agent-secret-
    redaction`/`exec-sandbox-readonly-boundary`/2 `exechard-*` cases from milestone 5 — all of
    which use `-q`/`run --drive` only to generate a realistic run or exercise a real delegation
    hop, not because their OWN subject matter is pipeline/drive logic) routes through the OLD
    build's `drive()` (`src/drive.ts`) unconditionally — there is no lower-level manual
    plan/dispatch/result/commit CLI sequence that any existing conformance case exercises
    instead. `drive()` itself pulls in execution-backend (milestone 5), the pipeline runner and
    commit gate (milestone 6), and the loop/sub-workflow/incremental-cache logic (milestone 7)
    together — and possibly workflow-app resolution (milestone 12) too, for cases that name a
    specific app. **Consequence:** milestone 6's own filter (`pipeline-question-basic`) will not
    go green until milestone 7 is ALSO built, and the cases deferred out of milestones 3 and 5
    will not go green until then either. **Mitigated by:** implement milestones 5, 6, and 7 in
    order as planned (each is still a distinct, well-scoped body of code), but treat their
    conformance filters as ONE COMBINED GATE — `v2/BUILD_ORDER.json`'s milestone 7 entry now
    carries the full combined filter (9 cases: the pipeline/state/exec-backend cases named
    above). Do not treat a red milestone-5 or milestone-6 filter as a regression in that
    milestone while milestone 7 is still in progress. **A future builder hitting this same wall
    should NOT trust a "these N cases are independently gatable" claim in this plan without
    re-verifying it empirically against a real build first — that exact claim was wrong twice in
    this plan's own history (once for milestone 3's neighbors, once for milestone 5 itself)** —
    and should NOT special-case a smaller drive loop just to satisfy an earlier milestone's gate
    (that duplicates ~1,000+ lines of behavior ahead of its own milestone and risks drifting
    from what gets built for real) — defer the case instead, exactly as done here.

## How this plan is used

A build loop reads this file plus `v2/SPEC/*.md`, then implements one build-order milestone at
a time under `v2/src/`, following the module layout and byte-compat rules above. After each
milestone it runs `node v2/conformance/run.js --bin <path to the v2 build> --filter <that
milestone's pattern>` and does not start the next milestone until that filter is 100% green —
per the conformance suite's own rule, a failing case is first checked against the OLD build,
and fixed as a wrong case if it fails there too, before it is ever treated as a real v2
regression. The FULL suite (`node v2/conformance/run.js --bin <v2 build>`, no `--filter`) going
green is the definition of done for the whole rebuild.
