# Workflow Apps

*For picking the right app for a job, and for seeing what an app is made of.*

A workflow app is a packaged job — like a program that runs on CW. The
runtime owns planning, dispatch, verification, commits, reports, and state.
The app owns what is special to its job: the inputs, phases, task prompts,
evidence requirements, and sandbox hints.

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
are examples or an internal proof. List them all with `cw app list`. `cw app
list` also shows two older workflow-file wrappers, ten in all.

### Canonical

| App | Use it when | Notes |
| --- | --- | --- |
| `architecture-review` | You want the full repository architecture and risk review. | 14 tasks across Map, Assess, Verify, and Verdict (13 agent workers plus the Verdict artifact); readonly sandbox. |
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

Every app writes the same thing: a saved report you can check again offline,
with every claim tied to its source. These four are the main lanes:

| Workflow | What it produces |
|---|---|
| `architecture-review` | Map a repo, rank risks, and back every claim with `file:line` evidence |
| `pr-review-fix-ci` | Review a PR or branch, work out why CI fails, and propose + verify fixes |
| `research-synthesis` | Answer a question over a local folder of files — your docs, notes, or papers |
| `release-cut` | Run a gated, reviewed release with dry-run evidence |

```bash
cw app list            # see everything installed
cw doctor              # check your setup    →    cw fix   shows the fix commands
```

**Multi-agent, when you need it.** Fan work out across agents with built-in
topologies (ready-made team shapes), compose flows (a task can run a whole
child workflow with `subWorkflow`, or a `loop()` phase can go round until a
condition or a token budget says stop), and re-run fast — `cw run <app>
--drive --incremental` reuses every step whose inputs did not change.

<div align="center">
<img src="https://raw.githubusercontent.com/coo1white/cool-workflow/main/plugins/cool-workflow/project/docs/assets/topologies.svg" alt="Built-in multi-agent topologies: map-reduce (fan out, fold in), debate (argue then draw a verdict), and judge-panel (N independent judges score one candidate)." width="92%">
</div>

## Full Review vs Fast Review

`architecture-review` is the stable full review lane:

```bash
cw quickstart architecture-review \
  --repo /path/to/repo \
  --question "How does the deploy pipeline work?" \
  --agent-command builtin:claude
```

`architecture-review-fast` keeps the full review contract intact and offers a
shorter opt-in lane:

```bash
cw quickstart architecture-review-fast \
  --repo /path/to/repo \
  --question "How does the deploy pipeline work?" \
  --agent-command builtin:claude
```

The fast app's source-context fields are normal app inputs. Which model runs
the work stays your choice, set through the operator and wrapper
configuration — the core runtime does not decide it.

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
| `sandboxProfiles` | Named sandbox policies for the app's DELEGATED AGENT WORKERS — see below. |
| `workflow` | Phases and tasks to plan. |
| `compatibility` | Runtime and workflow schema constraints. |

App loading fails closed on duplicate ids, invalid inputs, incompatible versions,
bad sandbox references, and malformed phase or task definitions.

`sandboxProfiles` constrains agent workers CW delegates to while driving the
app — it does not sandbox the app's own `workflow.js`. That file runs
in-process, as ordinary Node.js code with full host privileges, the moment
CW loads the app (list, show, validate, plan, or run) — before any sandbox
profile applies to anything. Only load an app whose `workflow.js` you trust.
`cw app validate <path>` on a path outside CW's known app roots (bundled
apps, an installed package, `CW_APPS_DIR`, or the current directory's own
`apps/`) refuses to load it unless `CW_ALLOW_EXTERNAL_APP_CODE=1` is set.

## Related Source Docs

In the repository, see:

- `plugins/cool-workflow/docs/workflow-app-framework.7.md`
- `plugins/cool-workflow/docs/canonical-workflow-apps.7.md`
- `plugins/cool-workflow/docs/agent-delegation-drive.7.md`
