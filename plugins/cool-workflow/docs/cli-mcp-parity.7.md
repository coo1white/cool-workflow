# CLI ↔ MCP Parity

CW v0.1.27 adds CLI ↔ MCP Parity. CW has two front doors. The CLI
(`node scripts/cw.js ...`, `dist/cli.js`) is built for human speed: short,
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

The mechanism is the capability registry at `src/capability-registry.ts`
(compiled to `dist/capability-registry.js`). It is the one true source. Every
capability names one shared core `entry` — the mechanism both surfaces go
through — plus its CLI command, its MCP tool, the surface it is on, and whether
its payload is the same across surfaces.

No business logic is left on its own in `cli.ts` or `mcp-server.ts`. Composite
capabilities are in `src/capability-core.ts` (`planSummary`, `appRun`,
`sandboxChoose`, `commitEnvelope`), so both surfaces call the same core entry
and are different only in how they render its result. The CLI renders for a
human; the MCP tool renders for a machine; neither one owns the logic.

A new runtime capability is added one time, in the registry, against one core
entry. The CLI command and the MCP tool are then two policies over that one
mechanism — which is just what the parity gate checks.

The MCP tool list is being pulled in toward that one source too. The first
read-only inspection group (`operator.status`, `graph`, `operator.report`,
worker/candidate/feedback/commit summaries, and the simple multi-agent inspection
views) gets its MCP tool name and description straight from the capability
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
local deterministic work such as app show/validate/package, topology
show/validate/apply/summary/graph, sandbox show/validate/choose/resolve, state
summary refresh/show, `plan`, `approve`, `reject`, `comment.add`, `handoff`, and
`review.policy`.

## The Parity Matrix

The matrix below is made from the live registry — one row per capability,
showing its CLI command, MCP tool, shared core entry, surface, and payload
relationship. `identical` means `cw <cmd> --json` is equal to the `cw_<tool>`
payload; `projected` means a declared divergence with a reason; `cli-only` marks
a surface-specific capability with a recorded reason. The matrix is
<!-- gen:parity:count -->
machine-complete by design: 237 capabilities, 196 MCP tools.
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
| `workbench.view` | `cw workbench view` | `cw_workbench_view` | `workbench.view` | both | identical |
| `workbench.serve` | `cw workbench serve` | `cw_workbench_serve` | `workbench.serve` | both | projected |
| `candidate.summary` | `cw candidate summary` | `cw_candidate_summary` | `candidate.summary` | both | identical |
| `feedback.summary` | `cw feedback summary` | `cw_feedback_summary` | `feedback.summary` | both | identical |
| `commit.summary` | `cw commit summary` | `cw_commit_summary` | `commit.summary` | both | identical |
| `multi-agent.summary` | `cw multi-agent summary` | `cw_multi_agent_summary` | `multi-agent.summary` | both | identical |
| `multi-agent.graph` | `cw multi-agent graph` | `cw_multi_agent_graph` | `multi-agent.graph` | both | identical |
| `multi-agent.dependencies` | `cw multi-agent dependencies` | `cw_multi_agent_dependencies` | `multi-agent.dependencies` | both | identical |
| `multi-agent.failures` | `cw multi-agent failures` | `cw_multi_agent_failures` | `multi-agent.failures` | both | identical |
| `multi-agent.evidence` | `cw multi-agent evidence` | `cw_multi_agent_evidence` | `multi-agent.evidence` | both | identical |
| `multi-agent.reasoning` | `cw multi-agent reasoning` | `cw_evidence_reasoning` | `multi-agent.reasoning` | both | identical |
| `multi-agent.reasoning.refresh` | `cw multi-agent reasoning` | `cw_evidence_reasoning_refresh` | `multi-agent.reasoning.refresh` | both | identical |
| `summary.refresh` | `cw summary refresh` | `cw_summary_refresh` | `summary.refresh` | both | identical |
| `summary.show` | `cw summary show` | `cw_summary_show` | `summary.show` | both | identical |
| `blackboard.summarize` | `cw blackboard summarize` | `cw_blackboard_summarize` | `blackboard.summarize` | both | identical |
| `multi-agent.summarize` | `cw multi-agent summarize` | `cw_multi_agent_summarize` | `multi-agent.summarize` | both | identical |
| `multi-agent.graph.compact` | `cw multi-agent graph` | `cw_multi_agent_graph_compact` | `multi-agent.graph.compact` | both | identical |
| `multi-agent.run` | `cw multi-agent run` | `cw_multi_agent_run` | `multi-agent.run` | both | identical |
| `multi-agent.status` | `cw multi-agent status` | `cw_multi_agent_status` | `multi-agent.status` | both | identical |
| `multi-agent.step` | `cw multi-agent step` | `cw_multi_agent_step` | `multi-agent.step` | both | identical |
| `multi-agent.blackboard` | `cw multi-agent blackboard` | `cw_multi_agent_blackboard` | `multi-agent.blackboard` | both | identical |
| `multi-agent.score` | `cw multi-agent score` | `cw_multi_agent_score` | `multi-agent.score` | both | identical |
| `multi-agent.select` | `cw multi-agent select` | `cw_multi_agent_select` | `multi-agent.select` | both | identical |
| `eval.snapshot` | `cw eval snapshot` | `cw_eval_snapshot` | `eval.snapshot` | both | identical |
| `eval.replay` | `cw eval replay` | `cw_eval_replay` | `eval.replay` | both | identical |
| `eval.compare` | `cw eval compare` | `cw_eval_compare` | `eval.compare` | both | identical |
| `eval.score` | `cw eval score` | `cw_eval_score` | `eval.score` | both | identical |
| `eval.gate` | `cw eval gate` | `cw_eval_gate` | `eval.gate` | both | identical |
| `eval.report` | `cw eval report` | `cw_eval_report` | `eval.report` | both | identical |
| `multi-agent.run.create` | `cw multi-agent role` | `cw_multi_agent_run_create` | `multi-agent.run.create` | both | identical |
| `multi-agent.run.transition` | `cw multi-agent transition` | `cw_multi_agent_run_transition` | `multi-agent.run.transition` | both | identical |
| `multi-agent.run.show` | `cw multi-agent show` | `cw_multi_agent_run_show` | `multi-agent.run.show` | both | identical |
| `multi-agent.role.create` | `cw multi-agent role` | `cw_multi_agent_role_create` | `multi-agent.role.create` | both | identical |
| `multi-agent.role.show` | `cw multi-agent role` | `cw_multi_agent_role_show` | `multi-agent.role.show` | both | identical |
| `multi-agent.group.create` | `cw multi-agent group` | `cw_multi_agent_group_create` | `multi-agent.group.create` | both | identical |
| `multi-agent.group.show` | `cw multi-agent group` | `cw_multi_agent_group_show` | `multi-agent.group.show` | both | identical |
| `multi-agent.membership.create` | `cw multi-agent membership` | `cw_multi_agent_membership_create` | `multi-agent.membership.create` | both | identical |
| `multi-agent.membership.show` | `cw multi-agent membership` | `cw_multi_agent_membership_show` | `multi-agent.membership.show` | both | identical |
| `multi-agent.fanout.create` | `cw multi-agent fanout` | `cw_multi_agent_fanout_create` | `multi-agent.fanout.create` | both | identical |
| `multi-agent.fanout.show` | `cw multi-agent fanout` | `cw_multi_agent_fanout_show` | `multi-agent.fanout.show` | both | identical |
| `multi-agent.fanin.collect` | `cw multi-agent fanin` | `cw_multi_agent_fanin_collect` | `multi-agent.fanin.collect` | both | identical |
| `multi-agent.fanin.show` | `cw multi-agent fanin` | `cw_multi_agent_fanin_show` | `multi-agent.fanin.show` | both | identical |
| `topology.list` | `cw topology list` | `cw_topology_list` | `topology.list` | both | identical |
| `topology.show` | `cw topology show` | `cw_topology_show` | `topology.show` | both | identical |
| `topology.validate` | `cw topology validate` | `cw_topology_validate` | `topology.validate` | both | identical |
| `topology.apply` | `cw topology apply` | `cw_topology_apply` | `topology.apply` | both | identical |
| `topology.summary` | `cw topology summary` | `cw_topology_summary` | `topology.summary` | both | identical |
| `topology.graph` | `cw topology graph` | `cw_topology_graph` | `topology.graph` | both | identical |
| `blackboard.summary` | `cw blackboard summary` | `cw_blackboard_summary` | `blackboard.summary` | both | identical |
| `blackboard.graph` | `cw blackboard graph` | `cw_blackboard_graph` | `blackboard.graph` | both | identical |
| `blackboard.resolve` | `cw blackboard resolve` | `cw_blackboard_resolve` | `blackboard.resolve` | both | identical |
| `blackboard.topic.create` | `cw blackboard topic` | `cw_blackboard_topic_create` | `blackboard.topic.create` | both | identical |
| `blackboard.message.post` | `cw blackboard message` | `cw_blackboard_message_post` | `blackboard.message.post` | both | identical |
| `blackboard.message.list` | `cw blackboard message` | `cw_blackboard_message_list` | `blackboard.message.list` | both | identical |
| `blackboard.context.put` | `cw blackboard context` | `cw_blackboard_context_put` | `blackboard.context.put` | both | identical |
| `blackboard.artifact.add` | `cw blackboard artifact` | `cw_blackboard_artifact_add` | `blackboard.artifact.add` | both | identical |
| `blackboard.artifact.list` | `cw blackboard artifact` | `cw_blackboard_artifact_list` | `blackboard.artifact.list` | both | identical |
| `blackboard.snapshot` | `cw blackboard snapshot` | `cw_blackboard_snapshot` | `blackboard.snapshot` | both | identical |
| `coordinator.summary` | `cw coordinator summary` | `cw_coordinator_summary` | `coordinator.summary` | both | identical |
| `coordinator.decision` | `cw coordinator decision` | `cw_coordinator_decision` | `coordinator.decision` | both | identical |
| `audit.summary` | `cw audit summary` | `cw_audit_summary` | `audit.summary` | both | identical |
| `audit.verify` | `cw audit verify` | `cw_audit_verify` | `audit.verify` | both | identical |
| `audit.worker` | `cw audit worker` | `cw_audit_worker` | `audit.worker` | both | identical |
| `audit.provenance` | `cw audit provenance` | `cw_audit_provenance` | `audit.provenance` | both | identical |
| `audit.multi-agent` | `cw audit multi-agent` | `cw_audit_multi_agent` | `audit.multi-agent` | both | identical |
| `audit.policy` | `cw audit policy` | `cw_audit_policy` | `audit.policy` | both | identical |
| `audit.role` | `cw audit role` | `cw_audit_role` | `audit.role` | both | identical |
| `audit.blackboard` | `cw audit blackboard` | `cw_audit_blackboard` | `audit.blackboard` | both | identical |
| `audit.judge` | `cw audit judge` | `cw_audit_judge` | `audit.judge` | both | identical |
| `audit.attest` | `cw audit attest` | `cw_audit_attest` | `audit.attest` | both | identical |
| `audit.decision` | `cw audit decision` | `cw_audit_decision` | `audit.decision` | both | identical |
| `dispatch` | `cw dispatch` | `cw_dispatch` | `dispatch` | both | identical |
| `sandbox.list` | `cw sandbox list` | `cw_sandbox_list` | `sandbox.list` | both | identical |
| `sandbox.show` | `cw sandbox show` | `cw_sandbox_show` | `sandbox.show` | both | identical |
| `sandbox.validate` | `cw sandbox validate` | `cw_sandbox_validate` | `sandbox.validate` | both | identical |
| `sandbox.choose` | `cw sandbox choose` | `cw_sandbox_choose` | `sandbox.choose` | both | identical |
| `sandbox.resolve` | `cw sandbox resolve` | `cw_sandbox_resolve` | `sandbox.resolve` | both | identical |
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
| `candidate.list` | `cw candidate list` | `cw_candidate_list` | `candidate.list` | both | identical |
| `candidate.show` | `cw candidate show` | `cw_candidate_show` | `candidate.show` | both | identical |
| `candidate.register` | `cw candidate register` | `cw_candidate_register` | `candidate.register` | both | identical |
| `candidate.score` | `cw candidate score` | `cw_candidate_score` | `candidate.score` | both | identical |
| `candidate.rank` | `cw candidate rank` | `cw_candidate_rank` | `candidate.rank` | both | identical |
| `candidate.select` | `cw candidate select` | `cw_candidate_select` | `candidate.select` | both | identical |
| `candidate.reject` | `cw candidate reject` | `cw_candidate_reject` | `candidate.reject` | both | identical |
| `approve` | `cw approve` | `cw_approve` | `approve` | both | identical |
| `reject` | `cw reject` | `cw_reject` | `reject` | both | identical |
| `comment.add` | `cw comment add` | `cw_comment_add` | `comment.add` | both | identical |
| `comment.list` | `cw comment list` | `cw_comment_list` | `comment.list` | both | identical |
| `handoff` | `cw handoff` | `cw_handoff` | `handoff` | both | identical |
| `ledger.propose` | `cw ledger propose` | `cw_ledger_propose` | `ledger.propose` | both | projected |
| `ledger.review` | `cw ledger review` | `cw_ledger_review` | `ledger.review` | both | projected |
| `ledger.verify` | `cw ledger verify` | `cw_ledger_verify` | `ledger.verify` | both | projected |
| `ledger.apply` | `cw ledger apply` | `cw_ledger_apply` | `ledger.apply` | both | projected |
| `ledger.list` | `cw ledger list` | `cw_ledger_list` | `ledger.list` | both | projected |
| `review.status` | `cw review status` | `cw_review_status` | `review.status` | both | identical |
| `review.policy` | `cw review policy` | `cw_review_policy` | `review.policy` | both | identical |
| `feedback.list` | `cw feedback list` | `cw_feedback_list` | `feedback.list` | both | identical |
| `feedback.show` | `cw feedback show` | `cw_feedback_show` | `feedback.show` | both | identical |
| `feedback.collect` | `cw feedback collect` | `cw_feedback_collect` | `feedback.collect` | both | identical |
| `feedback.task` | `cw feedback task` | `cw_feedback_task` | `feedback.task` | both | identical |
| `feedback.resolve` | `cw feedback resolve` | `cw_feedback_resolve` | `feedback.resolve` | both | identical |
| `schedule.create` | `cw schedule create` | `cw_schedule_create` | `schedule.create` | both | identical |
| `schedule.list` | `cw schedule list` | `cw_schedule_list` | `schedule.list` | both | identical |
| `schedule.due` | `cw schedule due` | `cw_schedule_due` | `schedule.due` | both | identical |
| `schedule.complete` | `cw schedule complete` | `cw_schedule_complete` | `schedule.complete` | both | identical |
| `schedule.pause` | `cw schedule pause` | `cw_schedule_pause` | `schedule.pause` | both | identical |
| `schedule.resume` | `cw schedule resume` | `cw_schedule_resume` | `schedule.resume` | both | identical |
| `schedule.run-now` | `cw schedule run-now` | `cw_schedule_run_now` | `schedule.run-now` | both | identical |
| `schedule.history` | `cw schedule history` | `cw_schedule_history` | `schedule.history` | both | identical |
| `schedule.delete` | `cw schedule delete` | `cw_schedule_delete` | `schedule.delete` | both | identical |
| `routine.create` | `cw routine create` | `cw_routine_create` | `routine.create` | both | identical |
| `routine.list` | `cw routine list` | `cw_routine_list` | `routine.list` | both | identical |
| `routine.fire` | `cw routine fire` | `cw_routine_fire` | `routine.fire` | both | identical |
| `routine.events` | `cw routine events` | `cw_routine_events` | `routine.events` | both | identical |
| `routine.delete` | `cw routine delete` | `cw_routine_delete` | `routine.delete` | both | identical |
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
| `sched.plan` | `cw sched plan` | `cw_sched_plan` | `sched.plan` | both | identical |
| `sched.lease` | `cw sched lease` | `cw_sched_lease` | `sched.lease` | both | identical |
| `sched.release` | `cw sched release` | `cw_sched_release` | `sched.release` | both | identical |
| `sched.complete` | `cw sched complete` | `cw_sched_complete` | `sched.complete` | both | identical |
| `sched.reclaim` | `cw sched reclaim` | `cw_sched_reclaim` | `sched.reclaim` | both | identical |
| `sched.reset` | `cw sched reset` | `cw_sched_reset` | `sched.reset` | both | identical |
| `sched.policy.show` | `cw sched policy` | `cw_sched_policy_show` | `sched.policy.show` | both | identical |
| `sched.policy.set` | `cw sched policy` | `cw_sched_policy_set` | `sched.policy.set` | both | identical |
| `gc.plan` | `cw gc plan` | `cw_gc_plan` | `gc.plan` | both | identical |
| `gc.run` | `cw gc run` | `cw_gc_run` | `gc.run` | both | projected |
| `gc.verify` | `cw gc verify` | `cw_gc_verify` | `gc.verify` | both | identical |
| `clones.list` | `cw clones list` | `cw_clones_list` | `clones.list` | both | identical |
| `clones.gc` | `cw clones gc` | `cw_clones_gc` | `clones.gc` | both | projected |
| `orphans.list` | `cw orphans list` | `cw_orphans_list` | `orphans.list` | both | identical |
| `orphans.gc` | `cw orphans gc` | `cw_orphans_gc` | `orphans.gc` | both | projected |
| `telemetry.verify` | `cw telemetry verify` | `cw_telemetry_verify` | `telemetry.verify` | both | identical |
| `history` | `cw history` | `cw_history` | `history` | both | identical |
| `version` | `cw version` | `—` | `version` | cli-only | cli-only |
| `doctor` | `cw doctor` | `—` | `doctor` | cli-only | cli-only |
| `fix` | `cw fix` | `—` | `fix` | cli-only | cli-only |
| `quickstart` | `cw quickstart` | `—` | `quickstart` | cli-only | cli-only |
| `demo.tamper` | `cw demo tamper` | `—` | `demo.tamper` | cli-only | cli-only |
| `demo.bundle` | `cw demo bundle` | `—` | `demo.bundle` | cli-only | cli-only |
| `loop` | `cw loop` | `—` | `loop` | cli-only | cli-only |
| `schedule` | `cw schedule` | `—` | `schedule` | cli-only | cli-only |
| `routine` | `cw routine` | `—` | `routine` | cli-only | cli-only |
| `sched` | `cw sched` | `—` | `sched` | cli-only | cli-only |
| `registry` | `cw registry` | `—` | `registry` | cli-only | cli-only |
| `queue` | `cw queue` | `—` | `queue` | cli-only | cli-only |
| `gc` | `cw gc` | `—` | `gc` | cli-only | cli-only |
| `orphans` | `cw orphans` | `—` | `orphans` | cli-only | cli-only |
| `clones` | `cw clones` | `—` | `clones` | cli-only | cli-only |
| `app.usage` | `cw app` | `—` | `app.usage` | cli-only | cli-only |
| `sandbox.usage` | `cw sandbox` | `—` | `sandbox.usage` | cli-only | cli-only |
| `state.usage` | `cw state` | `—` | `state.usage` | cli-only | cli-only |
| `audit.usage` | `cw audit` | `—` | `audit.usage` | cli-only | cli-only |
| `blackboard.usage` | `cw blackboard` | `—` | `blackboard.usage` | cli-only | cli-only |
| `candidate.usage` | `cw candidate` | `—` | `candidate.usage` | cli-only | cli-only |
| `comment.usage` | `cw comment` | `—` | `comment.usage` | cli-only | cli-only |
| `eval.usage` | `cw eval` | `—` | `eval.usage` | cli-only | cli-only |
| `telemetry.usage` | `cw telemetry` | `—` | `telemetry.usage` | cli-only | cli-only |
| `demo.usage` | `cw demo` | `—` | `demo.usage` | cli-only | cli-only |
| `multi-agent.usage` | `cw multi-agent` | `—` | `multi-agent.usage` | cli-only | cli-only |
| `node.usage` | `cw node` | `—` | `node.usage` | cli-only | cli-only |
| `backend.usage` | `cw backend` | `—` | `backend.usage` | cli-only | cli-only |
| `contract.usage` | `cw contract` | `—` | `contract.usage` | cli-only | cli-only |
| `migration.usage` | `cw migration` | `—` | `migration.usage` | cli-only | cli-only |
| `feedback.usage` | `cw feedback` | `—` | `feedback.usage` | cli-only | cli-only |
| `metrics.usage` | `cw metrics` | `—` | `metrics.usage` | cli-only | cli-only |
| `operator.usage` | `cw operator` | `—` | `operator.usage` | cli-only | cli-only |
| `topology.usage` | `cw topology` | `—` | `topology.usage` | cli-only | cli-only |
| `summary.usage` | `cw summary` | `—` | `summary.usage` | cli-only | cli-only |
| `workbench.usage` | `cw workbench` | `—` | `workbench.usage` | cli-only | cli-only |
| `worker.usage` | `cw worker` | `—` | `worker.usage` | cli-only | cli-only |
| `review.usage` | `cw review` | `—` | `review.usage` | cli-only | cli-only |
| `coordinator.usage` | `cw coordinator` | `—` | `coordinator.usage` | cli-only | cli-only |
| `man` | `cw man` | `—` | `man` | cli-only | cli-only |
| `info` | `cw info` | `—` | `info` | cli-only | cli-only |
<!-- /gen:parity:table -->

v0.1.27 closed the old gaps. It added MCP peers `cw_init`, `cw_next`,
`cw_state_check`, `cw_contract_show`, `cw_node_list`, `cw_node_show`, and
`cw_node_graph`; and CLI peers `app run`, `operator status`, `operator report`,
`sandbox choose`, `sandbox resolve`, and `report --json`. All the rest is on
both surfaces.

## Surface-Specific Capabilities

A capability may be on one surface only, but never without word of it — it must
carry a recorded reason in the registry.

<!-- gen:parity:cliOnly -->
41 capabilities are CLI-only:

- `version` — version is a local, no-run-state print; the old build never gave it an MCP peer.
- `doctor` — Environment diagnostics are inherently local to the CLI host — Node version, $PATH, $CW_HOME/cwd writability. An MCP client diagnosing the server process's environment is not meaningful; agents already receive the same readiness facts in their typed results (e.g. status: blocked, agentConfigured). Inspired by `brew doctor`.
- `fix` — Environment fix commands are local diagnostics, same reasoning as doctor.
- `quickstart` — quickstart composes plan/runDrive/report; SPEC/mcp.md's declared cli-only list names it explicitly (no MCP peer). `audit-run` is a CLI-only alias of the same wrapper.
- `demo tamper` — Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo.
- `demo bundle` — Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface report.verify-bundle. No agent or MCP client needs to invoke a demo.
- `loop` — loop is CLI-only sugar over schedule.create; the old build never gave it an MCP tool of its own (SPEC/scheduling-registry.md section I).
- `schedule` — cw schedule is the desktop wall-clock scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_schedule_*), each wired below.
- `routine` — cw routine is the API/GitHub-style trigger bridge; SPEC/mcp.md declares its MCP peers per verb (cw_routine_*), each wired below.
- `sched` — cw sched is the durable-queue lease scheduler; SPEC/mcp.md declares its MCP peers per verb (cw_sched_*), each wired below.
- `registry` — cw registry is the derived run-registry index; SPEC/mcp.md declares its MCP peers (cw_registry_refresh|show), each wired below.
- `queue` — cw queue is the durable run queue; SPEC/mcp.md declares its MCP peers (cw_queue_add|list|drain|show), each wired below.
- `gc` — cw gc is run retention & provable reclamation; SPEC/mcp.md declares its MCP peers (cw_gc_plan|run|verify), each wired below.
- `orphans` — cw orphans reclaims killed-process run dirs with no state.json; SPEC/mcp.md declares its MCP peers (cw_orphans_list|gc), each wired below.
- `clones` — cw clones is the cached remote-source checkout cache; SPEC/mcp.md declares its MCP peers (cw_clones_list|gc), each wired below.
- `app` — app.usage exists only to own the fixed usage-error text for an unrecognized app subcommand; every real app.* action is its own capability row above.
- `sandbox` — sandbox.usage exists only to own the fixed usage-error text for an unrecognized sandbox subcommand; every real sandbox.* action is its own capability row above.
- `state` — state.usage exists only to own the fixed usage-error text for an unrecognized state subcommand; every real state.* action is its own capability row above.
- `audit` — audit.usage exists only to own the fixed usage-error text for an unrecognized audit subcommand; every real audit.* action is its own capability row above.
- `blackboard` — blackboard.usage exists only to own the fixed usage-error text for an unrecognized blackboard subcommand; every real blackboard.* action is its own capability row above.
- `candidate` — candidate.usage exists only to own the fixed usage-error text for an unrecognized candidate subcommand; every real candidate.* action is its own capability row above.
- `comment` — comment.usage exists only to own the fixed usage-error text for an unrecognized comment subcommand; every real comment.* action is its own capability row above.
- `eval` — eval.usage exists only to own the fixed usage-error text for an unrecognized eval subcommand; every real eval.* action is its own capability row above.
- `telemetry` — telemetry.usage exists only to own the fixed usage-error text for an unrecognized telemetry subcommand; every real telemetry.* action is its own capability row above.
- `demo` — demo.usage exists only to own the fixed usage-error text for an unrecognized demo subcommand; every real demo.* action is its own capability row above.
- `multi-agent` — multi-agent.usage exists only to own the fixed usage-error text for an unrecognized multi-agent subcommand; every real multi-agent.* action is its own capability row above.
- `node` — node.usage exists only to own the fixed usage-error text for an unrecognized node subcommand; every real node.* action is its own capability row above.
- `backend` — backend.usage exists only to own the fixed usage-error text for an unrecognized backend subcommand; every real backend.* action is its own capability row above.
- `contract` — contract.usage exists only to own the fixed usage-error text for an unrecognized contract subcommand; every real contract.* action is its own capability row above.
- `migration` — migration.usage exists only to own the fixed usage-error text for an unrecognized migration subcommand; every real migration.* action is its own capability row above.
- `feedback` — feedback.usage exists only to own the fixed usage-error text for an unrecognized feedback subcommand; every real feedback.* action is its own capability row above.
- `metrics` — metrics.usage exists only to own the fixed usage-error text for an unrecognized metrics subcommand; every real metrics.* action is its own capability row above.
- `operator` — operator.usage exists only to own the fixed usage-error text for an unrecognized operator subcommand; every real operator.* action is its own capability row above.
- `topology` — topology.usage exists only to own the fixed usage-error text for an unrecognized topology subcommand; every real topology.* action is its own capability row above.
- `summary` — summary.usage exists only to own the fixed usage-error text for an unrecognized summary subcommand; every real summary.* action is its own capability row above.
- `workbench` — workbench.usage exists only to own the fixed usage-error text for an unrecognized workbench subcommand; every real workbench.* action is its own capability row above.
- `worker` — worker.usage exists only to own the fixed usage-error text for an unrecognized worker subcommand; every real worker.* action is its own capability row above.
- `review` — review.usage exists only to own the fixed usage-error text for an unrecognized review subcommand; every real review.* action is its own capability row above.
- `coordinator` — coordinator.usage exists only to own the fixed usage-error text for an unrecognized coordinator subcommand; every real coordinator.* action is its own capability row above.
- `man` — man is a CLI-only raw-file reader over docs/; the old build never gave it an MCP peer.
- `info` — info is a CLI-only convenience card over app.show; the old build never gave it an MCP peer.
<!-- /gen:parity:cliOnly -->

<!-- gen:parity:projected -->
Twelve capabilities are payload-divergent on purpose (`projected`):

- `workbench.serve` — Both surfaces route through the single core entry buildWorkbenchServeDescriptor and return the IDENTICAL serve descriptor under `cw workbench serve --json`/`--once` and `cw_workbench_serve`. They diverge only in side effect, not payload: the CLI's default `cw workbench serve` (no --once) additionally STARTS the blocking localhost host, which an MCP stdio host cannot do, so cw_workbench_serve only ever returns the descriptor. Declared divergence, not drift.
- `backend.agent.config.set` — Mutating: persists $CW_HOME/agent-config.json (secret-stripped) before returning the effective config; both surfaces perform the same write — it is a surface-mutating verb, not a read probe.
- `commit` — Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection, not drift.
- `ledger.propose` — Mints a fresh entry each call: createdAt is the wall-clock instant and the id/digest are derived from it, so the output is inherently non-deterministic and a byte-identity probe does not apply. Both surfaces call the same buildLedgerProposal core; round-trip + fail-closed behavior is covered by ledger-verify-smoke.
- `ledger.review` — Mints a fresh timestamped/digested verdict each call — non-deterministic output, same reasoning as ledger.propose. Both surfaces call the same buildLedgerReview core.
- `ledger.verify` — The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same verifyLedgerEntry core; ledger-verify-smoke proves the fail-closed contract.
- `ledger.apply` — The entry arrives by --file/stdin on the CLI and as an `entry` argument over MCP; there is no shared arg-bag the byte-identity probe can feed both. Both surfaces call the same applyLedgerProposal core (a fail-closed wrapper over verifyLedgerEntry); ledger-apply-smoke proves the diff only escapes a verified proposal.
- `ledger.list` — Output depends on the on-disk contents of the named ledger directory/directories, which the generic payload probe does not populate. Both surfaces call the same listLedgerEntries/unionLedgerEntries core; ledger-verify-smoke covers the fail-closed inbox and the multi-mirror union.
- `run.drive.step` — Mutating: advances the run by spawning the external agent per worker and recording attested output — not a read probe. CLI (--drive/--step) and MCP route through the same drive() core.
- `gc.run` — Mutating: frees disk and appends a tombstone; both surfaces perform the identical transaction but the payload reports now-derived bytesFreed/tombstone.
- `clones.gc` — Mutating: removes cache directories and reports now-derived freedBytes/removed; both surfaces perform the identical reclamation.
- `orphans.gc` — Mutating: removes orphan run directories and reports now-derived freedBytes/removed; both surfaces perform the identical sweep.
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

## Enforcement & Smoke Coverage

Parity is checked by `scripts/parity-check.js --check`, run by
`npm run parity:check` and joined into `npm run release:check`. The check loads
the registry, lists the live CLI commands and MCP tools, and fails closed on any
of the rules above.

The CLI dispatcher (`src/cli/command-surface.ts`) is being decomposed out of one
large `switch` into per-command handler modules under `src/cli/handlers/`
(`handle<Group>(args, runner)`), with `command-surface.ts` left as the thin
router; shared helpers live in `src/cli/io.ts` (arg/JSON) and `src/cli/format.ts`
(render). Carved so far: `workbench`, `clones`, `audit`, `worker`, `schedule`, `routine`,
`sched`, `registry`, `queue`, `history`, `report`, `operator`, `graph`,
`topology`, `summary`, `multi-agent`, `run`, `approve`, `reject`, `comment`,
`handoff`, `review`, `blackboard`, `coordinator`, `eval`, `node`, `gc`,
`telemetry`, `demo`, `feedback`, `metrics`, `migration`, `sandbox`, `backend`,
`contract`, `candidate`. This is a pure code-move
— the command surface is unchanged — and the parity scanner reads
`dist/cli/handlers/*` so a subcommand `case` in a handler module still counts as a
live CLI token.

`test/cli-mcp-parity-smoke.js` proves the contract from end to end. It checks
registry ⇄ CLI ⇄ MCP coverage (every declared capability is found on its declared
surfaces and nothing live is undeclared), makes sure `--json` output is equal to
the MCP payload for every `payloadIdentical` capability, makes sure of the
declared `commit` projection, checks that safe write/multi-argument capabilities
are named scenario probes rather than deferred work, and makes sure of
fail-closed behavior by putting in drift — a peer taken away, an undeclared tool,
an exception with no reason, a bad probe classification, a changed payload — and
checking that the gate says no to each one. It is part of `npm test` and
`npm run release:check`.

The scenario probes now cover local worker/candidate/feedback read and write
paths. They make temp runs, send out a worker, write a fixed `result.md`, score
and pick a candidate, and make feedback from local state. No outside agent is
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
## Web / Desktop Workbench (v0.1.30)

v0.1.30 adds the Web / Desktop Workbench: a read-only, localhost-only human
console that renders this surface (and the other four operator panels — run
graph, blackboard, worker logs, candidate compare, audit timeline) for any run,
reading the SAME capability `--json` payloads. It is a THIRD FRONT DOOR next to
the CLI and MCP that holds no authoritative state and forks no schema: each panel
is equal to its `cw <cmd> --json` payload byte-for-byte (parity-gated), and
refresh makes everything again from disk. See
[web-desktop-workbench.7.md](web-desktop-workbench.7.md).

## Observability + Cost Accounting (v0.1.31)

v0.1.31 adds Observability + Cost Accounting: `metrics show`/`metrics summary`
work out durations, failure/verifier/acceptance rates (with sample counts and
fail-closed `n/a`), and host-attested token/cost from run state already kept on
disk — no metrics database, no collector daemon, no hidden counter. Usage is added
on and optional (when not there ⇒ `unreported`, never 0); cost is `attested`
(attested usage × a recorded pricing policy) or clearly `estimated`, with pricing
as policy. Both verbs are parity-gated and render read-only in the v0.1.30
Workbench. See
[observability-cost-accounting.7.md](observability-cost-accounting.7.md).


## Team Collaboration (v0.1.32)

v0.1.32 adds Team Collaboration: a host-attested actor and append-only
approvals/rejections/comments/handoffs provenance-linked to a durable target,
plus a review gate that STACKS ON the verifier gate — needed approvals from
authorized roles, enforced inside `resolveCommitGate` AFTER the verifier checks
and never in place of them, failing closed on quorum/authority/self-approval and
recording who said yes to the very artifact that shipped. Policy (needed
approvals, authorized roles, self-approval) is data, default off (pre-v0.1.32
behavior unchanged). The verbs are parity-gated and render read-only in the
v0.1.30 Workbench. See [Team Collaboration](team-collaboration.7.md).

## Release Tooling (v0.1.33)

the per-tag mechanical surfaces (version bump across 17 surfaces, feature scaffold, and the forward-reference docs) become deterministic scripts, with a release gate that has no copies. See release-tooling(7).

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence vs node and fail-closed refusal when a runtime/endpoint is not there to use. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and on-its-own deterministic replay over StateNode, using again the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

start up an outside agent process per worker, take in result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the bulk that can be built again, prove it

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
