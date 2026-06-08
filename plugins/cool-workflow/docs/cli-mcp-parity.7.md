# CLI ↔ MCP Parity

CW v0.1.27 adds CLI ↔ MCP Parity. CW has two front doors. The CLI
(`node scripts/cw.js ...`, `dist/cli.js`) serves human speed: terse, scannable
text with meaningful exit codes. The MCP server (`cw_*` JSON-RPC tools) serves
machine context: complete, stable, structured JSON. This release makes the two
doors two renderings of one data source — declared, derived, and enforced — so
the same capability cannot drift between surfaces.

The design follows a base-system discipline that separates mechanism from
policy:

- one source of truth: the capability registry, not two hand-maintained lists
- mechanism (shared core) is separate from policy (per-surface rendering)
- one source, two renderings; no undeclared divergence
- principle of least astonishment: matching names, flags, order, and defaults
  across surfaces
- the surfaces do not interfere: human formatting never leaks into machine
  output, machine completeness never bloats the default human view
- fail closed on drift; a surface mismatch is a release-blocking error
- stable interfaces, backward compatible; old names remain aliases or wrappers
- it is not done until it is documented and tested

## Mechanism vs Policy

The mechanism is the capability registry at `src/capability-registry.ts`
(compiled to `dist/capability-registry.js`). It is the single source of truth.
Every capability declares one shared core `entry` — the mechanism both surfaces
route through — plus its CLI command, its MCP tool, the surface it lives on, and
whether its payload is identical across surfaces.

No business logic is stranded in `cli.ts` or `mcp-server.ts`. Composite
capabilities live in `src/capability-core.ts` (`planSummary`, `appRun`,
`sandboxChoose`, `commitEnvelope`), so both surfaces call the same core entry
and differ only in how they render its result. The CLI renders for a human; the
MCP tool renders for a machine; neither owns the logic.

A new runtime capability is added once, in the registry, against one core entry.
The CLI command and the MCP tool are then two policies over that one mechanism —
which is exactly what the parity gate checks.

## Human vs Machine Contract

The two surfaces have different contracts and must not interfere:

- CLI = human speed. The default output is terse, scannable text with meaningful
  exit codes. The canonical payload is available on demand via `--json` or
  `--format json`. Human formatting is never emitted on the machine path.
- MCP = machine context. The result is always complete, stable, structured
  JSON. Machine completeness is never forced into the default human view.

A capability marked `payloadIdentical` returns the same canonical JSON from
`cw <cmd> --json` and from the `cw_<tool>` MCP result — whitespace and
generation-moment ISO timestamps aside. The `--json` payload is the contract,
and it is the same bytes the MCP tool returns. The human text view is policy
layered on top; it never changes the payload.

## The Parity Matrix

The matrix below is derived from the live registry — one row per capability,
showing its CLI command, MCP tool, shared core entry, surface, and payload
relationship. `identical` means `cw <cmd> --json` equals the `cw_<tool>`
payload; `projected` means a declared, reasoned divergence; `cli-only` marks a
surface-specific capability with a recorded reason. The matrix is
machine-complete by design: 132 capabilities, 129 MCP tools.

| Capability | CLI command | MCP tool | Core entry | Surface | Payload |
| --- | --- | --- | --- | --- | --- |
| `help` | `cw help` | `—` | `formatHelp` | cli-only | cli-only |
| `list` | `cw list` | `cw_list` | `listWorkflows` | both | identical |
| `init` | `cw init` | `cw_init` | `init` | both | identical |
| `plan` | `cw plan` | `cw_plan` | `planSummary` | both | identical |
| `status` | `cw status --json` | `cw_status` | `status` | both | identical |
| `next` | `cw next` | `cw_next` | `next` | both | identical |
| `dispatch` | `cw dispatch` | `cw_dispatch` | `dispatch` | both | identical |
| `result` | `cw result` | `cw_result` | `recordResult` | both | identical |
| `commit` | `cw commit` | `cw_commit` | `commit` | both | projected |
| `commit.summary` | `cw commit summary --json` | `cw_commit_summary` | `summarizeCommitRecords` | both | identical |
| `report` | `cw report --json` | `cw_report` | `report` | both | identical |
| `graph` | `cw graph --json` | `cw_operator_graph` | `operatorGraph` | both | identical |
| `loop` | `cw loop` | `—` | `scheduler.create` | cli-only | cli-only |
| `operator.status` | `cw operator status --json` | `cw_operator_status` | `operatorStatus` | both | identical |
| `operator.report` | `cw operator report --json` | `cw_operator_report` | `operatorReport` | both | identical |
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
| `node.graph` | `cw node graph --json` | `cw_node_graph` | `graphNodes` | both | identical |
| `topology.list` | `cw topology list` | `cw_topology_list` | `listTopologies` | both | identical |
| `topology.show` | `cw topology show` | `cw_topology_show` | `showTopology` | both | identical |
| `topology.validate` | `cw topology validate` | `cw_topology_validate` | `validateTopology` | both | identical |
| `topology.apply` | `cw topology apply` | `cw_topology_apply` | `applyTopology` | both | identical |
| `topology.summary` | `cw topology summary --json` | `cw_topology_summary` | `topologySummary` | both | identical |
| `topology.graph` | `cw topology graph --json` | `cw_topology_graph` | `topologyGraph` | both | identical |
| `summary.refresh` | `cw summary refresh --json` | `cw_summary_refresh` | `summaryRefresh` | both | identical |
| `summary.show` | `cw summary show --json` | `cw_summary_show` | `summaryShow` | both | identical |
| `multi-agent.run` | `cw multi-agent run` | `cw_multi_agent_run` | `hostMultiAgentRun` | both | identical |
| `multi-agent.status` | `cw multi-agent status --json` | `cw_multi_agent_status` | `hostMultiAgentStatus` | both | identical |
| `multi-agent.step` | `cw multi-agent step` | `cw_multi_agent_step` | `hostMultiAgentStep` | both | identical |
| `multi-agent.blackboard` | `cw multi-agent blackboard` | `cw_multi_agent_blackboard` | `hostMultiAgentBlackboard` | both | identical |
| `multi-agent.score` | `cw multi-agent score` | `cw_multi_agent_score` | `hostMultiAgentScore` | both | identical |
| `multi-agent.select` | `cw multi-agent select` | `cw_multi_agent_select` | `hostMultiAgentSelect` | both | identical |
| `multi-agent.summary` | `cw multi-agent summary --json` | `cw_multi_agent_summary` | `multiAgentSummary` | both | identical |
| `multi-agent.summarize` | `cw multi-agent summarize --json` | `cw_multi_agent_summarize` | `multiAgentSummarize` | both | identical |
| `multi-agent.graph` | `cw multi-agent graph --json` | `cw_multi_agent_graph` | `multiAgentOperatorGraph` | both | identical |
| `multi-agent.graph.compact` | `cw multi-agent graph --json` | `cw_multi_agent_graph_compact` | `multiAgentGraphView` | both | identical |
| `multi-agent.dependencies` | `cw multi-agent dependencies --json` | `cw_multi_agent_dependencies` | `multiAgentDependencies` | both | identical |
| `multi-agent.failures` | `cw multi-agent failures --json` | `cw_multi_agent_failures` | `multiAgentFailures` | both | identical |
| `multi-agent.evidence` | `cw multi-agent evidence --json` | `cw_multi_agent_evidence` | `multiAgentEvidence` | both | identical |
| `multi-agent.reasoning` | `cw multi-agent reasoning --json` | `cw_evidence_reasoning` | `multiAgentReasoning` | both | identical |
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
| `eval.snapshot` | `cw eval snapshot --json` | `cw_eval_snapshot` | `evalSnapshot` | both | identical |
| `eval.replay` | `cw eval replay --json` | `cw_eval_replay` | `evalReplay` | both | identical |
| `eval.compare` | `cw eval compare --json` | `cw_eval_compare` | `evalCompare` | both | identical |
| `eval.score` | `cw eval score --json` | `cw_eval_score` | `evalScore` | both | identical |
| `eval.gate` | `cw eval gate --json` | `cw_eval_gate` | `evalGate` | both | identical |
| `eval.report` | `cw eval report --json` | `cw_eval_report` | `evalReport` | both | identical |
| `blackboard.summary` | `cw blackboard summary` | `cw_blackboard_summary` | `blackboardSummary` | both | identical |
| `blackboard.summarize` | `cw blackboard summarize --json` | `cw_blackboard_summarize` | `blackboardSummarize` | both | identical |
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
| `audit.worker` | `cw audit worker` | `cw_audit_worker` | `workerAudit` | both | identical |
| `audit.provenance` | `cw audit provenance` | `cw_audit_provenance` | `evidenceProvenance` | both | identical |
| `audit.multi-agent` | `cw audit multi-agent --json` | `cw_audit_multi_agent` | `auditMultiAgent` | both | identical |
| `audit.policy` | `cw audit policy --json` | `cw_audit_policy` | `auditPolicy` | both | identical |
| `audit.role` | `cw audit role --json` | `cw_audit_role` | `auditRole` | both | identical |
| `audit.blackboard` | `cw audit blackboard --json` | `cw_audit_blackboard` | `auditBlackboard` | both | identical |
| `audit.judge` | `cw audit judge --json` | `cw_audit_judge` | `auditJudge` | both | identical |
| `audit.attest` | `cw audit attest` | `cw_audit_attest` | `recordAuditAttestation` | both | identical |
| `audit.decision` | `cw audit decision` | `cw_audit_decision` | `recordAuditDecision` | both | identical |
| `sandbox.list` | `cw sandbox list` | `cw_sandbox_list` | `listSandboxProfiles` | both | identical |
| `sandbox.show` | `cw sandbox show` | `cw_sandbox_show` | `showSandboxProfile` | both | identical |
| `sandbox.validate` | `cw sandbox validate` | `cw_sandbox_validate` | `validateSandboxProfile` | both | identical |
| `sandbox.choose` | `cw sandbox choose` | `cw_sandbox_choose` | `sandboxChoose` | both | identical |
| `sandbox.resolve` | `cw sandbox resolve` | `cw_sandbox_resolve` | `sandboxChoose` | both | identical |
| `worker.list` | `cw worker list` | `cw_worker_list` | `listWorkers` | both | identical |
| `worker.summary` | `cw worker summary --json` | `cw_worker_summary` | `summarizeWorkerRecords` | both | identical |
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
| `candidate.summary` | `cw candidate summary --json` | `cw_candidate_summary` | `summarizeCandidateOperatorRecords` | both | identical |
| `feedback.list` | `cw feedback list` | `cw_feedback_list` | `listFeedback` | both | identical |
| `feedback.show` | `cw feedback show` | `cw_feedback_show` | `showFeedback` | both | identical |
| `feedback.collect` | `cw feedback collect` | `cw_feedback_collect` | `collectFeedback` | both | identical |
| `feedback.summary` | `cw feedback summary --json` | `cw_feedback_summary` | `summarizeFeedbackRecords` | both | identical |
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

v0.1.27 closed the historical gaps. It added MCP peers `cw_init`, `cw_next`,
`cw_state_check`, `cw_contract_show`, `cw_node_list`, `cw_node_show`, and
`cw_node_graph`; and CLI peers `app run`, `operator status`, `operator report`,
`sandbox choose`, `sandbox resolve`, and `report --json`. Everything else is on
both surfaces.

## Surface-Specific Capabilities

A capability may live on one surface only, but never silently — it must carry a
recorded reason in the registry. Three capabilities are CLI-only:

- `help` — human help text. MCP hosts enumerate capabilities via `tools/list`,
  not a help command.
- `loop` — a convenience alias of `schedule create` with `kind=loop`. MCP hosts
  use `cw_schedule_create` with `kind=loop`.
- `schedule daemon` — a long-running desktop daemon process, not a
  request/response tool. MCP hosts drive ticks via `cw_schedule_due` and
  `cw_schedule_run_now`.

One capability is intentionally payload-divergent (`projected`):

- `commit` — both surfaces route through the single core entry `runner.commit`.
  The CLI emits the raw `StateCommitResult` for scripting (`commit.id`,
  `commit.evidence`, `commit.gate`, `commit.acceptanceRationale`); `cw_commit`
  emits the operator commit envelope (`commitId`, `verifierGated`, `checkpoint`,
  `evidenceCount`, `snapshotPath`, `nextActions`, plus the raw result under
  `commit`). This is a declared projection via `capability-core.commitEnvelope`,
  not drift.

## Fail-Closed Rules

The parity gate fails closed. Any of the following is a release-blocking error:

- a capability present on one surface but missing from the other
- an MCP tool that is live but not declared in the registry
- a CLI command or token that is live but not declared in the registry
- a surface-specific or payload-divergent capability with no recorded `reason`
- a payload divergence on a capability marked `payloadIdentical` — that is,
  `cw <cmd> --json` and `cw_<tool>` returning different canonical JSON

There is no "fix it later" path. A surface mismatch blocks the release until the
registry, the surfaces, and the recorded reasons agree.

## Enforcement & Smoke Coverage

Parity is checked by `scripts/parity-check.js --check`, run by
`npm run parity:check` and wired into `npm run release:check`. The check loads
the registry, enumerates the live CLI commands and MCP tools, and fails closed on
any of the rules above.

`test/cli-mcp-parity-smoke.js` proves the contract end to end. It verifies
registry ⇄ CLI ⇄ MCP coverage (every declared capability resolves on its
declared surfaces and nothing live is undeclared), confirms `--json` output
equals the MCP payload for every `payloadIdentical` capability, confirms the
declared `commit` projection, and confirms fail-closed behavior by injecting
drift — a removed peer, an undeclared tool, a reasonless exception, a mutated
payload — and asserting the gate rejects each one. It is included in `npm test`
and `npm run release:check`.

In CW, parity is not a convention; it is a derived, declared, and enforced
property of the build. It is not done until it is documented and tested.

## Run Registry / Control Plane (v0.1.28)

v0.1.28 adds 13 control-plane capabilities — `registry refresh|show`, `run
search|list|show|resume|archive|rerun`, `queue add|list|drain|show`, and
`history` — declared once in the capability registry and validated by the same
fail-closed parity gate, so each `cw <cmd> --json` is schema-identical to its
`cw_<tool>`. See [run-registry-control-plane.7.md](run-registry-control-plane.7.md).

## Execution Backends (v0.1.29)

v0.1.29 lifts execution into a pluggable driver layer: one narrow `ExecutionBackend`
contract with interchangeable `node`/`bun`/`shell`/`container`/`remote`/`ci`
drivers, selected by `--backend` (parallel to `--sandbox`) and inspected via
`backend list|show|probe`. The result/evidence envelope is schema-identical across
backends; the backend id + sandbox attestation are recorded as provenance, so this
surface is unchanged regardless of which backend executed a run. See
[execution-backends.7.md](execution-backends.7.md).
