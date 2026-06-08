# Changelog

## 0.1.25

- Added State Explosion Management: a derived, versioned, provenance-backed
  summarization and compaction layer for large multi-agent runs.
- Added durable summary records (`MultiAgentSummaryIndex`,
  `BlackboardSummaryRecord`, `GraphSummaryRecord`, `OperatorDigest`,
  `StateExplosionReport`) under `.cw/runs/<run-id>/summaries/`. Raw blackboard,
  graph, audit, and evidence records are never deleted or overwritten.
- Added `blackboard summarize` (deterministic blackboard digest), `multi-agent
  summarize`, `summary refresh`, `summary show`, and compact/focused graph views
  via `multi-agent graph --view <view> [--focus <id>] [--depth <n>]`. Compact
  views collapse high-volume records into synthetic summary nodes that expose
  collapsed counts, source ids, dominant status, blocked reason, and an
  expansion command. The critical path, failures, missing evidence, policy
  violations, and judge rationale are never hidden.
- Summaries are stale-aware and fail closed: `summary show` recomputes the
  source fingerprint and reports `stale` when source records change.
- Added MCP parity: `cw_summary_refresh`, `cw_summary_show`,
  `cw_blackboard_summarize`, `cw_multi_agent_summarize`, and
  `cw_multi_agent_graph_compact`, all returning source refs and expansion hints.
- Eval/replay now captures and regression-gates summary artifacts with new
  metrics: `summary_freshness`, `compact_graph_parity`,
  `blackboard_digest_parity`, `critical_path_parity`, `evidence_digest_parity`,
  and `expansion_ref_integrity`. Pre-0.1.25 snapshots load with empty summary
  sections, preserving backward compatibility.
- Summary generation is recorded in the trust-audit log (`summary.refresh`,
  `summary.stale`) without storing secrets or large raw message bodies.
- The run report now includes a `## State Size & Compaction` section, and
  `report --show` appends the state-explosion panels.
- Added `docs/state-explosion-management.7.md` and
  `test/state-explosion-management-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.24

- Added a robustness hardening pass for state loading, migrations, MCP tool
  calls, multi-agent persistence, blackboard persistence, and eval/replay
  artifact parsing.
- State JSON parse failures now include deterministic file-path context, and
  migrations fail closed when known fields are present with unsupported shapes
  instead of silently replacing malformed data.
- MCP `tools/call` now rejects malformed argument payloads and missing required
  arguments with actionable operator errors.
- Multi-agent and blackboard plain-file mirrors now reject safe-file-name id
  collisions before persistence.
- Eval/replay commands now validate snapshot, replay, and baseline artifact
  shape before scoring or comparing.
- Added `test/robustness-hardening-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.23

- Added Multi-Agent Eval & Replay Harness with deterministic replay snapshots,
  isolated replay runs, normalized comparison, scoring, fail-closed gate, and
  markdown reports under `.cw/evals/<suite-id>/`.
- Added CLI commands: `eval snapshot`, `eval replay`, `eval compare`,
  `eval score`, `eval gate`, and `eval report`, each with deterministic JSON
  through `--json` or `--format json`.
- Added MCP parity tools: `cw_eval_snapshot`, `cw_eval_replay`,
  `cw_eval_compare`, `cw_eval_score`, `cw_eval_gate`, and `cw_eval_report`.
- Added replay metrics for graph, dependencies, evidence adoption,
  trust/policy/audit, policy violations, blackboard provenance, judge
  rationale, candidate scoring, selection, verifier-gated commit readiness, and
  report parity.
- Added `npm run eval:replay`, `docs/multi-agent-eval-replay-harness.7.md`,
  and `test/multi-agent-eval-replay-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.22

- Added Multi-Agent Trust / Policy / Audit on top of the existing trust-audit
  layer, with role policies, permission decisions, blackboard write audit,
  message provenance, judge rationale, panel decisions, and policy violations.
- Added policy-aware fail-closed checks for blackboard writes, candidate
  scoring/selection, missing evidence, and missing judge rationale.
- Added focused CLI views: `audit multi-agent`, `audit policy`, `audit role`,
  `audit blackboard`, and `audit judge`, with deterministic JSON output.
- Added MCP parity tools: `cw_audit_multi_agent`, `cw_audit_policy`,
  `cw_audit_role`, `cw_audit_blackboard`, and `cw_audit_judge`.
- Integrated multi-agent trust projections into status/report/audit operator
  views and preserved existing v0.1.21 multi-agent operator UX commands.
- Added `docs/multi-agent-trust-policy-audit.7.md` and
  `test/multi-agent-trust-policy-audit-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.21

- Added Multi-Agent Operator UX as a derived read-only model over WorkflowRun,
  topology, multi-agent, blackboard, candidate, commit, feedback, and trust
  audit state.
- Added focused CLI views: `multi-agent dependencies`, `multi-agent failures`,
  and `multi-agent evidence`, plus a fuller `multi-agent graph` for operator
  inspection.
- Added `summaries.multiAgentOperator` to the high-level
  `multi-agent status --json` host envelope and extended MCP parity with
  `cw_multi_agent_dependencies`, `cw_multi_agent_failures`, and
  `cw_multi_agent_evidence`.
- Added evidence adoption tracing from worker output through blackboard/fanin,
  candidate score, selection, and verifier-gated commit records.
- Added compact failure rows for missing role coverage, missing worker output,
  failed/rejected workers, open feedback, fanin blockers, score/selection gaps,
  verifier gaps, and commit gate readiness.
- Added `docs/multi-agent-operator-ux.7.md` and
  `test/multi-agent-operator-ux-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.20

- Added the high-level Multi-Agent CLI + MCP Surface for the host loop:
  `multi-agent run -> status -> step -> blackboard -> score -> select`.
- Added JSON-first CLI responses and MCP tools:
  `cw_multi_agent_run`, `cw_multi_agent_status`, `cw_multi_agent_step`,
  `cw_multi_agent_blackboard`, `cw_multi_agent_score`, and
  `cw_multi_agent_select`.
- Composed the host surface over existing topology, multi-agent, blackboard,
  candidate, commit, and audit primitives without replacing the kernel state
  model.
- Added fail-closed handling for ambiguous topology/blackboard state, incomplete
  fanin, missing score evidence, unscored candidates, and unsafe selection.
- Added host-friendly blackboard operations with provenance-preserving message,
  artifact, context, and snapshot actions.
- Added `docs/multi-agent-cli-mcp-surface.7.md` and
  `test/multi-agent-cli-mcp-surface-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.19

- Added Multi-Agent Topologies as official userland recipes over Multi-Agent
  Runtime Core and Coordinator / Blackboard.
- Added typed topology contracts and durable topology run records under
  `.cw/runs/<run-id>/topologies/`.
- Added official `map-reduce`, `debate`, and `judge-panel` definitions with
  roles, groups, blackboard topics, phases, fanout/fanin strategy, required
  evidence, coordinator decision expectations, candidate expectations, and
  verifier gates.
- Added `cw topology list|show|validate|apply|summary|graph` plus MCP parity
  through `cw_topology_*` tools.
- Added Topologies panels to `status` and `report --show`, topology graph
  nodes/edges, trust-audit topology event counts, and evidence provenance links
  through generated multi-agent and blackboard records.
- Preserved fail-closed fanin behavior for missing mapper evidence, debate
  messages/decisions, and judge-panel evidence.
- Added `docs/multi-agent-topologies.7.md` and
  `test/multi-agent-topologies-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.18

- Added Coordinator / Blackboard as the shared coordination substrate for future
  debate, judge, map-reduce, swarm, committee, and synthesis topologies.
- Added durable `Blackboard`, `BlackboardTopic`, `BlackboardMessage`,
  `BlackboardContext`, `BlackboardArtifactRef`, `BlackboardSnapshot`, and
  `CoordinatorDecision` records with schema versions, stable ids, timestamps,
  authorship, scope, status, parent refs, tags, metadata, and cross-links.
- Added `.cw/runs/<run-id>/blackboard/` storage with deterministic
  `index.json`, append-friendly `messages.jsonl`, and per-record JSON mirrors
  for topics, contexts, artifacts, snapshots, and decisions.
- Added explicit conflicting context handling, artifact indexing, snapshot
  creation, coordinator decisions, ready-for-fanin summaries, Operator UX
  panels, graph nodes/edges, and report output.
- Added CLI and MCP parity for blackboard summary, topics, messages, context
  frames, artifacts, snapshots, coordinator summary, and coordinator decisions.
- Linked Multi-Agent Runtime records, worker manifests, accepted worker output,
  fanin evidence coverage, trust audit events, candidates, commits, and reports
  to blackboard provenance.
- Added migration normalization so older runs load with empty blackboard state
  while preserving unknown user data.
- Added `docs/coordinator-blackboard.7.md` and
  `test/coordinator-blackboard-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.17

- Added Multi-Agent Runtime Core with durable `MultiAgentRun`, `AgentRole`,
  `AgentGroup`, `AgentMembership`, `AgentFanout`, and `AgentFanin` records.
- Added lifecycle validation for multi-agent runs and fail-closed membership,
  duplicate assignment, and missing fanin evidence handling.
- Added dispatch attachment so workers can carry multi-agent run, group, role,
  membership, and fanout metadata without replacing existing dispatch flows.
- Added multi-agent Operator UX panels, graph nodes/edges, report sections,
  trust audit events, and evidence provenance for membership output and fanin.
- Added CLI and MCP parity for multi-agent summary, graph, show, create,
  lifecycle transition, fanout, and fanin collection operations.
- Added fixture compatibility normalization so older runs load with empty
  multi-agent state while preserving unknown user data.
- Added `docs/multi-agent-runtime-core.7.md` and
  `test/multi-agent-runtime-core-smoke.js`, included in `npm test` and
  `npm run release:check`.

## 0.1.16

- Added `npm run dogfood:release`, a dry-run release proof that uses the
  canonical `release-cut` app against the real Cool Workflow repository.
- Added real command evidence collection for git state, version surfaces,
  release docs, build/package checks, type checks, tests, fixture
  compatibility, canonical apps, golden path, `release:check`, and trust audit
  inspection.
- Added release candidate registration, evidence-backed scoring,
  verifier-gated selection, and verifier-gated CW state commit/checkpoint
  handling for the dogfood workflow.
- Added fail-closed release action gating so tag, push, and publish requests
  require explicit execute flags and target-version confirmation.
- Added `test/dogfood-release-smoke.js` and included it in `npm test` and
  `npm run release:check`.
- Added `docs/dogfood-one-real-repo.7.md` and updated README, Getting Started,
  release checklist, docs index, skill instructions, version surfaces, and
  generated runtime output.

## 0.1.15

- Added durable trust audit records under `.cw/runs/<run-id>/audit/` with
  append-friendly `events.jsonl` plus deterministic `index.json` and
  `summary.json`.
- Added worker sandbox audit coverage for selected profiles, policy snapshots,
  allowed output paths, denied out-of-profile paths, command/network/env
  validation decisions, feedback links, and host attestations.
- Added optional evidence provenance on `StateEvidence` while preserving
  backward compatibility for older run state.
- Added acceptance rationale for selected candidates and verifier-gated commits:
  candidate, score, criteria, verifier, evidence count, sandbox profile, worker,
  and commit gate result.
- Added CLI and MCP audit tools for summaries, worker audit, provenance,
  attestations, and policy decisions.
- Added `docs/security-trust-hardening.7.md` and
  `test/security-trust-hardening-smoke.js`.

## 0.1.14

- Added explicit run-state migration policy with `src/state-migrations.ts`,
  current schema/version constants, compatibility reports, and dry-run
  `state check` support.
- Added fixture-based backward compatibility coverage under
  `test/fixtures/runs/` for pre-app state, Sandbox Profiles, Workflow App SDK,
  Golden Path, Operator UX, and v0.1.13 MCP/App Surface runs.
- Added `npm run fixture-compat`, `npm run version:sync`, and the dry-run
  `npm run release:check` release gate.
- Centralized CW runtime version metadata at `0.1.14` and checks package,
  plugin, SDK, MCP, canonical app, test, docs, and `dist/` surfaces.
- Added docs index, Getting Started, and `docs/release-and-migration.7.md` in
  the spirit of operational `UPDATING` guidance.

## 0.1.13

- Completed the MCP / App Surface so agent hosts can run Workflow App SDK apps,
  inspect workers, record worker output, score/rank/select candidates, resolve
  sandbox profiles, create verifier-gated commits, and read operator summaries.
- Added `cw_app_run`, structured operator tools, worker tools, candidate tools,
  `cw_sandbox_choose`/`cw_sandbox_resolve`, and `cw_commit_summary` while
  preserving existing MCP tool names.
- Updated `cw_commit` MCP responses with top-level gate metadata, evidence
  counts, snapshot path, linked verifier/candidate/selection ids, and next
  actions.
- Added deterministic MCP stdio smoke coverage in
  `test/mcp-app-surface-smoke.js` and included it in `npm test`.
- Added `docs/mcp-app-surface.7.md` plus README, SDK, Operator UX, golden path,
  Unix principles, and skill documentation updates.
- Bumped package, plugin manifest, canonical app, SDK, and MCP server versions
  to `0.1.13`.

## 0.1.12

- Added Operator UX read-only summaries in `src/operator-ux.ts`.
- Made CLI `status` human-readable by default while preserving
  `status --json`, `status --format json`, `runner.status()`, and MCP
  `cw_status` structured output.
- Added top-level `graph <run-id>` with `--json` and kept `node graph`
  compatible.
- Added console report views with `report <run-id> --show` and `--summary`.
- Added human and JSON resource summaries for workers, candidates, feedback,
  and commits, including gated commit/checkpoint visibility.
- Added deterministic next-step recommendations for dispatch, worker output,
  feedback, candidate scoring/selection, verifier-gated commit, and report.
- Added `docs/operator-ux.7.md`, documentation updates, and
  `test/operator-ux-smoke.js`.
- Bumped package, plugin, canonical app, SDK, and MCP versions to `0.1.12`.

## 0.1.11

- Added canonical Workflow App SDK apps: `architecture-review`,
  `pr-review-fix-ci`, `release-cut`, and `research-synthesis`.
- Migrated the public `architecture-review` and `research-synthesis` ids into
  first-class app directories and renamed workflow-file compatibility wrappers
  to `legacy-architecture-review` and `legacy-research-synthesis`.
- Added `npm run canonical-apps`, a deterministic local matrix that validates,
  shows, and plans every canonical app with representative inputs.
- Added `test/canonical-workflow-apps-smoke.js` and included it in `npm test`.
- Updated canonical app docs, SDK docs, skill instructions, release metadata,
  MCP server version, and generated `dist/` files for `0.1.11`.

## 0.1.10

- Added the first-class `end-to-end-golden-path` Workflow App SDK app with one
  evidence-required readonly worker task.
- Added `npm run golden-path`, a deterministic Node standard-library runner
  that exercises app validation, planning, dispatch, worker isolation,
  `cw:result` recording, verifier nodes, candidate scoring/ranking/selection,
  verifier-gated commit, and report generation.
- Added durable golden path assertions for app metadata, sandbox policy,
  verified workers, result/verifier nodes, candidate records, score/ranking
  files, commit gate metadata, report content, and absence of ErrorFeedback.
- Added `test/end-to-end-golden-path-smoke.js` and included it in `npm test`.
- Documented the golden path release discipline and updated package, plugin, and
  MCP server versions to `0.1.10`.

## 0.1.9

- Added Workflow App SDK with `defineWorkflowApp`, `workflow`, `phase`,
  `agent`, `artifact`, and `input` helpers in `workflow-app-sdk`.
- Added durable workflow app metadata for schema version, id, title, summary,
  version, author, inputs, sandbox profiles, compatibility, and metadata.
- Added fail-closed app/workflow validation for ids, required fields, semver,
  inputs, limits, phases, duplicate task ids, evidence flags, sandbox profile
  references, and compatibility constraints.
- Added deterministic discovery for legacy `workflows/*.workflow.js` files and
  first-class `apps/<app-id>/app.json` app directories.
- Added CLI commands for `app list`, `app show`, `app validate`, `app init`,
  and `app package`.
- Added MCP tools `cw_app_list`, `cw_app_show`, `cw_app_validate`,
  `cw_app_init`, and `cw_app_package`.
- Added SDK app templates and the runnable `workflow-app-sdk-demo` example.
- Added app id/version/source metadata to run state, status summaries, and
  reports.
- Added smoke coverage for legacy planning, SDK app validation, invalid app
  failures, app CLI commands, sandbox hints, and app metadata.

## 0.1.8

- Added Sandbox Profiles as named, durable worker policy contracts.
- Added bundled `default`, `readonly`, `workspace-write`, and `locked-down`
  profiles with deterministic path normalization and traversal rejection.
- Added resolved sandbox policy data to worker scopes, worker manifests,
  dispatch manifests, run state, reports, and ErrorFeedback metadata.
- Added CLI commands for `sandbox list`, `sandbox show`, and `sandbox validate`.
- Added `dispatch --sandbox <profile-id>` and matching MCP sandbox tools.
- Preserved legacy `allowedPaths` as the effective write-path compatibility
  field.
- Added `sandbox-profiles.7.md` and smoke coverage for profile validation,
  manifests, CLI commands, and denied worker output feedback.

## 0.1.7

- Added Verifier-Gated Commit as a first-class commit path.
- Added commit metadata for `verifierGated`, checkpoint status, verifier nodes,
  candidate ids, selection ids, and verifier evidence.
- Made CLI commits fail closed unless `--verifier`, `--candidate`,
  `--selection`, or `--allow-unverified-checkpoint` is supplied.
- Added ErrorFeedback and error-node records for blocked commit attempts.
- Kept non-gated internal snapshots compatible as explicit checkpoints.
- Updated reports to distinguish verifier-gated commits from checkpoints.
- Added verifier-gated commit docs and smoke coverage.

## 0.1.6

- Added Candidate Scoring records for competing worker outputs.
- Added candidate registration, scoring, ranking, selection, rejection, and
  summary CLI commands.
- Added verifier-gated candidate selection with ErrorFeedback records for
  missing evidence or failed selection gates.
- Added candidate run state paths, report summaries, docs, and smoke coverage.

## 0.1.5

- Added Worker Isolation as an explicit boundary around dispatched task work.
- Added worker scope allocation, durable worker manifests, worker-local
  `input.md`, `result.md`, `artifacts/`, and `logs/` paths.
- Added worker CLI commands for listing, showing, manifest inspection, output
  recording, failure recording, and boundary validation.
- Connected worker output to result nodes, verifier nodes, ErrorFeedback, and
  report summaries.
- Added worker failure preservation for missing results and invalid output
  boundaries.
- Added `worker-isolation.7.md` and smoke coverage for worker manifests,
  accepted output, failed output, and CLI worker commands.

## 0.1.4

- Added ErrorFeedback as durable diagnostic and correction state for failed
  workflow operations.
- Added feedback records with status, severity, classification, source, code,
  retryability, evidence, artifacts, and resolution metadata.
- Added feedback collection from failed StateNode errors and pipeline failures.
- Added correction-task generation under run task files and verifier-gated
  feedback resolution.
- Added CLI and MCP surfaces for feedback list, show, collect, task, and
  resolve operations.
- Added `error-feedback.7.md`, report feedback sections, and smoke coverage for
  classification, tasking, resolution, and rejected corrections.

## 0.1.3

- Added Pipeline Runner as the contract-driven StateNode execution kernel.
- Added runnable pipeline-stage discovery and stage execution for the default
  `input -> plan -> dispatch -> result -> verify -> commit -> report` flow.
- Added contract-aware output node creation, parent/child linking, artifact and
  evidence attachment, and structured failure preservation.
- Added `contract show`, `node list`, `node show`, and `node graph` inspection
  commands.
- Added verifier-gated commit-stage handling while keeping non-gated snapshots
  as completed checkpoint nodes.
- Added `pipeline-runner.7.md` and smoke coverage for legal stage advancement,
  graph inspection, and preserved failure nodes.

## 0.1.2

- Added StateNode as the durable JSON representation for meaningful CW runtime
  transitions.
- Added PipelineContract as the ABI between workflow state, artifacts,
  evidence, verifier gates, and commit/report stages.
- Added explicit state-node creation, legal status transitions, parent/child
  linking, structured node errors, and contract validation.
- Added node and contract arrays to run state while keeping older runs readable
  through loader defaults.
- Added input, task, dispatch, result, verifier, commit, report, and error node
  kinds for inspectable workflow history.
- Added `state-node.7.md` and smoke coverage for node creation, transition
  validation, evidence requirements, and commit-gate invariants.

## 0.1.1

- Added `/loop`-compatible CLI shortcut via `cw.js loop`.
- Added local desktop scheduler daemon support with `schedule daemon`.
- Added scheduled-task pause, resume, run-now, and history commands.
- Added routine-style API and GitHub trigger bridge.
- Added MCP tools for new schedule controls and routine triggers.
- Reframed CW as an Agent Workflow SDK for developer workflows.
- Switched project license to BSD-2-Clause.
- Added Unix-inspired workflow principles for state, pipelines, isolation, and verifier-gated commits.

## 0.1.0

- Added TypeScript COL-Architecture runtime.
- Added explicit `interpret -> act -> observe -> adjust -> checkpoint` state
  machine.
- Added subagent dispatch manifests, deterministic harness prompts, evidence
  gates, adversarial verification, and state commit snapshots.
- Added MCP JSON-RPC 2.0 bridge.
- Added scheduled tasks for loop, cron, and reminder workflows.
- Added public package structure for GitHub distribution.
