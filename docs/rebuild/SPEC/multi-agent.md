# multi-agent

## Scope (one line)

The multi-agent layer of CW: runtime records (runs, roles, groups, memberships, fanouts, fanins), the three built-in topologies (`map-reduce`, `debate`, `judge-panel`), the coordinator/blackboard store, candidate scoring/ranking/selection, trust policy checks between agents, the operator UX views, the team-collaboration review gate, and the eval replay harness. Files: `src/multi-agent.ts`, `src/multi-agent/{helpers,graph,ids,paths}.ts`, `src/topology.ts`, `src/coordinator.ts`, `src/coordinator/{util,classify,paths}.ts`, `src/multi-agent-trust.ts`, `src/candidate-scoring.ts`, `src/collaboration.ts`, `src/multi-agent-host.ts`, `src/multi-agent-operator-ux.ts`, `src/multi-agent-eval.ts`, `src/multi-agent-eval/{normalize,format}.ts`.

---

## Public surface

### A. Multi-agent kernel (`src/multi-agent.ts`)

All functions take a `WorkflowRun` (the mutable in-memory run) as the first argument. All write functions persist the multi-agent state to disk before they return.

| Export | Takes | Does | Returns |
|---|---|---|---|
| `MULTI_AGENT_SCHEMA_VERSION` | — | Constant `1` | `1` (src/multi-agent/helpers.ts:16) |
| `ensureMultiAgentState(run)` | run | Makes `run.paths.multiAgentDir` plus the six sub-dirs; fills `run.multiAgent` with empty arrays if absent | `MultiAgentState` (src/multi-agent.ts:170-195) |
| `persistMultiAgentState(run)` | run | Checks file-name collisions, writes `index.json` + one JSON file per record | void (src/multi-agent.ts:197-230) |
| `createMultiAgentRun(run, input)` | `CreateMultiAgentRunInput` | New `MultiAgentRun`, default id `mar-NNNN`, default status `"planned"`, builds a run policy, links parent run, appends a state node, records a trust audit event | `MultiAgentRun` (src/multi-agent.ts:232-300) |
| `transitionMultiAgentRun(run, id, status, options)` | id, target status, `{reason, actor, metadata}` | Checks the lifecycle table; on `"completed"` checks completion readiness and then cascades `completed` onto owned roles/groups/fanouts/fanins | `MultiAgentRun` (src/multi-agent.ts:302-330) |
| `createAgentRole(run, input)` | `CreateAgentRoleInput` (needs `multiAgentRunId`) | New `AgentRole`, default id `role-NNNN`, status `"planned"`, attaches a role policy via `policyForRole`, records a role-policy audit | `AgentRole` (src/multi-agent.ts:384-444) |
| `createAgentGroup(run, input)` | `CreateAgentGroupInput` (needs `multiAgentRunId`) | New `AgentGroup`, default id `group-NNNN`, status `"forming"`, checks every `taskIds` entry exists on the run | `AgentGroup` (src/multi-agent.ts:446-503) |
| `assignAgentMembership(run, input)` | `AssignAgentMembershipInput` (needs `groupId`, `roleId`, `taskId`) | New `AgentMembership`, default id `membership-NNNN`; status `"running"` if a worker is given, else `"assigned"`; sets the role `"active"`; stamps `multiAgent` metadata onto the worker record | `AgentMembership` (src/multi-agent.ts:505-592) |
| `createAgentFanout(run, input)` | `CreateAgentFanoutInput` (needs `groupId`, `reason`) | New `AgentFanout`, default id `fanout-NNNN`, status `"planned"`; role/task ids default to the group's | `AgentFanout` (src/multi-agent.ts:594-675) |
| `attachDispatchToMultiAgent(run, input)` | `dispatchId`, `tasks[]` + one of `multiAgentRunId/groupId/roleId/fanoutId` | Ties a dispatch to multi-agent state: makes a fanout if needed, one membership per task (status `"running"`), sets fanout `"dispatched"`, group `"running"`, run `"running"` | `{ multiAgent?, membershipIds }` (src/multi-agent.ts:677-772) |
| `collectAgentFanin(run, input)` | `CollectAgentFaninInput` (`groupId` or `fanoutId`) | New `AgentFanin`, default id `fanin-NNNN`; derives coverage, missing roles/memberships, blocked reasons; status `"ready"` or `"blocked"`; sets group + run status `"verifying"` or `"collecting"` | `AgentFanin` (src/multi-agent.ts:774-902) |
| `recordMultiAgentWorkerOutput(run, input)` | `workerId`, `taskId`, evidence, node ids, blackboard ids | Marks every matching membership `"reported"` and merges evidence refs / artifact paths / blackboard ids; empty array if no membership matches | `AgentMembership[]` (src/multi-agent.ts:904-957) |
| `summarizeMultiAgent(run)` | run | Derived counts, per-group role coverage, blocked reasons, next action | `MultiAgentSummary` (src/multi-agent.ts:959-1004) |
| `buildMultiAgentGraph(run)` | run | Nodes + de-duplicated edges over all six record kinds | `MultiAgentGraph` (src/multi-agent.ts:1006-1009, src/multi-agent/graph.ts:20-68) |
| `getMultiAgentRun/getAgentRole/getAgentGroup/getAgentMembership/getAgentFanout/getAgentFanin(run, id)` | id | Find by id | record or `undefined` (src/multi-agent.ts:1011-1033) |

Record id scheme (shared with the coordinator): `createId(prefix, seq)` returns `` `${prefix}-${String(seq).padStart(4, "0")}` `` — position in the collection, no clock, no random (src/multi-agent/ids.ts:15-17). Prefixes: `mar`, `role`, `group`, `membership`, `fanout`, `fanin` (multi-agent) and `bb`, `topic`, `msg`, `ctx`, `artifact`, `snapshot`, `decision` (blackboard).

### B. Topologies (`src/topology.ts`)

| Export | Takes | Does | Returns |
|---|---|---|---|
| `TOPOLOGY_SCHEMA_VERSION` | — | Constant `1` | (src/topology.ts:34) |
| `OFFICIAL_TOPOLOGIES` | — | The three built-in definitions: `map-reduce`, `debate`, `judge-panel` | `MultiAgentTopologyDefinition[]` (src/topology.ts:58-137) |
| `registerTopology(definition)` | definition | Adds/overwrites in a module-level registry; last write wins per id | void (src/topology.ts:173-175) |
| `listTopologyDefinitions()` | — | Official list merged with registered ones (registered wins on id clash), all deep-cloned | definitions (src/topology.ts:177-185) |
| `getTopologyDefinition(id)` | id | Registered first (clone), else official | definition or `undefined` (src/topology.ts:187-191) |
| `validateTopologyDefinition(id)` | id | Structural checks; issue codes below | `TopologyValidationResult` (src/topology.ts:193-208) |
| `applyTopology(run, topologyId, input)` | `ApplyTopologyInput` | Materializes blackboard + topics + multi-agent run + roles + group + fanout (+ optional initial fanin) + message + coordinator decision + audit events, then a `MultiAgentTopologyRun` record | `MultiAgentTopologyRun` (src/topology.ts:210-390) |
| `summarizeTopologies(run)` | run | Per-topology-run readiness derived live from fanins | `TopologySummary` (src/topology.ts:392-429) |
| `buildTopologyGraph(run)` | run | Topology-run nodes + edges to multi-agent/blackboard records | `TopologyGraph` (src/topology.ts:431-448) |
| `showTopologyRun(run, id)` | id | Find or throw | `MultiAgentTopologyRun` (src/topology.ts:450-454) |
| `ensureTopologyState(run)` / `persistTopologyState(run)` | run | Dir + state init; write `index.json` + per-run files | (src/topology.ts:139-163) |

`ApplyTopologyInput` fields: `id`, `title`, `multiAgentRunId`, `blackboardId`, `taskIds`, `mapperCount`, `judgeCount`, `roleCounts` (per-role width map; wins over the legacy counts), `debateRounds`, `collectInitialFanin`, `metadata` (src/topology.ts:36-51). Note: `debateRounds` is accepted but **never read** by `applyTopology` — it changes nothing (grep: only the input interface, src/topology.ts:48).

Built-in topology content (exact):

- `map-reduce` (src/topology.ts:59-83): roles `mapper` (title `Mapper`, default `count` 2) and `reducer` (`Reducer`); group `map-reduce` (`Map-Reduce Group`); topics `mapper-outputs` (`Mapper Outputs`) and `reducer-synthesis` (`Reducer Synthesis`); phases `map` (fanout) and `reduce` (fanin); `requiredEvidence` `["mapper output artifact", "blackboard artifact ref", "reducer synthesis"]`; `coordinatorDecisions` `["artifact-index", "fanin-readiness", "candidate-synthesis"]`.
- `debate` (src/topology.ts:84-111): roles `position-a` (`Position A`), `position-b` (`Position B`), `synthesizer` (`Synthesis`); group `debate`; topics `debate-rounds`, `debate-conflicts`, `debate-synthesis`; phases `opening`, `rebuttal`, `synthesis`; `requiredEvidence` `["debate message", "conflict context", "coordinator decision", "final synthesis"]`; `coordinatorDecisions` `["message-moderation", "conflict-resolution", "candidate-synthesis"]`.
- `judge-panel` (src/topology.ts:112-136): roles `judge` (`Judge`, default `count` 3) and `panel-chair` (`Panel Chair`); group `judge-panel`; topics `judge-verdicts`, `panel-decision`; phases `judge`, `panel`; `requiredEvidence` `["judge output", "score record", "panel decision", "candidate selection rationale"]`; `coordinatorDecisions` `["artifact-index", "candidate-synthesis"]`.

Role width rules: `withLegacyRoleCounts` folds `mapperCount` (floor 1) and `judgeCount` (floor 2) into `roleCounts`; an explicit `roleCounts` entry always wins (src/topology.ts:460-470). `materializedRoles`: width = `max(1, roleCounts[role.id] ?? role.count ?? 1)`; when width > 1, instances get ids `` `${role.id}-${index}` `` and titles `` `${role.title} ${index}` `` for index 1..N (src/topology.ts:472-485). So default `map-reduce` mints `mapper-1`, `mapper-2`, `reducer`; default `judge-panel` mints `judge-1`, `judge-2`, `judge-3`, `panel-chair`.

Fanout roles at apply time exclude ids ending `-reducer`, `-synthesizer`, `-panel-chair` (the collector roles); if that filter empties the list, all roles fan out (src/topology.ts:273-281). `concurrencyLimit` = the fanout role count.

Deterministic default topology-run id: `` `${definition.id}-${hex16}` `` where `hex16` is the first 16 hex chars of `sha256(stableStringify({definitionId, roleIds sorted, taskIds sorted, runId, sequence}))` and `sequence` = number of topology runs already on the run (src/topology.ts:559-570). Derived default ids off it: blackboard `` `${id}-blackboard` ``, topics `` `${id}-${topic.id}` ``, multi-agent run `` `${id}-ma` ``, roles `` `${id}-${role.id}` ``, group `` `${id}-group` ``, fanout `` `${id}-fanout` ``, initial fanin `` `${id}-fanin-initial` `` (src/topology.ts:227-315).

### C. Coordinator / blackboard (`src/coordinator.ts`)

| Export | Takes | Does | Returns |
|---|---|---|---|
| `BLACKBOARD_SCHEMA_VERSION` | — | Constant `1` | (src/coordinator.ts:63) |
| `ensureBlackboardState(run)` | run | Dir + 5 sub-dirs; fills empty state | `BlackboardState` (src/coordinator.ts:169-187) |
| `resolveBlackboard(run, input)` | `ResolveBlackboardInput` | Finds by `id`, else by `multiAgentRunId` link, else the first board; creates one (id `bb-NNNN`, status `"active"`) if none found; links multi-agent records to the board either way | `Blackboard` (src/coordinator.ts:189-252) |
| `createBlackboardTopic(run, input)` | `CreateTopicInput` (needs `title`) | New topic (id `topic-NNNN`, status `"open"`), joins board, writes audits | `BlackboardTopic` (src/coordinator.ts:254-306) |
| `postBlackboardMessage(run, input)` | `PostMessageInput` (needs `topicId`, `body`) | New message (id `msg-NNNN`, status `"active"`, `visibility` default `"public"`), builds provenance with `bodyHash`, runs the trust policy check when the author is agent-scoped, writes 3-4 audit events | `BlackboardMessage` (src/coordinator.ts:308-451) |
| `putBlackboardContext(run, input)` | `PutContextInput` (needs `topicId`, `kind`, `value`) | New context (id `ctx-NNNN`); conflict detection on same board+topic+kind+key with a different value; supersede support; always records a coordinator decision | `BlackboardContext` (src/coordinator.ts:453-569) |
| `addBlackboardArtifact(run, input)` | `AddArtifactInput` (needs `kind` + `path` or `locator`) | New artifact ref (id `artifact-NNNN`); resolves the path absolute; checksums the file when it exists; records an `artifact-index` decision | `BlackboardArtifactRef` (src/coordinator.ts:571-668) |
| `createBlackboardSnapshot(run, blackboardId?)` | optional board id | New snapshot (id `snapshot-NNNN`) with sorted id lists and an embedded summary | `BlackboardSnapshot` (src/coordinator.ts:670-718) |
| `recordCoordinatorDecision(run, input)` | `RecordDecisionInput` (needs `kind`, `outcome`, `reason`) | New decision (id `decision-NNNN`), status derived from outcome, panel-decision audit when kind is `candidate-synthesis` or tag `panel-decision` | `CoordinatorDecision` (src/coordinator.ts:720-798) |
| `summarizeBlackboard(run, blackboardId?)` | optional board id | Counts, open questions, conflicts, missing-evidence rows, `readyForFanin`, latest snapshot path, next action | `BlackboardSummary` (src/coordinator.ts:800-831) |
| `listBlackboardMessages(run, {topicId?, blackboardId?})` | filters | Sorted by `createdAt` then `id` | `BlackboardMessage[]` (src/coordinator.ts:833-838) |
| `listBlackboardArtifacts(run, {topicId?, blackboardId?})` | filters | Sorted by `id` | `BlackboardArtifactRef[]` (src/coordinator.ts:840-845) |
| `buildBlackboardGraph(run)` | run | Nodes + edges for boards/topics/contexts/artifacts/messages/decisions/snapshots | `BlackboardGraph` (src/coordinator.ts:847-885) |
| `persistBlackboardState(run)` | run | `index.json`, `messages.jsonl`, one file per topic/context/artifact/snapshot/decision | void (src/coordinator.ts:887-932) |

Context kinds: `fact`, `constraint`, `assumption`, `question`, `decision` (docs/coordinator-blackboard.7.md:73-79). A `question` context starts with status `"open"`; other kinds `"active"`; a conflicting write gets `"conflicting"` on both sides (src/coordinator.ts:491,504-508). `--supersedes` marks the old record `"superseded"` and sets `supersededByContextId` (src/coordinator.ts:485-490).

Author defaults (`normalizeAuthor`): kind `runtime`/`coordinator` → id `"cw"`; kind `operator` → id `"operator"`; any other kind with no id throws (src/coordinator.ts:988-993). Policy is enforced (`shouldEnforcePolicy`) when the author kind is `role`/`group`/`membership`/`worker` or the links carry an agent role/group/membership id (src/coordinator.ts:956-959).

Secret scrub on all record `metadata`: keys matching `/secret|token|password|credential|authorization|api[_-]?key|env/i` become `"[redacted]"`; string values matching `/secret|token|password|credential/i` become `"[redacted]"`; scrubbing recurses into nested objects and arrays (src/coordinator/util.ts:93-115).

### D. Trust policies (`src/multi-agent-trust.ts`)

| Export | Does |
|---|---|
| `policyForRole(role)` | Derives the role policy. Chair detection: lowercased `metadata.topologyRoleId` (or title) contains `"chair"`, `"reducer"`, or `"synthesizer"`. Judge detection: contains `"judge"`. Chair adds write ops `snapshot`, `coordinator-decision`; candidate ops `["score","select"]` (non-chair: `["score"]`); judge ops: judge → `verdict`,`rationale`; chair → `rationale`,`panel-decision`. `requiredEvidenceFor` is fixed: `"judge.rationale"` → `["judge rationale evidence"]`, `"judge.verdict"` → `["judge verdict evidence"]`, `"judge.panel-decision"` → `["judge messages", "score evidence", "coordinator decision"]`, `"candidate.select"` → `["score evidence", "judge rationale"]` (src/multi-agent-trust.ts:39-72) |
| `policyForGroup(group)` | Wide-open group policy: all write/candidate/judge ops allowed, topics from the group or `["*"]` (src/multi-agent-trust.ts:74-90) |
| `policyForMembership(membership, role?)` | Copies the role policy (or a minimal message/context/artifact-only policy if no role) and re-subjects it to the membership (src/multi-agent-trust.ts:92-114) |
| `authorizeMultiAgentAction(run, input)` | Resolves the policy membership → role → group; evaluates denied ops, topic scope, op class, and required evidence; records a `multi-agent.permission` audit event (decision `allowed`/`denied`) and, on deny, a `policy.violation` event too | returns `MultiAgentTrustDecision` (src/multi-agent-trust.ts:129-226) |
| `assertMultiAgentActionAllowed(run, input)` | Same, but throws `decision.reason` when denied (src/multi-agent-trust.ts:228-232) |
| `recordBlackboardWriteAudit(run, input)` | `blackboard.write` audit; decision `denied` for status denied/blocked, `failed` for conflicting, else `accepted` (src/multi-agent-trust.ts:234-282) |
| `recordMessageProvenanceAudit(run, input)` | `blackboard.message-provenance` audit with `bodyHash`, 120-char summary, `locator` `` `${blackboardId}/messages/${messageId}` `` (src/multi-agent-trust.ts:284-328) |
| `recordJudgeRationaleAudit(run, input)` | `judge.rationale` or `judge.panel-decision` audit; decision `accepted` only when both `evidenceRefs` non-empty and `rationale` present, else `denied`; rationale metadata truncated to 240 chars (src/multi-agent-trust.ts:330-373) |
| `summarizeMultiAgentTrust(run)` | Buckets audit events by kind into `rolePolicies`, `permissionDecisions`, `blackboardWrites`, `messageProvenance`, `judgeRationales`, `panelDecisions`, `policyViolations` + `nextAction` (src/multi-agent-trust.ts:375-394) |
| `hasAcceptedJudgeRationale(run, {multiAgentRunId?, candidateId?, scoreId?})` | True if any `judge.rationale` event with decision `accepted` matches; an event with no `scoreId` matches any `scoreId` filter (src/multi-agent-trust.ts:396-407) |
| `sourceForActor(actor?)` | no actor → `operator-recorded`; worker → `host-attested`; operator → `operator-recorded`; runtime/coordinator/verifier → `runtime-derived`; else `cw-validated` (src/multi-agent-trust.ts:409-415) |
| `hashText(value)` | `` `sha256:<hex>` `` of the utf8 string (src/multi-agent-trust.ts:420-422, src/execution-backend/util.ts:13-15) |
| `recordRolePolicyAudit(run, role)` | `multi-agent.role-policy` audit event (src/multi-agent-trust.ts:116-127) |

### E. Candidate scoring (`src/candidate-scoring.ts`)

| Export | Does |
|---|---|
| `CANDIDATE_SCHEMA_VERSION` | Constant `1` (src/candidate-scoring.ts:26) |
| `createCandidateScoring(options)` | Factory that binds `CandidateScoringOptions` (`persist`, `policy`) over the free functions (src/candidate-scoring.ts:79-93) |
| `registerCandidate(run, input, options)` | Idempotent on an existing id (returns the stored record). Default id `` `candidate-${kind}-${seed?}-${NNNN}` `` (seed = worker/task/result-node id, seq = candidate count + 1). Kind inference: `workerId` → `worker-output`; `resultNodeId` or `resultPath` → `result`; else `manual`. Status `"registered"`. Records a `candidate.register` audit + a candidate state node (src/candidate-scoring.ts:95-146,754-761) |
| `listCandidates(run, {status?, kind?})` | Merges the on-disk candidate files into `run.candidates` (disk wins per id), then filters (src/candidate-scoring.ts:148-157) |
| `getCandidate(run, id)` | Memory first, else reads `candidate.json` and validates it fail-closed (`validateCandidateRecord`) before trusting it (src/candidate-scoring.ts:159-171) |
| `scoreCandidate(run, candidateId, input, options)` | Score id `` `score-${candidateId}-${NNNN}` ``. `total` = sum of `criteria` values; `maxTotal` default `max(total, 1)`; `normalized` = clamp(total/maxTotal, 0, 1). Verdict: below `minNormalized` → `fail`; `>= 0.7` → `pass`; `>= 0.4` → `warn`; else `fail`. With `requireEvidence` (default true) and no evidence: records feedback code `candidate-score-missing-evidence`, sets the candidate `failed`, and throws. Candidate status becomes `failed` on a fail verdict, else `scored` (src/candidate-scoring.ts:173-252,705-727) |
| `rankCandidates(run, {policy?, includeRejected?})` | Excludes `rejected` unless asked. Sort: normalized desc; tie → `tieBreaker` `"createdAt"` (default; createdAt then id byte-compare) or `"candidateId"`. Writes `ranking.json`. `ties` groups candidate ids sharing `String(normalized)` (src/candidate-scoring.ts:254-286,680-703) |
| `selectCandidate(run, candidateId, options, scoringOptions)` | Fail-closed gate; failure codes: `candidate-not-selectable` (status rejected/failed), `candidate-selection-missing-verifier`, `candidate-selection-missing-evidence`, `candidate-selection-empty-capture`, `candidate-selection-score-below-threshold`, plus review-gate errors (`review-gate-missing-approvals`). Every failure becomes an ErrorFeedback record, the candidate is set `failed`, and the joined messages are thrown. On pass: selection id `` `selection-${candidateId}-${NNNN}` ``, candidate status `verified` (verifier node verified) or `selected`; `selectedBy` default `"operator"`, `reason` default `"selected candidate"`; a `candidate.selection` audit and an acceptance rationale are recorded (src/candidate-scoring.ts:288-436,771-776) |
| `rejectCandidate(run, candidateId, reason, options)` | Status `rejected`, feedback code `candidate-rejected`, message default `` `Candidate ${candidateId} rejected` `` (src/candidate-scoring.ts:438-459) |
| `summarizeCandidates(run)` | `{ total, byStatus, byKind, indexPath, rankingPath, selections }` (src/candidate-scoring.ts:461-478) |

Verifier gate detail (`requireVerifierGate` default true, bypassed only by `allowUnverified`): the verifier node must exist with status `"verified"`, must carry evidence, and must not be an empty-capture result (`emptyCaptureWarning` shared with the commit gate) (src/candidate-scoring.ts:309-321).

### F. Team collaboration / review gate (`src/collaboration.ts`)

| Export | Does |
|---|---|
| `COLLABORATION_SCHEMA_VERSION` | `1` (src/collaboration.ts:47) |
| `UNATTRIBUTED_ACTOR` | `{ kind: "unattributed", id: "unattributed", attestation: "unattributed", attested: false, source: "runtime-derived" }` (src/collaboration.ts:50-56) |
| `ensureCollaborationState(run)` | Fills `run.collaboration` `{approvals: [], comments: [], handoffs: []}` (src/collaboration.ts:123-132) |
| `normalizeActor(input)` | No actor id → the unattributed actor. Kind must be one of `operator, worker, role, membership, group, host, service, unattributed`; unknown kind falls back to `role` (if a role id is given) or `operator`. Attestation: explicit, else `attested` flag → `host-attested`, else `operator-recorded` (src/collaboration.ts:134-170) |
| `recordApproval(run, input, options)` | Append-only; decision is `reject` only when input says `"reject"`, all else `approve`; id `collab-approval-NNNN` / `collab-rejection-NNNN` (seq = approvals array length + 1, one shared counter) (src/collaboration.ts:176-214,783-788) |
| `recordComment(run, input, options)` | Body required; default `threadId` `` `${target.kind}:${target.id}` ``; id `collab-comment-NNNN` (src/collaboration.ts:216-247) |
| `recordHandoff(run, input, options)` | Needs a to-actor; default reason `"handoff"`; id `collab-handoff-NNNN` (src/collaboration.ts:249-288) |
| `setReviewPolicy(run, input, options)` | Policy as data; defaults: `requiredApprovals` 0, `authorizedRoles` `["*"]`, `allowSelfApproval` false, `requireAttestedActor` false, `appliesTo` `["commit"]` (src/collaboration.ts:290-318) |
| `deriveReviewState(run, target, options)` | Pure projection. Superseded records are retired. A reject from an authorized attested actor is a blocking veto. Counted approvals are distinct by actor id. Status: not gated → `approved`; any veto → `rejected`; quorum met → `approved`; zero counted + all blocking disqualifications `unattributed` → `unattributed`; zero counted + other disqualifications → `blocked`; else `pending` (src/collaboration.ts:330-423) |
| `reviewGateErrors(run, input)` | Empty when not gated or approved; else one `StateNodeError` code `review-gate-missing-approvals` (src/collaboration.ts:469-493) |
| `commitReviewProvenance(run, input)` | When a gated target is approved: `{policyId, requiredApprovals, recordedApprovals, approvers, approvalIds (sorted), target}` (src/collaboration.ts:496-514) |
| `selfActorIdsForCandidate(run, candidateId?, selectionId?)` | Producing worker id + `selectedBy` of matching selections (src/collaboration.ts:543-552) |
| `buildReviewStatusReport(run, {now, target?})` / `listComments` / `deriveOwner` | Read-only reports and timeline (src/collaboration.ts:563-611) |
| `formatReviewStatus(report)` / `formatCommentList(comments)` | Human formatters (src/collaboration.ts:678-707) |

### G. Multi-agent host (`src/multi-agent-host.ts`)

The host is the high-level `multi-agent run|status|step|blackboard|score|select` control loop. Every function returns a `MultiAgentHostResponse` envelope (shape in Exact outputs).

| Export | Does |
|---|---|
| `hostRun(run, options)` | No `--topology` → status envelope. Else reuse the active topology run with the same `topologyId` (performed `"attached-topology"`) or `applyTopology` (performed `"applied-topology"`). Never dispatches workers; the data carries `dispatchCreated: false` and the note string (src/multi-agent-host.ts:98-122) |
| `hostStatus(run, command?)` | Envelope only (src/multi-agent-host.ts:124-126) |
| `hostStep(run, options)` | One deterministic step, tried in this order: terminal states first (`complete`, `ready-for-commit`, `needs-run`, `blocked`/`failed` all return `performed: "none"` with a `requiredHostAction`); running workers block; else collect fanin (`collected-fanin` / `collected-blocked-fanin`); else create a dispatch manifest (`created-dispatch-manifest`); else snapshot the blackboard once (`created-blackboard-snapshot`); else register a candidate from a verified worker (`registered-candidate`); else score the single registered candidate with fallback criteria `{correctness:1, evidence:1, fit:1}` maxTotal 3 (`scored-candidate`); else select (`selected-candidate`); else `performed: "none"` (src/multi-agent-host.ts:128-253) |
| `hostBlackboard(run, action, options)` | Actions: `summary`/`board`, `topics`/`list-topics`, `messages`/`list-messages`, `post`/`message`, `artifacts`/`list-artifacts`, `add-artifact`/`artifact`, `context`/`put-context`, `snapshot`; default `summary`; unknown action throws the usage string (src/multi-agent-host.ts:255-327) |
| `hostScore(run, options)` | Resolves the candidate (`--candidate`, or the single non-rejected/failed one, or registers one from `--worker`). Explicit `--evidence` is required. When a role/membership authority is given, requires a rationale, checks the `judge.rationale` permission, and records the rationale audit. Scores with scorer default `"multi-agent-host"`; records a `candidate-synthesis` coordinator decision when a topology is active (src/multi-agent-host.ts:329-399) |
| `hostSelect(run, options)` | Candidate = explicit, single, or top-ranked (first ranked entry with `scoreCount > 0` and verdict not `fail`). With a role/membership authority: requires an accepted judge rationale (`hasAcceptedJudgeRationale`) and the `candidate.select` permission. Then `selectCandidate` (src/multi-agent-host.ts:401-458) |

Host state classification (`classifyHostState`, src/multi-agent-host.ts:567-587), first match wins: no topologies and no multi-agent runs → `needs-run`; open non-retryable feedback → `failed`; open feedback → `blocked`; a verifier-gated commit exists and nothing else ready → `complete`; `candidates.readyForCommit` non-empty → `ready-for-commit`; no selection yet but a scored/verified candidate exists → `ready-for-selection`; a registered candidate exists → `ready-for-scoring`; allocated/running workers → `awaiting-worker-output`; a verified worker with no candidate → `ready-for-scoring`; fanin plan available → `ready-for-fanin`; dispatch plan available → `ready-for-dispatch`; else `blocked`.

Option aliases accepted by the host (all read via generic option maps): topology `topology|topologyId|id`; topology-run id `topologyRun|topologyRunId|topology-run|topology-run-id|name`; tasks `task|taskId|tasks`; mapper width `mapperCount|mapper-count|mappers|mapper`; judge width `judgeCount|judge-count|judges|judge`; rounds `debateRounds|debate-rounds|rounds`; fanin at apply `collectInitialFanin|collect-initial-fanin`; blackboard `blackboard|blackboardId`; topic `topic|topicId`; candidate `candidate|candidateId|id`; worker `worker|workerId`; score `score|scoreId`; criteria `criteria` object, repeated `criterion` `name=value` entries, or `total`; evidence `evidence|evidenceRef|evidence-ref`; authority `role|roleId|multi-agent-role`, `group|groupId|multi-agent-group`, `membership|membershipId|multi-agent-membership`, `multiAgentRun|multiAgentRunId|multi-agent-run`; selection `by|selectedBy`, `reason`, `allowUnverified`, `requireVerifierGate`, `minNormalized`; step dispatch `limit`, `sandbox|sandboxProfile|sandboxProfileId` (default `"readonly"`), `backend|backendId|executionBackend` (src/multi-agent-host.ts:98-113,205-215,228-235,652-660,792-846).

### H. Operator UX (`src/multi-agent-operator-ux.ts`)

| Export | Does |
|---|---|
| `summarizeMultiAgentOperator(run)` | The `MultiAgentOperatorStatus`: active ids, sorted record id lists, `blocked` (true iff failures exist), dependency rows, failure rows, evidence rows (+ `missingEvidence`, `adoptedEvidence`, `inspectableEvidence` subsets), `nextAction`, and nested summaries (src/multi-agent-operator-ux.ts:110-151) |
| `buildMultiAgentOperatorGraph(run)` | Union of the topology, multi-agent, and blackboard graphs plus tasks, dispatches, workers, candidates, scores, selections, commits, feedback, and derived dependency edges; nodes sorted by kind then id; edges deduped and sorted (src/multi-agent-operator-ux.ts:153-223) |
| `formatMultiAgentOperatorStatus(status)` | Human panels (Exact outputs below) (src/multi-agent-operator-ux.ts:225-251) |
| `formatMultiAgentDependencies/Failures/Evidence(rows)` | Panel renderers; list caps 80/40/60 rows with a `... N more` tail (src/multi-agent-operator-ux.ts:253-263,464-494) |

Evidence rows have `status` in `adopted|rejected|pending|superseded|conflicting|missing` (rank order 0..5 for sorting) and an operator `disposition`: `adopted`, or `blocking` when the status blocks (`missing|pending|conflicting`) and no verifier-gated commit exists yet, else `inspectable` (src/multi-agent-operator-ux.ts:446-461,535-537). Status normalization: any `rejectedBy` → `rejected`; `adoptedBy` present → `adopted` unless the raw status is `missing|conflicting|superseded` (src/multi-agent-operator-ux.ts:516-521).

Failure row kinds (each with an exact reason and next command): `missing-role-coverage`, `agent-role`, `agent-membership`, `missing-worker`, `worker`, `worker-output`, `fanin`, `missing-role-evidence`, `missing-membership-evidence`, `missing-topology-evidence`, `topology`, the feedback record's own `classification`, `candidate`, `candidate-score-gap`, `candidate-verifier-gap`, `selection`, `ambiguous-dependency`, `commit-gate` (src/multi-agent-operator-ux.ts:318-362).

Graph relabeling in the operator graph: no label → `depends-on`; `blackboard`/`task` → `depends-on`; `dispatch` → `dispatches`; `reported`/`result`/`message` → `reports`; `evidence` → `cites` (src/multi-agent-operator-ux.ts:551-558).

### I. Eval replay harness (`src/multi-agent-eval.ts`, `src/multi-agent-eval/{normalize,format}.ts`)

| Export | Does |
|---|---|
| `createMultiAgentReplaySnapshot(run, options)` | Default id `` `${run.id}-snapshot` `` (safe-file-named). Writes `snapshot.json` (kind `"multi-agent-replay-snapshot"`) plus `suite.json` (one case, `expectedVerdict: "pass"`) under `<run.cwd>/.cw/evals/<id>/` (src/multi-agent-eval.ts:285-326) |
| `replayMultiAgentSnapshot(target, options)` | Default id `` `${snapshot.id}-replay` ``. RE-DERIVES the normalized projection from the raw baseline run state (`loadRunStateFile(statePath, { dryRun: true })` + the same `normalizeRun`); never copies the baseline. Writes `replay-run.json` (kind `"multi-agent-replay-run"`, status `"completed"`, `errors: []`) and updates the suite (src/multi-agent-eval.ts:328-367,634-644) |
| `compareMultiAgentReplay(baselineTarget, replayTarget)` | For all 31 metric sections: equal iff `replayStableStringify(baseline)` === `replayStableStringify(replay)`; unequal sections mint a finding `{id: "regression-<section>", severity: "error", category: <section>, reason: "<Title> changed between baseline and replay."}`. Writes `comparison.json` + `findings.json` (src/multi-agent-eval.ts:369-422) |
| `scoreMultiAgentReplay(target)` | One point per metric; status `"pass"` iff no metric failed; writes `score.json` (src/multi-agent-eval.ts:450-487) |
| `gateMultiAgentEval(target)` | Requires `snapshot.json`, `replay-run.json`, `comparison.json`, `score.json` to exist; rejects stale comparison/score artifacts; verdict `"ship"` iff score passed and no error findings, else `"hold"`; writes `gate.json` (src/multi-agent-eval.ts:489-529) |
| `reportMultiAgentEval(target)` | Writes `report.md` with the fixed section layout (Exact outputs) and updates the suite (src/multi-agent-eval.ts:531-613) |
| `normalizeValue(value)` | Recursive: sorts object keys; drops keys `createdAt, updatedAt, recordedAt, selectedAt, replayedAt, generatedAt`; keys ending `Path`, or named `path`/`cwd`/`runDir`, or ending `Dir` are stringified and scrubbed (src/multi-agent-eval/normalize.ts:9-26) |
| `lines(value)` | normalize → per-entry `replayStableStringify` → sorted string array (src/multi-agent-eval/normalize.ts:37-41) |
| `replayStableStringify(value)` | `JSON.stringify(normalizeValue(value))` (src/multi-agent-eval/normalize.ts:43-45) |
| `formatMultiAgentEval(value)` | Human renderer keyed off the value shape (gate/score/comparison/replay/snapshot/report), else pretty JSON (src/multi-agent-eval/format.ts:21-172) |

String scrubbing (`normalizeString`): `/[0-9]{8}T[0-9]{6}Z/g` → `<timestamp>`; ISO stamps `/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g` → `<timestamp>`; `\/[^"\s]+\/\.cw\/runs\/[^"\s/]+` → `<run-dir>`; the same over `.cw/evals/` → `<eval-dir>`; `/var/folders/...|/tmp/...|/private/tmp/...` → `<tmp>` (src/multi-agent-eval/normalize.ts:28-35).

The 31 metrics, in order (src/multi-agent-eval.ts:237-283): `replay_completed`, `graph_parity`, `role_parity`, `group_parity`, `membership_parity`, `fanout_parity`, `fanin_parity`, `dependency_parity`, `failure_parity`, `blackboard_record_parity`, `evidence_adoption_parity`, `trust_audit_parity`, `role_policy_parity`, `permission_decision_parity`, `policy_violation_parity`, `blackboard_provenance_parity`, `judge_rationale_parity`, `panel_decision_parity`, `candidate_score_parity`, `selection_parity`, `verifier_commit_gate_parity`, `report_parity`; then (v0.1.25, optional sections) `summary_freshness`, `compact_graph_parity`, `blackboard_digest_parity`, `critical_path_parity`, `evidence_digest_parity`, `expansion_ref_integrity`; then (v0.1.26) `reasoning_freshness`, `reasoning_chain_parity`, `reasoning_unexplained_parity`. Only the first 22 sections are required by shape checks; the later 9 default to `[]` on old snapshots (src/multi-agent-eval.ts:262-283,814-823).

### J. CLI verbs and MCP tools mapped onto this layer

CLI (via the orchestrator router, contract stated in the man pages): `multi-agent run|status|step|blackboard|score|select`, `multi-agent summary|graph|show|role|group|membership|fanout|fanin`, `multi-agent dependencies|failures|evidence|status`, `topology list|show|validate|apply|summary|graph`, `blackboard summary|graph|resolve|topic create|message post|message list|context put|artifact add|artifact list|snapshot`, `coordinator summary|decision`, `candidate register|score|rank|select`, `eval snapshot|replay|compare|score|gate|report`, `audit multi-agent|policy|role|blackboard|judge` (docs/multi-agent-cli-mcp-surface.7.md:28-104, docs/multi-agent-runtime-core.7.md:161-205, docs/coordinator-blackboard.7.md:119-156, docs/candidate-scoring.7.md:28-33, docs/multi-agent-eval-replay-harness.7.md:33-56, docs/multi-agent-trust-policy-audit.7.md:96-103). MCP mirrors: `cw_multi_agent_run/status/step/blackboard/score/select/graph/dependencies/failures/evidence`, `cw_multi_agent_summary`, `cw_multi_agent_*_show`, `cw_multi_agent_run_create/run_transition/role_create/group_create/membership_create/fanout_create/fanin_collect`, `cw_topology_list/show/validate/apply/summary/graph`, `cw_blackboard_*`, `cw_coordinator_summary/decision`, `cw_eval_snapshot/replay/compare/score/gate/report`, `cw_audit_multi_agent/policy/role/blackboard/judge` (same man pages). Env vars: none read by any file in this subsystem.

---

## Exact outputs

### Envelope: `MultiAgentHostResponse` (all host commands, `--json` and MCP)

```json
{
  "schemaVersion": 1,
  "surface": "multi-agent-host",
  "command": "run|status|step|blackboard|score|select",
  "runId": "...",
  "state": "needs-run|ready-for-dispatch|awaiting-worker-output|ready-for-fanin|ready-for-scoring|ready-for-selection|ready-for-commit|blocked|failed|complete",
  "performed": "...",
  "nextAction": "...",
  "nextActions": [{ "command": "...", "reason": "...", "priority": "high|normal|low" }],
  "blockedReasons": [],
  "requiredHostAction": "...",
  "evidenceRequirements": [],
  "ids": {
    "topologyRunIds": [], "topologyIds": [], "multiAgentRunIds": [], "blackboardIds": [],
    "topicIds": [], "groupIds": [], "roleIds": [], "fanoutIds": [], "faninIds": [],
    "candidateIds": [], "selectionIds": [], "commitIds": [], "auditEventIds": []
  },
  "paths": {
    "statePath": "...", "reportPath": "...", "blackboardIndexPath": "...",
    "auditSummaryPath": "...", "auditEventLogPath": "...", "candidateRankingPath": "...",
    "workerManifestPaths": [], "workerResultPaths": []
  },
  "summaries": { "topologies": {}, "multiAgent": {}, "multiAgentOperator": {}, "blackboard": {}, "workers": {}, "candidates": {}, "feedback": {}, "commits": {}, "trust": {} },
  "data": null
}
```
(src/multi-agent-host.ts:57-96,513-565)

Host `performed` values: `"applied-topology"`, `"attached-topology"`, `"none"`, `"collected-fanin"`, `"collected-blocked-fanin"`, `"created-dispatch-manifest"`, `"created-blackboard-snapshot"`, `"registered-candidate"`, `"scored-candidate"`, `"selected-candidate"`, `"read-blackboard"`, `"posted-message"`, `"added-artifact"`, `"put-context"`, `"created-snapshot"` (src/multi-agent-host.ts:114,131-252,261-322).

Host next-action commands, per state (src/multi-agent-host.ts:607-640):

```text
needs-run:            node scripts/cw.js multi-agent run <runId> --topology map-reduce
ready-for-dispatch:   node scripts/cw.js multi-agent step <runId>
awaiting-worker-output: node scripts/cw.js worker output <runId> <worker-id> <result.md>
ready-for-fanin:      node scripts/cw.js multi-agent step <runId>
ready-for-scoring:    node scripts/cw.js multi-agent score <runId> --candidate <candidate-id> --criterion correctness=1 --evidence <path-or-ref>
ready-for-selection:  node scripts/cw.js multi-agent select <runId> --candidate <candidate-id> --reason "<rationale>"
ready-for-commit:     node scripts/cw.js commit <runId> --selection <selectionId> --reason "<verified rationale>"
complete:             node scripts/cw.js report <runId> --show
failed/blocked:       node scripts/cw.js multi-agent status <runId>
```

When `requiredHostAction` is set the single next action is `{ "command": "host-action", "reason": <requiredHostAction>, "priority": "high" }` (src/multi-agent-host.ts:614).

### Host error strings (thrown)

```text
Ambiguous active topology state: <id>, <id>
Run <run-id> has no active multi-agent topology. Use multi-agent run --topology <id>.
Run <run-id> has no blackboard. Use multi-agent run --topology <id> first.
Ambiguous blackboard state: <board-id>, <board-id>
Blackboard <blackboard-id> has no topics
Ambiguous blackboard topic state: <topic-id>, <topic-id>
Usage: multi-agent blackboard <run-id> [summary|topics|messages|post|artifacts|add-artifact|context|snapshot]
multi-agent score requires --candidate or --worker when a single candidate cannot be inferred
Candidate <candidate-id> score requires evidence
Candidate <candidate-id> judge score requires rationale
multi-agent select requires a scored candidate
Candidate <candidate-id> selection requires accepted judge rationale with evidence
Unknown candidate id for run <run-id>: <id>
Missing score criteria. Use --criterion name=value
Missing <label>
```
(src/multi-agent-host.ts:324,340,342,346,404,409,714,733,739-741,750-751,762-763,809,868)

### Kernel error strings (thrown)

```text
Duplicate MultiAgentRun id: <id>
Duplicate AgentRole id: <id>
Duplicate AgentGroup id: <id>
Duplicate AgentMembership id: <id>
Duplicate AgentFanout id: <id>
Duplicate AgentFanin id: <id>
Duplicate AgentMembership for group=<g>, role=<r>, task=<t>, worker=<w-or-none>
Unknown MultiAgentRun id: <id>
Unknown AgentRole id: <id>
Unknown AgentGroup id: <id>
Unknown AgentFanout id: <id>
Unknown task id for multi-agent record: <id>
Unknown worker id for membership: <id>
Invalid MultiAgentRun lifecycle transition: <from> -> <to>
Cannot complete MultiAgentRun <id>: <reason>; <reason>
AgentRole <role> belongs to <run-a>, not group run <run-b>
Membership multiAgentRunId <id> does not match group <group-id>
AgentGroup <group> does not belong to <multi-agent-run>
Group <group> does not belong to MultiAgentRun <id>
Role <role> does not belong to MultiAgentRun <id>
Fanout <fanout> does not belong to group <group>
Fanout <fanout> does not match MultiAgentRun <id> and group <group>
Dispatch multi-agent attach requires --multi-agent-group or --multiAgentGroup
Dispatch multi-agent attach requires exactly one role for deterministic membership; found <n>
Task <task-id> has no worker id for multi-agent membership
<Label> ids <a> and <b> collide on safe file name <safe>
```
(src/multi-agent.ts:235,388,450,529,600,782,526,1037,1043,1049,1055,1061,517; src/multi-agent/helpers.ts:33,96; src/multi-agent.ts:348,510,513,598,688/779,694,780,708,687,691,712)

Fanin blocked-reason strings (stored in `blockedReasons`, surfaced everywhere):

```text
required role <role-id> has no membership
membership <membership-id> has not reported required evidence
membership <membership-id> has no indexed blackboard evidence
fanin <fanin-id> status is <blocked|failed>
fanin <fanin-id> is not verifier-ready
group <group-id> has no fanin record
```
(src/multi-agent.ts:805-806,817,338-339,344)

`summarizeMultiAgent().nextAction` (in order): no runs → `` node scripts/cw.js multi-agent run <run-id> --id <multi-agent-run-id> ``; any blocked reason → `` node scripts/cw.js multi-agent fanin <run-id> --group <group-id> --fanout <fanout-id> ``; a running membership with a worker → `` node scripts/cw.js worker manifest <run-id> <worker-id> ``; a group with memberships and no fanin → `` node scripts/cw.js multi-agent fanin <run-id> --group <group-id> ``; else absent (src/multi-agent.ts:1122-1131).

Fanout default `expectedReturnShape`:

```text
Each member writes a Markdown result with a cw:result JSON fence containing summary, findings, and evidence.
```
(src/multi-agent.ts:621). Topology fanouts instead use `` `${definition.title} worker output must include cw:result evidence and blackboard-indexable artifacts/messages.` `` (src/topology.ts:282).

### Topology error strings and outputs

```text
Unknown topology id: <id>                       (validation issue, code unknown-topology)
Topology must declare at least one role.        (code missing-roles, path roles)
Topology must declare at least one group.       (code missing-groups, path groups)
Topology must declare blackboard topics.        (code missing-topics, path blackboardTopics)
Topology must declare required evidence.        (code missing-evidence, path requiredEvidence)
Phase <phase> references unknown role <role>.   (code unknown-phase-role, path phases.<phase>)
Invalid topology <id>: <message>; <message>     (thrown by applyTopology)
Duplicate MultiAgentTopologyRun id: <id>
Unknown task id for topology: <id>
Unknown topology run id: <id>
```
(src/topology.ts:195-207,213,226,490,452)

Apply-time blackboard message body: `` `${definition.title} topology applied. Roles=${roleIds.join(", ")} fanout=${fanout.id}.` `` — coordinator decision: kind `"context-update"`, outcome `"accepted"`, reason `` `${definition.title} topology materialized on multi-agent runtime and blackboard.` `` (src/topology.ts:287-304). Topology-run `status` is `"blocked"` if the initial fanin blocked, else `"planned"`; `missingEvidence` = the fanin's blocked reasons or, with no initial fanin, the definition's `requiredEvidence` (src/topology.ts:338,353). `nextActions` (exact, src/topology.ts:533-539):

```text
node scripts/cw.js dispatch <run-id> --multi-agent-fanout <fanout-id>
node scripts/cw.js multi-agent fanin <run-id> <topology-run-id>-fanin --fanout <fanout-id>
node scripts/cw.js topology summary <run-id>
```

`summarizeTopologies` per-run derived fields: `status` becomes `"ready"` if any inferred fanin is verifier-ready, else `"blocked"` if any is blocked; `readiness` is `"fanin ready"` | `"missing evidence"` | `"awaiting worker output"`; when ready `nextActions` = `[ "node scripts/cw.js candidate register <run-id> --result-node <reducer-or-panel-result>" ]`; summary `nextAction` falls back to `` node scripts/cw.js topology apply <run-id> map-reduce --task <task-id> `` (src/topology.ts:395-428).

### Coordinator error strings

```text
Duplicate Blackboard id: <id>
Duplicate BlackboardTopic id: <id>
Duplicate BlackboardMessage id: <id>
Duplicate BlackboardContext id: <id>
Duplicate BlackboardArtifactRef id: <id>
Duplicate CoordinatorDecision id: <id>
Unknown Blackboard id: <id>
Unknown BlackboardTopic id: <id>
Unknown BlackboardContext id: <id>
Unknown BlackboardArtifactRef id: <id>
Unknown BlackboardMessage id: <id>
Unknown parent BlackboardMessage id: <id>
Blackboard message body is required
Blackboard artifact requires --path or --locator
Topic <topic-id> does not belong to blackboard <board-id>
Blackboard author requires an explicit id
Blackboard scope requires kind and id
```
(src/coordinator/util.ts:22-24; src/coordinator.ts:1057-1089,312-315,572,576,991,998)

Coordinator decision reasons written by the layer itself:

```text
Accepted <kind> context <ctx-id>
Context <ctx-id> conflicts with <id>, <id>
Indexed <kind> artifact <artifact-id>
```
(src/coordinator.ts:519-521,619)

`summarizeBlackboard` fields: `{ runId, blackboardId, topics, messages, contexts, artifacts, snapshots, decisions, openQuestions, conflicts, missingEvidence, readyForFanin, latestSnapshotPath, indexPath, nextAction }`. `missingEvidence` rows (sorted): `` question <ctx-id> has no indexed evidence `` and `` context <ctx-id> has no indexed evidence ``. `readyForFanin` is true only when a board exists, there are no open questions, no conflicts, at least one artifact, and no missing evidence (src/coordinator.ts:800-831). `nextAction` (in order): no board → `` node scripts/cw.js blackboard topic create <run-id> --id <topic-id> --title "<title>" ``; conflicts → `` node scripts/cw.js coordinator decision <run-id> --kind conflict-resolution --outcome accepted --subject <ctx-id> --reason "<reason>" ``; open questions → `` node scripts/cw.js blackboard message post <run-id> --topic <topic-id> --body "<answer with evidence>" ``; no artifacts → `` node scripts/cw.js blackboard artifact add <run-id> --path <path> --kind <kind> ``; else `` node scripts/cw.js blackboard snapshot <run-id> `` (src/coordinator.ts:1129-1135).

Graph node id patterns (all graphs): run root `<run-id>:run`; multi-agent run `<run-id>:multi-agent:<id>`; role/group/membership/fanout/fanin `<run-id>:multi-agent:role|group|membership|fanout|fanin:<id>`; topology `<run-id>:topology:<id>`; blackboard `<run-id>:blackboard:<id>`; topic/context/artifact/message/snapshot `<run-id>:blackboard:topic|context|artifact|message|snapshot:<id>`; decision `<run-id>:coordinator:decision:<id>`; task `<run-id>:task:<id>`; dispatch `<run-id>:dispatch:<id>`; worker `<run-id>:worker:<id>`; candidate node `<run-id>:candidate:<safe-id>:<stage>` (src/multi-agent/graph.ts:24-65; src/coordinator.ts:1100-1104; src/topology.ts:436-446; src/candidate-scoring.ts:512,543). Message labels in graphs are the body truncated at 64 chars to 61 + `"..."` (src/coordinator/util.ts:80-82).

### Trust denial reasons (thrown by `assertMultiAgentActionAllowed`, and stored in audit metadata)

```text
missing role authority or policy
topic <topic-id> is outside policy <policyRef>
candidate operation <op> is outside policy <policyRef>
judge operation <op> is outside policy <policyRef>
blackboard write operation <op> is outside policy <policyRef>
operation <op> requires evidence refs: <ref>, <ref>
<denied-operation reason>                        (verbatim from policy.deniedOperations)
```
Allowed reason: `allowed by explicit multi-agent policy` (src/multi-agent-trust.ts:440-458,163-167). `policyRef` formats: `multiAgent.roles.<id>.policy`, `multiAgent.groups.<id>.policy`, `multiAgent.memberships.<id>.policy`, `multiAgent.runs.<id>.policy`, `multiAgent.fanouts.<id>.policy`, `multiAgent.fanins.<id>.policy` (src/multi-agent-trust.ts:46,78,110; src/multi-agent.ts:266,628,849).

`summarizeMultiAgentTrust().nextAction`: with violations `` node scripts/cw.js audit policy <run-id> ``, else `` node scripts/cw.js audit multi-agent <run-id> --json `` (src/multi-agent-trust.ts:390-393).

### Candidate scoring exact outputs

Verdicts: `pass` (normalized >= `0.7`), `warn` (>= `0.4`), `fail` (below, or below `minNormalized`) (src/candidate-scoring.ts:32-33,722-727). Selection failure messages (joined with `"; "` in the thrown error):

```text
Candidate <id> is <rejected|failed>
Candidate <id> requires a verified verifier node
Candidate <id> verifier node has no evidence
Candidate <id> verifier node has no real evidence (empty-capture result)
Candidate <id> score is below threshold
Review gate blocked (<status>): <missing>; <missing>
Candidate <id> score requires evidence
Unknown candidate for run <run-id>: <candidate-id>
```
(src/candidate-scoring.ts:307,311,313,319,323,198,503; src/collaboration.ts:480)

`ranking.json` shape: `{ schemaVersion: 1, runId, createdAt, policy: { id: "cw.candidate.default", title: "Default Candidate Scoring", requireEvidence, requireVerifierGate, minNormalized, tieBreaker }, candidates: [{ candidateId, status, scoreCount, bestScoreId, normalized, verdict, rank }], ties: [[...], ...] }` — `rank` is 1-based; the default policy id/title are exact (src/candidate-scoring.ts:266-285,705-720).

### Collaboration exact outputs

Review-state `missing` strings:

```text
rejected by <actor-id> (<rationale>)
<n> more approval(s) from authorized role(s) [<roles>] required (have <recorded>/<required>)
<n> self-approval(s) ignored (policy forbids self-approval)
<n> unattributed approval(s) ignored
<n> approval(s) from unauthorized role(s) ignored
```
(src/collaboration.ts:437,441,445-447). Gate error message: `` Review gate blocked (<status>): <missing joined "; "> `` with code `review-gate-missing-approvals` (src/collaboration.ts:478-480). Other thrown strings: `Comment body is required`, `Handoff requires a to-actor (--to)`, `Collaboration target requires a kind and id`, `` Unknown collaboration target kind: <kind> `` (src/collaboration.ts:221,262,747,749).

`formatReviewStatus` layout (src/collaboration.ts:678-700):

```text
review <run-id>  policy=<n> from [<roles>] on [<kinds>]        (or policy=none)
  owner: <id> (<attestation>)
  counts: approvals=<n> rejections=<n> comments=<n> handoffs=<n>
  <kind> <id>: <status> (<recorded>/<required> by <a,b>)        (or " (not gated)")
    - <missing note>
  timeline:
    <createdAt>  <actor-id>  <summary>
```

`formatCommentList`: `no comments` when empty, else one line per comment: `` <createdAt>  <actor-id> (<attestation>)  [<kind> <id>]  <body> `` (src/collaboration.ts:702-707).

### Operator UX human output (`formatMultiAgentOperatorStatus`)

```text
Multi-Agent Operator Status: <run-id>
Active Runs: <ids or none>
Topologies: <topology-ids or none> (<topology-run-ids or none>)
Blocked: yes|no

Agent Graph
  roles=<n>; groups=<n>; memberships=<n>; fanout=<n>; fanin=<n>

Dependencies
  [<status>] <from> -> <to> (<label>): <reason>
  ... <n> more                                  (over 80 rows)

Failed / Blocked Agents
  [<status>] <kind> <id> owner=<o> linked=<l>: <reason>; next=<command>
  ... <n> more                                  (over 40 rows)

Adopted Evidence
  [<status>] <id> <ref> source=<kind>:<id> rationale=<s> disposition=inspectable adoptedBy=<a> rejectedBy=<r> pending=<p>
  ... <n> more                                  (over 60 rows)

Missing Evidence                                (header grows to
  "Missing Evidence (blocking=<n>, inspectable=<n>; a verifier-gated commit decided the selection — inspectable rows are not failures)"
  when inspectable rows exist)

Next Action
  <command>
```
Empty panels print `  none` (src/multi-agent-operator-ux.ts:225-251,464-494).

### Eval harness exact outputs

Thrown strings:

```text
Missing eval target
Not a replay snapshot: <path>
Not a replay run: <path>
Replay snapshot missing id: <file>
Replay snapshot missing runId: <file>
Replay snapshot missing paths.suiteDir or paths.snapshotPath: <file>
Replay snapshot missing normalized section: <file>; <key> must be an array
Replay run missing id: <file>
Replay run missing snapshotId: <file>
Replay run has unsupported status <status>: <file>
Replay run missing paths.suiteDir, paths.replayRunPath, or paths.snapshotPath: <file>
Replay run errors must be an array: <file>
Cannot re-derive replay projection: baseline run state missing at <path>; re-snapshot from a live run before replaying.
Cannot re-derive replay projection: baseline run state at <path> is unsupported: <errors>
Eval gate missing required artifact(s): <path>, <path>
Eval gate found stale comparison artifact for <path>; rerun eval compare <snapshot> <replay>
Eval gate found stale score artifact for <replay-id>; rerun eval score <replay-path>
```
(src/multi-agent-eval.ts:863,771,779,793-798,803-811,637,641,496,500,503)

Comparison section fields: `{ id, status: "pass"|"fail", baselineRef: "<snapshot-path>#/normalized/<section>", replayRef: "<replay-run-path>#/replay/<section>", reason: "<Title> matches."|"<Title> changed." }`. Gate `nextAction`: with failures `Review regression findings, update replay rationale if the change is intentional, then rerun eval gate.` else `Eval replay gate passed; include artifacts in release evidence.` (src/multi-agent-eval.ts:380-397,525).

`report.md` starts `# Multi-Agent Eval Replay Report` and has exactly these `##` sections in order: `Eval Suite`, `Replay Status`, `Graph Comparison`, `Evidence Comparison`, `Trust / Policy / Audit Comparison`, `Candidate Score Comparison`, `Selection / Commit Gate`, `State Explosion Summaries`, `Evidence Adoption Reasoning Chain`, `Regression Findings`, `Final Verdict` (`PASS`/`FAIL`), `Next Action` (`Use this replay as release-gate evidence.` / `Fix or explicitly classify the changed behavior before release.`). Metric lines are `` - <metric-id>: <status> - <reason> `` (src/multi-agent-eval.ts:536-599,891-894).

Human panels from `formatMultiAgentEval` (all shapes): `Eval Suite`, `Replay Status`, then per shape — score adds `Graph Comparison`, `Evidence Comparison`, `Trust / Policy / Audit Comparison`, `Candidate Score Comparison`, `Selection / Commit Gate`, `State Explosion Summaries`, `Regression Findings`, `Final Verdict`, `Next Action`; metric items print `<id>=<status>` joined by `"; "` (src/multi-agent-eval/format.ts:21-172).

### Exit codes

These modules signal failure by throwing; the CLI wrapper maps an uncaught error to a non-zero exit and stderr text (the exit-code mechanics belong to the cli-surface spec). No function here calls `process.exit`.

---

## Files on disk

All JSON files are written by `writeJson`: atomic temp-file + rename, content `JSON.stringify(value, null, 2)` plus one trailing newline (src/state.ts:140-152). File names pass `safeFileName` = replace `/[^a-zA-Z0-9_.:-]+/g` with `_` (src/state.ts:310-312).

```text
.cw/runs/<run-id>/state.json                  # holds run.multiAgent, run.blackboard, run.topologies,
                                              # run.candidates, run.candidateSelections, run.collaboration
.cw/runs/<run-id>/multi-agent/
  index.json                                  # { schemaVersion, runId, counts{runs,roles,groups,memberships,fanouts,fanins},
                                              #   runs/roles/groups/memberships/fanouts/fanins: [{id,status,updatedAt}] }
  runs/<id>.json  roles/<id>.json  groups/<id>.json
  memberships/<id>.json  fanouts/<id>.json  fanins/<id>.json
.cw/runs/<run-id>/topologies/
  index.json                                  # { schemaVersion, runId, counts:{runs}, runs:[{id,topologyId,status,updatedAt}] }
  runs/<topology-run-id>.json
.cw/runs/<run-id>/blackboard/
  index.json                                  # counts + per-kind index rows + message rows
                                              #   {id,blackboardId,topicId,createdAt,status,author,evidenceRefs,artifactRefIds}
  messages.jsonl                              # one JSON message per line, sorted by createdAt then id,
                                              #   trailing "\n" only when non-empty (plain writeFileSync, NOT atomic)
  topics/<id>.json  contexts/<id>.json  artifacts/<id>.json
  snapshots/<id>.json  decisions/<id>.json
.cw/runs/<run-id>/candidates/
  index.json                                  # { schemaVersion, runId, candidates:[...projected...], selections:[full records] }
  ranking.json
  <candidate-id>/candidate.json
  <candidate-id>/scores/<score-id>.json
  selections/<selection-id>.json
.cw/evals/<suite-id>/                          # rooted at run.cwd for snapshot; process.cwd() fallback for lookups
  suite.json  snapshot.json  replay-run.json  comparison.json
  findings.json  score.json  gate.json  report.md
  replay/                                      # isolated replay workspace dir (created, may stay empty)
```
(src/multi-agent.ts:170-230; src/topology.ts:139-163,525-531; src/coordinator.ts:169-174,887-932; src/coordinator/paths.ts:14-38; src/candidate-scoring.ts:480-485,596-627,733-752; src/multi-agent-eval.ts:285-335,373-374,452,491-494,527,538,600,866-871)

Example multi-agent `index.json`:

```json
{
  "schemaVersion": 1,
  "runId": "demo-run",
  "counts": { "runs": 1, "roles": 2, "groups": 1, "memberships": 2, "fanouts": 1, "fanins": 1 },
  "runs": [{ "id": "mar-0001", "status": "verifying", "updatedAt": "2026-07-03T00:00:00.000Z" }],
  "roles": [], "groups": [], "memberships": [], "fanouts": [], "fanins": []
}
```

Collaboration records have no dedicated directory: they live only inside `state.json` and persist through `saveCheckpoint` (src/collaboration.ts:790-793).

---

## Invariants and error behavior

1. **Fail closed on identity.** Every duplicate id, unknown id, cross-run mismatch, and path-collision throws before any state is written (`persist*` runs only after all checks) (src/multi-agent.ts:235-529; src/coordinator/util.ts:22-36).
2. **Lifecycle table.** `MultiAgentRun` transitions only along: `planned → forming|running|failed|cancelled`; `forming → running|failed|cancelled`; `running → collecting|completed|failed|cancelled`; `collecting → verifying|completed|failed|cancelled`; `verifying → completed|failed|cancelled`; `completed|failed|cancelled →` nothing. A same-status transition is a no-op check (allowed) but still appends a lifecycle event and audit (src/multi-agent/helpers.ts:84-97; src/multi-agent.ts:302-330).
3. **Completion gate.** A run cannot go `completed` while any fanin has blocked reasons, is `blocked`/`failed`, or is not verifier-ready, or while a group with memberships/fanouts has no fanin record. On success, completion cascades to owned records (skipping records already terminal) (src/multi-agent.ts:332-382).
4. **Fanin never assumes.** A membership counts as reported only when status is `reported`/`verified` AND it carries at least one evidence ref (src/multi-agent/helpers.ts:116-118). When any blackboard is in scope, each required membership must also have at least one indexed blackboard message or artifact ref. Otherwise the fanin is `blocked`, `verifierReady:false`, and its policy denies `candidate.select` with the blocked reasons (src/multi-agent.ts:808-860).
5. **Trust check before write.** Blackboard writes by agent-scoped authors run `assertMultiAgentActionAllowed` BEFORE the record is created; a denial throws and records both `multi-agent.permission` (denied) and `policy.violation` events, so denied writes never mutate blackboard state (src/coordinator.ts:320-336,462-475,581-594; src/multi-agent-trust.ts:197-216,228-232).
6. **Judge chain.** A judge score through the host needs rationale + evidence; the rationale audit is `accepted` only with both; selection under a role/membership authority needs a prior accepted `judge.rationale` event for that candidate (src/multi-agent-host.ts:344-373,406-423; src/multi-agent-trust.ts:354,396-407).
7. **Selection gate.** Verifier node must be `verified`, with evidence, not empty-capture; score must meet `minNormalized` when set; the review gate (when policy applies to `selection`) stacks ON TOP and can only add errors. All failures become ErrorFeedback and set the candidate `failed` (src/candidate-scoring.ts:305-353).
8. **Review gate fail-closed.** Only distinct, attested-enough, authorized, non-self, non-superseded approvals count; a veto rejects; policy off (absent or `requiredApprovals` 0 or kind not in `appliesTo`) means `approved`/not gated (src/collaboration.ts:330-423,469-493).
9. **Append-only collaboration.** Records are only pushed; a correction is a new record with `supersedes`; the superseded record stays on disk and is reported as disqualified `"superseded"` (src/collaboration.ts:176-214,337-352).
10. **Context conflicts are loud.** A same-key different-value context marks BOTH records `conflicting`, links them both ways, and records a `conflict-resolution` decision with outcome `conflicting` — never a silent overwrite (src/coordinator.ts:476-529).
11. **Determinism of ids.** All record ids are position-based (`prefix-NNNN`) or content-hash (topology run id); no wall clock, no randomness, so replays mint byte-identical ids (src/multi-agent/ids.ts; src/topology.ts:559-570; src/candidate-scoring.ts:754-776; src/collaboration.ts:783-788).
12. **Candidate files validated on read.** `candidate.json` and score files pass `validateCandidateRecord`/`validateCandidateScore` before entering memory; a corrupt file throws (fail closed) instead of flowing into ranking or selection (src/candidate-scoring.ts:164-170,629-653).
13. **Eval gate anti-staleness.** The gate refuses a comparison whose `paths.baselinePath` is not the suite's `snapshot.json` and a score whose `replayId`/`comparisonPath` do not match; replay re-derives the projection from raw state and throws when the baseline state file is missing or unsupported — it never falls back to copying the baseline (src/multi-agent-eval.ts:499-504,634-644).
14. **Atomicity.** All per-record JSON writes are temp+rename atomic; `messages.jsonl` is the one plain `writeFileSync` (rewritten whole each persist, sorted, so it is deterministic but not atomic) (src/state.ts:140-152; src/coordinator.ts:926).
15. **Secrets never persist.** All blackboard/decision metadata passes the recursive scrub; audit rationale is truncated to 240 chars; message provenance stores a hash + 120-char summary, not the body (src/coordinator/util.ts:93-115; src/multi-agent-trust.ts:319-327,371).

Status → state-node mapping (multi-agent side): `completed|reported|ready → completed`; `running|forming|collecting|verifying|assigned|active|dispatched → running`; `blocked → blocked`; `failed → failed`; `cancelled|rejected → rejected`; else `pending` (src/multi-agent/helpers.ts:58-82). Coordinator side differs: `active|open → running`; `resolved|superseded → completed`; `conflicting → blocked`; `rejected → rejected`; **default → completed** (src/coordinator/classify.ts:11-26).

---

## Edge cases

- `ensureMultiAgentState`/`ensureBlackboardState` normalize old or partial state: missing arrays become `[]`, `schemaVersion` is stamped to 1, dirs are created — old v0.1.16/v0.1.17 runs load clean (src/multi-agent.ts:176-194; src/coordinator.ts:175-186; docs/multi-agent-runtime-core.7.md:211-229).
- `registerCandidate` with an id that already exists returns the stored record unchanged (idempotent re-register) (src/candidate-scoring.ts:101-102).
- `listCandidates` merges disk over memory per id, so records written by another process win (src/candidate-scoring.ts:148-157,792-800).
- `attachDispatchToMultiAgent` with none of the four ids is a silent no-op returning `{ membershipIds: [] }` (src/multi-agent.ts:681).
- `recordMultiAgentWorkerOutput` with no matching membership returns `[]` without writing (src/multi-agent.ts:918-921).
- `collectAgentFanin` sets group/run status straight to `verifying`/`collecting` without the lifecycle-transition check — it can pull a `completed` group back (src/multi-agent.ts:865-869).
- The `unique()` helper in `multi-agent/helpers.ts` and `coordinator/util.ts` de-dupes, drops falsy, and **sorts**; the `unique()` copies in `topology.ts`, `candidate-scoring.ts`, and `multi-agent-host.ts` do **not** sort. Sorted arrays are therefore part of the record shapes (e.g. `roleIds`, `topicIds`) but not of host id lists (src/multi-agent/helpers.ts:136-138; src/coordinator/util.ts:72-74; src/topology.ts:578-580; src/candidate-scoring.ts:828-830; src/multi-agent-host.ts:877-879).
- `applyTopology` accepts `debateRounds` on every surface (CLI, MCP, host) but never uses it; a debate run always mints exactly one instance of each role (src/topology.ts:48; src/multi-agent-host.ts:110).
- `judgeCount` is floored at 2 (a panel never collapses to one judge) while an explicit `roleCounts.judge` can still set 1 (src/topology.ts:460-469).
- `hostStep` snapshots the blackboard only when the board has no snapshot yet — the branch runs at most once per board (src/multi-agent-host.ts:185-189).
- `hostRun` attaches to an existing non-terminal topology of the same `topologyId` instead of applying twice (src/multi-agent-host.ts:101-102).
- Host summaries are memoized per call to avoid re-deriving ~11 full-state summaries; the cache never crosses calls (src/multi-agent-host.ts:461-511).
- Message reply linking: `replyToId` must exist and is folded into `parentIds` (src/coordinator.ts:312-343).
- `createBlackboardSnapshot` sorts all id lists, so two snapshots over the same state are byte-comparable (src/coordinator.ts:678-682).
- `deriveReviewState`: approvals are processed in `createdAt`-then-`id` order; only the first approval per actor id counts (a second one is silently not counted, not disqualified) (src/collaboration.ts:348-368).
- A `reject` with disqualify reason `self-approval` still counts as a veto (self-rejection blocks); a reject from an unattributed/unauthorized actor is disqualified (src/collaboration.ts:354-358).
- Approval and rejection ids share the `state.approvals.length` counter, so `collab-approval-0001` followed by a rejection mints `collab-rejection-0002` (src/collaboration.ts:199).
- `multi-agent-operator-ux.ts` carries its own `safeFileName` that also replaces `:` (charset `[a-zA-Z0-9._-]`), unlike `state.ts` which keeps `:` — score paths read there differ for ids with colons (src/multi-agent-operator-ux.ts:547-549; src/state.ts:310-312).
- Old eval snapshots without the v0.1.25/v0.1.26 sections load fine: `assertNormalizedShape` only requires the first 22 sections; comparison treats a missing optional section as `[]` (src/multi-agent-eval.ts:814-823,444-447).
- `eval score` and `eval report` self-heal: a missing or mismatched `comparison.json`/`score.json` is recomputed from the suite dir instead of failing (src/multi-agent-eval.ts:615-625,825-834).
- Eval target resolution: a directory target means `<dir>/snapshot.json` or `<dir>/replay-run.json`; a non-file target falls back to `process.cwd()/.cw/evals/<safeFileName(target)>/...` (src/multi-agent-eval.ts:836-859).
- `parseCriteria` accepts a structured object, repeated `name=value` strings, or a bare `total`; non-numeric values are dropped silently (src/multi-agent-host.ts:792-811).
- `normalizeValue` stringifies path-like keys even when `undefined` (producing `"undefined"`); replays reproduce this byte-for-byte (src/multi-agent-eval/normalize.ts:19-21).

---

## Evidence

Every claim above carries its pointer inline. Key anchors: kernel create/transition/fanin (src/multi-agent.ts:232-902), lifecycle table (src/multi-agent/helpers.ts:84-97), id scheme (src/multi-agent/ids.ts:15-17), record paths (src/multi-agent/paths.ts:12-18), graph (src/multi-agent/graph.ts:20-68), official topologies (src/topology.ts:58-137), topology apply pipeline (src/topology.ts:210-390), deterministic topology-run id (src/topology.ts:559-570), blackboard ops (src/coordinator.ts:189-932), scrub (src/coordinator/util.ts:93-115), classifiers (src/coordinator/classify.ts:11-45), paths (src/coordinator/paths.ts:14-38), policies and evaluation (src/multi-agent-trust.ts:39-467), candidate lifecycle (src/candidate-scoring.ts:95-459), verdict thresholds (src/candidate-scoring.ts:32-33), review gate (src/collaboration.ts:330-493), host loop (src/multi-agent-host.ts:98-458), host state machine (src/multi-agent-host.ts:567-640), operator model (src/multi-agent-operator-ux.ts:110-462), eval pipeline (src/multi-agent-eval.ts:285-644), normalization (src/multi-agent-eval/normalize.ts:9-45), human eval formatter (src/multi-agent-eval/format.ts:21-172). Contract docs: docs/multi-agent-runtime-core.7.md, docs/multi-agent-topologies.7.md, docs/coordinator-blackboard.7.md, docs/multi-agent-trust-policy-audit.7.md, docs/candidate-scoring.7.md, docs/multi-agent-cli-mcp-surface.7.md, docs/multi-agent-operator-ux.7.md, docs/multi-agent-eval-replay-harness.7.md, docs/team-collaboration.7.md.

---

## Pinned by tests

- `test/multi-agent-runtime-core-smoke.js` — kernel records, lifecycle, fanin fail-closed.
- `test/multi-agent-topologies-map-reduce-smoke.js`, `test/multi-agent-topologies-debate-smoke.js`, `test/multi-agent-topologies-judge-panel-smoke.js` (+ `test/topology-smoke-helper.js`) — the three built-in topologies end to end.
- `test/coordinator-blackboard-smoke.js` — boards, topics, messages, contexts (conflict/supersede), artifacts, snapshots, decisions, persistence layout.
- `test/multi-agent-trust-policy-audit-smoke.js` — role policies, allowed/denied writes, provenance, judge rationale, policy violations, CLI/MCP parity.
- `test/candidate-scoring-smoke.js` — register/score/rank/select/reject, gates, file layout.
- `test/team-collaboration-smoke.js` and `test/collaboration-ops-unit-smoke.js` — actors, approvals, review gate math, formatters.
- `test/multi-agent-cli-mcp-surface-smoke.js` — the host loop (`run`/`status`/`step`/`blackboard`/`score`/`select`), ambiguity failures, evidence failures, parity.
- `test/multi-agent-operator-ux-smoke.js` — graph, dependencies, failures, evidence adoption, report, MCP parity.
- `test/multi-agent-eval-replay-harness-smoke.js`, `test/multi-agent-eval-replay-smoke.js`, `test/multi-agent-eval-determinism-regression-smoke.js`, `test/cli-handler-eval-node-smoke.js` — snapshot/replay/compare/score/gate/report, determinism moat (including the intrinsic-nondeterminism case).
- `test/pdca-blackboard-loop-smoke.js` — the three-role blackboard app over this substrate.
- `test/blackboard-state-explosion-management-smoke.js` — the summarize/digest layer the eval metrics feed on.

---

## Rebuild risks

1. **Two different `unique()` semantics.** The kernel/coordinator helper sorts; the topology/candidate/host copies do not. Rebuilding with one shared sorted helper changes host id ordering and eval parity lines; one shared unsorted helper changes every persisted record (`roleIds`, `topicIds`, ...). Both must be kept as-is (src/multi-agent/helpers.ts:136-138 vs src/multi-agent-host.ts:877-879).
2. **Deterministic ids.** `prefix-NNNN` (position-based, 4-digit, zero-padded) and the 16-hex-char content-hash topology-run id must be byte-identical, or replay digests, snapshot parity, and audit chains all break (src/multi-agent/ids.ts; src/topology.ts:559-570).
3. **Fanout role filter by suffix.** Collector roles are excluded from fanout by the id endings `-reducer`, `-synthesizer`, `-panel-chair` — not by a flag on the role. A rebuild keyed on role position or a `count` field will fan out the wrong set (src/topology.ts:273).
4. **Chair/judge detection by substring.** Trust policy strength comes from lowercased `topologyRoleId`/title containing `chair|reducer|synthesizer|judge`. Renaming a role changes its authority (src/multi-agent-trust.ts:40-42).
5. **The replay must RE-DERIVE, never copy.** Copying `snapshot.normalized` into the replay makes the determinism gate false-green; the rebuild must reload the baseline state file and re-run the same projection, failing closed when it cannot (src/multi-agent-eval.ts:328-367,634-644).
6. **Evidence-of-report rule.** `isMembershipReported` needs BOTH a reported/verified status AND a non-empty `evidenceRefs`; and fanin adds the indexed-blackboard-evidence rule only when a blackboard is in scope. Getting either half wrong flips fanin readiness (src/multi-agent/helpers.ts:116-118; src/multi-agent.ts:808-819).
7. **Two `statusToNodeStatus` tables with different defaults** (`pending` vs `completed`) and the operator-graph `relabel` map — collapsing them changes graph output and eval `dependency_parity` (src/multi-agent/helpers.ts:58-82; src/coordinator/classify.ts:11-26; src/multi-agent-operator-ux.ts:551-558).
8. **Verdict and gate constants.** `0.7`/`0.4` thresholds, `maxTotal` default `max(total,1)`, the shared `emptyCaptureWarning` between selection and commit, and the review gate stacking (append-only, never replacing verifier errors) are load-bearing; any drift lets a false-green through (src/candidate-scoring.ts:32-33,201,314-321,330-336).
9. **Normalization keys and regexes.** The exact dropped-key list and the four scrub regexes define snapshot compatibility; a changed regex makes every old snapshot fail parity (src/multi-agent-eval/normalize.ts:18-35).
10. **Judge rationale acceptance is data-driven.** `accepted` iff evidenceRefs non-empty AND rationale set; `hasAcceptedJudgeRationale` matches events with no `scoreId` against any score filter. A stricter match breaks host `select` under judge authority (src/multi-agent-trust.ts:354,396-407).
