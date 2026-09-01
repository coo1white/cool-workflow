"use strict";
// core/bands.ts — pure math + template text for the `bands` capability
// (maintain-stage control bands): read a config + a metrics input, work
// out the breached tier, and build the text of an intent file.
//
// Pure: no fs, no clock, no network. `now` always comes in as a plain
// string from the caller (shell/bands-io.ts), and file digests come in as
// plain strings too (the shell layer reads the bytes and hashes them).
//
// Rule (three-sigma, the only rule this build supports): `config.baseline`
// carries an already-worked-out mean/stddev for the metric. The input file
// gives the CURRENT reading, either as one `value`, or as a `series` of
// readings — when a series is given, its own mean/stddev is worked out
// here (this is the "mean/stddev over the provided series" step) and its
// mean is the reading tested against the baseline. The tier is the
// largest k in {1,2,3} such that |reading - baseline.mean| >= k *
// baseline.stddev; below 1 the tier is "none". This is a two-sided check
// (a reading can breach a band by going up OR down). The Western Electric
// rules (runs of points, not a single-sample sigma check) are NOT
// implemented — an open extension, not a gap in this one.
//
// Evidence: docs/control-bands.7.md.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBandsConfig = parseBandsConfig;
exports.parseBandsInput = parseBandsInput;
exports.evaluateBands = evaluateBands;
exports.intentFileName = intentFileName;
exports.buildIntentMarkdown = buildIntentMarkdown;
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireTierRule(value, tier) {
    if (!isPlainObject(value) || typeof value.outcome !== "string" || !value.outcome.trim()) {
        throw new Error(`bands config: tiers["${tier}"].outcome must be a non-empty string`);
    }
    return { outcome: value.outcome.trim() };
}
/** Reads and checks one bands config object. Throws (fail closed) on any
 *  bad shape — a breach is a successful check, but a config CW cannot
 *  read is not. */
function parseBandsConfig(raw) {
    if (!isPlainObject(raw))
        throw new Error("bands config: must be a JSON object");
    if (typeof raw.metric !== "string" || !raw.metric.trim()) {
        throw new Error("bands config: \"metric\" must be a non-empty string");
    }
    if (raw.rules !== "three-sigma") {
        throw new Error('bands config: "rules" must be exactly "three-sigma" (the only rule this build supports)');
    }
    if (!isPlainObject(raw.baseline) || !isFiniteNumber(raw.baseline.mean) || !isFiniteNumber(raw.baseline.stddev)) {
        throw new Error('bands config: "baseline" must be an object with finite "mean" and "stddev" numbers');
    }
    if (raw.baseline.stddev <= 0) {
        throw new Error('bands config: "baseline.stddev" must be greater than 0 (a flat baseline cannot set a band)');
    }
    if (!isPlainObject(raw.tiers))
        throw new Error('bands config: "tiers" must be an object with keys "1", "2", "3"');
    const tiers = {
        "1": requireTierRule(raw.tiers["1"], "1"),
        "2": requireTierRule(raw.tiers["2"], "2"),
        "3": requireTierRule(raw.tiers["3"], "3"),
    };
    const affectedSystems = raw.affectedSystems === undefined
        ? []
        : Array.isArray(raw.affectedSystems) && raw.affectedSystems.every((s) => typeof s === "string")
            ? raw.affectedSystems
            : (() => {
                throw new Error('bands config: "affectedSystems", when given, must be an array of strings');
            })();
    const window = raw.window === undefined ? undefined : typeof raw.window === "string" ? raw.window : (() => {
        throw new Error('bands config: "window", when given, must be a string');
    })();
    return {
        metric: raw.metric.trim(),
        rules: "three-sigma",
        baseline: { mean: raw.baseline.mean, stddev: raw.baseline.stddev },
        tiers,
        affectedSystems,
        window,
    };
}
/** Reads and checks one metrics input object: exactly one of "value" (a
 *  finite number) or "series" (a non-empty array of finite numbers). */
function parseBandsInput(raw) {
    if (!isPlainObject(raw))
        throw new Error("bands input: must be a JSON object");
    const hasValue = raw.value !== undefined;
    const hasSeries = raw.series !== undefined;
    if (hasValue === hasSeries) {
        throw new Error('bands input: give exactly one of "value" or "series", not both and not neither');
    }
    if (hasValue) {
        if (!isFiniteNumber(raw.value))
            throw new Error('bands input: "value" must be a finite number');
        return { value: raw.value };
    }
    if (!Array.isArray(raw.series) || raw.series.length === 0 || !raw.series.every(isFiniteNumber)) {
        throw new Error('bands input: "series" must be a non-empty array of finite numbers');
    }
    return { series: [...raw.series] };
}
function meanOf(values) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}
/** Sample stddev (n-1 divisor); 0 when there is only one reading. */
function stddevOf(values, mean) {
    if (values.length < 2)
        return 0;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
function tierFor(sigmaMultiple) {
    if (sigmaMultiple >= 3)
        return "3";
    if (sigmaMultiple >= 2)
        return "2";
    if (sigmaMultiple >= 1)
        return "1";
    return "none";
}
/** The pure evaluation: config + input -> the breached tier. Never
 *  throws on a good config/input pair (every failure mode is caught by
 *  parseBandsConfig/parseBandsInput first). */
function evaluateBands(config, input) {
    let observedValue;
    let observedStddev;
    if (input.value !== undefined) {
        observedValue = input.value;
    }
    else {
        const series = input.series;
        observedValue = meanOf(series);
        observedStddev = stddevOf(series, observedValue);
    }
    const sigmaMultiple = Math.abs(observedValue - config.baseline.mean) / config.baseline.stddev;
    const tier = tierFor(sigmaMultiple);
    return {
        metric: config.metric,
        window: config.window,
        observedValue,
        observedStddev,
        baselineMean: config.baseline.mean,
        baselineStddev: config.baseline.stddev,
        sigmaMultiple,
        tier,
        outcome: tier === "none" ? undefined : config.tiers[tier].outcome,
        affectedSystems: config.affectedSystems,
    };
}
/** Turns anything outside `[A-Za-z0-9._-]` into `-`, for a safe single
 *  path segment (the intent file's name is built from a metric name and
 *  an ISO timestamp, both untrusted free text). */
function safeSegment(value) {
    return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
/** `.cw/intents/<stamp>-<metric>.md`'s file name, given the metric name
 *  and the injected `now`. Pure function of its two inputs, so the same
 *  metric + the same `now` always names the same file. */
function intentFileName(metric, now) {
    return `${safeSegment(now)}-${safeSegment(metric)}.md`;
}
/** Builds the intent artifact's full markdown text (Basic English, the
 *  playbook's intent.md field set). Byte-identical for the same inputs —
 *  the only input that changes run to run is `now`. */
function buildIntentMarkdown(doc) {
    const e = doc.evaluation;
    const systems = e.affectedSystems.length ? e.affectedSystems.map((s) => `- ${s}`).join("\n") : "- (none given)";
    return [
        `# Intent: ${e.metric} band breach (tier ${e.tier})`,
        "",
        "## Problem",
        `Metric: ${e.metric}`,
        `Observed value: ${e.observedValue}`,
        `Band: tier ${e.tier} (three-sigma rule, ${e.sigmaMultiple.toFixed(3)} sigma from the baseline)`,
        `Window: ${e.window || "(not given)"}`,
        `Made at: ${doc.now}`,
        "",
        "## Evidence",
        `Input file digest: ${doc.inputDigest}`,
        `Config file digest: ${doc.configDigest}`,
        "",
        "## Proposed outcome",
        e.outcome || "(no outcome text for this tier)",
        "",
        "## Affected systems",
        systems,
        "",
        "## Open questions",
        "- Is the baseline still good, or does it need a new reading window?",
        "- Does this call for a change to the metric, or to the band rules?",
        "",
    ].join("\n");
}
