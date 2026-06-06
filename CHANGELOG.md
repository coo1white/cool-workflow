# Changelog

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
