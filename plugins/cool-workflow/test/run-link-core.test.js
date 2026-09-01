#!/usr/bin/env node
// run-link-core — pins core/run-link.ts's pure helpers: parseRunLinkUrl
// (http/https only, throws on junk), normalizeRunLinkKind (default "pr",
// rejects an unknown kind), buildRunLink (the actor fallback, the note
// trim, the injected `now`, never `new Date()` inside), and
// appendRunLink (the same-url no-op rule, keeping the FIRST entry).

const assert = require("node:assert/strict");

const { parseRunLinkUrl, normalizeRunLinkKind, buildRunLink, appendRunLink } = require("../dist/core/run-link");

// --- parseRunLinkUrl: only a real http(s) url passes.
{
  assert.equal(parseRunLinkUrl("https://example.com/pr/1"), "https://example.com/pr/1");
  assert.equal(parseRunLinkUrl("  http://example.com/x  "), "http://example.com/x", "leading/trailing space is trimmed");
  assert.throws(() => parseRunLinkUrl(""), /needs a url/, "an empty url is refused");
  assert.throws(() => parseRunLinkUrl("not a url"), /does not parse/, "junk text is refused");
  assert.throws(() => parseRunLinkUrl("ftp://example.com/f"), /http or https/, "a non-http(s) scheme is refused");
}

// --- normalizeRunLinkKind: "pr" by default; only the three known words pass.
{
  assert.equal(normalizeRunLinkKind(undefined), "pr", "no kind given -> pr");
  assert.equal(normalizeRunLinkKind(""), "pr", "empty kind -> pr");
  assert.equal(normalizeRunLinkKind("issue"), "issue");
  assert.equal(normalizeRunLinkKind("Ticket"), "ticket", "kind is case-folded");
  assert.throws(() => normalizeRunLinkKind("epic"), /must be one of/, "an unknown kind is refused");
}

// --- buildRunLink: the actor fallback, the note trim, the injected `now`.
{
  const now = "2026-09-01T00:00:00.000Z";
  const link = buildRunLink({ url: "https://example.com/pr/9" }, now);
  assert.equal(link.url, "https://example.com/pr/9");
  assert.equal(link.kind, "pr", "kind default when none given");
  assert.equal(link.addedAt, now, "addedAt is exactly the injected now, never a fresh clock read");
  assert.equal(link.actor, "cw", "actor falls back to the same unnamed-actor stand-in used elsewhere in this codebase");
  assert.equal(link.note, undefined, "no note given -> no note field");

  const noted = buildRunLink({ url: "https://example.com/pr/9", kind: "issue", note: "  see also  ", actor: "alice" }, now);
  assert.equal(noted.note, "see also", "a note is trimmed");
  assert.equal(noted.actor, "alice");
  assert.equal(noted.kind, "issue");
}

// --- appendRunLink: same url twice is an idempotent no-op; a new url is added.
{
  const now1 = "2026-09-01T00:00:00.000Z";
  const now2 = "2026-09-02T00:00:00.000Z";
  const first = buildRunLink({ url: "https://example.com/pr/1", actor: "alice" }, now1);
  const empty = appendRunLink([], first);
  assert.equal(empty.added, true);
  assert.deepEqual(empty.links, [first]);

  const repeat = buildRunLink({ url: "https://example.com/pr/1", kind: "issue", note: "later", actor: "bob" }, now2);
  const again = appendRunLink(empty.links, repeat);
  assert.equal(again.added, false, "the same url a second time is a no-op");
  assert.deepEqual(again.links, [first], "the link list is unchanged");
  assert.deepEqual(again.link, first, "the FIRST entry is kept, never overwritten by the repeat");

  const second = buildRunLink({ url: "https://example.com/pr/2" }, now2);
  const grown = appendRunLink(empty.links, second);
  assert.equal(grown.added, true);
  assert.deepEqual(grown.links, [first, second], "a new url is added, order kept");
}

process.stdout.write("run-link-core: ok\n");
