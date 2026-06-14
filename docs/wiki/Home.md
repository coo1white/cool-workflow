# Cool Workflow Wiki

Cool Workflow is an auditable workflow control-plane for AI coding agents. It
turns a repo question or operator job into durable `.cw/` state, delegated
workers, verifier-gated commits, and saved reports.

Start here:

| Page | Use it for |
| --- | --- |
| [Quickstart](Quickstart.md) | Run the tamper demo, a real architecture review, and a resumable run. |
| [Workflow Apps](Workflow-Apps.md) | Choose between the shipped apps and inspect app contracts. |
| [Architecture](Architecture.md) | Understand the runtime boundary, state files, verifier gate, and MCP surface. |
| [Trust And Audit](Trust-And-Audit.md) | Learn what telemetry, audit verification, and the trust limits prove. |
| [Recovery And Restore](Recovery-And-Restore.md) | Resume, export, inspect, import, verify, and rerun durable runs. |
| [Commands or API](Commands-or-API.md) | Find the stable CLI shapes and MCP entry points. |
| [MCP And Manifests](MCP-And-Manifests.md) | Understand generated vendor manifests and MCP parity. |
| [Operations](Operations.md) | Verify, restore, inspect, regenerate manifests, and run release checks. |
| [FAQ](FAQ.md) | Clarify trust limits, agent setup, reports, and failure behavior. |

## What CW Does

CW provides mechanisms for:

- planning workflow apps,
- dispatching isolated workers,
- delegating each worker to an external agent,
- accepting and verifying `result.md` envelopes,
- recording audit and telemetry ledgers,
- committing verified state checkpoints,
- generating reports from the durable run record.

It does not embed a model SDK and does not hold model credentials. Your external
agent does the model work; CW keeps the run book.

## Good First Reads

For users:

1. Run `npx cool-workflow demo tamper`.
2. Read [Quickstart](Quickstart.md).
3. Pick an app from [Workflow Apps](Workflow-Apps.md).
4. Run `cw quickstart architecture-review` against a repo with your agent.

For maintainers:

1. Read [Architecture](Architecture.md).
2. Read [MCP And Manifests](MCP-And-Manifests.md).
3. Run `npm run golden-path` from `plugins/cool-workflow`.
4. Run `npm run release:check` before any release work.

For reviewers:

1. Read [Trust And Audit](Trust-And-Audit.md).
2. Read [Recovery And Restore](Recovery-And-Restore.md).
3. Use `cw telemetry verify`, `cw audit verify`, and `cw run verify-import`.

## Project Status

This Wiki is a draft for GitHub Wiki publication. It summarizes the current
repository evidence rather than introducing new public claims. The root README
remains the official first-run page until these drafts are applied.
