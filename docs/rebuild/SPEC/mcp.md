# mcp

## Scope

This covers the MCP stdio JSON-RPC server, its 196 tools, the one CLI<->MCP capability registry with its fail-closed parity gate, and the making of every vendor plugin manifest from one source file. Files: `src/mcp-server.ts`, `src/mcp-surface.ts`, `src/mcp/tool-definitions.ts`, `src/mcp/tool-call.ts`, `src/capability-registry.ts`, `scripts/mcp-server.js`, `scripts/parity-check.js`, `scripts/gen-manifests.js`, `scripts/gen-parity-doc.js`, `server.json`, `.mcp.json`, `manifest/`.

## Public surface

### The server process

- `scripts/mcp-server.js` — 4-line shim: `require("../dist/mcp-server.js")` (scripts/mcp-server.js:4).
- `dist/mcp-server.js` — the built server. MCP clients start it with `node`. The generated `.mcp.json` names it as `${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js` (.mcp.json:6).
- Transport: stdin/stdout, one JSON object per line ("\n" at the end). There are no `Content-Length` headers. stdin is set to `utf8` (src/mcp-server.ts:15). The server is long-lived; it never stops itself.

### JSON-RPC methods (src/mcp-server.ts:53-77)

| Method | Takes | Gives back |
| --- | --- | --- |
| `initialize` | anything (params not read) | `{ protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "cool-workflow", version: CURRENT_COOL_WORKFLOW_VERSION } }` |
| `tools/list` | anything (params not read) | `{ tools: [ ...196 tool definitions... ] }` |
| `tools/call` | `params.name` (string, must be present), `params.arguments` (object; null/absent becomes `{}`) | `{ content: [ { type: "text", text: JSON.stringify(coreResult, null, 2) } ] }` |
| any other method | — | error `-32601` if the request has an `id` key; nothing at all if it does not |

### Exported functions

- `callTool(name, args)` (src/mcp/tool-call.ts:76) — one explicit `switch` over all 196 tool names. Resolves `cwd`, re-bases the runner, then calls the one shared core entry for the capability. Gives back the core's plain JS value. Throws `Unknown tool: <name>` for a name not in the switch (src/mcp/tool-call.ts:513).
- `toolDefinitions()` (src/mcp/tool-definitions.ts:3) — the full public `tools/list` array, built by `capabilityTool(capabilityId, description?, properties)` which calls `mcpToolDefinition` from the registry. Throws if a capability id is not declared in the registry (src/capability-registry.ts:842) or has no properties argument (src/capability-registry.ts:845).
- `requiredToolArguments(name, value)` (src/mcp-surface.ts:7) — checks the required-argument groups declared as data on the registry's `McpBinding.requiredArgs`. `undefined`/`null` value becomes `{}`. A non-object value throws. A group `"keyA|keyB"` passes when at least one named key is not `undefined`, not `null`, and not `""`.
- Registry exports (src/capability-registry.ts): `CAPABILITY_REGISTRY` (209 descriptors, deduped by capability id, last one wins, src/capability-registry.ts:592), `declaredMcpTools()` (196 names, :813), `mcpCapabilityForTool(tool)` (:818), `mcpCapabilityForId(id)` (:823), `mcpRequiredArgsForTool(tool)` (:829), `mcpToolDefinition(...)` (:836), `declaredCliTokens()` (:858), `declaredCliHelpTokens()` (:870), `requiresReason(cap)` (:885), `isPayloadProbeOptOut(cap)` (:903), `payloadIdenticalCapabilities()` (:912), `payloadProbeTargets()` (:918), `deferredPayloadProbeCapabilities()` (:926), `buildPayloadProbePlan(...)` (:932), `payloadProbePlan()` (:947), `buildParityReport({mcpTools, cliTokens, helpTokens})` (:980).

### Types on the registry (src/capability-registry.ts:26-121)

- `ParitySurface` = `"both" | "cli-only" | "mcp-only"`.
- `CliJsonMode` = `"default" | "flag" | "human"`.
- `CapabilityDescriptor` = `{ capability, summary, entry, surface, cli?, mcp?, payloadIdentical?, reason? }`.
- `McpBinding` = `{ tool, requiredArgs? }` — required-argument groups as `"keyA|keyB"` strings.
- `McpToolDefinition` = `{ name, description, inputSchema: { type: "object", properties, additionalProperties: true } }`.
- Registry facts (from the built registry): 209 capabilities, 196 MCP tools, 13 `cli-only`, 0 `mcp-only`.

### Scripts / commands

- `node scripts/parity-check.js` — print the parity report as JSON. `--check` makes any drift exit 1 (release-blocking). npm alias: `npm run parity:check` (package.json:61). Runs inside `npm run release:check`.
- `node scripts/gen-manifests.js` — write every vendor manifest from `manifest/plugin.manifest.json`. `--check` exits 1 on any drift. npm alias: `npm run gen:manifests` (package.json:58).
- `node scripts/gen-parity-doc.js` — re-make four marker regions in `docs/cli-mcp-parity.7.md` from the registry: `<!-- gen:parity:count -->`, `<!-- gen:parity:table -->`, `<!-- gen:parity:cliOnly -->`, `<!-- gen:parity:projected -->`. `--check` fails closed on drift. npm alias: `npm run gen:parity` (package.json:59).
- `npm run manifest:load-check` — boots every generated vendor `mcp.json` and does an `initialize` + `tools/list` round trip (package.json:60, test/vendor-manifest-load-smoke.js).

### Env vars

- `CLAUDE_PLUGIN_ROOT` — not read by the server code itself; it is the path variable inside the generated Claude `.mcp.json` args (.mcp.json:6). Other vendors use `./` in its place (manifest/plugin.manifest.json:56,62,67,72,77).
- `CW_AGENT_ATTEST_PUBKEY` — named in tool descriptions as the default trust key for `cw_run_export`, `cw_report_bundle`, `cw_telemetry_verify` (src/mcp/tool-definitions.ts:842,886; src/capability-registry.ts:537). The key handling itself lives in the core, not in this layer.

### All 196 MCP tools

Every input schema is `{ type: "object", properties: <below>, additionalProperties: true }`. Each property value is one of: `{ type: "string", description }`, `{ type: "number", description }`, `{ type: "boolean", description }`, `{ type: "object", description, additionalProperties: true }`, or `{ type: "array", description, items: {} }` (src/mcp/tool-definitions.ts:1035-1053). Two hand-written property values differ: `cw_commit.allowUnverifiedCheckpoint` is a plain `{ type: "boolean", description: "Write a non-gated checkpoint instead of committed state" }` (src/mcp/tool-definitions.ts:507) and `cw_routine_fire.payload` is `{ type: "object", description: "Event payload" }` with NO `additionalProperties` key (src/mcp/tool-definitions.ts:760).

"Required" below lists the declared required-argument groups; a group `a|b` means at least one of those keys. Every tool's result is the JSON of its one shared core entry; when the payload is marked `identical` in the registry, the bytes equal `cw <cmd> --json` (whitespace and generation-moment ISO timestamps aside).

| Tool | Capability | Required | Input properties | What it does |
| --- | --- | --- | --- | --- |
| `cw_list` | `list` | (none) | (none) | List bundled CW workflows. |
| `cw_plan` | `plan` | `workflowId` | `workflowId` `repo` `question` | Create a CW run and return its canonical plan summary. |
| `cw_app_run` | `app.run` | `appId` | `cwd` `appId` `inputs` `sandbox` `sandboxProfile` `sandboxProfileId` | Create a run from an app id + structured inputs. |
| `cw_status` | `status` | `runId` | `runId` `cwd` | Read run checkpoint status. |
| `cw_init` | `init` | `workflowId` | `workflowId` `title` `output` | Scaffold a new workflow definition. |
| `cw_next` | `next` | `runId` | `runId` `cwd` `limit` | Read the next recommended tasks for a run. |
| `cw_state_check` | `state.check` | `runId` | `runId` `cwd` `state` `write` | Check run-state schema compatibility. |
| `cw_contract_show` | `contract.show` | `runId` | `runId` `cwd` `contractId` | Show a run's pipeline contract. |
| `cw_node_list` | `node.list` | `runId` | `runId` `cwd` | List state nodes for a run. |
| `cw_node_show` | `node.show` | `runId, nodeId` | `runId` `cwd` `nodeId` | Show one state node for a run. |
| `cw_node_graph` | `node.graph` | `runId` | `runId` `cwd` | Read the state-node graph for a run. |
| `cw_node_snapshot` | `node.snapshot` | (none) | `runId` `cwd` `nodeId` | Snapshot one state node (derived + fingerprinted). |
| `cw_node_diff` | `node.diff` | (none) | `runId` `cwd` `baselineSnapshotId` `candidateSnapshotId` | Structurally diff two node snapshots. |
| `cw_node_replay` | `node.replay` | (none) | `runId` `cwd` `snapshotId` | Deterministically replay one node from a snapshot. |
| `cw_node_replay_verify` | `node.replay.verify` | (none) | `runId` `cwd` `replayId` | Verify a node replay against its source. |
| `cw_migration_list` | `migration.list` | (none) | (none) | List the declared migration registry. |
| `cw_migration_check` | `migration.check` | (none) | `target` `contract` `cwd` | Dry-run migration verdict for a target. |
| `cw_migration_prove` | `migration.prove` | (none) | `target` `contract` `cwd` | Round-trip / non-destruction migration proof for a target. |
| `cw_operator_status` | `operator.status` | `runId` | `runId` `cwd` | Read the structured Operator UX run status. |
| `cw_operator_graph` | `graph` | `runId` | `runId` `cwd` | Read the structured Operator UX run graph. |
| `cw_operator_report` | `operator.report` | `runId` | `runId` `cwd` | Refresh and read the structured Operator UX report summary. |
| `cw_worker_summary` | `worker.summary` | `runId` | `runId` `cwd` | Read the structured worker summary for a run. |
| `cw_workbench_view` | `workbench.view` | `runId` | `runId` `cwd` | Read the read-only five-panel Workbench view of one run (graph, blackboard, worker, candidate, audit). |
| `cw_workbench_serve` | `workbench.serve` | (none) | `cwd` `port` `scope` | Describe/serve the optional localhost-only, read-only Workbench host. |
| `cw_candidate_summary` | `candidate.summary` | `runId` | `runId` `cwd` | Read the structured candidate summary for a run. |
| `cw_feedback_summary` | `feedback.summary` | `runId` | `runId` `cwd` | Read the structured feedback summary for a run. |
| `cw_commit_summary` | `commit.summary` | `runId` | `runId` `cwd` | Read the structured commit summary for a run. |
| `cw_multi_agent_summary` | `multi-agent.summary` | `runId` | `runId` `cwd` | Read the structured multi-agent runtime summary for a run. |
| `cw_multi_agent_graph` | `multi-agent.graph` | `runId` | `runId` `cwd` | Read the structured multi-agent operator graph for a run. |
| `cw_multi_agent_dependencies` | `multi-agent.dependencies` | `runId` | `runId` `cwd` | Read derived multi-agent dependency edges for operator inspection. |
| `cw_multi_agent_failures` | `multi-agent.failures` | `runId` | `runId` `cwd` | Read failed, blocked, rejected, and ambiguous multi-agent records. |
| `cw_multi_agent_evidence` | `multi-agent.evidence` | `runId` | `runId` `cwd` | Read evidence adoption status from worker output through selection and commit. Each row carries a derived rationaleStatus (explained\|unexplained\|not-applicable). |
| `cw_evidence_reasoning` | `multi-agent.reasoning` | `runId` | `runId` `cwd` `evidence` `refresh` | Explain why each evidence item was adopted/rejected. |
| `cw_evidence_reasoning_refresh` | `multi-agent.reasoning.refresh` | `runId` | `runId` `cwd` | Refresh the durable evidence-reasoning index. |
| `cw_summary_refresh` | `summary.refresh` | `runId` | `runId` `cwd` `view` | Refresh state-explosion summaries. |
| `cw_summary_show` | `summary.show` | `runId` | `runId` `cwd` | Read the persisted state-explosion report. |
| `cw_blackboard_summarize` | `blackboard.summarize` | `runId` | `runId` `cwd` `blackboardId` | Read a blackboard digest with conflicts/evidence. |
| `cw_multi_agent_summarize` | `multi-agent.summarize` | `runId` | `runId` `cwd` | Read the combined state-explosion report. |
| `cw_multi_agent_graph_compact` | `multi-agent.graph.compact` | `runId` | `runId` `cwd` `view` `focus` `depth` | Read a compact/focused multi-agent graph view. |
| `cw_multi_agent_run` | `multi-agent.run` | (none) | `runId` `cwd` `app` `appId` `workflow` `workflowId` `topology` `topologyId` `task` `mapperCount` `judgeCount` `debateRounds` | Create or attach a topology-backed multi-agent run. |
| `cw_multi_agent_status` | `multi-agent.status` | `runId` | `runId` `cwd` | Read combined topology/blackboard/worker status. |
| `cw_multi_agent_step` | `multi-agent.step` | `runId` | `runId` `cwd` `sandbox` `backend` `limit` | Perform one safe deterministic host step. |
| `cw_multi_agent_blackboard` | `multi-agent.blackboard` | `runId` | `runId` `cwd` `action` `blackboardId` `topicId` `body` `kind` `path` `evidence` | Operate on the active multi-agent blackboard. |
| `cw_multi_agent_score` | `multi-agent.score` | `runId` | `runId` `cwd` `candidate` `candidateId` `worker` `criterion` `criteria` `evidence` `maxTotal` | Score a candidate with evidence. |
| `cw_multi_agent_select` | `multi-agent.select` | `runId` | `runId` `cwd` `candidate` `candidateId` `score` `scoreId` `reason` `allowUnverified` | Select a candidate with the verifier gate. |
| `cw_eval_snapshot` | `eval.snapshot` | `runId` | `runId` `cwd` `id` | Create a deterministic replay snapshot. |
| `cw_eval_replay` | `eval.replay` | `snapshot|snapshotId|path` | `cwd` `snapshot` `snapshotId` `path` `id` | Replay a snapshot without live agents. |
| `cw_eval_compare` | `eval.compare` | `baseline|baselinePath, replay|replayPath` | `cwd` `baseline` `baselinePath` `replay` `replayPath` | Compare baseline and replay deterministically. |
| `cw_eval_score` | `eval.score` | `replay|replayPath|path` | `cwd` `replay` `replayPath` `path` | Score replay quality. |
| `cw_eval_gate` | `eval.gate` | `suite|suiteId|path` | `cwd` `suite` `suiteId` `path` | Run the eval/replay regression gate. |
| `cw_eval_report` | `eval.report` | `replay|replayPath|path` | `cwd` `replay` `replayPath` `path` | Render an eval/replay report. |
| `cw_multi_agent_run_create` | `multi-agent.run.create` | `runId` | `runId` `cwd` `id` `title` `objective` | Create a MultiAgentRun state record. |
| `cw_multi_agent_run_transition` | `multi-agent.run.transition` | `runId` | `runId` `cwd` `multiAgentRunId` `id` `status` `reason` | Transition a MultiAgentRun lifecycle. |
| `cw_multi_agent_run_show` | `multi-agent.run.show` | `runId` | `runId` `cwd` `multiAgentRunId` `id` | Show one MultiAgentRun record. |
| `cw_multi_agent_role_create` | `multi-agent.role.create` | `runId` | `runId` `cwd` `id` `multiAgentRunId` `multiAgentRun` `title` `responsibility` `requiredEvidence` `sandboxProfileHint` `expectedArtifact` `faninObligation` | Create an AgentRole record. |
| `cw_multi_agent_role_show` | `multi-agent.role.show` | `runId, roleId` | `runId` `cwd` `roleId` `id` | Show one AgentRole record. |
| `cw_multi_agent_group_create` | `multi-agent.group.create` | `runId` | `runId` `cwd` `id` `multiAgentRunId` `multiAgentRun` `title` `phase` `task` | Create an AgentGroup record. |
| `cw_multi_agent_group_show` | `multi-agent.group.show` | `runId, groupId` | `runId` `cwd` `groupId` `id` | Show one AgentGroup record. |
| `cw_multi_agent_membership_create` | `multi-agent.membership.create` | `runId` | `runId` `cwd` `id` `groupId` `roleId` `taskId` `workerId` `dispatchId` `fanoutId` | Create an AgentMembership record. |
| `cw_multi_agent_membership_show` | `multi-agent.membership.show` | `runId, membershipId` | `runId` `cwd` `membershipId` `id` | Show one AgentMembership record. |
| `cw_multi_agent_fanout_create` | `multi-agent.fanout.create` | `runId` | `runId` `cwd` `id` `groupId` `reason` `role` `task` `limit` `sandboxChoice` | Create an AgentFanout record. |
| `cw_multi_agent_fanout_show` | `multi-agent.fanout.show` | `runId, fanoutId` | `runId` `cwd` `fanoutId` `id` | Show one AgentFanout record. |
| `cw_multi_agent_fanin_collect` | `multi-agent.fanin.collect` | `runId` | `runId` `cwd` `id` `groupId` `fanoutId` `requiredRole` `strategy` | Collect an AgentFanin with evidence coverage. |
| `cw_multi_agent_fanin_show` | `multi-agent.fanin.show` | `runId, faninId` | `runId` `cwd` `faninId` `id` | Show one AgentFanin record. |
| `cw_topology_list` | `topology.list` | (none) | (none) | List official topology definitions. |
| `cw_topology_show` | `topology.show` | `topologyId|id` | `runId` `cwd` `topologyId` `topologyRunId` `id` | Show a topology definition or run. |
| `cw_topology_validate` | `topology.validate` | `topologyId|id` | `topologyId` `id` | Validate a topology definition. |
| `cw_topology_apply` | `topology.apply` | `runId, topologyId|id` | `runId` `cwd` `topologyId` `id` `task` `mapperCount` `judgeCount` `debateRounds` `blackboardId` `multiAgentRunId` `collectInitialFanin` | Apply a topology to a run. |
| `cw_topology_summary` | `topology.summary` | `runId` | `runId` `cwd` | Read topology progress and next actions. |
| `cw_topology_graph` | `topology.graph` | `runId` | `runId` `cwd` | Read topology graph nodes and edges. |
| `cw_blackboard_summary` | `blackboard.summary` | `runId` | `runId` `cwd` | Read the blackboard/coordinator summary. |
| `cw_blackboard_graph` | `blackboard.graph` | `runId` | `runId` `cwd` | Read blackboard graph nodes and edges. |
| `cw_blackboard_resolve` | `blackboard.resolve` | `runId` | `runId` `cwd` `id` `title` `multiAgentRunId` `groupId` `roleId` `membershipId` | Create or resolve a run blackboard. |
| `cw_blackboard_topic_create` | `blackboard.topic.create` | `runId` | `runId` `cwd` `id` `title` `description` `blackboardId` `tag` | Create a blackboard topic. |
| `cw_blackboard_message_post` | `blackboard.message.post` | `runId` | `runId` `cwd` `id` `topic` `topicId` `body` `replyTo` `visibility` `evidence` `artifact` | Post a blackboard message. |
| `cw_blackboard_message_list` | `blackboard.message.list` | `runId` | `runId` `cwd` `topic` `topicId` `blackboardId` | List blackboard messages. |
| `cw_blackboard_context_put` | `blackboard.context.put` | `runId` | `runId` `cwd` `id` `topic` `topicId` `kind` `key` `value` `supersedes` `evidence` `artifact` | Publish a shared context frame. |
| `cw_blackboard_artifact_add` | `blackboard.artifact.add` | `runId` | `runId` `cwd` `id` `topic` `kind` `path` `locator` `source` `evidence` | Index an artifact in the blackboard. |
| `cw_blackboard_artifact_list` | `blackboard.artifact.list` | `runId` | `runId` `cwd` `topic` `blackboardId` | List blackboard artifact refs. |
| `cw_blackboard_snapshot` | `blackboard.snapshot` | `runId` | `runId` `cwd` `blackboardId` | Create a durable blackboard snapshot. |
| `cw_coordinator_summary` | `coordinator.summary` | `runId` | `runId` `cwd` | Read the coordinator summary. |
| `cw_coordinator_decision` | `coordinator.decision` | `runId` | `runId` `cwd` `id` `kind` `outcome` `reason` `subject` `evidence` `artifact` `message` | Record a coordinator decision. |
| `cw_audit_summary` | `audit.summary` | `runId` | `runId` `cwd` | Read the trust/audit summary. |
| `cw_audit_verify` | `audit.verify` | `runId` | `runId` `cwd` | Re-prove a run's trust-audit hash chain (fail-closed exit). |
| `cw_audit_worker` | `audit.worker` | `runId` | `runId` `cwd` `workerId` | Read trust/audit for one worker. |
| `cw_audit_provenance` | `audit.provenance` | `runId` | `runId` `cwd` `workerId` `worker` `candidateId` `candidate` `commitId` `commit` | Inspect evidence provenance. |
| `cw_audit_multi_agent` | `audit.multi-agent` | `runId` | `runId` `cwd` | Read the multi-agent trust/policy/provenance audit. |
| `cw_audit_policy` | `audit.policy` | `runId` | `runId` `cwd` | Read role policies and permission decisions. |
| `cw_audit_role` | `audit.role` | `runId` | `runId` `cwd` `roleId` `id` | Read policy/audit for one role. |
| `cw_audit_blackboard` | `audit.blackboard` | `runId` | `runId` `cwd` | Read the blackboard write audit. |
| `cw_audit_judge` | `audit.judge` | `runId` | `runId` `cwd` | Read judge rationale/panel decision audit. |
| `cw_audit_attest` | `audit.attest` | `runId` | `runId` `cwd` `workerId` `worker` `actor` `hostEnforced` `env` `note` | Record a host/operator sandbox attestation. |
| `cw_audit_decision` | `audit.decision` | `runId` | `runId` `cwd` `workerId` `path` `command` `network` `env` `kind` | Validate and record a sandbox decision. |
| `cw_dispatch` | `dispatch` | `runId` | `runId` `cwd` `limit` `sandbox` `sandboxProfile` `sandboxProfileId` `backend` `backendId` | Create a subagent dispatch manifest. |
| `cw_sandbox_list` | `sandbox.list` | (none) | `cwd` | List bundled sandbox profiles. |
| `cw_sandbox_show` | `sandbox.show` | `profileId` | `cwd` `profileId` | Show a resolved sandbox profile. |
| `cw_sandbox_validate` | `sandbox.validate` | `profileFile` | `cwd` `profileFile` | Validate a sandbox profile JSON file. |
| `cw_sandbox_choose` | `sandbox.choose` | (none) | `cwd` `profileId` `sandbox` `sandboxProfile` `sandboxProfileId` | Resolve and validate a sandbox profile choice. |
| `cw_sandbox_resolve` | `sandbox.resolve` | (none) | `cwd` `profileId` `sandbox` `sandboxProfile` `sandboxProfileId` | Alias of sandbox.choose. |
| `cw_backend_list` | `backend.list` | (none) | `cwd` | List available execution backends and their capabilities. |
| `cw_backend_show` | `backend.show` | (none) | `cwd` `backendId` | Show one execution backend descriptor. |
| `cw_backend_probe` | `backend.probe` | (none) | `cwd` `backendId` | Probe execution backend readiness (live, deterministic). |
| `cw_backend_agent_config_show` | `backend.agent.config.show` | (none) | `cwd` `agentCommand` `agentEndpoint` `agentModel` | Show the effective agent delegation config (flags>env>file, secret-stripped, host-stable). |
| `cw_backend_agent_config_set` | `backend.agent.config.set` | (none) | `cwd` `agentCommand` `agentEndpoint` `agentModel` | Set the durable agent delegation config (command-template/endpoint/model; API keys never written). |
| `cw_result` | `result` | `runId` | `runId` `taskId` `resultPath` `cwd` | Record a subagent result file against a task. |
| `cw_commit` | `commit` | `runId` | `runId` `reason` `verifier` `verifierNode` `candidate` `selection` `allowUnverifiedCheckpoint` `cwd` | Create a verifier-gated commit or checkpoint. |
| `cw_report` | `report` | `runId` | `runId` `cwd` | Render a run report and return its canonical descriptor. |
| `cw_app_list` | `app.list` | (none) | `cwd` | List CW workflow apps. |
| `cw_app_show` | `app.show` | (none) | `cwd` `appId` | Show a CW workflow app contract. |
| `cw_app_validate` | `app.validate` | (none) | `cwd` `target` | Validate an app by path or id. |
| `cw_app_init` | `app.init` | (none) | `cwd` `appId` `title` `directory` | Create a CW workflow app directory. |
| `cw_app_package` | `app.package` | (none) | `cwd` `appId` `output` | Package an app as a JSON artifact. |
| `cw_worker_list` | `worker.list` | `runId` | `runId` `cwd` `status` | List worker isolation scopes. |
| `cw_worker_show` | `worker.show` | `runId, workerId` | `runId` `cwd` `workerId` | Show one worker isolation scope. |
| `cw_worker_manifest` | `worker.manifest` | `runId` | `runId` `cwd` `workerId` | Write and return a worker manifest. |
| `cw_worker_output` | `worker.output` | `runId` | `runId` `cwd` `workerId` `resultPath` | Record worker output. |
| `cw_worker_fail` | `worker.fail` | `runId` | `runId` `cwd` `workerId` `message` `code` `path` `retryable` | Record a structured worker failure. |
| `cw_worker_validate` | `worker.validate` | `runId` | `runId` `cwd` `workerId` `path` `resultPath` | Validate a worker output boundary. |
| `cw_candidate_list` | `candidate.list` | `runId` | `runId` `cwd` `status` `kind` | List candidates for a run. |
| `cw_candidate_show` | `candidate.show` | `runId, candidateId` | `runId` `cwd` `candidateId` | Show one candidate. |
| `cw_candidate_register` | `candidate.register` | `runId` | `runId` `cwd` `id` `kind` `worker` `task` `resultNode` `verifierNode` `resultPath` | Register a candidate from evidence. |
| `cw_candidate_score` | `candidate.score` | `runId` | `runId` `cwd` `candidateId` `criteria` `criterion` `evidence` `maxTotal` `max` `verdict` `notes` `scorer` | Score a candidate with criteria/evidence. |
| `cw_candidate_rank` | `candidate.rank` | `runId` | `runId` `cwd` `includeRejected` `minNormalized` `requireEvidence` `requireVerifierGate` `tieBreaker` | Rank candidates with gates. |
| `cw_candidate_select` | `candidate.select` | `runId` | `runId` `cwd` `candidateId` `reason` `selectedBy` `by` `score` `allowUnverified` `minNormalized` `requireVerifierGate` | Select a candidate with the verifier gate. |
| `cw_candidate_reject` | `candidate.reject` | `runId` | `runId` `cwd` `candidateId` `reason` | Reject a candidate with a reason. |
| `cw_approve` | `approve` | `runId, targetKind|kind, targetId|target` | `runId` `cwd` `targetKind` `targetId` `actor` `actorKind` `role` `displayName` `attested` `attestation` `rationale` `supersedes` | Append a host-attested approval of a candidate/commit/selection. |
| `cw_reject` | `reject` | `runId, targetKind|kind, targetId|target` | `runId` `cwd` `targetKind` `targetId` `actor` `actorKind` `role` `displayName` `attested` `attestation` `rationale` | Append a host-attested rejection (blocking veto) of a candidate/commit/selection. |
| `cw_comment_add` | `comment.add` | `runId, targetKind|kind, targetId|target, body|message|text` | `runId` `cwd` `targetKind` `targetId` `actor` `actorKind` `role` `displayName` `attested` `attestation` `body` `thread` `parent` | Append a comment to a durable target. |
| `cw_comment_list` | `comment.list` | `runId` | `runId` `cwd` `targetKind` `target` | List append-only comments for a run (optionally one target). |
| `cw_handoff` | `handoff` | `runId, targetKind|kind, targetId|target, to|toActor` | `runId` `cwd` `targetKind` `targetId` `actor` `actorKind` `role` `displayName` `attested` `attestation` `to` `toRole` `from` `reason` | Record an ownership transfer (from-actor → to-actor) of a run/task. |
| `cw_ledger_propose` | `ledger.propose` | `from, to, title, rationale` | `from` `to` `title` `rationale` `files` `diff` | Build a verifiable cross-agent change proposal entry (printed as JSON). |
| `cw_ledger_review` | `ledger.review` | `from, to, target, verdict` | `from` `to` `target` `verdict` `findings` | Build a verifiable cross-agent review verdict entry (printed as JSON). |
| `cw_ledger_verify` | `ledger.verify` | `entry` | `entry` | Verify a ledger entry against its content digest (fail-closed on tampering). |
| `cw_ledger_apply` | `ledger.apply` | `entry` | `entry` | Verify a proposal entry and return its suggestedDiff for `git apply` (fail-closed: no diff unless the entry verifies as a proposal). |
| `cw_ledger_list` | `ledger.list` | `dir|dirs` | `dir` `dirs` | Read + verify every entry in one or more shared ledger directories (fail-closed inbox; 2+ dirs union-verify mirrors). |
| `cw_review_status` | `review.status` | `runId` | `runId` `cwd` `targetKind` `target` `now` | Read the derived per-target review state + collaboration timeline for a run. |
| `cw_review_policy` | `review.policy` | `runId` | `runId` `cwd` `requiredApprovals` `authorizedRoles` `allowSelfApproval` `requireAttestedActor` `appliesTo` | Set the run's review-gate policy (required approvals, authorized roles, self-approval rule). |
| `cw_feedback_list` | `feedback.list` | `runId` | `runId` `cwd` `status` | List run feedback records. |
| `cw_feedback_show` | `feedback.show` | `runId, feedbackId` | `runId` `feedbackId` `cwd` | Show a run feedback record. |
| `cw_feedback_collect` | `feedback.collect` | `runId` | `runId` `cwd` | Collect feedback from failed nodes. |
| `cw_feedback_task` | `feedback.task` | `runId` | `runId` `feedbackId` `cwd` `verify` | Create a correction task for feedback. |
| `cw_feedback_resolve` | `feedback.resolve` | `runId` | `runId` `feedbackId` `cwd` `node` `status` | Resolve or reject feedback. |
| `cw_schedule_create` | `schedule.create` | (none) | `cwd` `kind` `prompt` `intervalMinutes` `cron` `delayMinutes` | Create a scheduled CW task. |
| `cw_schedule_list` | `schedule.list` | (none) | `cwd` `status` | List scheduled CW tasks. |
| `cw_schedule_due` | `schedule.due` | (none) | `cwd` | List due scheduled CW tasks. |
| `cw_schedule_complete` | `schedule.complete` | `id` | `cwd` `id` | Mark a scheduled task complete. |
| `cw_schedule_pause` | `schedule.pause` | `id` | `cwd` `id` | Pause a scheduled CW task. |
| `cw_schedule_resume` | `schedule.resume` | `id` | `cwd` `id` | Resume a scheduled CW task. |
| `cw_schedule_run_now` | `schedule.run-now` | `id` | `cwd` `id` | Create an immediate scheduled-task run record. |
| `cw_schedule_history` | `schedule.history` | (none) | `cwd` `id` | List scheduled-task run history. |
| `cw_schedule_delete` | `schedule.delete` | `id` | `cwd` `id` | Delete a scheduled CW task. |
| `cw_routine_create` | `routine.create` | (none) | `cwd` `kind` `prompt` `match` | Create a routine-style API/GitHub trigger. |
| `cw_routine_list` | `routine.list` | (none) | `cwd` `kind` | List routine-style triggers. |
| `cw_routine_fire` | `routine.fire` | `kind` | `cwd` `kind` `payload` | Record an API/GitHub trigger event. |
| `cw_routine_events` | `routine.events` | (none) | `cwd` `id` | List routine trigger events. |
| `cw_routine_delete` | `routine.delete` | `id` | `cwd` `id` | Delete a routine-style trigger. |
| `cw_registry_refresh` | `registry.refresh` | (none) | `cwd` `scope` | Recompute and persist the derived run registry index. |
| `cw_registry_show` | `registry.show` | (none) | `cwd` `scope` | Read the run registry index with valid\|stale\|absent freshness. |
| `cw_metrics_show` | `metrics.show` | `runId` | `runId` `cwd` `pricing` `now` | Read the derived per-run observability + attested-cost report (durations, failure/verifier/acceptance rates with sample counts, attested usage, cost, coverage). |
| `cw_metrics_summary` | `metrics.summary` | (none) | `cwd` `scope` `pricing` `now` | Read the cross-repo observability + cost rollup over the v0.1.28 run registry, with per-app and per-backend breakdowns. |
| `cw_run_search` | `run.search` | (none) | `cwd` `scope` `text` `app` `status` `repo` `since` `until` `includeArchived` `limit` `offset` | Search runs by app/status/time/repo/free-text, deterministic + paginated. |
| `cw_run_list` | `run.list` | (none) | `cwd` `scope` `includeArchived` `limit` `offset` | List indexed runs across repos (search with no filters). |
| `cw_run_show` | `run.show` | `runId` | `runId` `cwd` `scope` | Resolve one run by id across the registry; fail closed on missing source. |
| `cw_run_resume` | `run.resume` | `runId` | `runId` `cwd` `scope` `limit` | Resolve a run by id and return its next runnable tasks/actions (read-only by default; the opt-in --drive/--once mode hands it to the shared agent-drive core, which mutates and is covered by run.drive.step). |
| `cw_run_archive` | `run.archive` | `runId|olderThanDays` | `runId` `cwd` `scope` `reason` `unarchive` `olderThanDays` `state` | Archive/unarchive a run (overlay mark; never deletes source). |
| `cw_run_rerun` | `run.rerun` | `runId` | `runId` `cwd` `scope` `reason` | Re-run a failed run as a NEW run linked to the original by provenance. |
| `cw_run_export` | `run.export` | `runId` | `runId` `cwd` `output` `path` `archive` `trustKey` `withTrustKey` | Export a run to a portable archive with run-local files and digest integrity. |
| `cw_run_import` | `run.import` | `archive|path|file` | `archive` `path` `file` `target` `repo` `cwd` | Restore a portable run archive into a target repo and verify restored file digests. |
| `cw_run_verify_import` | `run.verify-import` | `runId` | `runId` `cwd` | Verify an imported run against its restore manifest and telemetry chain. |
| `cw_run_inspect_archive` | `run.inspect-archive` | `archive|path|file` | `archive` `path` `file` `cwd` | Read-only integrity inspection of a portable run archive without importing it. |
| `cw_run_restore` | `run.restore` | `archive|path|file` | `archive` `path` `file` `target` `repo` `cwd` | Fail-closed restore of a portable run archive: integrity-inspect, import, and verify in one step; refuses anything that does not verify. |
| `cw_report_verify_bundle` | `report.verify-bundle` | `archive|path|file|bundle` | `archive` `path` `file` `bundle` `pubkey` `extractReport` `strictSignatures` `cwd` | Offline self-contained verify of a portable run bundle: archive bytes + telemetry chain + trust-audit chain + embedded-key signatures. |
| `cw_report_bundle` | `report.bundle` | `runId` | `runId` `cwd` `output` `path` `trustKey` `withTrustKey` `extractReport` `strictSignatures` | Produce-and-prove: export a run to a portable bundle sealed with the trust key, then self-verify it offline (fail-closed) so the producer knows it is verifiable before shipping. |
| `cw_run_drive` | `run.drive` | (none) | `runId` `cwd` | Preview the next agent-delegation drive step for a run (read-only, deterministic). |
| `cw_run_drive_step` | `run.drive.step` | (none) | `runId` `appId` `repo` `question` `once` `now` `concurrency` `cwd` | Drive a run by delegating each worker to the agent backend (plan->dispatch->fulfill->accept->commit; --once for one step). |
| `cw_queue_add` | `queue.add` | (none) | `cwd` `runId` `appId` `workflowId` `repo` `priority` `note` | Enqueue a pending/planned run with explicit ordering policy. |
| `cw_queue_list` | `queue.list` | (none) | `cwd` `status` `repo` | List the durable run queue in policy order. |
| `cw_queue_drain` | `queue.drain` | (none) | `cwd` `limit` `repo` | Mark the next ready queue entries drained (the host still executes). |
| `cw_queue_show` | `queue.show` | `id` | `cwd` `id` | Show one durable queue entry. |
| `cw_sched_plan` | `sched.plan` | (none) | `cwd` | Read-only control-plane lease plan for the queue+policy+now. |
| `cw_sched_lease` | `sched.lease` | (none) | `cwd` `limit` | Claim eligible queue entries as leases (concurrency-bounded). |
| `cw_sched_release` | `sched.release` | (none) | `cwd` `leaseId` `failed` `reason` | Release a held lease (failed -> retry/backoff or park). |
| `cw_sched_complete` | `sched.complete` | (none) | `cwd` `leaseId` | Complete a held lease (terminal success). |
| `cw_sched_reclaim` | `sched.reclaim` | (none) | `cwd` | Reclaim expired leases (each counts a failed attempt). |
| `cw_sched_reset` | `sched.reset` | (none) | `cwd` `id` | Reset a parked entry to ready (operator recovery). |
| `cw_sched_policy_show` | `sched.policy.show` | (none) | `cwd` | Show the scheduling policy (file or default). |
| `cw_sched_policy_set` | `sched.policy.set` | (none) | `cwd` `maxConcurrent` `maxAttempts` `leaseTtlMs` `backoffBaseMs` `backoffFactor` `backoffCapMs` | Set scheduling policy fields (concurrency/attempts/backoff/TTL). |
| `cw_gc_plan` | `gc.plan` | (none) | `cwd` `scope` `runId` `reclaimAfterArchiveDays` `keepScratch` `keepSnapshots` | Dry-run plan of run reclamation (per-kind bytes + capability downgrade); frees nothing. |
| `cw_gc_run` | `gc.run` | (none) | `cwd` `scope` `runId` `reclaimAfterArchiveDays` `keepScratch` `keepSnapshots` `limit` `actor` | Execute the write-ahead reclamation transaction (skeleton -> tombstone -> fsync -> free). |
| `cw_gc_verify` | `gc.verify` | `runId` | `cwd` `scope` `runId` | Re-prove a reclaimed run: skeleton-complete, tombstone chain untampered, artifacts reconstructable. |
| `cw_clones_list` | `clones.list` | (none) | (none) | List the cached remote-source checkouts that --link/URL reviews populate (origin URL, kind, commit, age, bytes). Read-only. |
| `cw_clones_gc` | `clones.gc` | (none) | `olderThanDays` `all` | Reclaim cached remote-source checkouts: a TTL sweep (--older-than-days, default 30) or --all. Deletes only inside the clones cache. |
| `cw_orphans_list` | `orphans.list` | (none) | `cwd` `scope` | List run directories under .cw/runs/ that the run registry cannot see (no state.json — a killed/interrupted process never wrote one), with age + bytes. Read-only. |
| `cw_orphans_gc` | `orphans.gc` | (none) | `cwd` `scope` `minAgeMinutes` `all` | Reclaim orphan run directories (no state.json): an age sweep (--min-age-minutes, default 60) or --all. Deletes only inside a scanned repo's .cw/runs/, never a run the registry knows about. |
| `cw_telemetry_verify` | `telemetry.verify` | `runId` | `cwd` `runId` `pubkey` | Re-prove a run's telemetry attestation ledger offline: chain linkage + independent hash recompute, and (with --pubkey / CW_AGENT_ATTEST_PUBKEY) re-verify each attested hop's ed25519 signature against the public key. |
| `cw_history` | `history` | (none) | `cwd` `scope` `app` `status` `limit` `offset` | Read a cross-repo unified run timeline (newest first). |

The full type/description of every property is in `src/mcp/tool-definitions.ts` lines 3-1015; the table above lists names only.

## Exact outputs

All server output is one JSON object per line on stdout: `process.stdout.write(JSON.stringify(message) + "\n")` (src/mcp-server.ts:93-95). Nothing else is ever written to stdout by the server.

### `initialize` (src/mcp-server.ts:53-60)

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"cool-workflow","version":"0.1.98"}}}
```

The version string is `CURRENT_COOL_WORKFLOW_VERSION` from `src/version.ts:1` (`"0.1.98"` at this snapshot).

### `tools/list` (src/mcp-server.ts:61-64)

```json
{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"cw_list","description":"List bundled CW workflows.","inputSchema":{"type":"object","properties":{},"additionalProperties":true}}, ...195 more... ]}}
```

The array order is the source order of `toolDefinitions()` — `cw_list` first, `cw_history` last (src/mcp/tool-definitions.ts:5,1007).

### `tools/call` (src/mcp-server.ts:65-73)

```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\n  \"...\": ...\n}"}]}}
```

`text` is `JSON.stringify(result, null, 2)` — the 2-space pretty print of the core result, as one string.

### Errors (src/mcp-server.ts:44-49,74,76,89-91)

```json
{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error: <JSON.parse message>"}}
{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error: request line exceeds 16777216 bytes"}}
{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Invalid Request: not a JSON-RPC object"}}
{"jsonrpc":"2.0","id":<request id>,"error":{"code":-32601,"message":"Unknown method: <method>"}}
{"jsonrpc":"2.0","id":<request id>,"error":{"code":-32000,"message":"<thrown error message>"}}
```

Exact `-32000` message strings from this layer:

- `Unknown tool: <name>` (src/mcp/tool-call.ts:513)
- `MCP tools/call missing required field: name` (src/mcp-server.ts:81)
- `MCP tool <name> arguments must be an object.` (src/mcp-surface.ts:9)
- `MCP tool <name> missing required argument: <keyA> or <keyB>` — group keys joined with `" or "` (src/mcp-surface.ts:14)
- `MCP cwd is not a directory: <resolved absolute path>` (src/mcp/tool-call.ts:521)
- `verdict must be "approved" or "rejected".` (src/mcp/tool-call.ts:363, from `cw_ledger_review`)

Core errors (bad run id, gate refusals, and so on) come through the same `-32000` path with the core's own message (src/mcp-server.ts:75-77).

### `scripts/parity-check.js` stdout (scripts/parity-check.js:899-910)

```json
{
  "ok": true,
  "static": {
    "ok": true,
    "registrySize": 209,
    "missingMcpTools": [],
    "undeclaredMcpTools": [],
    "missingCliTokens": [],
    "undeclaredCliTokens": [],
    "helpMissingCliTokens": [],
    "helpUndeclaredCliTokens": [],
    "reasonlessExceptions": [],
    "payloadProbeUnclassified": [],
    "payloadProbeDuplicateClassifications": [],
    "payloadProbeInvalidClassifications": [],
    "registryLint": []
  },
  "payload": { "ok": true, "runId": "<bootstrap run id>", "checked": 73, "capabilities": ["..."], "mismatches": [] }
}
```

73 = 7 `global` + 23 `run` + 43 `scenario` probe targets (src/capability-registry.ts:600-680). With `--check` and drift, stderr starts `CLI <-> MCP parity drift detected (release-blocking):`, lists each gap as `  - <rule>: <names>`, ends with `Reconcile src/capability-registry.ts, cli.ts, and mcp-server.ts so both surfaces render one data source.\n`, and the exit code is 1 (scripts/parity-check.js:912-929). Any thrown error prints `parity-check: <message>` to stderr and exits 1 (scripts/parity-check.js:932-935).

### `scripts/gen-manifests.js` stdout (scripts/gen-manifests.js:220)

```json
{ "ok": true, "mode": "write", "results": [ { "path": ".claude-plugin/marketplace.json", "status": "written" }, ... ] }
```

In `--check` mode each result is `{ "path": ..., "ok": true|false, "status": "in-sync"|"drift"|"missing" }`. On drift, stderr is:

```text
<N> generated manifest(s) drifted from manifest/plugin.manifest.json:
  - <path>
Run `npm run gen:manifests` and commit the result.
```

and the exit code is 1 (scripts/gen-manifests.js:222-229).

## Files on disk

The MCP server layer itself writes nothing. The tools write run state through the shared cores (the `.cw/` tree is covered by the other subsystem specs). The files owned by this subsystem:

### `manifest/plugin.manifest.json` — THE source of truth

Hand-edited. Holds `identity` (name/version/license/homepage/author/keywords), `descriptions` (short/standard/long), `interface` (displayName/category/capabilities/brandColor/defaultPrompt), `layout` (`pluginPathFromRepoRoot: "./plugins/cool-workflow"`, `skillsDir: "./skills/"`, `mcpServerScript: "dist/mcp-server.js"`), `mcp` (`serverName: "cool-workflow"`, `command: "node"`), `targets` (per-vendor output paths + `pluginRootVar`), and `vendors` (per-vendor output templates with `{{path.to.field}}` markers) (manifest/plugin.manifest.json:3-316).

### Generated vendor manifests (do NOT hand-edit)

12 outputs, repo-root-relative, written as `JSON.stringify(json, null, 2) + "\n"` (scripts/gen-manifests.js:191-193):

| Vendor | Files |
| --- | --- |
| claude | `.claude-plugin/marketplace.json`, `plugins/cool-workflow/.claude-plugin/plugin.json`, `plugins/cool-workflow/.mcp.json` |
| codex | `.agents/plugins/marketplace.json`, `plugins/cool-workflow/.codex-plugin/plugin.json`, `plugins/cool-workflow/.codex-plugin/mcp.json` |
| agents | `.agents/plugins/cool-workflow/plugin.json`, `.agents/plugins/cool-workflow/mcp.json` |
| gemini | `plugins/cool-workflow/.gemini-plugin/plugin.json`, `plugins/cool-workflow/.gemini-plugin/mcp.json` |
| opencode | `plugins/cool-workflow/.opencode-plugin/plugin.json`, `plugins/cool-workflow/.opencode-plugin/mcp.json` |

Every vendor `mcp.json` has the same shape; only the path variable changes:

```json
{
  "mcpServers": {
    "cool-workflow": {
      "command": "node",
      "args": [
        "${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js"
      ]
    }
  }
}
```

(claude uses `${CLAUDE_PLUGIN_ROOT}/`; codex/agents/gemini/opencode use `./`) (.mcp.json:1-10; manifest/plugin.manifest.json:51-78).

### `server.json` — MCP registry metadata (hand-kept, version-synced)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.coo1white/cool-workflow",
  "description": "Signed, cited, replayable workflows for Claude, Codex, Gemini, DeepSeek, and other agents.",
  "repository": { "url": "https://github.com/coo1white/cool-workflow", "source": "github" },
  "version": "0.1.98",
  "packages": [ { "registryType": "npm", "identifier": "cool-workflow", "version": "0.1.98", "transport": { "type": "stdio" }, "environmentVariables": [] } ]
}
```

(server.json:1-21)

### Other files in `manifest/`

- `manifest/pricing.policy.json` — the bundled EXAMPLE pricing policy (`schemaVersion: 1`, `id: "bundled-example-v1"`, `currency: "USD"`, `models[]` with `inputPerMillion`/`outputPerMillion`, `defaultPrice`). Used by `metrics.*` when `pricing` is `"default"`; with no policy at all, cost is `unreported`/`unpriced`, never guessed (manifest/pricing.policy.json:1-14).
- `manifest/source-context-profiles.json` — `{ schemaVersion: 1, profiles: { core, runtime, ... } }`; each profile has `description`, `maxLines`, `include[]`, `exclude[]` glob lists for the fast-review source-context exports (manifest/source-context-profiles.json:1-142).
- `manifest/README.md` — the human rules for the generator (edit source, run `npm run gen:manifests`, `--check` is release-blocking).

## Invariants and error behavior

1. ONE registry drives both front doors. Every live MCP tool must be declared in `CAPABILITY_REGISTRY`, and every declared tool must be live; same for CLI `case` tokens and `cw help` lines. Any gap makes `buildParityReport().ok` false and `parity-check --check` exit 1 (src/capability-registry.ts:980-1031; scripts/parity-check.js:890-929).
2. Payload identity: a `surface: "both"` capability without a documented opt-out must give back the same canonical JSON from `cw <cmd> --json` and from `cw_<tool>` — only whitespace and ISO timestamps of the form `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z` are set aside (scripts/parity-check.js:104-106). Scenario probes also set aside temp workspace roots, run ids, `durationMs`, dispatch ids, snapshot/replay ids, `sha256:` digests, and 64-char hex (scripts/parity-check.js:116-133).
3. An opt-out from the payload probe needs BOTH `payloadIdentical: false` AND a non-empty `reason`. A bare `payloadIdentical: false` stays in scope so the gap trips the gate — fail closed (src/capability-registry.ts:903-905). A `cli-only`/`mcp-only` or payload-divergent capability with no `reason` is itself release-blocking (`reasonlessExceptions`, src/capability-registry.ts:995-999).
4. Probe classification is itself gated: every payload-identical capability must be named exactly once as `global`, `run`, or `scenario` probe, or deferred with a reason; unclassified, duplicate, or invalid names fail the gate (src/capability-registry.ts:932-945).
5. Registry lint fails closed on: duplicate capability ids, duplicate MCP tool names, `both` without both bindings, `cli-only` with an mcp binding or no cli binding, `mcp-only` with a cli binding or no mcp binding (src/capability-registry.ts:951-973).
6. Required arguments are data, not code: `requiredToolArguments` reads `McpBinding.requiredArgs`; a value of `undefined`, `null`, or `""` counts as absent (src/mcp-surface.ts:11-16).
7. `cwd` handling in `callTool`: when `args.cwd` is a non-empty string it is `path.resolve`d, must be a directory (`fs.statSync(resolved).isDirectory()`), the resolved value is put back into a COPY of args, and the runner is re-based with `baseRunner.withBaseDir(cwd)`; `Scheduler` and `RoutineTriggerBridge` get `cwd || process.cwd()` (src/mcp/tool-call.ts:76-82,517-523). A missing path throws the raw `ENOENT` error through `-32000`.
8. The dispatch switch in `tool-call.ts` is an EXPLICIT switch BY DESIGN, not a data-driven dispatcher: `descriptor.entry` does not reliably name the called function (e.g. `cw_app_run` entry=`validateApp` really calls `appRun`; `cw_commit` entry=`commit` calls `commitEnvelope`), so a generic `runner[entry](args)` rewrite would silently call wrong methods and still pass both gates (src/mcp/tool-call.ts:63-75).
9. Fail-closed input framing: the unconsumed stdin buffer is capped at `MAX_LINE_BYTES = 16 * 1024 * 1024`; when it goes over with no newline, the partial bytes are dropped and a `-32700` error with the exact text `Parse error: request line exceeds 16777216 bytes` is sent with `id: null` (src/mcp-server.ts:22,32-37).
10. Declared one-surface capabilities (13 cli-only, each with a recorded reason): `help`, `version`, `update`, `fix`, `info`, `search`, `man`, `doctor`, `loop`, `schedule.daemon`, `quickstart`, `demo.tamper`, `demo.bundle` (src/capability-registry.ts:128-199,284-290,465-472,503-510,538-539).
11. Declared payload divergences (12 `projected`, each with a reason): `commit` (CLI raw `StateCommitResult`; MCP operator envelope via `commitEnvelope`), `backend.agent.config.set`, `run.drive.step`, `gc.run`, `clones.gc`, `orphans.gc`, `workbench.serve`, `ledger.propose`, `ledger.review`, `ledger.verify`, `ledger.apply`, `ledger.list` (src/capability-registry.ts:249-258,426,502,531,534,536,549-552,581-585).
12. `cw_workbench_serve` NEVER starts the blocking localhost host: it forces `once: true` and returns only the serve descriptor, identical to `cw workbench serve --json`. The CLI default (no `--once`) additionally starts the host — a declared divergence (src/mcp/tool-call.ts:507-511).
13. Vendor manifests fail closed too: `gen-manifests --check` (drift = exit 1) runs in `release:check`; `vendor-manifest-load-smoke` proves each generated `mcp.json` really boots the server with `shell:false` and that all vendors agree on `serverInfo` and the tool count (scripts/gen-manifests.js:199-229; test/vendor-manifest-load-smoke.js:1-60).
14. The parity doc is machine-made: `gen-parity-doc.js --check` fails closed when `docs/cli-mcp-parity.7.md`'s four marker regions differ from the registry (scripts/gen-parity-doc.js:1-16; test/parity-doc-sync-smoke.js).

## Edge cases

- A request with `"id": null` and an unknown method DOES get an error answer (the guard is `message.id !== undefined`, and `null !== undefined`), with `"id":null` in the reply (src/mcp-server.ts:74).
- A notification (no `id` key) with an unknown method gets NO answer at all (src/mcp-server.ts:74). But `initialize`, `tools/list`, and `tools/call` answer even with no `id` — the reply then has no `id` key (`JSON.stringify` drops `undefined`).
- Parse errors always answer with `id: null`, even if the broken line had an id in it (src/mcp-server.ts:45).
- A line that is valid JSON but not an object (number, string, array, `null`) gets `-32600` `Invalid Request: not a JSON-RPC object` (src/mcp-server.ts:48-51).
- Many requests in one stdin chunk work: the buffer is split on every `"\n"` in a loop; each line is `.trim()`ed; empty lines are skipped (src/mcp-server.ts:24-31).
- `tools/call` with no `params`, or a `name` that is missing, empty, or only spaces, throws `MCP tools/call missing required field: name` as `-32000` (src/mcp-server.ts:80-83).
- `arguments: null` or absent is treated as `{}` and then checked against the required groups — so a tool with required args still refuses (src/mcp-surface.ts:8).
- `additionalProperties: true` on every schema: unknown extra argument keys flow through to the core untouched.
- `cw_topology_show` routes by args: with `runId` AND (`topologyRunId` or `id`) it shows a topology RUN; else it shows the official topology named by `topologyId`/`id` (src/mcp/tool-call.ts:214-216).
- `cw_ledger_review` upper-cases the `verdict` and refuses anything except `APPROVED`/`REJECTED` (src/mcp/tool-call.ts:361-372). `cw_ledger_propose`/`cw_ledger_review` split `files`/`findings` on `","` and drop empty parts; `createdAt` is minted with `new Date().toISOString()` at call time (src/mcp/tool-call.ts:351-372).
- `cw_ledger_list`: an array `dirs` with 2 or more entries union-verifies mirrors via `unionLedgerEntries`; else `listLedgerEntries(dirs[0] || String(args.dir || ""))` (src/mcp/tool-call.ts:377-382).
- `cw_routine_fire` uses `args.payload || args` — with no `payload`, the whole args bag is the event payload (src/mcp/tool-call.ts:422).
- Registry dedupe: `CAPABILITY_REGISTRY` is built through a `Map` keyed by capability id, so a repeated declaration is not a silent dead row — the LAST one wins (src/capability-registry.ts:592-594).
- Manifest templates: an unresolved `{{expr}}` marker stays as the literal string; a whole-string marker resolves to the real JS value (object/array), not a string; `|lowercase` is the only transformer; `{{pluginRootVar}}` resolves to the vendor's `pluginRootVar`; object KEYS may hold markers too (`"{{mcp.serverName}}"` -> `"cool-workflow"`) (scripts/gen-manifests.js:52-107).
- `gen-manifests` keeps a legacy build path for a source with no `vendors` key (scripts/gen-manifests.js:113-115,134-178).
- The parity CLI-token scan reads `case "<token>":` strings from `dist/cli.js`, `dist/cli/command-surface.js`, AND every `dist/cli/handlers/*.js`, so a subcommand `case` in a carved-out handler module still counts as live (scripts/parity-check.js:66-81).
- The parity payload probe realpath-resolves its temp workspace so a symlinked tmpdir does not read as a payload divergence (scripts/parity-check.js:842-844).

## Evidence

- JSON-RPC framing, methods, error codes, 16MiB cap: src/mcp-server.ts:15-99.
- Required-args checking: src/mcp-surface.ts:7-25; declared groups: src/capability-registry.ts per-capability `requiredArgs` fields (see table lines in mcp.surface.json).
- Tool schemas and descriptions: src/mcp/tool-definitions.ts:3-1015; schema helper shapes: src/mcp/tool-definitions.ts:1035-1092.
- Tool dispatch + cwd handling + design note: src/mcp/tool-call.ts:59-523.
- Registry model, lint, parity report, probe plan: src/capability-registry.ts:1-1032.
- Registry counts (209 capabilities / 196 tools / 13 cli-only / 0 mcp-only): computed from dist/capability-registry.js; matches docs/cli-mcp-parity.7.md:85-86.
- Parity gate mechanics + canonicalization + scenario probes: scripts/parity-check.js:1-935.
- Parity contract prose + full matrix: docs/cli-mcp-parity.7.md:1-407; MCP app-surface contract: docs/mcp-app-surface.7.md:1-247; multi-agent host loop surface: docs/multi-agent-cli-mcp-surface.7.md:1-60.
- Vendor manifest generation: scripts/gen-manifests.js:1-233; source: manifest/plugin.manifest.json:1-316; rules: manifest/README.md:1-49.
- Launcher shim: scripts/mcp-server.js:1-4; Claude config: .mcp.json:1-10; MCP registry metadata: server.json:1-21.
- Version constant: src/version.ts:1.

## Pinned by tests

- `test/mcp-surface-registry-smoke.js` — `tools/list` must equal `toolDefinitions()` exactly; every live tool must be registry-backed, carry a description, and be reproducible by `mcpToolDefinition`; the transport file must not hold `callTool`/`toolDefinitions`; the surface must not hard-code `tool("cw_` names.
- `test/mcp-tool-call-coverage-smoke.js` — dispatch of representative tools from every domain through `callTool`; `Unknown tool` throw.
- `test/mcp-app-surface-smoke.js` — a live JSON-RPC session: `initialize`, tool calls, `content[0].type === "text"`, JSON round trip.
- `test/cli-mcp-parity-smoke.js` — end-to-end parity contract: registry <-> CLI <-> MCP coverage, payload identity for every `payloadIdentical` capability, the declared `commit` projection, and fail-closed behavior when drift is put in on purpose.
- `test/cli-jsonmode-parity-smoke.js` — pins each CLI verb's `--json` policy to the registry's `jsonMode` data.
- `test/multi-agent-cli-mcp-surface-smoke.js` — the high-level multi-agent host loop on both surfaces.
- `test/vendor-manifest-load-smoke.js` — every generated vendor `mcp.json` boots a working server; all vendors agree on `serverInfo` + tool count.
- `test/parity-doc-sync-smoke.js` — `docs/cli-mcp-parity.7.md` generated regions must match `gen-parity-doc.js` output.
- `scripts/parity-check.js --check` — the gate itself, run by `npm run parity:check` inside `npm run release:check`.

## Rebuild risks

1. The `tools/call` answer is NOT the raw result object: it is the 2-space pretty-printed JSON string inside `content[0].text`. Tests and the parity probe `JSON.parse` that string. Get the wrapping or the `null, 2` spacing wrong and byte-compare tests break.
2. Required-argument groups: `""` and `null` count as absent, and `"keyA|keyB"` is an OR group. Coding this as an if-ladder instead of registry data will drift and breaks `mcp-surface-registry-smoke`'s design checks.
3. The 12 `projected` capabilities and 13 `cli-only` capabilities look like drift but are DECLARED with reasons. Do not "fix" `cw_commit` to match the CLI payload, do not make `cw_workbench_serve` start the server (it forces `once: true`), and do not add MCP peers for `doctor`/`quickstart`/demos — the parity gate expects these exact exceptions.
4. Framing details are easy to get wrong: newline-delimited JSON (no `Content-Length`), `id: null` on parse errors, an error answer for `"id": null` requests but SILENCE for id-less unknown methods, answers for `initialize`/`tools/list`/`tools/call` even without an id, the 16MiB cap with its exact error text.
5. Descriptions and schemas live in `tool-definitions.ts` but names and required args come from the registry; `mcpToolDefinition` throws on an undeclared capability. Building the tool list from the registry alone (or the definitions alone) breaks the round-trip check in `mcp-surface-registry-smoke`.
6. `cwd` must be resolved and validated BEFORE dispatch, injected back into a copy of args, and used to re-base the runner. Skipping the re-base makes every relative-path capability act on the server's own cwd.
7. Do NOT replace the explicit dispatch switch with `runner[descriptor.entry](args)` — `entry` metadata is wrong for some arms (`cw_app_run`, `cw_commit`) and the payload probes cover only ~73 read-mostly capabilities, so the false-green would ship silently (src/mcp/tool-call.ts:63-75).
8. Vendor manifests are generated bytes: `JSON.stringify(json, null, 2) + "\n"`, exact paths per vendor, `${CLAUDE_PLUGIN_ROOT}/` only for claude. Hand-editing them or changing serialization breaks `gen-manifests --check` and the load smoke.
