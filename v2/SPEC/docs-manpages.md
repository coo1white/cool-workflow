# docs-manpages

## Scope

This spec covers every `.md` file under `plugins/cool-workflow/docs/` (61 top-level files plus `designs/`, `dogfood/`, `launch/` — 67 markdown files in all). The `*.7.md` man pages are the contract: `AGENTS.md` and `docs/unix-principles.md` say "Man pages are the contract" (docs/unix-principles.md:228-230). This spec lists, page by page, what each man page promises, in checklist form, and marks any promise where doc and code may not agree ("doc says, code must be checked").

## Public surface

The docs do not run code. But they bind the code to a public surface. The list below is the promise checklist, page by page. A rebuild must keep every promise or change the doc in the same change.

### doctor.7.md — `cw doctor`

- [ ] `cw doctor` is read-only; it never writes a file (docs/doctor.7.md:23-24).
- [ ] It runs six checks, in order: `node`, `agent`, `agent-binary`, `git`, `home-registry`, `repo-state` (docs/doctor.7.md:36-62). Verified in source: all six names are in `src/doctor.ts` (src/doctor.ts:92, 100, 122, 130, 138, 144).
- [ ] Each check has status `ok`, `warn`, or `fail`; non-ok checks carry a `fix` line (docs/doctor.7.md:26-29).
- [ ] Exit 0 when no `fail` (warnings allowed); exit 1 when any check is `fail` (docs/doctor.7.md:88-93).
- [ ] `node` below v18 is a `fail`; a missing agent is a `warn` (demos and `--preview` still work); missing git is a `warn`; a non-writable home registry is a `fail`; non-writable `<cwd>/.cw` is a `warn` (docs/doctor.7.md:38-62).
- [ ] Flags: `--json` (stable JSON report), `--fix` (same as `cw fix`), `--onramp` (quick-start guide), `--changed-from <ref>` with `--onramp` (docs/doctor.7.md:64-79).
- [ ] Home registry default is `$HOME/.local/state/cool-workflow`, override `$CW_HOME` (docs/doctor.7.md:56-57).

### fix.7.md — `cw fix`

- [ ] `cw fix` prints only the fix commands, one numbered step per non-ok check (docs/fix.7.md:16-19).
- [ ] Clean setup prints `No fixes needed.` (docs/fix.7.md:21-22).
- [ ] Read-only; exit 1 only when a check has status `fail`; `--json` gives the same shape as `cw doctor --json` (docs/fix.7.md:24-40).

### init.7.md — `cw init`

- [ ] `cw init <workflow-id> [--title TITLE] [--output PATH] [--force]` writes a `.workflow.js` template file (docs/init.7.md:9-28).
- [ ] The id is made into a safe file name; default output is `<id>.workflow.js` in the cwd (docs/init.7.md:23-25).
- [ ] Refuses to overwrite an existing file without `--force`; exit 1 on missing/invalid id or file-exists (docs/init.7.md:27-48).

### demo.7.md — `cw demo tamper|bundle`

- [ ] Both demos are hermetic: no agent, no network, only a temp directory (docs/demo.7.md:16-22).
- [ ] `demo tamper` builds a signed 3-hop ledger, forges it three ways (hash, signature, finding severity `HIGH` → `LOW`), and proves each forgery is caught with only the public key (docs/demo.7.md:26-43).
- [ ] `demo bundle` builds and forges a sealed portable bundle two ways and proves `report verify-bundle` catches both (docs/demo.7.md:45-61).
- [ ] Exit 0 = all tampering caught; exit 1 = a tamper got through (docs/demo.7.md:63-68).
- [ ] Both are CLI-only by declared reason (docs/cli-mcp-parity.7.md:327-328).
- [ ] Launch checklist pins the tamper demo output line `VERDICT: tamper-evidence holds ✓` (docs/launch/pre-launch-checklist.md:20-22).

### pipeline-verbs.7.md — `cw plan|dispatch|result`

- [ ] `plan <workflow-id>` makes a run and prints a stable JSON plan summary (run id, first tasks, sandbox profile, run state) (docs/pipeline-verbs.7.md:32-41).
- [ ] `dispatch <run-id>` prints a dispatch manifest (task id, prompt, sandbox, input/output paths); when no task is ready the payload says so (docs/pipeline-verbs.7.md:45-55).
- [ ] `result <run-id> <task-id> <result-file>` takes a Markdown file that must hold a `cw:result` JSON fence with `findings` and `evidence`; a bad result is rejected with an error feedback record (docs/pipeline-verbs.7.md:59-66).
- [ ] None of the three verbs starts or stops the agent host (docs/pipeline-verbs.7.md:23-27).

### state-node.7.md / pipeline-runner.7.md — StateNode kernel

- [ ] Node JSON lives in `.cw/runs/<run-id>/nodes/`; default pipeline `input -> plan -> dispatch -> result -> verify -> commit -> report` (docs/state-node.7.md:38-46; docs/pipeline-runner.7.md:46-50).
- [ ] `schemaVersion` is required on nodes and contracts; current schema is `1`; older runs without `nodes`/`contracts` still load (docs/state-node.7.md:72-77).
- [ ] Contract failures raise `PipelineContractError` with a structured `StateNodeError` (`code`, `message`, `at`, optional `nodeId`/`path`/`retryable`/`details`) (docs/state-node.7.md:56-68).
- [ ] A node cannot become `committed` unless it is already `verified` (docs/state-node.7.md:69-70).
- [ ] Inspect verbs: `contract show`, `node list`, `node show`, `node graph`, all stable JSON (docs/pipeline-runner.7.md:93-100).

### error-feedback.7.md — `cw feedback *`

- [ ] Verbs: `feedback collect|list|show|task|resolve <run-id> ...`; all print fixed JSON (docs/error-feedback.7.md:112-144).
- [ ] Classifications are a closed set: `contract-violation`, `verifier-failure`, `state-transition`, `missing-artifact`, `missing-evidence`, `parse-error`, `pipeline-failure`, `runtime-error`, `unknown` (docs/error-feedback.7.md:70-84).
- [ ] `feedback resolve` needs a node with status `verified` or `committed`; making a task marks the record `tasked` (docs/error-feedback.7.md:96-100).
- [ ] Files: `feedback/<id>.json`, `feedback/index.json`, task file `tasks/feedback:<feedback-id>.md` (docs/error-feedback.7.md:102-110).

### candidate-scoring.7.md — `cw candidate *`

- [ ] Verbs: `candidate register|score|rank|select` (plus `list|show|reject|summary` per the parity matrix) (docs/candidate-scoring.7.md:28-33; docs/cli-mcp-parity.7.md:214-221).
- [ ] Score records need evidence; selection needs a linked verifier node with `verified` status; failures become ErrorFeedback; rejected candidates stay on disk (docs/candidate-scoring.7.md:70-79).
- [ ] Tie-break: higher normalized score wins; equal scores go to the earlier candidate creation time by default (docs/candidate-scoring.7.md:96-98).
- [ ] Files under `candidates/`: `index.json`, `ranking.json`, `<id>/candidate.json`, `<id>/scores/<score-id>.json`, `selections/<selection-id>.json` (docs/candidate-scoring.7.md:56-61).

### verifier-gated-commit.7.md — `cw commit`

- [ ] Only verified state becomes committed state (docs/verifier-gated-commit.7.md:31-33).
- [ ] Inputs: `--verifier <node-id>`, `--candidate <id>`, `--selection <id>`, or `--allow-unverified-checkpoint`, each with `--reason` (docs/verifier-gated-commit.7.md:9-14).
- [ ] Checkpoint records carry `"verifierGated": false, "checkpoint": true`; a checkpoint commit node is `kind: "commit"`, `status: "completed"`; a gated one is `status: "committed"` (docs/verifier-gated-commit.7.md:50-60).
- [ ] Gated commit JSON keys: `verifierGated`, `checkpoint`, `verifierNodeId`, `candidateId`, `selectionId`, `evidence` (docs/verifier-gated-commit.7.md:64-75).
- [ ] Every blocked commit try writes an `error` state node and an ErrorFeedback record before exit (docs/verifier-gated-commit.7.md:90-92).
- [ ] The closed set of feedback codes: `commit-verifier-required`, `commit-verifier-not-found`, `commit-verifier-wrong-kind`, `commit-verifier-not-verified`, `commit-verifier-missing-evidence`, `commit-candidate-not-found`, `commit-candidate-not-selectable`, `commit-candidate-unscored`, `commit-candidate-not-verified`, `commit-candidate-selection-missing`, `commit-selection-not-found`, `commit-selection-node-missing`, `commit-selection-not-verified`, `commit-verifier-linkage-mismatch` (docs/verifier-gated-commit.7.md:98-115).

### sandbox-profiles.7.md — `cw sandbox *`

- [ ] Verbs: `sandbox list|show|validate`; dispatch takes `--sandbox <id>` (docs/sandbox-profiles.7.md:9-15). Plus `sandbox choose|resolve` (docs/cli-mcp-parity.7.md:200-201).
- [ ] Bundled profiles: `default`, `readonly`, `workspace-write`, `locked-down` (docs/sandbox-profiles.7.md:53-71).
- [ ] Profile file schema version `1` with keys `readPaths`, `writePaths`, `workerOutput`, `execute`, `network`, `env`; path tokens `$cwd`, `$runDir`, `$workerDir`, `$inputPath`, `$resultPath`, `$artifactsDir`, `$logsDir`; `..` traversal is rejected (docs/sandbox-profiles.7.md:73-95).
- [ ] `execute.mode`/`network.mode` are `none`, `allowlist`, or `any` (docs/sandbox-profiles.7.md:96).
- [ ] Under the `node` backend, execute/network/env are attested, not enforced (docs/sandbox-profiles.7.md:29-38).
- [ ] v0.1.95: `buildChildEnv(policy)` is the baseline for agent spawns — only `PATH`, `HOME`, `expose` entries, and well-known `CW_*` + LLM provider API key names pass through (docs/sandbox-profiles.7.md:39-43). Verified: `buildChildEnv` is used in `src/drive.ts:584` and `src/execution-backend.ts:556,840,945`.
- [ ] Failure codes: `sandbox-profile-not-found`, `sandbox-profile-invalid`, `sandbox-write-denied`, `sandbox-read-denied`, `sandbox-network-denied`, `sandbox-command-denied`; a requested profile is never dropped to `default` (docs/sandbox-profiles.7.md:132-143).

### worker-isolation.7.md — `cw worker *`

- [ ] Verbs: `worker list|show|manifest|output|fail` (plus `validate|summary`) (docs/worker-isolation.7.md:21-27; docs/cli-mcp-parity.7.md:207-213).
- [ ] Worker files: `workers/index.json`, `<worker-id>/worker.json`, `manifest.json`, `input.md`, `result.md`, `artifacts/`, `logs/` (docs/worker-isolation.7.md:88-101).
- [ ] Accepted output paths must sit inside resolved `writePaths`, or the declared `result.md`/`artifacts/`/`logs/` allowances (docs/worker-isolation.7.md:72-77).
- [ ] Out-of-scope output makes: a failed/rejected worker scope + an `error` StateNode + an ErrorFeedback record (docs/worker-isolation.7.md:82-86).
- [ ] Legacy `allowedPaths` stays as the effective write-path alias (docs/worker-isolation.7.md:155-159).

### workflow-app-framework.7.md — `cw app *`

- [ ] Verbs: `app list|show|validate|init|package` and `plan <app-id>`; `cw list` shows legacy workflow files and app directories (docs/workflow-app-framework.7.md:192-202).
- [ ] App layout: `apps/<app-id>/app.json` + `apps/<app-id>/workflow.js`; entrypoint may export a workflow or a factory (docs/workflow-app-framework.7.md:120-158).
- [ ] Validation fails closed; bad apps return nonzero with structured `{ valid: false, issues: [{ code, message, path }] }` (docs/workflow-app-framework.7.md:161-188).
- [ ] MCP tools: `cw_app_list`, `cw_app_show`, `cw_app_validate`, `cw_app_init`, `cw_app_package`, `cw_app_run` (docs/workflow-app-framework.7.md:225-232).
- [ ] Run state keeps app metadata at `state.json.workflow.app`; reports include lines `Workflow App: <id>@<version>` and `Workflow App Source: <path>` (docs/workflow-app-framework.7.md:244-256).

### canonical-workflow-apps.7.md

- [ ] Canonical apps: `architecture-review`, `architecture-review-fast`, `pr-review-fix-ci`, `release-cut`, `research-synthesis` (docs/canonical-workflow-apps.7.md:19-121). Live app list also has `end-to-end-golden-path`, `pdca-blackboard-loop`, `workflow-app-framework-demo` (docs/project-index.md:127-136).
- [ ] Legacy compatibility ids: `legacy-architecture-review`, `legacy-research-synthesis` (docs/canonical-workflow-apps.7.md:150-162).
- [ ] `npm run canonical-apps` validates and plans every app; `npm run golden-path` is the full integration proof (docs/canonical-workflow-apps.7.md:122-177).
- [ ] `scripts/architecture-review-fast.js` flags: `--fast-model`, `--strong-model`, `--metrics`, `--schedule-full`; env peers `CW_ARCHITECTURE_REVIEW_FAST_MODEL`/`CW_ARCHITECTURE_REVIEW_STRONG_MODEL`; a profile that exports zero records makes the wrapper fail closed (docs/canonical-workflow-apps.7.md:40-63).

### end-to-end-golden-path.7.md

- [ ] `npm run golden-path` uses only stdlib + the public CLI; no network, no sleeps, no daemon (docs/end-to-end-golden-path.7.md:8-16).
- [ ] Invariants checked in durable state: worker gets to `verified`; verifier node holds evidence; last commit has `verifierGated: true` and `checkpoint: false`; no ErrorFeedback records are made (docs/end-to-end-golden-path.7.md:94-116).

### operator-ux.7.md — `cw status|graph|report`

- [ ] `status <run-id>` human by default; `--json`/`--format json` for machines (docs/operator-ux.7.md:10-26).
- [ ] `report <run-id>` writes the Markdown report and prints its path; `--show` and `--summary` render to console (docs/operator-ux.7.md:104-117).
- [ ] Next-action suggestions use only real CW CLI commands; open feedback comes before dispatch or candidate work (docs/operator-ux.7.md:37-59).
- [ ] Resource summaries: `worker|candidate|feedback|commit|multi-agent summary <run-id>` each with `--json` (docs/operator-ux.7.md:122-146).

### multi-agent-runtime-core.7.md

- [ ] `MultiAgentRun` lifecycle: `planned -> forming -> running -> collecting -> verifying -> completed`, plus `failed`/`cancelled`; bad transitions fail closed (docs/multi-agent-runtime-core.7.md:52-60).
- [ ] State mirror files under `.cw/runs/<run-id>/multi-agent/` (`index.json`, `runs/`, `roles/`, `groups/`, `memberships/`, `fanouts/`, `fanins/`) (docs/multi-agent-runtime-core.7.md:32-43).
- [ ] Fanin with a required role that has no membership or no reported evidence is `blocked` with `verifierReady=false` (docs/multi-agent-runtime-core.7.md:139-148).
- [ ] Older run state is normalized with an empty `multiAgent` block (docs/multi-agent-runtime-core.7.md:211-230).

### coordinator-blackboard.7.md

- [ ] Blackboard verbs: `blackboard summary|graph|resolve|topic create|message post|message list|context put|artifact add|artifact list|snapshot`; `coordinator summary|decision` (docs/coordinator-blackboard.7.md:119-137).
- [ ] MCP peers with the same names (`cw_blackboard_*`, `cw_coordinator_*`) — no CLI-only core blackboard behavior (docs/coordinator-blackboard.7.md:139-158).
- [ ] Storage: `blackboard/index.json`, `messages.jsonl` (append-friendly), `topics/`, `contexts/`, `artifacts/`, `snapshots/`, `decisions/` (docs/coordinator-blackboard.7.md:53-69).
- [ ] Context kinds: `fact`, `constraint`, `assumption`, `question`, `decision`; a same-key different-value update marks records `conflicting` and records a `CoordinatorDecision`; `--supersedes <id>` marks the old record `superseded` (docs/coordinator-blackboard.7.md:71-87).

### multi-agent-topologies.7.md / capability-topology-registry.7.md

- [ ] Official topologies: `map-reduce`, `debate`, `judge-panel` (docs/multi-agent-topologies.7.md:11-30).
- [ ] Verbs: `topology list|show|validate|apply|summary|graph`; MCP `cw_topology_*` (docs/multi-agent-topologies.7.md:44-68).
- [ ] Topology files: `topologies/index.json`, `topologies/runs/<topology-run-id>.json` (docs/multi-agent-topologies.7.md:33-37).
- [ ] `registerTopology()` puts a new topology in an open Map; registered wins over official on the same id; `role.count > 1` makes `role-1..role-N` (docs/capability-topology-registry.7.md:166-183).
- [ ] **DOC DRIFT (confirmed, small):** docs/capability-topology-registry.7.md:90 says `registrySize` is "199 at the time of writing"; the live registry has 209 capabilities and 196 MCP tools (dist/capability-registry.js, counted live; docs/cli-mcp-parity.7.md:85-86 agrees with 209/196). The page itself tells the reader to run `parity-check` for the live number, so this is a stale example value, not a wrong contract.

### multi-agent-cli-mcp-surface.7.md / multi-agent-operator-ux.7.md

- [ ] Host loop verbs: `multi-agent run|status|step|blackboard|score|select`; `step` never starts agents on its own (docs/multi-agent-cli-mcp-surface.7.md:3-71).
- [ ] Operator views: `multi-agent graph|dependencies|failures|evidence`, all with `--json` (docs/multi-agent-operator-ux.7.md:60-75).
- [ ] Six stable human panels: `Agent Graph`, `Dependencies`, `Failed / Blocked Agents`, `Adopted Evidence`, `Missing Evidence`, `Next Action` (docs/multi-agent-operator-ux.7.md:77-87).
- [ ] Edge labels closed set: `owns`, `depends-on`, `dispatches`, `reports`, `cites`, `adopted-by`, `rejected-by`, `blocks`, `scores`, `selects`, `gates`, `commits` (docs/multi-agent-operator-ux.7.md:99-114).
- [ ] Evidence rows have `status` in `adopted|rejected|pending|superseded|conflicting|missing` plus additive `disposition` in `adopted|inspectable|blocking` (docs/multi-agent-operator-ux.7.md:26-34, 141-150).
- [ ] High-level responses carry `runId`, `state`, `performed`, `nextAction`, `nextActions`, `blockedReasons`, `requiredHostAction`, `evidenceRequirements`, and paths (docs/multi-agent-cli-mcp-surface.7.md:106-119).

### security-trust-hardening.7.md / multi-agent-trust-policy-audit.7.md — `cw audit *`

- [ ] Audit dir per run: `audit/events.jsonl` (append), `audit/index.json`, `audit/summary.json` (derived) (docs/security-trust-hardening.7.md:11-21).
- [ ] Event sources closed set: `cw-validated`, `host-attested`, `operator-recorded`, `runtime-derived`; env audit keeps names only, never values (docs/security-trust-hardening.7.md:31-44).
- [ ] Verbs: `audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision` and MCP peers `cw_audit_*` (docs/security-trust-hardening.7.md:52-116).
- [ ] Multi-agent audit event kinds: `multi-agent.role-policy`, `multi-agent.permission`, `blackboard.write`, `blackboard.message-provenance`, `judge.rationale`, `judge.panel-decision`, `policy.violation` (docs/multi-agent-trust-policy-audit.7.md:37-45).
- [ ] `audit summary` is a reader and always exits 0; `audit verify <run-id>` is the gate: exit 1 on any unverified chain (forged/edited/truncated/unchained-injected, and a fully-corrupt log); only a truly absent/empty chain is `verified:true`/exit 0. JSON reports `present`, `verified`, `eventCount`, `chained`, `unchained`, `corruptLines`, `failedChecks[]` (docs/multi-agent-trust-policy-audit.7.md:118-143).

### multi-agent-eval-replay-harness.7.md — `cw eval *`

- [ ] Verbs: `eval snapshot|replay|compare|score|gate|report`; MCP `cw_eval_*`; artifacts under `.cw/evals/<suite-id>/`: `suite.json`, `snapshot.json`, `replay-run.json`, `comparison.json`, `score.json`, `findings.json`, `gate.json`, `report.md` (docs/multi-agent-eval-replay-harness.7.md:31-88).
- [ ] The baseline run is never changed during replay; replay writes to a separate `replay/` dir (docs/multi-agent-eval-replay-harness.7.md:24-26).
- [ ] The metric id list is fixed (21 metrics from `replay_completed` to `report_parity`, plus the v0.1.25 summary metrics and v0.1.26 reasoning metrics) (docs/multi-agent-eval-replay-harness.7.md:113-140, 9-19).
- [ ] `eval gate` fails closed on missing artifacts or regressions (docs/multi-agent-eval-replay-harness.7.md:143-154).
- [ ] v0.1.82: replay re-derives the projection from raw captured state, so nondeterministic projections are caught (docs/multi-agent-eval-replay-harness.7.md:311).

### state-explosion-management.7.md — `cw summary *`

- [ ] Verbs: `summary refresh|show`, `blackboard summarize`, `multi-agent summarize`, `multi-agent graph --view <view> [--focus <id>] [--depth <n>]` (docs/state-explosion-management.7.md:84-95).
- [ ] Graph views closed set: `full`, `compact`, `critical-path`, `failures`, `evidence`, `trust`, `topology`, `blackboard`, `candidate`, `commit-gate` (docs/state-explosion-management.7.md:69-73).
- [ ] JSON output is never quietly compacted; compaction is only for human views or when asked (docs/state-explosion-management.7.md:100-102).
- [ ] Critical path, failures, conflicts, missing evidence, policy violations, and judge rationale are never folded (docs/state-explosion-management.7.md:80-82).
- [ ] Freshness `valid|stale|absent`; `summary show` on a stale record names stale scopes and says run `summary refresh` (docs/state-explosion-management.7.md:143-149).
- [ ] Summary files under `.cw/runs/<run-id>/summaries/` (docs/state-explosion-management.7.md:44-46).

### evidence-adoption-reasoning-chain.7.md — `cw multi-agent reasoning`

- [ ] `multi-agent reasoning <run-id> [--evidence <id>] [--refresh] [--json]`; MCP `cw_evidence_reasoning` and `cw_evidence_reasoning_refresh` (docs/evidence-adoption-reasoning-chain.7.md:97-105).
- [ ] Fail-closed `unexplained` state: a "why" that cannot be traced renders `unexplained`, never a made-up rationale; a chain is `explained` only when every decision-bearing step is explained (docs/evidence-adoption-reasoning-chain.7.md:17-20, 64-67).
- [ ] Storage: `reasoning/index.json`, `reasoning/chain-<evidence-id>.json`, `reasoning/report.json` (docs/evidence-adoption-reasoning-chain.7.md:69-82).
- [ ] `multi-agent evidence` rows gain an additive `rationaleStatus` (`explained|unexplained|not-applicable`) (docs/evidence-adoption-reasoning-chain.7.md:107-110).

### cli-mcp-parity.7.md — the parity contract

- [ ] The registry (`src/capability-registry.ts`) is the one source; the generated matrix says 209 capabilities and 196 MCP tools (docs/cli-mcp-parity.7.md:84-86). Verified live: 209 capabilities, 196 MCP tools, 13 cli-only, 12 projected (dist/capability-registry.js, counted).
- [ ] `payloadIdentical` means `cw <cmd> --json` equals the `cw_<tool>` payload apart from whitespace and generation-time ISO timestamps (docs/cli-mcp-parity.7.md:61-65).
- [ ] The 13 CLI-only capabilities: `help`, `version`, `update`, `fix`, `info`, `search`, `man`, `doctor`, `loop`, `schedule daemon`, `quickstart` (with `audit-run` alias), `demo tamper`, `demo bundle` — each with a recorded reason (docs/cli-mcp-parity.7.md:313-329). `audit-run` alias verified in `src/cli/command-surface.ts:213` and `src/capability-registry.ts:508`.
- [ ] The 12 projected (declared payload-divergent) capabilities: `commit`, `backend.agent.config.set`, `run.drive.step`, `gc.run`, `clones.gc`, `orphans.gc`, `workbench.serve`, `ledger.propose`, `ledger.review`, `ledger.verify`, `ledger.apply`, `ledger.list` (docs/cli-mcp-parity.7.md:331-346).
- [ ] The parity gate (`scripts/parity-check.js --check`, `npm run parity:check`) fails closed on: one-surface capability, undeclared live tool/command, missing reason, payload divergence on a `payloadIdentical` row (docs/cli-mcp-parity.7.md:348-368).

### run-registry-control-plane.7.md — `cw registry|run|queue|history`

- [ ] Verbs and flags as listed in the CLI block (docs/run-registry-control-plane.7.md:253-273): `registry refresh|show [--scope repo|home]`, `run search|list|show|resume|archive|rerun|export|import|verify-import|inspect-archive|restore`, `queue add|list|show|drain`, `history`.
- [ ] Lifecycle derivation rules, first match wins: running tasks → `running`; open feedback → `blocked`; failed tasks → `failed`; all tasks completed → `completed`; gated commits and nothing pending → `completed`; completed tasks > 0 → `running`; else `queued` (docs/run-registry-control-plane.7.md:62-72). `archived` is an overlay; `derivedLifecycle` keeps the source state (docs/run-registry-control-plane.7.md:74-78).
- [ ] Files: `<repo>/.cw/registry/index.json|archive.json|provenance.json`; `$CW_HOME/registry/repos.json|index.json|queue.json`; home root resolution `CW_HOME` then `XDG_STATE_HOME/cool-workflow` then `~/.local/state/cool-workflow` (docs/run-registry-control-plane.7.md:81-99).
- [ ] `run resume` is read-only over source; `--drive`/`--once` hands to the drive loop and adds a `drive` field; unconfigured agent gives `drive.status="blocked"` (docs/run-registry-control-plane.7.md:111-124).
- [ ] `run rerun` makes a NEW run with provenance (`rerunOf`, `rerunOfRepo`, `originRunId`, `generation`, `reason`); the failed run is kept (docs/run-registry-control-plane.7.md:145-152).
- [ ] Import refuses a tampered archive before any write (one `cw:` stderr line, non-zero exit, nothing on disk); `CW_REQUIRE_ARCHIVE_INTEGRITY=1` also refuses a stripped-integrity archive (docs/run-registry-control-plane.7.md:171-178).
- [ ] Import refuses run ids that are not one safe path segment (`[A-Za-z0-9._-]`, not `.`/`..`); embedded `..` like `v1..2` is allowed (docs/run-registry-control-plane.7.md:180-188).
- [ ] `run verify-import` prints and exits 0 by default even on failed checks; `--strict` makes failures exit non-zero (docs/run-registry-control-plane.7.md:199-201).
- [ ] `run inspect-archive` never throws; stdout is always valid JSON; failure codes `digest-mismatch`, `size-mismatch`, `manifest-digest-mismatch`, `file-count-mismatch`; exit 1 when `ok:false` (docs/run-registry-control-plane.7.md:202-217).
- [ ] `run restore` = inspect + import + fail-closed verify in one step; result shape `{ schemaVersion, ok, target, inspect, imported, verify, registry }`; exit 1 whenever `ok:false` (docs/run-registry-control-plane.7.md:219-239).
- [ ] `run show` of a missing-source run gives `found: false` with `freshness: missing` (docs/run-registry-control-plane.7.md:300-303).
- [ ] v0.1.88 note: path-traversal run ids are refused at import (docs/run-registry-control-plane.7.md:452-454).

### control-plane-scheduling.7.md — `cw sched *`

- [ ] Verbs: `sched plan|lease|complete|release [--failed]|reclaim|reset|policy show|policy set` (docs/control-plane-scheduling.7.md:24-49).
- [ ] Policy file `$CW_HOME/registry/scheduling-policy.json`; defaults when absent: `maxConcurrent 1`, `maxAttempts 3`, `leaseTtlMs 300000`, backoff `baseMs 1000 * factor 2 ^ (attempts-1)` capped at `60000`, no jitter (docs/control-plane-scheduling.7.md:19-26).
- [ ] Concurrency is a hard ceiling; `attempts >= maxAttempts` parks the entry with a `parkedReason` and only `sched reset` un-parks; backoff is deterministic and sets `nextEligibleAt` (docs/control-plane-scheduling.7.md:51-59).
- [ ] `sched reclaim` counts an expired lease as one failed attempt (docs/control-plane-scheduling.7.md:47-49).
- [ ] Additive fields on `RunQueueEntry`: `attempts`, `leaseId`, `leaseExpiresAt`, `nextEligibleAt`, `parkedReason`, statuses `leased`/`parked` (docs/control-plane-scheduling.7.md:61-66).

### execution-backends.7.md / real-execution-backends.7.md — `cw backend *`

- [ ] Verbs: `backend list|show|probe`; drivers `node` (default), `bun`, `shell`, `container`, `remote`, `ci` plus `agent` (7 sorted ids `["agent","bun","ci","container","node","remote","shell"]`) (docs/execution-backends.7.md:9-15, 26-29; docs/agent-delegation-drive.7.md:318-322).
- [ ] Selection precedence: `--backend <id>` flag > `CW_BACKEND` env > `node` (docs/execution-backends.7.md:118-123). Verified: `src/execution-backend.ts:356,373-376`.
- [ ] Canonical local evidence triple, byte-stable across backends: `command:<command + args>`, `exitCode:<code>`, `stdoutSha256:sha256:<hex>` (docs/execution-backends.7.md:131-139; docs/real-execution-backends.7.md:16-22).
- [ ] Fail-closed refusal: `status: "refused"` with `attestation.status: "refused"` on `sandbox-command-denied`, `sandbox-unenforceable`, `backend-not-ready`, `delegation-target-missing`; unknown backend id is `backend-not-found`; never a silent unsandboxed run (docs/execution-backends.7.md:180-192).
- [ ] real drivers: container runs `<runtime> run --rm [--network none] -v <cwd>:<cwd>:ro -w <cwd> ... <image[@digest]> <command> <args>`; refusal codes add `no-command`, `runtime-unavailable`, `delegation-failed`; a real non-zero exit is `failed`, not `refused` (docs/real-execution-backends.7.md:32-79).
- [ ] Env/flags for delegation targets: `--image`/`CW_CONTAINER_IMAGE` (+`CW_CONTAINER_DIGEST`), `--endpoint`/`CW_REMOTE_ENDPOINT`/`CW_REMOTE_JOB`, `--job`/`CW_CI_ENDPOINT`/`CW_CI_JOB` (docs/real-execution-backends.7.md:48-59).
- [ ] v0.1.88: agent stderr live-streaming defaults on when stderr is a TTY; `CW_AGENT_STREAM=0` / `CW_NO_STREAM=1` force off; CI and pipes stay silent; stdout is always captured as data (docs/execution-backends.7.md:329).

### agent-delegation-drive.7.md — the `agent` backend, drive, quickstart

- [ ] CW delegates; the model runs in the agent's process; CW imports no model SDK and holds no API key (docs/agent-delegation-drive.7.md:19-28).
- [ ] The seam: argv placeholders `{{input}}`, `{{result}}`, `{{manifest}}`, `{{workerDir}}`, `{{model}}`, `{{prompt}}` as discrete argv elements, `shell:false`; the wrapper writes `result.md` plus one stdout JSON line `{model,usage,result}` (docs/agent-delegation-drive.7.md:48-52, 241-245).
- [ ] Built-in templates: `builtin:claude`, `builtin:codex`, `builtin:gemini`, `builtin:gemini-cli`, `builtin:opencode`, `builtin:deepseek` (docs/agent-delegation-drive.7.md:285-301). Verified: `scripts/agents/builtin-templates.json` maps exactly these six.
- [ ] Headline shortcuts: `cw -q "..." -claude|-codex|-gemini|-deepseek` (docs/agent-delegation-drive.7.md:296-301).
- [ ] Config precedence: flags > env (`CW_AGENT_COMMAND`/`CW_AGENT_ENDPOINT`/`CW_AGENT_MODEL`) > `$CW_HOME/agent-config.json`; no secrets in config (docs/agent-delegation-drive.7.md:155-162).
- [ ] The attested model id comes only from the agent's report; missing report → `unreported`, never filled from `CW_AGENT_MODEL` (docs/agent-delegation-drive.7.md:77-86).
- [ ] `backend probe agent`: `readiness: "ready"` iff configured, else `readiness: "unverified"`, `ready: false`, never `refused` (docs/agent-delegation-drive.7.md:130-134).
- [ ] Drive lifecycle `plan -> dispatch -> agent-fulfill -> recordWorkerOutput/verify -> commit`; `--drive --once` moves one step; `run drive <run-id>` is the read-only preview; a repeatedly-failing worker is parked (docs/agent-delegation-drive.7.md:105-143).
- [ ] `quickstart --check` is zero-write preflight; a blocked check exits non-zero (docs/agent-delegation-drive.7.md:188-192).
- [ ] `quickstart --resume` prints a copy-pasteable `cw quickstart --run <id> --resume` continue line; the continuing run echoes `resumedFrom: <id>` (docs/agent-delegation-drive.7.md:194-200).
- [ ] Live view env/flags: everything live goes to stderr, stdout stays data; non-TTY is silent unless `CW_AGENT_STREAM=1`; `--verbose` sets `CW_VERBOSE=1`; `--full` sets `CW_OUTPUT=full`; color follows `NO_COLOR`/`CW_NO_COLOR`/`FORCE_COLOR`/isTTY; complete transcript always at `transcript.md` next to the worker's `result.md` (docs/agent-delegation-drive.7.md:247-283).
- [ ] Failed agent hops drop child stderr to `<run>/workers/<worker>/logs/agent-stderr.log` (docs/agent-delegation-drive.7.md:310-314).
- [ ] Codex wrapper caps reasoning effort at `low` per run; `CW_CODEX_REASONING_EFFORT` raises it (`low|medium|high`); gemini/deepseek model override via `CW_GEMINI_MODEL`/`CW_DEEPSEEK_MODEL` (docs/agent-delegation-drive.7.md:296-308).
- [ ] v0.1.88: `run --drive --incremental` step-level resume; inline `subWorkflow()` nesting; bounded `loop()` phases (docs/agent-delegation-drive.7.md:393-395).

### run-retention-reclamation.7.md — `cw gc *`, `cw orphans *`

- [ ] Verbs: `gc plan|run|verify` with `--reclaimAfterArchiveDays`, `--keep-scratch`, `--keep-snapshots`, `--limit`, `--actor`, `--scope`, `--json` (docs/run-retention-reclamation.7.md:131-144).
- [ ] Eligibility, all needed: derived lifecycle `completed` or `failed`, archived, no open feedback, past `reclaimAfterArchiveDays`; refusal reasons named `non-terminal|not-archived|within-retention|open-feedback` (docs/run-retention-reclamation.7.md:146-150).
- [ ] The never-freed allow-list: `state.json`, `audit/`, `commits/`, the collaboration log, the attestation chain, `report.md`, `reclaimed.json` (docs/run-retention-reclamation.7.md:44-47).
- [ ] Refusal `skeleton-incomplete` frees zero bytes; verify failures `tombstone-digest-mismatch`, `tombstone-chain-broken`, `reconstruction-digest-mismatch` (docs/run-retention-reclamation.7.md:49-53, 79-83, 93-98).
- [ ] Write-ahead order: extractSkeleton → buildTombstone → commitTombstone (fsync) → freeBulk; a crash leaves either the full run or a full tombstone (docs/run-retention-reclamation.7.md:55-71).
- [ ] `cw run show` reports `record.tier`, `record.capability`, and closed-set `record.capabilityReason` (docs/run-retention-reclamation.7.md:84-91).
- [ ] `cw orphans list|gc` reclaims run dirs with no `state.json` (killed before the first checkpoint), age-gated, no skeleton and no tombstone (docs/run-retention-reclamation.7.md:110-122).
- [ ] Named known gap: a stale non-terminal run with a valid `state.json` is reclaimed by neither mechanism (docs/run-retention-reclamation.7.md:124-129).

### durable-state-and-locking.7.md

- [ ] `writeJson(file, value, { durable? })` = temp file + atomic rename; a reader sees old bytes or new bytes, never a torn file; `durable: true` fsyncs file and dir (docs/durable-state-and-locking.7.md:15-28).
- [ ] `withFileLock(targetPath, fn)`: `O_EXCL` (`wx`) lockfile, 30 s stale-steal window, always released in `finally` (docs/durable-state-and-locking.7.md:33-43).
- [ ] v0.1.81: tombstone freed-manifest is path-sorted before hashing, so the hash is order-stable (docs/durable-state-and-locking.7.md:115-117).

### node-snapshot-diff-replay.7.md — `cw node snapshot|diff|replay|verify`

- [ ] Snapshot id is content-addressed `snap-<node>-<fingerprint>`; re-snapshotting an unchanged node is idempotent; stored at `<run>/nodes/snapshots/<node-id>/<snapshot-id>.json` (docs/node-snapshot-diff-replay.7.md:22-28).
- [ ] Freshness `valid|stale|absent`; `stale`/`absent` refuse diff/replay with a structured `NodeSnapshotError` (docs/node-snapshot-diff-replay.7.md:31-40).
- [ ] Diff sections closed set: `status|inputs|outputs|artifacts|evidence|errors|links|metadata`, each `added|removed|changed|same`, byte-identical across runs (docs/node-snapshot-diff-replay.7.md:44-50).
- [ ] Replay carries an `outputFingerprint`; two replays are byte-identical apart from `replayedAt`/`replayId` (docs/node-snapshot-diff-replay.7.md:54-62).

### contract-migration-tooling.7.md — `cw migration *`

- [ ] Verbs: `migration list|check|prove [--contract run-state|workflow-app] [--json]` (docs/contract-migration-tooling.7.md:24-49).
- [ ] Check verdict `status` in `current|migrated|normalized|unsupported`; `unsupported` never writes (docs/contract-migration-tooling.7.md:28-45).
- [ ] Prove asserts four properties: `validatesAtCurrent`, `appendOnly`, `idempotent`, `sourceImmutable`; proof kept append-only at `migration/<fingerprint>.json` (docs/contract-migration-tooling.7.md:50-71).

### team-collaboration.7.md — `cw approve|reject|comment|handoff|review`

- [ ] Verbs and flags per the command block; `<kind>` is one of `run|task|candidate|selection|commit|node` (docs/team-collaboration.7.md:130-144).
- [ ] Actor provenances: `host-attested`, `operator-recorded`, `unattributed`; the missing-identity actor is exactly `{ kind: "unattributed", id: "unattributed", attested: false }` (docs/team-collaboration.7.md:28-34).
- [ ] Review states: `approved|pending|blocked|unattributed|rejected`; not-counted approvals carry a reason from `unattributed|unauthorized-role|self-approval|superseded` (docs/team-collaboration.7.md:85-97).
- [ ] The review gate runs inside `resolveCommitGate` AFTER the verifier checks and can only ADD errors (`review-gate-missing-approvals`); an approval can never turn unverified into committed; default (no policy or `requiredApprovals: 0`) is no gate (docs/team-collaboration.7.md:52-77, 109-116).
- [ ] Records are append-only; a fix is a NEW record with `supersedes` (docs/team-collaboration.7.md:38-50).

### observability-cost-accounting.7.md — `cw metrics *`

- [ ] Verbs: `metrics show <run-id> [--pricing <path>|default] [--json]`; `metrics summary [--scope repo|home]` (docs/observability-cost-accounting.7.md:108-120).
- [ ] Rates over zero samples are `n/a` with `count`/`rate` null — never 0 (docs/observability-cost-accounting.7.md:50-56).
- [ ] Usage is host-attested via `--usage-input-tokens`, `--usage-output-tokens`, `--usage-model`, `--usage-source` on `cw result` and `cw worker output`; missing usage is `unreported`, never 0 (docs/observability-cost-accounting.7.md:58-75).
- [ ] Cost states closed set: `attested|estimated|unpriced|unreported`; the example pricing policy is `manifest/pricing.policy.json` (docs/observability-cost-accounting.7.md:76-96).
- [ ] Per-run report snapshot at `.cw/runs/<id>/metrics/metrics-report.json`; summary counts `unreadableRuns` instead of dropping them (docs/observability-cost-accounting.7.md:44-48, 113-116).

### web-desktop-workbench.7.md — `cw workbench *`

- [ ] `workbench view <run-id> [--json]`; `workbench serve [--port N] [--scope repo|home] [--once|--json]`; `--once`/`--json` print the descriptor and start nothing (docs/web-desktop-workbench.7.md:100-113).
- [ ] HTTP routes: `GET /`, `GET /ui/*`, `GET /api/index`, `GET /api/serve`, `GET /api/run/:runId` (docs/web-desktop-workbench.7.md:115-123).
- [ ] Trust boundary: binds `127.0.0.1` only; every route is `GET`; write verbs get `405`; non-localhost `Host` gets `403`; path traversal out of `ui/workbench/` gets `403` (docs/web-desktop-workbench.7.md:82-92).
- [ ] Each panel is byte-for-byte the matching `cw <cmd> --json` payload; the Workbench holds zero authoritative state (docs/web-desktop-workbench.7.md:23-45).

### report-verifiable-bundle.7.md — `cw run export --with-trust-key`, `cw report bundle|verify-bundle`

- [ ] `run export <run> --with-trust-key <pem-or-path>` embeds an ed25519 PUBLIC key in a `trust` block `{ publicKeyPem, algorithm: "ed25519" }`; flag defaults to `CW_AGENT_ATTEST_PUBKEY`; the CLI form takes a key FILE PATH (inline PEM only via env/programmatic) (docs/report-verifiable-bundle.7.md:26-33).
- [ ] `report verify-bundle <bundle>` verifies offline in a throwaway temp dir; exit non-zero whenever `ok` is false (docs/report-verifiable-bundle.7.md:34-39, 112-119).
- [ ] Key precedence: bundle > `--pubkey` > `CW_AGENT_ATTEST_PUBKEY` (docs/report-verifiable-bundle.7.md:66-68).
- [ ] `trustLevel` is `"signed"` or `"unsigned"`; the forward-only guarantee: signed findings present and unaltered, not report exhaustiveness (docs/report-verifiable-bundle.7.md:87-105).
- [ ] `--strict-signatures` refuses a keyless attested bundle; `--require-signatures` refuses any `trustLevel: "unsigned"` bundle (docs/report-verifiable-bundle.7.md:101-105).
- [ ] `--extract-report <path>` with no `report.md` in the bundle is a failure (`extract-report` / `report-md-unavailable`), not a silent no-op (docs/report-verifiable-bundle.7.md:106-111).
- [ ] Cross-check failure codes: `result-missing`, `result-digest-mismatch:<task>`, `report-result-mismatch:<task>`, `report-findings` (docs/report-verifiable-bundle.7.md:72-85).
- [ ] `report bundle <run>` = export + self-verify; fails closed; `quickstart --bundle` seals only a `status: complete` run and exits non-zero when `result.bundle.ok` is false; bundle output lands in the caller cwd (docs/report-verifiable-bundle.7.md:41-62).

### cross-agent-ledger.7.md — `cw ledger *`

- [ ] Verbs: `ledger propose|review|verify|apply|list`; all write JSON to stdout; `verify`/`apply` read `--file` or stdin (docs/cross-agent-ledger.7.md:47-59). Verified: stdin fallback in `src/cli/handlers/ledger.ts:68-93`.
- [ ] Entry: content-addressed `id` = `ldg-` + first 16 hex of the sha256 digest; digest over a deterministic serialization (keys sorted recursively) of every field except `id` and `digest` (docs/cross-agent-ledger.7.md:41-43).
- [ ] Proposal JSON keys: `kind`, `schemaVersion`, `from`, `to`, `title`, `rationale`, `targetFiles`, `suggestedDiff`, `createdAt`, `id`, `digest`; a review adds `target`, `verdict` (`APPROVED`|`REJECTED`), `findings` (docs/cross-agent-ledger.7.md:156-176).
- [ ] Verify failure codes: `ledger-bad-json`, `ledger-not-object`, `ledger-digest-mismatch`, `ledger-id-mismatch`, plus unknown kind/schema/missing-field/bad-verdict codes; any `ok:false` exits 1 (docs/cross-agent-ledger.7.md:179-192).
- [ ] `apply` prints `{ ok, id, kind, diff }`; `diff` present only when `ok:true`; `ledger-not-a-proposal` and `ledger-empty-diff` give `diff:null` and exit 1; the kernel never runs `git` (docs/cross-agent-ledger.7.md:62-77).
- [ ] `list --dir` is a fail-closed inbox: any bad entry sets `allOk:false` and exit 1; adds a `resolution` block with per-proposal state `pending|approved|rejected|contested` and counts; only verified reviews count (docs/cross-agent-ledger.7.md:97-130).
- [ ] `--dir` is repeatable; one dir keeps the single-dir shape (`dir`, no `dirs`); two or more union-verify as mirrors (`dirs` + per-entry `dirs`), fail-closed across mirrors (docs/cross-agent-ledger.7.md:133-151).
- [ ] MCP peers: `cw_ledger_propose|review|verify|apply|list` (docs/cross-agent-ledger.7.md:16-18).

### remote-source-review.7.md — `--link`, `cw clones *`

- [ ] `cw -q "..." --link <url>` reviews any remote repo; a URL in `-dir`/`--repo` is auto-detected as `--link`; `--ref` picks a branch/tag; `--check` validates without fetching (docs/remote-source-review.7.md:3-14).
- [ ] Git sources: `https://`, `http://`, `ssh://`, `git://`, scp-style, `file://`, shallow (`--depth 1 --single-branch`); archives `.tar.gz`/`.tgz`/`.tar`/`.zip` are `git init`-snapshotted and `commit` is the sha256 of the downloaded bytes (docs/remote-source-review.7.md:16-27).
- [ ] Provenance: `- Source: <url>@<commit>` line in `report.md`; `remote { url, commit, kind, ref, cached }` in the `--json` result; a hash-chained `source.clone`/`source.download` trust-audit event (docs/remote-source-review.7.md:39-45).
- [ ] Credentials in URLs are stripped before caching/printing/persisting; `GIT_TERMINAL_PROMPT=0`; scheme allowlist; `ext::`/`fd::` and `-`-leading injection rejected; hooks disabled with `-c core.hooksPath=`; archive extraction rejects traversal and symlinks and bounds the bomb at 1 GiB; SSRF re-validation on each redirect hop (docs/remote-source-review.7.md:46-67).
- [ ] Cache under `~/.local/state/cool-workflow/clones/<hash>/` (honors `CW_HOME`/`XDG_STATE_HOME`); `--refresh` re-fetches; `cw clones list` and `cw clones gc --older-than-days N | --all`; MCP peers `cw_clones_list`, `cw_clones_gc` (docs/remote-source-review.7.md:69-83).

### release-and-migration.7.md / release-tooling.7.md — release surfaces

- [ ] `cw state check <run-id> [--state PATH] [--write]` is dry-run by default; load order `read JSON -> detect schema -> migrate -> normalize -> validate -> report`; schema-less state is schema `0` and migrates to `1`; newer schemas fail closed (docs/release-and-migration.7.md:10-43).
- [ ] Compatibility statuses: `current|migrated|normalized|unsupported` (docs/release-and-migration.7.md:40).
- [ ] Scripts: `npm run release:check` (build, type check, `npm test`, canonical-apps, golden-path, parity, vendor-manifest drift, `version:sync`, `index:check`, `readme:check`), `npm run bump:version`, `node scripts/new-feature.js`, `node scripts/forward-ref-docs.js` (append-only, idempotent), `npm run sync:readme` (docs/release-tooling.7.md:13-72). Verified: all named npm scripts exist in `package.json`.
- [ ] `scripts/release-flow.js --check | --cut --version V [--push] [--no-release] | --release --version V [--soft]` — the gated release ritual (docs/release-tooling.7.md:163-179).
- [ ] Note on history layers: the v0.1.14 `release:check` step list (docs/release-and-migration.7.md:63-79) was later de-duplicated by v0.1.33 (docs/release-tooling.7.md:56-63). The v0.1.33 list is the live one; the older list is history, not the current contract.

### trust-model.md — `cw telemetry verify`

- [ ] `cw telemetry verify <run>` re-proves the ledger with no key; `--pubkey <pem-or-path>` re-runs ed25519 attribution per `attested` record; MCP peer `cw_telemetry_verify` (docs/trust-model.md:243-250).
- [ ] Signature payload binding: `sign({ usage, runId, taskId, promptDigest })` (docs/trust-model.md:48-56).
- [ ] Verdict states: `attested|unattested|absent`; defaults are honest (no signature ⇒ `unattested`; no usage ⇒ `absent`); the opt-in `require-attested-telemetry` policy fails the run closed (docs/trust-model.md:66-76).
- [ ] Honest limits stated: a keyholder can sign a lie; a determined local writer can re-chain the whole log (genesis is `sha256(runId)`); single-keyholder setups prove integrity, not source honesty (docs/trust-model.md:130-207).

### source-context-profiles.7.md — `scripts/source-context.js`

- [ ] Commands: `profiles`, `manifest --profile P --ref R [--repo-root D]`, `export ... [--changed-from REF] [--cache-dir DIR]`; JSONL on stdout only, diagnostics on stderr (docs/source-context-profiles.7.md:58-74).
- [ ] Profiles: `core` (default), `runtime`, `mcp`, `workflow-apps`, `release`, `agent-wrappers` (docs/source-context-profiles.7.md:8-54).
- [ ] Manifest record shape: `{"path":...,"included":...,"reason":...,"sha256":...}`; export adds `content`; diff mode adds `changedFrom`; broken cache records fail closed (docs/source-context-profiles.7.md:67-88).

### vendor-manifest-loadability.7.md

- [ ] `npm run gen:manifests -- --check` diffs generated manifests; `npm run manifest:load-check` boots each vendor's generated `mcp.json` (resolve `pluginRootVar`, spawn `shell:false`, JSON-RPC `initialize` + `tools/list`) and asserts one `serverInfo.name` and the same tool count across vendors (docs/vendor-manifest-loadability.7.md:12-38). Verified: both npm scripts exist.

### routine.7.md / routines.md / scheduled-tasks.md — `cw routine|schedule|loop`

- [ ] `routine create --kind api|github --prompt P [--match JSON]`, `routine list [--kind]`, `routine delete <id>`, `routine fire <kind> <payload-file>`, `routine events [<id>]`; state in `.cw/routines/triggers.json` and `.cw/routines/payloads/<event-id>.json` (docs/routine.7.md:9-68). Verified paths in `src/triggers.ts:18-19,81`.
- [ ] CW runs no web server for routines; the bridge is a local data store (docs/routine.7.md:31-33).
- [ ] `schedule create --kind loop|cron|reminder ...`, `schedule list|due|complete|pause|resume|run-now|history|delete`, `schedule daemon [--once|--intervalSeconds N]`, and the `cw loop` alias; state in `.cw/schedules/tasks.json`; minute granularity; 7-day default expiry; `jitterSeconds` (docs/scheduled-tasks.md:8-80). Verified path in `src/scheduler.ts:15`.

### dogfood-one-real-repo.7.md / dogfood records

- [ ] `npm run dogfood:release` runs `release-cut` on this repo dry-run and writes `.cw/runs/<run-id>/dogfood-summary.json`; dry-run never tags/pushes/publishes; execute mode needs `--execute --tag --confirm-release-actions=<version>` (docs/dogfood-one-real-repo.7.md:9-126).
- [ ] `scripts/dogfood-architecture-review.js --smoke --json` returns `{ ok: true, mode: "smoke" }` with `reportPath`/`auditSummaryPath` and `audit.byKind["worker.agent-delegation"] >= 1`; the live full-drive is maintainer-run, OUT of CI (docs/dogfood-one-real-repo.7.md:139-175).
- [ ] `docs/dogfood/*.md` are records of real runs, not contracts (docs/dogfood/architecture-review-cool-workflow.md:1-20).

### mcp-app-surface.7.md — MCP naming rules

- [ ] Input names are fixed: `runId`, `appId`, `workerId`, `candidateId`, `selectionId`, `profileId`, `cwd`, `reason`, `evidence`, `criteria` (docs/mcp-app-surface.7.md:12-15).
- [ ] Old tool names keep working; read-only tools change no state; errors fail closed via JSON-RPC errors plus durable ErrorFeedback (docs/mcp-app-surface.7.md:9-16).
- [ ] `cw_dispatch` takes the sandbox field spellings `sandbox`, `sandboxProfile`, `sandboxProfileId`, `profileId` (docs/mcp-app-surface.7.md:105-108).
- [ ] `cw_commit` response keys: `runId`, `commitId`, `verifierGated`, `checkpoint`, verifier/candidate/selection ids, `evidenceCount`, `snapshotPath`, next actions, and the raw commit record (docs/mcp-app-surface.7.md:204-208).

### Non-contract pages

- `getting-started.md`, `index.md`, `project-index.md`, `readme-v0.1.87-full.md`, `release-history.md`, `agent-framework.md`, `unix-principles.md`, `handoff-setup.md`, `designs/handoff-ledger.md` (marked `DRAFT / proposal ... ships no behavior`), `launch/*` — these guide, index, or record; they bind style rules (POLA, Rule of Silence, fail closed, stdout=data) and cross-check counts, but the per-verb contracts live in the `.7.md` pages. `project-index.md` is GENERATED (`npm run sync:project-index`) and its snapshot counts were verified live: version `0.1.98`, 69 source modules, 8 apps, 61 docs, 173 smoke tests (docs/project-index.md:5-13; counted in the tree).

## Exact outputs

These exact strings are promised by the docs and must be byte-reproduced.

Canonical backend evidence triple (docs/execution-backends.7.md:131-139):

```text
command:<command + args>
exitCode:<code>
stdoutSha256:sha256:<hex>
```

Refused runs add a `refused:<code>` evidence line and no `stdoutSha256:` (docs/real-execution-backends.7.md:63-66).

`cw fix` clean output (docs/fix.7.md:21):

```text
No fixes needed.
```

Demo tamper verdict line (docs/launch/pre-launch-checklist.md:20-22):

```text
VERDICT: tamper-evidence holds ✓
```

Checkpoint vs gated commit record (docs/verifier-gated-commit.7.md:52-75):

```json
{ "verifierGated": false, "checkpoint": true }
```

```json
{
  "verifierGated": true,
  "checkpoint": false,
  "verifierNodeId": "run:verifier:task",
  "candidateId": "candidate-one",
  "selectionId": "selection-candidate-one-...",
  "evidence": []
}
```

Sandbox attestation shape (docs/execution-backends.7.md:151-165):

```json
{
  "backendId": "shell",
  "locality": "local",
  "kind": "local",
  "sandboxProfileId": "readonly",
  "required": ["read", "write", "network", "env"],
  "enforced": ["command", "env"],
  "attested": ["read", "write", "network"],
  "unenforceable": [],
  "status": "enforced",
  "enforcedByCW": ["..."],
  "hostRequired": ["..."]
}
```

Ledger entry envelope (docs/cross-agent-ledger.7.md:158-172): `id` is `ldg-<16 hex>`, `digest` is `sha256:<64 hex>`; ledger resolution block shape with `proposals[]` and counts `pending/approved/rejected/contested` (docs/cross-agent-ledger.7.md:108-115).

App validation failure JSON (docs/workflow-app-framework.7.md:175-187): `{ "valid": false, "issues": [{ "code": "workflow-task-duplicate", "message": "Duplicate workflow task id: map:context", "path": "..." }] }` with nonzero exit.

Source-context manifest record (docs/source-context-profiles.7.md:69-71):

```json
{"path":"plugins/cool-workflow/src/state.ts","included":true,"reason":"included:plugins/cool-workflow/src/**","sha256":"..."}
```

Report lines (docs/workflow-app-framework.7.md:252-256): `Workflow App: <id>@<version>` and `Workflow App Source: <manifest-or-entrypoint-path>`; remote review adds `- Source: <url>@<commit>` (docs/remote-source-review.7.md:41).

`run restore` result shape (docs/run-registry-control-plane.7.md:236-237): `{ schemaVersion, ok, target, inspect, imported, verify, registry }`.

Exit-code contracts promised across the man pages:

| Command | Exit 0 | Exit 1 |
| --- | --- | --- |
| `cw doctor` / `cw fix` | no `fail` checks | any `fail` check |
| `cw init` | file written | missing/invalid id, exists w/o `--force` |
| `cw demo tamper|bundle` | all tampers caught | a tamper got through |
| `cw audit verify` | absent/empty chain or verified | any unverified/corrupt chain |
| `cw ledger verify|apply|list` | `ok:true` / `allOk:true` | any `ok:false` |
| `cw run inspect-archive|restore` | `ok:true` | `ok:false` |
| `cw report verify-bundle|bundle` | `ok:true` | `ok:false` |
| `cw run verify-import` | always 0 by default; `--strict` fails on bad checks | with `--strict` |
| `cw quickstart --check` | check passes | blocked check |

## Files on disk

The full `.cw/` layout the docs bind (union over all pages):

```text
<repo>/.cw/runs/<run-id>/
  state.json                      # single source of truth
  report.md
  tasks/<task-id>.md              # + tasks/feedback:<feedback-id>.md
  dispatches/<dispatch-id>.json
  results/<task-id>.md
  nodes/<node-id>.json
  nodes/snapshots/<node-id>/<snapshot-id>.json
  workers/index.json
  workers/<worker-id>/{worker.json,manifest.json,input.md,result.md,artifacts/,logs/}
  workers/<worker-id>/logs/agent-stderr.log     # failed agent hop
  workers/<worker-id>/transcript.md             # full agent narration (wrapper-written, next to result.md)
  feedback/{<feedback-id>.json,index.json}
  candidates/{index.json,ranking.json,<id>/candidate.json,<id>/scores/<score-id>.json,selections/<selection-id>.json}
  commits/<commit-id>.json
  audit/{events.jsonl,index.json,summary.json}
  blackboard/{index.json,messages.jsonl,topics/,contexts/,artifacts/,snapshots/,decisions/}
  multi-agent/{index.json,runs/,roles/,groups/,memberships/,fanouts/,fanins/}
  topologies/{index.json,runs/<topology-run-id>.json}
  summaries/                       # state-explosion summary records
  reasoning/{index.json,chain-<evidence-id>.json,report.json}
  metrics/metrics-report.json
  telemetry.json                   # hash-chained telemetry ledger
  migration/<fingerprint>.json     # append-only migration proofs
  dogfood-summary.json             # dogfood script only

<repo>/.cw/registry/{index.json,archive.json,provenance.json,reclaimed.json}
<repo>/.cw/evals/<suite-id>/{suite.json,snapshot.json,replay-run.json,comparison.json,score.json,findings.json,gate.json,report.md,replay/}
<repo>/.cw/routines/{triggers.json,payloads/<event-id>.json}
<repo>/.cw/schedules/tasks.json
<repo>/.cw/cache/source-context/    # opt-in export cache

$CW_HOME/  (CW_HOME > XDG_STATE_HOME/cool-workflow > ~/.local/state/cool-workflow)
  registry/{repos.json,index.json,queue.json,scheduling-policy.json}
  agent-config.json                # command-template + endpoint + model; never secrets
  clones/<hash>/                   # content-addressed remote checkouts
```

Evidence: docs/pipeline-verbs.7.md:71-79; docs/worker-isolation.7.md:88-101; docs/candidate-scoring.7.md:54-65; docs/error-feedback.7.md:102-110; docs/security-trust-hardening.7.md:11-21; docs/coordinator-blackboard.7.md:53-69; docs/multi-agent-runtime-core.7.md:32-43; docs/multi-agent-topologies.7.md:33-37; docs/state-explosion-management.7.md:44-46; docs/evidence-adoption-reasoning-chain.7.md:69-82; docs/run-registry-control-plane.7.md:81-99; docs/control-plane-scheduling.7.md:19-21; docs/observability-cost-accounting.7.md:44-48; docs/routine.7.md:56-61; docs/scheduled-tasks.md:8-10; docs/remote-source-review.7.md:69-72; docs/agent-delegation-drive.7.md:155-162, 270-274, 310-314; docs/contract-migration-tooling.7.md:68-71; docs/multi-agent-eval-replay-harness.7.md:22-29.

## Invariants and error behavior

Binding rules stated across the docs (docs/unix-principles.md:197-240 is the master list):

1. **POLA** — existing output, layout, exit codes, and flags never change meaning or bytes; new behavior lands behind new verbs/flags/env toggles (docs/unix-principles.md:203-208).
2. **stdout is data, stderr is diagnostics**; a non-interactive run is silent on success; `--json` is stable and decoration-free (docs/unix-principles.md:214-218).
3. **Fail closed, never fabricate** — unconfigured backends probe `unverified`; unverifiable telemetry is loud or refused; invalid results park; no silent fallback (docs/unix-principles.md:220-223).
4. **Zero runtime dependencies is a red line**; adding a model SDK is the red line (docs/unix-principles.md:224-226; docs/agent-delegation-drive.7.md:24-28).
5. **Only verified state becomes committed state**; checkpoints are never presented as gated commits (docs/unix-principles.md:164-184).
6. **Man pages are the contract** — every shipped capability has a `docs/*.7.md` page updated in the same change; doc-drift guards live in the test suite (docs/unix-principles.md:228-230).
7. **Parity fails closed** — a CLI/MCP surface mismatch blocks the release; no "fix later" path (docs/cli-mcp-parity.7.md:348-361).
8. **Derived views never own truth** — registry, summaries, reasoning, metrics, and the Workbench re-derive from `state.json` and report freshness `valid|stale|absent|missing` instead of trusting a cache (docs/run-registry-control-plane.7.md:294-303; docs/state-explosion-management.7.md:143-149; docs/web-desktop-workbench.7.md:74-80).
9. **Append-only history** — resume continues, rerun makes a new linked run, archive marks, reclamation seals + tombstones; no audit/commit/collaboration record is ever rewritten (docs/run-registry-control-plane.7.md:22-24; docs/run-retention-reclamation.7.md:73-83; docs/team-collaboration.7.md:38-50).
10. **Atomicity/ordering** — temp+rename writes, fsync for authoritative stores, lock-serialized cross-process read-modify-write, write-ahead reclamation (docs/durable-state-and-locking.7.md:15-67).
11. **Release ritual** — main is -CURRENT, a tag is -RELEASE only after the deterministic gate and an independent review (docs/unix-principles.md:235-238; docs/release-tooling.7.md:163-179).

## Edge cases

- Old run state without `schemaVersion` is schema `0` and migrates; newer-than-runtime schemas fail closed; unknown user data is kept (docs/release-and-migration.7.md:29-35, 143-150).
- Pre-feature runs normalize with empty blocks (multiAgent, blackboard, summaries, reasoning); pre-0.1.25/0.1.26 eval snapshots load with empty sections (docs/multi-agent-runtime-core.7.md:211-230; docs/coordinator-blackboard.7.md:177-182; docs/multi-agent-eval-replay-harness.7.md:9-19).
- A run id with embedded `..` (like `v1..2`) is a legal directory name at import; only true traversal ids are refused (docs/run-registry-control-plane.7.md:184-187).
- A fully-corrupt audit log reports `present:false` but still `verified:false` — the gate keys on `verified` so total corruption cannot pass as "absent" (docs/multi-agent-trust-policy-audit.7.md:135-139).
- An absent/empty audit or trust chain verifies true (nothing to prove — no false red) (docs/multi-agent-trust-policy-audit.7.md:140-142; docs/run-registry-control-plane.7.md:196-197).
- Post-commit missing evidence for never-driven sibling roles is `inspectable`, not `blocking` (docs/multi-agent-operator-ux.7.md:26-34).
- `sched reclaim` on a dead host counts as a failed attempt, recorded, not silently reset (docs/control-plane-scheduling.7.md:47-49).
- A container CLI with a dead daemon is caught by a pre-flight `<runtime> version --format {{.Server.Version}}`, not by the run's exit code (docs/real-execution-backends.7.md:70-74).
- Two `cw ledger propose` calls mint two different entries (fresh `createdAt`); capture the output once (docs/handoff-setup.md:94-96).
- The clones cache is keyed on URL(+ref), not content; upstream changes are unseen until `--refresh` (docs/remote-source-review.7.md:85-88).
- Orphan run dirs (no first `state.json`) are invisible to `gc` and only `cw orphans` reclaims them; a stale non-terminal run with a valid `state.json` is reclaimed by neither (docs/run-retention-reclamation.7.md:110-129).
- A bare `claude -p` or `claude -p {{input}}` does NOT complete a worker; the bundled wrapper is needed (docs/agent-delegation-drive.7.md:169-172).
- An inline PEM starts with `-----` and would parse as a flag, so the CLI takes a key file path only (docs/report-verifiable-bundle.7.md:30-33).

## Evidence

All pointers are relative to `plugins/cool-workflow/`. Each checklist row above carries its own `docs/<file>:<lines>` pointer. Source cross-checks done for this spec:

- Capability/tool counts: dist/capability-registry.js (live: 209 capabilities, 196 MCP tools, 13 cli-only, 12 projected) vs docs/cli-mcp-parity.7.md:84-86 (agrees) vs docs/capability-topology-registry.7.md:90 (stale "199" — drift, see below).
- Doctor checks: src/doctor.ts:92,100,122,130,138,145 (all six names, statuses agree with docs/doctor.7.md:36-62).
- `CW_BACKEND` precedence: src/execution-backend.ts:356,373-376.
- `buildChildEnv` baseline: src/drive.ts:584; src/execution-backend.ts:556,840,945.
- Builtin templates: scripts/agents/builtin-templates.json (six entries, matches docs/agent-delegation-drive.7.md:285-301).
- Ledger stdin fallback: src/cli/handlers/ledger.ts:68-93.
- `audit-run` alias: src/cli/command-surface.ts:213; src/capability-registry.ts:508-509.
- Routine/schedule paths: src/triggers.ts:18-19,81; src/scheduler.ts:15.
- npm scripts named by docs: package.json (`fixture-compat`, `version:sync`, `dogfood:release`, `eval:replay`, `parity:check`, `gen:manifests`, `manifest:load-check`, `release:check`, `sync:project-index`, `index:check`, `readme:check`, `sync:readme`, `bump:version`, `golden-path`, `canonical-apps`, `onramp:check`, `test:fast` — all present).
- project-index snapshot counts: docs/project-index.md:5-13 vs live counts (69 src/*.ts, 8 apps/, 61 docs/*.md, 173 test/*-smoke.js — all agree).

## Doc drift — doc says, code must be checked

1. **CONFIRMED small drift**: docs/capability-topology-registry.7.md:90 says `registrySize` is `199`; the live registry is `209`. The sentence hedges with "at the time of writing" and points at `parity-check` for the live number.
2. **Doc says, code must be checked**: docs/release-and-migration.7.md:63-79 lists ~14 individual `release:check` steps; docs/release-tooling.7.md:56-63 says most were removed as duplicates of `npm test`. The live `release:check` script is the authority; the older list must not be rebuilt as-is.
3. **Doc says, code must be checked**: docs/coordinator-blackboard.7.md:119-137 shows `blackboard resolve --id bb --title ...` and `blackboard topic create --id topic ...` flag spellings; the parity matrix names the verbs but not the flags. Flag names must be read from `src/cli/handlers/blackboard.ts` before pinning tests.
4. **Doc says, code must be checked**: docs/multi-agent-topologies.7.md:50 shows `topology apply <run-id> map-reduce --task map:server-api --mapper-count 2`; the `--mapper-count`/`--judge-count` flag spellings ("mapperCount"/"judgeCount" overrides per docs/capability-topology-registry.7.md:180-183) need a source check.
5. **Doc says, code must be checked**: docs/getting-started.md:20 and docs/doctor.7.md say `doctor --onramp --changed-from origin/main`; the interaction (whether `--changed-from` works without `--onramp`) is undefined in the doc.
6. **Doc says, code must be checked**: docs/mcp-app-surface.7.md:112-127 markets `cw_multi_agent_run` etc. as v0.1.20 tools — all present in the matrix, but the doc also mentions `cw_sandbox_choose` AND `cw_sandbox_resolve` as separate tools while the matrix maps both to the one core `sandboxChoose` (docs/cli-mcp-parity.7.md:200-201). Payload sameness between the two spellings must be checked.
7. **History-page noise**: most `.7.md` pages end with a long tail of per-release forward-reference sections and bare version strings (`0.1.51`, `0.1.76`, ... `0.1.98`), appended by `scripts/forward-ref-docs.js`. These are release bookkeeping, not behavior; a rebuild must not read the tail sections as current contracts for the page's own subsystem.

## Pinned by tests

Doc-drift and doc-named behavior guards under `test/` (from docs/project-index.md:204-378 and the docs themselves):

- `test/parity-doc-sync-smoke.js` — the generated parity matrix in cli-mcp-parity.7.md matches the registry.
- `test/cli-mcp-parity-smoke.js` — registry ⇄ CLI ⇄ MCP coverage and payload identity (docs/cli-mcp-parity.7.md:384-393).
- `test/project-index-sync-smoke.js` — project-index.md stays code-derived.
- `test/readme-sync-smoke.js`, `test/readme-trust-claim-smoke.js` — README/npm README sync and trust-claim wording.
- `test/cw-help-per-command-smoke.js` — help output lists every command.
- `test/doctor-smoke.js` — doctor checks and exits.
- `test/tamper-evidence-demo-smoke.js`, `test/demo-bundle-smoke.js`, `test/end-to-end-demo-smoke.js` — demo verbs.
- `test/end-to-end-golden-path-smoke.js`, `test/canonical-workflow-apps-smoke.js` — golden path and app matrix.
- `test/mcp-app-surface-smoke.js`, `test/mcp-tool-call-coverage-smoke.js`, `test/mcp-surface-registry-smoke.js` — MCP surface.
- `test/multi-agent-cli-mcp-surface-smoke.js`, `test/multi-agent-operator-ux-smoke.js`, `test/multi-agent-trust-policy-audit-smoke.js`, `test/multi-agent-eval-replay-harness-smoke.js`, `test/multi-agent-runtime-core-smoke.js`, `test/coordinator-blackboard-smoke.js`, `test/multi-agent-topologies-{map-reduce,debate,judge-panel}-smoke.js` — multi-agent pages.
- `test/run-registry-control-plane-smoke.js`, `test/run-export-import-smoke.js`, `test/run-import-tamper-failclosed-smoke.js`, `test/run-import-path-traversal-smoke.js`, `test/run-inspect-archive-smoke.js`, `test/run-restore-failclosed-smoke.js`, `test/verify-import-audit-chain-smoke.js`, `test/run-resume-drive-smoke.js` — registry/archive pages.
- `test/control-plane-scheduling-smoke.js`, `test/sched-policy-validation-smoke.js` — sched page.
- `test/execution-backends-smoke.js`, `test/real-execution-backends-smoke.js`, `test/execution-backend-agent-smoke.js`, `test/execution-backend-ci-smoke.js`, `test/agent-stream-gate-smoke.js` — backend pages.
- `test/agent-delegation-drive-smoke.js`, `test/quickstart-*.js`, `test/{claude-p,codex,gemini,gemini-opencode,deepseek,opencode}-agent-wrapper-smoke.js`, `test/headline-commands-smoke.js`, `test/incremental-resume-smoke.js`, `test/sub-workflow-nesting-smoke.js`, `test/loop-bounded-expansion-smoke.js` — agent-delegation page.
- `test/run-retention-reclamation-smoke.js`, `test/orphan-runs-gc-smoke.js`, `test/clones-gc-smoke.js` — reclamation pages.
- `test/durable-atomic-write-smoke.js`, `test/agent-config-atomic-write-smoke.js` — durable-state page.
- `test/node-snapshot-diff-replay-smoke.js`, `test/state-node-smoke.js`, `test/pipeline-runner-smoke.js` — node pages.
- `test/contract-migration-tooling-smoke.js`, `test/run-fixture-compat-smoke.js`, `test/schema-validation-smoke.js` — migration pages.
- `test/team-collaboration-smoke.js`, `test/observability-cost-accounting-smoke.js`, `test/web-desktop-workbench-smoke.js` — collaboration/metrics/workbench pages.
- `test/report-bundle-smoke.js`, `test/report-verify-bundle-smoke.js`, `test/telemetry-*.js`, `test/audit-verify-smoke.js` — trust pages.
- `test/ledger-verify-smoke.js`, `test/ledger-apply-smoke.js`, `test/ledger-resolution-smoke.js` — ledger page.
- `test/remote-link-git-smoke.js`, `test/remote-link-archive-smoke.js` — remote-source page.
- `test/sandbox-profile-smoke.js`, `test/worker-isolation-smoke.js`, `test/verifier-gated-commit-smoke.js`, `test/candidate-scoring-smoke.js`, `test/error-feedback-smoke.js` — kernel pages.
- `test/source-context-profile-smoke.js`, `test/vendor-manifest-load-smoke.js`, `test/vendor-preflight-smoke.js` — context/manifest pages.
- `test/schedule-routine-daemon-smoke.js` — schedule/routine pages.
- `test/release-tooling-smoke.js`, `test/release-flow-smoke.js`, `test/release-gate-smoke.js`, `test/bump-version-idempotent-smoke.js`, `test/block-unapproved-tag-smoke.js` — release pages.

## Rebuild risks

1. **The forward-reference tails.** Nearly every `.7.md` ends with ~30 appended per-release sections and bare version strings. A rebuilder that treats them as page content will invent behavior; a rebuilder that drops them breaks `version:sync` (each doc must carry the current version string). The tails are made by `scripts/forward-ref-docs.js` and are append-only + idempotent (docs/release-tooling.7.md:47-54).
2. **Generated blocks inside docs.** `cli-mcp-parity.7.md` has `<!-- gen:parity:count -->`, `<!-- gen:parity:table -->`, `<!-- gen:parity:cliOnly -->`, `<!-- gen:parity:projected -->` blocks made from the registry and gated by `test/parity-doc-sync-smoke.js`; `project-index.md` is fully generated by `npm run sync:project-index`. Hand-editing these breaks the gates.
3. **Exact strings are load-bearing.** The evidence triple lines, the commit-gate feedback codes, the ledger error codes, the doctor check names, `No fixes needed.`, and `VERDICT: tamper-evidence holds ✓` are tested byte-for-byte. Any "cleanup" of these strings fails smokes.
4. **Two different "handoff" ideas.** `cw handoff` (team-collaboration ownership transfer) and the cross-agent `cw ledger` (docs/cross-agent-ledger.7.md:20-23) are separate; and the `sched` namespace (queue leases) is separate from `schedule` (wall-clock loop/cron) (docs/control-plane-scheduling.7.md:10-12). Merging either pair breaks the surface.
5. **`checkpoint` vs `committed`.** The commit-node status split (`completed`+`checkpoint:true` vs `committed`+`verifierGated:true`) is easy to flatten into one "commit" concept; the docs bind both shapes and the gate between them.
6. **Attest vs enforce.** Sandbox profiles under the `node` backend attest, they do not enforce; the attestation lists (`enforced`/`attested`/`unenforceable`) and the refusal-not-fallback rule must survive; a rebuild that "just enforces" or "just skips" both breaks the contract.
7. **Exit-0 readers vs exit-1 gates.** Pairs like `audit summary` (always 0) vs `audit verify` (gate), and `run verify-import` (0 by default, `--strict` gates) vs `run restore` (always gates) are deliberate; swapping them silently changes scripts that pipe on `&&`.
8. **Basic English + exact code names.** The prose is Ogden Basic English by project rule, but every command, flag, env var, code string, and output line is verbatim. A rebuild that "improves" the prose must not touch quoted strings.
