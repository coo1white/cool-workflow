import path from "node:path";
import {
  CURRENT_RUN_STATE_SCHEMA_VERSION,
  LEGACY_RUN_STATE_SCHEMA_VERSION,
  MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION
} from "./version";
import { LoopStage, WorkflowRun } from "./types";

export type StateCompatibilityStatus = "current" | "migrated" | "normalized" | "unsupported";

export interface StateMigrationChange {
  path: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

export interface StateMigrationReport {
  status: StateCompatibilityStatus;
  statePath?: string;
  detectedSchemaVersion: number;
  currentSchemaVersion: number;
  supportedSchemaVersions: {
    min: number;
    max: number;
  };
  dryRun: boolean;
  writeRequired: boolean;
  changes: StateMigrationChange[];
  warnings: string[];
  errors: string[];
}

export interface StateMigrationResult {
  run: WorkflowRun;
  report: StateMigrationReport;
}

export interface StateMigrationStep {
  from: number;
  to: number;
  description: string;
  migrate(state: Record<string, unknown>, context: StateMigrationContext): void;
}

interface StateMigrationContext {
  statePath?: string;
  changes: StateMigrationChange[];
  errors: string[];
}

export const RUN_STATE_MIGRATIONS: StateMigrationStep[] = [
  {
    from: LEGACY_RUN_STATE_SCHEMA_VERSION,
    to: CURRENT_RUN_STATE_SCHEMA_VERSION,
    description: "Mark legacy run state without schemaVersion as run-state schema 1.",
    migrate(state, context) {
      setDefault(state, "schemaVersion", CURRENT_RUN_STATE_SCHEMA_VERSION, context, "legacy run state did not declare schemaVersion");
    }
  }
];

export function migrateRunState(
  input: unknown,
  options: { statePath?: string; dryRun?: boolean } = {}
): StateMigrationResult {
  const report: StateMigrationReport = {
    status: "current",
    statePath: options.statePath,
    detectedSchemaVersion: detectSchemaVersion(input),
    currentSchemaVersion: CURRENT_RUN_STATE_SCHEMA_VERSION,
    supportedSchemaVersions: {
      min: MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION,
      max: CURRENT_RUN_STATE_SCHEMA_VERSION
    },
    dryRun: Boolean(options.dryRun),
    writeRequired: false,
    changes: [],
    warnings: [],
    errors: []
  };

  if (!isRecord(input)) {
    report.status = "unsupported";
    report.errors.push("Run state must be a JSON object.");
    return { run: {} as WorkflowRun, report };
  }

  if (report.detectedSchemaVersion < MIN_SUPPORTED_RUN_STATE_SCHEMA_VERSION) {
    report.status = "unsupported";
    report.errors.push(`Unsupported run-state schemaVersion ${schemaVersionDescription(input, report.detectedSchemaVersion)}.`);
    return { run: clone(input) as unknown as WorkflowRun, report };
  }
  if (report.detectedSchemaVersion > CURRENT_RUN_STATE_SCHEMA_VERSION) {
    report.status = "unsupported";
    report.errors.push(
      `Run state schemaVersion ${schemaVersionDescription(input, report.detectedSchemaVersion)} is newer than this CW runtime (${CURRENT_RUN_STATE_SCHEMA_VERSION}).`
    );
    return { run: clone(input) as unknown as WorkflowRun, report };
  }

  const state = clone(input) as Record<string, unknown>;
  const context: StateMigrationContext = { statePath: options.statePath, changes: report.changes, errors: report.errors };
  let schemaVersion = report.detectedSchemaVersion;
  while (schemaVersion < CURRENT_RUN_STATE_SCHEMA_VERSION) {
    const step = RUN_STATE_MIGRATIONS.find((candidate) => candidate.from === schemaVersion);
    if (!step) {
      report.status = "unsupported";
      report.errors.push(`No migration step from run-state schemaVersion ${schemaVersion}.`);
      return { run: state as unknown as WorkflowRun, report };
    }
    step.migrate(state, context);
    schemaVersion = step.to;
  }

  normalizeRunState(state, context);
  validateMigratedRunState(state, report);

  report.writeRequired = report.changes.length > 0;
  if (report.errors.length > 0) report.status = "unsupported";
  else if (report.detectedSchemaVersion < CURRENT_RUN_STATE_SCHEMA_VERSION) report.status = "migrated";
  else if (report.changes.length > 0) report.status = "normalized";
  else report.status = "current";

  return { run: state as unknown as WorkflowRun, report };
}

function normalizeRunState(state: Record<string, unknown>, context: StateMigrationContext): void {
  const runDir = context.statePath ? path.dirname(context.statePath) : undefined;
  const id = stringValue(state.id) || (runDir ? path.basename(runDir) : "unknown-run");
  const now = new Date(0).toISOString();

  setDefault(state, "id", id, context, "run id is required");
  setDefault(state, "createdAt", stringValue(state.updatedAt) || now, context, "createdAt is required");
  setDefault(state, "updatedAt", stringValue(state.createdAt) || now, context, "updatedAt is required");
  setDefault(state, "cwd", runDir ? path.resolve(runDir, "..", "..", "..") : process.cwd(), context, "cwd is required");
  setDefault(state, "inputs", {}, context, "inputs must be present");
  setDefault(state, "loopStage", "interpret", context, "loopStage is required");
  if (!isLoopStage(state.loopStage)) setValue(state, "loopStage", "interpret", context, "unsupported loopStage normalized");

  const workflow = ensureRecord(state, "workflow", context, "workflow metadata is required");
  setDefault(workflow, "id", stringValue(state.workflowId) || "unknown-workflow", context, "workflow.id is required", "workflow.id");
  setDefault(workflow, "title", titleize(String(workflow.id)), context, "workflow.title is required", "workflow.title");
  setDefault(workflow, "summary", "", context, "workflow.summary is required", "workflow.summary");
  setDefault(workflow, "limits", { maxAgents: 8, maxConcurrentAgents: 4 }, context, "workflow.limits is required", "workflow.limits");

  const paths = ensureRecord(state, "paths", context, "run paths are required");
  const baseRunDir = stringValue(paths.runDir) || runDir || path.join(String(state.cwd), ".cw", "runs", id);
  setDefault(paths, "runDir", baseRunDir, context, "paths.runDir is required", "paths.runDir");
  setDefault(paths, "state", path.join(baseRunDir, "state.json"), context, "paths.state is required", "paths.state");
  setDefault(paths, "report", path.join(baseRunDir, "report.md"), context, "paths.report is required", "paths.report");
  setDefault(paths, "tasksDir", path.join(baseRunDir, "tasks"), context, "paths.tasksDir is required", "paths.tasksDir");
  setDefault(paths, "resultsDir", path.join(baseRunDir, "results"), context, "paths.resultsDir is required", "paths.resultsDir");
  setDefault(paths, "dispatchesDir", path.join(baseRunDir, "dispatches"), context, "paths.dispatchesDir is required", "paths.dispatchesDir");
  setDefault(paths, "artifactsDir", path.join(baseRunDir, "artifacts"), context, "paths.artifactsDir is required", "paths.artifactsDir");
  setDefault(paths, "commitsDir", path.join(baseRunDir, "commits"), context, "paths.commitsDir is required", "paths.commitsDir");
  setDefault(paths, "stateNodesDir", path.join(baseRunDir, "nodes"), context, "paths.stateNodesDir is required", "paths.stateNodesDir");
  setDefault(paths, "feedbackDir", path.join(baseRunDir, "feedback"), context, "paths.feedbackDir is required", "paths.feedbackDir");
  setDefault(paths, "auditDir", path.join(baseRunDir, "audit"), context, "paths.auditDir is required", "paths.auditDir");
  setDefault(paths, "workersDir", path.join(baseRunDir, "workers"), context, "paths.workersDir is required", "paths.workersDir");
  setDefault(paths, "candidatesDir", path.join(baseRunDir, "candidates"), context, "paths.candidatesDir is required", "paths.candidatesDir");
  setDefault(paths, "multiAgentDir", path.join(baseRunDir, "multi-agent"), context, "paths.multiAgentDir is required", "paths.multiAgentDir");
  setDefault(paths, "blackboardDir", path.join(baseRunDir, "blackboard"), context, "paths.blackboardDir is required", "paths.blackboardDir");
  setDefault(paths, "topologiesDir", path.join(baseRunDir, "topologies"), context, "paths.topologiesDir is required", "paths.topologiesDir");

  ensureArray(state, "tasks", context);
  ensureArray(state, "dispatches", context);
  ensureArray(state, "commits", context);
  ensureArray(state, "nodes", context);
  ensureArray(state, "contracts", context);
  ensureArray(state, "feedback", context);
  if (!isRecord(state.audit)) {
    if (state.audit !== undefined) context.errors.push("audit must be an object when present.");
    setValue(state, "audit", {
      schemaVersion: 1,
      eventLogPath: path.join(String(paths.auditDir), "events.jsonl"),
      summaryPath: path.join(String(paths.auditDir), "summary.json"),
      indexPath: path.join(String(paths.auditDir), "index.json")
    }, context, "audit metadata is required");
  }
  ensureArray(state, "workers", context);
  ensureArray(state, "sandboxProfiles", context);
  ensureArray(state, "candidates", context);
  ensureArray(state, "candidateSelections", context);
  if (!isRecord(state.multiAgent)) {
    if (state.multiAgent !== undefined) context.errors.push("multiAgent must be an object when present.");
    setValue(state, "multiAgent", {
      schemaVersion: 1,
      runs: [],
      roles: [],
      groups: [],
      memberships: [],
      fanouts: [],
      fanins: []
    }, context, "multiAgent state is required");
  } else {
    const multiAgent = state.multiAgent as Record<string, unknown>;
    setDefault(multiAgent, "schemaVersion", 1, context, "multiAgent.schemaVersion is required", "multiAgent.schemaVersion");
    for (const key of ["runs", "roles", "groups", "memberships", "fanouts", "fanins"]) {
      if (!Array.isArray(multiAgent[key])) {
        if (multiAgent[key] !== undefined) context.errors.push(`multiAgent.${key} must be an array when present.`);
        setValue(multiAgent, key, [], context, `multiAgent.${key} must be an array`, `multiAgent.${key}`);
      }
    }
  }
  if (!isRecord(state.blackboard)) {
    if (state.blackboard !== undefined) context.errors.push("blackboard must be an object when present.");
    setValue(state, "blackboard", {
      schemaVersion: 1,
      boards: [],
      topics: [],
      messages: [],
      contexts: [],
      artifacts: [],
      snapshots: [],
      decisions: []
    }, context, "blackboard state is required");
  } else {
    const blackboard = state.blackboard as Record<string, unknown>;
    setDefault(blackboard, "schemaVersion", 1, context, "blackboard.schemaVersion is required", "blackboard.schemaVersion");
    for (const key of ["boards", "topics", "messages", "contexts", "artifacts", "snapshots", "decisions"]) {
      if (!Array.isArray(blackboard[key])) {
        if (blackboard[key] !== undefined) context.errors.push(`blackboard.${key} must be an array when present.`);
        setValue(blackboard, key, [], context, `blackboard.${key} must be an array`, `blackboard.${key}`);
      }
    }
  }
  if (!isRecord(state.topologies)) {
    if (state.topologies !== undefined) context.errors.push("topologies must be an object when present.");
    setValue(state, "topologies", {
      schemaVersion: 1,
      runs: []
    }, context, "topologies state is required");
  } else {
    const topologies = state.topologies as Record<string, unknown>;
    setDefault(topologies, "schemaVersion", 1, context, "topologies.schemaVersion is required", "topologies.schemaVersion");
    if (!Array.isArray(topologies.runs)) {
      if (topologies.runs !== undefined) context.errors.push("topologies.runs must be an array when present.");
      setValue(topologies, "runs", [], context, "topologies.runs must be an array", "topologies.runs");
    }
  }

  // Team Collaboration (v0.1.32) is purely additive: pre-v0.1.32 runs carry no
  // `collaboration` and load unchanged (absent => no approvals, no review gate).
  // When present, normalize its append-only arrays so a partial object is honest.
  if (state.collaboration !== undefined) {
    if (!isRecord(state.collaboration)) {
      context.errors.push("collaboration must be an object when present.");
      setValue(state, "collaboration", { schemaVersion: 1, approvals: [], comments: [], handoffs: [] }, context, "collaboration must be an object");
    } else {
      const collaboration = state.collaboration as Record<string, unknown>;
      setDefault(collaboration, "schemaVersion", 1, context, "collaboration.schemaVersion is required", "collaboration.schemaVersion");
      for (const key of ["approvals", "comments", "handoffs"]) {
        if (!Array.isArray(collaboration[key])) {
          if (collaboration[key] !== undefined) context.errors.push(`collaboration.${key} must be an array when present.`);
          setValue(collaboration, key, [], context, `collaboration.${key} must be an array`, `collaboration.${key}`);
        }
      }
    }
  }

  if (!Array.isArray(state.phases)) {
    if (state.phases !== undefined) context.errors.push("phases must be an array when present.");
    const phases = derivePhases(Array.isArray(state.tasks) ? state.tasks : []);
    setValue(state, "phases", phases, context, "phases derived from tasks");
  }
}

function validateMigratedRunState(state: Record<string, unknown>, report: StateMigrationReport): void {
  for (const key of ["schemaVersion", "id", "createdAt", "updatedAt", "cwd", "workflow", "inputs", "loopStage", "phases", "tasks", "dispatches", "commits", "paths"]) {
    if (!(key in state)) report.errors.push(`Missing required run-state field: ${key}.`);
  }
  if (state.schemaVersion !== CURRENT_RUN_STATE_SCHEMA_VERSION) {
    report.errors.push(`Expected schemaVersion ${CURRENT_RUN_STATE_SCHEMA_VERSION}; found ${String(state.schemaVersion)}.`);
  }
  if (!isRecord(state.workflow)) report.errors.push("workflow must be an object.");
  if (!isRecord(state.paths)) report.errors.push("paths must be an object.");
  for (const key of ["phases", "tasks", "dispatches", "commits"]) {
    if (!Array.isArray(state[key])) report.errors.push(`${key} must be an array.`);
  }
  if (!isRecord(state.multiAgent)) report.errors.push("multiAgent must be an object.");
  if (!isRecord(state.blackboard)) report.errors.push("blackboard must be an object.");
  if (!isRecord(state.topologies)) report.errors.push("topologies must be an object.");
}

function detectSchemaVersion(value: unknown): number {
  if (!isRecord(value) || value.schemaVersion === undefined) return LEGACY_RUN_STATE_SCHEMA_VERSION;
  if (!Number.isInteger(value.schemaVersion)) return Number.POSITIVE_INFINITY;
  return Number(value.schemaVersion);
}

function schemaVersionDescription(input: unknown, detected: number): string {
  if (!isRecord(input)) return "non-object";
  if (input.schemaVersion === undefined) return String(LEGACY_RUN_STATE_SCHEMA_VERSION);
  if (Number.isFinite(detected)) return String(detected);
  return `invalid (${typeof input.schemaVersion}: ${String(input.schemaVersion)})`;
}

function ensureRecord(
  state: Record<string, unknown>,
  key: string,
  context: StateMigrationContext,
  reason: string
): Record<string, unknown> {
  if (isRecord(state[key])) return state[key] as Record<string, unknown>;
  if (state[key] !== undefined) context.errors.push(`${key} must be an object when present.`);
  setValue(state, key, {}, context, reason);
  return state[key] as Record<string, unknown>;
}

function ensureArray(state: Record<string, unknown>, key: string, context: StateMigrationContext): void {
  if (Array.isArray(state[key])) return;
  if (state[key] !== undefined) context.errors.push(`${key} must be an array when present.`);
  setValue(state, key, [], context, `${key} must be an array`);
}

function setDefault(
  state: Record<string, unknown>,
  key: string,
  value: unknown,
  context: StateMigrationContext,
  reason: string,
  reportPath = key
): void {
  if (state[key] !== undefined) return;
  setValue(state, key, value, context, reason, reportPath);
}

function setValue(
  state: Record<string, unknown>,
  key: string,
  value: unknown,
  context: StateMigrationContext,
  reason: string,
  reportPath = key
): void {
  const before = state[key];
  state[key] = value;
  context.changes.push({ path: reportPath, before, after: value, reason });
}

function derivePhases(tasks: unknown[]): Array<{ id: string; name: string; status: string; taskIds: string[] }> {
  const byPhase = new Map<string, string[]>();
  for (const task of tasks) {
    if (!isRecord(task)) continue;
    const phase = stringValue(task.phase) || "Workflow";
    const taskId = stringValue(task.id);
    if (!taskId) continue;
    byPhase.set(phase, [...(byPhase.get(phase) || []), taskId]);
  }
  if (byPhase.size === 0) return [];
  return Array.from(byPhase.entries()).map(([name, taskIds]) => ({
    id: slugify(name),
    name,
    status: tasksForPhaseCompleted(tasks, taskIds) ? "completed" : "pending",
    taskIds
  }));
}

function tasksForPhaseCompleted(tasks: unknown[], taskIds: string[]): boolean {
  return taskIds.every((taskId) => {
    const task = tasks.find((candidate) => isRecord(candidate) && candidate.id === taskId);
    return isRecord(task) && task.status === "completed";
  });
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Workflow";
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "workflow";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isLoopStage(value: unknown): value is LoopStage {
  return ["interpret", "act", "observe", "adjust", "checkpoint"].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
