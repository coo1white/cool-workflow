# Changelog

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
