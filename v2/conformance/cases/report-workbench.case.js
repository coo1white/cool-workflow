#!/usr/bin/env node
"use strict";

// cw workbench view — the read-only five-panel view. Panel groups/members
// per the spec, each panel embedding a cw <cmd> --json payload verbatim,
// and the fail-closed-but-honest shape for an unresolved run id (exit 0,
// resolved:false, every panel absent with the real error — never a made
// up view).

const { run, gitRepo, caseMain, assert, stubAgentEnv } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });
  const drive = run(
    ["run", "end-to-end-golden-path", "--drive", "--question", "prove it", "--repo", repo, "--json"],
    { env: stubAgentEnv("a.txt:1") }
  );
  const payload = JSON.parse(drive.stdout);
  const runId = payload.runId;

  // --- cw workbench view <id> --json ---
  const wb = run(["workbench", "view", runId, "--json"], { cwd: repo });
  assert.equal(wb.status, 0);
  assert.equal(wb.stderr, "");
  assert.ok(!/\x1b\[/.test(wb.stdout));
  const view = JSON.parse(wb.stdout);
  assert.equal(view.schemaVersion, 1);
  assert.equal(view.surface, "workbench");
  assert.equal(view.runId, runId);
  assert.equal(view.resolved, true);
  assert.equal(view.error, undefined);

  const groups = {
    graph: ["operator", "multiAgent", "compact", "criticalPath"],
    blackboard: ["coordinator", "digest", "graph"],
    worker: ["summary"],
    candidate: ["summary", "reasoning"],
    metrics: ["report"],
    audit: ["summary", "multiAgent", "policy", "judge"],
    collaboration: ["review", "comments"],
  };
  assert.deepEqual(Object.keys(view.panels).sort(), Object.keys(groups).sort());
  for (const [group, members] of Object.entries(groups)) {
    assert.deepEqual(Object.keys(view.panels[group]).sort(), members.slice().sort(), `panel group ${group}`);
    for (const member of members) {
      const panel = view.panels[group][member];
      assert.ok(panel.capability, `${group}.${member} must name its capability`);
      assert.equal(panel.status, "present", `${group}.${member} should be present on a resolved run`);
      assert.ok("data" in panel);
    }
  }

  // The worker panel embeds the same payload as `cw worker summary --json`.
  const workerSummary = run(["worker", "summary", runId, "--json"], { cwd: repo });
  assert.deepEqual(view.panels.worker.summary.data, JSON.parse(workerSummary.stdout));

  // The graph.operator panel embeds the same payload as `cw graph --json`.
  const graphJson = run(["graph", runId, "--json"], { cwd: repo });
  assert.deepEqual(view.panels.graph.operator.data, JSON.parse(graphJson.stdout));

  // --- human render lists panel statuses ---
  const wbHuman = run(["workbench", "view", runId], { cwd: repo });
  assert.equal(wbHuman.stderr, "");
  assert.match(wbHuman.stdout, new RegExp(`^Workbench view ${runId} \\(resolved\\)\\n`));
  assert.ok(wbHuman.stdout.includes("  graph:"));
  assert.ok(wbHuman.stdout.includes("    operator: present — graph"));

  // --- an unresolved run id: exit 0 still (this is a read view, not a
  // command that must fail), resolved:false, every panel absent with the
  // real error, nothing fabricated ---
  const missing = run(["workbench", "view", "no-such-run-id", "--json"], { cwd: repo });
  assert.equal(missing.status, 0);
  const missingView = JSON.parse(missing.stdout);
  assert.equal(missingView.resolved, false);
  assert.ok(missingView.error && missingView.error.includes("no-such-run-id"));
  for (const [group, members] of Object.entries(groups)) {
    for (const member of members) {
      const panel = missingView.panels[group][member];
      assert.equal(panel.status, "absent", `${group}.${member} must be absent on an unresolved run`);
      assert.ok(panel.error, `${group}.${member} must carry the honest error`);
      assert.equal(panel.data, undefined);
    }
  }

  // --- cw workbench serve --once/--json: prints the descriptor only,
  // starts nothing (no listening port to clean up) ---
  const serveOnce = run(["workbench", "serve", "--once"], { cwd: repo });
  assert.equal(serveOnce.status, 0);
  assert.equal(serveOnce.stderr, "");
  const descriptor = JSON.parse(serveOnce.stdout);
  assert.equal(descriptor.schemaVersion, 1);
  assert.equal(descriptor.surface, "workbench");
  assert.equal(descriptor.command, "serve");
  assert.equal(descriptor.host, "127.0.0.1");
  assert.equal(descriptor.port, 7717);
  assert.equal(descriptor.once, true);
  assert.equal(descriptor.readOnly, true);
  assert.equal(descriptor.routes.length, 5);
  const routePaths = descriptor.routes.map((r) => r.path);
  assert.deepEqual(routePaths, ["/", "/ui/*", "/api/index", "/api/serve", "/api/run/:runId"]);
});
