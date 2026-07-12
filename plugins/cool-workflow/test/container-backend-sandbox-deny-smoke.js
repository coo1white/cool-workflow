"use strict";
// container-backend-sandbox-deny-smoke -- env.deny must win for the
// container backend too, not just for local and agent.
//
// Found by security review (P2): runContainer (execution-backend/
// container.ts) built its `-e NAME=value` docker/podman args straight from
// policy.env.inherit / policy.env.expose and never looked at policy.env.deny
// at all. So a custom profile combining inherit:true with a deny list (a
// valid, normalized combination -- "everything EXCEPT these", see
// sandbox-profile.ts's normalizeEnv and local.ts's buildChildEnv, which
// already got this right) still forwarded a denied var like
// AWS_SECRET_ACCESS_KEY straight into the container.
//
// The fix pulls the `-e` arg loop out into a small pure function,
// buildContainerEnvArgs(policy, baseEnv), so this can be checked without a
// real docker/podman on the box (no daemon needed) -- same test-only split
// as buildChildEnv in local.ts.

const assert = require("node:assert/strict");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");
const { buildContainerEnvArgs } = require(path.join(pluginRoot, "dist/shell/execution-backend/container.js"));
const { showBundledSandboxProfile, sandboxContextForValidation } = require(path.join(pluginRoot, "dist/shell/sandbox-profile.js"));

const ctx = sandboxContextForValidation(pluginRoot);
const readonly = showBundledSandboxProfile("readonly", ctx);

function main() {
  const priorSecret = process.env.SOME_SECRET;
  const priorOther = process.env.SOME_OTHER_VAR;
  process.env.SOME_SECRET = "cw-smoke-secret-value";
  process.env.SOME_OTHER_VAR = "cw-smoke-other-value";
  try {
    // ---- 1. deny wins over inherit:true --------------------------------------
    {
      const policy = { ...readonly, env: { inherit: true, expose: [], deny: ["SOME_SECRET"] } };
      const args = buildContainerEnvArgs(policy);
      assert.ok(!args.includes("SOME_SECRET=cw-smoke-secret-value"), "denied var must not reach the container -e args, even under inherit:true");
      assert.ok(args.includes("SOME_OTHER_VAR=cw-smoke-other-value"), "an unrelated inherited var must still reach the container -e args");
    }

    // ---- 2. deny wins over expose ---------------------------------------------
    {
      const policy = { ...readonly, env: { inherit: false, expose: ["SOME_SECRET", "SOME_OTHER_VAR"], deny: ["SOME_SECRET"] } };
      const args = buildContainerEnvArgs(policy);
      assert.ok(!args.includes("SOME_SECRET=cw-smoke-secret-value"), "denied var must not reach the container -e args, even when also named in expose");
      assert.ok(args.includes("SOME_OTHER_VAR=cw-smoke-other-value"), "the exposed, non-denied var must still reach the container -e args");
    }

    // ---- 3. no inherit, no expose -> no -e args at all -------------------------
    {
      const policy = { ...readonly, env: { inherit: false, expose: [], deny: [] } };
      const args = buildContainerEnvArgs(policy);
      assert.deepEqual(args, [], "with neither inherit nor expose set, no -e args are built");
    }
  } finally {
    if (priorSecret === undefined) delete process.env.SOME_SECRET;
    else process.env.SOME_SECRET = priorSecret;
    if (priorOther === undefined) delete process.env.SOME_OTHER_VAR;
    else process.env.SOME_OTHER_VAR = priorOther;
  }

  process.stdout.write("container-backend-sandbox-deny-smoke: ok (env.deny wins over both inherit:true and expose for the container backend's -e args)\n");
}

main();
