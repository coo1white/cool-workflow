#!/usr/bin/env node
// dispatch-render — shouldRenderHuman: only a "default" row with a human
// view, on a real TTY, without --json, prints the human text. Every pipe
// gets JSON; a color env var never picks the mode.

import assert from "node:assert/strict";
import { shouldRenderHuman } from "../../dist/cli/dispatch.js";

const row = (jsonMode, human = true) => ({ path: ["x"], summary: "", jsonMode, handler: () => ({}), ...(human ? { humanRender: () => "" } : {}) });
const tty = { isTTY: true };
const pipe = { isTTY: false };

assert.equal(shouldRenderHuman(row("default"), {}, tty), true);
assert.equal(shouldRenderHuman(row("default"), {}, pipe), false, "a pipe gets JSON");
assert.equal(shouldRenderHuman(row("default"), { json: true }, tty), false, "--json wins on a TTY");
assert.equal(shouldRenderHuman(row("default"), { format: "json" }, tty), false);
assert.equal(shouldRenderHuman(row("default", false), {}, tty), false, "no human view, no human text");
assert.equal(shouldRenderHuman(row("flag"), {}, tty), false);
assert.equal(shouldRenderHuman(row("human"), {}, tty), false);

console.log("dispatch-render: ok");
