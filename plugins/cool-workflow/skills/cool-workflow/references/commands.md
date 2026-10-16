# Cool Workflow — Command & MCP Reference

Full CLI catalog and the matching MCP tool surface. The `SKILL.md` body covers
the operating loop and the handful of commands you need most; come here when you
need the exact invocation for a specific capability.

Run CLI commands from the plugin root (`plugins/cool-workflow`) or with the
absolute plugin script path. Run data is written to `.cw/runs/<run-id>/` under
`--cwd`, or under `--repo` when `--cwd` is not given.

## Contents

- [Discovery & apps](#discovery--apps)
- [Plan / dispatch / result / report](#plan--dispatch--result--report)
- [Sandbox profiles](#sandbox-profiles)
- [Commit, state & summaries](#commit-state--summaries)
- [Scheduling & routines](#scheduling--routines)
- [Release & maintenance npm scripts](#release--maintenance-npm-scripts)
- [MCP tools](#mcp-tools)

## Discovery & apps

```bash
cw list
cw search architecture
cw app list
cw app show architecture-review
cw app show pr-review-fix-ci
cw app show release-cut
cw app show research-synthesis
cw app validate apps/architecture-review/app.json
cw app show workflow-app-framework-demo
cw app validate apps/workflow-app-framework-demo/app.json
cw app validate end-to-end-golden-path
cw app package workflow-app-framework-demo
cw app init my-app --title "My App"
cw init my-workflow --title "My Workflow"
```

The canonical app ids are `architecture-review`, `pr-review-fix-ci`,
`release-cut`, and `research-synthesis`. First-class apps live under
`apps/<app-id>/app.json`; legacy `workflows/*.workflow.js` factories remain valid
and are wrapped as compatibility apps with explicit `legacy-*` ids.

## Portable release flow (any platform)

```bash
# Delegate the independent review to the model of this host (Codex shown):
export CW_AGENT_COMMAND="codex exec {{input}}"
node plugins/cool-workflow/scripts/release-flow.js --check
node plugins/cool-workflow/scripts/release-flow.js --cut --version 0.1.77 [--push]
```

One zero-dependency orchestrator runs the gate + independent reviewer under any
harness; the reviewer is delegated via `CW_AGENT_COMMAND`/`CW_AGENT_ENDPOINT`
(presets for Claude/Codex/Gemini/OpenCode/DeepSeek in `docs/release-tooling.7.md`).

## Plan / dispatch / result / report

```bash
cw plan architecture-review --repo /path/to/repo --question "Is this architecture sound?"
cw status <run-id>
cw status <run-id> --json
cw graph <run-id>
cw graph <run-id> --json
cw dispatch <run-id> --limit 6
cw dispatch <run-id> --sandbox readonly
cw result <run-id> <task-id> /path/to/result.md
cw report <run-id>
cw report <run-id> --show
```

Operator UX is human-readable by default for `status`, `graph`, report
`--show`/`--summary`, and resource `summary` commands. Use `--json` or
`--format json` when scripts or MCP-style integrations need structured output.
Status recommendations are deterministic hints, not hidden automation.

## Sandbox profiles

Named CW policy contracts describing worker read paths, write paths, command
policy, network policy, environment exposure, and host enforcement requirements.
CW enforces profile validation and worker result acceptance; the agent host
enforces OS/process/network/environment controls.

```bash
cw sandbox list
cw sandbox show readonly
cw sandbox validate ./site-sandbox.json
cw worker manifest <run-id> <worker-id>
```

## Commit, state & summaries

Durable run state lives at `.cw/runs/<run-id>/state.json`. `state check`
dry-runs migration and normalization; newer unsupported schemas fail closed and
unknown user data is preserved.

```bash
cw commit <run-id> --verifier <node-id> --reason "verified result"
cw commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
cw worker summary <run-id>
cw feedback summary <run-id>
cw commit summary <run-id>
cw state check <run-id>
```

## Scheduling & routines

CW supports loop, cron, and reminder schedules in `.cw/schedules/tasks.json`.
Use `schedule due` to find due work and `schedule complete <id>` after the due
prompt is handled. `routine create`/`routine fire` handle API/GitHub trigger
events.

```bash
cw loop --intervalMinutes 30 --prompt "Continue this workflow."
cw schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
cw schedule due
cw schedule daemon --once
cw routine create --kind github --prompt "Handle this GitHub event."
cw routine fire github payload.json
```

## Release & maintenance npm scripts

```bash
npm run canonical-apps   # validate + plan the official app matrix (no network)
npm run golden-path      # release regression for the full public chain
npm run dogfood:release  # real-repo release-cut dry-run against this repo
npm run fixture-compat   # check old run fixtures still load
npm run version:sync     # verify version synchronization across surfaces
npm run release:check    # dry-run release gate (build, types, tests, dogfood)
```

`golden-path` exercises `workflow app -> plan -> dispatch -> isolated worker ->
verifier -> gated commit -> report`, writing a simulated
worker `cw:result` and asserting durable state files rather than exit codes.
`release:check` does not tag, push, publish, or mutate fixtures.

## MCP tools

When an MCP host is available, the same runtime surface is exposed with
JSON-first tools. **Preserve CLI/MCP parity when extending CW** — every CLI
capability must have a matching MCP tool and vice versa.

`cw_app_run`, `cw_dispatch`, `cw_worker_manifest`, `cw_worker_output`,
`cw_commit`, `cw_operator_status`, `cw_operator_graph`, and `cw_operator_report`
are the core tools; the generated parity table in `docs/cli-mcp-parity.7.md`
lists every tool.

The topology, multi-agent, eval/replay, blackboard, coordinator, candidate,
summary, and review/comment/approve/reject/handoff verbs and their MCP tools
went with the multi-agent family (see `docs/release-and-migration.7.md`,
"Removed Surfaces").
