---
name: cool-workflow
description: Use when the user asks for Cool Workflow, CW, Agent Workflow SDK, TypeScript workflow orchestration, phased multi-agent work, background workflow tasks, or reusable workflow apps.
---

# Cool Workflow

Cool Workflow is an Agent Workflow SDK. Use it to
turn broad tasks into a TypeScript/Node workflow platform run with phases, agent
task manifests, durable run state, and a final report.

## When To Use

Use this skill when the user asks for:

- `Cool Workflow` or `CW`
- Agent Workflow SDK
- TypeScript workflow runner/orchestration
- multi-agent phased work
- background task style planning
- reusable workflow apps/scripts
- architecture review workflows

## Core Model

CW has three layers:

- Package: installable shared runtime.
- Skill: trigger and operating instructions for the agent host.
- TypeScript Node/Bun runtime: workflow definitions, state files, task queue,
  deterministic harness, verifier, commits, and reports.

Treat CW like a platform SDK. The runtime owns the contract, and developers
write workflow apps against it using `workflow`, `phase`, `agent`, and
`artifact`.

The runner does not directly spawn workers. It writes pending agent tasks to
`.cw/runs/<run-id>/tasks/*.md`. The agent host reads those tasks, spawns workers
when the user explicitly asks for agent/parallel/background work, then records
results with the runner.

## Operating Loop

1. Pick or create a workflow.
2. Run `node scripts/cw.js plan <workflow-id> ...` from the plugin root or use
   the absolute plugin script path.
3. Run `node scripts/cw.js dispatch <run-id> --limit N` to create a dispatch
   manifest for the current phase.
4. If the user explicitly asked for agents, spawn one subagent per dispatched
   task with disjoint scopes.
5. Save each subagent summary to `.cw/runs/<run-id>/results/<task-id>.md`.
6. Run `node scripts/cw.js result <run-id> <task-id> <result-file>`.
7. When all required work is complete, run `node scripts/cw.js report <run-id>`.
8. Synthesize the final user-facing answer from the report and verified evidence.

## Commands

Use the plugin root when possible:

```bash
node scripts/cw.js list
node scripts/cw.js init my-workflow --title "My Workflow"
node scripts/cw.js plan architecture-review --repo /path/to/repo --question "Is this architecture sound?"
node scripts/cw.js status <run-id>
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js result <run-id> <task-id> /path/to/result.md
node scripts/cw.js commit <run-id> --verifier <node-id> --reason "verified result"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
node scripts/cw.js commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
node scripts/cw.js report <run-id>
node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule due
node scripts/cw.js schedule daemon --once
node scripts/cw.js routine create --kind github --prompt "Handle this GitHub event."
node scripts/cw.js routine fire github payload.json
```

When installed from a GitHub package source, the host resolves the package root
from the source snapshot. When working in this repository, use:

```text
plugins/cool-workflow
```

Run data is written to `.cw/runs/<run-id>/` in `--cwd`, or in `--repo` when
`--cwd` is not provided.

The runtime source is TypeScript under `src/` and compiles to `dist/`.

CW records the model loop explicitly as:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

Use this loop to explain workflow progress when reporting status to the user.

## Scheduled Tasks

CW supports loop, cron, and reminder schedules in `.cw/schedules/tasks.json`.
Use `schedule due` to find due work and `schedule complete <id>` after the due
prompt has been handled. Use `schedule daemon` for local desktop-style due
scanning. Use `routine create` and `routine fire` for API/GitHub trigger events.

## Multi-Agent Rule

Only spawn workers when the user explicitly asks for agents, delegation,
parallel work, or background work. If the user does not ask for agents, run the
phases locally in the main thread and still use CW state/report files when
helpful.

## Result Quality

Subagent results should be concise, evidence-based, and ready for synthesis.
Avoid raw logs unless they are the evidence. Use absolute file paths and line
numbers when referencing local code.

Verification and verdict tasks must include a `cw:result` JSON fence with
`findings` and `evidence`. CW rejects P0/P1/P2 findings without evidence.
