<div align="center">

# Cool Workflow

**Get a saved, cited report from your AI agent — not a chat message you lose.**

[![CI](https://img.shields.io/github/actions/workflow/status/coo1white/cool-workflow/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/coo1white/cool-workflow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/cool-workflow?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/cool-workflow)
[![downloads](https://img.shields.io/npm/dm/cool-workflow?style=flat-square&label=downloads)](https://www.npmjs.com/package/cool-workflow)
[![provenance](https://img.shields.io/badge/npm-provenance-3178C6?style=flat-square)](https://www.npmjs.com/package/cool-workflow)
[![release](https://img.shields.io/github/v/tag/coo1white/cool-workflow?style=flat-square&label=release&color=brightgreen&sort=semver)](https://github.com/coo1white/cool-workflow/tags)
[![license](https://img.shields.io/badge/license-BSD--2--Clause-blue?style=flat-square)](https://github.com/coo1white/cool-workflow/blob/main/LICENSE)
![MCP](https://img.shields.io/badge/MCP-native-8A2BE2?style=flat-square)
![runtime](https://img.shields.io/badge/runtime-TypeScript%20%C2%B7%20Node-3178C6?style=flat-square)

<img src="https://raw.githubusercontent.com/coo1white/cool-workflow/main/docs/assets/cool-workflow-readme-promo.png" alt="Cool Workflow turns AI agent repo questions into saved, cited, tamper-evident reports." width="100%">

</div>

> An auditable agent-workflow control-plane — **delegate, don't execute**.
> `plan → dispatch → record → verify → commit → report`

## Install

```bash
npm install -g cool-workflow
```

What you need: **Node.js v18+** (`node --version`) and one AI agent CLI on your machine
(`claude`, `codex`, `gemini`, or `opencode`). No agent? `cw demo` still works — CW never runs a model itself.

## Quick Start (3 steps)

### 1. Prove it works (30 seconds, no agent needed)

```bash
cw demo tamper
# → VERDICT: tamper-evidence holds ✓
```

### 2. Run a review on your code — one command

```bash
cw -q "What are the main risks here?"
```

CW auto-detects the repo (current folder) and your agent (first found on PATH).
Pick a specific agent with a flag:

```bash
cw -q "What are the security risks?" -claude
cw -q "What are the security risks?" -codex
cw -q "What are the security risks?" -deepseek
```

You will see live streaming output as the agent works — no env vars needed.

### 3. Open the report

```bash
cat .cw/runs/<run-id>/report.md
# → findings with clickable file.ts:42 pointers for every claim
```

## What Else Can It Do?

```bash
cw version                        # show version
cw update                         # update to latest release
cw doctor                         # check your setup
cw fix                            # show fix commands for setup issues
```

| Workflow | Does |
|---|---|
| `architecture-review` | Map a repo, rank risks, back every claim with evidence |
| `pr-review-fix-ci` | Review a pull request, suggest fixes, verify CI |
| `research-synthesis` | Answer a question with fact-backed research |
| `release-cut` | Run a gated, reviewed release |

**Multi-agent, when you need it.** Fan work out across agents with built-in topologies,
compose flows (a task can run a whole child workflow with `subWorkflow`, or a `loop()` phase
can keep iterating until a predicate or a token budget says stop) — and re-run fast:
`cw run <app> --drive --incremental` reuses every step whose inputs didn't change.

CW also has an **MCP** surface — **Claude Desktop, Cursor, and VS Code call CW as a tool**, so
your agent can plan a run, drive it, and verify a report without leaving the editor.

## Can I Trust the Report?

CW does not run the AI model — it keeps the books. The agent signs its findings (ed25519), and
`cw report verify-bundle` checks — offline, with nothing but the public key — that every signed
finding is in the report **unaltered**: edit a finding, in the report or in the agent's own result,
and the check fails. CW holds no private key — the agent signs, CW only verifies.

```bash
cw demo tamper                              # proves it in 30s — edits a signed result, watch it fail
cw telemetry verify <run-id>                # checks a real run
cw audit verify <run-id>                    # re-proves the trust-audit hash chain
```

Give the report to another person — they need nothing but the file:

```bash
cw -q "…" --bundle                              # seal into one portable file
cw report verify-bundle report.cwrun.json       # they check it offline
cw report verify-bundle report.cwrun.json \
  --require-signatures                          # …and insist the findings are signed
```

This attests the agent's **signed findings** — not that the report holds nothing else, and not that
none were left out. CW has no key to sign the rendered report, and a determined re-chainer can drop a
signed finding entirely — so check the findings you act on against the signed results. For exactly
what is and is not proven, see the [Trust Model](docs/trust-model.md).

## Troubleshooting

| Problem | Fix |
|---|---|
| No agent found | Run `cw doctor` — it shows which agents are on your machine |
| `status: blocked` | CW failing closed (it never makes up a result). Set `CW_AGENT_COMMAND=builtin:claude` or pass `-claude`; `cw doctor` names the exact reason |
| `claude: command not found` | Install Claude Code (`npm install -g @anthropic-ai/claude-code`) and run again |
| Where is my report? | `<repo>/.cw/runs/<id>/report.md` |
| Preflight before a spawn | `cw quickstart --check` — a zero-write check |

---

The rest of this README is the **developer / operator reference**: the build loop, repo
structure, the full command surface, scheduling, and the result-envelope contract.

## Developer Loop

Use the shortest check that fits the change (from `plugins/cool-workflow/`):

```bash
cd plugins/cool-workflow
npm run build
node test/<nearest-smoke>.js
npm run test:fast
```

For a source checkout, `cw doctor --onramp --changed-from origin/main` gives the
nearest smoke tests and release gate commands for the current change. Before a
release, run `npm run release:check`.

## Structure

```text
cool-workflow
  skills/cool-workflow/SKILL.md
  src/
  dist/
  scripts/cw.js
  workflows/architecture-review.workflow.js
  workflows/research-synthesis.workflow.js
  apps/architecture-review/app.json
  apps/end-to-end-golden-path/app.json
  apps/pr-review-fix-ci/app.json
  apps/release-cut/app.json
  apps/research-synthesis/app.json
  apps/workflow-app-framework-demo/app.json
  docs/index.md
  docs/getting-started.md
  docs/coordinator-blackboard.7.md
  docs/multi-agent-runtime-core.7.md
  docs/multi-agent-eval-replay-harness.7.md
  docs/dogfood-one-real-repo.7.md
  docs/release-and-migration.7.md
  docs/agent-framework.md
  docs/unix-principles.md
  docs/mcp-app-surface.7.md
  docs/operator-ux.7.md
  docs/workflow-app-framework.7.md
  docs/sandbox-profiles.7.md
  docs/candidate-scoring.7.md
  docs/verifier-gated-commit.7.md
  docs/run-registry-control-plane.7.md
  docs/execution-backends.7.md
```

## Commands

Installed via npm, the bin is `cw` (alias `cool-workflow`): e.g. `cw list`,
`cw quickstart …`. From a cloned source checkout, before `npm run build`, use the
matching `node scripts/cw.js <cmd>` form shown in the examples below.

List bundled workflows:

```bash
node scripts/cw.js list
```

List, inspect, validate, and create workflow apps:

```bash
node scripts/cw.js app list
node scripts/cw.js app show architecture-review
node scripts/cw.js app validate apps/architecture-review/app.json
node scripts/cw.js app show pr-review-fix-ci
node scripts/cw.js app show release-cut
node scripts/cw.js app show research-synthesis
node scripts/cw.js app show workflow-app-framework-demo
node scripts/cw.js app validate apps/workflow-app-framework-demo/app.json
node scripts/cw.js app validate end-to-end-golden-path
node scripts/cw.js app package architecture-review
node scripts/cw.js app init my-app --title "My App"
```

Compose flows from smaller verified ones (app-authoring surface, `workflow-api.ts`):

- **Sub-workflow nesting** — a task can run a whole child app instead of one agent:
  `subWorkflow(id, appId, { inputs?, bindResult? })`. The drive plans and drives the
  child, then binds its report (or verdict result) back as the task's result, so the
  parent's verifier/schema gate consumes it like any other. Leaf work stays external-agent
  delegation at every depth; recursion is depth- and cycle-bounded, fail-closed.
- **Bounded dynamic loops** — converge without unbounded recursion:
  `loop(name, tasks, { maxRounds, until })` is a per-round template. After each round a
  named, registered pure predicate (`until: { kind: "predicate", ref }`) decides whether to
  append another round or stop, hard-capped at `maxRounds`; built-ins `no-new-findings` and
  `single-round`. Or scale by budget — `until: { kind: "budget-target", target }` keeps
  going while recorded (attested-only) usage stays under `target`, with the fail-closed
  `limits.tokenBudget` cap as the absolute backstop. Predicates are registry refs (not
  closures), so runs replay byte-identically; an unregistered predicate stops fail-closed.

Create a reusable workflow script:

```bash
node scripts/cw.js init my-workflow --title "My Workflow"
```

Create a run:

```bash
node scripts/cw.js plan architecture-review \
  --repo /path/to/repo \
  --question "Is this architecture sound?" \
  --invariant "single-box self-hosted"
```

Inspect a run as an operator:

```bash
node scripts/cw.js status <run-id>
node scripts/cw.js status <run-id> --json
node scripts/cw.js graph <run-id>
node scripts/cw.js graph <run-id> --json
node scripts/cw.js report <run-id> --show
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology graph <run-id>
node scripts/cw.js worker summary <run-id>
node scripts/cw.js multi-agent summary <run-id>
node scripts/cw.js multi-agent graph <run-id>
node scripts/cw.js candidate summary <run-id>
node scripts/cw.js feedback summary <run-id>
node scripts/cw.js commit summary <run-id>
node scripts/cw.js state check <run-id>
```

MCP hosts can drive the same flow with JSON tools:

```text
cw_app_run -> cw_dispatch -> cw_worker_manifest -> cw_worker_output
-> cw_candidate_register -> cw_candidate_score -> cw_candidate_select
-> cw_commit -> cw_operator_report
```

MCP also exposes topology tools:

```text
cw_topology_list
cw_topology_show
cw_topology_validate
cw_topology_apply
cw_topology_summary
cw_topology_graph
```

List, inspect, validate, and apply official multi-agent topologies:

```bash
node scripts/cw.js topology list
node scripts/cw.js topology show map-reduce
node scripts/cw.js topology show debate
node scripts/cw.js topology show judge-panel
node scripts/cw.js topology validate map-reduce
node scripts/cw.js topology apply <run-id> map-reduce --task <task-id> --mappers 2
node scripts/cw.js topology apply <run-id> debate --id debate-round --rounds 2
node scripts/cw.js topology apply <run-id> judge-panel --judgeCount 3
node scripts/cw.js topology summary <run-id>
node scripts/cw.js topology summary <run-id> --json
node scripts/cw.js topology graph <run-id>
node scripts/cw.js topology graph <run-id> --json
node scripts/cw.js topology show <run-id> <topology-run-id>
```

Topology runs are kept under `.cw/runs/<run-id>/topologies/`, pointed to from
`state.json`, put into operator status and graph output, and counted in the
trust audit summary.

Create a dispatch manifest for the current runnable phase:

```bash
node scripts/cw.js dispatch <run-id> --limit 6
node scripts/cw.js dispatch <run-id> --sandbox readonly
node scripts/cw.js dispatch <run-id> --multi-agent-run ma --multi-agent-group group --multi-agent-role role
node scripts/cw.js dispatch <run-id> --multi-agent-fanout <fanout-id>
```

Inspect sandbox profiles:

```bash
node scripts/cw.js sandbox list
node scripts/cw.js sandbox show readonly
node scripts/cw.js sandbox validate ./site-sandbox.json
```

Record an agent result after a worker finishes:

```bash
node scripts/cw.js result <run-id> <task-id> path/to/result.md
```

Register, score, rank, and verifier-gate a candidate output:

```bash
node scripts/cw.js candidate register <run-id> --worker <worker-id>
node scripts/cw.js candidate score <run-id> <candidate-id> \
  --criterion correctness=4 \
  --criterion evidence=4 \
  --criterion fit=2 \
  --maxTotal 10 \
  --evidence /path/to/file.ts:42
node scripts/cw.js candidate rank <run-id>
node scripts/cw.js candidate select <run-id> <candidate-id> --reason "verified winner"
```

Create a deterministic state commit:

```bash
node scripts/cw.js commit <run-id> --verifier <node-id> --reason "verified result"
node scripts/cw.js commit <run-id> --selection <selection-id> --reason "verified winner"
node scripts/cw.js commit <run-id> --allow-unverified-checkpoint --reason "manual checkpoint"
```

The first two commands make verifier-gated committed state. The last command
makes a clear non-gated checkpoint.

Render a report:

```bash
node scripts/cw.js report <run-id>
```

Look after runs across repos with the control plane (derived, fail-closed registry):

```bash
node scripts/cw.js registry refresh --scope home
node scripts/cw.js run search --app architecture-review --status failed
node scripts/cw.js run show <run-id>
node scripts/cw.js run resume <run-id>
node scripts/cw.js run resume <run-id> --drive --incremental   # re-drive, reusing every step whose inputs are unchanged
node scripts/cw.js run rerun <failed-run-id> --reason "retry"
node scripts/cw.js run archive <run-id> --reason "old"
node scripts/cw.js queue add --app release-cut --priority 10
node scripts/cw.js queue list
node scripts/cw.js queue drain --limit 1
node scripts/cw.js history --scope home --json
```

Run the deterministic release golden path:

```bash
npm run dogfood:release
npm run release:check
npm run canonical-apps
npm run golden-path
npm run fixture-compat
npm run version:sync
npm test
```

Run data lives under `.cw/runs/<run-id>/` in `--cwd`, or in `--repo` when
`--cwd` is left out.

Build the TypeScript runtime:

```bash
npm install --no-package-lock
npm run build
```

See [docs/agent-framework.md](docs/agent-framework.md) for the developer contract.
See [docs/index.md](docs/index.md) for a docs map.
See [docs/getting-started.md](docs/getting-started.md) for a clone-to-run path.
See [docs/release-and-migration.7.md](docs/release-and-migration.7.md) for
release and migration discipline.
See [docs/dogfood-one-real-repo.7.md](docs/dogfood-one-real-repo.7.md) for the
real-repository dogfood release proof.
See [docs/operator-ux.7.md](docs/operator-ux.7.md) for the operator command
surface.
See [docs/workflow-app-framework.7.md](docs/workflow-app-framework.7.md) for the app
contract.
See [docs/canonical-workflow-apps.7.md](docs/canonical-workflow-apps.7.md) for
the canonical app matrix.
See [docs/candidate-scoring.7.md](docs/candidate-scoring.7.md) for the
candidate scoring file contract.
See [docs/verifier-gated-commit.7.md](docs/verifier-gated-commit.7.md) for the
commit gate contract.
See [docs/sandbox-profiles.7.md](docs/sandbox-profiles.7.md) for the sandbox
profile contract.
See [docs/end-to-end-golden-path.7.md](docs/end-to-end-golden-path.7.md) for
the release golden path contract.
See [docs/run-registry-control-plane.7.md](docs/run-registry-control-plane.7.md)
for the cross-repo run registry / control plane contract.

## License

CW is released under the BSD-2-Clause License.

## Scheduled Tasks

```bash
node scripts/cw.js loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule create --kind loop --intervalMinutes 30 --prompt "Continue this workflow."
node scripts/cw.js schedule due
node scripts/cw.js schedule pause <schedule-id>
node scripts/cw.js schedule resume <schedule-id>
node scripts/cw.js schedule run-now <schedule-id>
node scripts/cw.js schedule history <schedule-id>
node scripts/cw.js schedule daemon --once
```

See [docs/scheduled-tasks.md](docs/scheduled-tasks.md).

## Routine-Style Triggers

```bash
node scripts/cw.js routine create --kind api --prompt "Handle this API event."
node scripts/cw.js routine create --kind github --prompt "Handle this GitHub event."
node scripts/cw.js routine fire api payload.json
node scripts/cw.js routine events
```

## Result Envelope

Verification and synthesis tasks need a structured result block:

````text
```cw:result
{
  "summary": "short summary",
  "findings": [
    {
      "id": "risk-1",
      "classification": "real",
      "severity": "P1",
      "evidence": ["/absolute/path/file.ts:42"]
    }
  ],
  "evidence": ["/absolute/path/file.ts:42"]
}
```
````

## 0.1.88 (v0.1.88)

Orchestration-parity for the agent drive — inline `subWorkflow()` nesting, bounded dynamic `loop()` phases (a `predicate` or a `budget-target` token `until`), and `cw run --drive --incremental` step-level resume; the agent now signs its findings (result-bound ed25519) and `cw report verify-bundle --require-signatures` proves offline that every signed finding is in the report unaltered; CLI simplified to 6 commands with agent streaming on by default; path-traversal run ids refused on archive import.

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing
