"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWorkflowApi = createWorkflowApi;
exports.slugify = slugify;
function createWorkflowApi() {
    return {
        workflow(definition) {
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
        },
        phase(name, tasks, options = {}) {
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
        },
        agent(id, prompt, options = {}) {
            return task("agent", id, prompt, options);
        },
        artifact(id, prompt, options = {}) {
            return task("artifact", id, prompt, options);
        }
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
