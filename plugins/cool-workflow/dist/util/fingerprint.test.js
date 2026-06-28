"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Unit test for the canonical fingerprint utility (v0.1.95).
// Pure function — no run state or tmpdir needed.
const strict_1 = require("node:assert/strict");
const node_test_1 = require("node:test");
const fingerprint_1 = require("../util/fingerprint");
(0, node_test_1.test)("fingerprintStrings returns a sha256: prefix", () => {
    const fp = (0, fingerprint_1.fingerprintStrings)(["a", "b"]);
    (0, strict_1.ok)(fp.startsWith("sha256:"), "must have sha256: prefix");
    (0, strict_1.equal)(fp.length, 32 + "sha256:".length, "must be 32 hex chars");
});
(0, node_test_1.test)("fingerprintStrings is deterministic and order-independent", () => {
    const a = (0, fingerprint_1.fingerprintStrings)(["b", "a", "c"]);
    const b = (0, fingerprint_1.fingerprintStrings)(["c", "b", "a"]);
    (0, strict_1.equal)(a, b, "same values in different order must produce same fingerprint");
});
(0, node_test_1.test)("fingerprintStrings produces distinct values for different inputs", () => {
    const a = (0, fingerprint_1.fingerprintStrings)(["x"]);
    const b = (0, fingerprint_1.fingerprintStrings)(["y"]);
    (0, strict_1.ok)(a !== b, "different inputs must produce different fingerprints");
});
(0, node_test_1.test)("fingerprintRecords uses id:status sorted", () => {
    const a = (0, fingerprint_1.fingerprintRecords)([{ id: "b", status: "ok" }, { id: "a", status: "fail" }]);
    const b = (0, fingerprint_1.fingerprintRecords)([{ id: "a", status: "fail" }, { id: "b", status: "ok" }]);
    (0, strict_1.equal)(a, b, "records in different order must produce same fingerprint");
});
