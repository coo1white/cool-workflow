#!/usr/bin/env node
// copied-run-refusal — copiedRunRefusal names a run folder copied by hand
// (for one, cp -R) from a run folder that is still there, and only that.
// A moved repo, a symlinked path, an old state with no usable
// paths.runDir, and a folder outside the .cw/runs layout all go on.

import assert from "node:assert/strict";
import { copiedRunRefusal } from "../../../dist/core/state/run-paths.js";

const id = "demo-run";
const found = "/copy/.cw/runs/demo-run";
const origin = "/orig/.cw/runs/demo-run";
const notSame = () => false;
const there = () => true;

// A hand copy whose original is still there is refused, with the fix.
{
  const message = copiedRunRefusal(id, found, origin, notSame, there);
  assert.ok(message, "a hand copy is refused");
  assert.ok(message.startsWith(`Refusing to load run ${id}: the folder ${found} is a copy of ${origin},`), message);
  assert.ok(message.includes(`cw run export ${id} --cwd /orig --output /copy/${id}.cwrun.json`), message);
  assert.ok(message.endsWith(`cw run import /copy/${id}.cwrun.json --target /copy`), message);
  // A trailing slash on the stored value is the same folder name.
  assert.ok(copiedRunRefusal(id, found, `${origin}/`, notSame, there), "a trailing slash does not hide a copy");
}

// The original is gone (a moved or cloned repo): no refusal.
assert.equal(copiedRunRefusal(id, found, origin, notSame, () => false), undefined);

// The same real place (a symlink, macOS /var and /private/var): no refusal.
assert.equal(copiedRunRefusal(id, "/var/x/.cw/runs/demo-run", "/private/var/x/.cw/runs/demo-run", () => true, there), undefined);

// The stored value is the found folder (also after resolve): no refusal,
// and the origin check is never asked.
{
  const never = () => {
    throw new Error("originHasRun must not be called");
  };
  assert.equal(copiedRunRefusal(id, found, found, never, never), undefined);
  assert.equal(copiedRunRefusal(id, found, `${found}/`, never, never), undefined);
}

// Old or odd states: no paths.runDir, a relative one, another run id's
// folder, or a folder outside the .cw/runs layout: no refusal.
for (const stored of [undefined, null, 7, "", "relative/.cw/runs/demo-run", "/orig/.cw/runs/other-run", "/orig/runs/demo-run", "/orig/.cw/demo-run"]) {
  assert.equal(copiedRunRefusal(id, found, stored, notSame, there), undefined, `stored ${String(stored)}`);
}
assert.equal(copiedRunRefusal(id, "/copy/elsewhere/demo-run", origin, notSame, there), undefined, "found folder outside the layout");

console.log("copied-run-refusal: ok");
