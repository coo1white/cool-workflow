#!/usr/bin/env node
"use strict";

// L7 regression: missingEvidence() must verify the REQUIRED named evidence is
// present, matched per-kind — not merely that evidenceRefs.length > 0. Before the
// fix, any single unrelated ref satisfied every required item of a multi-kind gate
// (a required-evidence gate satisfiable with one unrelated ref). The fix keeps the
// happy path green: bare content locators (no kind signal) preserve the historical
// "presence satisfies" contract, while kind-tagged refs get true per-kind matching.

const assert = require("node:assert/strict");
const { missingEvidence, policyForRole } = require("../dist/multi-agent-trust");

// A panel-chair role: policyForRole gives it the 3-required judge.panel-decision gate.
const chair = policyForRole({
  id: "panel-chair",
  title: "Panel Chair",
  metadata: { topologyRoleId: "panel-chair" }
});

const required = chair.requiredEvidenceFor["judge.panel-decision"];
assert.deepEqual(
  required,
  ["judge messages", "score evidence", "coordinator decision"],
  "panel-decision keeps its three named required-evidence kinds"
);

// --- 1. A SINGLE UNRELATED kind-tagged ref no longer satisfies a 3-required gate. ---
const singleUnrelated = missingEvidence(
  chair,
  "judge.panel-decision",
  ["kind:unrelated-note:/tmp/note.md:1"],
  [{ id: "e1", locator: "kind:unrelated-note:/tmp/note.md:1", recordRef: { kind: "unrelated-note", id: "n1" } }]
);
assert.equal(singleUnrelated.length, 3, "one unrelated tagged ref covers zero of three required kinds");
assert.deepEqual(singleUnrelated, required, "the specific uncovered required items are returned");

// --- 2. One ref can cover at most ONE required kind (no fan-out satisfaction). ---
const oneRealKind = missingEvidence(
  chair,
  "judge.panel-decision",
  ["kind:judge messages:/tmp/msgs.md:1"],
  [{ id: "e1", locator: "kind:judge messages:/tmp/msgs.md:1", recordRef: { kind: "judge messages", id: "m1" } }]
);
assert.deepEqual(
  oneRealKind,
  ["score evidence", "coordinator decision"],
  "a single matching ref covers only its own kind; the other two stay uncovered"
);

// --- 3. The legitimate FULL-evidence case (all three kinds, distinct refs) passes. ---
const fullByTag = missingEvidence(
  chair,
  "judge.panel-decision",
  [
    "kind:judge messages:/tmp/msgs.md:1",
    "kind:score evidence:/tmp/score.md:1",
    "kind:coordinator decision:/tmp/coord.md:1"
  ],
  [
    { id: "e1", locator: "kind:judge messages:/tmp/msgs.md:1" },
    { id: "e2", locator: "kind:score evidence:/tmp/score.md:1" },
    { id: "e3", locator: "kind:coordinator decision:/tmp/coord.md:1" }
  ]
);
assert.equal(fullByTag.length, 0, "all three kind-tagged refs cover the gate");

// Full coverage also works when the required label is merely mentioned in the ref
// text (no explicit kind: prefix), as long as SOME ref in the set carries a tag so
// per-kind matching is engaged.
const fullByMention = missingEvidence(
  chair,
  "judge.panel-decision",
  [
    "/tmp/judge messages transcript.md:1",
    "/tmp/score evidence sheet.md:1",
    "kind:coordinator decision:/tmp/coord.md:1"
  ],
  [
    { id: "e1", locator: "/tmp/judge messages transcript.md:1" },
    { id: "e2", locator: "/tmp/score evidence sheet.md:1" },
    { id: "e3", locator: "kind:coordinator decision:/tmp/coord.md:1" }
  ]
);
assert.equal(fullByMention.length, 0, "label-mentioning refs cover the gate when a kind signal is present");

// --- 4. Documented residual: pure legacy bare locators (no kind signal at all) ---
// keep the historical presence-satisfies contract to avoid a happy-path false-reject.
const legacyBare = missingEvidence(
  chair,
  "judge.panel-decision",
  ["/tmp/trust-policy-evidence.md:1"],
  [{ id: "e1", locator: "/tmp/trust-policy-evidence.md:1", summary: "/tmp/trust-policy-evidence.md:1" }]
);
assert.equal(legacyBare.length, 0, "untagged legacy callers are not false-rejected (documented residual)");

// --- 5. No required evidence configured => nothing required. ---
assert.deepEqual(missingEvidence(chair, "message", ["x"]), [], "operations without a required set are unaffected");

// --- 6. Empty evidence still fails closed (returns the full required set). ---
assert.deepEqual(
  missingEvidence(chair, "judge.panel-decision", []),
  required,
  "zero refs against a required gate fails closed with the full uncovered set"
);

process.stdout.write("multi-agent-required-evidence-kind-smoke: ok\n");
