#!/usr/bin/env node
"use strict";

// The 7-driver registry: `cw backend list` gives the exact sorted id set
// and default; `cw backend show <id>` gives the same descriptor shape;
// an unknown id fails closed with the exact BackendError text; `cw backend
// probe node` (always ready on any host with node) proves the probe
// payload shape.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const list = run(["backend", "list"]);
  assert.equal(list.status, 0);
  const payload = JSON.parse(list.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.default, "node");

  const ids = payload.backends.map((b) => b.id);
  assert.deepEqual(ids, ["agent", "bun", "ci", "container", "node", "remote", "shell"], "sorted 7-id set");

  const defaults = payload.backends.filter((b) => b.default === true);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, "node");

  const node = payload.backends.find((b) => b.id === "node");
  assert.equal(node.kind, "local");
  assert.equal(node.locality, "local");
  assert.equal(node.readiness, "ready");

  const agent = payload.backends.find((b) => b.id === "agent");
  assert.equal(agent.kind, "delegating");
  assert.equal(agent.delegate, "agent-process");
  assert.equal(agent.readiness, "unverified");
  assert.deepEqual(agent.enforces, ["command"]);
  assert.deepEqual(agent.attests, ["read", "write", "network", "env"]);

  // `backend show` on one id gives back the SAME descriptor shape as one
  // entry of `backend list`.
  const show = run(["backend", "show", "node"]);
  assert.equal(show.status, 0);
  const nodeDescriptor = JSON.parse(show.stdout);
  assert.deepEqual(nodeDescriptor, node);

  // Unknown id fails closed with the exact BackendError text (never a
  // quiet fallback to the default backend).
  const badShow = run(["backend", "show", "nosuchbackend"]);
  assert.equal(badShow.status, 1);
  assert.equal(badShow.stdout, "");
  assert.equal(badShow.stderr, "cw: Execution backend not found: nosuchbackend\n");

  // Probe: node is always ready (node itself is running this suite).
  const probeNode = run(["backend", "probe", "node"]);
  assert.equal(probeNode.status, 0);
  const nodeProbe = JSON.parse(probeNode.stdout);
  assert.equal(nodeProbe.schemaVersion, 1);
  assert.equal(nodeProbe.backendId, "node");
  assert.equal(nodeProbe.readiness, "ready");
  assert.equal(nodeProbe.ready, true);
  assert.equal(nodeProbe.checks.length, 1);
  assert.equal(nodeProbe.checks[0].name, "node-runtime");
  assert.equal(nodeProbe.checks[0].ok, true);

  // Probe-all (no id) gives the wrapping payload with one entry per id.
  const probeAll = run(["backend", "probe"]);
  assert.equal(probeAll.status, 0);
  const allProbes = JSON.parse(probeAll.stdout);
  assert.equal(allProbes.schemaVersion, 1);
  assert.equal(allProbes.default, "node");
  assert.deepEqual(
    allProbes.probes.map((p) => p.backendId).sort(),
    ["agent", "bun", "ci", "container", "node", "remote", "shell"]
  );
});
