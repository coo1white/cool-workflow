# Commands Or API

CW exposes the same runtime through CLI commands and MCP tools. Use `--json` or
`--format json` when scripting a CLI command.

Use `cw help` for the built-in help text. The CLI does not currently implement a
top-level `cw --help` flag.

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

## App Commands

| Command | Purpose |
| --- | --- |
| `cw app list` | List workflow apps. |
| `cw app show <app-id>` | Show app metadata, inputs, phases, and task counts. |
| `cw app validate <app-id>` | Validate an app manifest and workflow. |
| `cw plan <app-id> --repo PATH ...` | Create a run without driving all workers. |

Shipping apps include `architecture-review`, `architecture-review-fast`,
`pr-review-fix-ci`, `release-cut`, `research-synthesis`, and
`workflow-app-framework-demo`.

See [Workflow Apps](Workflow-Apps.md) for when to use each one.

## Run Commands

| Command | Purpose |
| --- | --- |
| `cw status <run-id>` | Show current run status. |
| `cw graph <run-id>` | Inspect run graph. |
| `cw dispatch <run-id> --limit N` | Allocate worker scopes. |
| `cw worker manifest <run-id> <worker-id>` | Read a worker manifest. |
| `cw worker output <run-id> <worker-id> <result.md>` | Accept and verify worker output. |
| `cw commit <run-id> --selection <selection-id>` | Create a verifier-gated state commit. |
| `cw report <run-id> --show` | Render the saved report. |

## Registry And Recovery

| Command | Purpose |
| --- | --- |
| `cw registry refresh --scope repo` | Rebuild the derived run index. |
| `cw run search --scope home --text TEXT` | Search runs across registered repos. |
| `cw run resume <run-id>` | Read-only next-action view. |
| `cw run resume <run-id> --drive` | Continue pending work through the agent drive loop. |
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

## MCP

MCP tools use `cw_` names and route through the same runtime entries. Examples:

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
