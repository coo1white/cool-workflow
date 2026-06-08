# Changelog

## 0.1.35

- Added Node Snapshot / Diff / Replay: per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness and v0.1.25 fingerprint/freshness pattern

## 0.1.34

- Added Real Execution Backend Integrations: container/remote/ci backends really drive docker/podman, a remote runner, and a CI job — opt-in, fail-closed, byte-stable evidence vs node

## 0.1.33

- Added Release Tooling: one-command version bump across every surface plus a per-feature scaffolder, and a de-duplicated release gate
- Architecture pass — same fail-closed discipline applied to the build itself:
  - `dist/` drift gate: `dist:check` snapshots `dist/`, rebuilds, and fails closed
    if the output differs (git-independent, so a consistent uncommitted tree is not
    punished); CI also fails on committed drift via `git status --porcelain`. Wired
    into `release:check` as the `dist freshness` gate.
  - Smoke runner: the 30-deep `&&` chain in `npm test` is replaced by a
    discovery-based runner (`test/run-all.js`) that isolates each smoke in its own
    process, continues past failures with per-file PASS/FAIL reporting, and fails
    closed on a smoke that exists on disk but was never wired in (which surfaced
    `multi-agent-eval-replay-smoke.js`, silently dropped from the old chain).
    `test:fast` opts into parallelism.
  - `types.ts` (3095 lines) split into domain files under `src/types/` behind a
    barrel; every importer keeps importing `./types` and the exported surface is
    byte-identical.
  - `orchestrator.ts` decomposed: report rendering and CLI option parsing extracted
    into `src/orchestrator/report.ts` and `src/orchestrator/cli-options.ts`.

## 0.1.32

- Added Team Collaboration: the human-decision layer on top of the existing
  verifier-gated runtime. A host-attested `Actor`, append-only approvals,
  rejections, comments, and handoffs, and a review gate that STACKS ON the verifier
  gate. Before v0.1.32 there was no review/approval/comment/handoff/identity
  concept; the foundations (trust-audit `actor`, candidate `selectedBy`, role
  policies, verifier-gated commits) already existed, and this release layers on top
  of them without changing them.
- IDENTITY IS ATTESTED, NOT AUTHENTICATED. An `Actor` is host-attested provenance
  (`host-attested`/`operator-recorded`), never an authenticated principal — CW is
  not an auth server. An absent identity is the explicit `unattributed` actor
  (`{ kind: "unattributed", attested: false }`), never a fabricated one;
  unattributed approvals surface honestly and never count. Extends the trust-audit
  `actor` field and the v0.1.29/v0.1.31 attestation pattern.
- APPEND-ONLY, PROVENANCE-LINKED. `approve`/`reject`/`comment add`/`handoff` append
  records to `run.collaboration` (additive/optional state; pre-v0.1.32 runs load
  unchanged) and link each to a `collaboration.*` trust-audit event. The approved
  artifact is NEVER edited in place — "who approved what" is a provenance link, not
  a field overwrite; a correction is a NEW record via `supersedes`. "Who approved
  which candidate/commit" is answered from the records.
- REVIEW GATES STACK ON THE VERIFIER GATE; THEY NEVER BYPASS IT. `reviewGateErrors`
  runs INSIDE `resolveCommitGate` (and `selectCandidate`) AFTER the verifier checks
  and can only ADD a required-approvals constraint. An approval can never turn an
  unverified result into a committed one. A gate-satisfied commit is stamped with a
  `CommitReviewProvenance` recording WHO approved the very artifact that shipped.
- FAIL CLOSED ON AUTHORITY AND QUORUM. `deriveReviewState` counts only distinct,
  attested, authorized, non-self approvals; short of `requiredApprovals` the status
  is `pending`/`blocked`/`unattributed`/`rejected` and the commit is BLOCKED, the
  failure recording exactly which approvals are missing. Self-approval, quorum,
  authorized roles, and attestation requirements are configurable POLICY as data
  (`review policy`), default off (`requiredApprovals: 0`).
- COLLABORATION IS STATE, NOT CHAT. Comments attach to a durable target
  (`run|task|candidate|selection|commit|node`); a handoff is an explicit ownership
  transfer (from-actor → to-actor, reason) and the current owner is DERIVED from the
  latest handoff, never overwritten. A `ReviewStatusReport` exposes per-target
  review state and a chronological timeline.
- ONE SOURCE, EVERY SURFACE. `approve`, `reject`, `comment add|list`, `handoff`,
  `review status`, and `review policy` are declared once in the capability registry,
  so `cw <cmd> --json` is identical to `cw_<tool>` (read-only `review status`/
  `comment list` proven byte-for-byte by the payload-identity probe). The v0.1.30
  Workbench renders a read-only review/collaboration panel; the v0.1.31 metrics
  report adds derived approval-rate, time-to-approval, handoff-count, and
  reviewer-count from recorded timestamps (deterministic over a fixed snapshot).

## 0.1.31

- Added Observability + Cost Accounting: a derived per-run report
  (`cw metrics show`) and cross-repo rollup (`cw metrics summary`) covering
  time/duration, failure rate, verifier pass rate, candidate acceptance rate, and
  token/cost. The metrics are a DERIVED PROJECTION of existing durable run state —
  timestamps → durations, verifier nodes → pass rate, candidates → acceptance
  rate, failed workers/memberships/feedback → failure rate. There is NO metrics
  database, NO background collector daemon, and NO hidden counter, following the
  v0.1.25 state-explosion and v0.1.28 registry discipline.
- COST IS ATTESTED, NEVER MEASURED OR FABRICATED. CW does not call the model; the
  host/worker does. An additive, optional `UsageRecord` is accepted on the
  EXISTING result/worker intake path (`cw result ... --usage-input-tokens N
  --usage-output-tokens M --usage-model ID`, and likewise `cw worker output`) and
  recorded verbatim as host-attested provenance on the task/worker record — never
  on `ResultEnvelope`, which stays stable. Absent usage is an explicit
  `unreported`, never 0. Cost is `attested` only when derived from attested usage
  × a recorded pricing policy with an exact model match; default/fallback pricing
  is a SEPARATE `estimated` figure, and the two are never conflated. `unpriced`
  (attested usage, no policy) and `unreported` (no usage) are surfaced with
  coverage.
- A COUNTER YOU CANNOT TRUST IS WORSE THAN NONE. Every rate is a `RateMetric` with
  `state` (`ok`/`n/a`), `count`, `total`, `rate`, and per-bucket sample counts; a
  rate over zero samples is `n/a` with null count/rate — never a fabricated
  0%/100%. Durations come from recorded timestamps (`dispatchedAt`→`completedAt`,
  worker `createdAt`→output `recordedAt`, run `createdAt`→`updatedAt`); in-flight
  items are marked explicitly with a null duration.
- DETERMINISTIC & REPLAYABLE. `deriveMetricsReport(run, { now, policy })` is a
  PURE function; wall-clock `now` is injected (the only now-derived field is
  `generatedAt`), so a report over a fixed snapshot is byte-reproducible
  (eval/replay agnostic). The per-run report persists a rebuildable, fingerprinted
  snapshot under `.cw/runs/<id>/metrics/`; the cross-repo summary reports each
  run's snapshot freshness as `valid|stale|absent` against current source — fail
  closed.
- MECHANISM VS POLICY. The runtime records attested usage and derives
  rates/durations; the pricing table is POLICY supplied as DATA (`CostPolicy`),
  kept out of the kernel. A bundled EXAMPLE policy lives at
  `manifest/pricing.policy.json`; `--pricing <path>|default` selects one. The same
  attested usage yields different cost under different pricing without touching the
  runtime.
- ONE SOURCE, EVERY SURFACE. `metrics.show` and `metrics.summary` are declared in
  `src/capability-registry.ts`, so `cw <cmd> --json` is byte-identical to
  `cw_<tool>` (now-derived `generatedAt` neutralized by the parity probe, which
  gains `metrics.show`/`metrics.summary` probes). The v0.1.30 Workbench renders a
  new read-only metrics panel from the same payload, showing coverage and
  `unreported`/`n/a` honestly.
- BACKWARD COMPATIBLE, ADDITIVE. Usage/cost fields are additive and optional; old
  runs load and report `unreported` cost while still yielding correct time and
  rate metrics from their existing timestamps and outcomes. The run-state and
  `ResultEnvelope` schemas are unchanged (run-state schema version stays 1).
- Docs: `docs/observability-cost-accounting.7.md` (added to `docs/index.md`).
  Tests: `test/observability-cost-accounting-smoke.js` proving durations from
  recorded timestamps, correct rates with sample counts, `n/a` on zero samples,
  attested-vs-estimated cost separation, `unreported` surfaced with coverage,
  determinism over a fixed snapshot, and `cw <cmd> --json` == `cw_<cmd>`; wired
  into `npm test`, `release:check`, and `parity:check`.

## 0.1.30

- Added the Web / Desktop Workbench: a human-facing console rendering a run's
  five operator surfaces — run graph, blackboard, worker logs, candidate compare,
  and audit timeline — plus a cross-run entry point over the v0.1.28 Run Registry.
  It is a THIRD FRONT DOOR alongside the CLI (human speed) and MCP (machine
  context): all three are presentation policy over ONE mechanism (the kernel +
  durable `.cw/` state).
- NO HIDDEN DASHBOARD. The Workbench holds ZERO authoritative state. It is a
  stateless, read-only RENDERER over the durable `.cw/` files and existing
  capability payloads; refresh re-derives everything from disk, and deleting the
  host loses nothing — the data IS the files. The view models in `src/types.ts`
  (`WorkbenchRunView`, `WorkbenchPanel`, `WorkbenchServeDescriptor`) are DERIVED
  projections that embed existing payloads; no run/state schema is forked.
- ONE MECHANISM, THREE RENDERINGS. `src/workbench.ts` assembles every panel by
  calling the SAME capability core entries the CLI/MCP route through. Each
  `workbench.view` panel equals its underlying `cw <cmd> --json` payload
  byte-for-byte, parity-gated via a new `workbench.view` probe in
  `scripts/parity-check.js`. The Workbench can show nothing the CLI/MCP cannot.
- New declared capabilities `workbench.view` and `workbench.serve`
  (`src/capability-registry.ts`), CLI `cw workbench view|serve`, and MCP tools
  `cw_workbench_view` / `cw_workbench_serve`. `cw_workbench_serve` returns the
  serve descriptor only (an MCP stdio host cannot start a blocking server) — the
  single declared, documented payload divergence; the descriptor itself is
  identical across surfaces.
- LEAST PRIVILEGE, LOCAL BY DEFAULT. The optional host (`src/workbench-host.ts`)
  binds `127.0.0.1` ONLY, is read-only (every route is `GET`; writes are refused
  `405`), rejects non-localhost `Host` headers (`403`, a DNS-rebinding defense)
  and path traversal (`403`), and fails closed on unreadable/stale state.
- OPTIONAL SURFACE. The Workbench (and its dependency-light static UI under
  `ui/workbench/`) is not a required dependency of the SDK: the committed `dist/`
  and a plain `node` runtime keep working with it absent. The kernel imports the
  Workbench never; the Workbench imports the kernel. No heavy frontend framework
  enters the runtime package.
- Docs: `docs/web-desktop-workbench.7.md` (added to `docs/index.md`). Tests:
  `test/web-desktop-workbench-smoke.js` (panel parity, read-only/localhost host,
  freshness honesty, SDK-without-Workbench), wired into `npm test`,
  `release:check`, `parity:check`, and `version:sync`. No run-state schema change;
  no migration required.

## 0.1.29

- Added Execution Backends: the execution layer is lifted OUT of the kernel into
  pluggable, swappable drivers — `node`, `bun`, `shell`, `container`, `remote`,
  and `ci` — behind ONE narrow `ExecutionBackend` contract
  (`src/execution-backend.ts`). Modeled on a BSD VFS / device-driver layer, the
  kernel (orchestrator/dispatch/pipeline-runner) contains NO backend-specific
  branching; all execution flows through the driver. WHAT to run and which
  evidence to record is kernel policy; HOW and WHERE it runs is the driver's
  concern.
- Added backend/driver types to `src/types.ts` (`ExecutionBackend`,
  `BackendDescriptor`, `BackendCapability`, `ExecutionRequest`,
  `ExecutionResultEnvelope`, `SandboxAttestation`, `BackendSelection`,
  `BackendProbeResult`, `SandboxDimension`) with explicit readiness/support/
  attestation enums. They reuse existing dispatch/worker/result/sandbox/
  provenance types and never fork them; the `ResultEnvelope` schema is unchanged.
- The sandbox profile is the contract: every backend maps the five dimensions
  (read/write/command/network/env) onto enforce/attest/unsupported and records a
  `SandboxAttestation`. A backend that cannot enforce or attest a required
  dimension, is not ready, or is handed a profile-denied command FAILS CLOSED
  (`status: "refused"`) — it never silently downgrades to unsandboxed execution.
- Identical envelopes, any backend: the result/evidence envelope and provenance
  are schema-identical regardless of which backend ran a task. CW's own
  self-verify produces byte-stable result/evidence on `node`, `shell`, and `bun`;
  only `provenance.backendId` and the attestation differ. The default (`node`)
  backend reproduces pre-v0.1.29 behavior exactly.
- CW delegates; it does not become the executor. `container`/`remote`/`ci` are
  delegating drivers that record a handle + attestation + result and fail closed
  when no delegation target is configured. CW does not reimplement a container
  runtime or a CI system.
- Selection mirrors `--sandbox`: a parallel `--backend <id>` flag (and
  `CW_BACKEND` env, then `node` default) on `dispatch`, `multi-agent step/run`,
  plus `backend list|show|probe`. All declared once in `src/capability-registry.ts`
  (3 new capabilities) so `cw <cmd> --json` is schema-identical to `cw_<tool>` and
  passes the v0.1.27 parity gate; `backend.list` is added to the parity payload
  probe.
- Durable, inspectable state: the selected backend + attestation are recorded per
  task in the dispatch manifest, worker scope, and worker manifest (a `backend`
  block alongside `sandbox`), and the v0.1.28 run registry surfaces a record's
  distinct `backends`. Operator status/report show backend + attestation per
  worker. Eval/replay, the verifier gates, and the registry stay backend-agnostic.
- Added `docs/execution-backends.7.md` and `test/execution-backends-smoke.js`
  (wired into `npm test`, `release:check`, and `version:sync`) proving byte-stable
  envelopes across node/shell/bun, the fail-closed refusals, recorded provenance +
  delegation handles, and the backend-agnostic verifier/registry.

## 0.1.28

- Added the Run Registry / Control Plane: a layer that manages MANY workflow runs
  across repositories — search, resume, archive, a durable queue, cross-repo
  history, and failed-run rerun — over the per-run `.cw/runs/<id>/state.json`,
  which remains the single source of truth.
- Added `src/run-registry.ts` (`RunRegistry`): a DERIVED, rebuildable index over
  runs. It scans source `state.json`, classifies lifecycle, and never mutates
  source. Mechanism vs policy — retention windows, queue ordering, and archive
  thresholds are configurable (`RunRegistryPolicy`, flags), not baked into the
  index.
- Added registry/index/lifecycle types to `src/types.ts` (`RunRecord`,
  `RunRegistryIndex`, `RunRegistryReport`, `RunLifecycleState`, `RunQueueEntry`,
  `RunProvenance`, `RunSearchResult`, `RunResumeResult`, `RunRerunResult`,
  `RunHistoryResult`, `RunShowResult`) with explicit status enums including the
  fail-closed `stale`/`missing` states. They reuse existing run/state types and
  never fork them.
- Documented lifecycle state machine (`queued → running → blocked → completed →
  failed → archived`), derived from source state and never invented; `archived`
  is an overlay that preserves the underlying `derivedLifecycle` for search.
- Cross-repo discovery is plain files under a home registry resolved from
  `CW_HOME`, then `XDG_STATE_HOME/cool-workflow`, then
  `~/.local/state/cool-workflow`: `repos.json` (registered roots), `index.json`,
  and `queue.json`, plus per-repo `.cw/registry/{index,archive,provenance}.json`.
  No hidden database; no daemon required to read state.
- Added CLI commands and MCP tools, each declared once in the v0.1.28 capability
  registry so `cw <cmd> --json` is schema-identical to `cw_<tool>`: `registry
  refresh|show`, `run search|list|show|resume|archive|rerun`, `queue
  add|list|drain|show`, and cross-repo `history` (13 new capabilities; the
  registry now declares 145 capabilities across 142 MCP tools).
- Resume resolves a run by id across repos and continues from durable state
  (read-only over source). Archive is an overlay mark that never deletes source
  truth and keeps the run searchable. Rerun creates a NEW run that links to the
  original via provenance (`rerunOf`/`originRunId`/`generation`); the failed run
  is preserved for audit.
- Fail closed: tampered source surfaces as `stale` (named in `staleRuns`),
  missing source as `missing` (named in `missingRuns`, never fabricated into the
  records), and `run show` of a deleted run returns `found: false` /
  `freshness: missing` rather than a live status.
- Added `test/run-registry-control-plane-smoke.js` proving cross-repo indexing,
  search determinism, resume-by-id, queue ordering, archive without data loss,
  rerun provenance linkage, fail-closed `stale`/`missing`, and CLI ↔ MCP payload
  identity. Wired into `npm test` and `npm run release:check`.
- Added `docs/run-registry-control-plane.7.md` (index model, lifecycle state
  machine, queue/archive/rerun semantics, cross-repo layout) and added it to
  `docs/index.md`.
- No run-state schema change. Pre-0.1.28 single-repo runs and existing
  `.cw/runs/` layouts keep working with an empty, rebuildable registry, and every
  pre-0.1.28 CLI command and MCP tool keeps working.

## 0.1.27

- Added CLI ↔ MCP Parity: a formal, tested guarantee that the command-line
  surface and the MCP surface are two renderings of ONE data source (mechanism
  vs policy — the shared core is the single source of truth, rendering is the
  only difference).
- Added `src/capability-registry.ts`: the single declared registry of every
  capability (`CapabilityDescriptor`, `ParitySurface`, `ParityReport`), mapping
  each capability to its CLI command, MCP tool, shared core `entry`, and JSON
  contract. The CLI dispatch tokens and the MCP tool list are validated against
  it; a capability on only one surface must be recorded as surface-specific with
  a reason or the gate fails closed.
- Added `src/capability-core.ts`, relocating composite logic (`planSummary`,
  `appRun`, `sandboxChoose`, `commitEnvelope`, `compactOperatorStatus`) out of
  `mcp-server.ts` so no capability logic lives on only one surface.
- Closed surface gaps: added MCP tools `cw_init`, `cw_next`, `cw_state_check`,
  `cw_contract_show`, `cw_node_list`, `cw_node_show`, `cw_node_graph`; added CLI
  commands `app run`, `operator status`, `operator report`, `sandbox choose`,
  `sandbox resolve`, and `report --json`. The registry now declares 132
  capabilities across 129 MCP tools.
- Added `scripts/parity-check.js` (`npm run parity:check`) and
  `test/cli-mcp-parity-smoke.js`: fail-closed gates asserting registry⇄CLI⇄MCP
  coverage, `cw <cmd> --json` == `cw_<tool>` payload identity on a real run, and
  drift detection on injected divergence. Wired into `release:check` and
  `npm test`.
- Added `docs/cli-mcp-parity.7.md` (the parity matrix and the human-vs-machine
  contract); the only declared payload projection is `commit` (raw
  StateCommitResult for the CLI vs an operator envelope for `cw_commit`, both
  from the single entry `runner.commit`).
- Added an additive `disposition` (`adopted` | `inspectable` | `blocking`) to
  multi-agent operator evidence rows, plus an `inspectableEvidence` summary list.
  Once a run has a verifier-gated commit, the selected path is decided, so
  missing/pending evidence for sibling roles never driven as separate workers
  (e.g. undriven judge-panel judges) is reported as inspectable operator state,
  not a hidden failure. The raw `status` field is unchanged; `disposition` is the
  operator-facing reading. The human `multi-agent status` and `status` views
  label these rows accordingly.
- CI (`.github/workflows/ci.yml`) now runs `npm test` and `npm run release:check`
  on every push and pull request, not just `install`/`build`/`check`/`list`.
- No run-state schema change. Pre-0.1.27 runs load unchanged and every
  pre-0.1.27 CLI command and MCP tool keeps working.

## 0.1.26

- Added the Evidence Adoption Reasoning Chain: a derived, versioned,
  provenance-backed view that explains *why* each evidence item was adopted,
  rejected, superseded, or conflicting, complementing the existing *what* in
  `multi-agent evidence`.
- Added derived record types (`EvidenceReasoningStep`, `EvidenceReasoningChain`,
  `EvidenceReasoningReport`) in `src/types.ts` with status enums including the
  fail-closed `unexplained` state. They reuse existing provenance / trust /
  rationale types by reference and never fork them.
- Added `src/evidence-reasoning.ts`, which derives, per gate (`fanin`,
  `candidate-score`, `selection`, `verifier`, `commit`), the decision, basis
  (evidence refs + provenance source + audit ids), authority
  (role/membership/worker + role `policyRef`), rationale (selection reason,
  acceptance rationale, score notes/verdict, verifier gate, commit reason,
  coordinator decision, judge rationale), and counterfactual (rejected
  candidates, failed scores, rejected/superseded decisions). No new
  source-of-truth records are mutated.
- Added durable storage under `.cw/runs/<run-id>/reasoning/` (`index.json` +
  per-chain records + `report.json`) with a `sourceFingerprint` and
  `valid|stale|absent` freshness, mirroring the v0.1.25 summaries pattern. Raw
  results, candidates, scores, selections, commits, and audit records are never
  deleted or overwritten.
- Added `multi-agent reasoning <run-id> [--evidence <id>] [--refresh]
  [--json|--format json]` and integrated an additive `rationaleStatus`
  (`explained|unexplained|not-applicable`) into `multi-agent evidence` rows.
  Added a single new console panel, `Adoption Rationale`.
- Added MCP parity: `cw_evidence_reasoning` and `cw_evidence_reasoning_refresh`,
  mirroring the CLI contract exactly.
- Reasoning steps are on the critical path and are exempt from state-explosion
  compaction: every decision-gate node backing an adopted chain (notably score
  nodes, otherwise collapsible) is protected and never collapsed into a synthetic
  summary node.
- Fail closed, never infer: an adoption whose rationale cannot be traced renders
  as `unexplained` and is never silently treated as explained.
- Eval/replay now regression-gates reasoning with new replay-stable metrics:
  `reasoning_freshness`, `reasoning_chain_parity`, and
  `reasoning_unexplained_parity`. Pre-0.1.26 snapshots load with empty reasoning
  sections, preserving backward compatibility.
- Added `docs/evidence-adoption-reasoning-chain.7.md` (added to the docs reading
  order) and `test/evidence-adoption-reasoning-smoke.js`, included in `npm test`
  and `npm run release:check`.

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
