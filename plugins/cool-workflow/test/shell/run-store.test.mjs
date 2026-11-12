#!/usr/bin/env node
// run-store — loadRun reads .cw/runs/<id>/state.json by direct path: a
// missing run, an older state format, bad JSON and a mismatched id are each
// refused with one line; paths come from the folder, never from the file.
// latestRunId picks the newest run.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { latestRunId, loadRun, newRunId, OLD_RUN_REFUSAL, runsDir } from "../../dist/shell/run-store.js";
import { RUN_STATE_SCHEMA_VERSION } from "../../dist/core/state/types.js";
import { tmpDir } from "../helpers/workspace.mjs";

const cwd = tmpDir("cw-run-store-");
const put = (id, state) => {
  fs.mkdirSync(path.join(runsDir(cwd), id), { recursive: true });
  fs.writeFileSync(path.join(runsDir(cwd), id, "state.json"), typeof state === "string" ? state : JSON.stringify(state));
};

assert.equal(latestRunId(cwd), undefined, "no runs yet");
assert.throws(() => loadRun("nope", cwd), /^Error: Run not found: nope/);
assert.throws(() => loadRun("../x", cwd), /run id/, "an unsafe id is refused before any read");

put("old", { schemaVersion: 1, id: "old", tasks: [], phases: [] });
assert.throws(() => loadRun("old", cwd), (e) => e.message === `Run old ${OLD_RUN_REFUSAL}` && !e.message.includes("\n"));

put("bad-json", "{");
assert.throws(() => loadRun("bad-json", cwd), /not valid JSON/);

put("other", { schemaVersion: RUN_STATE_SCHEMA_VERSION, id: "someone-else", tasks: [], phases: [] });
assert.throws(() => loadRun("other", cwd), /different or broken run/);

const id = newRunId("architecture-review", new Date("2026-01-02T03:04:05.678Z"));
assert.match(id, /^architecture-review-20260102T030405Z-[0-9a-f]{6}$/);
put(id, { schemaVersion: RUN_STATE_SCHEMA_VERSION, id, tasks: [], phases: [], paths: { state: "/elsewhere/state.json" } });
const run = loadRun(id, cwd);
assert.equal(run.paths.state, path.join(runsDir(cwd), id, "state.json"), "paths come from the folder");
assert.deepEqual(run.commits, []);
const later = new Date(Date.now() + 60_000);
fs.utimesSync(path.join(runsDir(cwd), id, "state.json"), later, later);
assert.equal(latestRunId(cwd), id, "the newest state.json wins");

console.log("run-store: ok");
