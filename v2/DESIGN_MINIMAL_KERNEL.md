# Cool Workflow v2 — Minimal Kernel + Generated Surfaces

An independent rebuild proposal. Lens: **one small dependency-free kernel** (state,
hashing/ledger, execution-backend, evidence gate) plus **one declarative registry**
that CLI, MCP, and vendor manifests are all generated from — so CLI/MCP parity is a
compiler fact, not a hand-maintained gate.

This file is a from-scratch proposal, written against the extracted spec at
`v2/SPEC/*.md` (166 old `src/` files, ~46,620 lines). It does not modify the old
build, and it is one independent take alongside whatever else exists under `v2/`
(there is already a `v2/PLAN.md` from a prior pass and a black-box conformance
suite under `v2/conformance/` — this proposal targets that same conformance
suite as its judge, but proposes a different internal shape to get there).

## 1. Goals recap

Non-negotiables carried over unchanged from the old build (`AGENTS.md`, `v2/PLAN.md`):

- **POLA.** Never change the byte content of an existing output, file format, exit
  code, or flag.
- **Mechanism, not policy.** The kernel provides mechanisms; vendor-specific logic
  (which model CLI to shell out to, how to parse its stream) stays in wrapper
  scripts, never in the kernel.
- **Rule of Silence.** stdout is data, stderr is diagnostics, silent on success
  when piped.
- **Fail closed.** Unconfigured or unverifiable input is a visible refusal, never
  a fabricated success.
- **Zero runtime dependencies.** No `package.json` dependency, ever. No model SDK,
  no API key, ever.
- **Tools not frameworks.** Composition happens through files under `.cw/`, not
  hidden in-process coupling.
- **Deterministic, replayable.** Every step is plain JSON; replay must be
  byte-stable.
- **Delegate, not execute — permanently.** CW spawns agent CLIs out-of-process
  and never calls a model API itself. This is the moat, not a gap to close.

This proposal's own added goal: **collapse the "two front doors must never drift"
problem from a discipline into a structural impossibility.** The old build spends
real engineering (`capability-registry.ts`, 1032 lines; `parity-check.js`;
`gen-manifests.js`; `gen-parity-doc.js`; a fail-closed CI gate) making sure
`cli.ts`'s dispatch switch, `mcp-server.ts`'s tool list, and 12 generated vendor
manifests all agree. That is real, necessary work today because the CLI dispatcher
and the MCP tool list are two hand-written surfaces reading a shared table. This
proposal removes the hand-writing on both sides: there is one **capability
registry** (data, not code), and `cli/dispatch.ts` + `mcp/dispatch.ts` are each a
single generic ~150-line interpreter over that table. There is no second surface
to drift from the first, because neither surface is written by hand per-command.

## 2. The one-registry idea, precisely

The old build already has the right instinct — `CAPABILITY_REGISTRY` in
`src/capability-registry.ts` is a single array of 209 `CapabilityDescriptor` rows
that both `declaredCliTokens()` and `declaredMcpTools()` read (`v2/SPEC/mcp.md`
lines 27-38). What it does NOT do is make the registry the actual dispatch
mechanism. `src/cli/command-surface.ts` still hand-writes a 330-line `switch`
(`v2/SPEC/cli-surface.md` lines 43-88), `src/mcp/tool-call.ts` still hand-writes a
196-arm `switch` (`v2/SPEC/mcp.md` line 26), and the registry is checked against
both by a *separate* smoke test and a *separate* CI gate (`parity-check.js`).
Three artifacts, one truth, kept in sync by vigilance and tests.

This design makes the registry itself executable:

```ts
// core/registry/types.ts
interface Capability {
  id: string;                          // "run.drive.step"
  summary: string;                      // one line, used in CLI help + MCP description
  cli: { path: string[]; jsonMode: "default" | "flag" | "human" } | null;
  mcp: { tool: string; requiredArgs?: string[] } | null; // "keyA|keyB" groups, same as today
  entry: CapabilityEntry;               // see below — NOT a switch arm, a value
  payloadIdentical?: boolean;
  reason?: string;                      // required when cli-only/mcp-only
}
```

`CapabilityEntry` is a plain function reference into `core/` or `shell/`:
`(ctx: CapabilityContext, args: Record<string, unknown>) => unknown`. The
registry is one big literal array built with a `defineCapability(...)` helper
(itself just an identity function with a type signature — zero magic, easy to
grep). `cli/dispatch.ts` and `mcp/dispatch.ts` do not know about individual
capabilities at all:

```ts
// cli/dispatch.ts (the whole shape, not the whole file)
function runCli(argv: string[]) {
  const { command, positionals, options } = parseArgv(argv);
  const cap = findCapabilityForCliPath([command, ...positionals], REGISTRY);
  if (!cap) throw unknownCommandError(command, REGISTRY);
  const result = cap.entry(ctxFromOptions(options), argsFromCli(cap, positionals, options));
  emitCliResult(cap, result, options);   // reads cap.cli.jsonMode, nothing else
}
```

```ts
// mcp/dispatch.ts (the whole shape)
function callTool(name: string, args: Record<string, unknown>) {
  const cap = findCapabilityForMcpTool(name, REGISTRY);
  if (!cap) throw new Error(`Unknown tool: ${name}`);
  requiredToolArguments(cap, args);      // same "keyA|keyB" group check as today
  return cap.entry(ctxFromMcp(args), args);
}
```

Both interpreters are under 200 lines combined, own zero per-command knowledge,
and are covered by ONE unit test each (`registry-cli-dispatch.spec.ts`,
`registry-mcp-dispatch.spec.ts`) instead of a whole family of handler-routing
smokes. **CLI/MCP drift becomes impossible by construction**: there is exactly
one command table, and both front doors are pure functions of it. There is
nothing left for `parity-check.js` to check except "does the registry itself
look sane" (duplicate ids, a capability declared `cli-only` with no `reason`,
etc.) — which becomes a schema-validation pass over the registry data, not a
cross-artifact diff. `formatHelp()`/`formatCommandHelp()` also become pure
projections of `REGISTRY`, so the help text can never list a command dispatch
doesn't handle.

### Vendor manifests as a second projection of the same registry

`manifest/plugin.manifest.json` today is a hand-edited "meta-registry" (identity,
descriptions, per-vendor path templates) that `gen-manifests.js` expands into 12
files. That part is *not* duplicated logic — it is genuinely vendor-specific
templating (`v2/SPEC/mcp.md` lines 354-385) and stays exactly as-is: one hand-kept
JSON manifest, one generator script, `--check` mode in CI. This is not something
codegen should "improve away" — the vendor path differences (`${CLAUDE_PLUGIN_ROOT}`
vs `./`) are real, small, and already minimal. The only change from today: the
generator also emits the tool list section by calling `declaredMcpTools()` on the
same `REGISTRY` used by `mcp/dispatch.ts`, instead of a second copy.

## 3. Full module layout

```text
v2/
  src/
    core/                        # PURE. No fs, child_process, crypto.sign, net,
                                  # process.env, Date.now(), Math.random(). Every
                                  # such input is a function parameter. Enforced by
                                  # an eslint rule (no-restricted-imports/globals),
                                  # not just code review.
      hash.ts                    # THE one hash module. Exports, each separately
                                  # named so mixing them is a visible diff:
                                  #   sha256(bytes) -> "sha256:<64hex>"
                                  #   sha256Bytes(bytes) -> "<64hex>" (archives only)
                                  #   stableStringify(value) -> string (recursive key sort)
                                  #   fingerprintStrings(values) -> "sha256:<32hex>" (SORTS input)
                                  #   fingerprintRecords(records) -> "sha256:<32hex>"
                                  #   stableHash(value) -> "sha256:<64hex>" (key-sorted JSON)
                                  # Every other module in the whole tree imports
                                  # hashing ONLY from here — see byte-compat section 4.2.
      registry/
        types.ts                 # Capability, CapabilityEntry, McpBinding types
        registry.ts              # the ~209-row REGISTRY array (data)
        lookup.ts                 # findCapabilityForCliPath, findCapabilityForMcpTool,
                                   # declaredCliTokens, declaredMcpTools, requiresReason,
                                   # payloadIdenticalCapabilities — pure, given REGISTRY
        lint.ts                   # registryLint(REGISTRY): duplicate ids, missing reasons,
                                   # cli-only/mcp-only bookkeeping — replaces most of
                                   # parity-check.js's STATIC half
        help.ts                    # formatHelp, formatCommandHelp, suggestCommand
                                    # (Levenshtein), formatSearchResults, formatInfo —
                                    # pure projections of REGISTRY + argv
      argv/
        parse.ts                  # parseArgv, KNOWN_COMMANDS, appendOption — the exact
                                   # flag-value rules from cli-surface.md are pinned here
                                   # in ONE place (today they live inline in orchestrator.ts)
      state/
        run-paths.ts              # createRunPaths, ensureRunDirs (16-key RunPaths; pure
                                   # path math, actual mkdir is shell/fs-atomic.ts)
        schema.ts                 # REQUIRED_TOP_LEVEL_KEYS / ARRAY_KEYS / RECORD_KEYS —
                                   # single field-list source, gated against the WorkflowRun
                                   # type at build time (same discipline as today)
        migrations.ts             # RUN_STATE_MIGRATIONS, findMigrationPath (BFS),
                                   # migrateRunState, reverseRunState, normalizeRunState
        state-node.ts              # createStateNode, transitionStateNode (matrix + the
                                    # second commit-without-verifier gate), validatePipelineContract,
                                    # assertNodeSatisfiesContract, recordNodeError,
                                    # linkStateNodes, deterministic node-id fallback
        node-projection.ts         # rawNodeProjection (13-field list, exact), projectNodeBody,
                                    # nodeProjectionDigestInput — shared with reclamation
        node-snapshot.ts           # snapshotNode/diffNodeSnapshots/replayNodeSnapshot/
                                    # verifyNodeReplay — pure given (run, clock)
        state-explosion/
          size.ts                  # computeStateSize, DEFAULT_STATE_EXPLOSION_THRESHOLDS
          graph.ts                  # buildCompactGraph + the collapse rules
          digest.ts                  # summarizeBlackboardDigest
          helpers.ts                  # isProtectedStatus, dominantStatus, parentMap,
                                       # stableLine, unique, byId, truncate, slug
        contract-migration.ts        # listMigrationContracts, resolveChain, checkMigration,
                                      # proveMigration (4-proof invariant)
        schema-validate.ts            # dependency-free JSON-schema subset
        validation.ts                  # RecordValidationError + per-record shape guards
                                       # (CandidateRecord/Score, NodeSnapshot/ReplayRun, WorkerScope)
      pipeline/
        contract.ts                  # DEFAULT_PIPELINE_CONTRACT_ID, createDefaultPipelineContract
        runner.ts                     # findRunnablePipelineStages, runPipelineStage (pure
                                       # decision: given run+contract+clock, returns the new
                                       # run value + what to write — shell/run-store.ts does
                                       # the actual write), advancePipeline, failPipelineStage
        dispatch.ts                    # nextDispatchTasks, firstRunnablePhase,
                                        # updatePhaseStatuses, formatDispatchTask, dispatch-id
                                        # formatting (pure given a clock + counter)
        commit-gate.ts                  # commitState's gate resolution + the ~25 error codes
                                         # (pure decision function)
        result-normalize.ts               # normalizeResultEnvelope, isEmptyCapture
        error-feedback.ts                  # classifyFeedback, recordFeedback's decision half,
                                            # dedup key
        loop-expansion.ts                   # predicate registry, maxLoopExpansion,
                                             # maybeExpandLoop's decision half
        drive-decide.ts                      # driveStep/driveConcurrentRound's PURE core:
                                              # task selection, terminal/gate logic, token
                                              # budget check, retry/park math, cache-key
                                              # formulas — every branch that does not itself
                                              # spawn a process or touch disk
      trust/
        ledger.ts                    # computeLedgerDigest, buildLedgerProposal/Review,
                                      # verifyLedgerEntry, applyLedgerProposal (pure;
                                      # directory reads live in shell/ledger-io.ts)
        telemetry-ledger.ts            # genesisPrevHash, computeRecordHash,
                                        # reportedUsageDigest, verifyTelemetryLedger
        telemetry-attestation.ts        # canonicalTelemetryPayload, normalizeReportedUsage,
                                         # verifyTelemetryAttestation, verifyTelemetrySignatures
                                         # (verify only — signTelemetry is executor-side,
                                         # lives in shell/agents/, see section 4.4)
        trust-audit.ts                   # trustAuditGenesis, verifyTrustAudit (pure verify;
                                          # append is shell), eventHash, evidence scrub rules
        evidence-grounding.ts              # isGroundedEvidence, confidence tiers,
                                            # requireResolvableEvidence (the disk-check half
                                            # is a callback so this stays pure)
        evidence-reasoning.ts               # buildEvidenceReasoningReport, fail-closed
                                             # "unexplained" rollup, fingerprinting
        verifier.ts                          # assertTaskCanComplete, validateResultEnvelope,
                                              # validateRunGates
        gates.ts                              # emptyCaptureWarning, sandboxProfileForCandidate
      multi-agent/
        core.ts                       # createMultiAgentRun/Role/Group/Membership/Fanout/Fanin
                                       # decision functions (id minting, status transitions)
        topology.ts                    # OFFICIAL_TOPOLOGIES (map-reduce/debate/judge-panel),
                                        # applyTopology's decision half, role-width math
        coordinator.ts                  # blackboard/context/decision record-shape functions
        trust-policy.ts                  # policyForRole/Group/Membership, authorizeAction
        candidate-scoring.ts               # score/rank/select pure math
        eval-replay.ts                      # eval snapshot/replay/compare/score/gate/report
        graph.ts                            # multi-agent + blackboard + topology graph builders
      workflow-app/
        schema.ts                    # WorkflowAppDefinition validation
        template.ts                   # init/initApp/packageApp content generation
      execution-backend/
        registry.ts                   # DRIVER_SPECS (7 built-ins), resolveBackendSelection,
                                       # requiredSandboxDimensions, attestSandbox (the decision
                                       # matrix — actual spawn is shell/exec/*)
        sandbox-profile.ts              # 4 bundled profiles, resolveSandboxProfile (path-token
                                         # substitution, traversal/control-char refusal — pure
                                         # string math; the disk existence check is a callback)
      onramp.ts                     # buildDoctorOnramp, evaluateOnrampContract — pure given
                                     # a file list (git calls live in shell/)

    shell/                         # IMPURE. The only place fs/child_process/crypto.sign/
                                   # net/process.env/Date.now/Math.random may appear.
                                   # Every shell/ module is a thin adapter: gather impure
                                   # inputs, call a core/ function, write the core/ function's
                                   # output. No business logic lives here.
      fs-atomic.ts                # writeJson (temp+fsync+rename), durableAppendFileSync,
                                   # withFileLock (O_EXCL, 30s steal, 240x25ms), safeFileName,
                                   # assertSafeRunId, realResolve, isContainedPath
      run-store.ts                 # loadRunFromCwd, saveCheckpoint, compactCheckpoint —
                                    # calls core/state/migrations.ts then fs-atomic.ts
      clock.ts                      # nowIso(), pid(), a per-process sequence counter —
                                     # THE only place `new Date()` / `process.pid` appear
                                     # outside tests; every core/ call site takes these in
      env.ts                         # readEnv(name) wrapper — lets tests inject env without
                                      # mutating global process.env; also the ~30 documented
                                      # CW_* var names in one typed table
      exec/
        local.ts                     # executeLocal: spawnSync node/bun/shell drivers
        container.ts                   # runContainer: docker/podman spawn
        http-delegate.ts                 # remote/ci drivers: spawn the http-delegate-child
        agent.ts                          # runAgentProcess/runAgentEndpoint: spawn + parse
                                           # agent report + secret redaction call-through
        batch.ts                           # prepareAgentSpawn, runAgentBatchOutcomes:
                                            # spawn the batch-delegate-child
        probes.ts                           # the 7 driver probes (each does real fs/PATH/
                                            # spawnSync checks; the READY/UNVERIFIED/REFUSED
                                            # decision is core/execution-backend/registry.ts)
      agent-config-io.ts             # agentConfigPath, loadAgentConfigFile,
                                      # setAgentConfigFile (reads/writes $CW_HOME/agent-config.json)
      remote-source.ts                # materializeRemote: git clone / archive download —
                                       # the classify/sanitize/safety-check pure functions live
                                       # in core/ (see note in section 4 risk list) and are
                                       # imported here; only the actual git/curl spawn is shell
      ledger-io.ts                     # listLedgerEntries/unionLedgerEntries directory reads
      trust-audit-io.ts                  # recordTrustAuditEvent (durable append),
                                          # ensureTrustAudit, event-log cache
      worker-isolation.ts                 # allocateWorkerScope, recordWorkerOutput's 7-step
                                           # accept pipeline (calls into core/trust,
                                           # core/pipeline for each decision, shell/fs-atomic
                                           # for each write), reclaimOrphans
      run-registry-io.ts                   # the on-disk registry/queue/history persistence
                                            # (src/run-registry.ts's impure half)
      reclamation-io.ts                     # gc plan/run/verify's actual file deletion +
                                             # tombstone chain writes
      scheduler-io.ts                        # Scheduler, DesktopSchedulerDaemon, triggers —
                                              # persistence + the wall-clock tick loop
      drive.ts                                # drive(), driveConcurrentRound(): orchestrates
                                                # core/pipeline/drive-decide.ts one step at a
                                                # time, doing the actual dispatch/spawn/accept
                                                # I/O each step calls for
      report.ts                                # writeReport, summarizeRun — report.md is
                                                # generated text (a pure formatter) but the
                                                # actual file write is here
      workbench-host.ts                         # the localhost read-only HTTP server

    cli/
      command-surface.ts            # top-level flag redirects (--version, --help, -q,
                                     # vendor short flags), presentation env-var setters,
                                     # then one call into dispatch.ts
      dispatch.ts                    # the ~30-line generic interpreter described in section 2
      io.ts                           # required, optionalArg, printJson, wantsJson
      format.ts                        # humanBytes, clones/workbench human renderers —
                                        # everything NOT a projection of one capability's
                                        # JSON (registry.help.ts covers the rest)
      run-summary.ts                    # emitRunSummary (the stderr end-of-run chrome)
      term.ts                            # colorEnabled, ANSI codes, phaseProgressLine,
                                          # truncate — byte-identical to the old src/term.ts
    mcp/
      server.ts                     # stdio JSON-RPC loop: initialize / tools/list / tools/call
      dispatch.ts                    # the ~20-line generic interpreter described in section 2
      surface.ts                      # requiredToolArguments group-check
      tool-schema.ts                   # mcpToolDefinition(cap) — generates one
                                        # McpToolDefinition per capability from its declared
                                        # `properties`; replaces hand-written tool-definitions.ts

    types/                         # unchanged in spirit from the old src/types/ barrel:
                                   # 25 files, zero runtime values, re-exported from
                                   # types/index.ts. Kept as its own tree (not under core/)
                                   # because BOTH core/ and shell/ import it.

  scripts/                         # zero-dependency runtime JS shipped in the npm package —
                                   # UNCHANGED IN SHAPE from the old build; this is not a
                                   # place codegen or "kernel" thinking helps, because it is
                                   # already minimal, vendor-owned, and out-of-process by
                                   # design (mechanism/policy split already correct here).
    cw.js                          # 4-line bin bootstrap -> dist/cli.js
    agents/                        # claude-p-agent.js, codex-agent.js, gemini-agent.js,
                                   # opencode-agent.js, deepseek-agent.js, gemini-opencode-agent.js,
                                   # agent-adapter-core.js, builtin-templates.json,
                                   # cw-attest-keygen.js, cw-attest-wrap.js — copied byte-
                                   # identical from the old build (see section 4.4)
    children/                      # batch-delegate-child.js, http-delegate-child.js — copied
                                   # byte-identical
    source-context.js              # copied byte-identical
    release-flow.js, release-gate.sh, release-check.js, onramp-check.js,
    bump-version.js, version-sync-check.js, vendor-preflight.js,
    coverage-gate.js, golden-path.js, dist-drift-check.js
                                   # release/gate tooling — ported, simplified where the
                                   # registry now does the parity work (parity-check.js
                                   # shrinks to registry-lint.js, gen-manifests.js gets one
                                   # extra data source, gen-parity-doc.js unchanged)

  manifest/
    plugin.manifest.json           # unchanged: hand-kept vendor identity/template data
    source-context-profiles.json   # unchanged
    builtin-templates.json          # moved under scripts/agents/, unchanged

  test/                            # unit + golden-fixture tests over core/ and shell/,
                                   # organized 1:1 with the module tree above (e.g.
                                   # core/state/state-node.spec.ts). Fast (core/ tests need
                                   # no fs, no child_process — pure function calls).

  v2/conformance/                  # UNCHANGED — this is the existing black-box suite that
                                   # drives the BUILT cli.js and never reads source. It is
                                   # the actual judge of "done"; the module layout above is
                                   # free to evolve as long as this stays green.
```

### Why this cut, not "core+shell"

A generic "split into core+shell" (the conservative alternative) still leaves the
166-file surface area roughly as-is, just re-labeled pure/impure — you get maybe
15-20% fewer files from merging tiny single-export files, but you keep three
separate hand-maintained pictures of "what can CW do": the CLI switch, the MCP
switch, and the registry that's supposed to describe both. This proposal is more
aggressive in two specific ways a conservative split would not do:

1. **The registry is the dispatcher**, not a data table a dispatcher is checked
   against. This deletes `cli/command-surface.ts`'s 330-line switch and
   `mcp/tool-call.ts`'s 196-arm switch entirely, replacing both with ~50 lines of
   generic interpreter code total. That is where most of the file-count and
   LOC reduction actually comes from — not from "writing tighter code" but from
   **deleting a whole category of hand-written per-command glue** on both sides.
2. **One hash module, not scattered reimplementations.** `types-util.md` documents
   that `run-registry.ts`, `observability.ts`, and `evidence-reasoning.ts` each
   keep a private copy of `fingerprintStrings`'s exact algorithm, despite a
   comment claiming they were already deduplicated (`v2/SPEC/types-util.md` line
   25). A conservative split would likely reproduce this drift risk one-for-one
   (each module still owns its own copy, just now under `core/`). This design
   makes `core/hash.ts` the only place `sha256`/`fingerprintStrings`/`stableHash`/
   `stableStringify` are defined, full stop — every caller imports it, so a
   second copy cannot silently reappear (a lint rule bans re-declaring any of
   those four function names anywhere outside `core/hash.ts`).

## 4. Byte-compat strategy in detail

POLA means the rebuild's INTERNAL structure can be arbitrarily different, but every
byte a user or another program can observe must stay the same. Four kinds of
"observable byte" need distinct strategies:

### 4.1 CLI text (help, errors, usage strings, format functions)

These are copied as **literal string templates**, not re-derived from "cleaner"
logic. `core/registry/help.ts` reproduces `formatHelp()`'s exact structure
(`v2/SPEC/cli-surface.md` lines 234-270): the "Cool Workflow" banner, the fixed
Flags block, the "More commands" line built by joining `declaredCliTokens()`
output and wrapping at 76 columns with a 2-space indent, and the 4-space-indented
final note line that intentionally falls outside the parity help-token parser's
2-space rule. Every literal string in `v2/SPEC/*.md`'s "Exact outputs" sections —
usage strings (the 30+ `Usage: cw.js ...` templates), error message templates
(`Missing <label>.\n  Tip: ...`), the ledger bad-JSON refusal objects, the
`report.md` section headers and fallback lines — gets copied verbatim into the
new source as a template literal with the SAME variable slots, not paraphrased.
Conformance cases in `v2/conformance/cases/*.case.js` assert these byte-for-byte
already; the job here is discipline, not cleverness.

### 4.2 Hashes, digests, and fingerprints

`core/hash.ts` is the single point where this gets right on the first try and
stays right:

| Function | Prefix | Width | Sorts input? | Used for |
|---|---|---|---|---|
| `sha256(bytes)` | `sha256:` | 64 hex | no | chains, digests, `promptDigest`, `resultDigest` |
| `sha256Bytes(bytes)` | none | 64 hex | no | archive file digests ONLY |
| `fingerprintStrings(values)` | `sha256:` | **32 hex** | **yes** (`[...values].sort()`, JS default order) | node snapshot `sourceFingerprint`, state-explosion index freshness |
| `fingerprintRecords(records)` | `sha256:` | 32 hex | yes (maps to `id:status` first) | derived-index fingerprints |
| `stableHash(value)` | `sha256:` | 64 hex | keys sorted recursively | contract-migration proofs |

These five rows are pinned as a table-driven golden test
(`test/core/hash.spec.ts`) with the EXACT worked examples already given in
`v2/SPEC/types-util.md` lines 96-103 (`fingerprintStrings(["a","b"]) ===
"sha256:0473ef2dc0d324ab659d3580c1134e9d"`, etc.) as literal assertions — not
"assert it round-trips," but "assert it equals this exact string," so a refactor
that accidentally changes sort order or hex width fails loudly on day one, not
after a snapshot goes stale in production.

The single most dangerous byte-compat trap in the whole system is right here:
mixing the 32-hex fingerprint family with the 64-hex digest family, or hashing
sorted-vs-unsorted, breaks EVERY freshness check, snapshot id, and replay
determinism check silently (each individually still "works," just diverges from
the old build's bytes). Centralizing to one file with one test table is exactly
the kind of thing worth being aggressive about — the old build already has this
bug in latent form (three duplicate implementations); the new build should make
it structurally impossible to reintroduce.

### 4.3 State file JSON shapes

Every `.cw/` JSON file is `JSON.stringify(value, null, 2) + "\n"`
(`v2/SPEC/state-core.md` line 138) — `shell/fs-atomic.ts`'s `writeJson` is the
ONLY function in the whole tree allowed to call `fs.writeFileSync`/`renameSync`
for a JSON value, and it hard-codes this exact serialization. No other module
reimplements "write JSON to disk." The field lists (`REQUIRED_TOP_LEVEL_KEYS`,
the 13-field node projection, the 16-key `RunPaths`) are copied verbatim from
`v2/SPEC/state-core.md` as literal arrays, and a build-time check (ported from
the old `validate-run-state-schema.js`) diffs them against the actual
`WorkflowRun`/`StateNode`/`RunPaths` TypeScript types so the list can't silently
drift from the type it claims to describe.

Golden-fixture tests replay the exact `state.json` skeletons documented in
`v2/SPEC/orchestrator.md` (the `plan()` output shape) and `v2/SPEC/state-core.md`
(the post-normalization example) as byte-exact assertions, plus the old build's
own `test/fixtures/runs/` corpus (mentioned in `run-fixture-compat-smoke.js`) is
carried forward unmodified as a migration-compat fixture set — old runs must
still normalize to the same bytes under the new build.

### 4.4 Vendor wrapper scripts (`scripts/agents/*`, `scripts/children/*`)

These are **not rewritten at all**. They are zero-dependency, already minimal,
already correctly separate mechanism (wrapper contract: read `input.md`, spawn
one vendor CLI, emit one `{model, usage, result}` JSON line) from policy (which
vendor, which flags). The old build's own scope note says it best: parsing
vendor NDJSON streams lives in the wrapper, core only reads the wrapper's one
report line (`v2/SPEC/scripts-runtime.md` "Rebuild risks" #1). Copying them
byte-identical (not just behavior-identical) sidesteps an entire category of
byte-compat risk — the em-dash-vs-hyphen inconsistency between `claude-p-agent.js`
and the other three wrappers, the exact renderer escape-sequence timing, the
`truncate()` twin that must stay behavior-identical to `term.ts` — none of that
needs re-solving if the files are simply carried forward. The only integration
point the new kernel needs is: resolve `builtin:<name>` to
`node <agentsDir>/<script> {{input}} {{result}}`, same as today
(`core/execution-backend/registry.ts` + `shell/agent-config-io.ts` reproduce
`src/agent-config.ts`'s exact resolution order — flags > env > file > auto-detect).

### 4.5 Exit codes

The ~25 fail-closed exit-1 sites cataloged in `v2/SPEC/cli-surface.md` (lines
439-469) are ported as a literal table: `{ capability: "audit.verify", exitWhen:
(result) => !result.verified }`, one row per site, attached to each
`Capability` descriptor as `cli.exitWhen?: (result) => boolean`. This makes the
"is this fail-closed" question inspectable in one place (`grep exitWhen
registry.ts`) instead of scattered across 12 handler files, and a conformance
case can enumerate every row and assert it fires — closing the very risk the old
spec flags ("merging or cleaning up any one exit condition changes behavior").

## 5. Ordered build sequence — each step independently conformance-testable

This follows the existing `v2/BUILD_ORDER.json` shape (milestones gated by a
`conformance_filter` over `v2/conformance/cases/`), because that harness already
exists, already targets the old build as ground truth, and is the right judge
regardless of which internal module layout wins. This design's own sequencing
differs from the existing plan in ONE structural way: **the registry and its two
dispatchers are built in step 2, immediately after argv parsing, instead of
after the pipeline/execution-backend work.** Under the old plan's milestone 7
("cli-mcp-capability-table"), the CLI and MCP surfaces are hand-wired per
milestone up to that point and only unified at the end — which re-creates the
exact hand-sync risk this design exists to remove. Building the generic
dispatcher FIRST means every later milestone adds capabilities by adding
registry ROWS, never by touching dispatch code — so parity is never something
that can regress mid-build.

1. **Foundations.** `core/hash.ts` (with the golden-example table from section
   4.2), `shell/fs-atomic.ts` (atomic write, lock, safe-name/id). No CLI surface
   yet. Conformance filter: none (too early — these are unit/golden-fixture
   tests only: `test/core/hash.spec.ts`, `test/shell/fs-atomic.spec.ts`).
   Done when: 100% green on those two files' unit tests, wall-clock time of the
   unit loop reported (target: under 2s for this step, see section 6).

2. **Registry + both dispatchers, empty.** `core/registry/types.ts`,
   `core/argv/parse.ts` (byte-exact `parseArgv`), `cli/dispatch.ts`,
   `mcp/dispatch.ts`, `core/registry/help.ts`. The registry has exactly the
   handful of capabilities needed for `version`/`help`/`list` (an empty
   `listWorkflows`). Conformance filter: `version-basic|cli-argv-parsing|
   cli-help-topics|cli-exit-codes`. Done when: parseArgv's flag-value rule
   (a flag never eats another flag), `--`, `--key=value`, short-alias map,
   `formatHelp`/`formatCommandHelp`, and the unknown-command "Did you mean"
   path are byte-identical AND both `cw <verb> --help` (CLI) and an equivalent
   MCP `tools/list` round-trip go through the SAME registry rows. This is the
   step that proves the "one source" claim before any real capability exists —
   if dispatch can't be generic here, the whole thesis is wrong and needs
   revisiting before more is built on top.

3. **State kernel.** `core/state/*` (schema, migrations, state-node, node-
   projection, node-snapshot, state-explosion, contract-migration, schema-
   validate, validation) + `shell/run-store.ts`. Conformance filter:
   `state-json-bytes|state-migration-prove|state-migration-unsupported|
   state-node-snapshot-replay|state-normalize-defaults`. Done when: run-state
   schema, the migration ladder (BFS path-finding, the exact normalization
   defaults), the StateNode transition matrix + double commit gate, node
   snapshot/diff/replay, state-explosion collapse rules, and the 4-proof
   contract-migration prover are byte-identical, including against the old
   build's `test/fixtures/runs/` corpus.

4. **Execution backend.** `core/execution-backend/*`, `shell/exec/*`,
   `shell/agent-config-io.ts`. Copy `scripts/agents/*` and `scripts/children/*`
   byte-identical (section 4.4). Conformance filter:
   `exec-backend-registry|exec-agent-substitution|exec-agent-secret-redaction|
   exec-sandbox-readonly-boundary|exec-doctor-agent-config|exec-agent-config-file|
   exec-agent-probe-and-autodetect|exec-sandbox-profile-fail-closed`. Done
   when: the 7-driver registry, sandbox profile resolution + path-token
   substitution, agent command-line substitution, secret redaction, and the
   probe/doctor surface match the old build exactly, using the SAME
   unmodified wrapper scripts.

5. **Pipeline spine (plan → dispatch → result → verify → commit).**
   `core/pipeline/{contract,runner,dispatch,commit-gate,result-normalize}.ts`,
   `shell/worker-isolation.ts`, `shell/report.ts`. First point where a real
   `cw quickstart`-style run can be planned and driven one step by hand (no
   `drive()` loop yet — that's step 6). Conformance filter:
   `pipeline-question-basic` plus any dispatch/commit-specific cases authored
   here (mirroring the existing plan's milestone 5). Done when: the default
   pipeline contract's 6 stages, the commit gate's ~25 error codes, and
   `report.md`'s exact section headers/fallback lines match byte-for-byte.

6. **Drive loop, sub-workflow, loop() expansion.**
   `core/pipeline/{loop-expansion,drive-decide}.ts`, `shell/drive.ts`. This is
   where `core/pipeline/drive-decide.ts` earns its keep: the entire decision
   tree (task selection, terminal/gate logic, token-budget check, retry/park
   math, cache-key formulas for both default and `--incremental` modes) is one
   pure function tested with zero process spawns; `shell/drive.ts` is a thin
   loop that calls it once per step and performs whatever I/O the returned
   decision names. Conformance filter: `pipeline-question-basic` (drive-
   specific cases added here, matching the existing plan). Done when: a fake
   agent script (per the conformance README's rule 4) drives a real multi-
   phase workflow to completion, matching old-build steps/status/reasons
   exactly, including a forced retry-then-park sequence and a sub-workflow
   fanout.

7. **Trust layer.** `core/trust/*`, `shell/{ledger-io,trust-audit-io}.ts`. Can
   be built in parallel with steps 5-6 since it has few dependencies on the
   pipeline (it mostly reads/verifies what pipeline steps produce). Conformance
   filter: ledger/telemetry/audit/demo cases (`demo-tamper`, ledger-* cases in
   the existing suite). Done when: the ledger digest scheme, telemetry
   attestation's two-arm (5-field/4-field) signature check, trust-audit hash
   chain, and the `cw demo tamper`/`cw demo bundle` three-forgery/two-forgery
   proofs all match byte-for-byte, including the exact tamper/detection text
   lines.

8. **Multi-agent + topology + coordinator + candidate scoring + eval replay.**
   `core/multi-agent/*`. This is the largest remaining single domain (was
   ~5 files, ~4700 lines in the old build: `multi-agent.ts`, `coordinator.ts`,
   `topology.ts`, `multi-agent-trust.ts`, `candidate-scoring.ts`,
   `multi-agent-eval.ts`). Conformance filter: mcp/multi-agent-shaped cases
   plus new topology/candidate-specific cases authored here. Done when: the
   3 official topologies materialize the exact role/group/fanout/fanin ids
   and counts documented, candidate ranking/selection gates match, and eval
   replay/compare/gate are deterministic byte-for-byte across two runs.

9. **Scheduling + registry + reclamation + orphans + clones.**
   `shell/{scheduler-io,run-registry-io,reclamation-io}.ts`,
   `core/state/reclamation` decision half (skeleton/tombstone math). Done
   when: the wall-clock scheduler's jitter/cron math, the run registry's
   lifecycle derivation, `gc`'s eligibility/tombstone-chain/capability-
   downgrade rules, and `orphans`' age/lock-guarded delete all match.

10. **Full capability table.** Fill in the remaining ~150 registry rows this
    design deferred (candidate/audit/collaboration/workbench/feedback view
    capabilities that are thin read-projections over state already built in
    steps 3-9). Because step 2 built the generic dispatcher first, this step
    is PURELY additive data — no dispatch code changes. Conformance filter:
    the full suite. Done when: the full `v2/conformance/` suite is green
    against the new build, and the live payload-identical probe (today's
    `payloadProbePlan()` / `buildPayloadProbePlan`, ported as
    `core/registry/payload-probe.ts`) confirms `--json` bytes equal MCP
    `tools/call` bytes for every capability marked `payloadIdentical`.

11. **Release tooling + vendor manifests.** Port `scripts/release-*`,
    `bump-version.js`, `version-sync-check.js`, `vendor-preflight.js`,
    `coverage-gate.js`, `gen-manifests.js` (now reading `declaredMcpTools()`
    from the same registry used by `mcp/dispatch.ts`), `gen-parity-doc.js`
    (shrinks — most of what it documents is now visible directly in
    `registry.ts`). Done when: a `--cut` dry run produces the same generated
    manifests, the same `docs/cli-mcp-parity.7.md` marker content, and the
    same gate pass/fail verdicts as the old build on the same inputs.

Each step above names its own conformance filter and can be independently
merged and CI-gated — a later step never has to re-verify an earlier step's
bytes because the conformance suite re-runs the FULL accumulated filter set
every time, not just the new one.

## 6. What gets deleted vs kept vs generated

### Deleted (exists in old build, has no equivalent file in v2)

- `src/cli/command-surface.ts`'s hand-written 330-line dispatch switch —
  replaced by `cli/dispatch.ts`'s ~30-line generic interpreter + registry data.
- `src/mcp/tool-call.ts`'s hand-written 196-arm switch — replaced by
  `mcp/dispatch.ts`'s ~20-line generic interpreter.
- `src/mcp/tool-definitions.ts` (1092 lines of hand-written tool schemas) —
  replaced by `mcp/tool-schema.ts` generating each `McpToolDefinition` from its
  capability's declared `properties`.
- The THREE duplicate private `fingerprintStrings`-alike implementations in
  `run-registry.ts`, `observability.ts`, `evidence-reasoning.ts` — one
  `core/hash.ts`, always imported.
- `scripts/parity-check.js`'s cross-artifact diffing logic — shrinks to
  `core/registry/lint.ts`'s single-table schema validation (duplicate ids,
  missing `reason` on `cli-only`/`mcp-only` rows) plus the live payload probe,
  since there is no second hand-written artifact left to diff against.
- Per-handler-family files under `src/cli/handlers/*` (18 files) — folded into
  registry rows pointing at `core`/`shell` entry functions directly; there is
  no more "handler" layer between dispatch and the actual capability function.

### Kept byte-identical (copied forward, not rewritten)

- All of `scripts/agents/*`, `scripts/children/*`, `scripts/source-context.js`
  (section 4.4) — already minimal, already correctly mechanism/policy split.
- `manifest/plugin.manifest.json`'s hand-kept vendor identity/template data.
- Every literal string documented in `v2/SPEC/*.md` "Exact outputs" sections.
- The `test/fixtures/runs/` back-compat corpus.
- `v2/conformance/` itself (the judge, untouched by this proposal).

### Generated (did not exist as generated in the old build, or existed partially)

- The MCP tool list (`tools/list` response) — generated from `REGISTRY` at
  either build time (a `gen:mcp-tools` script, for a static array, matching the
  old build's static `toolDefinitions()` shape) or request time (computed
  once, cached) — implementation detail, but never hand-written per tool.
- `formatHelp()` / `formatCommandHelp()`'s command listings — generated from
  `declaredCliTokens()` over `REGISTRY`, same as today's intent, but now the
  ONLY listing (no separate `KNOWN_COMMANDS` set to keep in sync — the old
  build's own spec flags that `KNOWN_COMMANDS` does NOT include `ledger` even
  though the dispatcher handles it, `v2/SPEC/cli-surface.md` line 511; this
  class of bug is structurally impossible once there is one list).
- Vendor manifest `mcp.json` tool-adjacent sections in `gen-manifests.js`'s
  output (the identity/path sections stay templated from the hand-kept
  manifest, per section 2's "not duplicated logic" note).
- `docs/cli-mcp-parity.7.md`'s marker regions — generated from `REGISTRY`,
  same as today, but shorter, since the "two surfaces" framing collapses to
  "one registry, two thin readers."

## 7. LOC / file-count / build-time target

| Metric | Old build | Target | Reasoning |
|---|---|---|---|
| `src/` (`core/`+`shell/`+`cli/`+`mcp/`+`types/`) file count | 166 | **95-110** | Net effect of: deleting ~30 files of hand-written dispatch/handler/tool-definition glue (section 6); merging ~15 tiny single-export files that only existed to break up a god-file (e.g. `orchestrator/*-operations.ts`'s 12 files collapse into the pipeline/multi-agent groupings above, since the facade-per-domain shape was serving the switch-based dispatch, which no longer exists); keeping `types/` at ~25 files unchanged (no reason to touch a working, already-minimal barrel); the `scripts/` tree is UNCHANGED at ~25 files (copied forward). Net: fewer files than "core+shell only" would get you, because that split alone doesn't touch the dispatch-glue file count at all.
| Total LOC (`v2/src/` + unchanged `scripts/`) | ~46,620 (`src/` only; `scripts/` is separate and mostly untouched either way) | **28,000-32,000** in `v2/src/`, plus the unchanged ~4,000-5,000 in `scripts/` | The reduction is concentrated exactly where codegen removes hand-sync work: `command-surface.ts` (330-line switch) + `tool-call.ts` (196-arm switch) + `tool-definitions.ts` (1092 lines of hand schemas) + 18 handler files total roughly 3,500-4,000 lines replaced by ~400 lines of generic dispatch + registry-row declarations (which themselves are shorter than the old `capability-registry.ts`'s 1032 lines, since a lot of that file's bulk was ALSO hand-maintained cross-referencing that a single source no longer needs). The remaining ~15-20% reduction elsewhere comes from `core/`'s pure functions being naturally shorter than the old mixed pure/impure versions (no defensive fs-error handling scattered through business logic — that moves to `shell/`'s thin adapters, written once per I/O primitive instead of once per call site).
| Build time (`npm run build`, cold) | not given in spec; old build is `tsc` over 166 files | **under 8s cold, under 2s incremental** | Achieved by: (a) fewer files/LOC per above; (b) `core/` has NO imports of `fs`/`child_process`/`crypto`/`net` — enforced by lint, which also means `tsc`'s project-reference boundary between `core/` and `shell/` can be a real TS project reference, so an incremental build only re-checks the changed project, not the whole tree; (c) `types/` staying a pure barrel with zero runtime cost keeps type-checking fast the same way it does today.
| Unit test wall-clock (`core/` + `shell/` unit/golden-fixture suite, NOT `v2/conformance/`) | old build's ~12-minute full suite mixes unit + smoke + conformance-shaped tests in one `test/*-smoke.js` run (`cw-build-and-gate-realities` memory note) | **under 60s** for the `core/`+`shell/` unit layer alone | Because `core/` functions take their impure inputs (clock, env, fs existence) as parameters, testing them needs no process spawn, no tmpdir, no `child_process` — a `core/pipeline/drive-decide.spec.ts` run of the entire retry/park/cache-key decision tree is pure function calls. The old build's ~12-minute number is dominated by smoke tests that spawn real child processes and touch real tmpdirs for behavior that, under this design, is exercised as a pure unit test instead and ONLY re-verified end-to-end by the (separately timed) `v2/conformance/` suite.
| `v2/conformance/` suite wall-clock | n/a (new suite) | unchanged from whatever it already costs against the old build — this proposal does not touch that harness | The conformance suite's cost is a property of spawning real CLI processes per case, not of the internal module layout; this design does not claim to speed it up, only to make sure fewer BUGS surface there in the first place because parity-shaped bugs are caught by the step-2 dispatcher unit tests, long before a conformance case would need to catch them.

**Why THIS lens gets to these numbers and a conservative split would not:** a
conservative "core+shell" split is orthogonal to the file/LOC reduction — it
reorganizes existing logic by purity but keeps the same NUMBER of per-command
artifacts (a CLI handler, an MCP switch arm, a tool-definition entry, a registry
row: four hand-written things per capability today). This design's registry-as-
dispatcher move takes that count from four to one (a registry row) for all ~209
capabilities, and that multiplication — not tighter prose — is where the
file-count and LOC targets actually come from. The risk this trades in return
(named honestly): a single generic dispatcher is a single point of failure for
ALL commands at once, so its own test coverage (step 2 above) has to be
excellent before anything else is built on it — which is exactly why it is
scheduled second, immediately after hashing/fs primitives, not last.
