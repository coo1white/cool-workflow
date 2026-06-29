# Workflow Apps

CW uses workflow apps as userland. The runtime owns planning, dispatch,
verification, commits, reports, and state. An app owns the domain-specific
inputs, phases, task prompts, evidence requirements, and sandbox hints.

## Inspect Installed Apps

```bash
cw app list
cw app show architecture-review --json
cw app validate architecture-review
```

From a source checkout:

```bash
cd plugins/cool-workflow
node scripts/cw.js app list
node scripts/cw.js app show architecture-review --json
npm run canonical-apps
```

## Shipped Apps

Eight apps ship in `apps/`. Five are canonical (the lanes the docs support); three
are examples or an internal proof. List them all with `cw app list`.

### Canonical

| App | Use it when | Notes |
| --- | --- | --- |
| `architecture-review` | You want the full repository architecture and risk review. | 14 tasks across Map, Assess, Verify, and Verdict; readonly sandbox. |
| `architecture-review-fast` | You want faster first results before a deeper background review. | 6 tasks; supports source-context inputs; readonly sandbox. |
| `pr-review-fix-ci` | You want PR review and CI diagnosis. | 7 tasks; can use readonly or workspace-write profiles depending on mode. |
| `research-synthesis` | You want evidence-backed synthesis from sources. | 6 tasks; uses readonly and locked-down profiles. |
| `release-cut` | You want release preparation with checklist discipline. | 6 tasks; uses readonly and workspace-write profiles. |

### Examples and internal proof

| App | Use it when | Notes |
| --- | --- | --- |
| `pdca-blackboard-loop` | You want a small multi-agent example. | 4 tasks; three agents share one blackboard to plan, do, check, and act. |
| `workflow-app-framework-demo` | You want a small example app contract. | 3 tasks; shows inputs, phases, evidence gates, and sandbox hints. |
| `end-to-end-golden-path` | You want the deterministic integration proof. | 1 task; the one-worker app behind `npm run golden-path`. |

## Full Review vs Fast Review

`architecture-review` is the stable full review lane:

```bash
cw quickstart architecture-review \
  --repo /path/to/repo \
  --question "What are the main risks?" \
  --agent-command builtin:claude
```

`architecture-review-fast` keeps the full review contract intact and offers a
shorter opt-in lane:

```bash
cw quickstart architecture-review-fast \
  --repo /path/to/repo \
  --question "What are the main risks?" \
  --agent-command builtin:claude
```

The fast app's source-context fields are app inputs. Model routing remains
operator policy and wrapper configuration, not core runtime policy.

## App Contract

An app directory has this shape:

```text
apps/<app-id>/
  app.json
  workflow.js
```

Important fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable app id used by CLI and MCP. |
| `inputs` | Declared operator inputs such as `repo` and `question`. |
| `sandboxProfiles` | Named sandbox policy hints the app may request. |
| `workflow` | Phases and tasks to plan. |
| `compatibility` | Runtime and workflow schema constraints. |

App loading fails closed on duplicate ids, invalid inputs, incompatible versions,
bad sandbox references, and malformed phase or task definitions.

## Related Source Docs

In the repository, see:

- `plugins/cool-workflow/docs/workflow-app-framework.7.md`
- `plugins/cool-workflow/docs/canonical-workflow-apps.7.md`
- `plugins/cool-workflow/docs/agent-delegation-drive.7.md`
