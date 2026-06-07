# Changelog

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
