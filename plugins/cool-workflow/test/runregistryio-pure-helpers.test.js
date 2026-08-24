#!/usr/bin/env node
// runregistryio-pure-helpers — pins shell/run-registry-io's pure helpers:
// the compare functions (record/history/queue order), matchesQuery,
// digestInputs (priority keys, 360-char cut), countRecords, clampInt,
// optionalLower, queueId's byte format, isRunLifecycleState,
// deriveLifecycle's first-match-wins ladder, and humanBytes.

const assert = require("node:assert/strict");

const {
  compareBytes,
  compareRecords,
  compareHistory,
  compareQueue,
  matchesQuery,
  digestInputs,
  distinctBackends,
  countRecords,
  optionalLower,
  clampInt,
  queueId,
  isRunLifecycleState,
  deriveLifecycle,
  humanBytes,
} = require("../dist/shell/run-registry-io");

// --- compareBytes: plain code-unit order.
{
  assert.equal(compareBytes("a", "b"), -1);
  assert.equal(compareBytes("b", "a"), 1);
  assert.equal(compareBytes("a", "a"), 0);
  assert.equal(compareBytes("Z", "a"), -1, "upper-case sorts before lower-case (byte order, not locale)");
}

// --- compareRecords: createdAt up, then runId bytes.
// --- compareHistory: createdAt DOWN (newest first), then runId bytes up.
{
  const r = (runId, createdAt) => ({ runId, createdAt });
  assert.equal(compareRecords(r("x", "2026-01-01"), r("x", "2026-01-02")), -1, "older first");
  assert.equal(compareRecords(r("a", "2026-01-01"), r("b", "2026-01-01")), -1, "same time: id bytes decide");
  assert.equal(compareHistory(r("x", "2026-01-01"), r("x", "2026-01-02")), 1, "history: newest first");
  assert.equal(compareHistory(r("a", "2026-01-01"), r("b", "2026-01-01")), -1, "history same time: id bytes up");
}

// --- compareQueue: priority up, then enqueuedAt, then id.
{
  const q = (id, priority, enqueuedAt) => ({ id, priority, enqueuedAt });
  assert.equal(compareQueue(q("a", 1, "t"), q("b", 2, "t")) < 0, true, "lower priority number first");
  assert.equal(compareQueue(q("a", 1, "2026-01-01"), q("b", 1, "2026-01-02")) < 0, true, "same priority: earlier first");
  assert.equal(compareQueue(q("a", 1, "t"), q("b", 1, "t")) < 0, true, "same priority and time: id bytes");
}

// --- matchesQuery: every filter, one at a time. Note search() lower-cases
// text/app before this is called, so the query side is given lower-case.
{
  const record = {
    runId: "run-1",
    appId: "Demo-App",
    workflowId: "wf-1",
    title: "My Title",
    repo: "/some/repo",
    lifecycle: "archived",
    derivedLifecycle: "completed",
    loopStage: "act",
    createdAt: "2026-01-05T00:00:00.000Z",
    inputsDigest: "question=why",
  };
  const base = { includeArchived: true, offset: 0, limit: 50 };
  assert.equal(matchesQuery(record, { ...base }), true, "no filters: everything matches");
  assert.equal(matchesQuery(record, { ...base, app: "demo" }), true, "app matches appId, case-free");
  assert.equal(matchesQuery(record, { ...base, app: "other" }), false);
  assert.equal(matchesQuery(record, { ...base, status: "completed" }), true, "status may match derivedLifecycle");
  assert.equal(matchesQuery(record, { ...base, status: "archived" }), true, "status may match lifecycle");
  assert.equal(matchesQuery(record, { ...base, status: "failed" }), false);
  assert.equal(matchesQuery(record, { ...base, repo: "/some/repo" }), true);
  assert.equal(matchesQuery(record, { ...base, repo: "/other/repo" }), false);
  assert.equal(matchesQuery(record, { ...base, since: "2026-01-01" }), true);
  assert.equal(matchesQuery(record, { ...base, since: "2026-02-01" }), false, "made before since: out");
  assert.equal(matchesQuery(record, { ...base, until: "2026-01-01" }), false, "made after until: out");
  assert.equal(matchesQuery(record, { ...base, text: "my title" }), true, "text looks in the title");
  assert.equal(matchesQuery(record, { ...base, text: "question=why" }), true, "text looks in inputsDigest");
  assert.equal(matchesQuery(record, { ...base, text: "no-such-words" }), false);
}

// --- digestInputs: priority keys first (in their fixed order), the rest
// sorted; arrays join with ","; objects are JSON; null/undefined dropped;
// spare whitespace becomes one space; over 360 chars is cut with "...".
{
  assert.equal(digestInputs(undefined), undefined);
  assert.equal(digestInputs(null), undefined);
  assert.equal(
    digestInputs({ b: "2", question: "why", a: "1", title: "t" }),
    "question=why title=t a=1 b=2",
    "priority keys first, then the rest in sorted order"
  );
  assert.equal(digestInputs({ list: [1, 2, 3] }), "list=1,2,3", "arrays join with a comma");
  assert.equal(digestInputs({ obj: { k: 1 } }), 'obj={"k":1}', "objects go through JSON");
  assert.equal(digestInputs({ a: null, b: undefined, c: "x" }), "c=x", "null and undefined values are dropped");
  assert.equal(digestInputs({ a: "two  words\n\nhere" }), "a=two words here", "runs of whitespace become one space");
  const long = digestInputs({ question: "x".repeat(500) });
  assert.equal(long.length, 360, "a long digest is cut to exactly 360 chars");
  assert.ok(long.endsWith("..."), "the cut is marked with ...");
}

// --- distinctBackends: from dispatches and tasks, no doubles, sorted.
{
  const run = {
    dispatches: [{ backendId: "b" }, { backendId: "a" }, {}],
    tasks: [{ backendId: "a" }, { backendId: "c" }, {}],
  };
  assert.deepEqual(distinctBackends(run), ["a", "b", "c"]);
  assert.deepEqual(distinctBackends({}), [], "a run with no lists gives an empty list");
}

// --- countRecords counts by the record's lifecycle.
{
  const counts = countRecords([
    { lifecycle: "completed" },
    { lifecycle: "completed" },
    { lifecycle: "failed" },
    { lifecycle: "reclaimed" },
  ]);
  assert.deepEqual(counts, {
    total: 4,
    queued: 0,
    running: 0,
    blocked: 0,
    completed: 2,
    failed: 1,
    archived: 0,
    reclaimed: 1,
  });
}

// --- optionalLower / clampInt.
{
  assert.equal(optionalLower("ABC"), "abc");
  assert.equal(optionalLower(""), undefined, "empty string reads as not given");
  assert.equal(optionalLower(null), undefined);
  assert.equal(optionalLower(undefined), undefined);
  assert.equal(optionalLower(5), "5", "a number is stringified then lower-cased");

  assert.equal(clampInt("7.9", 1, 0), 7, "floors to a whole number");
  assert.equal(clampInt(-3, 1, 0), 0, "held up at the floor");
  assert.equal(clampInt("not-a-number", 42, 0), 42, "fallback when not a number");
  assert.equal(clampInt(undefined, 42, 0), 42);
  assert.equal(clampInt(Infinity, 42, 0), 42, "Infinity is not finite: fallback");
}

// --- queueId: byte format q-<stamp14>-<NNN>, and a taken id is stepped over.
{
  const first = queueId();
  assert.match(first, /^q-\d{14}-\d{3}$/, "the exact q-<stamp14>-<NNN> format");
  const stamp = first.slice(2, 16);
  // The module counter is at 1 now; block the id the next call would mint.
  const blocked = `q-${stamp}-002`;
  const second = queueId(new Set([blocked]));
  assert.match(second, /^q-\d{14}-\d{3}$/);
  assert.notEqual(second, blocked, "a taken id is never given out again");
  if (second.startsWith(`q-${stamp}-`)) {
    assert.equal(second, `q-${stamp}-003`, "the counter steps past the taken id");
  }
}

// --- isRunLifecycleState.
{
  for (const good of ["queued", "running", "blocked", "completed", "failed", "archived", "reclaimed"]) {
    assert.equal(isRunLifecycleState(good), true, good);
  }
  assert.equal(isRunLifecycleState("done"), false);
  assert.equal(isRunLifecycleState(""), false);
  assert.equal(isRunLifecycleState(undefined), false);
  assert.equal(isRunLifecycleState(3), false);
}

// --- deriveLifecycle: the first-match-wins ladder, in order.
{
  const base = { total: 0, pending: 0, running: 0, failed: 0, completed: 0, verifierGatedCommits: 0, openFeedback: 0, loopStage: "act" };
  assert.equal(deriveLifecycle({ ...base, running: 1, failed: 1, openFeedback: 1 }), "running", "running wins over everything");
  assert.equal(deriveLifecycle({ ...base, openFeedback: 1, failed: 1 }), "blocked", "open feedback wins over failed");
  assert.equal(deriveLifecycle({ ...base, failed: 1, total: 2, completed: 1 }), "failed");
  assert.equal(deriveLifecycle({ ...base, total: 2, completed: 2 }), "completed", "all tasks done");
  assert.equal(deriveLifecycle({ ...base, verifierGatedCommits: 1 }), "completed", "gated commit with nothing pending");
  assert.equal(
    deriveLifecycle({ ...base, total: 2, pending: 1, completed: 1 }),
    "running",
    "part done, nothing gated: still running"
  );
  assert.equal(deriveLifecycle({ ...base, total: 2, pending: 2 }), "queued");
  assert.equal(deriveLifecycle(base), "queued", "an empty run is queued");
  assert.equal(
    deriveLifecycle({ ...base, total: 2, pending: 1, verifierGatedCommits: 1 }),
    "queued",
    "a gated commit does NOT complete a run that still has pending tasks"
  );
}

// --- humanBytes: B under 1024, then KiB/MiB/GiB with one decimal.
{
  assert.equal(humanBytes(0), "0B");
  assert.equal(humanBytes(1023), "1023B");
  assert.equal(humanBytes(1024), "1.0KiB");
  assert.equal(humanBytes(1536), "1.5KiB");
  assert.equal(humanBytes(1024 * 1024), "1.0MiB");
  assert.equal(humanBytes(1024 * 1024 * 1024), "1.0GiB");
  assert.equal(humanBytes(1024 * 1024 * 1024 * 1024), "1024.0GiB", "GiB is the top unit; it never goes past it");
}

process.stdout.write("runregistryio-pure-helpers: ok\n");
