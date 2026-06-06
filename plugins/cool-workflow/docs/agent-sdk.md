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

## Developer Contract

A workflow app defines:

- `id`, `title`, and `summary`
- required and repeated inputs
- phase order
- agent tasks
- artifact tasks
- concurrency limits
- evidence requirements

Example:

```js
module.exports = ({ workflow, phase, agent, artifact }) =>
  workflow({
    id: "example-review",
    title: "Example Review",
    inputs: [{ name: "repo", required: true }],
    phases: [
      phase("Map", [
        agent("map:system", "Map the system boundaries.")
      ]),
      phase("Verdict", [
        artifact("verdict", "Write the final evidence-backed verdict.", {
          requiresEvidence: true
        })
      ])
    ]
  });
```

## Language Contract

The CW platform is TypeScript:

```text
src/*.ts -> dist/*.js
```

Workflow apps are JavaScript modules:

```text
workflows/*.workflow.js
```

This is intentional. The runtime is strongly typed for maintainability, while
workflow scripts can run without `ts-node`.

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
