// Topology domain operations (v0.1.40 self-audit P3 router pattern).
// Carved out of CoolWorkflowRunner; behavior identical to the inline versions.
import { WorkflowRun } from "../types";
import { saveCheckpoint } from "../state";
import { writeReport } from "./report";
import { stringOption, numberOption, arrayOption, metadataOption } from "./cli-options";
import * as topo from "../topology";

export function listTopologies(): ReturnType<typeof topo.listTopologyDefinitions> {
  return topo.listTopologyDefinitions();
}

export function showTopology(topologyId: string): NonNullable<ReturnType<typeof topo.getTopologyDefinition>> {
  const definition = topo.getTopologyDefinition(topologyId);
  if (!definition) throw new Error(`Unknown topology id: ${topologyId}`);
  return definition;
}

export function validateTopology(topologyId: string): ReturnType<typeof topo.validateTopologyDefinition> {
  return topo.validateTopologyDefinition(topologyId);
}

export function applyTopology(run: WorkflowRun, topologyId: string, options: Record<string, unknown> = {}): ReturnType<typeof topo.applyTopology> {
  const record = topo.applyTopology(run, topologyId, {
    id: stringOption(options.id),
    title: stringOption(options.title),
    multiAgentRunId: stringOption(options.multiAgentRun || options.multiAgentRunId || options["multi-agent-run"]),
    blackboardId: stringOption(options.blackboard || options.blackboardId),
    taskIds: arrayOption(options.task || options.taskId || options.tasks).map(String),
    mapperCount: numberOption(options.mapperCount || options["mapper-count"] || options.mappers || options.mapper),
    judgeCount: numberOption(options.judgeCount || options["judge-count"] || options.judges || options.judge),
    debateRounds: numberOption(options.debateRounds || options["debate-rounds"] || options.rounds),
    collectInitialFanin: Boolean(options.collectInitialFanin || options["collect-initial-fanin"]),
    metadata: metadataOption(options)
  });
  writeReport(run);
  saveCheckpoint(run);
  return record;
}

export function showTopologyRun(run: WorkflowRun, topologyRunId: string): ReturnType<typeof topo.showTopologyRun> {
  return topo.showTopologyRun(run, topologyRunId);
}

export function topologySummary(run: WorkflowRun): ReturnType<typeof topo.summarizeTopologies> {
  return topo.summarizeTopologies(run);
}

export function topologyGraph(run: WorkflowRun): ReturnType<typeof topo.buildTopologyGraph> {
  return topo.buildTopologyGraph(run);
}
