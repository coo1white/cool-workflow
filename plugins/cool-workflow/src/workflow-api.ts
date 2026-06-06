import {
  WorkflowDefinition,
  WorkflowPhaseDefinition,
  WorkflowTaskDefinition
} from "./types";

export function createWorkflowApi() {
  return {
    workflow(definition: Partial<WorkflowDefinition> & Pick<WorkflowDefinition, "id" | "title" | "phases">): WorkflowDefinition {
      if (!definition.id) throw new Error("workflow.id is required");
      if (!definition.title) throw new Error("workflow.title is required");
      if (!Array.isArray(definition.phases)) throw new Error("workflow.phases must be an array");
      return {
        limits: {
          maxAgents: 20,
          maxConcurrentAgents: 4,
          ...(definition.limits || {})
        },
        inputs: [],
        summary: "",
        ...definition
      };
    },

    phase(name: string, tasks: WorkflowTaskDefinition[], options: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition {
      if (!name) throw new Error("phase name is required");
      if (!Array.isArray(tasks)) throw new Error(`phase ${name} tasks must be an array`);
      return {
        id: slugify(name),
        name,
        status: "pending",
        tasks,
        ...options
      };
    },

    agent(id: string, prompt: string, options: Partial<WorkflowTaskDefinition> = {}): WorkflowTaskDefinition {
      return task("agent", id, prompt, options);
    },

    artifact(id: string, prompt: string, options: Partial<WorkflowTaskDefinition> = {}): WorkflowTaskDefinition {
      return task("artifact", id, prompt, options);
    }
  };
}

function task(kind: "agent" | "artifact", id: string, prompt: string, options: Partial<WorkflowTaskDefinition>): WorkflowTaskDefinition {
  if (!id) throw new Error(`${kind} task id is required`);
  if (!prompt) throw new Error(`${kind} task ${id} prompt is required`);
  return {
    id,
    kind,
    prompt,
    status: "pending",
    ...options
  };
}

export function slugify(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/-{2,}/g, "-");
}
