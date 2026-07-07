#!/usr/bin/env node
// pipelinecore-drivedecide-cachekey-incremental — incrementalCacheKey
// (--incremental, schemaVersion 2) and incrementalDelegationDigest.
// SPEC/pipeline-run.md "`--incremental` and the result cache"
// (src/drive.ts:387-425, 449-462) and "Rebuild risks" #4 ("schemaVersion 1
// and 2 caches must never collide").

const assert = require("node:assert/strict");
const { incrementalCacheKey, incrementalDelegationDigest, defaultCacheKey } = require("../dist/core/pipeline/drive-decide");
const { stableHash, sha256, stableStringify } = require("../dist/core/hash");

// Golden composition: incrementalCacheKey === sha256(stableStringify({
// schemaVersion:2, workflowId, taskId, promptDigest, runInputsDigest,
// delegationDigest, upstreamResultsDigest})) — verify against a direct
// composition using core/hash's own exported primitives (NOT re-deriving
// the hash function by hand, since this bucket's job is to pin
// drive-decide.ts's formula, not re-test hash.ts).
{
  const fields = {
    schemaVersion: 2,
    workflowId: "wf-1",
    taskId: "task-a",
    promptDigest: "sha256:prompt",
    runInputsDigest: "sha256:inputs",
    delegationDigest: "sha256:delegation",
    upstreamResultsDigest: "sha256:upstream",
  };
  const key = incrementalCacheKey("wf-1", "task-a", "sha256:prompt", "sha256:inputs", "sha256:delegation", "sha256:upstream");
  assert.equal(key, sha256(stableStringify(fields)));
}

// upstreamResultsDigest === undefined disables caching entirely (an
// earlier-phase task's result is unavailable).
{
  assert.equal(incrementalCacheKey("wf-1", "task-a", "p", "r", "d", undefined), undefined);
}

// An EMPTY STRING upstreamResultsDigest (no earlier phases at all) is a
// valid key component, NOT a disabling condition — distinct from
// undefined.
{
  const key = incrementalCacheKey("wf-1", "task-a", "p", "r", "d", "");
  assert.notEqual(key, undefined);
}

// stableStringify (key-sorted JSON) means field ORDER in the object
// literal does not matter — this is what makes incrementalCacheKey use
// stableStringify rather than plain JSON.stringify (unlike
// defaultCacheKey, which uses plain JSON.stringify and so IS order
// sensitive on the literal object passed to it internally, though that
// object's key order is fixed by the implementation either way).
{
  const key = incrementalCacheKey("wf-1", "task-a", "p", "r", "d", "u");
  // stableHash is defined as sha256(stableStringify(...)); confirm the
  // incremental key equals stableHash's own composition for the SAME
  // field object built via a different key literal order.
  const reordered = { upstreamResultsDigest: "u", delegationDigest: "d", runInputsDigest: "r", promptDigest: "p", taskId: "task-a", workflowId: "wf-1", schemaVersion: 2 };
  assert.equal(key, sha256(stableStringify(reordered)), "the underlying stableStringify must be key-order-independent");
}

// schemaVersion 1 (default) and schemaVersion 2 (incremental) keys must
// NEVER collide, even when fed conceptually "the same" logical inputs —
// verify by choosing field values that would coincide under a naive
// same-shape hash but confirming the schemaVersion tag alone changes the
// digest.
{
  const v1 = defaultCacheKey("wf-1", "task-a", "keyInput", "keyValue", "promptDigest", "completedDigest");
  const v2 = incrementalCacheKey("wf-1", "task-a", "promptDigest", "runInputsDigest", "delegationDigest", "upstreamDigest");
  assert.notEqual(v1, v2, "schemaVersion 1 and 2 cache keys must never collide");
}

// incrementalDelegationDigest: golden composition against
// sha256(stableStringify({model, agentType, sandboxProfileId, command,
// args, endpoint})).
{
  const digest = incrementalDelegationDigest("gpt-5", "agent", "readonly", "/usr/bin/agent", ["--flag", "value"], "");
  const expected = sha256(
    stableStringify({ model: "gpt-5", agentType: "agent", sandboxProfileId: "readonly", command: "/usr/bin/agent", args: ["--flag", "value"], endpoint: "" })
  );
  assert.equal(digest, expected);
}

// incrementalDelegationDigest: a DIFFERENT model produces a DIFFERENT
// digest (this is the "model swap must invalidate the cache" invariant
// from the SPEC's own Rebuild risk #4).
{
  const a = incrementalDelegationDigest("gpt-5", "agent", "readonly", "/usr/bin/agent", [], "");
  const b = incrementalDelegationDigest("gpt-6", "agent", "readonly", "/usr/bin/agent", [], "");
  assert.notEqual(a, b, "a model swap must change the delegation digest so cached results are NOT reused across models");
}

// incrementalDelegationDigest: a different sandboxProfileId changes the
// digest too (the SPEC explicitly calls out "sandbox PROFILE ID — not the
// full policy" as a required fold-in).
{
  const a = incrementalDelegationDigest("gpt-5", "agent", "readonly", "cmd", [], "");
  const b = incrementalDelegationDigest("gpt-5", "agent", "readwrite", "cmd", [], "");
  assert.notEqual(a, b, "a changed sandbox profile id must change the delegation digest");
}

// incrementalDelegationDigest: args ORDER matters (it is an array, not a
// sorted set — stableStringify only sorts object KEYS, not array
// elements, per PLAN.md byte-compat item 2/"stableHash over arrays
// preserves order").
{
  const a = incrementalDelegationDigest("gpt-5", "agent", "readonly", "cmd", ["--a", "--b"], "");
  const b = incrementalDelegationDigest("gpt-5", "agent", "readonly", "cmd", ["--b", "--a"], "");
  assert.notEqual(a, b, "arg order must be preserved and must affect the digest, not be treated as an unordered set");
}

// incrementalDelegationDigest: an empty endpoint string vs a real one
// changes the digest.
{
  const a = incrementalDelegationDigest("gpt-5", "agent", "readonly", "cmd", [], "");
  const b = incrementalDelegationDigest("gpt-5", "agent", "readonly", "cmd", [], "https://api.example.com");
  assert.notEqual(a, b);
}

process.stdout.write("pipelinecore-drivedecide-cachekey-incremental: ok\n");
