#!/usr/bin/env node

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

import { run, caseMain, assert } from "../lib.mjs";

caseMain(() => {
  const cases = [
    ["app", "cw app list|show|validate|init|package|run [app-id|path]"],
    ["state", "cw state check <run-id> [--state PATH] [--write]"],
    ["audit", "cw audit summary|worker|provenance|attest|decision <run-id> [worker-id]"],
    ["telemetry", "cw telemetry verify <run-id> [--pubkey <pem-or-path>] [--json]"],
    ["demo", "cw demo tamper [--json]"],
    ["node", "cw node list|show|graph|snapshot|diff|replay|verify <run-id> [node-id|snapshot-id|replay-id]"],
    ["sandbox", "cw sandbox list|show|validate|choose [profile-id|profile-file]"],
    ["backend", "cw backend list|show|probe [backend-id]  |  cw backend agent config [show|set] [--agent-command ... --agent-endpoint ... --agent-model ...]"],
    ["contract", "cw contract show <run-id> [contract-id]"],
    ["migration", "cw migration list|check|prove [target] [--contract run-state|workflow-app]"],
    ["feedback", "cw feedback list|show|summary|collect|task|resolve <run-id> [feedback-id]"],
    ["metrics", "cw metrics show <run-id> | metrics summary [--scope repo|home] [--limit N] [--json]"],
    ["operator", "cw operator status|report <run-id> [--json]"],
    ["registry", "cw registry refresh|show [--scope repo|home] [--json]"],
    ["queue", "cw queue add|list|drain|show [queue-id] [--repo PATH] [--priority N]"],
    ["worker", "cw worker list|summary|show|manifest|output|fail|validate <run-id> [worker-id] [result-file]"],
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
