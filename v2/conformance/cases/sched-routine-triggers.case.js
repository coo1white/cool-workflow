#!/usr/bin/env node
"use strict";

// cw routine create/list/fire/delete/events: id format kind-NNNN, monotonic
// and delete-proof sequence; fire makes one event PER TRIGGER of the kind
// (matched or not) with a payload file for every event; only a matched
// event carries a rendered prompt; an unmatched event has no prompt key
// at all; match compares payload keys strictly by dot-path.

const fs = require("node:fs");
const { run, gitRepo, readJson, caseMain, assert } = require("../lib");

caseMain(() => {
  const repo = gitRepo({ "a.txt": "hello\n" });

  const t1 = run(
    ["routine", "create", "--prompt", "on push to main", "--kind", "github", "--match", '{"ref":"refs/heads/main"}', "--json"],
    { cwd: repo }
  );
  assert.equal(t1.status, 0);
  const trigger1 = JSON.parse(t1.stdout);
  assert.equal(trigger1.id, "github-0001");
  assert.deepEqual(trigger1.match, { ref: "refs/heads/main" });

  const t2 = run(
    ["routine", "create", "--prompt", "on push to other", "--kind", "github", "--match", '{"ref":"refs/heads/other"}', "--json"],
    { cwd: repo }
  );
  assert.equal(JSON.parse(t2.stdout).id, "github-0002");

  const list = run(["routine", "list", "--json"], { cwd: repo });
  assert.equal(list.status, 0);
  assert.equal(JSON.parse(list.stdout).length, 2);

  const kindFilter = run(["routine", "list", "--kind", "api", "--json"], { cwd: repo });
  assert.deepEqual(JSON.parse(kindFilter.stdout), []);

  // Fire with a matching payload file: every trigger of the kind gets an
  // event, matched or not; only the matched one carries a prompt.
  const payloadPath = require("node:path").join(repo, "payload.json");
  fs.writeFileSync(payloadPath, JSON.stringify({ ref: "refs/heads/main" }));
  const fire = run(["routine", "fire", "github", payloadPath], { cwd: repo });
  assert.equal(fire.status, 0);
  const events = JSON.parse(fire.stdout);
  assert.equal(events.length, 2, "one event per trigger of the kind, matched or not");

  const matchedEvent = events.find((e) => e.triggerId === "github-0001");
  assert.equal(matchedEvent.matched, true);
  assert.equal(
    matchedEvent.prompt,
    'on push to main\n\ncw:routine\n' +
      JSON.stringify({ triggerId: "github-0001", kind: "github", source: "github", payload: { ref: "refs/heads/main" } }, null, 2)
  );

  const unmatchedEvent = events.find((e) => e.triggerId === "github-0002");
  assert.equal(unmatchedEvent.matched, false);
  assert.equal(Object.prototype.hasOwnProperty.call(unmatchedEvent, "prompt"), false, "unmatched events must not carry a prompt");

  // Each event's payload is persisted at .cw/routines/payloads/<event-id>.json.
  const persisted = readJson(matchedEvent.payloadPath);
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.matched, true);
  assert.deepEqual(persisted.payload, { ref: "refs/heads/main" });

  const eventsList = run(["routine", "events", "--json"], { cwd: repo });
  assert.equal(eventsList.status, 0);
  assert.equal(JSON.parse(eventsList.stdout).length, 2);

  const eventsForTrigger = run(["routine", "events", "github-0001", "--json"], { cwd: repo });
  assert.equal(eventsForTrigger.status, 0);
  const filtered = JSON.parse(eventsForTrigger.stdout);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].triggerId, "github-0001");

  // Delete then create again: the sequence never re-uses a deleted id.
  const del = run(["routine", "delete", "github-0001", "--json"], { cwd: repo });
  assert.deepEqual(JSON.parse(del.stdout), { deleted: true, id: "github-0001" });
  const delAgain = run(["routine", "delete", "github-0001", "--json"], { cwd: repo });
  assert.deepEqual(JSON.parse(delAgain.stdout), { deleted: false, id: "github-0001" });

  const t3 = run(["routine", "create", "--prompt", "third", "--kind", "github", "--json"], { cwd: repo });
  assert.equal(JSON.parse(t3.stdout).id, "github-0003", "the sequence must skip the deleted id-1, never reuse it");
});
