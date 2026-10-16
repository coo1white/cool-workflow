"use strict";
// core/capability-data.ts — THE one data table's pure literal data: types,
// the MCP_TOOL_DATA transcript, and the handful of dependency-free helpers
// that only touch that data.
//
// Split out of core/capability-table.ts (which still wires this data into
// the REGISTRY, attaches CLI bindings, and holds the real handler bodies —
// all of which import from ../shell/ and stay there). This file has ZERO
// imports of its own: no reference-site changes anywhere else, since
// capability-table.ts imports everything below and re-exports the types
// external files already import from it.
//
// MILESTONE 2 (plugins/cool-workflow/project/docs/rebuild/PLAN.md build order, step 2). Replaces the old build's
// `capability-registry.ts` (940 lines) + 40 CLI handler files + the
// 196-arm MCP switch + the 1000-line tool-definitions array with ONE data
// table plus two generic front-door readers (`cli/dispatch.ts`,
// `mcp/dispatch.ts`).
//
// Byte-compat item 5 (plugins/cool-workflow/project/docs/rebuild/PLAN.md): 12 capabilities have CLI and MCP call
// DIFFERENT functions with DIFFERENT payloads. So a row carries a SEPARATE
// `cli.handler` and `mcp.handler`, never one shared "handler" — even
// though every row landed so far happens to share one function, the type
// itself must not collapse the two fields into one, or a later milestone
// would need a breaking shape change to add the first real divergent row.
//
// `MCP_TOOL_DATA` below is the full, literal 196-tool surface transcribed
// from SPEC/mcp.md's "All 196 MCP tools" table (name, capability id,
// required-argument groups, input property names, description) — this is
// exactly the kind of declarative surface data this table exists to hold.
// Every tool's `mcp.handler` not listed in capability-table.ts's
// MCP_REAL_HANDLERS side table is `notYetImplemented(capability)`, which
// throws a clean, typed error if ever actually called. A NEW post-rebuild
// capability is APPENDED after the transcript's last row (never inserted),
// so every existing position keeps its pinned order.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_TOOL_DATA = exports.MCP_CORE_TOOLS = exports.MCP_TOOL_ANNOTATIONS = exports.COMMON_PROPERTY_TYPES = exports.PROPERTY_OVERRIDES = exports.CapabilityNotImplementedError = void 0;
exports.notYetImplemented = notYetImplemented;
exports.stringProperty = stringProperty;
/** Thrown by every not-yet-wired MCP tool handler. Never hit by this
 *  milestone's conformance filter — every tool mcp-basic.case.js actually
 *  calls (`cw_list`, `cw_sandbox_list`) has a real handler below. */
class CapabilityNotImplementedError extends Error {
    constructor(capability) {
        super(`${capability} is not implemented in this milestone`);
        this.name = "CapabilityNotImplementedError";
    }
}
exports.CapabilityNotImplementedError = CapabilityNotImplementedError;
function notYetImplemented(capability) {
    return () => {
        throw new CapabilityNotImplementedError(capability);
    };
}
function stringProperty(name) {
    return { type: "string", description: name };
}
/** SPEC/mcp.md's two hand-written property-shape exceptions (see that
 *  file's "All 196 MCP tools" section header note): these two properties
 *  win over `COMMON_PROPERTY_TYPES` below, since each is a one-off shape
 *  tied to its own tool, not a shape shared by the property name at large. */
exports.PROPERTY_OVERRIDES = {
    cw_report: {
        answer: { type: "boolean", description: "Also return the report's answer: { taskId, summary, evidence }, or null when the run has none yet" },
        markdown: { type: "boolean", description: "Also return the text of report.md" },
    },
    cw_commit: {
        allowUnverifiedCheckpoint: {
            type: "boolean",
            description: "Write a non-gated checkpoint instead of committed state",
        },
    },
    cw_routine_fire: {
        payload: { type: "object", description: "Event payload" },
    },
};
/** A real type and a true, short, one-sentence description for every
 *  property name used anywhere in `MCP_TOOL_DATA` below, keyed by the
 *  PROPERTY NAME (not the tool name) — the same name means the same
 *  thing on every tool that uses it. `mcpToolDefinitions()` in
 *  wiring/capability-table/registry-core.ts looks a property up here
 *  only when `PROPERTY_OVERRIDES` has no entry for it on that tool; a
 *  name not found in either table falls back to the plain
 *  `stringProperty` form (there should be very few of those — the two
 *  names left out here, `allowUnverifiedCheckpoint` and `payload`, are
 *  already covered by `PROPERTY_OVERRIDES` on their one tool each). */
exports.COMMON_PROPERTY_TYPES = {
    actor: { type: "string", description: "the name of the actor doing this" },
    agentCommand: { type: "string", description: "the command template used to run the agent" },
    agentEndpoint: { type: "string", description: "the network address of the agent service" },
    agentModel: { type: "string", description: "the name of the agent model to use" },
    all: { type: "boolean", description: "when true, act on every item, not only old ones" },
    app: { type: "string", description: "the workflow app's id" },
    appId: { type: "string", description: "the workflow app's id" },
    archive: { type: "string", description: "the path to the run archive file" },
    backend: { type: "string", description: "the name of the execution backend" },
    backendId: { type: "string", description: "the id of the execution backend" },
    backoffBaseMs: { type: "number", description: "the starting wait time, in milliseconds, before a retry" },
    backoffCapMs: { type: "number", description: "the largest wait time, in milliseconds, before a retry" },
    backoffFactor: { type: "number", description: "the number the wait time is multiplied by after each retry" },
    baselineSnapshotId: { type: "string", description: "the id of the baseline snapshot" },
    bundle: { type: "string", description: "the path to the run bundle file" },
    candidate: { type: "string", description: "the candidate's id" },
    candidateId: { type: "string", description: "the candidate's id" },
    candidateSnapshotId: { type: "string", description: "the id of the candidate snapshot" },
    code: { type: "string", description: "a short error or status code" },
    command: { type: "string", description: "the command that was run or checked" },
    commit: { type: "string", description: "the commit's id" },
    commitId: { type: "string", description: "the commit's id" },
    concurrency: { type: "number", description: "the largest number of steps to run at once" },
    contract: { type: "string", description: "the pipeline contract's id" },
    contractId: { type: "string", description: "the pipeline contract's id" },
    cron: { type: "string", description: "the cron schedule text" },
    cwd: { type: "string", description: "the working directory to run in" },
    delayMinutes: { type: "number", description: "the number of minutes to wait before the task runs" },
    diff: { type: "string", description: "the change text (diff) for this proposal" },
    dir: { type: "string", description: "the path to one ledger directory" },
    directory: { type: "string", description: "the directory path to write into" },
    dirs: { type: "array", description: "the list of ledger directory paths" },
    entry: { type: "string", description: "the ledger entry to check" },
    env: { type: "object", description: "the environment variables for this step" },
    expectCount: { type: "number", description: "the event count the chain must match" },
    expectHead: { type: "string", description: "the head hash the chain must match" },
    extractReport: { type: "boolean", description: "when true, also pull the plain report out of the bundle" },
    failed: { type: "boolean", description: "when true, mark the lease as failed" },
    feedbackId: { type: "string", description: "the id of the feedback record" },
    file: { type: "string", description: "the path to the archive file" },
    files: { type: "array", description: "the list of file paths this change touches" },
    findings: { type: "array", description: "the list of review findings" },
    from: { type: "string", description: "the actor this comes from" },
    hostEnforced: { type: "boolean", description: "when true, the host, not the agent, enforced the sandbox rule" },
    id: { type: "string", description: "the id of this item" },
    includeArchived: { type: "boolean", description: "when true, also list archived runs" },
    inputs: { type: "object", description: "the structured input values for the app" },
    intervalMinutes: { type: "number", description: "how often, in minutes, the task should repeat" },
    keepCommits: { type: "number", description: "the number of recent commits to keep" },
    keepScratch: { type: "boolean", description: "when true, keep scratch files instead of freeing them" },
    keepSnapshots: { type: "number", description: "the number of recent snapshots to keep" },
    kind: { type: "string", description: "the kind of this item" },
    leaseId: { type: "string", description: "the id of the queue lease" },
    leaseTtlMs: { type: "number", description: "how long, in milliseconds, a lease stays valid" },
    limit: { type: "number", description: "the largest number of items to return" },
    match: { type: "string", description: "the text pattern used to match trigger events" },
    maxAttempts: { type: "number", description: "the largest number of retry attempts allowed" },
    maxConcurrent: { type: "number", description: "the largest number of runs allowed at once" },
    message: { type: "string", description: "the message text" },
    minAgeMinutes: { type: "number", description: "the least age, in minutes, an item must have" },
    network: { type: "string", description: "the network access rule that was checked" },
    node: { type: "string", description: "the state node's id" },
    nodeId: { type: "string", description: "the state node's id" },
    note: { type: "string", description: "a short free-text note" },
    now: { type: "string", description: "the time to treat as \"now\", for a stable, repeatable result" },
    offset: { type: "number", description: "how many items to skip before returning results" },
    olderThanDays: { type: "number", description: "the least age, in days, an item must have" },
    once: { type: "boolean", description: "when true, run only one step, then stop" },
    output: { type: "string", description: "the output file path to write" },
    path: { type: "string", description: "a file path" },
    port: { type: "number", description: "the network port to use" },
    pricing: { type: "string", description: "the pricing table to use for cost figures" },
    priority: { type: "number", description: "the queue order priority" },
    profileFile: { type: "string", description: "the path to the sandbox profile file" },
    profileId: { type: "string", description: "the id of the sandbox profile" },
    prompt: { type: "string", description: "the prompt text for this task" },
    pubkey: { type: "string", description: "the public key used to check a signature" },
    question: { type: "string", description: "the question that starts the run" },
    queue: { type: "boolean", description: "when true, also add a tier-3 breach to the queue" },
    rationale: { type: "string", description: "the reason behind this decision" },
    reason: { type: "string", description: "a short text that explains why" },
    reclaimAfterArchiveDays: { type: "number", description: "how many days after archive before a run can be freed" },
    replayId: { type: "string", description: "the replay's id" },
    repo: { type: "string", description: "the path to the repo" },
    requireToken: { type: "boolean", description: "when true, require a token to reach the host" },
    resultPath: { type: "string", description: "the file path to the result" },
    retryable: { type: "boolean", description: "when true, mark this failure as safe to retry" },
    runId: { type: "string", description: "the run's id" },
    sandbox: { type: "string", description: "the sandbox profile choice" },
    sandboxProfile: { type: "string", description: "the sandbox profile's id" },
    sandboxProfileId: { type: "string", description: "the sandbox profile's id" },
    scope: { type: "string", description: "which repos to search, such as this repo or all repos" },
    since: { type: "string", description: "the start of the time range to search" },
    snapshotId: { type: "string", description: "the snapshot's id" },
    state: { type: "string", description: "the run state to check or set" },
    status: { type: "string", description: "the status to filter or set" },
    strictSignatures: { type: "boolean", description: "when true, fail closed if a signature cannot be checked" },
    target: { type: "string", description: "the id of the target this acts on" },
    taskId: { type: "string", description: "the task's id" },
    text: { type: "string", description: "free-text search terms" },
    title: { type: "string", description: "a short title for this item" },
    to: { type: "string", description: "the actor this is handed to" },
    trustKey: { type: "string", description: "the trust key used to seal the run" },
    unarchive: { type: "boolean", description: "when true, undo an archive mark instead of setting one" },
    until: { type: "string", description: "the end of the time range to search" },
    url: { type: "string", description: "a web address (http or https)" },
    verdict: { type: "string", description: "the review verdict" },
    verifier: { type: "string", description: "the name of the verifier" },
    verifierNode: { type: "string", description: "the id of the node holding the verifier result" },
    verify: { type: "boolean", description: "when true, also verify the result after this step" },
    withTrustKey: { type: "boolean", description: "when true, seal the output with the trust key" },
    worker: { type: "string", description: "the worker's id" },
    workerId: { type: "string", description: "the worker's id" },
    workflowId: { type: "string", description: "the workflow definition's id" },
    write: { type: "boolean", description: "when true, save the result instead of only reading it" },
};
/** Behavior hints per MCP tool name, surfaced as the standard MCP
 *  `annotations` field on each `tools/list` entry. A side table (like
 *  `MCP_REAL_HANDLERS` in wiring/capability-table/registry-core.ts) so
 *  `MCP_TOOL_DATA` below stays a pure transcript of the spec table.
 *
 *  The rule for this table is strict, because a wrong hint is a safety
 *  bug (a client may skip its confirmation step for a "read-only" tool):
 *   - `readOnlyHint: true` ONLY for a tool whose handler was read and
 *     seen to do no write at all (no saveCheckpoint, no writeJson, no
 *     writeReport, no fs write of any kind);
 *   - `destructiveHint: true` for a tool whose handler was read and seen
 *     to delete stored data (gc / delete sweeps);
 *   - every other tool is ABSENT from this table and gets no
 *     annotations. Absent beats wrong. Some absences that look like
 *     reads are deliberate: cw_metrics_show persists its derived report,
 *     cw_workbench_view calls the metrics.show handler for one panel,
 *     cw_operator_report re-writes report.md, cw_schedule_due marks
 *     expired tasks, and cw_run_resume can take the opt-in --drive path. */
exports.MCP_TOOL_ANNOTATIONS = {
    // pure reads, in MCP_TOOL_DATA order (each handler checked by hand)
    cw_list: { readOnlyHint: true },
    cw_status: { readOnlyHint: true },
    cw_next: { readOnlyHint: true },
    cw_contract_show: { readOnlyHint: true },
    cw_node_list: { readOnlyHint: true },
    cw_node_show: { readOnlyHint: true },
    cw_node_graph: { readOnlyHint: true },
    cw_migration_list: { readOnlyHint: true },
    cw_operator_status: { readOnlyHint: true },
    cw_operator_graph: { readOnlyHint: true },
    cw_worker_summary: { readOnlyHint: true },
    cw_feedback_summary: { readOnlyHint: true },
    cw_commit_summary: { readOnlyHint: true },
    cw_audit_summary: { readOnlyHint: true },
    cw_audit_verify: { readOnlyHint: true },
    cw_audit_worker: { readOnlyHint: true },
    cw_audit_provenance: { readOnlyHint: true },
    cw_sandbox_list: { readOnlyHint: true },
    cw_sandbox_show: { readOnlyHint: true },
    cw_sandbox_validate: { readOnlyHint: true },
    cw_backend_list: { readOnlyHint: true },
    cw_backend_show: { readOnlyHint: true },
    cw_backend_agent_config_show: { readOnlyHint: true },
    cw_app_list: { readOnlyHint: true },
    cw_app_show: { readOnlyHint: true },
    cw_app_validate: { readOnlyHint: true },
    cw_worker_list: { readOnlyHint: true },
    cw_worker_show: { readOnlyHint: true },
    cw_feedback_list: { readOnlyHint: true },
    cw_feedback_show: { readOnlyHint: true },
    cw_ledger_verify: { readOnlyHint: true },
    cw_ledger_apply: { readOnlyHint: true },
    cw_ledger_list: { readOnlyHint: true },
    cw_schedule_list: { readOnlyHint: true },
    cw_schedule_history: { readOnlyHint: true },
    cw_routine_list: { readOnlyHint: true },
    cw_routine_events: { readOnlyHint: true },
    cw_registry_show: { readOnlyHint: true },
    cw_metrics_summary: { readOnlyHint: true },
    cw_run_search: { readOnlyHint: true },
    cw_run_list: { readOnlyHint: true },
    cw_run_show: { readOnlyHint: true },
    cw_run_inspect_archive: { readOnlyHint: true },
    cw_run_drive: { readOnlyHint: true },
    cw_queue_list: { readOnlyHint: true },
    cw_queue_show: { readOnlyHint: true },
    cw_sched_plan: { readOnlyHint: true },
    cw_sched_policy_show: { readOnlyHint: true },
    cw_gc_plan: { readOnlyHint: true },
    cw_gc_verify: { readOnlyHint: true },
    cw_clones_list: { readOnlyHint: true },
    cw_orphans_list: { readOnlyHint: true },
    cw_telemetry_verify: { readOnlyHint: true },
    cw_history: { readOnlyHint: true },
    cw_audit_head: { readOnlyHint: true },
    // delete sweeps (each handler checked by hand: all delete stored data)
    cw_schedule_delete: { readOnlyHint: false, destructiveHint: true },
    cw_routine_delete: { readOnlyHint: false, destructiveHint: true },
    cw_gc_run: { readOnlyHint: false, destructiveHint: true },
    cw_clones_gc: { readOnlyHint: false, destructiveHint: true },
    cw_orphans_gc: { readOnlyHint: false, destructiveHint: true },
};
/** The MCP `core` tool profile: what `tools/list` shows when
 *  CW_MCP_TOOLS is unset or `core` (mcp/server.ts), in this order.
 *  `CW_MCP_TOOLS=full` lists every tool. The profile decides only what is
 *  listed; `tools/call` still takes every known tool name. It keeps a
 *  client's context small: the full list was about 104 KB, these twelve
 *  about 6.7 KB (measured 2026-09-28). */
exports.MCP_CORE_TOOLS = [
    "cw_app_list",
    "cw_app_show",
    "cw_app_run",
    "cw_run_drive_step",
    "cw_status",
    "cw_report",
    "cw_run_resume",
    "cw_run_list",
    "cw_audit_verify",
    "cw_backend_probe",
    "cw_run_export",
    "cw_run_restore",
];
exports.MCP_TOOL_DATA = [
    { tool: "cw_list", capability: "list", requiredArgs: [], properties: [], description: "List bundled CW workflows." },
    { tool: "cw_plan", capability: "plan", requiredArgs: ["workflowId"], properties: ["workflowId", "repo", "question"], description: "Create a CW run and return its canonical plan summary." },
    { tool: "cw_app_run", capability: "app.run", requiredArgs: ["appId"], properties: ["cwd", "appId", "inputs", "sandbox", "sandboxProfile", "sandboxProfileId"], description: "Create a run from an app id + structured inputs." },
    { tool: "cw_status", capability: "status", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read run checkpoint status. The quick first check on one run: lifecycle, task counts, and next actions. For the fuller operator view use cw_operator_status; for every panel in one call use cw_workbench_view." },
    { tool: "cw_init", capability: "init", requiredArgs: ["workflowId"], properties: ["workflowId", "title", "output"], description: "Scaffold a new workflow definition." },
    { tool: "cw_next", capability: "next", requiredArgs: ["runId"], properties: ["runId", "cwd", "limit"], description: "Read the next recommended tasks for a run." },
    { tool: "cw_state_check", capability: "state.check", requiredArgs: ["runId"], properties: ["runId", "cwd", "state", "write"], description: "Check run-state schema compatibility." },
    { tool: "cw_contract_show", capability: "contract.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "contractId"], description: "Show a run's pipeline contract." },
    { tool: "cw_node_list", capability: "node.list", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "List state nodes for a run." },
    { tool: "cw_node_show", capability: "node.show", requiredArgs: ["runId, nodeId"], properties: ["runId", "cwd", "nodeId"], description: "Show one state node for a run." },
    { tool: "cw_node_graph", capability: "node.graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the state-node graph for a run." },
    { tool: "cw_node_snapshot", capability: "node.snapshot", requiredArgs: [], properties: ["runId", "cwd", "nodeId"], description: "Snapshot one state node (derived + fingerprinted)." },
    { tool: "cw_node_diff", capability: "node.diff", requiredArgs: [], properties: ["runId", "cwd", "baselineSnapshotId", "candidateSnapshotId"], description: "Structurally diff two node snapshots." },
    { tool: "cw_node_replay", capability: "node.replay", requiredArgs: [], properties: ["runId", "cwd", "snapshotId"], description: "Deterministically replay one node from a snapshot." },
    { tool: "cw_node_replay_verify", capability: "node.replay.verify", requiredArgs: [], properties: ["runId", "cwd", "replayId"], description: "Verify a node replay against its source." },
    { tool: "cw_migration_list", capability: "migration.list", requiredArgs: [], properties: [], description: "List the declared migration registry." },
    { tool: "cw_migration_check", capability: "migration.check", requiredArgs: [], properties: ["target", "contract", "cwd"], description: "Dry-run migration verdict for a target." },
    { tool: "cw_migration_prove", capability: "migration.prove", requiredArgs: [], properties: ["target", "contract", "cwd"], description: "Round-trip / non-destruction migration proof for a target." },
    { tool: "cw_operator_status", capability: "operator.status", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured Operator UX run status. Fuller than cw_status: workers, feedback, and commits in one operator view. For every panel in one call use cw_workbench_view." },
    { tool: "cw_operator_graph", capability: "graph", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured Operator UX run graph." },
    { tool: "cw_operator_report", capability: "operator.report", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Refresh and read the structured Operator UX report summary." },
    { tool: "cw_worker_summary", capability: "worker.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured worker summary for a run." },
    { tool: "cw_workbench_view", capability: "workbench.view", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the read-only Workbench view of one run (graph, worker, metrics, audit). The widest one-call overview; prefer it when you want everything at once. For one quick answer use cw_status or cw_operator_status instead." },
    { tool: "cw_workbench_serve", capability: "workbench.serve", requiredArgs: [], properties: ["cwd", "port", "scope", "requireToken"], description: "Describe/serve the optional localhost-only, read-only Workbench host. requireToken is a CLI-only opt-in (the MCP path never actually binds, so it is a no-op here)." },
    { tool: "cw_feedback_summary", capability: "feedback.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured feedback summary for a run." },
    { tool: "cw_commit_summary", capability: "commit.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the structured commit summary for a run." },
    { tool: "cw_audit_summary", capability: "audit.summary", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the trust/audit summary." },
    { tool: "cw_audit_verify", capability: "audit.verify", requiredArgs: ["runId"], properties: ["runId", "cwd", "expectHead", "expectCount"], description: "Re-prove a run's trust-audit hash chain (fail-closed exit)." },
    { tool: "cw_audit_repair", capability: "audit.repair", requiredArgs: ["runId"], properties: ["runId", "cwd", "write", "expectHead", "expectCount"], description: "Repair a torn trailing write in a run's trust-audit event log (dry-run unless write is set; fails closed if the corruption is not confined to the trailing line, or if expectHead/expectCount is given and not met)." },
    { tool: "cw_audit_worker", capability: "audit.worker", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId"], description: "Read trust/audit for one worker." },
    { tool: "cw_audit_provenance", capability: "audit.provenance", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "worker", "candidateId", "candidate", "commitId", "commit"], description: "Inspect evidence provenance." },
    { tool: "cw_audit_attest", capability: "audit.attest", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "worker", "actor", "hostEnforced", "env", "note"], description: "Record a host/operator sandbox attestation." },
    { tool: "cw_audit_decision", capability: "audit.decision", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "path", "command", "network", "env", "kind"], description: "Validate and record a sandbox decision." },
    { tool: "cw_dispatch", capability: "dispatch", requiredArgs: ["runId"], properties: ["runId", "cwd", "limit", "sandbox", "sandboxProfile", "sandboxProfileId", "backend", "backendId"], description: "Create a subagent dispatch manifest." },
    { tool: "cw_sandbox_list", capability: "sandbox.list", requiredArgs: [], properties: ["cwd"], description: "List bundled sandbox profiles." },
    { tool: "cw_sandbox_show", capability: "sandbox.show", requiredArgs: ["profileId"], properties: ["cwd", "profileId"], description: "Show a resolved sandbox profile." },
    { tool: "cw_sandbox_validate", capability: "sandbox.validate", requiredArgs: ["profileFile"], properties: ["cwd", "profileFile"], description: "Validate a sandbox profile JSON file." },
    { tool: "cw_sandbox_choose", capability: "sandbox.choose", requiredArgs: [], properties: ["cwd", "profileId", "sandbox", "sandboxProfile", "sandboxProfileId"], description: "Resolve and validate a sandbox profile choice." },
    { tool: "cw_backend_list", capability: "backend.list", requiredArgs: [], properties: ["cwd"], description: "List available execution backends and their capabilities." },
    { tool: "cw_backend_show", capability: "backend.show", requiredArgs: [], properties: ["cwd", "backendId"], description: "Show one execution backend descriptor." },
    { tool: "cw_backend_probe", capability: "backend.probe", requiredArgs: [], properties: ["cwd", "backendId"], description: "Probe execution backend readiness (live, deterministic)." },
    { tool: "cw_backend_agent_config_show", capability: "backend.agent.config.show", requiredArgs: [], properties: ["cwd", "agentCommand", "agentEndpoint", "agentModel"], description: "Show the effective agent delegation config (flags>env>file, secret-stripped, host-stable)." },
    { tool: "cw_backend_agent_config_set", capability: "backend.agent.config.set", requiredArgs: [], properties: ["cwd", "agentCommand", "agentEndpoint", "agentModel"], description: "Set the durable agent delegation config (command-template/endpoint/model; API keys never written)." },
    { tool: "cw_result", capability: "result", requiredArgs: ["runId"], properties: ["runId", "taskId", "resultPath", "cwd"], description: "Record a subagent result file against a task." },
    { tool: "cw_commit", capability: "commit", requiredArgs: ["runId"], properties: ["runId", "reason", "verifier", "verifierNode", "allowUnverifiedCheckpoint", "cwd"], description: "Create a verifier-gated commit or checkpoint." },
    { tool: "cw_report", capability: "report", requiredArgs: ["runId"], properties: ["runId", "cwd", "answer", "markdown"], description: "Render a run report and return its canonical descriptor. answer: true also returns the report's answer (summary and evidence); markdown: true also returns the report.md text." },
    { tool: "cw_app_list", capability: "app.list", requiredArgs: [], properties: ["cwd"], description: "List CW workflow apps." },
    { tool: "cw_app_show", capability: "app.show", requiredArgs: [], properties: ["cwd", "appId"], description: "Show a CW workflow app contract." },
    { tool: "cw_app_validate", capability: "app.validate", requiredArgs: [], properties: ["cwd", "target"], description: "Validate an app by path or id." },
    { tool: "cw_app_init", capability: "app.init", requiredArgs: [], properties: ["cwd", "appId", "title", "directory"], description: "Create a CW workflow app directory." },
    { tool: "cw_app_package", capability: "app.package", requiredArgs: [], properties: ["cwd", "appId", "output"], description: "Package an app as a JSON artifact." },
    { tool: "cw_worker_list", capability: "worker.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "status"], description: "List worker isolation scopes." },
    { tool: "cw_worker_show", capability: "worker.show", requiredArgs: ["runId, workerId"], properties: ["runId", "cwd", "workerId"], description: "Show one worker isolation scope." },
    { tool: "cw_worker_manifest", capability: "worker.manifest", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId"], description: "Write and return a worker manifest." },
    { tool: "cw_worker_output", capability: "worker.output", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "resultPath"], description: "Record worker output." },
    { tool: "cw_worker_fail", capability: "worker.fail", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "message", "code", "path", "retryable"], description: "Record a structured worker failure." },
    { tool: "cw_worker_validate", capability: "worker.validate", requiredArgs: ["runId"], properties: ["runId", "cwd", "workerId", "path", "resultPath"], description: "Validate a worker output boundary." },
    { tool: "cw_ledger_propose", capability: "ledger.propose", requiredArgs: ["from", "to", "title", "rationale"], properties: ["from", "to", "title", "rationale", "files", "diff"], description: "Build a verifiable cross-agent change proposal entry (printed as JSON)." },
    { tool: "cw_ledger_review", capability: "ledger.review", requiredArgs: ["from", "to", "target", "verdict"], properties: ["from", "to", "target", "verdict", "findings"], description: "Build a verifiable cross-agent review verdict entry (printed as JSON)." },
    { tool: "cw_ledger_verify", capability: "ledger.verify", requiredArgs: ["entry"], properties: ["entry"], description: "Verify a ledger entry against its content digest (fail-closed on tampering)." },
    { tool: "cw_ledger_apply", capability: "ledger.apply", requiredArgs: ["entry"], properties: ["entry"], description: "Verify a proposal entry and return its suggestedDiff for `git apply` (fail-closed: no diff unless the entry verifies as a proposal)." },
    { tool: "cw_ledger_list", capability: "ledger.list", requiredArgs: ["dir|dirs"], properties: ["dir", "dirs"], description: "Read + verify every entry in one or more shared ledger directories (fail-closed inbox; 2+ dirs union-verify mirrors)." },
    { tool: "cw_feedback_list", capability: "feedback.list", requiredArgs: ["runId"], properties: ["runId", "cwd", "status"], description: "List run feedback records." },
    { tool: "cw_feedback_show", capability: "feedback.show", requiredArgs: ["runId, feedbackId"], properties: ["runId", "feedbackId", "cwd"], description: "Show a run feedback record." },
    { tool: "cw_feedback_collect", capability: "feedback.collect", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Collect feedback from failed nodes." },
    { tool: "cw_feedback_task", capability: "feedback.task", requiredArgs: ["runId"], properties: ["runId", "feedbackId", "cwd", "verify"], description: "Create a correction task for feedback." },
    { tool: "cw_feedback_resolve", capability: "feedback.resolve", requiredArgs: ["runId"], properties: ["runId", "feedbackId", "cwd", "node", "status"], description: "Resolve or reject feedback." },
    { tool: "cw_schedule_create", capability: "schedule.create", requiredArgs: [], properties: ["cwd", "kind", "prompt", "intervalMinutes", "cron", "delayMinutes"], description: "Create a scheduled CW task." },
    { tool: "cw_schedule_list", capability: "schedule.list", requiredArgs: [], properties: ["cwd", "status"], description: "List scheduled CW tasks." },
    { tool: "cw_schedule_due", capability: "schedule.due", requiredArgs: [], properties: ["cwd"], description: "List due scheduled CW tasks." },
    { tool: "cw_schedule_complete", capability: "schedule.complete", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Mark a scheduled task complete." },
    { tool: "cw_schedule_pause", capability: "schedule.pause", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Pause a scheduled CW task." },
    { tool: "cw_schedule_resume", capability: "schedule.resume", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Resume a scheduled CW task." },
    { tool: "cw_schedule_run_now", capability: "schedule.run-now", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Create an immediate scheduled-task run record." },
    { tool: "cw_schedule_history", capability: "schedule.history", requiredArgs: [], properties: ["cwd", "id"], description: "List scheduled-task run history." },
    { tool: "cw_schedule_delete", capability: "schedule.delete", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Delete a scheduled CW task." },
    { tool: "cw_routine_create", capability: "routine.create", requiredArgs: [], properties: ["cwd", "kind", "prompt", "match"], description: "Create a routine-style API/GitHub trigger." },
    { tool: "cw_routine_list", capability: "routine.list", requiredArgs: [], properties: ["cwd", "kind"], description: "List routine-style triggers." },
    { tool: "cw_routine_fire", capability: "routine.fire", requiredArgs: ["kind"], properties: ["cwd", "kind", "payload"], description: "Record an API/GitHub trigger event." },
    { tool: "cw_routine_events", capability: "routine.events", requiredArgs: [], properties: ["cwd", "id"], description: "List routine trigger events." },
    { tool: "cw_routine_delete", capability: "routine.delete", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Delete a routine-style trigger." },
    { tool: "cw_registry_refresh", capability: "registry.refresh", requiredArgs: [], properties: ["cwd", "scope"], description: "Recompute and persist the derived run registry index." },
    { tool: "cw_registry_show", capability: "registry.show", requiredArgs: [], properties: ["cwd", "scope"], description: "Read the run registry index with valid|stale|absent freshness." },
    { tool: "cw_metrics_show", capability: "metrics.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "pricing", "now"], description: "Read the derived per-run observability + attested-cost report (durations, failure/verifier/acceptance rates with sample counts, attested usage, cost, coverage)." },
    { tool: "cw_metrics_summary", capability: "metrics.summary", requiredArgs: [], properties: ["cwd", "scope", "pricing", "now", "limit"], description: "Read the cross-repo observability + cost rollup over the v0.1.28 run registry, with per-app and per-backend breakdowns." },
    { tool: "cw_run_search", capability: "run.search", requiredArgs: [], properties: ["cwd", "scope", "text", "app", "status", "repo", "since", "until", "includeArchived", "limit", "offset"], description: "Search runs by app/status/time/repo/free-text, deterministic + paginated." },
    { tool: "cw_run_list", capability: "run.list", requiredArgs: [], properties: ["cwd", "scope", "includeArchived", "limit", "offset"], description: "List indexed runs across repos (search with no filters)." },
    { tool: "cw_run_show", capability: "run.show", requiredArgs: ["runId"], properties: ["runId", "cwd", "scope"], description: "Resolve one run by id across the registry; fail closed on missing source." },
    { tool: "cw_run_resume", capability: "run.resume", requiredArgs: ["runId"], properties: ["runId", "cwd", "scope", "limit"], description: "Resolve a run by id and return its next runnable tasks/actions (read-only by default; the opt-in --drive/--once mode hands it to the shared agent-drive core, which mutates and is covered by run.drive.step)." },
    { tool: "cw_run_archive", capability: "run.archive", requiredArgs: ["runId|olderThanDays"], properties: ["runId", "cwd", "scope", "reason", "unarchive", "olderThanDays", "state"], description: "Archive/unarchive a run (overlay mark; never deletes source)." },
    { tool: "cw_run_rerun", capability: "run.rerun", requiredArgs: ["runId"], properties: ["runId", "cwd", "scope", "reason"], description: "Re-run a failed run as a NEW run linked to the original by provenance." },
    { tool: "cw_run_export", capability: "run.export", requiredArgs: ["runId"], properties: ["runId", "cwd", "output", "path", "archive", "trustKey", "withTrustKey"], description: "Export a run to a portable archive with run-local files and digest integrity." },
    { tool: "cw_run_import", capability: "run.import", requiredArgs: ["archive|path|file"], properties: ["archive", "path", "file", "target", "repo", "cwd"], description: "Restore a portable run archive into a target repo and verify restored file digests." },
    { tool: "cw_run_verify_import", capability: "run.verify-import", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Verify an imported run against its restore manifest and telemetry chain." },
    { tool: "cw_run_inspect_archive", capability: "run.inspect-archive", requiredArgs: ["archive|path|file"], properties: ["archive", "path", "file", "cwd"], description: "Read-only integrity inspection of a portable run archive without importing it." },
    { tool: "cw_run_restore", capability: "run.restore", requiredArgs: ["archive|path|file"], properties: ["archive", "path", "file", "target", "repo", "cwd"], description: "Fail-closed restore of a portable run archive: integrity-inspect, import, and verify in one step; refuses anything that does not verify." },
    { tool: "cw_report_verify_bundle", capability: "report.verify-bundle", requiredArgs: ["archive|path|file|bundle"], properties: ["archive", "path", "file", "bundle", "pubkey", "extractReport", "strictSignatures", "cwd"], description: "Offline self-contained verify of a portable run bundle: archive bytes + telemetry chain + trust-audit chain + embedded-key signatures." },
    { tool: "cw_report_bundle", capability: "report.bundle", requiredArgs: ["runId"], properties: ["runId", "cwd", "output", "path", "trustKey", "withTrustKey", "extractReport", "strictSignatures"], description: "Produce-and-prove: export a run to a portable bundle sealed with the trust key, then self-verify it offline (fail-closed) so the producer knows it is verifiable before shipping." },
    { tool: "cw_run_drive", capability: "run.drive", requiredArgs: [], properties: ["runId", "cwd"], description: "Preview the next agent-delegation drive step for a run (read-only, deterministic)." },
    { tool: "cw_run_drive_step", capability: "run.drive.step", requiredArgs: [], properties: ["runId", "appId", "repo", "question", "once", "now", "concurrency", "cwd"], description: "Drive a run by delegating each worker to the agent backend (plan->dispatch->fulfill->accept->commit; --once for one step)." },
    { tool: "cw_queue_add", capability: "queue.add", requiredArgs: [], properties: ["cwd", "runId", "appId", "workflowId", "repo", "priority", "note"], description: "Enqueue a pending/planned run with explicit ordering policy." },
    { tool: "cw_queue_list", capability: "queue.list", requiredArgs: [], properties: ["cwd", "status", "repo"], description: "List the durable run queue in policy order." },
    { tool: "cw_queue_drain", capability: "queue.drain", requiredArgs: [], properties: ["cwd", "limit", "repo"], description: "Mark the next ready queue entries drained (the host still executes)." },
    { tool: "cw_queue_show", capability: "queue.show", requiredArgs: ["id"], properties: ["cwd", "id"], description: "Show one durable queue entry." },
    { tool: "cw_sched_plan", capability: "sched.plan", requiredArgs: [], properties: ["cwd"], description: "Read-only control-plane lease plan for the queue+policy+now." },
    { tool: "cw_sched_lease", capability: "sched.lease", requiredArgs: [], properties: ["cwd", "limit"], description: "Claim eligible queue entries as leases (concurrency-bounded)." },
    { tool: "cw_sched_release", capability: "sched.release", requiredArgs: [], properties: ["cwd", "leaseId", "failed", "reason"], description: "Release a held lease (failed -> retry/backoff or park)." },
    { tool: "cw_sched_complete", capability: "sched.complete", requiredArgs: [], properties: ["cwd", "leaseId"], description: "Complete a held lease (terminal success)." },
    { tool: "cw_sched_reclaim", capability: "sched.reclaim", requiredArgs: [], properties: ["cwd"], description: "Reclaim expired leases (each counts a failed attempt)." },
    { tool: "cw_sched_reset", capability: "sched.reset", requiredArgs: [], properties: ["cwd", "id"], description: "Reset a parked entry to ready (operator recovery)." },
    { tool: "cw_sched_policy_show", capability: "sched.policy.show", requiredArgs: [], properties: ["cwd"], description: "Show the scheduling policy (file or default)." },
    { tool: "cw_sched_policy_set", capability: "sched.policy.set", requiredArgs: [], properties: ["cwd", "maxConcurrent", "maxAttempts", "leaseTtlMs", "backoffBaseMs", "backoffFactor", "backoffCapMs"], description: "Set scheduling policy fields (concurrency/attempts/backoff/TTL)." },
    { tool: "cw_gc_plan", capability: "gc.plan", requiredArgs: [], properties: ["cwd", "scope", "runId", "reclaimAfterArchiveDays", "keepScratch", "keepSnapshots", "keepCommits"], description: "Dry-run plan of run reclamation (per-kind bytes + capability downgrade); frees nothing." },
    { tool: "cw_gc_run", capability: "gc.run", requiredArgs: [], properties: ["cwd", "scope", "runId", "reclaimAfterArchiveDays", "keepScratch", "keepSnapshots", "keepCommits", "limit", "actor"], description: "Execute the write-ahead reclamation transaction (skeleton -> tombstone -> fsync -> free)." },
    { tool: "cw_gc_verify", capability: "gc.verify", requiredArgs: ["runId"], properties: ["cwd", "scope", "runId"], description: "Re-prove a reclaimed run: skeleton-complete, tombstone chain untampered, artifacts reconstructable." },
    { tool: "cw_clones_list", capability: "clones.list", requiredArgs: [], properties: [], description: "List the cached remote-source checkouts that --link/URL reviews populate (origin URL, kind, commit, age, bytes). Read-only." },
    { tool: "cw_clones_gc", capability: "clones.gc", requiredArgs: [], properties: ["olderThanDays", "all"], description: "Reclaim cached remote-source checkouts: a TTL sweep (--older-than-days, default 30) or --all. Deletes only inside the clones cache." },
    { tool: "cw_orphans_list", capability: "orphans.list", requiredArgs: [], properties: ["cwd", "scope"], description: "List run directories under .cw/runs/ that the run registry cannot see (no state.json — a killed/interrupted process never wrote one), with age + bytes. Read-only." },
    { tool: "cw_orphans_gc", capability: "orphans.gc", requiredArgs: [], properties: ["cwd", "scope", "minAgeMinutes", "all"], description: "Reclaim orphan run directories (no state.json): an age sweep (--min-age-minutes, default 60) or --all. Deletes only inside a scanned repo's .cw/runs/, never a run the registry knows about." },
    { tool: "cw_telemetry_verify", capability: "telemetry.verify", requiredArgs: ["runId"], properties: ["cwd", "runId", "pubkey"], description: "Re-prove a run's telemetry attestation ledger offline: chain linkage + independent hash recompute, and (with --pubkey / CW_AGENT_ATTEST_PUBKEY) re-verify each attested hop's ed25519 signature against the public key." },
    { tool: "cw_history", capability: "history", requiredArgs: [], properties: ["cwd", "scope", "app", "status", "limit", "offset"], description: "Read a cross-repo unified run timeline (newest first)." },
    // --- post-rebuild additions (appended; see the header note above) ---
    { tool: "cw_audit_head", capability: "audit.head", requiredArgs: ["runId"], properties: ["runId", "cwd"], description: "Read the trust-audit chain head anchor (event count + head hash) for a later truncation-proof audit.verify." },
    { tool: "cw_run_link", capability: "run.link", requiredArgs: ["runId", "url"], properties: ["runId", "cwd", "scope", "url", "kind", "note", "actor"], description: "Add an append-only link (PR/issue/ticket url) to a run record; no network call. A repeat of the same url is an idempotent no-op." },
];
