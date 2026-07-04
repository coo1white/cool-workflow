// shell/pipeline.ts — plan(): the run-lifecycle operation that turns a
// loaded workflow app + inputs into a full WorkflowRun on disk.
//
// MILESTONE 6+7 (combined). Byte-exact port of the old build's
// src/orchestrator/lifecycle-operations.ts's `plan` function (the
// multi-agent/topology/blackboard ensure calls are milestone 9's scope
// and are no-ops here — no case in this milestone's gate reads those
// fields).
//
// Evidence: SPEC/pipeline-run.md's plan() references;
// plugins/cool-workflow/src/orchestrator/lifecycle-operations.ts:62-202
// (byte-exact source).

import * as crypto from "node:crypto";
import * as path from "node:path";
import { RunTask, WorkflowRun } from "../core/state/types";
import { createRunPaths, ensureRunDirs } from "../core/state/run-paths";
import { migrateRunState } from "../core/state/migrations";
import { appendRunNode as pureAppendRunNode, createStateNode, upsertRunContract } from "../core/state/state-node";
import { createDefaultPipelineContract } from "../core/pipeline/contract";
import { runPipelineStage } from "../core/pipeline/runner";
import { LoadedWorkflowApp, workflowAppRunMetadata, WorkflowTaskDefinition } from "../core/workflow-apps/app-schema";
import { writeJson } from "./fs-atomic";
import { appendRunNode, writeRunNode } from "./node-store";
import { saveCheckpoint } from "./run-store";
import { writeTaskFiles } from "./harness";
import { writeReport } from "./report";
import { commitState } from "./commit";

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function renderPrompt(prompt: string, inputs: Record<string, unknown>): string {
  const invariant = Array.isArray(inputs.invariant) ? inputs.invariant.join("; ") : String(inputs.invariant || "");
  let rendered = String(prompt).replaceAll("{{repo}}", String(inputs.repo || "")).replaceAll("{{question}}", String(inputs.question || "")).replaceAll("{{invariant}}", invariant);
  for (const [key, value] of Object.entries(inputs)) {
    const replacement = Array.isArray(value) ? value.join("; ") : String(value ?? "");
    rendered = rendered.replaceAll(`{{${key}}}`, replacement);
  }
  return rendered;
}

function normalizeInputs(options: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) out[key] = value;
  return out;
}

function flattenTasks(app: LoadedWorkflowApp, inputs: Record<string, unknown>): RunTask[] {
  const seen = new Set<string>();
  const tasks: RunTask[] = [];
  for (const phase of app.workflow.phases) {
    for (const task of phase.tasks) {
      if (seen.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
      seen.add(task.id);
      tasks.push({
        id: task.id,
        kind: task.kind,
        phase: phase.name,
        status: "pending",
        loopStage: "interpret",
        requiresEvidence: Boolean(task.requiresEvidence),
        sandboxProfileId: task.sandboxProfileId,
        prompt: renderPrompt(task.prompt, inputs),
        taskPath: "",
        resultPath: "",
        ...(task.label ? { label: task.label } : {}),
        ...(task.model ? { model: task.model } : {}),
        ...(task.agentType ? { agentType: task.agentType } : {}),
        // Per-phase result-cache policy the drive READS (drive.ts resultCachePath).
        // Carries mode/keyInput and any includeCompletedResults sub-field through,
        // so warm re-runs hit .cw/cache/worker-results instead of re-spawning.
        // Byte-exact to the old build's flattenTasks (lifecycle-operations.ts).
        ...(task.resultCache ? { resultCache: task.resultCache } : {}),
      });
    }
  }
  return tasks;
}

let runIdSequence = 0;
function createRunId(workflowId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  if (/^(1|true|yes|on)$/i.test(process.env.CW_DETERMINISTIC_RUN_IDS || "")) {
    runIdSequence += 1;
    const suffix = crypto.createHash("sha256").update(`${workflowId}:${process.pid}:${runIdSequence}`).digest("hex").slice(0, 6);
    return `${workflowId}-${suffix}`;
  }
  runIdSequence += 1;
  const suffix = crypto.createHash("sha256").update(`${workflowId}:${stamp}:${process.pid}:${runIdSequence}`).digest("hex").slice(0, 6);
  return `${workflowId}-${stamp}-${suffix}`;
}

/** plan(appRecord, options) — creates a brand-new run dir + state.json,
 *  writes task files, plans every task through the pipeline's "plan"
 *  stage, writes the initial report, and commits an initial checkpoint. */
export function plan(app: LoadedWorkflowApp, options: Record<string, unknown>): WorkflowRun {
  const inputs = normalizeInputs(options);
  for (const declared of app.workflow.inputs || []) {
    if (isMissing(inputs[declared.name])) inputs[declared.name] = declared.default ?? "";
    if (declared.required && isMissing(inputs[declared.name])) {
      throw new Error(`Missing required input: ${declared.name}`);
    }
  }

  const cwd = path.resolve(String(inputs.cwd || inputs.repo || process.cwd()));
  const injectedRunId = typeof options.runId === "string" && (options.runId as string).trim() ? (options.runId as string).trim() : undefined;
  delete inputs.runId;
  const runId = injectedRunId || createRunId(app.workflow.id);
  const runDir = path.join(cwd, ".cw", "runs", runId);
  const paths = createRunPaths(runDir);
  ensureRunDirs(paths);

  const tasks = flattenTasks(app, inputs);
  const seed: Record<string, unknown> = {
    schemaVersion: 1,
    id: runId,
    cwd,
    workflow: {
      id: app.workflow.id,
      title: app.workflow.title,
      summary: app.workflow.summary || "",
      limits: app.workflow.limits,
      app: workflowAppRunMetadata(app),
    },
    inputs,
    loopStage: "interpret",
    phases: app.workflow.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      status: "pending",
      taskIds: phase.tasks.map((t: WorkflowTaskDefinition) => t.id),
      ...(phase.mode ? { mode: phase.mode } : {}),
      ...(phase.loop ? { loop: phase.loop, loopRound: 1 } : {}),
    })),
    tasks,
    dispatches: [],
    commits: [],
    paths,
  };
  const { run, report } = migrateRunState(seed, { statePath: paths.state, dryRun: false });
  if (report.status === "unsupported") throw new Error(`Unsupported CW run state: ${report.errors.join("; ")}`);

  writeTaskFiles(run);
  const contract = upsertRunContract(run, createDefaultPipelineContract());
  const inputNode = appendRunNode(
    run,
    createStateNode({
      id: `${run.id}:input`,
      kind: "input",
      status: "completed",
      loopStage: "interpret",
      outputs: run.inputs,
      artifacts: [{ id: "state", kind: "json", path: run.paths.state }],
      contractId: contract.id,
      metadata: { workflowId: app.workflow.id, app: workflowAppRunMetadata(app) },
    })
  );
  saveCheckpoint(run);

  for (const task of run.tasks) {
    const taskResult = runPipelineStage(
      run,
      "plan",
      inputNode.id,
      {
        outputNodeId: `${run.id}:task:${task.id}`,
        outputStatus: "pending",
        loopStage: "interpret",
        artifacts: [{ id: "task", kind: "markdown", path: task.taskPath }],
        metadata: { workflowId: app.workflow.id, appId: app.id, appVersion: app.version, taskId: task.id, phase: task.phase, taskKind: task.kind, requiresEvidence: task.requiresEvidence, sandboxProfileId: task.sandboxProfileId },
      },
      { persist: false, persistNode: writeRunNode }
    );
    task.stateNodeId = taskResult.outputNodeId;
  }
  writeReport(run);
  commitState(run, "initial-plan");
  saveCheckpoint(run);
  return run;
}

export { writeJson, pureAppendRunNode };
