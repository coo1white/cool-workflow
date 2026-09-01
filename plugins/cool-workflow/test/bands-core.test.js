#!/usr/bin/env node
// bands-core — pins core/bands.ts's pure helpers: parseBandsConfig/
// parseBandsInput (fail closed on bad shape), evaluateBands (tier
// boundaries, exact three-sigma edges, a two-sided breach, the series ->
// mean reduction), and buildIntentMarkdown/intentFileName (deterministic
// given the same `now`).

const assert = require("node:assert/strict");

const { parseBandsConfig, parseBandsInput, evaluateBands, buildIntentMarkdown, intentFileName } = require("../dist/core/bands");

function config(overrides = {}) {
  return parseBandsConfig({
    metric: "checkout_latency_ms",
    rules: "three-sigma",
    baseline: { mean: 100, stddev: 10 },
    tiers: {
      "1": { outcome: "Watch it." },
      "2": { outcome: "Open an intent." },
      "3": { outcome: "Page on-call." },
    },
    affectedSystems: ["checkout-service"],
    window: "7d",
    ...overrides,
  });
}

// --- parseBandsConfig: fail closed on every bad shape.
{
  assert.throws(() => parseBandsConfig(null), /must be a JSON object/);
  assert.throws(() => parseBandsConfig({}), /"metric"/);
  assert.throws(() => parseBandsConfig({ metric: "m", rules: "western-electric" }), /"rules" must be exactly "three-sigma"/);
  assert.throws(() => parseBandsConfig({ metric: "m", rules: "three-sigma" }), /"baseline"/);
  assert.throws(
    () => parseBandsConfig({ metric: "m", rules: "three-sigma", baseline: { mean: 1, stddev: 0 } }),
    /stddev.*greater than 0/,
    "a flat baseline (stddev 0) is refused, not divided by"
  );
  assert.throws(
    () => parseBandsConfig({ metric: "m", rules: "three-sigma", baseline: { mean: 1, stddev: 1 }, tiers: { "1": {}, "2": {}, "3": {} } }),
    /outcome must be a non-empty string/
  );
  // a good config round-trips its own fields
  const c = config();
  assert.equal(c.metric, "checkout_latency_ms");
  assert.deepEqual(c.affectedSystems, ["checkout-service"]);
}

// --- parseBandsInput: exactly one of value/series, fail closed otherwise.
{
  assert.throws(() => parseBandsInput({}), /exactly one of "value" or "series"/);
  assert.throws(() => parseBandsInput({ value: 1, series: [1] }), /exactly one of "value" or "series"/);
  assert.throws(() => parseBandsInput({ value: "not a number" }), /"value" must be a finite number/);
  assert.throws(() => parseBandsInput({ series: [] }), /non-empty array of finite numbers/);
  assert.throws(() => parseBandsInput({ series: [1, "x"] }), /non-empty array of finite numbers/);
  assert.deepEqual(parseBandsInput({ value: 42 }), { value: 42 });
  assert.deepEqual(parseBandsInput({ series: [1, 2, 3] }), { series: [1, 2, 3] });
}

// --- evaluateBands: tier boundaries, exact three-sigma edges (inclusive).
{
  const c = config();
  const tierOf = (value) => evaluateBands(c, parseBandsInput({ value })).tier;
  assert.equal(tierOf(100), "none", "at the baseline mean, no breach");
  assert.equal(tierOf(109.999), "none", "just under 1 sigma is still none");
  assert.equal(tierOf(110), "1", "exactly 1 sigma away breaches tier 1 (inclusive edge)");
  assert.equal(tierOf(119.999), "1", "just under 2 sigma stays at tier 1");
  assert.equal(tierOf(120), "2", "exactly 2 sigma away breaches tier 2 (inclusive edge)");
  assert.equal(tierOf(130), "3", "exactly 3 sigma away breaches tier 3 (inclusive edge)");
  assert.equal(tierOf(150), "3", "well past 3 sigma is still tier 3, never higher");
  // two-sided: a drop below the baseline breaches the same tiers.
  assert.equal(tierOf(90), "1", "1 sigma BELOW the baseline also breaches tier 1");
  assert.equal(tierOf(70), "3", "3 sigma below the baseline breaches tier 3");
}

// --- evaluateBands: a series input reduces to its own mean/stddev.
{
  const c = config();
  const e = evaluateBands(c, parseBandsInput({ series: [118, 120, 122] }));
  assert.equal(e.observedValue, 120, "the series' own mean is the reading tested against the baseline");
  assert.equal(e.observedStddev, 2, "the series' own stddev is reported (sample stddev, n-1)");
  assert.equal(e.tier, "2", "a mean of 120 is exactly 2 sigma from a baseline of mean 100 / stddev 10");
}

// --- evaluateBands: outcome text and affected systems carry through; "none" carries no outcome.
{
  const c = config();
  const none = evaluateBands(c, parseBandsInput({ value: 100 }));
  assert.equal(none.outcome, undefined, "a tier of none carries no outcome text");
  const tier3 = evaluateBands(c, parseBandsInput({ value: 130 }));
  assert.equal(tier3.outcome, "Page on-call.");
  assert.deepEqual(tier3.affectedSystems, ["checkout-service"]);
}

// --- intentFileName / buildIntentMarkdown: deterministic given the same `now`.
{
  const now = "2026-09-01T00:00:00.000Z";
  const name1 = intentFileName("checkout_latency_ms", now);
  const name2 = intentFileName("checkout_latency_ms", now);
  assert.equal(name1, name2, "the same metric + the same now always names the same file");
  assert.match(name1, /^2026-09-01T00-00-00\.000Z-checkout_latency_ms\.md$/);
  assert.equal(intentFileName("weird metric/../name", now).includes("/"), false, "an unsafe metric name is stripped down to a single path segment");

  const c = config();
  const evaluation = evaluateBands(c, parseBandsInput({ value: 130 }));
  const doc = { evaluation, now, configDigest: "sha256:aaa", inputDigest: "sha256:bbb" };
  const md1 = buildIntentMarkdown(doc);
  const md2 = buildIntentMarkdown(doc);
  assert.equal(md1, md2, "the same evaluation + now + digests always render the same bytes");
  assert.match(md1, /^# Intent: checkout_latency_ms band breach \(tier 3\)/);
  assert.ok(md1.includes("Page on-call."), "the tier's own outcome text is in the doc");
  assert.ok(md1.includes("sha256:aaa") && md1.includes("sha256:bbb"), "both digests are in the Evidence section");
  assert.ok(md1.includes("- checkout-service"), "the affected system is listed");

  const noneDoc = { evaluation: evaluateBands(c, parseBandsInput({ value: 100 })), now, configDigest: "sha256:aaa", inputDigest: "sha256:bbb" };
  assert.ok(buildIntentMarkdown(noneDoc).includes("no outcome text for this tier"), "a none-tier doc still renders (never called for real, but never throws)");
}

process.stdout.write("bands-core: ok\n");
