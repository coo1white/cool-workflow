# Workflow App SDK

Workflow App SDK - stable userland contract for reusable CW workflow apps

## Synopsis

```js
const {
  defineWorkflowApp,
  workflow,
  phase,
  agent,
  artifact,
  input
} = require("../dist/workflow-app-sdk");
```

```bash
node scripts/cw.js app list
node scripts/cw.js app show workflow-app-sdk-demo
node scripts/cw.js app validate apps/workflow-app-sdk-demo/app.json
node scripts/cw.js app init my-app --title "My App"
node scripts/cw.js plan my-app --question "What should happen?"
```

## Description

CW treats the runner as the base system and workflow apps as userland. The
runner owns state transitions, dispatch, result recording, verifier gates,
commits, and reports. A workflow app owns domain-specific inputs, phases, task
prompts, evidence requirements, and sandbox profile hints.

The SDK is intentionally small. The public app helpers are:

- `defineWorkflowApp(definition)`
- `workflow(definition)`
- `phase(name, tasks, options)`
- `agent(id, prompt, options)`
- `artifact(id, prompt, options)`
- `input(name, options)`

Legacy workflow factories remain valid:

```js
module.exports = ({ workflow, phase, agent, artifact }) =>
  workflow({
    id: "legacy-review",
    title: "Legacy Review",
    inputs: [{ name: "question", required: true }],
    phases: [
      phase("Map", [
        agent("map:context", "Map {{question}}.")
      ])
    ]
  });
```

## App Contract

A first-class app contract is a plain object:

```js
module.exports = defineWorkflowApp({
  schemaVersion: 1,
  id: "example-review",
  title: "Example Review",
  summary: "Review a repository with evidence gates.",
  version: "0.1.0",
  author: "COOLWHITE LLC",
  inputs: [
    input("question", { type: "string", required: true })
  ],
  sandboxProfiles: ["readonly"],
  compatibility: {
    minVersion: "0.1.9"
  },
  workflow: workflow({
    id: "example-review",
    title: "Example Review",
    inputs: [
      input("question", { type: "string", required: true })
    ],
    limits: {
      maxAgents: 4,
      maxConcurrentAgents: 2
    },
    sandboxProfiles: ["readonly"],
    phases: [
      phase("Verify", [
        artifact("verify:evidence", "Verify {{question}}.", {
          requiresEvidence: true,
          sandboxProfileId: "readonly"
        })
      ])
    ]
  })
});
```

The durable fields are:

- `schemaVersion`: currently `1`
- `id`: stable app id, lowercase letters, digits, dots, and hyphens
- `title`: human-readable name
- `summary`: short description
- `version`: semver app version
- `author`: string or `{ name, url, email }`
- `workflow`: workflow definition or manifest entrypoint
- `inputs`: declared input definitions
- `sandboxProfiles`: named bundled sandbox profiles used by the app
- `compatibility`: optional CW version constraints
- `metadata`: app-owned JSON metadata

## App Directory

CW also discovers app directories:

```text
apps/<app-id>/app.json
apps/<app-id>/workflow.js
```

`app.json` stores the app metadata and points at a relative workflow entrypoint:

```json
{
  "schemaVersion": 1,
  "id": "example-review",
  "title": "Example Review",
  "version": "0.1.0",
  "inputs": [{ "name": "question", "type": "string", "required": true }],
  "sandboxProfiles": ["readonly"],
  "compatibility": { "minVersion": "0.1.9" },
  "workflow": { "entrypoint": "workflow.js" }
}
```

The entrypoint may export a workflow object or a factory:

```js
module.exports = ({ workflow, phase, agent, input }) => {
  const inputs = [input("question", { type: "string", required: true })];
  return workflow({
    id: "example-review",
    title: "Example Review",
    inputs,
    phases: [
      phase("Map", [
        agent("map:context", "Map {{question}}.")
      ])
    ]
  });
};
```

## Validation

App loading fails closed. CW validates:

- app `schemaVersion`, `id`, `title`, and semver `version`
- input names, types, duplicate inputs, and boolean flags
- workflow id/title matching the app id/title
- positive limits and `maxConcurrentAgents <= maxAgents`
- phase ids and duplicate phase ids
- task ids, duplicate task ids, task kind, prompt, and evidence flags
- sandbox profile references on the app, workflow, and tasks
- compatibility constraints against the current CW runtime

`cw.js app validate` prints a structured result. Invalid apps return nonzero:

```json
{
  "valid": false,
  "issues": [
    {
      "code": "workflow-task-duplicate",
      "message": "Duplicate workflow task id: map:context",
      "path": "/path/app.json.workflow.phases.0.tasks.1.id"
    }
  ]
}
```

CW does not silently rewrite malformed apps into runnable workflows.

## CLI

```bash
node scripts/cw.js app list
node scripts/cw.js app show <app-id>
node scripts/cw.js app validate <path-or-app-id>
node scripts/cw.js app init <app-id> --title "Title"
node scripts/cw.js app package <app-id> --output app.cwapp.json
```

`cw.js list`, `cw.js init`, and `cw.js plan` remain compatible. `list` includes
legacy workflow files and first-class app directories. `plan` accepts either
kind by id.

## MCP

The MCP bridge exposes matching tools:

- `cw_app_list`
- `cw_app_show`
- `cw_app_validate`
- `cw_app_init`
- `cw_app_package`

Tool results are JSON and use the same app summaries and validation issue
records as the CLI.

## State And Reports

Run state records compact app metadata at:

```text
state.json.workflow.app
```

Reports include:

```text
Workflow App: <id>@<version>
Workflow App Source: <manifest-or-entrypoint-path>
```

CW stores app identity, version, compatibility, source path, sandbox profile
references, and metadata. It does not copy workflow source into run state.

## Files

```text
src/workflow-app-sdk.ts
dist/workflow-app-sdk.js
apps/workflow-app-sdk-demo/app.json
apps/workflow-app-sdk-demo/workflow.js
test/workflow-app-sdk-smoke.js
```
