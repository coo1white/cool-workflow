#!/usr/bin/env node
// evidence-receipt-locator — `receipt:<id>` is its own evidence kind: it is
// found by receiptIdsIn (so the accept path and the commit gate re-check
// it), never resolved as a file, and still counts as grounded.

import assert from "node:assert/strict";
import { isGroundedEvidence, receiptIdsIn, resolveEvidenceLocator } from "../../../dist/core/trust/evidence-grounding.js";

assert.deepEqual(receiptIdsIn(["README.md:1", "receipt:rc-0123456789abcdef", "https://x.y/z", "receipt:rc-0123456789abcdef", " receipt:bad/../x "]), [
  "rc-0123456789abcdef",
  "bad/../x",
]);
assert.deepEqual(receiptIdsIn(["test:npm test", "README.md"]), []);
assert.deepEqual(receiptIdsIn(undefined), []);
assert.equal(isGroundedEvidence("receipt:rc-0123456789abcdef"), true);
// A receipt locator with a path shape is still a receipt, never a file check.
const never = () => assert.fail("a receipt locator must not touch the file system");
assert.equal(resolveEvidenceLocator("receipt:a/b.ts", ["/x"], never, never, never), "opaque");

console.log("evidence-receipt-locator: ok");
