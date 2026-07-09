#!/usr/bin/env node
"use strict";

// cli-usage-strings — every handler family's fixed "Usage: cw ..." text,
// thrown on stderr (as "cw: Usage: ...") when a group command gets a wrong
// or missing action word (SPEC/cli-surface.md "Usage strings" section).
// These are byte-pinned, repo-free, agent-free, and cheap — a single bogus
// subcommand token trips the same usage throw for each family. One case
// covers ~30 handler families at once since the check per family is a
// one-liner.
//
// Every family, including ledger, spells its usage prefix "cw <verb> ...".
// These used to say "cw.js <verb> ..." for every family except ledger
// (which already said "cw ledger ..."); "cw.js" leaked the internal
// scripts/cw.js entry-point name into user-facing text, so all families
// were normalized to the shipped "cw" binary name.

const { run, caseMain, assert } = require("../lib");

caseMain(() => {
  const cases = [
    ["app", "cw app list|show|validate|init|package|run [app-id|path]"],
    ["state", "cw state check <run-id> [--state PATH] [--write]"],
    ["audit", "cw audit summary|worker|provenance|multi-agent|policy|role|blackboard|judge|attest|decision <run-id> [worker-id|role-id]"],
    ["blackboard", "cw blackboard summary|summarize|graph|resolve <run-id> | topic create <run-id> | message post|list <run-id> | context put <run-id> | artifact add|list <run-id> | snapshot <run-id>"],
    ["candidate", "cw candidate list|show|register|score|rank|select|reject|summary <run-id> [candidate-id]"],
    ["clones", "cw clones list [--json] | clones gc [--older-than-days N] [--all] [--json]"],
    ["comment", "cw comment add <kind> <run-id> <target-id> --body <text> | comment list <run-id> [--json]"],
    ["eval", "cw eval snapshot <run-id> --id <snapshot-id> | replay <snapshot-id-or-path> | compare <baseline-id-or-path> <replay-id-or-path> | score <replay-id-or-path> | gate <suite-id-or-path> | report <replay-id-or-path>"],
    ["gc", "cw gc plan|run|verify [run-id] [--reclaimAfterArchiveDays N] [--keep-scratch] [--keep-snapshots] [--limit N] [--json]"],
    ["telemetry", "cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]"],
    ["demo", "cw demo tamper|bundle [--json]"],
    ["multi-agent", "cw multi-agent run|status|step|blackboard|score|select|summary|summarize|graph|dependencies|failures|evidence|reasoning|show|role|group|membership|fanout|fanin <run-id> [id]"],
    ["node", "cw node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]"],
    ["sandbox", "cw sandbox list|show|validate|choose|resolve [profile-id|profile-file]"],
    ["backend", "cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]"],
    ["contract", "cw contract show <run-id> [contract-id]"],
    ["migration", "cw migration list|check|prove [target] [--contract run-state|workflow-app]"],
    ["feedback", "cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]"],
    ["metrics", "cw metrics show <run-id> | metrics summary [--scope repo|home] [--pricing <path>|default] [--limit N] [--json]"],
    ["operator", "cw operator status|report <run-id> [--json]"],
    ["topology", "cw topology list|show <topology-id>|show <run-id> <topology-run-id>|validate <topology-id>|apply <run-id> <topology-id>|summary <run-id>|graph <run-id>"],
    ["summary", "cw summary refresh|show <run-id> [--json]"],
    ["orphans", "cw orphans list [--scope repo|home] [--json] | orphans gc [--scope repo|home] [--min-age-minutes N] [--all] [--json]  (scope defaults to home: every registered repo)"],
    ["registry", "cw registry refresh|show [--scope repo|home] [--json]"],
    ["queue", "cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]"],
    ["schedule", "cw schedule create|list|delete|due|complete|pause|resume|run-now|history|daemon"],
    ["routine", "cw routine create|list|delete|fire|events"],
    ["sched", "cw sched plan|lease|release|complete|reclaim|reset|policy [show|set] [id] [--maxConcurrent N --maxAttempts N ...]"],
    ["workbench", "cw workbench serve [--port N] [--once] [--require-token] | view <run-id> [--json]"],
    ["worker", "cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]"],
    ["review", "cw review status <run-id> [--json] | review policy <run-id> --required-approvals N --authorized-roles a,b --applies-to commit,selection"],
    ["coordinator", "cw coordinator summary <run-id> | coordinator decision <run-id> --kind <kind> --outcome <outcome> --reason TEXT"],
  ];

  for (const [group, usage] of cases) {
    const r = run([group, "bogus-action-word"]);
    assert.equal(r.status, 1, `${group}: exit 1 on a wrong action word`);
    assert.equal(r.stdout, "", `${group}: nothing on stdout`);
    assert.equal(r.stderr, `cw: Usage: ${usage}\n`, `${group}: exact usage text`);
  }

  // ledger spells its usage prefix "cw ledger ..." the same way every
  // other family above does.
  const ledger = run(["ledger", "bogus-action-word"]);
  assert.equal(ledger.status, 1);
  assert.equal(ledger.stderr, "cw: Usage: cw ledger propose|review|verify|apply|list [options]\n");

  // `run` with a positional that is neither a registry keyword nor has a
  // repo to drive against also falls to its (two-shape) usage string.
  const runUsage = run(["run", "bogus-verb-that-is-not-a-registry-keyword"]);
  assert.equal(runUsage.status, 1);
  assert.equal(
    runUsage.stderr,
    "cw: Usage: cw run search|list|show|resume|archive|rerun|drive|export|import|verify-import|inspect-archive|restore [run-id|archive] [--scope repo|home] [--json]  |  cw run <app> --drive [--once] [--incremental] [--repo R --question Q]\n"
  );
});
