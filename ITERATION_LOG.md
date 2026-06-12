# CW Iteration Log
| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | PipelineFailurePolicy.autoAdvance runtime | pipeline-runner.ts + test/pipeline-auto-advance-smoke.js | 1 test added | BUILD OK, 46/46 passed | no (cycle 1/4) |
| 2 | WorkerScope.retryCount runtime | worker-isolation.ts + test/worker-retry-count-smoke.js | 1 test added | BUILD OK, 47/47 passed | no (cycle 2/4) |
| 3 | ErrorFeedbackRecord.resolvedAt+resolutionNote runtime | error-feedback.ts + test/error-feedback-resolution-smoke.js | 1 test added | BUILD OK, 47/47 passed | no (cycle 3/4) |
| 4 | StateArtifact.sha256+sizeBytes runtime | state.ts + test/artifact-integrity-smoke.js | 1 test added | BUILD OK, 49/49 passed | yes (v0.1.73: failure-recovery infrastructure) |

## Batch — gated release flow (→ v0.1.75)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | deterministic release gate (build/test/substance/evidence/cadence/branch) + PREV_TAG/substance correctness fixes | scripts/release-gate.sh + test/release-gate-smoke.js | 1 test added (8 cases) | BUILD OK, suite green | no (cycle 1/4) |
| 2 | PreToolUse hook blocking unreviewed tags; node stdin parse (fail-closed, no jq) | scripts/block-unapproved-tag.sh + hooks/hooks.json + test/block-unapproved-tag-smoke.js | 1 test added (7 cases) | BUILD OK, suite green | no (cycle 2/4) |
| 3 | independent release-reviewer subagent + /release command driving gate→review→tag | agents/release-reviewer.md + commands/release.md + docs/prompts/reviewer-agent.md | covered by gate+hook smokes | BUILD OK, suite green | no (cycle 3/4) |
| 4 | out-of-band tag-push CI backstop + autonomous-agent operating contract | .github/workflows/release-gate.yml + AGENTS.md | covered by gate smoke (CI runs same script) | BUILD OK, suite green | yes (v0.1.75: gated, independently-reviewed release flow) |

## Batch — control-plane naming + version coherence (→ v0.1.76)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | rename term-of-art identifier workflow-app-sdk → workflow-app-framework (source, app id, fixture, version-sync needles) | src/workflow-app-framework.ts + apps/workflow-app-framework-demo + test/fixtures/runs/workflow-app-framework + version-sync-check.js | renamed smoke + compat fixture replay | BUILD OK, suite green | no (cycle 1/4) |
| 2 | scrub CW-as-SDK self-description (manifest descriptions, package.json, READMEs, AGENTS, docs); keep "no model SDK" red-line | manifest/plugin.manifest.json + package.json + README ×2 + docs/agent-framework.md | red-line guard smokes unchanged | BUILD OK, suite green | no (cycle 2/4) |
| 3 | regenerate vendor manifests + keyword control-plane; rebuild dist | .claude-plugin/.codex-plugin/.agents/.mcp.json (generated) + dist | gen:manifests --check, dist drift clean | BUILD OK, suite green | no (cycle 3/4) |
| 4 | fix version drift: bump internal 0.1.52 → 0.1.76 so package == release tag | bump:version across all surfaces + content docs + DIRECTION.md row | version:sync, release:check | BUILD OK, suite green | yes (v0.1.76: SDK→control-plane naming + version coherence) |

## Batch — multi-platform portable release flow (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | portable zero-dep release orchestrator; reviewer delegated via agent backend (vendor-agnostic) | scripts/release-flow.js + test/release-flow-smoke.js | 1 test added (5 cases: APPROVED/REJECTED/missing/unconfigured/red-gate + red-line guard) | BUILD OK, suite green | no |
| 2 | per-vendor entry points (one orchestrator, preset-only difference) | commands/release-flow.md + .gemini/commands/release.toml + .opencode/command/release.md + skills references + AGENTS.md | covered by flow smoke | BUILD OK, suite green | no |
| 3 | Gemini + OpenCode as MCP vendors (cw_* tools); preset docs | manifest gemini/opencode targets+vendors (generated .gemini-plugin/.opencode-plugin) + version-sync needles + release-tooling.7.md | gen:manifests --check, version:sync | BUILD OK, suite green | no (no tag this batch) |

## Batch — high-priority post-merge hardening (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | release-flow verdict must fail closed unless first line exactly approves current HEAD | scripts/release-flow.js + test/release-flow-smoke.js | mixed REJECTED/APPROVED verdict regression | BUILD OK, CHECK OK, DIST OK, 56/56 passed, manifests/version/index OK | no (PR only; no tag requested) |
| 2 | drive --once failed agent attempts persist across invocations and park at retry budget | src/drive.ts + src/worker-isolation.ts + src/types/worker.ts + lifecycle ops + dist | repeated --once no-result regression in agent-delegation-drive-smoke.js | BUILD OK, CHECK OK, DIST OK, 56/56 passed, manifests/version/index OK | no (PR only; no tag requested) |
| 3 | docs no longer drift from generated project index/vendor template registry | README.md + manifest/README.md | project-index sync + manifest check | BUILD OK, CHECK OK, DIST OK, 56/56 passed, manifests/version/index OK | no (PR only; no tag requested) |

## Batch — worker scope / manifest split (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | split durable worker scope (`worker.json`) from worker-facing manifest projection (`manifest.json`) so scope-only fields cannot be overwritten | src/worker-isolation.ts + src/types/worker.ts + dispatch/operator/execution-backend path projections + docs + dist | worker-isolation smoke asserts scope sentinel/retryCount survive manifest rewrites; trust-policy smoke asserts multi-agent membership persists in scope+manifest | BUILD OK, CHECK OK, DIST OK, 56/56 passed, manifests/version/index OK | no (PR only; no tag requested) |

## Batch — onboarding + distribution (→ v0.1.78)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | quickstart cross-directory crash fix (README headline command): resolve runs root from DriveResult.statePath BEFORE any run read | src/capability-core.ts | quickstart-smoke section 7: REAL CLI invoked from plugin dir with --repo elsewhere (the masked shape) | release:check 11/11, suite 67/67 (PR #103) | no (cycle 1) |
| 2 | working real-agent template: node port of the claude wrapper (read-only claude, wrapper persists result.md, forwards model+usage); README/docs rewritten off the broken bare `claude -p` | scripts/agents/claude-p-agent.js + .sh shim + README + docs/agent-delegation-drive.7.md | claude-p-agent-wrapper-smoke (hermetic PATH-shimmed claude: prompt delivery, read-only flags, persistence, provenance, fail-closed, doc-drift guard) | BUILD OK, suite 68/68 (PR #104) | no (cycle 2) |
| 3 | declared-input default folding in plan(): missing optional input renders as its default, never a literal {{name}} in agent prompts; focus gains a default | src/orchestrator/lifecycle-operations.ts + apps/architecture-review/{workflow.js,app.json} | verified live (worker input.md shows "Focus: the overall architecture", zero {{focus}}) | BUILD OK, suite 68/68 (PR #104) | no (cycle 3) |
| 4 | live dogfood proof at v0.1.77: 14/14 workers driven by real claude through the documented wrapper, 14/14 reported usage (38069 in / 168789 out), verifier-gated commit; provenance note template made self-contained | docs/dogfood/architecture-review-cool-workflow.md + scripts/dogfood-architecture-review.js | maintainer live run (OUT of CI by design); --smoke path re-verified hermetically | dogfood ok:true, suite 68/68 (PR #104) | no (cycle 4) |
| 5 | npm distribution readiness: bin {cool-workflow,cw}, repository/keywords/LICENSE in package, builtin:claude template alias (npx-safe absolute-path resolution, fail-closed on unknown names) | package.json + LICENSE + src/agent-config.ts + README | wrapper smoke section 5 (alias expansion + fail-closed + README pin); alias verified live end-to-end | BUILD OK, suite 68/68, pack dry-run 193 files (PR #105) | pending (v0.1.78: working onboarding + npm-installable) |

## Batch — tamper-evidence demo + distribution (→ v0.1.79)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | tamper-evidence demo + telemetry verify verb: hermetic ed25519 ledger forged 2 ways (chain-break + signature reject), caught offline; verifyTelemetryLedger gets its first user-facing verb (cli + mcp) | src/telemetry-demo.ts + capability-core + capability-registry + cli.ts + mcp-server.ts | tamper-evidence-demo-smoke (self-guarding: both layers caught + one-byte on-disk edit detected) | parity 184 caps, suite 69/69 (PR #106) | no (cycle 1) |
| 2 | GitHub docs sync: npm install section + npm version/downloads badges (5 prior badges intact); plugin README version stubs expanded to Tracks 1-3 + distribution sections | README.md + plugins/cool-workflow/README.md | version:sync green, dogfood-release content-surface smoke | BUILD OK, suite green (PR #107) | no (cycle 2) |
| 3 | Wiki sync: 3 new pages (Telemetry-Attestation-&-Tamper-Evidence, Concurrent-Failure-Semantics, Boundary-Contracts) + refreshed Home/Roadmap/Distribution + regenerated Project-Index; repo description/homepage set | cool-workflow.wiki (master) + repo metadata | n/a (wiki, out of CI) | pushed to .wiki.git | no (cycle 3) |
| 4 | Launch kit for distribution: Show HN, post/tweet copy, separation-of-duties wedge, channels — all leading with `npx cool-workflow demo tamper` | docs/launch/launch-kit.md | content surface | content commit | yes (v0.1.79: tamper-evidence demo shipped + npm-distributed) |

## Batch — live agent output during a drive (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | live agent output during a drive: wrapper streams a human trace (tool uses, text, per-turn summaries) to stderr via claude stream-json while emitting the same {model,usage,result} on stdout; core forwards agent stderr to the terminal only when stderr is a TTY (CW_NO_STREAM=1 opts out), never parses it — piped/CI silent, evidence digest (stdout-only) unchanged | scripts/agents/claude-p-agent.js + src/execution-backend.ts + dist | claude-p-agent-wrapper-smoke updated: fake claude emits stream-json NDJSON; asserts stream-json mode, live stderr trace, data object on stdout (not stderr), fail-closed on crash/no-result | release:check 11/11 (PR #113) | no (PR only; no tag requested) |
| 2 | docs sync to shipped state: READMEs (live-trace quickstart note + CW_NO_STREAM troubleshooting row; v0.1.79 section header finalized; ships-next stub for live output), agent-delegation-drive(7) "Live output — stderr passthrough" section, iteration log | README.md + plugins/cool-workflow/README.md + docs/agent-delegation-drive.7.md + ITERATION_LOG.md | content surface | docs only | no (PR only; no tag requested) |

## Batch — FreeBSD discipline codified as binding constraints (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | the FreeBSD programming philosophy the project already practices (POLA, mechanism/policy, Rule of Silence, fail-closed, zero-dep tools, man-page contract, style(9) spirit, -RELEASE discipline) is now written down as BINDING: hard-constraint section in AGENTS.md (+ anti-pattern), unix-principles(7) §7 long form, and an explicit reject-on-violation gate in both reviewer surfaces (docs/prompts/reviewer-agent.md Gate 6; agents/release-reviewer.md judgment check) | AGENTS.md + plugins/cool-workflow/docs/unix-principles.md + docs/prompts/reviewer-agent.md + plugins/cool-workflow/agents/release-reviewer.md + ITERATION_LOG.md | governance/content surface (gen:manifests --check, project-index --check, version:sync, release-gate + dogfood-release smokes all green) | docs only | no (PR only; no tag requested) |

## Batch — repository tidy-up: root declutter, no audit-trail loss (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | root declutter: historical architecture-audit verdicts moved into new docs/audits/ (with an index README), textual references in the curated self-audit updated; dangling BACKLOG.md reference (AGENTS.md + reviewer Gate 4 both instruct logging to it) fixed by creating the stub with the logging format; deliberately NOT deleted: .cw-release/ review trail, docs/prompts/ archive, root dogfood pointer doc — audit records, removing them would violate the project's own auditability ethos | docs/audits/{README.md,architecture-review-verdict.md,architecture-review-verdict-v0.1.39.md} (moved) + BACKLOG.md (new) + examples/audits/self-audit-cool-workflow-v0.1.42.md (path refs) + ITERATION_LOG.md | verify-audit-cites: all 30 file:line cites still resolve | gen:manifests --check, project-index --check, version:sync, dogfood-release-smoke all green | no (PR only; no tag requested) |

## Batch — test-coverage hardening: scheduling subsystem + coverage ratchet (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | first real tests for the scheduling subsystem (measured at scheduler 12.7% / triggers 18.7% / daemon 29.7% line coverage — only `schedule list` was ever exercised): scheduler lifecycle (create/pause/resume/complete/run-now/history/delete), cron + interval + jitter nextRunAt math, TTL expiry, due-event dedup, routine trigger create/fire/match with persisted payloads, daemon tick inbox — asserted both against the dist modules and through the CLI commands, fail-closed paths by name; plus a zero-dep coverage gate (NODE_V8_COVERAGE around run-all, per-process byte merge, 80% floor, ratchet-only) wired into CI as `test:coverage` replacing the bare `npm test` step | test/schedule-routine-daemon-smoke.js + scripts/coverage-gate.js + package.json + .github/workflows/ci.yml + docs/project-index.md | 1 smoke added (70 total) | 70/70 passed; coverage 86.9% ≥ 80% floor (was 85.3%) | no (PR only; no tag requested) |

## Batch — Track B portable run archive restore (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | self-contained run export/restore archive: run-local artifact files, audit overlay, telemetry overlay, per-file sha256 integrity, restore manifest, and `run verify-import` command | src/run-export.ts + src/capability-core.ts + src/capability-registry.ts + src/cli.ts + src/mcp-server.ts + src/orchestrator.ts + src/types/run.ts + dist | run-export-import-smoke now proves archived artifact/audit/telemetry bytes, import verification, CLI export/import/verify-import, and tamper detection | BUILD OK, npm test 69/69, gen-manifests --check OK, release:check 11/11 PASS | no (cycle 1; accumulate before tag) |
| 2 | restored partial runs are operational: export after first worker completes, import into another repo, verify archive, resume from restored state, dispatch next task, and accept new worker output without mutating the source run | src/run-export.ts + dist/run-export.js + test/run-export-restore-resume-smoke.js + docs/project-index.md | new run-export-restore-resume-smoke (real CLI export/import/verify-import/resume/dispatch/worker output; caught and fixed state.json-as-artifact digest mismatch) | BUILD OK, npm test 71/71, test:coverage 87.0% >= 80%, gen-manifests/index checks OK, release:check 11/11 PASS | no (cycle 2; accumulate before tag) |
| 3 | restored failed runs are discoverable and rerunnable from the control plane: import refreshes the target repo registry, a neutral cwd can `run show --scope home`, and `run rerun` creates a linked new run in the restored repo without mutating the source failed run | src/capability-core.ts + src/cli.ts + src/mcp-server.ts + dist + test/run-export-restore-rerun-smoke.js + docs/project-index.md | new run-export-restore-rerun-smoke (red: home registry could not discover restored repo; green after import refreshes target registry) | BUILD OK, npm test 72/72, test:coverage 87.0% >= 80%, gen-manifests/index/release checks OK | no (cycle 3; accumulate before tag) |
| 4 | archive no longer leaves repo-local external artifacts dangling: artifact paths referenced in run state but stored outside `.cw/runs/<id>` are embedded under `external-artifacts/`, digest-checked, and remapped to restored run-local copies on import | src/run-export.ts + src/types/run.ts + dist + test/run-export-import-smoke.js | run-export-import-smoke red: repo-local external artifact was absent from archive and restored state pointed at a missing target path; green after sourcePath-backed remap | BUILD OK, npm test 72/72, test:coverage 87.0% >= 80%, gen-manifests/index/release checks OK | no (cycle 4; tag requires reviewer approval, changelog, and explicit release flow) |

## Batch — Run Registry slim scan performance (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | speed up the high-frequency Run Registry scan path without changing output: repo-level archive/provenance overlays are read once per repo per index build, then passed as a short-lived scan snapshot while every run still re-derives from source state | src/run-registry.ts + dist/run-registry.js + docs/run-registry-control-plane.7.md + ITERATION_LOG.md | run-registry-control-plane-smoke now asserts overlay reads are bounded to one per repo scan and still preserves archive/provenance semantics plus CLI/MCP parity | BUILD OK, npm test 72/72, gen:manifests --check OK, index:check OK, no new task markers | no (cycle 1; performance slim change, accumulate before tag) |
| 2 | slim the state-explosion summary path: one summary/report/refresh build now shares a short-lived derived context for the full operator graph, operator status, state size, blackboard digest, reasoning critical ids, and graph views; public wrappers still recompute from source per command | src/state-explosion.ts + src/evidence-reasoning.ts + dist + docs/state-explosion-management.7.md + test/state-explosion-management-smoke.js + ITERATION_LOG.md | state-explosion-management-smoke now monkey-patches the graph/operator builders and proves buildStateExplosionReport plus summary refresh each build the full graph and operator summary once; red before change at 5 graph builds | BUILD OK, npm test 72/72 (state-explosion smoke 23.6s), gen:manifests --check OK, index:check OK, no new task markers | no (cycle 2; performance slim change, accumulate before tag) |

## Batch — Capability surface god-object slimming (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | slim the MCP tools-list god object without changing public output: the first read-only inspection group now derives MCP tool name + description from the capability registry while `mcp-server.ts` keeps only the input schema; `tools/list` name+description stayed byte-identical to HEAD | src/capability-registry.ts + src/mcp-server.ts + dist + docs/cli-mcp-parity.7.md + test/cli-mcp-parity-smoke.js + ITERATION_LOG.md | cli-mcp-parity-smoke now asserts the migrated inspection tools are registry-derived; red before change on `worker.summary` description drift, green after refactor | BUILD OK, npm test 72/72 (279743ms; state-explosion smoke 24.2s), gen:manifests --check OK, index:check OK, diff --check OK, no new task markers | no (cycle 1; god-object slim change, accumulate before tag) |

## Batch — Source context profile and operating memory (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | add an opt-in FreeBSD/POLA-safe JSONL source-context profile for AI runs: `core` includes runtime source/apps/package/entry wrappers, excludes committed `dist`, tests, docs, assets, release records, changelog, and iteration log from exported content, while `manifest` records every tracked file with digest/reason; also codifies repo-local Codex operating memory, four repeated-workflow skills, and eval JSONL cases | Codex.md + PROJECT_MEMORY.md + eval/*.jsonl + plugins/cool-workflow/manifest/source-context-profiles.json + plugins/cool-workflow/scripts/source-context.js + plugins/cool-workflow/docs/source-context-profiles.7.md + plugins/cool-workflow/docs/index.md + plugins/cool-workflow/docs/project-index.md + plugins/cool-workflow/skills/{ci-triage,pr-review,design-qa,deploy-check}/ + plugins/cool-workflow/test/source-context-profile-smoke.js + ITERATION_LOG.md | new source-context-profile-smoke proves the remembered include/exclude policy, JSONL-only success output, manifest records for omitted files, parseable workflow eval cases, non-template skills, and a 50k-line guard; core export at HEAD is 113 records / 39323 lines | BUILD OK, npm test 73/73 (276250ms; source-context smoke 7701ms; state-explosion smoke 22.4s), gen:manifests --check OK, index:check OK, diff --check OK, no new task markers; skill quick_validate blocked by missing PyYAML in system Python, covered by smoke frontmatter/template-marker checks | no (cycle 1; context/memory workflow capability, accumulate before tag) |

## Batch — Runtime acceleration: fast architecture review (Unreleased)

| cycle | goal | files | tests | gate | tagged |
|-------|------|-------|-------|------|--------|
| 1 | cut foreground architecture-review wait without changing the full review contract: add official opt-in `architecture-review-fast` with 6 workers, parallel Map/Assess, sequential Verify/Verdict, optional pinned sourceContext/sourceContextDigest, env-driven fast/strong model hints, cached source-context export by git SHA + profile digest, and routine docs for background full reviews | PROJECT_MEMORY.md + apps/architecture-review-fast/{app.json,workflow.js} + scripts/source-context.js + scripts/{canonical-apps,version-sync-check,bump-version}.js + docs/{agent-delegation-drive.7.md,canonical-workflow-apps.7.md,source-context-profiles.7.md,routines.md,project-index.md} + test/{architecture-review-fast-smoke.js,canonical-workflow-apps-smoke.js,source-context-profile-smoke.js,workflow-app-framework-smoke.js} + ITERATION_LOG.md | new architecture-review-fast-smoke proves the full app stays at 14 workers, fast app plans 6 workers, Map/Assess phases are parallel, `drive(..., once:true)` completes both Map workers in one round, sourceContext/digest render into prompts, and fast/strong model hints route per task; source-context-profile-smoke now proves `--cache-dir` byte identity and corrupt-cache fail-closed behavior | BUILD OK, npm test 74/74 (293919ms), gen:manifests --check OK, index:check OK, version-sync OK, diff --check OK, no new task markers, local 5-skill frontmatter check OK | no (cycle 1; performance/user-wait capability, accumulate before tag) |
| 2 | automate the 1→6 fast-review path and reuse stable Map work without changing the full review contract: add `scripts/architecture-review-fast.js`, `source-context --repo-root`, optional one-shot full-review scheduling, and opt-in task `resultCache` for fast Map workers | src/drive.ts + src/types/{workflow-app.ts,run.ts} + src/orchestrator/lifecycle-operations.ts + dist + apps/architecture-review-fast/workflow.js + scripts/{architecture-review-fast.js,source-context.js} + docs + test/{architecture-review-fast-smoke.js,architecture-review-fast-automation-smoke.js,source-context-profile-smoke.js} + PROJECT_MEMORY.md + ITERATION_LOG.md | new architecture-review-fast-automation-smoke proves a temp git repo can export context, run fast review once, schedule the full review, and avoid respawning Map workers on the second identical run; architecture-review-fast-smoke proves direct-drive cross-run Map result-cache hits | BUILD OK, targeted smokes OK, canonical-apps OK, version-sync OK, gen:manifests --check OK, index:check OK, npm test 75/75 (287504ms), diff --check OK, no new task markers | no (cycle 2; performance/user-wait capability, accumulate before tag) |
