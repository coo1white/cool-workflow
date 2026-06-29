# Changelog

## 0.1.96

- **Capability**: A faster, safer release with broader test coverage. Vendor agent runs are quicker and easier to debug — `cw -q "..." -codex` drops from ~4 minutes to ~23 seconds, and every failed agent run now leaves its real stderr on disk under `logs/agent-stderr.log`. The `architecture-review` Map and Assess phases now run 6-wide in parallel, so `cw -q` returns in ~2–4 min (down from 7–14 min). 25 audit findings (16 from a planned architecture review + 9 from a self-audit) are fixed across safety, sandbox, backend, and architecture surfaces. CI now runs on Node 18 + 22 and on ARM64 as well as x86_64. `npm test` gains 3 new coverage smokes (158/158 total) and a fast/full/gate test triple.
- **Implementation**: The codex slow path is fixed in `codex-agent.js` by passing `codex exec -c model_reasoning_effort=<effort>` (default `low`, tune with `CW_CODEX_REASONING_EFFORT`) — the user's interactive codex is untouched. A shared `persistStderr()` in `agent-adapter-core.js` writes `<worker>/logs/agent-stderr.log` on every failure exit across all four wrappers (codex / claude-p / opencode / gemini). The audit fixes span `agent-config.ts` (atomic config write), `state.ts` (`assertSafeRunId`, `withFileLock` + post-op theft detection), `evidence-grounding.ts` (`requireResolvableEvidence` default on, `CW_REQUIRE_RESOLVABLE_EVIDENCE=0` opt-out), `worker-isolation.ts` (sandbox audit event), `execution-backend.ts` (shell-injection guard, agent spawn baseline via `buildChildEnv(policy)` + `CW_*` / LLM-provider-key allowlist, `CW_PROBE_CACHE_TTL_MS` probe-cache TTL), `probes.ts` (delegate-script existence check at probe time), `reclamation.ts`, `derive.ts`, `schema-validate.ts`, plus extractions to `state-explosion/size.ts`, `util/fingerprint.ts`, `lifecycle-operations.ts` (deterministic IDs with `CW_DETERMINISTIC_RUN_IDS=1`), `workbench-host.ts` (`CW_WORKBENCH_TOKEN` optional auth), and `node-snapshot.ts`. The `architecture-review` app's Map+Assess workflow runs 6-wide concurrent. `npm-publish.yml` now triggers via `workflow_run` (only after `release-gate` passes) and checks `dist/` freshness before publish; `package-lock.json` is un-gitignored and committed for reproducible installs. `ci.yml` matrices Node 18+22 × x86_64+ARM64. `quickstart-smoke.js` sets `CW_NO_AUTO_AGENT=1` to block auto-detection in CI. A small agent-stub benchmark suite (`scripts/bench/run.sh`, `docs/benchmark.md`) lands alongside. `docs/sandbox-profiles.7.md` documents the execute/network/env advisory under the default node backend. `docs/agent-delegation-drive.7.md` gains an ASCII architecture diagram of the core ↔ `agent` backend ↔ external-wrapper boundary.
- **Tests**: New `collaboration-ops-unit-smoke` (4 wrapper functions), `feedback-ops-unit-smoke` (3 wrapper functions), `mcp-tool-call-coverage-smoke` (40+ switch arms), plus extended smokes across the 25 audit fixes. `web-desktop-workbench-smoke` panel parity bumped 14→17 (metrics + collaboration) with a label-drift gate against `CAPABILITY_REGISTRY`. `util/fingerprint.test.ts` is the first in-source unit test (4 cases). `npm test` (sample 35) ~4 min, `npm run test:full` (sample 55) ~7 min, `npm run test:gate` (158 all) ~15-20 min. **158/158 pass**, coverage ≥ 91% (floor 80%). Each PR went through the dev-loop (plan → build → adversarial review → PR → CI → squash-merge).
- **Risk**: Low. The fixes are additive guards and `--cut`-time gates; the multi-agent red line and the `cw:result` / `--json` machine surfaces are untouched. The codex effort cap and `persistStderr` are scripts-only — no TS-surface change, recorded byte-stable evidence unchanged. The new publish gate is strictly tighter (`release-gate` must pass before `npm-publish` runs), the lockfile commit makes installs reproducible, and the multi-arch CI matrix only adds coverage. Zero new runtime dependencies.

## 0.1.95

- **Capability**: The headline command now has the promised Gemini short flag: `cw -q "..." -gemini` uses the existing `builtin:gemini` agent path. The package also now includes the PDCA blackboard loop app and the official MCP Registry metadata, so a published npm package can be accepted by the Registry.
- **Implementation**: The `-gemini` flag maps to the same `builtin:gemini` wrapper as the long form; no new agent path or runtime dependency was added. `pdca-blackboard-loop` is a normal workflow app that uses the existing worker, verifier, MCP, CLI, and blackboard surfaces. `server.json` and `mcpName` are shipped with the npm package metadata.
- **Tests**: PR #294 ran build, `headline-commands-smoke`, `gemini-opencode-agent-wrapper-smoke`, full `npm test` (153/153), manifest check, and whitespace check. PR #295 ran build, app validation, index/version/parity/manifest checks, and full `npm test` (153/153). The release cut re-runs the deterministic gate and independent reviewer before tagging.
- **Risk**: Low. The CLI shortcut, workflow app, README media, and package metadata are additive; the existing machine output, signing, state format, and public TypeScript API are unchanged. Zero new runtime dependencies.

## 0.1.94

- **Capability**: All four agent vendors — **claude, codex, gemini, and deepseek** — run again. 0.1.93 shipped with only `claude` working: the codex, opencode, and deepseek wrappers were broken against the installed CLIs, and gemini needs the operator's opencode key. `cw -q "…" -codex` (and `-deepseek`, plus `--agent-command builtin:gemini`) now complete a real run instead of parking. A new pre-release gate makes one live call per vendor and **hard-blocks** a `release-flow --cut` if any promised vendor is not live, so a release can no longer ship with a dead vendor.
- **Implementation**: Each wrapper is fixed against the INSTALLED CLI. codex 0.139 dropped `exec --ask-for-approval` (passing it made codex exit 2, so the run parked) — the flag is removed, and the run's model is read from `$CODEX_HOME/config.toml` since codex prints no model in its JSON. opencode 1.17.11 `run` takes the message as a POSITIONAL arg (there is no `--prompt`) and its `--format json` now emits `{type,part}` events (assistant text at `part.text`, usage at `step_finish part.tokens`) — the wrapper passes the prompt positionally, adds an optional `--model`, and the parser reads the new shape (older shapes kept as a fallback). deepseek and gemini route through opencode, where the keys live: thin shims set `--model deepseek/deepseek-chat` / `google/gemini-3.5-flash` over the one opencode runner (override via `CW_DEEPSEEK_MODEL` / `CW_GEMINI_MODEL`); the native Gemini CLI is kept as `builtin:gemini-cli`. `scripts/vendor-preflight.js` runs each builtin wrapper against a throwaway repo and exits non-zero on any missing/unauthed/empty vendor; it is wired into `release-flow.js` as step `[1b/3]`, cut-only, with a `CW_SKIP_VENDOR_PREFLIGHT=1` escape and a `CW_RELEASE_FLOW_PREFLIGHT_CMD` test seam.
- **Tests**: Every `*-agent-wrapper-smoke` shim was re-cut to the REAL CLI output — the old shims took any args and any output shape, which is exactly why the drift shipped unseen. New `deepseek-agent-wrapper-smoke`, `gemini-opencode-agent-wrapper-smoke`, and `vendor-preflight-smoke` (all-green→0, any-fail→1, empty→FAIL, `--vendors` filter, unknown→2); `release-flow-smoke` gains cut-mode cases (check skips the live check; cut hard-blocks BEFORE the reviewer; a green preflight proceeds; the escape hatch overrides). LIVE proof: `vendor-preflight --vendors claude,codex,gemini,deepseek` → **4/4 PASS** (codex `gpt-5.5`, gemini `google/gemini-3.5-flash`, deepseek `deepseek/deepseek-chat`). Full suite green.
- **Risk**: Low. The wrappers are userland config spawned out-of-process; the engine, the `cw:result` schema, signing, and `--json` are untouched (the multi-agent red line holds). The new gate only adds a check before a cut — it cannot weaken one — and carries an operator escape hatch. Zero new runtime dependencies.

## 0.1.93

- **Capability**: Several opt-in, POLA-safe additions:
  - **`cw run restore <archive>`** — restore an exported run on another machine in one fail-closed step. `cw run import` runs the same verification `verify-import` does (file digests + telemetry-ledger + trust-audit hash chains) but exits 0 even when that chain does not verify, so a tampered or corrupt run can be imported with a silent success. `run restore` reuses that verdict and **fails closed** — it integrity-inspects the archive first (refusing a corrupt bundle without writing anything), imports, and exits non-zero with `ok:false` on any run that does not verify, so `cw run restore <archive> && proceed` can never act on an unverified run. Both surfaces (CLI `run restore`, MCP `cw_run_restore`).
  - **Homebrew install** — `brew tap coo1white/cool-workflow https://github.com/coo1white/cool-workflow && brew install coo1white/cool-workflow/cool-workflow`, from an in-repo, git-tag-pinned `Formula/cool-workflow.rb`.
  - **`cw help <command>`** — per-command help (the verb's subcommands + one-line summaries, derived from the capability registry).
  - **`architecture-review-fast --changed-from <ref>`** — an incremental overlay that re-reviews only the files changed since `<ref>`; the Verify + Verdict phases are cached so a re-run reuses every step whose inputs did not change.
- **Implementation**: `run restore` is a thin fail-closed composition in `capability-core.ts` (`runRestoreArchive`) over the existing `inspectArchive` + `importRun` + the verification `importRun` already returns (`ImportResult.verification`) — no new crypto/IO, no second verify pass; the CLI case sets exit 1 on `!ok` (mirroring `inspect-archive`) and the MCP `cw_run_restore` tool routes through the same core (kept in step by the CLI↔MCP parity gate). This release also lands a large **internal restructuring with no behavior change**: the 1,163-line CLI `command-surface.ts` god-dispatch is decomposed into **16 per-family handler modules** under `src/cli/handlers/` (multi-agent, run, collaboration, blackboard, coordinator, eval, node, gc/telemetry/demo, the operational families, candidate, …), each a byte-identical code-move with shared `io.ts` + `format.ts` helpers; and the app-management methods move out of the `CoolWorkflowRunner` facade into `src/orchestrator/app-operations.ts`, completing the documented router pattern — `command-surface.ts` drops from 1,163 to **437 lines**, every public CLI/MCP surface and output byte-exact (parity gate green throughout). Plus spec-debt cleanup: three unread `StateCommit` fields and ten dead exports removed (an orphaned `commitMessageTemplate` was added then reverted, net-zero). The root README + Wiki were redesigned and the hero/pipeline images re-rendered at 2× (crisp on retina); the npm README stays a generated mirror of the GitHub README (`readme:check`).
- **Tests**: `run-restore-failclosed-smoke` (NEW) builds an archive `run import` accepts (file + manifest digests valid) but whose telemetry-ledger hash chain fails verification, and asserts the contrast on the same archive — `run import` exits 0 with `verification.ok:false` while `run restore` exits non-zero with `ok:false` — plus a corrupt-bytes archive refused inspect-first (nothing written) and a happy verified restore; the fail-close is mutation-proven (deleting the exit-1 turns the smoke red). Each carved family kept its behavior under an extended family smoke + the CLI↔MCP parity gate, and the Homebrew / `cw help` / `--changed-from` paths have their own smokes. The decomposition + cleanup shipped as a series of dev-loop PRs (each plan → build → independent adversarial audit → PR → CI → squash-merge). Full suite green.
- **Risk**: Low. Every new surface is opt-in (a new verb/flag); the existing run-archive verbs and the CLI/MCP outputs are byte-identical. The CLI/orchestrator restructuring is a pure code-move proven by the parity gate, the full smoke suite, and per-cycle adversarial audits; no machine surface (`cw:result`, `--json`), signing, or schema red line was touched. Zero new runtime dependencies.

## 0.1.92

- **Capability**: Point CW at **any local folder** — your own docs, notes, or papers — and get the same saved, cited, verifiable report, not only a git code repo. `cw quickstart research-synthesis --repo <folder> --question "…"` reads the local files there as primary sources, and a research run labels its source line `Source:` (a code run still says `Repository:`). The READMEs are repositioned around this — "ask a question about your code, **or any folder of files**" — and the npm package page is now a generated mirror of the GitHub README, so the two can never drift. The calm live view from 0.1.91 also gets a Claude-Code-style polish: a rolling window of `● ToolName(arg)` lines, each with a dim `⎿` result summary, where older steps fold away instead of piling into a wall.
- **Implementation**: The corpus capability is userland-only — the `research-synthesis` app's Investigate step now reads the working directory; the engine, source resolution (git is optional), app selection, and the evidence-grounding gate already took any folder and file-path citations, so no kernel change was needed. The `Source:`/`Repository:` label is gated on the app's `metadata.domain` and is skipped when a remote-provenance `- Source: <url>` line is already present, so a report never shows two `- Source:` lines (POLA: every code app is byte-identical). `scripts/sync-readme.js` generates `plugins/cool-workflow/README.md` from the root `README.md` — changing only the relative image/link URLs npm cannot render — behind a `readme:check` drift gate; the npm README is dropped from the version-pin surfaces, since like the GitHub page it shows the version through the live npm/release badges, not a hand-kept literal. The live view stays presentation-only in the shared wrapper renderer (a rolling region redrawn with an erase-block; `●`/`✶`/`⎿` glyphs); stdout and `--json` stay byte-exact.
- **Tests**: `quickstart-corpus-smoke` (NEW) drives the advertised CLI command from a foreign cwd against a non-git corpus and asserts the run roots at the folder and the report cites a local file under `Source:`; `readme-sync-smoke` (NEW) proves `sync-readme --check` passes, the npm README is all-absolute-URL, drift fails closed, and sync is idempotent; `headline-commands-smoke` §8 (NEW) locks `-d`/`-dir`/`--dir` == `--repo` at the on-disk run layer; `cli-render-smoke` covers the rolling-window fold, the `⎿` result rows, and cursor hygiene. Full suite 139/139; each change shipped through the dev-loop (PR → CI → squash-merge) with an adversarial multi-agent review.
- **Risk**: Low. The corpus path is opt-in (`--app research-synthesis`); `cw -q` keeps the `architecture-review` default; the `Source:` label is guarded so every code app stays byte-identical. The README/positioning change is presentation-only, and the npm page is byte-identical to GitHub except the absolutized URLs. The live view is presentation-only and TTY-gated. Machine surfaces (`cw:result`, `--json`) and the signing/schema red lines are untouched. Zero new runtime dependencies.

## 0.1.91

- **Capability**: A calm, Claude-Code-style live view for agent runs. `cw -q "…"` now shows a single in-place status line (Braille spinner + current action + elapsed) with each tool call folding to one `✓ Read app.js (0.3s)` / `✗ Bash (1.1s)` line, instead of an append-only wall of text. The cursor is hidden while the spinner runs and **always** restored on exit/Ctrl-C (clean terminal, exit 130). At the end you get a **compact findings table** (id / severity / classification + counts) plus the report path and the run dir. Default is compact (reasoning hidden); `--verbose` surfaces the full narration, `--full` also prints the report inline, and `--no-color` (with `NO_COLOR`/`FORCE_COLOR`) controls ANSI. The complete narration + tool I/O is **always** written to a per-worker `transcript.md` regardless of verbosity, and piped/CI runs stay silent and byte-clean by default.
- **Implementation**: Presentation-layer only — the orchestration model, the ed25519 signing/tamper-evidence, and the `cw:result` schema are untouched; the machine payloads on stdout (the `cw:result` fence + `--json`) carry no styling and stay byte-exact under any color env. Two layers: the async per-vendor wrapper (which already parses `--output-format stream-json`; cw is blocked in `spawnSync` mid-agent so it cannot animate) renders the live region via a hand-rolled, zero-dep renderer in the shared `agent-adapter-core.js` (`createRenderer` — spinner, folding tool lines, cursor hygiene, transcript); cw renders the calm orchestration between agents plus the end-of-run summary via a small `reporter.ts` interface (`collectRunFindings` re-parses each worker's `cw:result`). New flags set env (`CW_VERBOSE`/`CW_NO_COLOR`/`CW_OUTPUT`) consumed by the out-of-process wrapper. Zero new runtime dependencies (`dependencies: {}` unchanged): every primitive (spinner / ANSI live-region / color-env / width-aware truncate / findings table) is hand-rolled in `term.ts` and mirrored in the plain-JS wrapper core.
- **Tests**: `cli-render-smoke` (NEW) — reporter TTY-render vs non-TTY-silence, `--full` inline, blocked→`cw doctor`, truncate/visible-width, color-env (`NO_COLOR`/`CW_NO_COLOR`/`FORCE_COLOR`), cursor hygiene, core↔term `truncate` parity, and the `--json` machine channel staying byte-exact under `FORCE_COLOR`; the four `*-agent-wrapper-smoke`s gain transcript-on-disk (even when the screen is silent), the `CW_AGENT_STREAM=1` plain trace (zero ANSI), and the compact-vs-`CW_VERBOSE` narration contrast; `cli-progress-summary-smoke` §2 stays the byte-clean stdout guard. A 15-agent adversarial review (each finding double-verified) gated the merge: ship-safe, no P0/P1; the two P2s it found (a `truncate` drift between the two copies; the `FORCE_COLOR` stdout contract) were fixed and locked.
- **Risk**: Low. Presentation-only and additive — the default piped/non-TTY path stays silent and byte-identical, the machine surfaces are unchanged, and the orchestration/signing/schema red lines were not touched. The live view renders only on a TTY (or opt-in `CW_AGENT_STREAM=1`), and the cursor is restored on every exit path.

## 0.1.90

- **Capability**: Review **any repository by URL**, and a Homebrew-grade golden path. `cw -q "what are the risks?" --link https://github.com/owner/repo` clones the remote (any git host — GitHub/GitLab/Bitbucket/self-hosted/`ssh://`/`file://`) **or downloads an archive** (`.tar.gz`/`.tgz`/`.tar`/`.zip`, e.g. a GitHub "Download ZIP"), then runs the existing review on the local checkout; a URL passed to `-dir`/`--repo` is auto-detected. The report records where the code came from — `Source: <url>@<commit>` plus a tamper-evident `source.clone`/`source.download` trust-audit event you can re-prove with `cw audit verify`. `cw clones list`/`gc` manage the content-addressed cache. Plus the golden-path polish: a `-dir`/`-d` flag to review a local folder from anywhere, live `==> Phase ✓` progress, a clean `✓ Report:` / `Next:` summary, and brew-style `Try: …` recoverable errors.
- **Implementation**: Cloning is non-deterministic network I/O, so it lives in the capability layer (`capability-core.ts` `quickstart`), above the cwd-default and before `plan` — the replay-deterministic core only ever sees a local path. New zero-dep `remote-source.ts` shells out to `git`/`tar`/`unzip` and Node's built-in `fetch` (no npm libs); `clones.ts` is the cache manager. Fail closed throughout: a scheme allowlist (rejects `ext::`/`fd::` helpers + `-`-leading option-injection), credentials stripped before any cache-key/print/persist/provenance (and git's own output credential-redacted), `GIT_TERMINAL_PROMPT=0` (never hangs on auth), repo hooks disabled. Archive extraction validates the listing for `..`/absolute traversal before extracting, **rejects symlink/non-regular entries** (`lstat` tree walk), bounds the **decompression bomb** by declared and actual size, and follows http(s) redirects **manually with per-hop scheme + private-host validation** (no SSRF). `cw clones gc` deletes only paths proven inside the cache, and a TTL sweep never reclaims an entry it cannot date.
- **Tests**: `remote-link-git-smoke`, `remote-link-archive-smoke`, `clones-gc-smoke` (all NEW, hermetic + offline via local bare repos / `file://` archives + a stub agent), plus `cli-progress-summary-smoke`, `cli-recoverable-errors-smoke`, `cli-arg-parsing-smoke` for the golden path. Each forged-attack case (credential leak, `../` traversal, symlink escape, zip bomb, SSRF redirect, out-of-cache delete) is asserted to fail closed. Four independent adversarial security-review fleets gated the merge.
- **Risk**: Low–moderate, scoped to a new opt-in surface. The feature is additive (no `--link` → byte-identical to a local review); the orchestration engine and delegation contract are unchanged; every materialization path fails closed and was adversarially reviewed before merge. The clone cache is the one new durable side effect, managed and reclaimable via `cw clones`.

## 0.1.89

- **Capability**: The headline command works again, and works from anywhere — like `brew`. `cw -q "your question"` now asks the question instead of failing `Workflow app not found`, it auto-detects the current directory as the repo (no `--repo`, no `cd` into a special path), and `cw help` renders clean (wrapped command list, proper newline) so it never merges with your shell prompt.
- **Implementation**: Three CLI-surface fixes. `cli/command-surface.ts` consumes the `-q`/`--question` positional (it was copied into the question but left as `positionals[0]`, so the quickstart handler read it as the app id). `capability-core.ts` `quickstart()` defaults `repo` to `invocationCwd()` before the real run (the `--check` preflight already did; the live run did not, so it demanded `--repo`). `orchestrator.ts` `formatHelp` wraps the command list to <=76 cols (was one 415-char line), the help write sites add a trailing newline, and help/error color keys off the stream actually written to (`cli.ts`).
- **Tests**: `headline-commands-smoke.js` (NEW) runs the DOCUMENTED commands a user types — `cw -q "…"`, the vendor flags, `demo`/`doctor`/`help`/`fix` — and asserts routing, repo auto-detect, and no ANSI escapes in piped stdout (the gap that let 0.1.88's regressions ship: the old smokes only called the internal `quickstart()` API). `npm-global-install-smoke.js` (NEW) packs the package, `npm install -g`s it into a temp prefix, and runs `cw` from an unrelated directory — the install-once-use-anywhere proof. Both are vendor-agnostic (a stub agent, never a live model). Full suite green incl. the 2 new smokes.
- **Risk**: Low. CLI/UX-surface only; the orchestration engine and the delegation contract are unchanged. The new smokes make "the documented CLI a user types, as installed, renders correctly" a gated, fail-closed property, so this class of regression can no longer ship invisibly.

## 0.1.88

- **Capability**: Inline sub-workflow nesting — a workflow task can be fulfilled by an entire child app run instead of a single agent, via `subWorkflow(id, appId, { inputs?, bindResult? })`. The drive plans and drives the child, then binds its report (or verdict result) back as the parent task's result, so the parent's verifier/schema/evidence gate consumes it like any other result and large flows compose from smaller verified ones.
- **Implementation**: New `subWorkflow()` author fn (`workflow-api.ts`) over `task()`; additive `WorkflowSubWorkflowDefinition` on the task type and `subRunId`/`subRunDir` on `RunTask`. `drive.ts` gains a `runSubWorkflow()` branch (after the cache-miss check, before `runBackend`) that plans a child with a deterministic id `sub-<parentRunId>-<taskId>` (`plan()` now honors an injected `runId`, stripped from inputs so digests stay clean), drives it inheriting `now`/agent config/policy/incremental, then accepts the child bytes through the existing `recordWorkerOutput`. Honesty: the parent records ONE `worker.sub-workflow` trust-audit cross-link (child run id + sha256(child bytes) + child `verifyTrustAudit` verdict) and never sums child telemetry. Fail-closed: `MAX_SUB_WORKFLOW_DEPTH = 4` plus a `visitedAppIds` cycle guard (includes the current app, so A→A is refused at depth 0 before any child dir is minted).
- **Tests**: `sub-workflow-nesting-smoke.js` — parent→child accept, downstream consumes it, both audit chains verify, byte-identical replay under two `now`, and a self-cycle and an over-deep chain each park fail-closed with no `sub/` dir.
- **Risk**: Low. Additive/optional fields (POLA); recursion bounded by the depth cap + cycle guard checked before any child state is minted; the child binds through the same accept/gate path; no model SDK is imported at any depth.

- **Capability**: Bounded dynamic `loop()` phases — a workflow can adapt at runtime. `loop(name, tasks, { maxRounds, until: { kind: "predicate", ref } })` is a per-round template: after each round a named, registered pure predicate decides whether to append another round (the same tasks under `@r{n}` ids) or stop, hard-capped at `maxRounds`. Ships built-in predicates `no-new-findings` and `single-round`.
- **Implementation**: New `loop()` author fn (`workflow-api.ts`); additive `WorkflowLoopSpec`, `RunPhase.loop/loopOrigin/loopRound/loopDone`, `RunTask.loopRound`, and a `"loop-control"` `StateNodeKind`. New `loop-expansion.ts`: a named-predicate registry (`registerLoopPredicate`/`getLoopPredicate`) and `maxLoopExpansion(run) = Σ(maxRounds-1)·templateTasks` derived STATICALLY from the declaration. `maybeExpandLoop()` hooks `recordWorkerOutput` (after `updatePhaseStatuses`, before `commitState`): when a round completes it gathers results in `compareBytes` id order, evaluates the predicate, RECORDS the decision as a deterministic `loop-control` state node (the replay source of truth), then marks the loop done or clones the round-1 template into a new appended phase. `drive.ts` `maxIterations` adds `maxLoopExpansion(run0)`, so the drive provably terminates.
- **Tests**: `loop-bounded-expansion-smoke.js` — a stop-at-round-3 predicate runs exactly 3 rounds (not `maxRounds` 5); a never-done predicate stops at the cap; byte-identical replay and an identical recorded decision sequence under two `now`.
- **Risk**: Low. All new fields optional and `maybeExpandLoop` no-ops without a loop phase (POLA reduces to today's bound); the predicate is a serializable registry ref (no inline closures); the decision is a pure function of recorded results; an unregistered predicate and shape errors both fail closed; the iteration bound is static, so termination is provable.

- **Capability**: Budget-aware loop scaling — a `loop()` can scale on a token target instead of a predicate: `until: { kind: "budget-target", target }` keeps spawning rounds while recorded (attested-only) usage stays under `target`. The fail-closed `limits.tokenBudget` cap remains the absolute backstop — whichever fires first wins, and the cap can never be overshot.
- **Implementation**: A built-in registered `budget-target` predicate reading `deriveUsageTotals(run)` — the SAME recorded usage total the cost cap reads — and the loop's `until` field widened to a `LoopUntil` union (`{kind:"predicate"} | {kind:"budget-target"}`). It layers on the loop engine above with no new control path, and composes with attested telemetry (an unattested hop counts 0 toward the target).
- **Tests**: `budget-scaling-loop-smoke.js` — target 18 at 6 tokens/hop yields exactly 3 rounds; with `limits.tokenBudget: 12` ALSO set, the cap fires first and the run blocks after 2 rounds, proving the cap stays the absolute backstop.
- **Risk**: Low. Reads only recorded usage; the fail-closed cap is unchanged and remains the backstop; additive `until` variant.

- **Capability**: Step-level incremental resume — `cw run <app> --drive --incremental` re-runs a workflow and reuses the cached result of every task whose inputs are unchanged: the longest unchanged prefix replays with zero agent spawns, and only the first changed task plus everything downstream of it run live.
- **Implementation**: Generalizes the opt-in content-addressed result cache into a run-level mode. `DriveOptions.incremental` keys EVERY task by {rendered prompt digest + full `run.inputs` digest + per-task delegation digest + upstream RESULT-byte digests} under `schemaVersion: 2` (never collides with the opt-in `schemaVersion: 1` cache). `incrementalDelegationDigest()` folds the result-determining operator config — resolved model, agentType, sandbox profile id, and agent identity (command / stripped args / endpoint) — so swapping model/agent/endpoint invalidates the key and never serves a stale result or attests the wrong producer. `previousPhaseResultsDigest()` returns undefined until every upstream task is completed (it never keys on partial state). `incremental` is in `DRIVE_RUNTIME_KEYS`, so it never poisons `run.inputs`. Reuse rides the existing cache-hit accept path (no fabricated usage).
- **Tests**: `incremental-resume-smoke.js` — reuse + byte-identical state; a non-incremental re-run stays byte-identical (POLA); downstream invalidation; model-swap and agent-identity-swap each invalidate the key; concurrent driver.
- **Risk**: Low. Opt-in flag; the default drive is byte-identical (POLA); reuse rides the already-reviewed cache-hit accept path; adversarial review closed the false-reuse vectors (delegation config + agent identity).

- **Capability**: The trust story is now a real forward guarantee. The agent executor signs its RESULT (findings), not just its token usage, and `cw report verify-bundle` proves OFFLINE — with only the public key — that every signed finding is present in the report and unaltered. Editing a finding in the report, editing it in the agent's result, editing both consistently, or dropping the task all fail the check. A new `--require-signatures` flag makes the verifier fail (`ok: false`) on an unsigned bundle, closing the prior fail-open. CW still holds no private key — the agent signs, CW only verifies.
- **Implementation**: `TelemetryAttestationRecord` gains a `resultDigest` that hash-binds `sha256(result.md)` into the ed25519-signed, hash-chained telemetry ledger, so the re-verifier reconstructs the exact signed payload offline. `report verify-bundle` adds verdict fields `trustLevel` ("signed"/"unsigned") and `reportFindingsVerified` plus the `--require-signatures` gate (`signatures-required` failure on zero signatures), exposed on both the CLI and the `cw_report_verify_bundle` MCP tool. `cw demo tamper` gains a third RESULT layer that signs a result-covering payload, edits the signed finding, and shows the verify reject it — so the README claim is demonstrable, not asserted.
- **Tests**: result-signing and bundle forward-guarantee smokes (signed finding present/unaltered; each of the four tamper variants rejected; `--require-signatures` closes the fail-open); `cw demo tamper` exercises the result layer end to end.
- **Risk**: Low. Honest carve-outs are documented: the guarantee does NOT prove the report holds nothing else, and does NOT prove no signed finding was left out (a re-chainer can drop one). CW never holds a private key.

- **Capability**: CLI simplified to a 6-command surface with live streaming by default. Ask and get a report in one step with `cw -q "..."`, pick a vendor with a single shorthand flag (`-claude`, `-codex`, `-deepseek`), and use top-level `cw version`, `cw update`, and `cw fix`; `cw doctor` leads newcomers through a 3-step quickstart. Agent stderr and drive progress now stream by default on an interactive terminal — operators watch a multi-minute run with no env var — while CI and pipes stay silent (stdout stays clean JSON).
- **Implementation**: Vendor shorthands map in `cli/command-surface.ts` (`-claude`/`-codex`/`-deepseek` → `--agent-command builtin:<vendor>`); streaming is TTY-gated and forced off with `CW_AGENT_STREAM=0` or `CW_NO_STREAM=1`. The onramp gains a "No Agent?" section with install guidance and a `cw demo bundle` first-run step.
- **Tests**: CLI + streaming smokes and the CLI↔MCP parity smoke (every declared capability resolves on both surfaces).
- **Risk**: Low. Streaming is TTY-gated (pipes get clean data); `--json` output is byte-identical.

- **Capability**: Security — importing or verifying an untrusted run archive can no longer escape the runs directory. A crafted bundle whose `run.id` is a path-traversal string (e.g. `../../../escape`) is refused fail-closed before any directory is created, and `cw report verify-bundle` (which restores into a throwaway tmpdir) correctly reports `ok: false` instead of writing outside the tmpdir while returning `ok: true`.
- **Implementation**: Run-id validation rejects `..`, absolute, and separator-bearing ids at import/restore intake, before any run dir is minted. Run resolution and the run-state schema are otherwise unchanged.
- **Tests**: a path-traversal refusal smoke (a crafted id is refused before any write; `verify-bundle` returns `ok: false`).
- **Risk**: Low. Pure tightening; well-formed ids are unaffected.

- **Capability**: Proven backends and cross-machine trust. The `ci` (HTTP delegation) and `agent` execution backends now have proven success paths plus fail-closed refusal coverage, and a run exported as a `.cwrun.json` archive on one machine (one `CW_HOME`) is shown to import and fully verify on a separate machine (different `CW_HOME`/cwd) — path rebasing, `loadRun` equivalence, both hash chains, import-manifest integrity, the `verify-import`/`inspect-archive` CLIs, and tamper detection on restore all hold across the boundary.
- **Implementation**: Success-path and readiness-transition coverage for the CI/agent backends; a cross-machine export/restore proof harness with a second `CW_HOME`.
- **Tests**: CI/agent backend success-path smokes; a cross-machine export/restore proof smoke.
- **Risk**: Low. Test/coverage additions; no kernel change.

- **Capability**: A faster, sturdier test loop. `npm test` gains `--filter <regex>` / `CW_TEST_FILTER` (run only matching smokes), `CW_TEST_TIMEOUT_MS` (default 120s; SIGTERM then SIGKILL a hung smoke), `--retry <n>` / `CW_TEST_RETRY` (re-run a failed smoke in a fresh sandbox), `--bail` / `CW_TEST_BAIL`, and a `// CW_SKIP: <reason>` header convention; failure reports now separate stdout from stderr. The TypeScript build is incremental (clean ~12s, rebuild ~0.7s), and `coverage-gate.js --sample <n>` runs a deterministic, reproducible subset.
- **Implementation**: Test-runner flags/env in `test/run-all.js`; `--sample` now selects a stable subset for a given file set (it was a per-run random shuffle); incremental `tsc`; a `// @cw-smoke` metadata convention; coverage-gate pre-checks that `dist/` is built (via `spawnSync`).
- **Tests**: runner self-tests for filter/timeout/retry/bail/skip and deterministic `--sample`.
- **Risk**: Low. Dev-tooling only; the authoritative release tag-gate still runs the full suite sequentially (`CW_TEST_CONCURRENCY=1`).

- **Capability**: CW can fully self-iterate with only `CW_AGENT_COMMAND` set. The release-flow reviewer accepts a verdict printed to the agent's stdout (`APPROVED <sha>` / `REJECTED` lines), so the reviewer agent no longer needs file-write permission. A verdict file, if written, still takes precedence (backward compatible); a missing or garbled verdict fails closed.
- **Implementation**: `release-flow.js` parses the reviewer verdict from captured stdout, falling back to the verdict file.
- **Tests**: a release-flow smoke (stdout verdict captured; file precedence; missing/garbled fails closed).
- **Risk**: Low. Backward compatible (the file wins when present); fails closed on ambiguity.

- **Capability**: Internal hot-path and contract fixes. `appendRunNode` now mutates `run.nodes` in place (O(1) per append instead of O(N²) churn on long runs) with byte-identical persisted state; the `claude -p` wrapper now sends agents the exact canonical result-contract instruction text the Codex wrapper uses; the new `loop-control` node flows through per-node snapshot/diff/replay unchanged.
- **Implementation**: In-place append in `state-node.ts`; shared result-contract text in the Claude wrapper; `"loop-control"` added to the snapshot/diff/replay kind set.
- **Tests**: existing state-node, snapshot/replay, and agent-wrapper smokes stay green (persisted bytes and replay digests unchanged).
- **Risk**: Low. No observable behavior or persisted-state change.

- **Docs**: User-facing README + wiki refresh (mise-style animated visuals; honest trust and incremental-resume story) and a deep-wiki accuracy sweep — corrected the capability counts to 199 capabilities / 186 MCP tools, replaced a documented-but-nonexistent runtime capability-dispatch API with the real declarative `BUILTIN_CAPABILITIES` table, and added the four new orchestration capabilities to the relevant deep pages.

## 0.1.87

- **Capability**: `npm test` now runs in parallel by default (cores-capped `--concurrency auto`), giving users ~2-3x faster local test runs. The release tag-gate stays sequential via `CW_TEST_CONCURRENCY=1` for deterministic results.
- **Implementation**: Changed `test/run-all.js` `resolveConcurrency()` default from `1` to `auto`. The `release-gate.sh` line 33 now passes `CW_TEST_CONCURRENCY=1` to force sequential execution for the authoritative gate. Updated `release-check.js` comments. Added `concurrency-default-smoke.js` to verify default parallelism, gate sequential mode, and flag-override precedence.
- **Tests**: Added `concurrency-default-smoke.js` (113 smokes total). Full suite: 113/113 passed, 0 failed.
- **Risk**: Low. Test sandbox isolation (private cwd/HOME/state per child) already prevents concurrency races. The gate path explicitly overrides the default, so tag behavior is unchanged.

- **Capability**: Gemini and OpenCode now have builtin agent wrappers (`builtin:gemini`, `builtin:opencode`), joining Claude and Codex. All four vendors are usable as agent delegation backends via `CW_AGENT_COMMAND=builtin:<name>` or `--agent-command builtin:<name>`.
- **Implementation**: Added `scripts/agents/gemini-agent.js` (streams `gemini -p --output-format stream-json --approval-mode plan`) and `scripts/agents/opencode-agent.js` (streams `opencode run --format json`). Both reuse `agent-adapter-core.js` for prompt building, JSONL parsing, result writing, and report emission. Added entries to `builtin-templates.json`.
- **Tests**: Added `gemini-agent-wrapper-smoke.js` and `opencode-agent-wrapper-smoke.js` (PATH shim tests covering normal path, streaming, crash, garbage output, and builtin alias resolution). Full suite: 115/115 passed, 0 failed.
- **Risk**: Low. Wrappers are additive config — no kernel changes. OpenCode uses `--dangerously-skip-permissions` since no native `--read-only` flag exists; CW's sandbox layer enforces write safety.

- **Capability**: Homebrew-style CLI polish — colored output (TTY-gated ANSI), "did you mean?" typo suggestions, categorized help text grouped by task domain, and contextual next-step hints in error messages.
- **Implementation**: Added `src/term.ts` (zero-dependency ANSI styling: green ✓, yellow !, red ✗, bold, dim). Wired into `cw doctor`, CLI error handler, and `formatHelp()`. Rewrote `formatHelp()` into 8 categorized sections (Getting Started, Run Management, Inspection, Audit, Multi-Agent, Registry, Developer, Common Flags). Added `suggestCommand()` with Levenshtein distance for "did you mean?" on unknown commands. Updated `required()` and init/plan error messages with concrete tips instead of generic "run cw.js help".
- **Tests**: Updated `cli-mcp-parity-smoke.js` and `scripts/parity-check.js` help-token parsers for the new categorized format. Full suite: 115/115 passed, 0 failed. Parity check: clean.
- **Risk**: Low. All styling is TTY-gated (pipes get plain text). `--json` output is byte-identical. Help text format change is additive — old scripts that parsed text may need updating (parity-check.js and parity smoke updated in this cycle).

- **Capability**: `cw info <app-id>` shows what a workflow app does — title, description, version, author, required inputs, sandbox profiles, phases, and a runnable `cw quickstart` example. `cw status --brief` shows a compact summary instead of the full multi-panel dump.
- **Implementation**: Added `cw info` CLI command wired to `showApp()`, with `formatInfo()` rendering. Added `--brief` flag to `cw status` / `cw operator status`, using new `formatOperatorSummary()` (one line per run/phase + next action). Collapsed `formatOperatorStatus()` to reuse the summary as its header. Added `info` capability registry entry. Added `dim` styling to `term.ts`.
- **Tests**: Updated `operator-ux-smoke.js` assertions for the combined Phase|Stage|Blocked line. Full suite: 115/115 passed, 0 failed.
- **Risk**: Low. `cw info` is additive. `cw status` output format changed slightly (combined header line), but full panels are byte-identical via `--verbose` (default).

- **Capability**: Post-success summary line on `cw quickstart`/`cw run drive` (TTY-gated, shows report path + next command). Agent execution progress indicator (elapsed time). `cw doctor --fix` consolidated fix commands. `cw search <keyword>` and `cw man <topic>` for workflow discovery and documentation browsing.
- **Implementation**: Added `printSuccessSummary()` to `term.ts` (writes report path + next-steps to stderr). Added timing around `spawnSync` in `execution-backend.ts` (TTY-gated `● Running ...` / `✓ Done (ms)`). Added `formatDoctorFixes()`. Added `formatSearchResults()` and `cw man` page loader. Updated help text, KNOWN_COMMANDS, and capability registry.
- **Tests**: Full suite: 115/115 passed, 0 failed.
- **Risk**: Low. All new output is TTY-gated (pipes get silent). `--json` surfaces unchanged.

## Unreleased

- **Capability**: **budget-aware scaling** — turn the fail-closed token-budget cap into adaptive depth. A `loop()` phase can stop on a token target instead of a predicate: `loop("Scale", tasks, { maxRounds, until: { kind: "budget-target", target } })` keeps spawning rounds while recorded usage stays under `target`, hard-capped at `maxRounds`. It composes with the existing `limits.tokenBudget` cap, which the drive enforces before each spawn and which stays the **absolute backstop** — whichever fires first wins, and the cap can never be overshot. Pure reuse of the loop engine: the round decision reads `deriveUsageTotals` (the same recorded usage the cap uses), so it stays deterministic and attested-usage-only semantics compose exactly as they do for the cap.
- **Tests**: new `budget-scaling-loop-smoke` — target 18 at 6 tokens/hop runs exactly 3 rounds (then completes); adding `limits.tokenBudget:12` makes the cap fire first (the run blocks after 2 rounds). Fails-before/passes-after confirmed.
- **Risk**: Low. Additive union arm on an opt-in feature; the cap path is unchanged (it remains the backstop); no runtime dependency added.

- **Capability**: **bounded dynamic control flow** — a workflow can loop and adapt at runtime while staying replay-deterministic. Author a `loop(name, tasks, { maxRounds, until })` phase whose tasks are a per-round template; after each round completes, a registered pure predicate decides whether to run another round (a fresh phase appended with the same tasks under round-suffixed ids) or stop, hard-capped at `maxRounds`. This is the missing piece for convergence loops (keep going until the agent reports nothing new) without unbounded recursion.
- **Implementation**: `maybeExpandLoop` (orchestrator) hooks the result-accept path; it records each round-boundary decision as a deterministic `loop-control` state node (the replay source of truth), then either marks the loop done or clones the template tasks into a new phase materialized exactly like `plan()`. Predicates are **named registry refs**, not inline closures (closures can't serialize or re-evaluate byte-identically on replay); an unregistered predicate stops the loop fail-closed. The drive's iteration bound adds a worst-case expansion derived **statically from the declaration** (`Σ (maxRounds-1)×templateTasks`), so the drive provably terminates and the bound is replay-stable. `loop-expansion.ts` ships the registry + the `no-new-findings` / `single-round` built-ins.
- **Tests**: new `loop-bounded-expansion-smoke` — a stop-at-round-3 predicate runs exactly 3 rounds (not the maxRounds of 5), a never-done predicate stops at the cap, a result node replays byte-identically under two `now`, and two runs under different `now` produce the identical recorded decision sequence. Fails-before/passes-after confirmed.
- **Risk**: Low. All new fields optional/additive (workflows without a loop phase plan + replay byte-identically); the expander no-ops without a loop; recursion is bounded by `maxRounds` and the static iteration bound; no runtime dependency added.

- **Capability**: inline **sub-workflow nesting** — a workflow task can be fulfilled by an entire child app run instead of a single agent, so big flows compose from smaller verified ones. Author it with `subWorkflow(id, appId, { inputs?, bindResult? })`; the drive plans + drives the child, then binds the child's report (or its verdict result) back as the task's result, so the parent's verifier/schema/evidence gate and downstream tasks consume it like any other result. Leaf work is still external-agent delegation at every nesting level — CW imports no model SDK at any depth.
- **Implementation**: a new fulfillment branch in `processSelectedTask` (`drive.ts`) plans a child with a deterministic id `sub-<parentRunId>-<taskId>` (`plan()` honors an injected `runId`, stripped from `run.inputs`) and recursively drives it. Honesty: the parent records **one** `worker.sub-workflow` trust-audit cross-link (child run id + `sha256(child bytes)` + the child's own `verifyTrustAudit` verdict) and points the task at the child run dir (`subRunId`/`subRunDir`) — it never sums or fabricates the child's telemetry. Fail-closed bounded recursion: `MAX_SUB_WORKFLOW_DEPTH` + a `visitedAppIds` cycle guard refuse before any child state is minted; a child that does not complete parks the parent hop.
- **Tests**: new `sub-workflow-nesting-smoke` — a parent delegates to a child (`handleKind:"sub-workflow"`), a downstream task consumes it, both audit chains verify, the result node replays byte-identically under two `now`, and a self-cycle + an over-deep chain each park fail-closed. Fails-before/passes-after confirmed.
- **Risk**: Low. All new fields optional/additive (apps without `subWorkflow` plan + replay byte-identically); the branch only runs for sub-workflow tasks; recursion is bounded + cycle-guarded; no runtime dependency added.

- **Docs**: README + wiki refresh for new users, with dynamic (animated, self-contained) SVG visuals in a clean, light style. New `docs/assets/cw-hero.svg` (the marquee — `cw demo tamper` catching three forgeries offline), `pipeline.svg` (ask → plan → dispatch/fan-out → verify → commit → cited report), and `topologies.svg` (map-reduce / debate / judge-panel). The README leads with the verifiable-report differentiator and surfaces multi-agent topologies, the MCP/IDE surface, and `--incremental`. The GitHub wiki's user-facing pages were brought current: the tamper demo is now described as **three** layers (ledger + signature + result, was "two"), and `cw report verify-bundle`, `--bundle`, and `--incremental` are documented across Quickstart / Commands / Trust-And-Audit / Telemetry / Home. All trust wording keeps the honest forward-only scope (signed findings present and unaltered; not report-exhaustiveness; CW holds no private key). The SVGs degrade to a complete static diagram if a renderer strips animation.

- **Capability**: `cw run --drive --incremental` — automatic step-level incremental resume. Re-running a workflow reuses the cached result of every task whose inputs are unchanged, so the **longest unchanged prefix replays instantly (zero agent spawns)** and only the first changed task and everything downstream of it run live. It generalizes CW's existing opt-in content-addressed result cache into a run-level mode that keys each task by `{rendered prompt + full run.inputs + upstream result digests}`. Keying on upstream **result** bytes (not just prompts) is what makes it correct: a CW prompt is rendered from `run.inputs` and does not carry an upstream task's result, so a changed or nondeterministic upstream result correctly invalidates everything downstream.
- **Implementation**: `resultCachePath` (`drive.ts`) gains an incremental branch (`schemaVersion:2`, so it never collides with the opt-in `schemaVersion:1` cache); a shared `previousPhaseResultsDigest` digests the result bytes of all strictly-earlier-phase tasks (the phase barrier guarantees they are completed before a task runs). The key also folds an `incrementalDelegationDigest` — the resolved model (per-task override or the global `--agent-model`), the agent identity (`--agent-command`/`--agent-endpoint` + secret-stripped args), the backend driver, and the sandbox profile id — so changing the model/agent/backend/sandbox correctly invalidates rather than serving a stale result that would also attest the wrong producer. (Those are all operator flags stripped from `run.inputs`, so they would otherwise escape the key.) `--incremental` threads through `runDrive` and is added to `DRIVE_RUNTIME_KEYS` so it never leaks into `run.inputs` or the cache key. A reused hop uses the existing cache-hit accept path (surfaced as `handleKind:"result-cache"`), so no usage is fabricated.
- **Tests**: new `incremental-resume-smoke` (stub agent + spawn-count file): reuse across runs (0 re-spawns, every accept is a cache hit), byte-identical reused output, a **non**-incremental re-run re-runs everything (POLA), per-task granularity (one deleted cache entry re-runs only that task), and downstream invalidation (changing a first-phase result reuses that prefix but re-runs every later phase). Fails-before/passes-after confirmed.
- **Risk**: Low. Gated behind `--incremental` (default off) → a normal drive is byte-identical; `schemaVersion:2` keeps the two caches disjoint; no runtime dependency added; determinism preserved (the key has no clock/random).

- **Docs sync + packaging**: Brought the root README into line with the current code and declared the Node floor to npm. (a) The Install line listed only `claude, codex, gemini` for agent auto-detect, but PATH detection also finds **`opencode`** (`agent-config.ts`), and Quick Start already offered `-deepseek` — so the two lists disagreed and both omitted supported agents. Install now lists the four auto-detected agents (`claude, codex, gemini, opencode`) and Quick Start notes they auto-detect (no flag) while `-deepseek` picks the DeepSeek builtin. (b) The "How It Works" pipeline (`plan → dispatch → record → verify → commit → report`) was reworded to read as the conceptual saved/replayable flow it describes rather than as literal function names. (c) `package.json` gained `"engines": { "node": ">=18" }`, matching the runtime check in `doctor.ts` so `npm install` warns on Node <18 instead of only failing later in `cw doctor`.
- **Risk**: Low. Docs + one additive packaging field — no runtime/verifier behavior change, no new dependency (CW stays zero-runtime-dep), `dist/` unaffected. The README claims were already true; this closes a stale agent list and an undeclared engine floor.

- **Docs + demo (the now-true claim)**: With the result signature (prior cycle) and the report cross-check in place, the root README "Can I Trust the Report?" section is strengthened from the interim honest-but-narrow wording up to the now-**true** forward claim: the agent **signs its findings** (ed25519) and `cw report verify-bundle` confirms — offline, with nothing but the public key — that every signed finding is in the report **unaltered** (edit a finding, in the report or in the agent's own result, and the check fails); CW holds **no private key** (the agent signs, CW only verifies). The honest forward-scope caveat is kept and closes **both** directions so the stronger wording does not become the new overclaim — "not that the report holds nothing else, **and not that none were left out** … a determined re-chainer can drop a signed finding entirely" — alongside the Trust Model link. (The omission half was added after adversarial review flagged that a bare universal "every signed finding is present" reads as a completeness guarantee the forward check does not give — the dropped converse.)
- **Demo**: `cw demo tamper` now proves the result claim, not just asserts it — a third **RESULT** layer signs a result-COVERING (5-field) ed25519 payload, then edits the signed finding; CW re-derives `sha256(result)` so the signature joins neither the 5-field nor the 4-field payload and the verify rejects it. So the README's "edits a signed result, watch it fail" is demonstrable in 30s, hermetic, with only the public key. **Every** `demo tamper` claim surface is synced from "two ways / both" to "three ways (incl. editing a signed finding)": `launch-kit.md`, `trust-model.md` (the doc the README defers to), `plugins/cool-workflow/README.md`, `docs/wiki/Trust-And-Audit.md` (gained a Result table row), `docs/github-showcase/README.md`, and the `telemetry-demo.ts` / `capability-core.ts` header comments. (`demo bundle` references are untouched — it genuinely has two layers; `release-history.md` v0.1.79 is left as the historical record.)
- **Tests**: `readme-trust-claim-smoke` now asserts the strong forward claim is present ("signs its findings", "verify-bundle", "unaltered", "no private key"), that the old overclaims stay gone, AND that **both** caveat directions remain — the extra-content caveat and the new omission carve-out (a re-chainer can drop a signed finding) — plus the Trust Model link. `tamper-evidence-demo-smoke` asserts the demo demonstrates **three** layers (ledger + signature + result), the result layer's baseline is result-COVERING (so "editing a finding is detected" is not vacuous), and the edited finding is rejected. Demo `proven:true`; full suite green.
- **Risk**: Low. Docs + an additive demo layer + test assertions only — no runtime/verifier behavior change (the two `.ts` edits are comment-only). The strengthened wording is backed by the shipped PR2/PR3 crypto and the demo's third layer.

- **Capability**: `cw report verify-bundle` now verifies — offline, with only the public key — that every one of the agent's **signed findings is present in the report and unaltered**, and closes a fail-open. A **report ⇄ result ⇄ signature cross-check**, driven by the signature-verified result-COVERING ledger records (not the archive's `run.tasks` list, which is bound by nothing): for each, the restored result file must hash to the signed digest, and `report.md` must embed it at the task's own `### <taskId>` section. Editing the report, the result, both consistently (the signed digest does not move), or dropping the signed result's task all fail ⇒ `reportFindingsVerified:false`, `ok:false`. An explicit `trustLevel` (`"signed"`/`"unsigned"`) plus a `--require-signatures` flag that refuses a bundle whose signed findings are absent/unverifiable — closing the prior fail-open where an unsigned-but-intact bundle returned `ok:true`.
- **Scope (honest)**: the guarantee is **forward only** — each *signed* finding is present and unaltered. It does **not** assert the report contains *only* signed findings: CW holds no key to sign the rendered report (it delegates, never signs) and the ledger chain is self-recomputable, so the report may carry additional **unsigned** content (prose, ordering, extra sections) and a determined re-chainer can **omit** a signed finding. `trustLevel "signed"` attests the signed findings, not report exhaustiveness; full report-completeness needs an external anchor (declined by design). Documented in `report-verifiable-bundle.7.md` / `trust-model.md`. (This boundary was found through four rounds of adversarial review of the verifier.)
- **Implementation**: `verifyReportBundle` (`run-export.ts`) iterates `verifyTelemetrySignatures().resultBound` — the records whose signature actually **covered** the result (`coversResult`; a usage-only 4-field signature is excluded, so an injected `resultDigest` is never trusted) — and per record requires a present completed task whose `sha256(restored result) === signed resultDigest`, then section-anchors `report.md` (walking `### <taskId>` occurrences so a result body containing `###` does not mis-anchor; a buried decoy fails the body-first match). `trustLevel "signed"` = `resultBound > 0 && signaturesFailed === 0 && forward-check-held`. `requireSignatures` is wired through `cw report verify-bundle` / `report bundle`. The verdict gains `trustLevel` + `reportFindingsVerified`; default `ok` for legitimate bundles is unchanged (additive fields, opt-in refusal — POLA).
- **Tests**: `report-verify-bundle-smoke` adds: a clean result-bound bundle ⇒ `trustLevel:"signed"`, signature re-verified, `ok:true` (and `--require-signatures` stays `ok:true`); a report-only edit ⇒ `report-result-mismatch`, `ok:false`; a **consistent result+report edit** (a bypass found in review — the signature still verifies over the untouched digest) ⇒ `result-digest-mismatch`, `ok:false`; a buried-decoy report, an empty signed result, and a dropped signed task ⇒ `ok:false`; a 2-task report whose first result body contains the second task's heading ⇒ `ok:true` (no mis-anchor); a no-key bundle ⇒ `trustLevel:"unsigned"`, `--require-signatures` ⇒ `ok:false`. Real signed runs (architecture-review/golden-path/dogfood) verify unchanged. Full suite: 123/123.
- **Risk**: Low. The cross-check only fails a *tampered* bundle (real signed runs hash and embed faithfully, verified across the suite); `trustLevel`/`reportFindingsVerified` are additive; `--require-signatures` is opt-in. Default exit behavior is unchanged for valid bundles.

- **Capability**: The agent's **findings are now cryptographically signed**, not just its token usage. The executor-side signing wrapper (`cw-attest-wrap.js`) now binds a `resultDigest = sha256(result.md)` into the ed25519 attestation, so editing the agent's result (the findings) — not only the reported usage — fails verification. CW still holds **no private key**: the executor signs, CW recomputes the digest from the accepted result and verifies.
- **Implementation**: `TelemetryAttestationContext` gains an optional `resultDigest`; `canonicalTelemetryPayload` includes it **only when present**, so the 4-field payload is byte-identical and every pre-coverage signature still verifies (POLA / back-compat). `worker-accept/telemetry-ledger.ts` passes `resultDigest = sha256(rawResult)` into the verify context (the same raw bytes the executor signed — CW's and the wrapper's `sha256` are identical). `verifyTelemetryAttestation` verifies the result-bound payload and falls back to the 4-field one, so an old signature still attests while a new signer whose result was edited fails both. The signed `resultDigest` is also stored on the hash-chained telemetry ledger record (chain-bound, present only when the signature covered it) so the **independent re-verifier** (`verifyTelemetrySignatures`, behind `telemetry verify --pubkey` and `report verify`/restore) can reconstruct the signed payload offline and accept legitimate result-bound runs.
- **Tests**: `telemetry-attestation-smoke` adds: an edited `resultDigest` ⇒ `unattested` (the behavioral fails-before — the payload previously ignored it), a 4-field signature still `attested` (back-compat), and the 4-field canonical payload byte-identical (POLA). `telemetry-attest-wrap-smoke` proves end-to-end that the wrapper emits a **result-bound** signature CW verifies `attested`, and that re-verifying it without a `resultDigest` fails (so it is not the fallback). Full suite: 123/123.
- **Risk**: Low. Additive and backward-compatible — old `{usage,runId,taskId,promptDigest}` signatures verify unchanged; the wrapper signs `resultDigest` only when `result.md` is present, otherwise it degrades to today's behavior.

- **Docs (honesty fix)**: The root README "Can I Trust the Report?" section no longer overstates the tamper-evidence guarantee. It previously said *"Every agent step is recorded, signed ... Change the report later? The chain breaks and the signature no longer matches"* — but the ed25519 signature only ever covered the agent's reported **usage**, never the CW-rendered report, so that was false. Re-scoped to the currently-true claim (reusing the honest framing in `docs/trust-model.md`): usage is signed; the run record is hash-chained / tamper-evident; the report text itself is **not** signed; CW holds no private key. Added a Trust Model pointer. (This is the words-first step of "make trust-the-report true"; later cycles add real result + report crypto coverage and strengthen the wording to match.)
- **Tests**: Added `readme-trust-claim-smoke.js` — asserts the trust section dropped the false wording and carries the honest scoping + a working Trust Model link (fails against the prior README). No code surface changed.

- **Capability**: The `claude` agent wrapper now sends the exact same result contract as the codex/gemini/opencode wrappers. `claude-p-agent.js` carried a private inline copy of the contract that had drifted — two ASCII hyphens had become em-dashes — so `claude` received subtly different instruction text than the other providers for the same contract.
- **Implementation**: `scripts/agents/claude-p-agent.js` now imports `buildPrompt` (and thus the canonical `RESULT_CONTRACT`) from `agent-adapter-core.js`, like the other three wrappers, replacing ~30 lines of duplicated contract text and the hand-built prompt. claude's vendor-specific `stream-json` parsing / `renderEvent` (which reads claude's own event shapes) is unchanged.
- **Tests**: `claude-p-agent-wrapper-smoke.js` now asserts the prompt the PATH-shimmed `claude` receives `includes(RESULT_CONTRACT)` — the shared canonical contract verbatim. This fails against the old drifted copy and passes after the import. Sibling wrapper smokes stay green. Full suite: 120/120 passed, 0 failed.
- **Risk**: Low. The only change to the prompt is two characters (em-dash → ASCII hyphen), bringing claude into parity with the other providers. The legacy `--output-format json` path, streaming, read-only tool set, and stdout/stderr contract are unchanged.

- **Capability**: Faster run state on long runs — `appendRunNode` no longer rebuilds the entire `run.nodes` array on every append. It ran on each dispatch/result/blackboard node and did `nodes.map(...)` / `[...nodes, node]`, allocating arrays of size 1..N over a run that appends N nodes (O(N²) memory churn + GC). It now mutates the array in place.
- **Implementation**: `src/state-node.ts` `appendRunNode` uses `nodes[index] = node` for an upsert and `nodes.push(node)` for a new node, instead of rebuilding `run.nodes`. The resulting array content and order are byte-identical (push appends at the end, replace keeps the slot), so persisted `state.json` is unchanged. `appendRunNode` is the sole writer of `run.nodes`, so the array reference is now stable across a run.
- **Tests**: Added `append-run-node-no-realloc-smoke.js` — asserts the `run.nodes` reference is stable across appends (the no-realloc signature; fails against the old reallocating code), insertion order is preserved, an upsert replaces in place (same array, length, and slot), persistence via `writeRunNode` is unchanged, and a missing `nodes` array is initialized. Node-heavy regression smokes stay green. Full suite: 120/120 passed, 0 failed.
- **Risk**: Low. Output is byte-identical for valid runs (same nodes, same order); only the in-memory allocation pattern changes. No `--json`, file-layout, or exit-code change.

- **Capability**: Run-archive import is hardened against a path-traversal (zip-slip class) escape. Before, `cw run import` and `cw report verify-bundle` trusted the archive's own `run.id` as a directory name, so a crafted bundle with a `run.id` like `../../../escape` could write a run tree OUTSIDE the target's `.cw/runs/` directory — and `verify-bundle`, the command meant to safely inspect an untrusted bundle, would write outside its throwaway temp dir while still reporting `ok`. Import now refuses any run id that is not a single safe path segment and asserts the run directory stays inside the runs root, both before any directory is made — so an untrusted bundle can never escape the runs tree.
- **Implementation**: Added `assertSafeRunId()` to `state.ts` (a run id must match `[A-Za-z0-9._-]` and not be the `.`/`..` component; the charset already forbids separators, so the whole id is one path component and an embedded `..` like `v1..2` is a safe directory name that is allowed — matching how `createRunId()` concatenates a `validateWorkflowId`-shaped id). `importRun()` in `run-export.ts` now validates the archive run id and asserts `isContainedPath(runDir, runsRoot)` before creating the run directory, and rejects a malformed run envelope with a named error instead of a raw `TypeError`. The same guard protects `verifyReportBundle()`, which restores into a temp dir via `importRun()`.
- **Tests**: Added `run-import-path-traversal-smoke.js` — proves a traversal `run.id` is refused before any directory is created (no escaped dir/file, and the target's runs tree stays empty), that `cw report verify-bundle` surfaces the same refusal as a failed `restore` check (`ok:false`) without escaping its tmpdir, that a benign id still round-trips (POLA), and unit-covers `assertSafeRunId` (10 reject / 7 accept, including embedded-`..` ids). Export/import regression smokes unchanged and green. Full suite: 120/120 passed, 0 failed.
- **Risk**: Low. The guard only rejects ids no legitimately-minted run carries (real ids are `[a-z0-9-]` slug + timestamp + pid + counter), so valid export/import/verify-bundle/restore flows are byte-identical; only crafted/traversal ids change behavior (fail-closed refusal). No `--json` or exit-code change on the happy path.

- **Capability**: The smoke runner's `--sample <n>` (used by `coverage-gate --sample` for a fast coverage estimate) now selects a **deterministic** subset. Before, it used a per-run `Math.random()` shuffle, so the same set of files produced a different sample every run — contradicting the runner's own comment and CW's replay-determinism invariant. The subset is now a pure function of which files are present.
- **Implementation**: Added an inline `deterministicSample(files, n)` to `test/run-all.js` — ranks files by a stable, dependency-free FNV-1a hash of the name, takes the lowest N, and returns them in alphabetical run order (order-independent, no `Math.random`, no `Date`). It replaces the `sort(() => Math.random() - 0.5)` shuffle. Kept inline rather than a sibling module so the runner stays a self-contained, copy-able script (its own meta-smokes copy `run-all.js` alone into a temp dir).
- **Tests**: Added `sample-determinism-smoke.js` (end-to-end) — copies the runner plus a 10-smoke pool into a temp dir, runs `--sample 4` three times through the real runner, and asserts the selected subset is identical every run (under `Math.random` run 2 differs from run 1) and is correctly sized and unique; plus a source-level guard that `run-all.js` code contains no `Math.random`. Full suite: 120/120 passed, 0 failed.
- **Risk**: Low. `--sample` callers (`coverage-gate`) never depend on *which* smokes are picked, only that N run; the full suite (no `--sample`) is unaffected. Test-harness only — no `src`/`dist` change, no shipped CLI/`--json` surface touched.

- **Capability**: `cw --version` and `cw -h` work as top-level flags. Short flag aliases: `-q` (--question), `-r` (--repo), `-a` (--agent-command). Auto-detect agent: `cw quickstart` no longer needs `--agent-command` — it finds the first installed agent (claude/codex/gemini/opencode) on PATH. Interactive question: when `--question` is missing on a TTY, CW prompts you. New README: ~80 lines, install-first, copy-paste ready.
- **Implementation**: Added top-level flag handling in `runCli()`. Added short flag mapping in `parseArgv()`. Added `detectAgentFromPath()` to `agent-config.ts` with `CW_NO_AUTO_AGENT` guard for test environments. Added `promptQuestion()` for interactive readline input. Updated `formatHelp()` with short flags. Rewrote README.md (301→80 lines). Updated `AgentDelegationConfig.source` type to include `"auto"`.
- **Tests**: Added `CW_NO_AUTO_AGENT=1` to test sandbox env to prevent auto-detection interfering with smoke tests. Full suite: 115/115 passed, 0 failed.
- **Risk**: Low. Auto-detection is backwards-compatible — `CW_AGENT_COMMAND` and `--agent-command` still override. Test sandbox explicitly disables it. `--json` and piped output unchanged.

## 0.1.86

- **Capability**: A new user now gets a clearer and faster first run: `doctor --onramp` points from zero-write `quickstart --check` to `quickstart --bundle` and offline `report verify-bundle`, while the README path is covered by an end-to-end smoke.
- **Implementation**: Added the onramp contract gate, first-run README smoke, fast-review source-context metrics, strong-phase source-context prompts, explicit-cwd MCP/Workbench hardening, broader CLI/MCP scenario payload probes, batched source-context reads, and focused `test:ci` timing summaries.
- **Tests**: Added and split deterministic smokes for quickstart checks, README bundle handoff, onramp checks, source-context batching, run-all JSON summaries, dogfood architecture review, topology scenarios, and long-tail timing proof. `test:ci` now has more margin under 120s: the latest local run was 110/110 with 104909ms wall time.
- **Risk**: Low to medium. Most user-facing behavior is opt-in or diagnostic; default JSON/stdout surfaces stay stable. The larger changes are in test structure, release/onramp tooling, MCP surface routing, and docs.

- **Docs**: The README and agent memory now name the two project rules:
  FreeBSD-style engineering discipline inside the code, and a
  Homebrew-like small command surface for doctor, verify, and recovery.
- **Docs**: Codex, Claude, Gemini, Copilot, Cursor, Windsurf, Aider, and
  other agents now have shared AI-memory entry points for those rules.

## 0.1.85

- **Capability**: Anyone can now turn a CW run into a portable, self-checking
  report bundle and verify it OFFLINE with only the file. `report bundle` (and
  `quickstart <app> --bundle`) seal a finished run — its report, `file.js:42`
  evidence pointers, signed hash-chained telemetry, and the operator's ed25519
  PUBLIC key — into one `report.cwrun.json`. `report verify-bundle` re-proves the
  archive bytes, the telemetry chain, the trust-audit chain, and the signatures
  with no source repo, no `.cw` tree, and no key handed over; `demo bundle` proves
  the whole guarantee hermetically in 30 seconds.
- **Implementation**: Added an optional `trust` block (public key only) to the
  portable run archive; `verifyReportBundle` (reuses inspectArchive + a
  throwaway-tmpdir import/verify + ed25519 re-verify); the `report bundle`
  producer (export sealed + self-verify, fail-closed); the cli-only `demo bundle`;
  and a `quickstart --bundle` flag that seals a COMPLETED run anchored to its own
  repo while resolving output paths to the caller's cwd (never polluting the
  analyzed repo). Bundle result types moved to `src/types/report-bundle.ts`. CW
  still never runs a model itself — it only keeps the books and makes the check.
- **Tests**: Four new smokes (`report-verify-bundle`, `report-bundle`,
  `demo-bundle`, `quickstart-bundle`) — 97 → 101 — proving clean bundles verify,
  chain/signature forgeries are caught even when archive digests match, the
  fail-closed exits, no-key degrade vs `--strict-signatures`, cross-directory
  anchoring, and no repo pollution.
- **Risk**: Low. Everything is additive and opt-in; the no-flag paths stay
  byte-identical. Every cycle passed CI and an adversarial multi-agent review
  (with confirmed findings fixed) before merge.

## 0.1.84

- **Capability**: A maintainer can now cut a scrubbed hardening release with no
  saved release-review input or tracked file carrying the blocked local user
  markers. The release also includes the four god-object hardening PRs: registry
  owned parity probes, an extracted MCP surface, a thin CLI entrypoint, and a
  split worker accept path.
- **Implementation**: Removed tracked `.cw-release/review-input-*` prompt
  captures, changed `release-flow` reviewer prompts to use repo-local paths,
  replaced the personal Obsidian default in `sync-project-index`, and added a
  tracked-file privacy smoke. Structured version surfaces and generated manifests
  are bumped to `0.1.84`.
- **Tests**: New `pii-redaction-smoke` scans tracked files for the blocked
  markers. The release gate also runs build, type check, dist drift, CLI/MCP
  parity, project-index, version-sync, and the full smoke suite.
- **Risk**: Low runtime risk. The scrub removes obsolete saved reviewer inputs
  and changes release-tooling prompt text only; the public CLI/MCP payloads and
  worker behavior are unchanged.

## 0.1.83

Hardening + onboarding batch: close the remaining silent-fallback and
concurrent-writer holes in the control plane, add a `brew doctor`-style setup
check, make the CLI self-documenting, carve one clean god-module seam, and put
the entire documentation prose surface into Ogden Basic English (850) — on a
green core (90/91 local; the one miss is an environment-only toolchain issue that
passes under CI).

- **Fail closed on corrupt authoritative state**: the home-registry/scheduler
  "plain file" loaders (archive/provenance overlays, `repos.json`, the run queue,
  the scheduling policy) no longer conflate ABSENT with PRESENT-but-corrupt — a
  corrupt file now surfaces via `readJson`'s `Invalid JSON` throw instead of
  silently reading as empty/default (the false-green §4 forbids). A wrong-shape
  overlay (valid JSON, not an object) fails closed with a clear `Corrupt overlay`
  message rather than a cryptic TypeError.
- **No lost writes under concurrency**: every scheduler store mutation
  (create/due/complete/resume/run-now/set-status/delete) and `rerun()`'s
  provenance write now serialize their read-modify-write under `withFileLock`, the
  same advisory lock the queue and reclamation stores already use — a daemon poll
  racing a CLI call can no longer last-writer-wins away a task/status/link.
- **Robustness**: one corrupt `worker.json` is skipped (with a diagnostic) instead
  of throwing the whole worker listing; the MCP stdin line buffer is capped (16MB)
  so a peer that never sends a newline can't OOM the long-lived server;
  `readGitHead`'s git call is bounded with a 5s timeout.
- **`cw doctor`** (inspired by `brew doctor`): a read-only, fail-closed setup
  diagnostic — Node >= 18, agent backend + its binary on `$PATH`, git, and writable
  home/repo state — that prints an actionable fix per problem. Human text by
  default, stable `--json` for scripts.
- **Self-documenting CLI**: `cw help` now lists 14 commands it previously omitted
  (`doctor`, `metrics`, `telemetry`, `gc`, `sched`, `migration`, `operator`,
  `review`, `approve`/`reject`/`comment`, `handoff`, `loop`, `demo`, `audit-run`);
  `sched policy set` fails closed on a non-numeric flag instead of silently writing
  the default; bare `Missing X` arg errors point to `cw help`.
- **Maintainability**: carve the pure content-addressing leaf out of
  `reclamation.ts` into `reclamation/hash.ts` (byte-identical surface); delete the
  fully-orphaned dead `verifier-registry.ts`.
- **Docs**: the description standard is recorded in `AGENTS.md` and the whole
  documentation prose surface (manifest/package descriptions, READMEs, narrative
  docs, guides, all `*.7.md` man pages) is rewritten in Ogden Basic English, every
  command/code/version token preserved. A PR merge-order rule (oldest-first by
  timestamp) is recorded in `AGENTS.md`.

Tests: new regression smokes — `registry-corrupt-fail-closed`,
`robustness-failclosed`, `sched-policy-validation`, `doctor` — plus the existing
suite; CLI<->MCP parity, jsonmode, manifest, version-sync, and project-index
guards all green. Risk: the corrupt-state loaders now THROW where they previously
returned empty — intentional fail-closed behavior; no valid-state path changes.

## 0.1.82

Architecture-audit hardening: close a false-green in the replay-determinism moat,
remove the last global-cwd mutation from the runner, and de-risk persisted ids,
gates, and record reads — on a fully re-verified, 87/87-green core. Full report at
`docs/audits/architecture-audit-v0.1.81.md`.

- **Replay determinism (the moat)**: the multi-agent replay eval now RE-DERIVES the
  projection from the raw captured state instead of comparing the baseline to a
  byte-copy of itself, so a projection-determinism regression in `normalizeRun` is
  actually caught — it was previously a structural false-green on the exact
  guarantee CW sells. A new regression smoke proves it has teeth: it fails on the
  old copy-the-baseline behavior, including a case that simulates an intrinsically
  nondeterministic projection (corrupt the stored baseline, leave raw state pristine).
- **Deterministic, collision-free ids**: topology run ids are now a content hash (no
  wall-clock), and run/schedule ids use a monotonic counter + `process.pid` instead
  of `Math.random` — deterministic (not a PRNG) and collision-free across
  same-second/same-kind and concurrent-process minting.
- **No global cwd mutation**: `CoolWorkflowRunner.withBaseDir()` threads an explicit
  base directory through run resolution; `drive` / `quickstart` / `export` / `import`
  / `inspect` / `verify-import` no longer `process.chdir` the whole process, so
  concurrent in-process callers can no longer corrupt each other's working directory.
- **Fail-closed hardening**: the no-false-green empty-capture gate is now one shared
  fail-closed helper (was duplicated sync-by-comment across commit + selection),
  persisted per-record reads (`WorkerScope` / `CandidateScore` / `NodeSnapshot`) are
  shape-validated on load, and the trust-audit correlation-id struct is de-duplicated
  without changing the hash-chained on-disk event shape.
- **Maintainability**: the `recordWorkerOutput` accept-path and `resolveCommitGate`
  are decomposed; embedded `node -e` child programs are extracted to
  `scripts/children/`; node projection and the multi-agent hash/id helpers are each
  unified into a single source of truth.

## 0.1.81

Harden the auditability story end to end (verify, restore, inspect) and make the
resumable-pipeline + multi-vendor promises executable, on a god-module-decomposed,
faster-tested core.

- **Capability**: New fail-closed verification + recovery surface. `cw audit verify <run>`
  / `cw_audit_verify` re-proves the trust-audit hash chain offline and exits non-zero on
  ANY unverified chain (forged, edited, truncated, or fully-corrupt) — the verdict the
  deploy gate keys on. `run verify-import` now re-proves the trust-audit chain on restore
  too (not just telemetry) and gains `--strict` for a fail-closed exit; `run inspect-archive
  <archive>` integrity-checks a portable run archive WITHOUT importing it, naming any
  offending file; opt-in `CW_REQUIRE_ARCHIVE_INTEGRITY=1` refuses a stripped-integrity
  archive at import and inspect. The Track-A resumable-pipeline demo is now first-class:
  `cw quickstart --resume` advances one step then stops with a copy-pasteable continue line,
  and `cw run resume <id> --drive/--once` continues an interrupted run through the existing
  agent-drive loop. Cross-vendor is proven by boot: `npm run manifest:load-check` loads all
  five generated vendor manifests (claude, codex, agents, gemini, opencode) and asserts each
  boots the full tool surface. Telemetry verification gains `cw telemetry verify <run> --pubkey` to re-run ed25519 signature checks per attested record offline (not just the hash chain), and a new `docs/trust-model.md` states the integrity guarantee and its single-keyholder ceiling honestly.
- **Implementation**: New verbs/fields are additive and POLA-safe (new flag/verb/env;
  existing default output byte-identical). Two real integrity bugs fixed: the trust-audit
  `computeEventHash` now binds the PERSISTED form, so worker-dispatch events (with undefined
  metadata fields) re-verify instead of false-failing as digest-mismatch; and reclamation's
  freed manifest is path-sorted before it feeds `tombstoneHash`, making the tombstone chain
  reproducible across filesystems. The kernel was decomposed: the remaining FreeBSD
  self-audit findings were closed, dead code/no-op branches removed, and several god-modules
  (coordinator, execution-backend, observability, operator-ux, state-explosion, multi-agent,
  multi-agent-eval, worker-isolation, run-registry) carved into behavior-preserving siblings.
  The smoke runner is parallel-safe (suite ~333s -> ~119s; CI on `--concurrency auto`).
- **Tests**: New smokes — `audit-verify`, `verify-import-audit-chain`, `run-inspect-archive`,
  `run-import-tamper-failclosed`, `run-resume-drive`, `vendor-manifest-load`,
  `cli-jsonmode-parity`, `mcp-required-args-equivalence` — each proving the fail-closed exit,
  POLA default, and the bug regressions (all-corrupt audit log exits 1; undefined-field
  events re-verify; reclamation manifest path-sorted; CLI `run resume --drive` routes to the
  verb, not an app). A real `builtin:claude` dogfood drove a worker end-to-end and surfaced
  the resume-drive CLI-routing bug now fixed.
- **Risk**: Additive and opt-in; existing outputs, files, and exit codes are byte-identical
  by default, and the carves are behavior-preserving (parity + determinism gates green).
  README/launch materials refreshed for onboarding. No new runtime dependency; the
  delegate-not-execute red line is unchanged.

## 0.1.80

Ship the fast architecture-review lane for shorter foreground waits while keeping the full review contract intact.

- **Capability**: Operators can now run `scripts/architecture-review-fast.js` for an opt-in 6-worker architecture review that prepares a reusable JSONL source context, runs parallel Map/Assess phases, reports optional timing/cache metrics, schedules the full 14-worker review as a background handoff, narrows context by profile or git diff, and routes fast/strong model hints from wrapper flags. Repeated runs can reuse stable Map and Assess work, so unchanged scoped reviews can return from cache instead of respawning agents.
- **Implementation**: Added the canonical `architecture-review-fast` app, the automation wrapper, source-context cache/profile/diff support, opt-in `resultCache` with previous-phase digests for Assess safety, schedule handoff metadata, metrics collection, and userland `--fast-model` / `--strong-model` policy flags. External repos get a repo-local default source profile for common tracked text surfaces, and zero-record contexts fail closed. Core remains mechanism-only: model routing stays in wrappers/env, vendor-specific stream parsing stays out of `src/`, and existing default outputs remain unchanged unless an opt-in flag is used.
- **Tests**: Added and extended `architecture-review-fast-smoke`, `architecture-review-fast-automation-smoke`, and `source-context-profile-smoke` to prove phase topology, source-context pinning, cache hits, corrupt-cache fail-closed behavior, scoped profiles, default external-repo context export, diff-aware exports, metrics opt-in, full-review schedule context, default output stability, and model hint propagation through `{{model}}`. Full suite: 75/75 passed locally for the release candidate.
- **Risk**: Additive and opt-in. The full `architecture-review` workflow is unchanged; committed `dist/` remains synced; release risk is mainly operator choice of narrower profiles or model policy flags, both explicit and visible in the wrapper output.

## 0.1.79

Ship the tamper-evidence demo + telemetry verification, and surface the project for distribution.

- **Capability**: `cw demo tamper` proves, in one hermetic command (no model, no network, no API key), that a recorded telemetry verdict cannot be forged undetected — it builds a real ed25519-signed ledger and catches a ledger-layer forgery (verdict flip + recomputed local hash → the hash chain breaks downstream) and a signature-layer forgery (inflated tokens + reused signature → ed25519 rejects), all verified offline with only the public key. `cw telemetry verify <run>` (and `cw_telemetry_verify` on MCP) is the operator-facing half: re-prove a real run's ledger on demand. Both exit/return fail-closed.
- **Implementation**: `src/telemetry-demo.ts` (demo + human formatters), `telemetryVerify` / `demoTamper` in capability-core, static registry descriptors (parity gate), CLI + MCP wiring. No new dependency.
- **Distribution**: README/wiki synced to the shipped state with npm version + downloads badges (all prior badges intact); a launch kit under `docs/launch/` (Show HN, post copy, the separation-of-duties wedge). The headline differentiator is now one `npx cool-workflow demo tamper` away.
- **Tests**: self-guarding `tamper-evidence-demo-smoke` proves both forgery layers are caught and that `telemetry verify` detects a one-byte on-disk edit with a named failing check, so the integrity guarantee cannot silently regress. Suite 69/69.
- **Risk**: additive — new verbs + a cli-only demo; no change to existing acceptance or the delegate-not-execute red line.

## 0.1.78

Working onboarding: the documented quickstart completes with a real agent, and the package is npm-installable.

- **Capability**: A stranger can now follow the README and get a real cited architecture-risk report: `--agent-command builtin:claude` resolves to the bundled claude wrapper (read-only headless claude; the wrapper persists result.md and forwards the agent-reported model + usage), the cross-directory quickstart no longer crashes, and a missing optional input no longer leaks a literal `{{name}}` into agent prompts. `npx cool-workflow` / `cw` become real invocations (bin entries), with repository/keywords/LICENSE shipped in the package.
- **Implementation**: `scripts/agents/claude-p-agent.js` (node port; bash shim delegates), `builtin:` template expansion in `agent-config.ts`, statePath-derived cwd in `capability-core.ts` quickstart, declared-input default folding in `plan()`, package.json bin/metadata.
- **Live proof (committed)**: `docs/dogfood/architecture-review-cool-workflow.md` refreshed from a real run through the documented wrapper — 14/14 workers driven by `claude-opus-4-8[1m]`, 14/14 reported usage (38,069 in / 168,789 out), verifier-gated commit, zero hand-written result.md.
- **Tests**: `claude-p-agent-wrapper-smoke` (hermetic PATH-shimmed claude: prompt delivery, read-only flags, result persistence, provenance forwarding, fail-closed, doc-drift guard, builtin alias); quickstart smoke gains the README cross-directory CLI regression. Suite 68/68.
- **Risk**: zero new dependencies (the wrapper is config, not code CW imports); `builtin:` is an additive config token — explicit commands resolve exactly as before.

## 0.1.77

Trustworthy telemetry (Track 1), concurrent failure semantics (Track 2), boundary contracts (Track 3), and a multi-platform portable release flow.

### Track 1 — telemetry attestation (#92–#96)

- **Capability**: An operator can now know the token usage CW reports is REAL: each agent's self-reported usage is verified against an operator ed25519 trust key (`attested` / `unattested` / `absent`, surfaced loudly, never silently averaged), every verdict lands in a tamper-evident hash-chained ledger, MetricsReport shows attestation coverage, an executor-side signing wrapper + keygen make real runs attestable, and a strict operator can opt into fail-closed mode (`require-attested-telemetry`) that refuses any hop whose usage cannot be cryptographically verified.
- **Implementation**: `telemetry-attestation.ts`, `telemetry-ledger.ts`, signing wrapper + keygen scripts, `deriveAttestationCoverage` (observability), fail-closed check at worker-output accept (`worker-isolation.ts`). CW still never measures usage — it verifies and records what the executor attests (red line intact).
- **Tests**: `telemetry-attestation`, `telemetry-ledger`, `telemetry-attest-wrap`, `telemetry-metrics-coverage`, `telemetry-fail-closed` smokes.

### Track 2 — concurrent failure semantics (#101)

- **Capability**: A `parallel()` phase's agents now run CONCURRENTLY in wall-clock with declared collapse semantics: **collect-all** (a failing hop never aborts its siblings; every hop settles and is recorded) and **kill-on-timeout** (a hung agent is SIGTERM'd at its deadline, SIGKILL'd after a grace, and counted as one failure through the same retry/park path as a crash). 16 agents with a forced hang + crash + dirty-return complete with no deadlock, no disk corruption, and a recorded state that replays who passed / who failed completely.
- **Implementation**: batch delegate child in `execution-backend.ts` (parent stays synchronous — zero public-API change); outcomes settle through the serial path's exact envelope branches via the internal `preparedAgentOutcome` seam; deterministic record order regardless of completion order.
- **Tests**: `concurrent-failure-semantics` acceptance smoke (the build-map criteria verbatim).

### Track 3 — boundary contract (#98–#100)

- **Capability**: The executor boundary is now a CONTRACT, not a convention: a task may declare an output `schema` (dependency-free structural validator — no ajv, portability red line intact) and a violating result parks the hop fail-closed; `limits.tokenBudget` is enforced by the drive loop against recorded usage (exhaustion blocks the next spawn, composes with Track 1 fail-closed for strict accounting); and the one-way red line (CW receives only plain data from the executor, never a callable that could reach a model API) is welded into the type layer — adding a callable to a boundary type fails `npm run build`, proven by a negative-fixture compile test.
- **Implementation**: `schema-validate.ts` + `RunTask.schema` enforcement in `verifier.ts`; budget gate in `drive.ts` (`deriveUsageTotals`, the same aggregation MetricsReport shows); `types/boundary.ts` welds (`OneWayData<T>`).
- **Tests**: `schema-validation`, `token-budget-enforcement`, `one-way-boundary` smokes.

### Release flow

Multi-platform portable release flow.

- **Capability**: The gated release ritual (deterministic gate → independent reviewer → verdict → optional tag) is now one zero-dependency Node orchestrator, `scripts/release-flow.js`, that runs identically under Claude, Codex, Gemini, OpenCode, or a plain shell — no dependency on any host's agent-orchestration primitive. The independent review is **delegated** to whatever model you configure (`CW_AGENT_COMMAND`/`CW_AGENT_ENDPOINT`); CW spawns it argv-style (`shell:false`), holds no key, imports no model SDK (the red line).
- **Implementation**: `scripts/release-flow.js` (`--check` default; `--cut --version x.y.z [--push]`) reuses `release-gate.sh`, `resolveAgentConfig` (dist/agent-config), `bump-version`, and the existing `.cw-release/<sha>.verdict` convention + tag-push CI backstop. Per-vendor entry points all call the one script: `commands/release-flow.md` (Claude), `.gemini/commands/release.toml`, `.opencode/command/release.md`, and a Codex skill reference. Gemini and OpenCode added as MCP vendors (`.gemini-plugin/`, `.opencode-plugin/` generated from the manifest source) so the `cw_*` tools are available there; DeepSeek is reached as an agent-backend model (OpenCode `-m deepseek/...` or `CW_AGENT_ENDPOINT`), not a plugin.
- **Tests**: `test/release-flow-smoke.js` (auto-discovered) drives the real orchestrator against throwaway git fixtures with a stub agent: APPROVED passes; REJECTED / missing-verdict / unconfigured-agent / red-gate all fail closed; static red-line guard asserts `shell:false` and no model-SDK import. No real model spawned in CI.
- **Risk**: No `src/` runtime or public-API change; zero new dependencies. The reviewer command-template presets are best-effort per each tool's current CLI flags (config, easily edited) — the orchestrator itself is vendor-neutral.

## 0.1.76

Positioning consistency: stop calling CW an "SDK" anywhere it describes itself.

- **Capability**: Every self-describing surface a user or LLM client reads — npm `package.json`, all vendor plugin manifests (Claude / Codex / agents / marketplace), the keyword list, both READMEs, the docs, and the developer-contract doc — now names CW an **auditable workflow control-plane / Workflow App framework** instead of an "SDK". "SDK" survives only where it is the red-line disclaimer ("CW embeds no **model SDK**") and in third-party package names, so the moat-guard tests still mean what they say.
- **Implementation**: Renamed the term-of-art identifier `workflow-app-sdk` → `workflow-app-framework` across source, docs, the example app id (`workflow-app-framework-demo`), the replay fixture, and the `version-sync` needles; renamed `src/workflow-app-sdk.ts`, `docs/workflow-app-sdk.7.md`, `test/workflow-app-sdk-smoke.js`, and `docs/agent-sdk.md` → `agent-framework.md`. Rewrote the `manifest/plugin.manifest.json` descriptions (single source) and regenerated all vendor manifests; changed the `agent-sdk` keyword → `control-plane`; rebuilt `dist/`.
- **Tests**: No behavior change; existing smokes carry over under the new names (`workflow-app-framework-smoke.js`), and `run-fixture-compat-smoke.js` replays the renamed fixture. Full suite + `release:check` green. The `no-model-SDK` red-line guard (`agent-delegation-drive-smoke.js`, `quickstart-smoke.js`) is intentionally untouched.
- **Risk**: Pure rename / copy change — no runtime, public-API, or dependency change (zero-dependency invariant held). The example app's id changed (`workflow-app-sdk-demo` → `workflow-app-framework-demo`); anyone scripting against the old id must update it. Historical CHANGELOG entries and past release/tag notes are left as-is (factual record).

## 0.1.75

Gated, self-auditing release flow for the cool-workflow plugin.

- **Capability**: A maintainer (or autonomous agent) can run `/release` to cut a release that is provably gated — a deterministic check (`release-gate.sh`) plus an independent `release-reviewer` subagent must both pass before a tag is allowed; a `PreToolUse` hook blocks `git tag`/tag-push without both markers, and a tag-push CI workflow (`release-gate.yml`) re-runs the gate out-of-band so the local hook cannot be the only line of defense.
- **Implementation**: New plugin components — `commands/release.md`, `agents/release-reviewer.md`, `hooks/hooks.json`, `scripts/release-gate.sh`, `scripts/block-unapproved-tag.sh` — plus repo-root `AGENTS.md`, `docs/prompts/reviewer-agent.md`, and `.github/workflows/release-gate.yml`. Three correctness fixes were required for the gate to function in this repo: `PREV_TAG` now excludes tags pointing at HEAD (the tag-push CI runs *on* the new tag, so a naive `git describe` collapsed the diff range to empty and false-failed every release); the substance check now matches its documented spec ("any changed file outside `src/types/` and `dist/`", not only `src/`); and the hook parses its stdin with `node` instead of `jq` so it can't silently fail open where `jq` is absent. CI install uses `npm install --no-package-lock` to match the repo's gitignored lockfile.
- **Tests**: `test/release-gate-smoke.js` (8 fixture cases: no-prev-tag, valid release, tooling-only substance, spec-accretion reject, zero-test reject, cadence reject, version-branch reject, and the HEAD-already-tagged PREV_TAG regression) and `test/block-unapproved-tag-smoke.js` (block without markers, block with gate-only, block on REJECTED, allow on gate+APPROVED, allow non-tag commands, tag-push gating). Both are auto-discovered by `test/run-all.js`.
- **Risk**: No `src/` runtime or public API change; zero new dependencies (zero-dependency invariant held). The substance check is intentionally a permissive deterministic floor — deeper "is this real capability vs. spec accretion / docs fluff" judgment is delegated to the independent reviewer agent, by design.

## 0.1.51

- Auto-compaction trigger point fix. v0.1.48's compaction hook fired on every `saveCheckpoint()`, causing test fixture fingerprint instability. Fix: `maybeCompactRun()` is now called only after major lifecycle mutations (commit) via `lifecycle-operations.ts`. Also fixes dogfood-release smoke test by correcting the content-surface version-sync pipeline (use `npm run bump:version`, never hand-edit version.ts alone).

## 0.1.50

- Auto-compaction trigger point fix (incomplete — see 0.1.51).

## 0.1.49

- CI fix: CHANGELOG.md and RELEASE.md are content surfaces that the dogfood-release smoke test reads from the git commit (`git show HEAD:<path>`). These must contain the target version string in the released commit. The bump-version script only covers structured surfaces; content surface updates are now documented as a release step.

## 0.1.48

- P2 fixes for v0.2.0 readiness. State auto-compaction: `saveCheckpoint()` now triggers `computeStateSize()` after every write via a `setPostSaveCallback()` hook; compaction runs automatically when graph nodes exceed 40 or edges exceed 60 (BSD: mechanism in state.ts, policy in orchestrator constructor). Agent code dedup: `multi-agent-host.ts` now documents its delegation relationship to `lifecycle-operations.ts`, establishing the shared mechanism between single-agent and multi-agent paths. npm scripts: added `ci` aggregate (build → check → test → release:check), cleaned `test:fast` and `eval:replay`. P2-1 confirmed already-done (types barrel exists universally). P2-3/P2-5/P2-6 deferred to v0.2.0.

## 0.1.47

- Vendor-adapter registry — data-driven manifest generation. Extracts hardcoded vendor JSON shapes from `gen-manifests.js` into declarative templates in `plugin.manifest.json`'s `vendors` section. A `_resolveTemplate()` engine (~40 loc) recursively resolves `{{path.to.field}}` markers with `|lowercase` transformer support. Adding a new AI platform is now pure data — one entry in `vendors` + `targets`, no gen-manifests.js changes. BSD: template engine is mechanism; which vendors exist and what JSON they produce is policy-as-data.

## 0.1.46

- Capability registry auto-discovery. `registerCapability()` builder replaces the manual "add an entry to the giant array" workflow. Capabilities are now registered via a last-write-wins Map-based collector; the built `CAPABILITY_REGISTRY` is derived from all registrations at module load. `capability-core.ts` demonstrates self-registration for `plan`, `app.run`, and `commit`. New capabilities call `registerCapability()` next to their implementation — no need to touch `capability-registry.ts`. The parity-check still validates all surfaces against the built registry. BSD: mechanism (register + collect), policy (which capabilities exist).

## 0.1.45

- Migration DAG with reversible edges. Replaces the linear `while (schemaVersion < CURRENT)` loop with a BFS graph path resolver (`findMigrationPath()`) over directed migration edges. Each `StateMigrationStep` now carries an optional `reverse()` function, enabling rollback/downgrade paths. New `reverseRunState()` capability resolves a path from any version to any target version (may include forward AND reverse steps). Fail-closed: no path → named refusal, never best-effort. Backward compatible: existing `migrateRunState()` unchanged. BSD: mechanism (graph resolver), policy (which version to target).

## 0.1.44

- Release-gate determinism: `version-sync-check.js` and `dogfood-release.js` now validate version surfaces against the released commit (`git show HEAD:<path>`) rather than the mutable working tree. A repo synced by an external process (iCloud/Spotlight/editor) can transiently write-then-revert a tracked surface; a release-gate read landing in that window made the gate false-RED on a clean tree (and a gate trusting an uncommitted edit could false-GREEN). Reading immutable HEAD bytes removes the entire class. Portable (node + git only).
- `agents` vendor target: a generated `.agents/plugins/cool-workflow/` (plugin.json + mcp.json) adapter from the single manifest source, giving any non-Claude AI agent one common interface to CW.

## 0.1.43

- Hard no-false-green gate. v0.1.42's robust ingest accepts an empty-capture result (no findings AND no grounded evidence even after normalization) with a recorded `captureWarning` — but such a result could still back a `verified` verifier node carrying only a non-grounded summary fallback, which passed the verifier-not-verified, evidence-length, and grounding checks (the last fires only for evidence-requiring tasks) and so committed clean/green for optional-evidence tasks (e.g. `map:`). `resolveCommitGate` now resolves the verifier node back to its source result node (via `inputs.inputNodeId`, then first parent) and fails closed with `commit-rationale-empty-capture` before the rationale is built; candidate selection fails closed symmetrically with `candidate-selection-empty-capture`. The decision reads ONLY persisted node metadata (no clock/ordering), so a reloaded-from-disk run reaches the same gate verdict (replay-stable). Covered by `test/no-false-green-smoke.js`, which proves the gate fires (CommitGateError + `commit-gate-failed` node + feedback), keeps selection in sync, survives reload, and never blocks a result that normalizes to real grounded evidence.
- Launch prep: a one-command `quickstart` (plan -> drive -> report) for first value in under five minutes; a cited self-audit example plus a responsible-disclosure publishing guide; a "why auditable agents" narrative; and a README "Work With Me" commercial-services section.
- Skill hygiene: the `cool-workflow` skill is restructured for progressive disclosure — `SKILL.md` trimmed 328 -> 162 lines (the inline v0.1.17–v0.1.25 changelog dropped, capabilities de-versioned) with the full command catalog and MCP tool surface moved to `skills/cool-workflow/references/commands.md`, loaded on demand. The empty, unused `architecture-review-workflow` skill shell was removed.

## 0.1.42

- Robust result ingest. The v0.1.41 live-drive value experiment exposed the agent backend's real failure mode: a capable model produces excellent, line-cited analysis but emits it under its own keys (`candidate_risks`, `invariants`, …) or as prose — not CW's exact `{summary, findings, evidence}` schema — so CW captured ZERO findings/evidence and "accepted" it anyway (auditability as theater). Ingest now reads the CONTENT instead of trusting the agent's formatting: a new `result-normalize` module keeps canonical results byte-identical (backward compatible) but normalizes every finding (id guaranteed, `high`→P1 severity coercion, missing-id repair), extracts findings from alternative array keys, and DERIVES the evidence itself by harvesting grounded locators (path:line / URL / namespace:value) from the whole envelope JSON AND the prose (top-level cap 256, per-finding cap 32). `recordWorkerOutput`/`recordResult` now emit a `worker.capture-warning` (node metadata + trust-audit event) on any accepted result that captured no findings and no evidence — surfaced, never silently passed. Pure and deterministic (replay-safe). Validated live: re-running the full `architecture-review` drive on a real 367-file repo completes 14/14 workers and commits a verifier-gated verdict with 28 ranked, line-cited findings (was 0 captured pre-fix), verified real against the source.

## 0.1.41

- Hardening from the v0.1.41 architecture self-audit (all behavior-preserving for legitimate flows): evidence-gated commits now require GROUNDED evidence locators (path / URL / `namespace:value`) for required-evidence tasks, P0/P1/P2 findings, and verifier-gated commits — closing the "presence != existence" trust-on-self-report gap — with opt-in `CW_REQUIRE_RESOLVABLE_EVIDENCE` resolving file locators on disk and failing closed; the trust-audit event log is appended with fsync and its summary/index written durably (survives power loss like state.json); path containment is symlink-hardened via `realResolve`/`isContainedPath` (realpath of the deepest existing ancestor) in the sandbox read/write checks and the reclamation free/re-point proofs; `createWorkerId` is deterministic (per-task sequence, no `Math.random()`/wall-clock; snapshot fingerprint already excludes workerId so replay is unchanged); and coordinator decision secret-redaction recurses into nested objects/arrays.
- Maintainability from the same self-audit (behavior-preserving, verified by an 11-agent adversarial review + full release:check): the execution backend's `descriptor.id ===` switches are replaced by a `registerBackend` driver registry where each driver self-describes (spawnStyle / delegateRun / buildHandle / commandlessDelegate / runtimeNote / probe), so adding a backend touches no central switch; and the ~2100-line `CoolWorkflowRunner` god-object is decomposed into per-domain operation modules under `src/orchestrator/` (audit, candidate, collaboration, multi-agent+blackboard, host, feedback, topology, lifecycle, migration), leaving the runner a pure `loadRun -> delegate` router (986 lines, -54%) over its instance bootstrap.

## 0.1.40

- Added Durable State & Locking (reclamation-durability hardening from the v0.1.39 architecture self-audit): `state.ts:writeJson` is now atomic (temp -> rename) for every authoritative write — a crash/ENOSPC mid-write can no longer truncate state.json — with fsync-durability for the audit-essential stores (state.json, registry overlays, scheduler store, reclaimed.json). A portable stale-stealing `withFileLock` now serializes the cross-process read-modify-write stores (home queue add/drain, archive overlay, repos registry, reclamation chain). Reclamation's result-node re-point moved INSIDE the write-ahead boundary (`prepareFree`: re-point -> durable persist -> prove no node references a freed path / `loadNodeSnapshot` valid, fail-closed `repoint-incomplete`, before any byte is freed), the tombstone-chain build+commit is lock-serialized, and `validateSkeleton` now refuses (`skeleton-incomplete`) when extraction dropped commits/evidence the run actually has.

## 0.1.39

- Added Run Retention & Provable Reclamation: a tiered (live -> archived -> reclaimed), append-only, cryptographically-verifiable disk GC over the v0.1.28 archive overlay. `gc plan` (dry-run, frees nothing), `gc run` (write-ahead transaction: seal skeleton -> write tombstone with a pre-deletion sha256 per path -> fsync into reclaimed.json -> free bulk), and `gc verify` (re-prove skeleton-complete + hash-chain untampered + reconstructable artifacts re-derived from RETAINED inputs). Fail-closed eligibility, explicit/queryable capability downgrade, eager worker-scratch reclaim with result-node re-pointing, and a SKELETON_REQUIRED_KEYS contract. CW never reclaims by default.

## 0.1.38

- Added Agent Delegation Drive: spawn an external agent process per worker to fulfill each worker, capture result.md + attestation, and auto-drive plan->dispatch->fulfill->accept->commit

## 0.1.37

- Added Control-Plane Scheduling: priority + concurrency limits + lease lifecycle + retry/backoff + park policy over the v0.1.28 Run Registry queue; policy-as-data, fail-closed, deterministic

## 0.1.36

- Added Contract Migration Tooling: first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover over the existing migrateRunState pipeline

## 0.1.35

- Added Node Snapshot / Diff / Replay: per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness and v0.1.25 fingerprint/freshness pattern

## 0.1.34

- Added Real Execution Backend Integrations: container/remote/ci backends really drive docker/podman, a remote runner, and a CI job — opt-in, fail-closed, byte-stable evidence vs node

## 0.1.33

- Added Release Tooling: one-command version bump across every surface plus a per-feature scaffolder, and a de-duplicated release gate
- Architecture pass — same fail-closed discipline applied to the build itself:
  - `dist/` drift gate: `dist:check` snapshots `dist/`, rebuilds, and fails closed
    if the output differs (git-independent, so a consistent uncommitted tree is not
    punished); CI also fails on committed drift via `git status --porcelain`. Wired
    into `release:check` as the `dist freshness` gate.
  - Smoke runner: the 30-deep `&&` chain in `npm test` is replaced by a
    discovery-based runner (`test/run-all.js`) that isolates each smoke in its own
    process, continues past failures with per-file PASS/FAIL reporting, and fails
    closed on a smoke that exists on disk but was never wired in (which surfaced
    `multi-agent-eval-replay-smoke.js`, silently dropped from the old chain).
    `test:fast` opts into parallelism.
  - `types.ts` (3095 lines) split into domain files under `src/types/` behind a
    barrel; every importer keeps importing `./types` and the exported surface is
    byte-identical.
  - `orchestrator.ts` decomposed: report rendering and CLI option parsing extracted
    into `src/orchestrator/report.ts` and `src/orchestrator/cli-options.ts`.

## 0.1.32

- Added Team Collaboration: the human-decision layer on top of the existing
  verifier-gated runtime. A host-attested `Actor`, append-only approvals,
  rejections, comments, and handoffs, and a review gate that STACKS ON the verifier
  gate. Before v0.1.32 there was no review/approval/comment/handoff/identity
  concept; the foundations (trust-audit `actor`, candidate `selectedBy`, role
  policies, verifier-gated commits) already existed, and this release layers on top
  of them without changing them.
- IDENTITY IS ATTESTED, NOT AUTHENTICATED. An `Actor` is host-attested provenance
  (`host-attested`/`operator-recorded`), never an authenticated principal — CW is
  not an auth server. An absent identity is the explicit `unattributed` actor
  (`{ kind: "unattributed", attested: false }`), never a fabricated one;
  unattributed approvals surface honestly and never count. Extends the trust-audit
  `actor` field and the v0.1.29/v0.1.31 attestation pattern.
- APPEND-ONLY, PROVENANCE-LINKED. `approve`/`reject`/`comment add`/`handoff` append
  records to `run.collaboration` (additive/optional state; pre-v0.1.32 runs load
  unchanged) and link each to a `collaboration.*` trust-audit event. The approved
  artifact is NEVER edited in place — "who approved what" is a provenance link, not
  a field overwrite; a correction is a NEW record via `supersedes`. "Who approved
  which candidate/commit" is answered from the records.
- REVIEW GATES STACK ON THE VERIFIER GATE; THEY NEVER BYPASS IT. `reviewGateErrors`
  runs INSIDE `resolveCommitGate` (and `selectCandidate`) AFTER the verifier checks
  and can only ADD a required-approvals constraint. An approval can never turn an
  unverified result into a committed one. A gate-satisfied commit is stamped with a
  `CommitReviewProvenance` recording WHO approved the very artifact that shipped.
- FAIL CLOSED ON AUTHORITY AND QUORUM. `deriveReviewState` counts only distinct,
  attested, authorized, non-self approvals; short of `requiredApprovals` the status
  is `pending`/`blocked`/`unattributed`/`rejected` and the commit is BLOCKED, the
  failure recording exactly which approvals are missing. Self-approval, quorum,
  authorized roles, and attestation requirements are configurable POLICY as data
  (`review policy`), default off (`requiredApprovals: 0`).
- COLLABORATION IS STATE, NOT CHAT. Comments attach to a durable target
  (`run|task|candidate|selection|commit|node`); a handoff is an explicit ownership
  transfer (from-actor → to-actor, reason) and the current owner is DERIVED from the
  latest handoff, never overwritten. A `ReviewStatusReport` exposes per-target
  review state and a chronological timeline.
- ONE SOURCE, EVERY SURFACE. `approve`, `reject`, `comment add|list`, `handoff`,
  `review status`, and `review policy` are declared once in the capability registry,
  so `cw <cmd> --json` is identical to `cw_<tool>` (read-only `review status`/
  `comment list` proven byte-for-byte by the payload-identity probe). The v0.1.30
  Workbench renders a read-only review/collaboration panel; the v0.1.31 metrics
  report adds derived approval-rate, time-to-approval, handoff-count, and
  reviewer-count from recorded timestamps (deterministic over a fixed snapshot).

## 0.1.31

- Added Observability + Cost Accounting: a derived per-run report
  (`cw metrics show`) and cross-repo rollup (`cw metrics summary`) covering
  time/duration, failure rate, verifier pass rate, candidate acceptance rate, and
  token/cost. The metrics are a DERIVED PROJECTION of existing durable run state —
  timestamps → durations, verifier nodes → pass rate, candidates → acceptance
  rate, failed workers/memberships/feedback → failure rate. There is NO metrics
  database, NO background collector daemon, and NO hidden counter, following the
  v0.1.25 state-explosion and v0.1.28 registry discipline.
- COST IS ATTESTED, NEVER MEASURED OR FABRICATED. CW does not call the model; the
  host/worker does. An additive, optional `UsageRecord` is accepted on the
  EXISTING result/worker intake path (`cw result ... --usage-input-tokens N
  --usage-output-tokens M --usage-model ID`, and likewise `cw worker output`) and
  recorded verbatim as host-attested provenance on the task/worker record — never
  on `ResultEnvelope`, which stays stable. Absent usage is an explicit
  `unreported`, never 0. Cost is `attested` only when derived from attested usage
  × a recorded pricing policy with an exact model match; default/fallback pricing
  is a SEPARATE `estimated` figure, and the two are never conflated. `unpriced`
  (attested usage, no policy) and `unreported` (no usage) are surfaced with
  coverage.
- A COUNTER YOU CANNOT TRUST IS WORSE THAN NONE. Every rate is a `RateMetric` with
  `state` (`ok`/`n/a`), `count`, `total`, `rate`, and per-bucket sample counts; a
  rate over zero samples is `n/a` with null count/rate — never a fabricated
  0%/100%. Durations come from recorded timestamps (`dispatchedAt`→`completedAt`,
  worker `createdAt`→output `recordedAt`, run `createdAt`→`updatedAt`); in-flight
  items are marked explicitly with a null duration.
- DETERMINISTIC & REPLAYABLE. `deriveMetricsReport(run, { now, policy })` is a
  PURE function; wall-clock `now` is injected (the only now-derived field is
  `generatedAt`), so a report over a fixed snapshot is byte-reproducible
  (eval/replay agnostic). The per-run report persists a rebuildable, fingerprinted
  snapshot under `.cw/runs/<id>/metrics/`; the cross-repo summary reports each
  run's snapshot freshness as `valid|stale|absent` against current source — fail
  closed.
- MECHANISM VS POLICY. The runtime records attested usage and derives
  rates/durations; the pricing table is POLICY supplied as DATA (`CostPolicy`),
  kept out of the kernel. A bundled EXAMPLE policy lives at
  `manifest/pricing.policy.json`; `--pricing <path>|default` selects one. The same
  attested usage yields different cost under different pricing without touching the
  runtime.
- ONE SOURCE, EVERY SURFACE. `metrics.show` and `metrics.summary` are declared in
  `src/capability-registry.ts`, so `cw <cmd> --json` is byte-identical to
  `cw_<tool>` (now-derived `generatedAt` neutralized by the parity probe, which
  gains `metrics.show`/`metrics.summary` probes). The v0.1.30 Workbench renders a
  new read-only metrics panel from the same payload, showing coverage and
  `unreported`/`n/a` honestly.
- BACKWARD COMPATIBLE, ADDITIVE. Usage/cost fields are additive and optional; old
  runs load and report `unreported` cost while still yielding correct time and
  rate metrics from their existing timestamps and outcomes. The run-state and
  `ResultEnvelope` schemas are unchanged (run-state schema version stays 1).
- Docs: `docs/observability-cost-accounting.7.md` (added to `docs/index.md`).
  Tests: `test/observability-cost-accounting-smoke.js` proving durations from
  recorded timestamps, correct rates with sample counts, `n/a` on zero samples,
  attested-vs-estimated cost separation, `unreported` surfaced with coverage,
  determinism over a fixed snapshot, and `cw <cmd> --json` == `cw_<cmd>`; wired
  into `npm test`, `release:check`, and `parity:check`.

## 0.1.30

- Added the Web / Desktop Workbench: a human-facing console rendering a run's
  five operator surfaces — run graph, blackboard, worker logs, candidate compare,
  and audit timeline — plus a cross-run entry point over the v0.1.28 Run Registry.
  It is a THIRD FRONT DOOR alongside the CLI (human speed) and MCP (machine
  context): all three are presentation policy over ONE mechanism (the kernel +
  durable `.cw/` state).
- NO HIDDEN DASHBOARD. The Workbench holds ZERO authoritative state. It is a
  stateless, read-only RENDERER over the durable `.cw/` files and existing
  capability payloads; refresh re-derives everything from disk, and deleting the
  host loses nothing — the data IS the files. The view models in `src/types.ts`
  (`WorkbenchRunView`, `WorkbenchPanel`, `WorkbenchServeDescriptor`) are DERIVED
  projections that embed existing payloads; no run/state schema is forked.
- ONE MECHANISM, THREE RENDERINGS. `src/workbench.ts` assembles every panel by
  calling the SAME capability core entries the CLI/MCP route through. Each
  `workbench.view` panel equals its underlying `cw <cmd> --json` payload
  byte-for-byte, parity-gated via a new `workbench.view` probe in
  `scripts/parity-check.js`. The Workbench can show nothing the CLI/MCP cannot.
- New declared capabilities `workbench.view` and `workbench.serve`
  (`src/capability-registry.ts`), CLI `cw workbench view|serve`, and MCP tools
  `cw_workbench_view` / `cw_workbench_serve`. `cw_workbench_serve` returns the
  serve descriptor only (an MCP stdio host cannot start a blocking server) — the
  single declared, documented payload divergence; the descriptor itself is
  identical across surfaces.
- LEAST PRIVILEGE, LOCAL BY DEFAULT. The optional host (`src/workbench-host.ts`)
  binds `127.0.0.1` ONLY, is read-only (every route is `GET`; writes are refused
  `405`), rejects non-localhost `Host` headers (`403`, a DNS-rebinding defense)
  and path traversal (`403`), and fails closed on unreadable/stale state.
- OPTIONAL SURFACE. The Workbench (and its dependency-light static UI under
  `ui/workbench/`) is not a required dependency of the SDK: the committed `dist/`
  and a plain `node` runtime keep working with it absent. The kernel imports the
  Workbench never; the Workbench imports the kernel. No heavy frontend framework
  enters the runtime package.
- Docs: `docs/web-desktop-workbench.7.md` (added to `docs/index.md`). Tests:
  `test/web-desktop-workbench-smoke.js` (panel parity, read-only/localhost host,
  freshness honesty, SDK-without-Workbench), wired into `npm test`,
  `release:check`, `parity:check`, and `version:sync`. No run-state schema change;
  no migration required.

## 0.1.29

- Added Execution Backends: the execution layer is lifted OUT of the kernel into
  pluggable, swappable drivers — `node`, `bun`, `shell`, `container`, `remote`,
  and `ci` — behind ONE narrow `ExecutionBackend` contract
  (`src/execution-backend.ts`). Modeled on a BSD VFS / device-driver layer, the
  kernel (orchestrator/dispatch/pipeline-runner) contains NO backend-specific
  branching; all execution flows through the driver. WHAT to run and which
  evidence to record is kernel policy; HOW and WHERE it runs is the driver's
  concern.
- Added backend/driver types to `src/types.ts` (`ExecutionBackend`,
  `BackendDescriptor`, `BackendCapability`, `ExecutionRequest`,
  `ExecutionResultEnvelope`, `SandboxAttestation`, `BackendSelection`,
  `BackendProbeResult`, `SandboxDimension`) with explicit readiness/support/
  attestation enums. They reuse existing dispatch/worker/result/sandbox/
  provenance types and never fork them; the `ResultEnvelope` schema is unchanged.
- The sandbox profile is the contract: every backend maps the five dimensions
  (read/write/command/network/env) onto enforce/attest/unsupported and records a
  `SandboxAttestation`. A backend that cannot enforce or attest a required
  dimension, is not ready, or is handed a profile-denied command FAILS CLOSED
  (`status: "refused"`) — it never silently downgrades to unsandboxed execution.
- Identical envelopes, any backend: the result/evidence envelope and provenance
  are schema-identical regardless of which backend ran a task. CW's own
  self-verify produces byte-stable result/evidence on `node`, `shell`, and `bun`;
  only `provenance.backendId` and the attestation differ. The default (`node`)
  backend reproduces pre-v0.1.29 behavior exactly.
- CW delegates; it does not become the executor. `container`/`remote`/`ci` are
  delegating drivers that record a handle + attestation + result and fail closed
  when no delegation target is configured. CW does not reimplement a container
  runtime or a CI system.
- Selection mirrors `--sandbox`: a parallel `--backend <id>` flag (and
  `CW_BACKEND` env, then `node` default) on `dispatch`, `multi-agent step/run`,
  plus `backend list|show|probe`. All declared once in `src/capability-registry.ts`
  (3 new capabilities) so `cw <cmd> --json` is schema-identical to `cw_<tool>` and
  passes the v0.1.27 parity gate; `backend.list` is added to the parity payload
  probe.
- Durable, inspectable state: the selected backend + attestation are recorded per
  task in the dispatch manifest, worker scope, and worker manifest (a `backend`
  block alongside `sandbox`), and the v0.1.28 run registry surfaces a record's
  distinct `backends`. Operator status/report show backend + attestation per
  worker. Eval/replay, the verifier gates, and the registry stay backend-agnostic.
- Added `docs/execution-backends.7.md` and `test/execution-backends-smoke.js`
  (wired into `npm test`, `release:check`, and `version:sync`) proving byte-stable
  envelopes across node/shell/bun, the fail-closed refusals, recorded provenance +
  delegation handles, and the backend-agnostic verifier/registry.

## 0.1.28

- Added the Run Registry / Control Plane: a layer that manages MANY workflow runs
  across repositories — search, resume, archive, a durable queue, cross-repo
  history, and failed-run rerun — over the per-run `.cw/runs/<id>/state.json`,
  which remains the single source of truth.
- Added `src/run-registry.ts` (`RunRegistry`): a DERIVED, rebuildable index over
  runs. It scans source `state.json`, classifies lifecycle, and never mutates
  source. Mechanism vs policy — retention windows, queue ordering, and archive
  thresholds are configurable (`RunRegistryPolicy`, flags), not baked into the
  index.
- Added registry/index/lifecycle types to `src/types.ts` (`RunRecord`,
  `RunRegistryIndex`, `RunRegistryReport`, `RunLifecycleState`, `RunQueueEntry`,
  `RunProvenance`, `RunSearchResult`, `RunResumeResult`, `RunRerunResult`,
  `RunHistoryResult`, `RunShowResult`) with explicit status enums including the
  fail-closed `stale`/`missing` states. They reuse existing run/state types and
  never fork them.
- Documented lifecycle state machine (`queued → running → blocked → completed →
  failed → archived`), derived from source state and never invented; `archived`
  is an overlay that preserves the underlying `derivedLifecycle` for search.
- Cross-repo discovery is plain files under a home registry resolved from
  `CW_HOME`, then `XDG_STATE_HOME/cool-workflow`, then
  `~/.local/state/cool-workflow`: `repos.json` (registered roots), `index.json`,
  and `queue.json`, plus per-repo `.cw/registry/{index,archive,provenance}.json`.
  No hidden database; no daemon required to read state.
- Added CLI commands and MCP tools, each declared once in the v0.1.28 capability
  registry so `cw <cmd> --json` is schema-identical to `cw_<tool>`: `registry
  refresh|show`, `run search|list|show|resume|archive|rerun`, `queue
  add|list|drain|show`, and cross-repo `history` (13 new capabilities; the
  registry now declares 145 capabilities across 142 MCP tools).
- Resume resolves a run by id across repos and continues from durable state
  (read-only over source). Archive is an overlay mark that never deletes source
  truth and keeps the run searchable. Rerun creates a NEW run that links to the
  original via provenance (`rerunOf`/`originRunId`/`generation`); the failed run
  is preserved for audit.
- Fail closed: tampered source surfaces as `stale` (named in `staleRuns`),
  missing source as `missing` (named in `missingRuns`, never fabricated into the
  records), and `run show` of a deleted run returns `found: false` /
  `freshness: missing` rather than a live status.
- Added `test/run-registry-control-plane-smoke.js` proving cross-repo indexing,
  search determinism, resume-by-id, queue ordering, archive without data loss,
  rerun provenance linkage, fail-closed `stale`/`missing`, and CLI ↔ MCP payload
  identity. Wired into `npm test` and `npm run release:check`.
- Added `docs/run-registry-control-plane.7.md` (index model, lifecycle state
  machine, queue/archive/rerun semantics, cross-repo layout) and added it to
  `docs/index.md`.
- No run-state schema change. Pre-0.1.28 single-repo runs and existing
  `.cw/runs/` layouts keep working with an empty, rebuildable registry, and every
  pre-0.1.28 CLI command and MCP tool keeps working.

## 0.1.27

- Added CLI ↔ MCP Parity: a formal, tested guarantee that the command-line
  surface and the MCP surface are two renderings of ONE data source (mechanism
  vs policy — the shared core is the single source of truth, rendering is the
  only difference).
- Added `src/capability-registry.ts`: the single declared registry of every
  capability (`CapabilityDescriptor`, `ParitySurface`, `ParityReport`), mapping
  each capability to its CLI command, MCP tool, shared core `entry`, and JSON
  contract. The CLI dispatch tokens and the MCP tool list are validated against
  it; a capability on only one surface must be recorded as surface-specific with
  a reason or the gate fails closed.
- Added `src/capability-core.ts`, relocating composite logic (`planSummary`,
  `appRun`, `sandboxChoose`, `commitEnvelope`, `compactOperatorStatus`) out of
  `mcp-server.ts` so no capability logic lives on only one surface.
- Closed surface gaps: added MCP tools `cw_init`, `cw_next`, `cw_state_check`,
  `cw_contract_show`, `cw_node_list`, `cw_node_show`, `cw_node_graph`; added CLI
  commands `app run`, `operator status`, `operator report`, `sandbox choose`,
  `sandbox resolve`, and `report --json`. The registry now declares 132
  capabilities across 129 MCP tools.
- Added `scripts/parity-check.js` (`npm run parity:check`) and
  `test/cli-mcp-parity-smoke.js`: fail-closed gates asserting registry⇄CLI⇄MCP
  coverage, `cw <cmd> --json` == `cw_<tool>` payload identity on a real run, and
  drift detection on injected divergence. Wired into `release:check` and
  `npm test`.
- Added `docs/cli-mcp-parity.7.md` (the parity matrix and the human-vs-machine
  contract); the only declared payload projection is `commit` (raw
  StateCommitResult for the CLI vs an operator envelope for `cw_commit`, both
  from the single entry `runner.commit`).
- Added an additive `disposition` (`adopted` | `inspectable` | `blocking`) to
  multi-agent operator evidence rows, plus an `inspectableEvidence` summary list.
  Once a run has a verifier-gated commit, the selected path is decided, so
  missing/pending evidence for sibling roles never driven as separate workers
  (e.g. undriven judge-panel judges) is reported as inspectable operator state,
  not a hidden failure. The raw `status` field is unchanged; `disposition` is the
  operator-facing reading. The human `multi-agent status` and `status` views
  label these rows accordingly.
- CI (`.github/workflows/ci.yml`) now runs `npm test` and `npm run release:check`
  on every push and pull request, not just `install`/`build`/`check`/`list`.
- No run-state schema change. Pre-0.1.27 runs load unchanged and every
  pre-0.1.27 CLI command and MCP tool keeps working.

## 0.1.26

- Added the Evidence Adoption Reasoning Chain: a derived, versioned,
  provenance-backed view that explains *why* each evidence item was adopted,
  rejected, superseded, or conflicting, complementing the existing *what* in
  `multi-agent evidence`.
- Added derived record types (`EvidenceReasoningStep`, `EvidenceReasoningChain`,
  `EvidenceReasoningReport`) in `src/types.ts` with status enums including the
  fail-closed `unexplained` state. They reuse existing provenance / trust /
  rationale types by reference and never fork them.
- Added `src/evidence-reasoning.ts`, which derives, per gate (`fanin`,
  `candidate-score`, `selection`, `verifier`, `commit`), the decision, basis
  (evidence refs + provenance source + audit ids), authority
  (role/membership/worker + role `policyRef`), rationale (selection reason,
  acceptance rationale, score notes/verdict, verifier gate, commit reason,
  coordinator decision, judge rationale), and counterfactual (rejected
  candidates, failed scores, rejected/superseded decisions). No new
  source-of-truth records are mutated.
- Added durable storage under `.cw/runs/<run-id>/reasoning/` (`index.json` +
  per-chain records + `report.json`) with a `sourceFingerprint` and
  `valid|stale|absent` freshness, mirroring the v0.1.25 summaries pattern. Raw
  results, candidates, scores, selections, commits, and audit records are never
  deleted or overwritten.
- Added `multi-agent reasoning <run-id> [--evidence <id>] [--refresh]
  [--json|--format json]` and integrated an additive `rationaleStatus`
  (`explained|unexplained|not-applicable`) into `multi-agent evidence` rows.
  Added a single new console panel, `Adoption Rationale`.
- Added MCP parity: `cw_evidence_reasoning` and `cw_evidence_reasoning_refresh`,
  mirroring the CLI contract exactly.
- Reasoning steps are on the critical path and are exempt from state-explosion
  compaction: every decision-gate node backing an adopted chain (notably score
  nodes, otherwise collapsible) is protected and never collapsed into a synthetic
  summary node.
- Fail closed, never infer: an adoption whose rationale cannot be traced renders
  as `unexplained` and is never silently treated as explained.
- Eval/replay now regression-gates reasoning with new replay-stable metrics:
  `reasoning_freshness`, `reasoning_chain_parity`, and
  `reasoning_unexplained_parity`. Pre-0.1.26 snapshots load with empty reasoning
  sections, preserving backward compatibility.
- Added `docs/evidence-adoption-reasoning-chain.7.md` (added to the docs reading
  order) and `test/evidence-adoption-reasoning-smoke.js`, included in `npm test`
  and `npm run release:check`.

## 0.1.25

- Added State Explosion Management: a derived, versioned, provenance-backed
  summarization and compaction layer for large multi-agent runs.
- Added durable summary records (`MultiAgentSummaryIndex`,
  `BlackboardSummaryRecord`, `GraphSummaryRecord`, `OperatorDigest`,
  `StateExplosionReport`) under `.cw/runs/<run-id>/summaries/`. Raw blackboard,
  graph, audit, and evidence records are never deleted or overwritten.
- Added `blackboard summarize` (deterministic blackboard digest), `multi-agent
  summarize`, `summary refresh`, `summary show`, and compact/focused graph views
  via `multi-agent graph --view <view> [--focus <id>] [--depth <n>]`. Compact
  views collapse high-volume records into synthetic summary nodes that expose
  collapsed counts, source ids, dominant status, blocked reason, and an
  expansion command. The critical path, failures, missing evidence, policy
  violations, and judge rationale are never hidden.
- Summaries are stale-aware and fail closed: `summary show` recomputes the
  source fingerprint and reports `stale` when source records change.
- Added MCP parity: `cw_summary_refresh`, `cw_summary_show`,
  `cw_blackboard_summarize`, `cw_multi_agent_summarize`, and
  `cw_multi_agent_graph_compact`, all returning source refs and expansion hints.
- Eval/replay now captures and regression-gates summary artifacts with new
  metrics: `summary_freshness`, `compact_graph_parity`,
  `blackboard_digest_parity`, `critical_path_parity`, `evidence_digest_parity`,
  and `expansion_ref_integrity`. Pre-0.1.25 snapshots load with empty summary
  sections, preserving backward compatibility.
- Summary generation is recorded in the trust-audit log (`summary.refresh`,
  `summary.stale`) without storing secrets or large raw message bodies.
- The run report now includes a `## State Size & Compaction` section, and
  `report --show` appends the state-explosion panels.
- Added `docs/state-explosion-management.7.md` and
  `test/state-explosion-management-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.24

- Added a robustness hardening pass for state loading, migrations, MCP tool
  calls, multi-agent persistence, blackboard persistence, and eval/replay
  artifact parsing.
- State JSON parse failures now include deterministic file-path context, and
  migrations fail closed when known fields are present with unsupported shapes
  instead of silently replacing malformed data.
- MCP `tools/call` now rejects malformed argument payloads and missing required
  arguments with actionable operator errors.
- Multi-agent and blackboard plain-file mirrors now reject safe-file-name id
  collisions before persistence.
- Eval/replay commands now validate snapshot, replay, and baseline artifact
  shape before scoring or comparing.
- Added `test/robustness-hardening-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.23

- Added Multi-Agent Eval & Replay Harness with deterministic replay snapshots,
  isolated replay runs, normalized comparison, scoring, fail-closed gate, and
  markdown reports under `.cw/evals/<suite-id>/`.
- Added CLI commands: `eval snapshot`, `eval replay`, `eval compare`,
  `eval score`, `eval gate`, and `eval report`, each with deterministic JSON
  through `--json` or `--format json`.
- Added MCP parity tools: `cw_eval_snapshot`, `cw_eval_replay`,
  `cw_eval_compare`, `cw_eval_score`, `cw_eval_gate`, and `cw_eval_report`.
- Added replay metrics for graph, dependencies, evidence adoption,
  trust/policy/audit, policy violations, blackboard provenance, judge
  rationale, candidate scoring, selection, verifier-gated commit readiness, and
  report parity.
- Added `npm run eval:replay`, `docs/multi-agent-eval-replay-harness.7.md`,
  and `test/multi-agent-eval-replay-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.22

- Added Multi-Agent Trust / Policy / Audit on top of the existing trust-audit
  layer, with role policies, permission decisions, blackboard write audit,
  message provenance, judge rationale, panel decisions, and policy violations.
- Added policy-aware fail-closed checks for blackboard writes, candidate
  scoring/selection, missing evidence, and missing judge rationale.
- Added focused CLI views: `audit multi-agent`, `audit policy`, `audit role`,
  `audit blackboard`, and `audit judge`, with deterministic JSON output.
- Added MCP parity tools: `cw_audit_multi_agent`, `cw_audit_policy`,
  `cw_audit_role`, `cw_audit_blackboard`, and `cw_audit_judge`.
- Integrated multi-agent trust projections into status/report/audit operator
  views and preserved existing v0.1.21 multi-agent operator UX commands.
- Added `docs/multi-agent-trust-policy-audit.7.md` and
  `test/multi-agent-trust-policy-audit-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.21

- Added Multi-Agent Operator UX as a derived read-only model over WorkflowRun,
  topology, multi-agent, blackboard, candidate, commit, feedback, and trust
  audit state.
- Added focused CLI views: `multi-agent dependencies`, `multi-agent failures`,
  and `multi-agent evidence`, plus a fuller `multi-agent graph` for operator
  inspection.
- Added `summaries.multiAgentOperator` to the high-level
  `multi-agent status --json` host envelope and extended MCP parity with
  `cw_multi_agent_dependencies`, `cw_multi_agent_failures`, and
  `cw_multi_agent_evidence`.
- Added evidence adoption tracing from worker output through blackboard/fanin,
  candidate score, selection, and verifier-gated commit records.
- Added compact failure rows for missing role coverage, missing worker output,
  failed/rejected workers, open feedback, fanin blockers, score/selection gaps,
  verifier gaps, and commit gate readiness.
- Added `docs/multi-agent-operator-ux.7.md` and
  `test/multi-agent-operator-ux-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.20

- Added the high-level Multi-Agent CLI + MCP Surface for the host loop:
  `multi-agent run -> status -> step -> blackboard -> score -> select`.
- Added JSON-first CLI responses and MCP tools:
  `cw_multi_agent_run`, `cw_multi_agent_status`, `cw_multi_agent_step`,
  `cw_multi_agent_blackboard`, `cw_multi_agent_score`, and
  `cw_multi_agent_select`.
- Composed the host surface over existing topology, multi-agent, blackboard,
  candidate, commit, and audit primitives without replacing the kernel state
  model.
- Added fail-closed handling for ambiguous topology/blackboard state, incomplete
  fanin, missing score evidence, unscored candidates, and unsafe selection.
- Added host-friendly blackboard operations with provenance-preserving message,
  artifact, context, and snapshot actions.
- Added `docs/multi-agent-cli-mcp-surface.7.md` and
  `test/multi-agent-cli-mcp-surface-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.19

- Added Multi-Agent Topologies as official userland recipes over Multi-Agent
  Runtime Core and Coordinator / Blackboard.
- Added typed topology contracts and durable topology run records under
  `.cw/runs/<run-id>/topologies/`.
- Added official `map-reduce`, `debate`, and `judge-panel` definitions with
  roles, groups, blackboard topics, phases, fanout/fanin strategy, required
  evidence, coordinator decision expectations, candidate expectations, and
  verifier gates.
- Added `cw topology list|show|validate|apply|summary|graph` plus MCP parity
  through `cw_topology_*` tools.
- Added Topologies panels to `status` and `report --show`, topology graph
  nodes/edges, trust-audit topology event counts, and evidence provenance links
  through generated multi-agent and blackboard records.
- Preserved fail-closed fanin behavior for missing mapper evidence, debate
  messages/decisions, and judge-panel evidence.
- Added `docs/multi-agent-topologies.7.md` and
  `test/multi-agent-topologies-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.18

- Added Coordinator / Blackboard as the shared coordination substrate for future
  debate, judge, map-reduce, swarm, committee, and synthesis topologies.
- Added durable `Blackboard`, `BlackboardTopic`, `BlackboardMessage`,
  `BlackboardContext`, `BlackboardArtifactRef`, `BlackboardSnapshot`, and
  `CoordinatorDecision` records with schema versions, stable ids, timestamps,
  authorship, scope, status, parent refs, tags, metadata, and cross-links.
- Added `.cw/runs/<run-id>/blackboard/` storage with deterministic
  `index.json`, append-friendly `messages.jsonl`, and per-record JSON mirrors
  for topics, contexts, artifacts, snapshots, and decisions.
- Added explicit conflicting context handling, artifact indexing, snapshot
  creation, coordinator decisions, ready-for-fanin summaries, Operator UX
  panels, graph nodes/edges, and report output.
- Added CLI and MCP parity for blackboard summary, topics, messages, context
  frames, artifacts, snapshots, coordinator summary, and coordinator decisions.
- Linked Multi-Agent Runtime records, worker manifests, accepted worker output,
  fanin evidence coverage, trust audit events, candidates, commits, and reports
  to blackboard provenance.
- Added migration normalization so older runs load with empty blackboard state
  while preserving unknown user data.
- Added `docs/coordinator-blackboard.7.md` and
  `test/coordinator-blackboard-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.17

- Added Multi-Agent Runtime Core with durable `MultiAgentRun`, `AgentRole`,
  `AgentGroup`, `AgentMembership`, `AgentFanout`, and `AgentFanin` records.
- Added lifecycle validation for multi-agent runs and fail-closed membership,
  duplicate assignment, and missing fanin evidence handling.
- Added dispatch attachment so workers can carry multi-agent run, group, role,
  membership, and fanout metadata without replacing existing dispatch flows.
- Added multi-agent Operator UX panels, graph nodes/edges, report sections,
  trust audit events, and evidence provenance for membership output and fanin.
- Added CLI and MCP parity for multi-agent summary, graph, show, create,
  lifecycle transition, fanout, and fanin collection operations.
- Added fixture compatibility normalization so older runs load with empty
  multi-agent state while preserving unknown user data.
- Added `docs/multi-agent-runtime-core.7.md` and
  `test/multi-agent-runtime-core-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.16

- Added `npm run dogfood:release`, a dry-run release proof that uses the
  canonical `release-cut` app against the real Cool Workflow repository.
- Added real command evidence collection for git state, version surfaces,
  release docs, build/package checks, type checks, tests, fixture
  compatibility, canonical apps, golden path, `release:check`, and trust audit
  inspection.
- Added release candidate registration, evidence-backed scoring,
  verifier-gated selection, and verifier-gated CW state commit/checkpoint
  handling for the dogfood workflow.
- Added fail-closed release action gating so tag, push, and publish requests
  require explicit execute flags and target-version confirmation.
- Added `test/dogfood-release-smoke.js` and included it in `npm test` and
  `npm run release:check`.
- Added `docs/dogfood-one-real-repo.7.md` and updated README, Getting Started,
  release checklist, docs index, skill instructions, version surfaces, and
  generated runtime output.

## 0.1.15

- Added durable trust audit records under `.cw/runs/<run-id>/audit/` with
  append-friendly `events.jsonl` plus deterministic `index.json` and
  `summary.json`.
- Added worker sandbox audit coverage for selected profiles, policy snapshots,
  allowed output paths, denied out-of-profile paths, command/network/env
  validation decisions, feedback links, and host attestations.
- Added optional evidence provenance on `StateEvidence` while preserving
  backward compatibility for older run state.
- Added acceptance rationale for selected candidates and verifier-gated commits:
  candidate, score, criteria, verifier, evidence count, sandbox profile, worker,
  and commit gate result.
- Added CLI and MCP audit tools for summaries, worker audit, provenance,
  attestations, and policy decisions.
- Added `docs/security-trust-hardening.7.md` and
  `test/security-trust-hardening-smoke.js`.

## 0.1.14

- Added explicit run-state migration policy with `src/state-migrations.ts`,
  current schema/version constants, compatibility reports, and dry-run
  `state check` support.
- Added fixture-based backward compatibility coverage under
  `test/fixtures/runs/` for pre-app state, Sandbox Profiles, Workflow App SDK,
  Golden Path, Operator UX, and v0.1.13 MCP/App Surface runs.
- Added `npm run fixture-compat`, `npm run version:sync`, and the dry-run
  `npm run release:check` release gate.
- Centralized CW runtime version metadata at `0.1.14` and checks package,
  plugin, SDK, MCP, canonical app, test, docs, and `dist/` surfaces.
- Added docs index, Getting Started, and `docs/release-and-migration.7.md` in
  the spirit of operational `UPDATING` guidance.

## 0.1.13

- Completed the MCP / App Surface so agent hosts can run Workflow App SDK apps,
  inspect workers, record worker output, score/rank/select candidates, resolve
  sandbox profiles, create verifier-gated commits, and read operator summaries.
- Added `cw_app_run`, structured operator tools, worker tools, candidate tools,
  `cw_sandbox_choose`/`cw_sandbox_resolve`, and `cw_commit_summary` while
  preserving existing MCP tool names.
- Updated `cw_commit` MCP responses with top-level gate metadata, evidence
  counts, snapshot path, linked verifier/candidate/selection ids, and next
  actions.
- Added deterministic MCP stdio smoke coverage in
  `test/mcp-app-surface-smoke.js` and included it in `npm test`.
- Added `docs/mcp-app-surface.7.md` plus README, SDK, Operator UX, golden path,
  Unix principles, and skill documentation updates.
- Bumped package, plugin manifest, canonical app, SDK, and MCP server versions
  to `0.1.13`.

## 0.1.12

- Added Operator UX read-only summaries in `src/operator-ux.ts`.
- Made CLI `status` human-readable by default while preserving
  `status --json`, `status --format json`, `runner.status()`, and MCP
  `cw_status` structured output.
- Added top-level `graph <run-id>` with `--json` and kept `node graph`
  compatible.
- Added console report views with `report <run-id> --show` and `--summary`.
- Added human and JSON resource summaries for workers, candidates, feedback,
  and commits, including gated commit/checkpoint visibility.
- Added deterministic next-step recommendations for dispatch, worker output,
  feedback, candidate scoring/selection, verifier-gated commit, and report.
- Added `docs/operator-ux.7.md`, documentation updates, and
  `test/operator-ux-smoke.js`.
- Bumped package, plugin, canonical app, SDK, and MCP versions to `0.1.12`.

## 0.1.11

- Added canonical Workflow App SDK apps: `architecture-review`,
  `pr-review-fix-ci`, `release-cut`, and `research-synthesis`.
- Migrated the public `architecture-review` and `research-synthesis` ids into
  first-class app directories and renamed workflow-file compatibility wrappers
  to `legacy-architecture-review` and `legacy-research-synthesis`.
- Added `npm run canonical-apps`, a deterministic local matrix that validates,
  shows, and plans every canonical app with representative inputs.
- Added `test/canonical-workflow-apps-smoke.js` and included it in `npm test`.
- Updated canonical app docs, SDK docs, skill instructions, release metadata,
  MCP server version, and generated `dist/` files for `0.1.11`.

## 0.1.10

- Added the first-class `end-to-end-golden-path` Workflow App SDK app with one
  evidence-required readonly worker task.
- Added `npm run golden-path`, a deterministic Node standard-library runner
  that exercises app validation, planning, dispatch, worker isolation,
  `cw:result` recording, verifier nodes, candidate scoring/ranking/selection,
  verifier-gated commit, and report generation.
- Added durable golden path assertions for app metadata, sandbox policy,
  verified workers, result/verifier nodes, candidate records, score/ranking
  files, commit gate metadata, report content, and absence of ErrorFeedback.
- Added `test/end-to-end-golden-path-smoke.js` and included it in `npm test`.
- Documented the golden path release discipline and updated package, plugin, and
  MCP server versions to `0.1.10`.

## 0.1.9

- Added Workflow App SDK with `defineWorkflowApp`, `workflow`, `phase`,
  `agent`, `artifact`, and `input` helpers in `workflow-app-sdk`.
- Added durable workflow app metadata for schema version, id, title, summary,
  version, author, inputs, sandbox profiles, compatibility, and metadata.
- Added fail-closed app/workflow validation for ids, required fields, semver,
  inputs, limits, phases, duplicate task ids, evidence flags, sandbox profile
  references, and compatibility constraints.
- Added deterministic discovery for legacy `workflows/*.workflow.js` files and
  first-class `apps/<app-id>/app.json` app directories.
- Added CLI commands for `app list`, `app show`, `app validate`, `app init`,
  and `app package`.
- Added MCP tools `cw_app_list`, `cw_app_show`, `cw_app_validate`,
  `cw_app_init`, and `cw_app_package`.
- Added SDK app templates and the runnable `workflow-app-sdk-demo` example.
- Added app id/version/source metadata to run state, status summaries, and
  reports.
- Added smoke coverage for legacy planning, SDK app validation, invalid app
  failures, app CLI commands, sandbox hints, and app metadata.

## 0.1.8

- Added Sandbox Profiles as named, durable worker policy contracts.
- Added bundled `default`, `readonly`, `workspace-write`, and `locked-down`
  profiles with deterministic path normalization and traversal rejection.
- Added resolved sandbox policy data to worker scopes, worker manifests,
  dispatch manifests, run state, reports, and ErrorFeedback metadata.
- Added CLI commands for `sandbox list`, `sandbox show`, and `sandbox validate`.
- Added `dispatch --sandbox <profile-id>` and matching MCP sandbox tools.
- Preserved legacy `allowedPaths` as the effective write-path compatibility
  field.
- Added `sandbox-profiles.7.md` and smoke coverage for profile validation,
  manifests, CLI commands, and denied worker output feedback.

## 0.1.7

- Added Verifier-Gated Commit as a first-class commit path.
- Added commit metadata for `verifierGated`, checkpoint status, verifier nodes,
  candidate ids, selection ids, and verifier evidence.
- Made CLI commits fail closed unless `--verifier`, `--candidate`,
  `--selection`, or `--allow-unverified-checkpoint` is supplied.
- Added ErrorFeedback and error-node records for blocked commit attempts.
- Kept non-gated internal snapshots compatible as explicit checkpoints.
- Updated reports to distinguish verifier-gated commits from checkpoints.
- Added verifier-gated commit docs and smoke coverage.

## 0.1.6

- Added Candidate Scoring records for competing worker outputs.
- Added candidate registration, scoring, ranking, selection, rejection, and
  summary CLI commands.
- Added verifier-gated candidate selection with ErrorFeedback records for
  missing evidence or failed selection gates.
- Added candidate run state paths, report summaries, docs, and smoke coverage.

## 0.1.5

- Added Worker Isolation as an explicit boundary around dispatched task work.
- Added worker scope allocation, durable worker manifests, worker-local
  `input.md`, `result.md`, `artifacts/`, and `logs/` paths.
- Added worker CLI commands for listing, showing, manifest inspection, output
  recording, failure recording, and boundary validation.
- Connected worker output to result nodes, verifier nodes, ErrorFeedback, and
  report summaries.
- Added worker failure preservation for missing results and invalid output
  boundaries.
- Added `worker-isolation.7.md` and smoke coverage for worker manifests,
  accepted output, failed output, and CLI worker commands.

## 0.1.4

- Added ErrorFeedback as durable diagnostic and correction state for failed
  workflow operations.
- Added feedback records with status, severity, classification, source, code,
  retryability, evidence, artifacts, and resolution metadata.
- Added feedback collection from failed StateNode errors and pipeline failures.
- Added correction-task generation under run task files and verifier-gated
  feedback resolution.
- Added CLI and MCP surfaces for feedback list, show, collect, task, and
  resolve operations.
- Added `error-feedback.7.md`, report feedback sections, and smoke coverage for
  classification, tasking, resolution, and rejected corrections.

## 0.1.3

- Added Pipeline Runner as the contract-driven StateNode execution kernel.
- Added runnable pipeline-stage discovery and stage execution for the default
  `input -> plan -> dispatch -> result -> verify -> commit -> report` flow.
- Added contract-aware output node creation, parent/child linking, artifact and
  evidence attachment, and structured failure preservation.
- Added `contract show`, `node list`, `node show`, and `node graph` inspection
  commands.
- Added verifier-gated commit-stage handling while keeping non-gated snapshots
  as completed checkpoint nodes.
- Added `pipeline-runner.7.md` and smoke coverage for legal stage advancement,
  graph inspection, and preserved failure nodes.

## 0.1.2

- Added StateNode as the durable JSON representation for meaningful CW runtime
  transitions.
- Added PipelineContract as the ABI between workflow state, artifacts,
  evidence, verifier gates, and commit/report stages.
- Added explicit state-node creation, legal status transitions, parent/child
  linking, structured node errors, and contract validation.
- Added node and contract arrays to run state while keeping older runs readable
  through loader defaults.
- Added input, task, dispatch, result, verifier, commit, report, and error node
  kinds for inspectable workflow history.
- Added `state-node.7.md` and smoke coverage for node creation, transition
  validation, evidence requirements, and commit-gate invariants.

## 0.1.1

- Added `/loop`-compatible CLI shortcut via `cw.js loop`.
- Added local desktop scheduler daemon support with `schedule daemon`.
- Added scheduled-task pause, resume, run-now, and history commands.
- Added routine-style API and GitHub trigger bridge.
- Added MCP tools for new schedule controls and routine triggers.
- Reframed CW as an Agent Workflow SDK for developer workflows.
- Switched project license to BSD-2-Clause.
- Added Unix-inspired workflow principles for state, pipelines, isolation, and verifier-gated commits.

## 0.1.0

- Added TypeScript COL-Architecture runtime.
- Added explicit `interpret -> act -> observe -> adjust -> checkpoint` state
  machine.
- Added subagent dispatch manifests, deterministic harness prompts, evidence
  gates, adversarial verification, and state commit snapshots.
- Added MCP JSON-RPC 2.0 bridge.
- Added scheduled tasks for loop, cron, and reminder workflows.
- Added public package structure for GitHub distribution.

## 0.1.52
