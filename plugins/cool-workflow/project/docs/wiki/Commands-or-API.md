# Commands Or API

*A reference page: the commands you will reach for most, in one place.*

CW offers the same runtime through CLI commands and MCP tools. Use `--json`
or `--format json` when a script needs to read a CLI command's output.

This page lists the common, stable command shapes — not the whole surface.
The full command list is `cw help`, and each command is described in
[`docs/reference.md`](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/docs/reference.md).
Read it there, so this page never drifts from the code.

Use `cw help`, the top-level `cw --help` / `cw -h` flags, or `cw <command>
--help` for help on one command.

## Entry Points

```bash
npx cool-workflow <command>
cw <command>
node plugins/cool-workflow/scripts/cw.js <command>
```

## First-Run Commands

| Command | Purpose |
| --- | --- |
| `cw demo tamper` | Hermetic tamper-evidence proof. |
| `cw quickstart architecture-review --repo PATH --question TEXT --agent-command builtin:claude` | Plan, drive, verify, and report a repo review. |
| `cw quickstart architecture-review --repo PATH --question TEXT --preview` | Read-only projection of the next action. |
| `cw quickstart architecture-review --repo PATH --question TEXT --resume` | Advance one step and print a continue line. |

The `audit-run` token is a CLI-only alias for `quickstart`.

## Setup Commands

| Command | Purpose |
| --- | --- |
| `cw doctor` | Check Node.js, git, your agent (it starts the agent's CLI with `--version`), and file write access. |
| `cw doctor --conformance` | Run your agent one time on a small task and check it keeps the agent contract, `cw-agent/1` (one short model call). |
| `cw fix` | Print the commands that fix each failed check. |
| `cw backend probe agent --json` | Is an agent command or endpoint configured? |

## App Commands

| Command | Purpose |
| --- | --- |
| `cw app list` | List workflow apps. |
| `cw app show <app-id>` | Show app metadata, inputs, phases, and task counts. |
| `cw app validate <app-id>` | Validate an app manifest and workflow. |
| `cw plan <app-id> --repo PATH ...` | Create a run without driving all workers. |
| `cw init <app-id>` | Make a new app in `./apps/<app-id>/` (from 0.3.3; `cw app list` then shows it). |

Seven apps ship in `apps/`. The five canonical lanes are `architecture-review`,
`architecture-review-fast`, `pr-review-fix-ci`, `release-cut`, and
`research-synthesis`; the example and the golden-path proof are
`workflow-app-framework-demo` and `end-to-end-golden-path`. Use `cw app list` for the live set.

See [Workflow Apps](Workflow-Apps.md) for when to use each one.

## Run Commands

| Command | Purpose |
| --- | --- |
| `cw status <run-id>` | Show current run status. |
| `cw graph <run-id>` | Inspect run graph. |
| `cw dispatch <run-id> --limit N` | Allocate worker scopes. |
| `cw worker manifest <run-id> <worker-id>` | Read a worker manifest. |
| `cw worker output <run-id> <worker-id> <result.md>` | Accept and verify worker output. |
| `cw commit <run-id> --verifier <verifier-node-id> --reason "..."` | Create a verifier-gated state commit. |
| `cw report <run-id> --show` | Render the saved report. |

## Registry And Recovery

| Command | Purpose |
| --- | --- |
| `cw registry refresh --scope repo` | Rebuild the derived run index. |
| `cw run search --scope home --text TEXT` | Search runs across registered repos. |
| `cw run resume <run-id>` | Read-only next-action view. |
| `cw run resume <run-id> --drive` | Continue pending work through the agent drive loop. |
| `cw --resume --run <run-id>` | Bare form of resume; needs the cwd inside the project, or `--repo <path>`. |
| `cw run export <run-id> --output PATH` | Write a portable run archive. |
| `cw run inspect-archive PATH` | Check an archive without importing. |
| `cw run import PATH --target DIR` | Restore an archive under another repo. |
| `cw run verify-import <run-id> --cwd DIR --strict` | Re-prove restored digests and chains. |

## Verification

| Command | Purpose |
| --- | --- |
| `cw telemetry verify <run-id>` | Re-prove telemetry ledger integrity. |
| `cw telemetry verify <run-id> --pubkey <public.pem>` | Re-run ed25519 attribution checks. |
| `cw audit verify <run-id>` | Re-prove the trust-audit hash chain. |

See [Trust And Audit](Trust-And-Audit.md) for what these checks prove and what
they do not prove.

## Hand Work Between Agents

`cw ledger` lets two agents, each working in its own repo, hand each other a
change or a review as a small JSON file with a digest, put in a shared git
repo. Every entry is checked, and a changed entry fails the whole read.

| Command | Purpose |
| --- | --- |
| `cw ledger propose --from A --to B --title TEXT --rationale TEXT --diff "$(git diff)"` | Make a change proposal (printed as JSON). |
| `cw ledger review --from B --to A --target <id> --verdict approved` | Make a review of a proposal. |
| `cw ledger list --ledger-dir ledger` | Read and check every entry in a folder. |
| `cw ledger verify --file <file>` | Check one entry. |

CW holds no git logic here: you `git add`, commit, and push the files.
Full rules: `plugins/cool-workflow/docs/reference.md`, "Removed surfaces" (`cw man cross-agent-ledger` was removed in batch 5). (The older approve, comment, and
handoff commands went in 0.3.1 with the multi-agent family.)

## MCP

MCP tools use `cw_` names and route through the same runtime entries.
`tools/list` gives 12 core tools by default; start the server with
`CW_MCP_TOOLS=full` to list every tool. Examples:

- `cw_app_list`
- `cw_run_resume`
- `cw_run_import`
- `cw_run_verify_import`
- `cw_report`
- `cw_telemetry_verify`

Generated manifests are kept in sync from
`plugins/cool-workflow/manifest/plugin.manifest.json`. The load smoke test boots
each generated MCP config and checks a JSON-RPC initialize plus `tools/list`
round trip.

See [MCP And Manifests](MCP-And-Manifests.md) for the generated vendor targets.
