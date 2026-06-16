# Workflow App framework

CW is made as an independent agent workflow control-plane.

The aim is to make agent development feel like building inside a platform
ecosystem. CW gives the runtime, contracts, storage, CLI, MCP bridge, and
package structure. Developers make workflow apps that keep to those contracts.

The framework is guided by five useful systems rules: small kernel, explicit
state, pipes you can put together, separate workers, and commits that a verifier
lets through. See
[unix-principles.md](unix-principles.md).

## Platform Contract

Every CW workflow keeps to this loop:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

The loop maps to real framework operations:

| Loop stage | framework operation | Responsibility |
| --- | --- | --- |
| Interpret | `plan()` | Load workflow, check inputs, make tasks |
| Act | `dispatch()` | Move tasks that can run from pending to running |
| Observe | `recordResult()` | Read Markdown/JSON-RPC result evidence |
| Adjust | verifier gates | Check evidence and pick the next phase |
| Checkpoint | `commitState()` | Take a snapshot of state after important changes |

The v0.1.12 operator UX layer makes read-only summaries over run state:
human `status`, graph maps, report summaries, resource summaries, and
fixed next-step suggestions. Scripts can go on using `--json` or
`--format json`.

The v0.1.13 MCP app surface gives the same runtime operations to agent hosts
with stable JSON tools: app run, dispatch, worker inspection/output, candidate
scoring/selection, sandbox profile resolution, verifier-gated commit, and
operator status/graph/report summaries.

The v0.1.13 canonical app matrix checks and plans the kept userland
apps with public CLI commands:

```bash
npm run canonical-apps
```

The golden path runs the full integration chain from start to end:

```bash
npm run golden-path
```

It checks an app, plans a run, dispatches a readonly worker, takes a
worker-local `cw:result`, scores and picks a candidate, makes a
verifier-gated commit, and makes a report. See
[end-to-end-golden-path.7.md](end-to-end-golden-path.7.md).

## Developer Contract

A workflow app defines:

- `id`, `title`, and `summary`
- `schemaVersion`, app `version`, compatibility, and metadata when using the
  first-class Workflow App framework contract
- needed and repeated inputs
- phase order
- agent tasks
- artifact tasks
- concurrency limits
- evidence requirements
- sandbox profile hints

Example:

```js
const {
  defineWorkflowApp,
  workflow,
  phase,
  agent,
  artifact,
  input
} = require("../dist/workflow-app-framework");

const inputs = [input("repo", { type: "path", required: true })];

module.exports = defineWorkflowApp({
  schemaVersion: 1,
  id: "example-review",
  title: "Example Review",
  summary: "Review a repository with evidence.",
  version: "0.1.0",
  inputs,
  sandboxProfiles: ["readonly"],
  compatibility: {
    minVersion: "0.1.9"
  },
  workflow: workflow({
    id: "example-review",
    title: "Example Review",
    inputs,
    sandboxProfiles: ["readonly"],
    phases: [
      phase("Map", [
        agent("map:system", "Map the system boundaries.", {
          sandboxProfileId: "readonly"
        })
      ]),
      phase("Verdict", [
        artifact("verdict", "Write the final evidence-backed verdict.", {
          requiresEvidence: true,
          sandboxProfileId: "readonly"
        })
      ])
    ]
  })
});
```

Legacy `module.exports = ({ workflow, phase, agent, artifact }) => workflow(...)`
files can still be loaded. CW wraps them as compatibility apps with version `0.0.0`
so workflow files still plan and dispatch. When a canonical app owns the public
id, compatibility wrappers use explicit ids such as `legacy-research-synthesis`.

## Language Contract

The CW platform is TypeScript:

```text
src/*.ts -> dist/*.js
```

Workflow apps are JavaScript modules:

```text
workflows/*.workflow.js
apps/<app-id>/app.json
apps/<app-id>/workflow.js
```

This is done on purpose. The runtime is strongly typed so it is simple to keep
up, while workflow scripts can run without `ts-node`.

See [workflow-app-framework.7.md](workflow-app-framework.7.md) for the full app contract,
the rules for checking, CLI commands, MCP tools, and state/report fields.
See [mcp-app-surface.7.md](mcp-app-surface.7.md) for the agent-host runtime
surface over MCP.
See [operator-ux.7.md](operator-ux.7.md) for the operator inspection surface.
See [canonical-workflow-apps.7.md](canonical-workflow-apps.7.md) for the
official app matrix.
See [end-to-end-golden-path.7.md](end-to-end-golden-path.7.md) for the
fixed release proof that those parts connect.

## Evidence Contract

Verification and verdict tasks should give back:

````text
```cw:result
{
  "summary": "short summary",
  "findings": [],
  "evidence": ["/absolute/path/file.ts:42"]
}
```
````

CW says no to high-priority findings without evidence. This keeps agent work
nearer to engineering output you can look into than to free talk.

## Boundary

CW is an independent workflow control-plane by COOLWHITE LLC. It puts into effect
workflows that change, scheduled tasks, local scheduling, routine triggers, state
checkpoints, and multi-agent verification.
