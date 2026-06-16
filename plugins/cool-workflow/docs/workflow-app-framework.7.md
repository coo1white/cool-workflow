# Workflow App framework

Workflow App framework - stable userland contract for reusable CW workflow apps

## Synopsis

```js
const {
  defineWorkflowApp,
  workflow,
  phase,
  agent,
  artifact,
  input
} = require("../dist/workflow-app-framework");
```

```bash
node scripts/cw.js app list
node scripts/cw.js app show workflow-app-framework-demo
node scripts/cw.js app validate apps/workflow-app-framework-demo/app.json
node scripts/cw.js app show architecture-review
npm run canonical-apps
node scripts/cw.js app init my-app --title "My App"
node scripts/cw.js plan my-app --question "What should happen?"
```

## Description

CW uses the runner as the base system and workflow apps as userland. The
runner owns state transitions, dispatch, result recording, verifier gates,
commits, and reports. A workflow app owns its own inputs, phases, task
prompts, evidence needs, and sandbox profile hints.

The framework is kept small on purpose. The public app helpers are:

- `defineWorkflowApp(definition)`
- `workflow(definition)`
- `phase(name, tasks, options)`
- `agent(id, prompt, options)`
- `artifact(id, prompt, options)`
- `input(name, options)`

Legacy workflow factories are still good to use. If a canonical app owns the public id,
the legacy wrapper should use a clear compatibility id such as
`legacy-research-synthesis` so the same app is not found twice:

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

A first-class app contract is a simple object:

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

The lasting fields are:

- `schemaVersion`: now `1`
- `id`: stable app id, lowercase letters, digits, dots, and hyphens
- `title`: name people can read
- `summary`: short note
- `version`: semver app version
- `author`: string or `{ name, url, email }`
- `workflow`: workflow definition or manifest entrypoint
- `inputs`: the input definitions you set
- `sandboxProfiles`: named bundled sandbox profiles the app uses
- `compatibility`: optional CW version limits
- `metadata`: app-owned JSON metadata

## App Directory

CW also finds app directories:

```text
apps/<app-id>/app.json
apps/<app-id>/workflow.js
```

`app.json` keeps the app metadata and points at a relative workflow entrypoint:

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

The entrypoint may give out a workflow object or a factory:

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

App loading fails closed. CW checks:

- app `schemaVersion`, `id`, `title`, and semver `version`
- input names, types, the same input given twice, and boolean flags
- workflow id/title that match the app id/title
- limits above zero and `maxConcurrentAgents <= maxAgents`
- phase ids and the same phase id given twice
- task ids, the same task id given twice, task kind, prompt, and evidence flags
- sandbox profile references on the app, workflow, and tasks
- compatibility limits against the current CW runtime

`cw.js app validate` prints a structured result. Apps that are not valid return nonzero:

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

CW does not quietly change broken apps into workflows that can run.

## CLI

```bash
node scripts/cw.js app list
node scripts/cw.js app show <app-id>
node scripts/cw.js app validate <path-or-app-id>
node scripts/cw.js app init <app-id> --title "Title"
node scripts/cw.js app package <app-id> --output app.cwapp.json
```

`cw.js list`, `cw.js init`, and `cw.js plan` still work the same way. `list` shows
legacy workflow files and first-class app directories. `plan` takes either
kind by id.

## Canonical Apps

CW v0.1.13 comes with four kept-up canonical app directories:

- `architecture-review`
- `pr-review-fix-ci`
- `release-cut`
- `research-synthesis`

These apps are the official userland hard tests for the framework. They use set
inputs, compatibility metadata, sandbox profile hints, and evidence-required
verification or synthesis/verdict tasks. Validate and plan the full matrix with:

```bash
npm run canonical-apps
```

See [canonical-workflow-apps.7.md](canonical-workflow-apps.7.md).

## MCP

The MCP bridge gives matching tools:

- `cw_app_list`
- `cw_app_show`
- `cw_app_validate`
- `cw_app_init`
- `cw_app_package`
- `cw_app_run`

Tool results are JSON and use the same app summaries and validation issue
records as the CLI. `cw_app_run` makes a run from an app id and structured
`inputs`, then gives back the run id, app id/version, state/report paths, the count of
tasks still waiting, short operator status, and next actions.

The full agent-host runtime surface is written up in
[mcp-app-surface.7.md](mcp-app-surface.7.md).

## State And Reports

Run state keeps short app metadata at:

```text
state.json.workflow.app
```

Reports include:

```text
Workflow App: <id>@<version>
Workflow App Source: <manifest-or-entrypoint-path>
```

CW keeps app identity, version, compatibility, source path, sandbox profile
references, and metadata. It does not copy workflow source into run state.

## Files

```text
src/workflow-app-framework.ts
dist/workflow-app-framework.js
apps/workflow-app-framework-demo/app.json
apps/workflow-app-framework-demo/workflow.js
apps/architecture-review/app.json
apps/pr-review-fix-ci/app.json
apps/release-cut/app.json
apps/research-synthesis/app.json
test/workflow-app-framework-smoke.js
test/canonical-workflow-apps-smoke.js
```
0.1.51
