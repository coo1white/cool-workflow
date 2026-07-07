#!/usr/bin/env node
// formatapps-appschema-dsl-factories — pins the workflow-authoring DSL
// factory functions (workflow, phase, parallel, loop, agent, artifact,
// subWorkflow, input, slugify, createWorkflowApi): the exact shape each
// produces (what the drive loop expects to read back), and that each
// required-field check genuinely throws rather than silently accepting
// bad input.
//
// Evidence: SPEC/workflow-apps.md "Authoring API (src/workflow-api.ts)";
// src/core/workflow-apps/app-schema.ts.

const assert = require("node:assert/strict");
const { workflow, phase, parallel, loop, agent, artifact, subWorkflow, input, slugify, createWorkflowApi } = require("../dist/core/workflow-apps/app-schema");

// slugify: trim, lower-case, collapse non-[a-z0-9] runs to '-', strip
// leading/trailing '-', fold repeated '-' to one.
{
  assert.equal(slugify("  Hello, World!!  "), "hello-world", "slugify collapses punctuation/spaces and trims");
  assert.equal(slugify("Map PR"), "map-pr", "slugify lower-cases");
  assert.equal(slugify("a--b---c"), "a-b-c", "slugify folds repeated hyphens to one");
  assert.equal(slugify("--leading-and-trailing--"), "leading-and-trailing", "slugify strips leading/trailing hyphens");
  assert.equal(slugify(""), "", "slugify of an empty string is an empty string");
}

// workflow(): defaults folded in, required fields enforced.
{
  const wf = workflow({ id: "my-wf", title: "My WF", phases: [] });
  assert.deepEqual(wf.limits, { maxAgents: 20, maxConcurrentAgents: 4 }, "workflow() defaults limits to 20/4 when not given");
  assert.deepEqual(wf.inputs, [], "workflow() defaults inputs to an empty array");
  assert.equal(wf.summary, "", "workflow() defaults summary to an empty string");
  assert.equal(wf.id, "my-wf");
  assert.equal(wf.title, "My WF");

  const withLimits = workflow({ id: "x", title: "T", phases: [], limits: { maxAgents: 5, maxConcurrentAgents: 2 } });
  assert.deepEqual(withLimits.limits, { maxAgents: 5, maxConcurrentAgents: 2 }, "explicit limits win over the defaults, field for field");

  assert.throws(() => workflow({ title: "T", phases: [] }), /workflow\.id is required/, "workflow() throws on a missing id");
  assert.throws(() => workflow({ id: "x", phases: [] }), /workflow\.title is required/, "workflow() throws on a missing title");
  assert.throws(() => workflow({ id: "x", title: "T", phases: "nope" }), /workflow\.phases must be an array/, "workflow() throws when phases is not an array");
}

// phase(): id is slugify(name), status always "pending", tasks passed
// through, options merged in.
{
  const p = phase("Map Phase", []);
  assert.equal(p.id, "map-phase", "phase() derives id via slugify(name)");
  assert.equal(p.name, "Map Phase");
  assert.equal(p.status, "pending", "phase() always sets status: pending");
  assert.deepEqual(p.tasks, []);

  const withMode = phase("X", [], { mode: "sequential" });
  assert.equal(withMode.mode, "sequential", "phase() merges caller options onto the base shape");

  assert.throws(() => phase("", []), /phase name is required/, "phase() throws on an empty name");
  assert.throws(() => phase("Name", "nope"), /phase Name tasks must be an array/, "phase() throws when tasks is not an array");
}

// parallel(): sugar over phase() that forces mode: "parallel"; a plain
// phase() stays sequential (mode is absent, not "sequential").
{
  const par = parallel("Assess", []);
  assert.equal(par.mode, "parallel", "parallel() always sets mode: parallel");
  const plain = phase("Assess", []);
  assert.equal(plain.mode, undefined, "a plain phase() leaves mode unset (not forced to 'sequential')");

  // Options can't silently override the forced "parallel" mode from
  // OUTSIDE, but the object spread order in the source has options WIN
  // over mode:"parallel" defaults inserted before it — verify which side
  // wins so this doesn't silently change on a refactor.
  const overridden = parallel("Assess", [], { mode: "sequential" });
  assert.equal(overridden.mode, "sequential", "parallel()'s caller-supplied options.mode wins over the forced default (spread order)");
}

// loop(): sugar over phase() with a validated `loop` spec; requires a
// positive integer maxRounds (floored) and a valid `until` (predicate with
// a ref, or budget-target with a positive target).
{
  const l = loop("Retry Loop", [], { maxRounds: 3.9, until: { kind: "predicate", ref: "done?" } });
  assert.equal(l.loop.maxRounds, 3, "loop() floors a fractional maxRounds");
  assert.deepEqual(l.loop.until, { kind: "predicate", ref: "done?" });
  assert.equal(l.id, "retry-loop", "loop() still derives id via slugify(name), same as phase()");

  const budgetLoop = loop("B", [], { maxRounds: 2, until: { kind: "budget-target", target: 10 } });
  assert.deepEqual(budgetLoop.loop.until, { kind: "budget-target", target: 10 });

  assert.throws(() => loop("L", [], { maxRounds: 0, until: { kind: "predicate", ref: "x" } }), /requires a positive integer maxRounds/, "loop() throws on maxRounds < 1");
  assert.throws(() => loop("L", [], { until: { kind: "predicate", ref: "x" } }), /requires a positive integer maxRounds/, "loop() throws when maxRounds is missing");
  assert.throws(
    () => loop("L", [], { maxRounds: 3, until: { kind: "predicate", ref: "" } }),
    /requires until: \{ kind: "predicate", ref \} or \{ kind: "budget-target", target \}/,
    "loop() throws when 'predicate' until has an empty ref"
  );
  assert.throws(
    () => loop("L", [], { maxRounds: 3, until: { kind: "budget-target", target: 0 } }),
    /requires until:/,
    "loop() throws when 'budget-target' until has a non-positive target"
  );
  assert.throws(() => loop("L", [], { maxRounds: 3 }), /requires until:/, "loop() throws when until is entirely missing");
}

// agent()/artifact(): task() shape — id, kind, prompt, status: "pending",
// sandboxProfileId key always present (undefined when not given).
{
  const a = agent("t1", "Do the thing");
  assert.equal(a.kind, "agent");
  assert.equal(a.id, "t1");
  assert.equal(a.prompt, "Do the thing");
  assert.equal(a.status, "pending");
  assert.ok(Object.prototype.hasOwnProperty.call(a, "sandboxProfileId"), "the sandboxProfileId key is always present on a built task");
  assert.equal(a.sandboxProfileId, undefined, "sandboxProfileId defaults to undefined when not given as a string");

  const withSandbox = agent("t2", "Do it", { sandboxProfileId: "readonly" });
  assert.equal(withSandbox.sandboxProfileId, "readonly");

  const art = artifact("a1", "Write it up");
  assert.equal(art.kind, "artifact");

  assert.throws(() => agent("", "prompt"), /agent task id is required/, "agent() throws on a missing id");
  assert.throws(() => agent("id1", ""), /agent task id1 prompt is required/, "agent() throws on a missing prompt");
  assert.throws(() => artifact("", "prompt"), /artifact task id is required/, "artifact() throws on a missing id (kind-specific message)");
}

// subWorkflow(): sugar over agent() with a `subWorkflow` field; default
// prompt names the delegated app; inputs/bindResult only included when
// given (never present as an explicit undefined/empty key).
{
  const sw = subWorkflow("delegate1", "child-app");
  assert.equal(sw.kind, "agent", "subWorkflow() still produces an 'agent' kind task");
  assert.equal(sw.prompt, "Delegate to sub-workflow app: child-app", "default prompt names the delegated appId");
  assert.deepEqual(sw.subWorkflow, { appId: "child-app" }, "with no inputs/bindResult given, subWorkflow carries ONLY appId");

  const swFull = subWorkflow("delegate2", "child-app", { inputs: { q: "hi" }, bindResult: "verdict-result", prompt: "Custom prompt" });
  assert.equal(swFull.prompt, "Custom prompt", "an explicit prompt option overrides the default delegation text");
  assert.deepEqual(swFull.subWorkflow, { appId: "child-app", inputs: { q: "hi" }, bindResult: "verdict-result" });

  assert.throws(() => subWorkflow("id1", ""), /subWorkflow task id1 requires an appId/, "subWorkflow() throws on a missing appId");
}

// input(): pass-through shape; empty name throws.
{
  const i = input("question", { required: true, type: "string" });
  assert.deepEqual(i, { name: "question", required: true, type: "string" });
  assert.throws(() => input(""), /input name is required/, "input() throws on an empty name");
}

// createWorkflowApi(): gives back exactly the 8 named factory functions,
// each identical (===) to its standalone export — not a re-implementation.
{
  const api = createWorkflowApi();
  assert.deepEqual(Object.keys(api).sort(), ["agent", "artifact", "input", "loop", "parallel", "phase", "subWorkflow", "workflow"].sort());
  assert.equal(api.workflow, workflow, "createWorkflowApi().workflow is the exact same function reference as the standalone export");
  assert.equal(api.agent, agent, "createWorkflowApi().agent is the exact same function reference as the standalone export");
}

process.stdout.write("formatapps-appschema-dsl-factories: ok\n");
