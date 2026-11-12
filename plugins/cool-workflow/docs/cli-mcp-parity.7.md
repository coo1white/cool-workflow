# CLI ↔ MCP Parity

CW v0.1.27 adds CLI ↔ MCP Parity. CW has two front doors. The CLI
(`cw ...`, `dist/cli.js`) is built for human speed: short,
easy-to-read text with exit codes that have clear sense. The MCP server
(`cw_*` JSON-RPC tools) is built for machine context: full, fixed, ordered JSON.
This release makes the two doors two views of one body of data — named, made from
it, and kept in line — so the same capability is not able to go off in different
ways between surfaces.

The design keeps to a base-system way of work that keeps mechanism apart from
policy:

- one true source: the capability registry, not two lists kept up by hand
- mechanism (shared core) is kept apart from policy (per-surface rendering)
- one source, two views; no undeclared divergence
- least surprise: like names, flags, order, and defaults across surfaces
- the surfaces do not get in each other's way: human formatting is never let into
  machine output, machine fullness never makes the default human view too big
- fail closed on drift; a surface mismatch is an error that blocks the release
- fixed interfaces, backward compatible; old names go on as aliases or wrappers
- it is not done till it is put in the docs and tested

## Mechanism vs Policy

The mechanism is the capability registry at `src/wiring/capability-table/`
(compiled to `dist/wiring/capability-table/index.js`; the old core re-export
of it is gone since 0.4.0, as it made core depend on wiring). It is the one
true source. Every
capability names one shared core `entry` — the mechanism both surfaces go
through — plus its CLI command, its MCP tool, the surface it is on, and whether
its payload is the same across surfaces.

No business logic is left on its own in `cli.ts` or `mcp-server.ts`. Composite
capabilities are in `src/shell/commands/pipeline-cli.ts` and `src/shell/commands/app-run-cli.ts` (`planSummary`, `appRun`,
`sandboxChoose`, `commitEnvelope`), so both surfaces call the same core entry
and are different only in how they render its result. The CLI renders for a
human; the MCP tool renders for a machine; neither one owns the logic.

A new runtime capability is added one time, in the registry, against one core
entry. The CLI command and the MCP tool are then two policies over that one
mechanism — which is just what the parity gate checks.

The MCP tool list is being pulled in toward that one source too. The first
read-only inspection group (`operator.status`, `graph`, `operator.report`,
and the worker/feedback/commit summaries) gets its MCP tool name and
description straight from the capability
registry; `mcp-server.ts` still owns the MCP input schema for those tools. This
keeps the public `tools/list` output the same while taking away one copied
description table at a time.

## Human vs Machine Contract

The two surfaces have different contracts and must not get in each other's way:

- CLI = human speed. The default output is short, easy-to-read text with exit
  codes that have clear sense. The canonical payload is there when you ask for it
  with `--json` or `--format json`. Human formatting is never sent on the machine
  path.
- MCP = machine context. The result is always full, fixed, ordered JSON. Machine
  fullness is never pushed into the default human view.

A capability marked `payloadIdentical` gives back the same canonical JSON from
`cw <cmd> --json` and from the `cw_<tool>` MCP result — apart from whitespace and
ISO timestamps from the moment of generation. The `--json` payload is the
contract, and it is the same bytes the MCP tool gives back. The human text view
is policy put on top; it never changes the payload.

Some payload checks need more than `cwd` or `runId`. The registry may name a
scenario probe for a safe local case. A scenario gets two new temp workspaces,
one for CLI and one for MCP, sets up the same state, runs one capability through
each door, and then compares the payload after taking out temp roots, run ids,
time stamps, and chain hashes that are made by that workspace. This is used for
local deterministic work such as app show/validate/package, sandbox
show/validate/choose, and `plan`.

## MCP Tool Hints and Version Negotiation

A `tools/list` entry may carry the standard MCP `annotations` field with
two behavior hints:

- `readOnlyHint: true` — the tool only reads; it makes no change on disk.
- `destructiveHint: true` (with `readOnlyHint: false`) — the tool deletes
  stored data. No tool carries it today: the gc and delete sweeps that did
  went with the frozen surfaces (2026-11-12).

The hints come from one side table (`MCP_TOOL_ANNOTATIONS` in
`src/core/capability-data.ts`), and a tool goes in only after its handler
was read and checked by hand — a wrong "read-only" mark on a writing tool
would be a safety bug, so a tool we are not certain about carries no
`annotations` field at all. Absent beats wrong. The field is additive: a
client that does not know it simply does not read it.

The MCP `initialize` reply also negotiates the protocol version now: a
client that asks for a supported version gets that version echoed back,
and any other request falls back to the newest supported entry (see
`SUPPORTED_PROTOCOL_VERSIONS` in `src/mcp/server.ts`). With today's
one-entry list the reply bytes are unchanged.

## MCP Tool Profile

By default `tools/list` gives only the `core` profile: twelve tools, in this
order:

```text
cw_app_list cw_app_show cw_app_run cw_run_drive_step cw_status cw_report
cw_run_resume cw_run_list cw_audit_verify cw_backend_probe cw_run_export
cw_run_restore
```

The full list is about 104 KB (about 30k tokens) that every client session
takes into its context; the core twelve are about 6.7 KB (measured
2026-09-28). The list is data: `MCP_CORE_TOOLS` in
`src/core/capability-data.ts`.

`CW_MCP_TOOLS` picks the profile:

- unset or `core`: the core twelve;
- `full`: every tool, in registry order, as before this profile came in;
- any other value: server start stops with a stderr diagnostic
  (`MCP tool policy CW_MCP_TOOLS must be core or full: <value>`) and a
  non-zero exit, before any JSON-RPC output.

The profile decides only what is listed. It is not a permission:
`tools/call` still takes every known tool name, so a script, a test, or
`scripts/parity-check.mjs` that calls a tool by name works the same under
either profile. When `CW_MCP_ENABLED_TOOLS` or `CW_MCP_DISABLED_TOOLS` is set,
that policy decides the list and the profile is not used. To get the old
list back, start the server with `CW_MCP_TOOLS=full`.

## MCP Tool Authority

`CW_MCP_ENABLED_TOOLS` and `CW_MCP_DISABLED_TOOLS` are optional comma lists of
exact MCP tool names. Space at either end of a name is taken out, and a second
name has no effect. The enabled list is an allowlist. The disabled list is then
applied, so deny has the last word. With both values unset, every tool may be
called and `tools/list` follows the tool profile above.

An empty name or a name not in the live registry stops server start with a
stderr diagnostic and a non-zero exit. Under a good policy, `tools/list` keeps
the registry order and shows only allowed tools. A call to a filtered tool gives
the normal MCP `isError: true` result and does not start its handler. This is a
server control, not an OS sandbox or an approval system.

## The Parity Matrix

The matrix below is made from the live registry — one row per capability,
showing its CLI command, MCP tool, shared core entry, surface, and payload
relationship. `identical` means `cw <cmd> --json` is equal to the `cw_<tool>`
payload; `projected` means a declared divergence with a reason; `cli-only` marks
a surface-specific capability with a recorded reason. The matrix is
<!-- gen:parity:count -->
machine-complete by design: 120 capabilities, 94 MCP tools.
<!-- /gen:parity:count -->

<!-- gen:parity:table -->
| Capability | CLI command | MCP tool | Core entry | Surface | Payload |
| --- | --- | --- | --- | --- | --- |
| `list` | `cw list` | `cw_list` | `list` | both | identical |
| `plan` | `cw plan` | `cw_plan` | `plan` | both | identical |
| `app.run` | `cw app run` | `cw_app_run` | `app.run` | both | identical |
| `status` | `cw status` | `cw_status` | `status` | both | identical |
| `init` | `cw init` | `cw_init` | `init` | both | identical |
| `next` | `cw next` | `cw_next` | `next` | both | identical |
| `state.check` | `cw state check` | `cw_state_check` | `state.check` | both | identical |
| `contract.show` | `cw contract show` | `cw_contract_show` | `contract.show` | both | identical |
| `node.list` | `cw node list` | `cw_node_list` | `node.list` | both | identical |
| `node.show` | `cw node show` | `cw_node_show` | `node.show` | both | identical |
| `node.graph` | `cw node graph` | `cw_node_graph` | `node.graph` | both | identical |
| `node.snapshot` | `cw node snapshot` | `cw_node_snapshot` | `node.snapshot` | both | identical |
| `node.diff` | `cw node diff` | `cw_node_diff` | `node.diff` | both | identical |
| `node.replay` | `cw node replay` | `cw_node_replay` | `node.replay` | both | identical |
| `node.replay.verify` | `cw node verify` | `cw_node_replay_verify` | `node.replay.verify` | both | identical |
| `migration.list` | `cw migration list` | `cw_migration_list` | `migration.list` | both | identical |
| `migration.check` | `cw migration check` | `cw_migration_check` | `migration.check` | both | identical |
| `migration.prove` | `cw migration prove` | `cw_migration_prove` | `migration.prove` | both | identical |
| `operator.status` | `cw operator status` | `cw_operator_status` | `operator.status` | both | identical |
| `graph` | `cw graph` | `cw_operator_graph` | `graph` | both | identical |
| `operator.report` | `cw operator report` | `cw_operator_report` | `operator.report` | both | identical |
| `worker.summary` | `cw worker summary` | `cw_worker_summary` | `worker.summary` | both | identical |
| `feedback.summary` | `cw feedback summary` | `cw_feedback_summary` | `feedback.summary` | both | identical |
| `commit.summary` | `cw commit summary` | `cw_commit_summary` | `commit.summary` | both | identical |
| `audit.summary` | `cw audit summary` | `cw_audit_summary` | `audit.summary` | both | identical |
| `audit.verify` | `cw audit verify` | `cw_audit_verify` | `audit.verify` | both | identical |
| `audit.repair` | `cw audit repair` | `cw_audit_repair` | `audit.repair` | both | identical |
| `audit.worker` | `cw audit worker` | `cw_audit_worker` | `audit.worker` | both | identical |
| `audit.provenance` | `cw audit provenance` | `cw_audit_provenance` | `audit.provenance` | both | identical |
| `audit.attest` | `cw audit attest` | `cw_audit_attest` | `audit.attest` | both | identical |
| `audit.decision` | `cw audit decision` | `cw_audit_decision` | `audit.decision` | both | identical |
| `dispatch` | `cw dispatch` | `cw_dispatch` | `dispatch` | both | identical |
| `sandbox.list` | `cw sandbox list` | `cw_sandbox_list` | `sandbox.list` | both | identical |
| `sandbox.show` | `cw sandbox show` | `cw_sandbox_show` | `sandbox.show` | both | identical |
| `sandbox.validate` | `cw sandbox validate` | `cw_sandbox_validate` | `sandbox.validate` | both | identical |
| `sandbox.choose` | `cw sandbox choose` | `cw_sandbox_choose` | `sandbox.choose` | both | identical |
| `backend.list` | `cw backend list` | `cw_backend_list` | `backend.list` | both | identical |
| `backend.show` | `cw backend show` | `cw_backend_show` | `backend.show` | both | identical |
| `backend.probe` | `cw backend probe` | `cw_backend_probe` | `backend.probe` | both | identical |
| `backend.agent.config.show` | `cw backend agent` | `cw_backend_agent_config_show` | `backend.agent.config.show` | both | identical |
| `backend.agent.config.set` | `cw backend agent` | `cw_backend_agent_config_set` | `backend.agent.config.set` | both | projected |
| `result` | `cw result` | `cw_result` | `result` | both | identical |
| `commit` | `cw commit` | `cw_commit` | `commit` | both | projected |
| `report` | `cw report` | `cw_report` | `report` | both | identical |
| `app.list` | `cw app list` | `cw_app_list` | `app.list` | both | identical |
| `app.show` | `cw app show` | `cw_app_show` | `app.show` | both | identical |
| `app.validate` | `cw app validate` | `cw_app_validate` | `app.validate` | both | identical |
| `app.init` | `cw app init` | `cw_app_init` | `app.init` | both | identical |
| `app.package` | `cw app package` | `cw_app_package` | `app.package` | both | identical |
| `worker.list` | `cw worker list` | `cw_worker_list` | `worker.list` | both | identical |
| `worker.show` | `cw worker show` | `cw_worker_show` | `worker.show` | both | identical |
| `worker.manifest` | `cw worker manifest` | `cw_worker_manifest` | `worker.manifest` | both | identical |
| `worker.output` | `cw worker output` | `cw_worker_output` | `worker.output` | both | identical |
| `worker.fail` | `cw worker fail` | `cw_worker_fail` | `worker.fail` | both | identical |
| `worker.validate` | `cw worker validate` | `cw_worker_validate` | `worker.validate` | both | identical |
| `ledger.propose` | `cw ledger propose` | `cw_ledger_propose` | `ledger.propose` | both | projected |
| `ledger.review` | `cw ledger review` | `cw_ledger_review` | `ledger.review` | both | projected |
| `ledger.verify` | `cw ledger verify` | `cw_ledger_verify` | `ledger.verify` | both | projected |
| `ledger.apply` | `cw ledger apply` | `cw_ledger_apply` | `ledger.apply` | both | projected |
| `ledger.list` | `cw ledger list` | `cw_ledger_list` | `ledger.list` | both | projected |
| `feedback.list` | `cw feedback list` | `cw_feedback_list` | `feedback.list` | both | identical |
| `feedback.show` | `cw feedback show` | `cw_feedback_show` | `feedback.show` | both | identical |
| `feedback.collect` | `cw feedback collect` | `cw_feedback_collect` | `feedback.collect` | both | identical |
| `feedback.task` | `cw feedback task` | `cw_feedback_task` | `feedback.task` | both | identical |
| `feedback.resolve` | `cw feedback resolve` | `cw_feedback_resolve` | `feedback.resolve` | both | identical |
| `registry.refresh` | `cw registry refresh` | `cw_registry_refresh` | `registry.refresh` | both | identical |
| `registry.show` | `cw registry show` | `cw_registry_show` | `registry.show` | both | identical |
| `metrics.show` | `cw metrics show` | `cw_metrics_show` | `metrics.show` | both | identical |
| `metrics.summary` | `cw metrics summary` | `cw_metrics_summary` | `metrics.summary` | both | identical |
| `run.search` | `cw run search` | `cw_run_search` | `run.search` | both | identical |
| `run.list` | `cw run list` | `cw_run_list` | `run.list` | both | identical |
| `run.show` | `cw run show` | `cw_run_show` | `run.show` | both | identical |
| `run.resume` | `cw run resume` | `cw_run_resume` | `run.resume` | both | identical |
| `run.archive` | `cw run archive` | `cw_run_archive` | `run.archive` | both | identical |
| `run.rerun` | `cw run rerun` | `cw_run_rerun` | `run.rerun` | both | identical |
| `run.export` | `cw run export` | `cw_run_export` | `run.export` | both | identical |
| `run.import` | `cw run import` | `cw_run_import` | `run.import` | both | identical |
| `run.verify-import` | `cw run verify-import` | `cw_run_verify_import` | `run.verify-import` | both | identical |
| `run.inspect-archive` | `cw run inspect-archive` | `cw_run_inspect_archive` | `run.inspect-archive` | both | identical |
| `run.restore` | `cw run restore` | `cw_run_restore` | `run.restore` | both | identical |
| `report.verify-bundle` | `cw report verify-bundle` | `cw_report_verify_bundle` | `report.verify-bundle` | both | identical |
| `report.bundle` | `cw report bundle` | `cw_report_bundle` | `report.bundle` | both | identical |
| `run.drive` | `cw run drive` | `cw_run_drive` | `run.drive` | both | identical |
| `run.drive.step` | `cw run` | `cw_run_drive_step` | `run.drive.step` | both | projected |
| `queue.add` | `cw queue add` | `cw_queue_add` | `queue.add` | both | identical |
| `queue.list` | `cw queue list` | `cw_queue_list` | `queue.list` | both | identical |
| `queue.drain` | `cw queue drain` | `cw_queue_drain` | `queue.drain` | both | identical |
| `queue.show` | `cw queue show` | `cw_queue_show` | `queue.show` | both | identical |
| `telemetry.verify` | `cw telemetry verify` | `cw_telemetry_verify` | `telemetry.verify` | both | identical |
| `history` | `cw history` | `cw_history` | `history` | both | identical |
| `audit.head` | `cw audit head` | `cw_audit_head` | `audit.head` | both | identical |
| `run.link` | `cw run link` | `cw_run_link` | `run.link` | both | identical |
| `check.list` | `cw check list` | `cw_check_list` | `check.list` | both | identical |
| `check.show` | `cw check show` | `cw_check_show` | `check.show` | both | identical |
| `version` | `cw version` | `—` | `version` | cli-only | cli-only |
| `completion` | `cw completion` | `—` | `completion` | cli-only | cli-only |
| `search` | `cw search` | `—` | `search` | cli-only | cli-only |
| `doctor` | `cw doctor` | `—` | `doctor` | cli-only | cli-only |
| `fix` | `cw fix` | `—` | `fix` | cli-only | cli-only |
| `quickstart` | `cw quickstart` | `—` | `quickstart` | cli-only | cli-only |
| `demo.tamper` | `cw demo tamper` | `—` | `demo.tamper` | cli-only | cli-only |
| `check.run` | `cw check` | `—` | `check.run` | cli-only | cli-only |
| `registry` | `cw registry` | `—` | `registry` | cli-only | cli-only |
| `queue` | `cw queue` | `—` | `queue` | cli-only | cli-only |
| `app.usage` | `cw app` | `—` | `app.usage` | cli-only | cli-only |
| `sandbox.usage` | `cw sandbox` | `—` | `sandbox.usage` | cli-only | cli-only |
| `state.usage` | `cw state` | `—` | `state.usage` | cli-only | cli-only |
| `audit.usage` | `cw audit` | `—` | `audit.usage` | cli-only | cli-only |
| `telemetry.usage` | `cw telemetry` | `—` | `telemetry.usage` | cli-only | cli-only |
| `demo.usage` | `cw demo` | `—` | `demo.usage` | cli-only | cli-only |
| `node.usage` | `cw node` | `—` | `node.usage` | cli-only | cli-only |
| `backend.usage` | `cw backend` | `—` | `backend.usage` | cli-only | cli-only |
| `contract.usage` | `cw contract` | `—` | `contract.usage` | cli-only | cli-only |
| `migration.usage` | `cw migration` | `—` | `migration.usage` | cli-only | cli-only |
| `feedback.usage` | `cw feedback` | `—` | `feedback.usage` | cli-only | cli-only |
| `metrics.usage` | `cw metrics` | `—` | `metrics.usage` | cli-only | cli-only |
| `operator.usage` | `cw operator` | `—` | `operator.usage` | cli-only | cli-only |
| `worker.usage` | `cw worker` | `—` | `worker.usage` | cli-only | cli-only |
| `man` | `cw man` | `—` | `man` | cli-only | cli-only |
| `info` | `cw info` | `—` | `info` | cli-only | cli-only |
<!-- /gen:parity:table -->

v0.1.27 closed the old gaps. It added MCP peers `cw_init`, `cw_next`,
`cw_state_check`, `cw_contract_show`, `cw_node_list`, `cw_node_show`, and
`cw_node_graph`; and CLI peers `app run`, `operator status`, `operator report`,
`sandbox choose`, and `report --json` (the alias `sandbox resolve` was taken
out on 2026-09-28). All the rest is on
both surfaces.

## Surface-Specific Capabilities

A capability may be on one surface only, but never without word of it — it must
carry a recorded reason in the registry.

<!-- gen:parity:cliOnly -->
26 capabilities are CLI-only:

- `version` — version is a local, no-run-state print; the old build never gave it an MCP peer.
- `completion` — shell-completion output is a script for the user's OWN shell to source, not data an MCP client could use — CLI-only, same reasoning as doctor/fix.
- `search` — CLI-only discovery helper over the same real app data cw list shows; no MCP client needs a free-text search tool alongside cw_list's structured output.
- `doctor` — Environment diagnostics are inherently local to the CLI host — Node version, $PATH, $CW_HOME/cwd writability. An MCP client diagnosing the server process's environment is not meaningful; agents already receive the same readiness facts in their typed results (e.g. status: blocked, agentConfigured). Inspired by `brew doctor`.
- `fix` — Environment fix commands are local diagnostics, same reasoning as doctor.
- `quickstart` — quickstart composes plan/runDrive/report; SPEC/mcp.md's declared cli-only list names it explicitly (no MCP peer). `audit-run` is a CLI-only alias of the same wrapper.
- `demo tamper` — Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo.
- `check` — Runs a local process for the person at the terminal; an MCP host already runs commands with its own tool and cites the receipt. Reading receipts is both-surface (check.list, check.show).
- `registry` — cw registry is the derived run-registry index; SPEC/mcp.md declares its MCP peers (cw_registry_refresh|show), each wired below.
- `queue` — cw queue is the durable run queue; SPEC/mcp.md declares its MCP peers (cw_queue_add|list|drain|show), each wired below.
- `app` — app.usage exists only to own the fixed usage-error text for an unrecognized app subcommand; every real app.* action is its own capability row above.
- `sandbox` — sandbox.usage exists only to own the fixed usage-error text for an unrecognized sandbox subcommand; every real sandbox.* action is its own capability row above.
- `state` — state.usage exists only to own the fixed usage-error text for an unrecognized state subcommand; every real state.* action is its own capability row above.
- `audit` — audit.usage exists only to own the fixed usage-error text for an unrecognized audit subcommand; every real audit.* action is its own capability row above.
- `telemetry` — telemetry.usage exists only to own the fixed usage-error text for an unrecognized telemetry subcommand; every real telemetry.* action is its own capability row above.
- `demo` — demo.usage exists only to own the fixed usage-error text for an unrecognized demo subcommand; every real demo.* action is its own capability row above.
- `node` — node.usage exists only to own the fixed usage-error text for an unrecognized node subcommand; every real node.* action is its own capability row above.
- `backend` — backend.usage exists only to own the fixed usage-error text for an unrecognized backend subcommand; every real backend.* action is its own capability row above.
- `contract` — contract.usage exists only to own the fixed usage-error text for an unrecognized contract subcommand; every real contract.* action is its own capability row above.
- `migration` — migration.usage exists only to own the fixed usage-error text for an unrecognized migration subcommand; every real migration.* action is its own capability row above.
- `feedback` — feedback.usage exists only to own the fixed usage-error text for an unrecognized feedback subcommand; every real feedback.* action is its own capability row above.
- `metrics` — metrics.usage exists only to own the fixed usage-error text for an unrecognized metrics subcommand; every real metrics.* action is its own capability row above.
- `operator` — operator.usage exists only to own the fixed usage-error text for an unrecognized operator subcommand; every real operator.* action is its own capability row above.
- `worker` — worker.usage exists only to own the fixed usage-error text for an unrecognized worker subcommand; every real worker.* action is its own capability row above.
- `man` — man is a CLI-only raw-file reader over docs/; the old build never gave it an MCP peer.
- `info` — info is a CLI-only convenience card over app.show; the old build never gave it an MCP peer.
<!-- /gen:parity:cliOnly -->

<!-- gen:parity:projected -->
Eight capabilities are payload-divergent on purpose (`projected`):

- `backend.agent.config.set` — Mutating: persists $CW_HOME/agent-config.json (secret-stripped) before returning the effective config; both surfaces perform the same write — it is a surface-mutating verb, not a read probe.
- `commit` — Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection, not drift.
- `ledger.propose` — Mints a fresh entry each call: createdAt is the wall-clock instant and the id/digest are derived from it, so the output is inherently non-deterministic and a byte-identity probe does not apply. Both surfaces call the same buildLedgerProposal core; round-trip + fail-closed behavior is covered by ledger-verify-smoke.
- `ledger.review` — Mints a fresh timestamped/digested verdict each call — non-deterministic output, same reasoning as ledger.propose. Both surfaces call the same buildLedgerReview core.
- `ledger.verify` — The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same verifyLedgerEntry core; ledger-verify-smoke proves the fail-closed contract.
- `ledger.apply` — The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same applyLedgerProposal core (a fail-closed wrapper over verifyLedgerEntry); ledger-apply-smoke proves the diff only escapes a verified proposal.
- `ledger.list` — Output depends on the on-disk contents of the named ledger directory/directories, which the generic payload probe does not populate. Both surfaces call the same listLedgerEntries/unionLedgerEntries core; ledger-verify-smoke covers the fail-closed inbox and the multi-mirror union.
- `run.drive.step` — Mutating: advances the run by spawning the external agent per worker and recording attested output — not a read probe. CLI (--drive/--step) and MCP route through the same drive() core.
<!-- /gen:parity:projected -->

## Fail-Closed Rules

The parity gate fails closed. Any of the things below is an error that blocks the
release:

- a capability on one surface but not on the other
- an MCP tool that is live but not declared in the registry
- a CLI command or token that is live but not declared in the registry
- a surface-specific or payload-divergent capability with no recorded `reason`
- a payload divergence on a capability marked `payloadIdentical` — that is,
  `cw <cmd> --json` and `cw_<tool>` giving back different canonical JSON

There is no "fix it later" path. A surface mismatch blocks the release till the
registry, the surfaces, and the recorded reasons are in agreement.

Boolean arguments: an MCP tool argument sent as JSON `false` means false, the
same as leaving the flag out of the CLI (for example `cw_state_check`
`{"write": false}` does not write). JSON `true` and numbers still come to the handler as their
CLI string form (`"true"`, `"5"`).

## Enforcement & Smoke Coverage

Parity is checked by `scripts/parity-check.mjs --check`, run by
`npm run parity:check` and joined into `npm run release:check`. The check loads
the registry, lists the live CLI commands and MCP tools, and fails closed on any
of the rules above.

The CLI dispatch surface is table-driven, not a hand-kept `switch`. The source
tree is small: `src/cli/entry.ts` (process entry), `src/cli/parseargv.ts`
(argv reading), `src/cli/dispatch.ts` (the one dispatcher), and `src/cli/io.ts`
(output helpers: `printJson`, `styledHelp`). `dispatch(args)` looks the parsed
command up in the capability table (`src/wiring/capability-table/index.ts`,
put together from the slices beside it) and runs that
row's `cli.handler` — a new capability is a new table row, never a new `case`.
The shared arg helpers (`required`, `optionalArg`, `wantsJson`) live in
`src/core/util/cli-args.ts`, a pure module used by the CLI and MCP sides of
every wiring slice; they were moved out of `src/cli/io.ts` because the purity
gate's layer rule says `wiring/` may not take imports from `cli/`. The parity
gate does not use a token list made from the registry as proof of that same
registry. It runs real `cw help`, checks every declared CLI path through the
dispatcher lookup used by `dispatch(args)`, reads MCP `tools/list` from a live
server, and runs CLI-process to MCP payload probes. There is no grep over built
dispatch source.

`test/cli-mcp-parity-smoke.mjs` proves the contract from end to end. It checks
registry ⇄ CLI ⇄ MCP coverage (every declared capability is found on its declared
surfaces and nothing live is undeclared), makes sure `--json` output is equal to
the MCP payload for every `payloadIdentical` capability, makes sure of the
declared `commit` projection, checks that safe write/multi-argument capabilities
are named scenario probes rather than deferred work, and makes sure of
fail-closed behavior by putting in drift — a peer taken away, an undeclared tool,
an exception with no reason, a bad probe classification, a changed payload — and
checking that the gate says no to each one. It is part of `npm test` and
`npm run release:check`.

The scenario probes now cover local worker/feedback read and write paths.
They make temp runs, send out a worker, write a fixed `result.md`, and make
feedback from local state. No outside agent is
run; the probe checks only that CLI and MCP carry the same JSON to the same CW
core.

They also cover local state-node read, snapshot, diff, replay, and replay-check
paths from the same temp run. Snapshot and replay ids are made by CW, so the
parity check sets aside only those made ids and timestamps before it compares the
JSON.

In CW, parity is not a custom; it is a built, declared, and kept property of the
build. It is not done till it is put in the docs and tested.

## Run Registry / Control Plane (v0.1.28)

v0.1.28 adds 13 control-plane capabilities — `registry refresh|show`, `run
search|list|show|resume|archive|rerun`, `queue add|list|drain|show`, and
`history` — declared one time in the capability registry and checked by the same
fail-closed parity gate, so each `cw <cmd> --json` is schema-identical to its
`cw_<tool>`. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with `node`/`bun`/`shell`/`container`/`remote`/`ci` drivers you can swap,
picked by `--backend` (parallel to `--sandbox`) and looked at through
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is the same no matter which backend ran a run. See
[execution-backends.7.md](execution-backends.7.md).
## Web / Desktop Workbench (v0.1.30, removed)

v0.1.30 added the Web / Desktop Workbench, a read-only localhost console over run state. It was removed on 2026-11-12; see release-and-migration(7), "Removed Surfaces".

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from run state already kept on
disk — no metrics database, no collector daemon, no hidden counter. Usage is added
on and optional (when not there ⇒ `unreported`, never 0); cost is `attested`
(attested usage × a recorded pricing policy) or clearly `estimated`, with pricing
as policy. Both verbs are parity-gated. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).

Since 2026-11-12 CW no longer prices usage: the pricing policy (`--pricing`) and the hand-recorded usage flags went with the observability intake module, and cost is `unpriced` or `unreported` only.

## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — needed approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who said yes to the very artifact that shipped. Policy (needed
approvals, authorized roles, self-approval) is data, default off (pre-v0.1.32
behavior unchanged). Team Collaboration and its review gate were taken out
with the multi-agent family (slim-and-esm program, step 2); see
release-and-migration(7), "Removed Surfaces".

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no copies. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and on-its-own deterministic replay over StateNode, using again the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37, removed)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue. Removed 2026-11-12; see release-and-migration(7), "Removed Surfaces".

## Agent Delegation Drive (v0.1.38)

start up an outside agent process per worker, take in result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39, removed)

tiered, append-only, hash-chained run reclamation (`cw gc`, `cw orphans`). Removed 2026-11-12; see release-and-migration(7), "Removed Surfaces".

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock putting in order the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object broken up into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

take in findings/evidence from any agent shape that makes sense (alt keys + prose), CW works out grounded evidence itself, give a warning on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) in place of the mutable working tree — doing away with false-red/false-green from concurrent working-tree writes (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one common interface to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).
0.1.51

0.1.76

0.1.77

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, Map and Assess results you can use again, wrapper metrics you can measure, a background full-review handoff you can act on, and userland model policy flags for routing fast/strong workers without changing the full review contract.

## Re-Prove Verbs on Both Surfaces (v0.1.81)

v0.1.81 grows the parity surface with two new both-surface, fail-closed verbs declared one time in the capability registry: `cw audit verify` / `cw_audit_verify` proves the trust-audit chain again and exits non-zero on any unverified or corrupt chain, and `cw run inspect-archive` / `cw_run_inspect_archive` is a read-only archive integrity check. Each `cw <cmd> --json` is schema-identical to its `cw_<tool>` and checked by the same parity gate.
_No changes in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

No other change to this page in v0.1.84.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

CLI surface simplified to 6 commands with agent stderr streaming on by default and vendor agent flags; the drive gains a `--incremental` flag (added to DRIVE_RUNTIME_KEYS so it never poisons run.inputs or the cache key). MCP tools stay the derived mirror of the same capabilities.

## 0.1.89 (v0.1.89)

CLI golden-path fixes: `cw -q "…"` routes the question (was read as an app id → "Workflow app not found"), auto-detects the cwd as the repo (run anywhere, no `--repo`), and `cw help` wraps its command list with a trailing newline; the CLI↔MCP parity contract and the help-token parser are unchanged.

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97

0.1.98

0.2.0

0.2.1

0.2.2

0.2.3

0.2.4

0.2.5

0.2.6

0.2.7

0.2.8

0.3.0

0.3.1

0.3.2

0.3.3

0.4.0

0.4.1

0.4.2

0.4.3

0.4.4
