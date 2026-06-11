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
