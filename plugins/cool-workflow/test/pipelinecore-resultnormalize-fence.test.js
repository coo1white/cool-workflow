#!/usr/bin/env node
// pipelinecore-resultnormalize-fence — normalizeResultEnvelope: the
// cw:result fence regex, no-fence prose fallback, bad-JSON throw, and
// summary-key priority order. SPEC/pipeline-run.md "Result ingest —
// src/result-normalize.ts" (src/result-normalize.ts:22-201).

const assert = require("node:assert/strict");
const { normalizeResultEnvelope, firstNonEmptyLine } = require("../dist/core/pipeline/result-normalize");

// No fence at all: summary = first non-empty line not starting with "#" or
// a code fence; findings = []; evidence harvested from the prose.
{
  const md = "# Title\n\nThis is the real summary line.\n\nSee `src/foo.ts:10` for detail.\n";
  const env = normalizeResultEnvelope(md);
  assert.equal(env.summary, "This is the real summary line.");
  assert.deepEqual(env.findings, []);
  assert.ok(env.evidence.includes("src/foo.ts:10"), "grounded locator must be harvested from fence-less prose");
}

// A fence with syntactically bad JSON throws with the exact prefixed
// message (the underlying parser message is appended, so we only pin the
// prefix here).
{
  const md = "```cw:result\n{ not valid json \n```";
  assert.throws(() => normalizeResultEnvelope(md), /^Error: Invalid cw:result JSON: /);
}

// Canonical fence: summary/findings/evidence read directly off the parsed
// JSON when the "summary" key is present.
{
  const md = '```cw:result\n{"summary":"all good","findings":[],"evidence":["a.ts:1"]}\n```';
  const env = normalizeResultEnvelope(md);
  assert.equal(env.summary, "all good");
  assert.deepEqual(env.evidence, ["a.ts:1"]);
}

// Summary key priority order: summary > short_answer > shortAnswer >
// verdict > answer > conclusion > first non-empty line.
{
  const md = 'intro line\n```cw:result\n{"short_answer":"from short_answer","verdict":"from verdict"}\n```';
  const env = normalizeResultEnvelope(md);
  assert.equal(env.summary, "from short_answer", "short_answer must win over verdict when summary key is absent");
}
{
  const md = 'intro line\n```cw:result\n{"verdict":"from verdict","answer":"from answer"}\n```';
  const env = normalizeResultEnvelope(md);
  assert.equal(env.summary, "from verdict", "verdict must win over answer");
}
{
  const md = 'intro line\n```cw:result\n{"conclusion":"from conclusion"}\n```';
  const env = normalizeResultEnvelope(md);
  assert.equal(env.summary, "from conclusion");
}

// No summary-ish key at all in the fenced JSON -> falls back to
// firstNonEmptyLine of the WHOLE markdown (not just the JSON).
{
  const md = "the real first line\n```cw:result\n{\"findings\":[]}\n```";
  const env = normalizeResultEnvelope(md);
  assert.equal(env.summary, "the real first line");
}

// firstNonEmptyLine: skips blank lines, lines starting with "#", and lines
// starting with a code fence "```".
{
  assert.equal(firstNonEmptyLine("\n\n# Heading\n```js\nactual text\n"), "actual text");
  assert.equal(firstNonEmptyLine("   \nreal content   \nmore"), "real content", "surrounding whitespace on the picked line is trimmed");
  assert.equal(firstNonEmptyLine(""), "", "empty input -> empty string, never undefined/null");
  assert.equal(firstNonEmptyLine("# only headings\n# more headings"), "", "an all-heading document has no eligible line");
}

// A fence whose JSON parses to a non-object (e.g. a bare array) does not
// throw at the parse step — normalizeResultEnvelope still returns a valid
// envelope shape (pickString/extractFindingsRaw handle it via
// obj[key] on an array, which is safe).
{
  const md = "```cw:result\n[1,2,3]\n```";
  const env = normalizeResultEnvelope(md);
  assert.equal(typeof env.summary, "string");
  assert.deepEqual(env.findings, []);
}

process.stdout.write("pipelinecore-resultnormalize-fence: ok\n");
