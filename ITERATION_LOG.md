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
