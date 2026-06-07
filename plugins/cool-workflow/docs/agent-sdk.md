# Agent Workflow SDK

CW is designed as an independent Agent Workflow SDK.

The goal is to make agent development feel like building inside a platform
ecosystem. CW provides the runtime, contracts, storage, CLI, MCP bridge, and
package structure. Developers write workflow apps against those contracts.

The SDK is guided by five practical systems principles: small kernel, explicit
state, composable pipes, isolated workers, and verifier-gated commits. See
[unix-principles.md](unix-principles.md).

## Platform Contract

Every CW workflow follows this loop:

```text
interpret -> act -> observe -> adjust -> checkpoint
```

The loop maps to concrete SDK operations:

| Loop stage | SDK operation | Responsibility |
| --- | --- | --- |
| Interpret | `plan()` | Load workflow, validate inputs, generate tasks |
| Act | `dispatch()` | Move runnable tasks from pending to running |
| Observe | `recordResult()` | Read Markdown/JSON-RPC result evidence |
| Adjust | verifier gates | Validate evidence and choose the next phase |
| Checkpoint | `commitState()` | Snapshot state after important transitions |

The v0.1.12 operator UX layer renders read-only summaries over run state:
human `status`, graph maps, report summaries, resource summaries, and
deterministic next-step recommendations. Scripts can keep using `--json` or
`--format json`.

The v0.1.12 canonical app matrix validates and plans the maintained userland
apps with public CLI commands:

```bash
npm run canonical-apps
```

The golden path runs the full integration chain end to end:

```bash
npm run golden-path
```

It validates an app, plans a run, dispatches a readonly worker, accepts a
worker-local `cw:result`, scores and selects a candidate, creates a
verifier-gated commit, and renders a report. See
[end-to-end-golden-path.7.md](end-to-end-golden-path.7.md).

## Developer Contract

A workflow app defines:

- `id`, `title`, and `summary`
- `schemaVersion`, app `version`, compatibility, and metadata when using the
  first-class Workflow App SDK contract
- required and repeated inputs
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
} = require("../dist/workflow-app-sdk");

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
files remain loadable. CW wraps them as compatibility apps with version `0.0.0`
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

This is intentional. The runtime is strongly typed for maintainability, while
workflow scripts can run without `ts-node`.

See [workflow-app-sdk.7.md](workflow-app-sdk.7.md) for the full app contract,
validation rules, CLI commands, MCP tools, and state/report fields.
See [operator-ux.7.md](operator-ux.7.md) for the operator inspection surface.
See [canonical-workflow-apps.7.md](canonical-workflow-apps.7.md) for the
official app matrix.
See [end-to-end-golden-path.7.md](end-to-end-golden-path.7.md) for the
deterministic release proof that those pieces connect.

## Evidence Contract

Verification and verdict tasks should return:

````text
```cw:result
{
  "summary": "short summary",
  "findings": [],
  "evidence": ["/absolute/path/file.ts:42"]
}
```
````

CW rejects high-priority findings without evidence. This keeps agent work closer
to inspectable engineering output than unconstrained conversation.

## Boundary

CW is an independent SDK by COOLWHITE LLC. It implements dynamic workflows,
scheduled tasks, local scheduling, routine triggers, state checkpoints, and
multi-agent verification.
