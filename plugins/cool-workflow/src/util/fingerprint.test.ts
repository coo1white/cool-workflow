// Unit test for the canonical fingerprint utility (v0.1.95).
// Pure function — no run state or tmpdir needed.
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { fingerprintStrings, fingerprintRecords } from "../util/fingerprint";

test("fingerprintStrings returns a sha256: prefix", () => {
  const fp = fingerprintStrings(["a", "b"]);
  ok(fp.startsWith("sha256:"), "must have sha256: prefix");
  equal(fp.length, 32 + "sha256:".length, "must be 32 hex chars");
});

test("fingerprintStrings is deterministic and order-independent", () => {
  const a = fingerprintStrings(["b", "a", "c"]);
  const b = fingerprintStrings(["c", "b", "a"]);
  equal(a, b, "same values in different order must produce same fingerprint");
});

test("fingerprintStrings produces distinct values for different inputs", () => {
  const a = fingerprintStrings(["x"]);
  const b = fingerprintStrings(["y"]);
  ok(a !== b, "different inputs must produce different fingerprints");
});

test("fingerprintRecords uses id:status sorted", () => {
  const a = fingerprintRecords([{ id: "b", status: "ok" }, { id: "a", status: "fail" }]);
  const b = fingerprintRecords([{ id: "a", status: "fail" }, { id: "b", status: "ok" }]);
  equal(a, b, "records in different order must produce same fingerprint");
});
