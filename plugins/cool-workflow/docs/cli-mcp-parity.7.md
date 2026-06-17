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

## The Parity Matrix

The matrix below is made from the live registry — one row per capability,
showing its CLI command, MCP tool, shared core entry, surface, and payload
relationship. `identical` means `cw <cmd> --json` is equal to the `cw_<tool>`
payload; `projected` means a declared divergence with a reason; `cli-only` marks
a surface-specific capability with a recorded reason. The matrix is
<!-- gen:parity:count -->
machine-complete by design: 191 capabilities, 185 MCP tools.
<!-- /gen:parity:count -->

<!-- gen:parity:table -->
| Capability | CLI command | MCP tool | Core entry | Surface | Payload |
| --- | --- | --- | --- | --- | --- |
| `help` | `cw help` | `—` | `formatHelp` | cli-only | cli-only |
| `list` | `cw list` | `cw_list` | `listWorkflows` | both | identical |
| `doctor` | `cw doctor` | `—` | `runDoctor` | cli-only | cli-only |
| `init` | `cw init` | `cw_init` | `init` | both | identical |
| `plan` | `cw plan` | `cw_plan` | `planSummary` | both | identical |
| `status` | `cw status` | `cw_status` | `status` | both | identical |
| `next` | `cw next` | `cw_next` | `next` | both | identical |
| `dispatch` | `cw dispatch` | `cw_dispatch` | `dispatch` | both | identical |
| `result` | `cw result` | `cw_result` | `recordResult` | both | identical |
| `commit` | `cw commit` | `cw_commit` | `commit` | both | projected |
| `commit.summary` | `cw commit summary` | `cw_commit_summary` | `summarizeCommitRecords` | both | identical |
| `report` | `cw report` | `cw_report` | `report` | both | identical |
| `graph` | `cw graph` | `cw_operator_graph` | `operatorGraph` | both | identical |
| `loop` | `cw loop` | `—` | `scheduler.create` | cli-only | cli-only |
| `operator.status` | `cw operator status` | `cw_operator_status` | `operatorStatus` | both | identical |
| `operator.report` | `cw operator report` | `cw_operator_report` | `operatorReport` | both | identical |
| `app.list` | `cw app list` | `cw_app_list` | `listApps` | both | identical |
| `app.show` | `cw app show` | `cw_app_show` | `showApp` | both | identical |
| `app.validate` | `cw app validate` | `cw_app_validate` | `validateApp` | both | identical |
| `app.init` | `cw app init` | `cw_app_init` | `initApp` | both | identical |
| `app.package` | `cw app package` | `cw_app_package` | `packageApp` | both | identical |
| `app.run` | `cw app run` | `cw_app_run` | `appRun` | both | identical |
| `state.check` | `cw state check` | `cw_state_check` | `checkState` | both | identical |
| `contract.show` | `cw contract show` | `cw_contract_show` | `showContract` | both | identical |
| `node.list` | `cw node list` | `cw_node_list` | `listNodes` | both | identical |
| `node.show` | `cw node show` | `cw_node_show` | `showNode` | both | identical |
| `node.graph` | `cw node graph` | `cw_node_graph` | `graphNodes` | both | identical |
| `node.snapshot` | `cw node snapshot` | `cw_node_snapshot` | `nodeSnapshot` | both | identical |
| `node.diff` | `cw node diff` | `cw_node_diff` | `nodeDiff` | both | identical |
| `node.replay` | `cw node replay` | `cw_node_replay` | `nodeReplay` | both | identical |
| `node.replay.verify` | `cw node verify` | `cw_node_replay_verify` | `nodeReplayVerify` | both | identical |
| `migration.list` | `cw migration list` | `cw_migration_list` | `migrationList` | both | identical |
| `migration.check` | `cw migration check` | `cw_migration_check` | `migrationCheck` | both | identical |
| `migration.prove` | `cw migration prove` | `cw_migration_prove` | `migrationProve` | both | identical |
| `topology.list` | `cw topology list` | `cw_topology_list` | `listTopologies` | both | identical |
| `topology.show` | `cw topology show` | `cw_topology_show` | `showTopology` | both | identical |
| `topology.validate` | `cw topology validate` | `cw_topology_validate` | `validateTopology` | both | identical |
| `topology.apply` | `cw topology apply` | `cw_topology_apply` | `applyTopology` | both | identical |
| `topology.summary` | `cw topology summary` | `cw_topology_summary` | `topologySummary` | both | identical |
| `topology.graph` | `cw topology graph` | `cw_topology_graph` | `topologyGraph` | both | identical |
| `summary.refresh` | `cw summary refresh` | `cw_summary_refresh` | `summaryRefresh` | both | identical |
| `summary.show` | `cw summary show` | `cw_summary_show` | `summaryShow` | both | identical |
| `multi-agent.run` | `cw multi-agent run` | `cw_multi_agent_run` | `hostMultiAgentRun` | both | identical |
| `multi-agent.status` | `cw multi-agent status` | `cw_multi_agent_status` | `hostMultiAgentStatus` | both | identical |
| `multi-agent.step` | `cw multi-agent step` | `cw_multi_agent_step` | `hostMultiAgentStep` | both | identical |
| `multi-agent.blackboard` | `cw multi-agent blackboard` | `cw_multi_agent_blackboard` | `hostMultiAgentBlackboard` | both | identical |
| `multi-agent.score` | `cw multi-agent score` | `cw_multi_agent_score` | `hostMultiAgentScore` | both | identical |
| `multi-agent.select` | `cw multi-agent select` | `cw_multi_agent_select` | `hostMultiAgentSelect` | both | identical |
| `multi-agent.summary` | `cw multi-agent summary` | `cw_multi_agent_summary` | `multiAgentSummary` | both | identical |
| `multi-agent.summarize` | `cw multi-agent summarize` | `cw_multi_agent_summarize` | `multiAgentSummarize` | both | identical |
| `multi-agent.graph` | `cw multi-agent graph` | `cw_multi_agent_graph` | `multiAgentOperatorGraph` | both | identical |
| `multi-agent.graph.compact` | `cw multi-agent graph` | `cw_multi_agent_graph_compact` | `multiAgentGraphView` | both | identical |
| `multi-agent.dependencies` | `cw multi-agent dependencies` | `cw_multi_agent_dependencies` | `multiAgentDependencies` | both | identical |
| `multi-agent.failures` | `cw multi-agent failures` | `cw_multi_agent_failures` | `multiAgentFailures` | both | identical |
| `multi-agent.evidence` | `cw multi-agent evidence` | `cw_multi_agent_evidence` | `multiAgentEvidence` | both | identical |
| `multi-agent.reasoning` | `cw multi-agent reasoning` | `cw_evidence_reasoning` | `multiAgentReasoning` | both | identical |
| `multi-agent.reasoning.refresh` | `cw multi-agent reasoning` | `cw_evidence_reasoning_refresh` | `multiAgentReasoningRefresh` | both | identical |
| `multi-agent.run.create` | `cw multi-agent run` | `cw_multi_agent_run_create` | `createMultiAgentRun` | both | identical |
| `multi-agent.run.transition` | `cw multi-agent run` | `cw_multi_agent_run_transition` | `transitionMultiAgentRun` | both | identical |
| `multi-agent.run.show` | `cw multi-agent show` | `cw_multi_agent_run_show` | `showMultiAgentRun` | both | identical |
| `multi-agent.role.create` | `cw multi-agent role` | `cw_multi_agent_role_create` | `createAgentRole` | both | identical |
| `multi-agent.role.show` | `cw multi-agent role` | `cw_multi_agent_role_show` | `showAgentRole` | both | identical |
| `multi-agent.group.create` | `cw multi-agent group` | `cw_multi_agent_group_create` | `createAgentGroup` | both | identical |
| `multi-agent.group.show` | `cw multi-agent group` | `cw_multi_agent_group_show` | `showAgentGroup` | both | identical |
| `multi-agent.membership.create` | `cw multi-agent membership` | `cw_multi_agent_membership_create` | `assignAgentMembership` | both | identical |
| `multi-agent.membership.show` | `cw multi-agent membership` | `cw_multi_agent_membership_show` | `showAgentMembership` | both | identical |
| `multi-agent.fanout.create` | `cw multi-agent fanout` | `cw_multi_agent_fanout_create` | `createAgentFanout` | both | identical |
| `multi-agent.fanout.show` | `cw multi-agent fanout` | `cw_multi_agent_fanout_show` | `showAgentFanout` | both | identical |
| `multi-agent.fanin.collect` | `cw multi-agent fanin` | `cw_multi_agent_fanin_collect` | `collectAgentFanin` | both | identical |
| `multi-agent.fanin.show` | `cw multi-agent fanin` | `cw_multi_agent_fanin_show` | `showAgentFanin` | both | identical |
| `eval.snapshot` | `cw eval snapshot` | `cw_eval_snapshot` | `evalSnapshot` | both | identical |
| `eval.replay` | `cw eval replay` | `cw_eval_replay` | `evalReplay` | both | identical |
| `eval.compare` | `cw eval compare` | `cw_eval_compare` | `evalCompare` | both | identical |
| `eval.score` | `cw eval score` | `cw_eval_score` | `evalScore` | both | identical |
| `eval.gate` | `cw eval gate` | `cw_eval_gate` | `evalGate` | both | identical |
| `eval.report` | `cw eval report` | `cw_eval_report` | `evalReport` | both | identical |
| `blackboard.summary` | `cw blackboard summary` | `cw_blackboard_summary` | `blackboardSummary` | both | identical |
| `blackboard.summarize` | `cw blackboard summarize` | `cw_blackboard_summarize` | `blackboardSummarize` | both | identical |
| `blackboard.graph` | `cw blackboard graph` | `cw_blackboard_graph` | `blackboardGraph` | both | identical |
| `blackboard.resolve` | `cw blackboard resolve` | `cw_blackboard_resolve` | `resolveRunBlackboard` | both | identical |
| `blackboard.topic.create` | `cw blackboard topic create` | `cw_blackboard_topic_create` | `createBlackboardTopic` | both | identical |
| `blackboard.message.post` | `cw blackboard message post` | `cw_blackboard_message_post` | `postBlackboardMessage` | both | identical |
| `blackboard.message.list` | `cw blackboard message list` | `cw_blackboard_message_list` | `listBlackboardMessages` | both | identical |
| `blackboard.context.put` | `cw blackboard context put` | `cw_blackboard_context_put` | `putBlackboardContext` | both | identical |
| `blackboard.artifact.add` | `cw blackboard artifact add` | `cw_blackboard_artifact_add` | `addBlackboardArtifact` | both | identical |
| `blackboard.artifact.list` | `cw blackboard artifact list` | `cw_blackboard_artifact_list` | `listBlackboardArtifacts` | both | identical |
| `blackboard.snapshot` | `cw blackboard snapshot` | `cw_blackboard_snapshot` | `snapshotBlackboard` | both | identical |
| `coordinator.summary` | `cw coordinator summary` | `cw_coordinator_summary` | `coordinatorSummary` | both | identical |
| `coordinator.decision` | `cw coordinator decision` | `cw_coordinator_decision` | `recordCoordinatorDecision` | both | identical |
| `audit.summary` | `cw audit summary` | `cw_audit_summary` | `auditSummary` | both | identical |
| `audit.verify` | `cw audit verify` | `cw_audit_verify` | `auditVerify` | both | identical |
| `audit.worker` | `cw audit worker` | `cw_audit_worker` | `workerAudit` | both | identical |
| `audit.provenance` | `cw audit provenance` | `cw_audit_provenance` | `evidenceProvenance` | both | identical |
| `audit.multi-agent` | `cw audit multi-agent` | `cw_audit_multi_agent` | `auditMultiAgent` | both | identical |
| `audit.policy` | `cw audit policy` | `cw_audit_policy` | `auditPolicy` | both | identical |
| `audit.role` | `cw audit role` | `cw_audit_role` | `auditRole` | both | identical |
| `audit.blackboard` | `cw audit blackboard` | `cw_audit_blackboard` | `auditBlackboard` | both | identical |
| `audit.judge` | `cw audit judge` | `cw_audit_judge` | `auditJudge` | both | identical |
| `audit.attest` | `cw audit attest` | `cw_audit_attest` | `recordAuditAttestation` | both | identical |
| `audit.decision` | `cw audit decision` | `cw_audit_decision` | `recordAuditDecision` | both | identical |
| `sandbox.list` | `cw sandbox list` | `cw_sandbox_list` | `listSandboxProfiles` | both | identical |
| `sandbox.show` | `cw sandbox show` | `cw_sandbox_show` | `showSandboxProfile` | both | identical |
| `sandbox.validate` | `cw sandbox validate` | `cw_sandbox_validate` | `validateSandboxProfile` | both | identical |
| `sandbox.choose` | `cw sandbox choose` | `cw_sandbox_choose` | `sandboxChoose` | both | identical |
| `sandbox.resolve` | `cw sandbox resolve` | `cw_sandbox_resolve` | `sandboxChoose` | both | identical |
| `backend.list` | `cw backend list` | `cw_backend_list` | `listBackends` | both | identical |
| `backend.show` | `cw backend show` | `cw_backend_show` | `showBackend` | both | identical |
| `backend.probe` | `cw backend probe` | `cw_backend_probe` | `probeBackend` | both | identical |
| `backend.agent.config.show` | `cw backend agent config` | `cw_backend_agent_config_show` | `backendAgentConfigShow` | both | identical |
| `backend.agent.config.set` | `cw backend agent config` | `cw_backend_agent_config_set` | `backendAgentConfigSet` | both | projected |
| `worker.list` | `cw worker list` | `cw_worker_list` | `listWorkers` | both | identical |
| `worker.summary` | `cw worker summary` | `cw_worker_summary` | `summarizeWorkerRecords` | both | identical |
| `worker.show` | `cw worker show` | `cw_worker_show` | `showWorker` | both | identical |
| `worker.manifest` | `cw worker manifest` | `cw_worker_manifest` | `showWorkerManifest` | both | identical |
| `worker.output` | `cw worker output` | `cw_worker_output` | `recordWorkerOutput` | both | identical |
| `worker.fail` | `cw worker fail` | `cw_worker_fail` | `recordWorkerFailure` | both | identical |
| `worker.validate` | `cw worker validate` | `cw_worker_validate` | `validateWorker` | both | identical |
| `candidate.list` | `cw candidate list` | `cw_candidate_list` | `listCandidates` | both | identical |
| `candidate.show` | `cw candidate show` | `cw_candidate_show` | `showCandidate` | both | identical |
| `candidate.register` | `cw candidate register` | `cw_candidate_register` | `registerCandidate` | both | identical |
| `candidate.score` | `cw candidate score` | `cw_candidate_score` | `scoreCandidate` | both | identical |
| `candidate.rank` | `cw candidate rank` | `cw_candidate_rank` | `rankCandidates` | both | identical |
| `candidate.select` | `cw candidate select` | `cw_candidate_select` | `selectCandidate` | both | identical |
| `candidate.reject` | `cw candidate reject` | `cw_candidate_reject` | `rejectCandidate` | both | identical |
| `candidate.summary` | `cw candidate summary` | `cw_candidate_summary` | `summarizeCandidateOperatorRecords` | both | identical |
| `feedback.list` | `cw feedback list` | `cw_feedback_list` | `listFeedback` | both | identical |
| `feedback.show` | `cw feedback show` | `cw_feedback_show` | `showFeedback` | both | identical |
| `feedback.collect` | `cw feedback collect` | `cw_feedback_collect` | `collectFeedback` | both | identical |
| `feedback.summary` | `cw feedback summary` | `cw_feedback_summary` | `summarizeFeedbackRecords` | both | identical |
| `feedback.task` | `cw feedback task` | `cw_feedback_task` | `createFeedbackTask` | both | identical |
| `feedback.resolve` | `cw feedback resolve` | `cw_feedback_resolve` | `resolveFeedback` | both | identical |
| `schedule.create` | `cw schedule create` | `cw_schedule_create` | `scheduler.create` | both | identical |
| `schedule.list` | `cw schedule list` | `cw_schedule_list` | `scheduler.list` | both | identical |
| `schedule.delete` | `cw schedule delete` | `cw_schedule_delete` | `scheduler.delete` | both | identical |
| `schedule.due` | `cw schedule due` | `cw_schedule_due` | `scheduler.due` | both | identical |
| `schedule.complete` | `cw schedule complete` | `cw_schedule_complete` | `scheduler.complete` | both | identical |
| `schedule.pause` | `cw schedule pause` | `cw_schedule_pause` | `scheduler.pause` | both | identical |
| `schedule.resume` | `cw schedule resume` | `cw_schedule_resume` | `scheduler.resume` | both | identical |
| `schedule.run-now` | `cw schedule run-now` | `cw_schedule_run_now` | `scheduler.runNow` | both | identical |
| `schedule.history` | `cw schedule history` | `cw_schedule_history` | `scheduler.history` | both | identical |
| `schedule.daemon` | `cw schedule daemon` | `—` | `DesktopSchedulerDaemon.run` | cli-only | cli-only |
| `routine.create` | `cw routine create` | `cw_routine_create` | `triggers.create` | both | identical |
| `routine.list` | `cw routine list` | `cw_routine_list` | `triggers.list` | both | identical |
| `routine.delete` | `cw routine delete` | `cw_routine_delete` | `triggers.delete` | both | identical |
| `routine.fire` | `cw routine fire` | `cw_routine_fire` | `triggers.fire` | both | identical |
| `routine.events` | `cw routine events` | `cw_routine_events` | `triggers.events` | both | identical |
| `registry.refresh` | `cw registry refresh` | `cw_registry_refresh` | `runRegistry.refresh` | both | identical |
| `registry.show` | `cw registry show` | `cw_registry_show` | `runRegistry.show` | both | identical |
| `run.search` | `cw run search` | `cw_run_search` | `runRegistry.search` | both | identical |
| `run.list` | `cw run list` | `cw_run_list` | `runRegistry.list` | both | identical |
| `run.show` | `cw run show` | `cw_run_show` | `runRegistry.showRun` | both | identical |
| `run.resume` | `cw run resume` | `cw_run_resume` | `runRegistry.resume` | both | identical |
| `run.archive` | `cw run archive` | `cw_run_archive` | `runRegistry.archive` | both | identical |
| `run.rerun` | `cw run rerun` | `cw_run_rerun` | `runRegistry.rerun` | both | identical |
| `run.export` | `cw run export` | `cw_run_export` | `runExportArchive` | both | identical |
| `run.import` | `cw run import` | `cw_run_import` | `runImportArchive` | both | identical |
| `run.verify-import` | `cw run verify-import` | `cw_run_verify_import` | `runVerifyImport` | both | identical |
| `run.inspect-archive` | `cw run inspect-archive` | `cw_run_inspect_archive` | `runInspectArchive` | both | identical |
| `report.verify-bundle` | `cw report verify-bundle` | `cw_report_verify_bundle` | `runVerifyReportBundle` | both | identical |
| `run.drive` | `cw run drive` | `cw_run_drive` | `runDrivePreview` | both | identical |
| `run.drive.step` | `cw run drive` | `cw_run_drive_step` | `runDrive` | both | projected |
| `quickstart` | `cw quickstart` | `—` | `quickstart` | cli-only | cli-only |
| `queue.add` | `cw queue add` | `cw_queue_add` | `runRegistry.queueAdd` | both | identical |
| `queue.list` | `cw queue list` | `cw_queue_list` | `runRegistry.queueList` | both | identical |
| `queue.drain` | `cw queue drain` | `cw_queue_drain` | `runRegistry.queueDrain` | both | identical |
| `queue.show` | `cw queue show` | `cw_queue_show` | `runRegistry.queueShow` | both | identical |
| `sched.plan` | `cw sched plan` | `cw_sched_plan` | `schedPlan` | both | identical |
| `sched.lease` | `cw sched lease` | `cw_sched_lease` | `schedLease` | both | identical |
| `sched.release` | `cw sched release` | `cw_sched_release` | `schedRelease` | both | identical |
| `sched.complete` | `cw sched complete` | `cw_sched_complete` | `schedComplete` | both | identical |
| `sched.reclaim` | `cw sched reclaim` | `cw_sched_reclaim` | `schedReclaim` | both | identical |
| `sched.reset` | `cw sched reset` | `cw_sched_reset` | `schedReset` | both | identical |
| `sched.policy.show` | `cw sched policy` | `cw_sched_policy_show` | `schedPolicyShow` | both | identical |
| `sched.policy.set` | `cw sched policy` | `cw_sched_policy_set` | `schedPolicySet` | both | identical |
| `gc.plan` | `cw gc plan` | `cw_gc_plan` | `gcPlan` | both | identical |
| `gc.run` | `cw gc run` | `cw_gc_run` | `gcRun` | both | projected |
| `gc.verify` | `cw gc verify` | `cw_gc_verify` | `gcVerify` | both | identical |
| `telemetry.verify` | `cw telemetry verify` | `cw_telemetry_verify` | `telemetryVerify` | both | identical |
| `demo.tamper` | `cw demo tamper` | `—` | `demoTamper` | cli-only | cli-only |
| `history` | `cw history` | `cw_history` | `runRegistry.history` | both | identical |
| `workbench.view` | `cw workbench view` | `cw_workbench_view` | `buildWorkbenchRunView` | both | identical |
| `workbench.serve` | `cw workbench serve` | `cw_workbench_serve` | `buildWorkbenchServeDescriptor` | both | projected |
| `metrics.show` | `cw metrics show` | `cw_metrics_show` | `metricsShow` | both | identical |
| `metrics.summary` | `cw metrics summary` | `cw_metrics_summary` | `metricsSummary` | both | identical |
| `approve` | `cw approve` | `cw_approve` | `collaborationApprove` | both | identical |
| `reject` | `cw reject` | `cw_reject` | `collaborationReject` | both | identical |
| `comment.add` | `cw comment add` | `cw_comment_add` | `collaborationComment` | both | identical |
| `comment.list` | `cw comment list` | `cw_comment_list` | `collaborationCommentList` | both | identical |
| `handoff` | `cw handoff` | `cw_handoff` | `collaborationHandoff` | both | identical |
| `review.status` | `cw review status` | `cw_review_status` | `reviewStatus` | both | identical |
| `review.policy` | `cw review policy` | `cw_review_policy` | `reviewPolicy` | both | identical |
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
Six capabilities are CLI-only:

- `help` — Human help text. MCP hosts enumerate capabilities via tools/list, not a help command.
- `doctor` — Environment diagnostics are inherently local to the CLI host — Node version, $PATH, $CW_HOME/cwd writability. An MCP client diagnosing the server process's environment is not meaningful; agents already receive the same readiness facts in their typed results (e.g. status: blocked, agentConfigured). Inspired by `brew doctor`.
- `loop` — Convenience alias of `schedule create` with kind=loop. MCP hosts use cw_schedule_create with kind=loop.
- `schedule daemon` — Long-running desktop daemon process, not a request/response tool. MCP hosts drive ticks via cw_schedule_due + cw_schedule_run_now.
- `quickstart` — CLI UX convenience layer (newcomer first value in one command) over the existing run.drive.step + report verbs; it spawns nothing new and delegates worker execution to the operator's agent backend. MCP hosts compose the same outcome from cw_run_drive_step + cw_report. `audit-run` is a CLI-only alias of the same wrapper.
- `demo tamper` — Human-facing demonstration (operator/newcomer onboarding); the underlying integrity check is exposed programmatically as the both-surface telemetry.verify. No agent or MCP client needs to invoke a demo.
<!-- /gen:parity:cliOnly -->

<!-- gen:parity:projected -->
Five capabilities are payload-divergent on purpose (`projected`):

- `commit` — Both surfaces route through the single core entry runner.commit. The CLI emits the raw StateCommitResult for scripting (commit.id, commit.evidence, commit.gate, commit.acceptanceRationale); cw_commit emits the operator commit envelope (commitId, verifierGated, checkpoint, evidenceCount, snapshotPath, nextActions, plus the raw result under `commit`). Declared projection via capability-core.commitEnvelope, not drift.
- `backend.agent.config.set` — Mutating: persists $CW_HOME/agent-config.json (secret-stripped) before returning the effective config; both surfaces perform the same write — it is a surface-mutating verb, not a read probe.
- `run.drive.step` — Mutating: advances the run by spawning the external agent per worker and recording attested output — not a read probe. CLI (--drive/--step) and MCP route through the same drive() core.
- `gc.run` — Mutating: frees disk and appends a tombstone; both surfaces perform the identical transaction but the payload reports now-derived bytesFreed/tombstone.
- `workbench.serve` — Both surfaces route through the single core entry buildWorkbenchServeDescriptor and return the IDENTICAL serve descriptor under `cw workbench serve --json`/`--once` and `cw_workbench_serve`. They diverge only in side effect, not payload: the CLI's default `cw workbench serve` (no --once) additionally STARTS the blocking localhost host (like `schedule daemon`), which an MCP stdio host cannot do, so cw_workbench_serve only ever returns the descriptor. Declared divergence, not drift.
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

`test/cli-mcp-parity-smoke.js` proves the contract from end to end. It checks
registry ⇄ CLI ⇄ MCP coverage (every declared capability is found on its declared
surfaces and nothing live is undeclared), makes sure `--json` output is equal to
the MCP payload for every `payloadIdentical` capability, makes sure of the
declared `commit` projection, and makes sure of fail-closed behavior by putting in
drift — a peer taken away, an undeclared tool, an exception with no reason, a
changed payload — and checking that the gate says no to each one. It is part of
`npm test` and `npm run release:check`.

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
