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
assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN/, "npm-publish must not read the NPM_TOKEN secret");

console.log("npm trusted publish smoke ok");
