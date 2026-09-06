"use strict";
const assert=require("node:assert/strict"),cp=require("node:child_process"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../../.."),runner=path.join(root,"scripts/bench/workbench-load.js"),k6=path.join(root,"scripts/bench/workbench-k6-deep.js");
// runner is a #!/usr/bin/env node script; run under bun test, this must still
// check it with node --check (process.execPath here is the bun binary, which
// has no --check flag).
assert.equal(cp.spawnSync("node",["--check",runner]).status,0,"runner parses");
const source=fs.readFileSync(k6,"utf8");for(const word of ["\"warmup\",25","\"sustained\",100","\"burst250\",250","p(95)<100","p(99)<250","count==0","cw_route_requests","/api/index","/api/serve"])assert.ok(source.includes(word),`deep proof has ${word}`);
assert.match(fs.readFileSync(runner,"utf8"),/before!==after/,"runner refuses a .cw write");
process.stdout.write("workbench-load-smoke: ok\n");
