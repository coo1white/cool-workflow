"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflowApi = createWorkflowApi;
exports.workflow = workflow;
exports.phase = phase;
exports.agent = agent;
exports.artifact = artifact;
exports.input = input;
exports.slugify = slugify;
function createWorkflowApi() {
    return {
        workflow,
        phase,
        agent,
        artifact,
        input
    };
}
function workflow(definition) {
    if (!definition.id)
        throw new Error("workflow.id is required");
    if (!definition.title)
        throw new Error("workflow.title is required");
    if (!Array.isArray(definition.phases))
        throw new Error("workflow.phases must be an array");
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
}
function phase(name, tasks, options = {}) {
    if (!name)
        throw new Error("phase name is required");
    if (!Array.isArray(tasks))
        throw new Error(`phase ${name} tasks must be an array`);
    return {
        id: slugify(name),
        name,
        status: "pending",
        tasks,
        ...options
    };
}
function agent(id, prompt, options = {}) {
    return task("agent", id, prompt, options);
}
function artifact(id, prompt, options = {}) {
    return task("artifact", id, prompt, options);
}
function input(name, options = {}) {
    if (!name)
        throw new Error("input name is required");
    return {
        name,
        ...options
    };
}
function task(kind, id, prompt, options) {
    if (!id)
        throw new Error(`${kind} task id is required`);
    if (!prompt)
        throw new Error(`${kind} task ${id} prompt is required`);
    return {
        id,
        kind,
        prompt,
        status: "pending",
        sandboxProfileId: typeof options.sandboxProfileId === "string"
            ? options.sandboxProfileId
            : typeof options.sandboxProfile === "string"
                ? String(options.sandboxProfile)
                : undefined,
        ...options
    };
}
function slugify(value) {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .replace(/-{2,}/g, "-");
}
