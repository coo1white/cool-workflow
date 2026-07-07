#!/usr/bin/env node
// pipelinecore-drivedecide-cachekey-default — defaultCacheKey (no
// --incremental): schemaVersion 1 formula, disabling conditions
// (missing keyInput/keyValue, unavailable completedResultsDigest), and
// cacheFileName's path format. SPEC/pipeline-run.md "`--incremental` and
// the result cache" (src/drive.ts:398-467) and "Rebuild risks" #4
// ("Cache-key completeness").

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { defaultCacheKey, cacheFileName } = require("../dist/core/pipeline/drive-decide");

function expectedDefaultKey(fields) {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(fields), "utf8").digest("hex");
}

// Golden value: the key is sha256(JSON.stringify({schemaVersion:1,
// workflowId, taskId, keyInput, keyValue (TRIMMED), promptDigest,
// completedResultsDigest})) — verify against a direct node:crypto
// computation of the exact field object and order.
{
  const key = defaultCacheKey("wf-1", "task-a", "repo", "  my-repo  ", "sha256:abc", "");
  const expected = expectedDefaultKey({
    schemaVersion: 1,
    workflowId: "wf-1",
    taskId: "task-a",
    keyInput: "repo",
    keyValue: "my-repo",
    promptDigest: "sha256:abc",
    completedResultsDigest: "",
  });
  assert.equal(key, expected, "defaultCacheKey must match sha256(JSON.stringify(...)) over the exact field set, with keyValue trimmed");
  assert.ok(key.startsWith("sha256:"));
}

// No keyInput at all -> undefined (disables caching for this call — a
// task without an explicit resultCache.keyInput is never cached by
// default).
{
  assert.equal(defaultCacheKey("wf-1", "task-a", undefined, "value", "digest", ""), undefined);
}

// keyValue resolving to an EMPTY string (even after trim) -> undefined.
{
  assert.equal(defaultCacheKey("wf-1", "task-a", "repo", "", "digest", ""), undefined);
  assert.equal(defaultCacheKey("wf-1", "task-a", "repo", "   ", "digest", ""), undefined, "whitespace-only keyValue must also disable caching");
}

// completedResultsDigest === undefined (an earlier task was not
// completed/readable, per includeCompletedResults:"previous-phases")
// disables caching entirely for this call, EVEN THOUGH keyInput/keyValue
// are both fine.
{
  assert.equal(defaultCacheKey("wf-1", "task-a", "repo", "my-repo", "digest", undefined), undefined);
}

// completedResultsDigest of an EMPTY STRING (the "no previous-phases
// scope requested" default) is NOT the same as undefined — it's a valid
// key component, not a disabling condition.
{
  const key = defaultCacheKey("wf-1", "task-a", "repo", "my-repo", "digest", "");
  assert.notEqual(key, undefined, "an empty-string completedResultsDigest must still produce a real key");
}

// Two calls with identical fields produce the SAME key (determinism);
// changing any one field changes the key.
{
  const a = defaultCacheKey("wf-1", "task-a", "repo", "my-repo", "digest-1", "");
  const b = defaultCacheKey("wf-1", "task-a", "repo", "my-repo", "digest-1", "");
  assert.equal(a, b);
  const c = defaultCacheKey("wf-1", "task-a", "repo", "my-repo", "digest-2", "");
  assert.notEqual(a, c, "a changed promptDigest must change the cache key");
  const d = defaultCacheKey("wf-1", "task-a", "repo", "my-repo", "digest-1", "some-upstream-digest");
  assert.notEqual(a, d, "a changed completedResultsDigest must change the cache key");
}

// cacheFileName: <safeFileNamePart(taskId)>-<first-32-hex-of-digest>.md;
// the "sha256:" prefix is stripped before slicing.
{
  const digest = "sha256:" + "a".repeat(64);
  const name = cacheFileName("task-a", digest);
  assert.equal(name, `task-a-${"a".repeat(32)}.md`);
}

// cacheFileName: the safe-filename charset preserves ":" (a task id like
// "golden:path" must keep its colon, per this bucket's own file-scoped
// safeFileNamePart comment citing the SPEC's cache-file-path line).
{
  const digest = "sha256:" + "b".repeat(64);
  const name = cacheFileName("golden:path", digest);
  assert.equal(name, `golden:path-${"b".repeat(32)}.md`, "a colon in the task id must survive into the cache filename");
}

// cacheFileName: characters OUTSIDE the safe charset [a-zA-Z0-9_.:-] are
// collapsed to a single underscore run.
{
  const digest = "sha256:" + "c".repeat(64);
  const name = cacheFileName("task with spaces/and*stars", digest);
  assert.equal(name, `task_with_spaces_and_stars-${"c".repeat(32)}.md`);
}

// cacheFileName: a digest with NO "sha256:" prefix is used as-is (only a
// leading "sha256:" is stripped, via the anchored regex).
{
  const bareDigest = "d".repeat(64);
  const name = cacheFileName("task-a", bareDigest);
  assert.equal(name, `task-a-${"d".repeat(32)}.md`);
}

process.stdout.write("pipelinecore-drivedecide-cachekey-default: ok\n");
