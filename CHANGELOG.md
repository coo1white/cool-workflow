# Changelog

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
