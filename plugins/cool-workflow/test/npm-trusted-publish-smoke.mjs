#!/usr/bin/env node
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "npm-publish.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /id-token:\s*write/, "npm-publish must grant OIDC id-token write permission");
assert.match(workflow, /npm install -g npm@11\.5\.1\b/, "npm-publish must install npm with Trusted Publishing support, pinned to an EXACT version (no ^ range) since this job holds the OIDC token");
assert.match(workflow, /npm publish --access public/, "npm-publish must publish through npm Trusted Publishing");
assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/, "npm-publish must not rely on a long-lived npm token");
// Provenance names the commit that STARTED the run (GITHUB_SHA). A workflow_run
// run starts on main, so 0.3.3-0.4.2 named main's head, not the tag commit that
// was built (npmjs.com: "Unable to fetch the source commit"). The publish must
// start from the v* tag push itself, inside the protected `npm` environment
// that npm's Trusted Publisher setting requires.
assert.doesNotMatch(workflow, /^\s*workflow_run:/m, "npm-publish must not start by workflow_run (its provenance would name main's head)");
assert.match(workflow, /^on:\n  push:\n    tags:\n      - "v\*"\n/m, "npm-publish must start on a push of a v* tag");
assert.match(workflow, /^    if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m, "npm-publish must refuse any ref that is not a v* tag");
assert.match(workflow, /^    environment: npm$/m, "npm-publish must run in the protected `npm` environment");
assert.doesNotMatch(workflow, /^\s*ref: \$\{\{/m, "npm-publish must check out GITHUB_SHA (the tag commit), not another ref");
assert.match(workflow, /node plugins\/cool-workflow\/scripts\/release-gate\.mjs/, "npm-publish must run the deterministic release gate itself");
assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN/, "npm-publish must not read the NPM_TOKEN secret");

console.log("npm trusted publish smoke ok");
