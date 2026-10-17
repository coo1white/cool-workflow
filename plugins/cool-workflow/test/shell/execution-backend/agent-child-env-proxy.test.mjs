#!/usr/bin/env node
// agent-child-env-proxy — the agent child env (buildAgentChildEnv) keeps the
// proxy, TLS trust, and CLAUDE_* vars, so a vendor CLI behind a proxy can
// reach its API. Found live (0.3.3): `claude -p` worked in the shell, but
// every `cw -q ... -claude` worker got "403 Request not allowed", because the
// proxy vars were dropped. Names only go into `forwarded`; deny still wins.

import assert from "node:assert/strict";
import { buildAgentChildEnv } from "../../../dist/shell/execution-backend/agent.js";

const policy = (deny = []) => ({ env: { inherit: false, expose: [], deny } });

const base = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  HTTPS_PROXY: "http://proxy.invalid:3128",
  https_proxy: "http://proxy.invalid:3128",
  HTTP_PROXY: "http://proxy.invalid:3128",
  http_proxy: "http://proxy.invalid:3128",
  ALL_PROXY: "socks5://proxy.invalid:1080",
  all_proxy: "socks5://proxy.invalid:1080",
  NO_PROXY: "localhost,127.0.0.1",
  no_proxy: "localhost,127.0.0.1",
  NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
  SSL_CERT_FILE: "/etc/ca.pem",
  SSL_CERT_DIR: "/etc/certs",
  CLAUDE_CONFIG_DIR: "/home/u/.claude-alt",
  CW_RELEASE_VERDICT_PRIVKEY: "/keys/verdict.key",
  CW_WORKBENCH_TOKEN: "tok",
  SECRET_THING: "nope",
};

const passed = [
  "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy",
  "NO_PROXY", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "CLAUDE_CONFIG_DIR",
];

{
  const { env, forwarded } = buildAgentChildEnv(policy(), base);
  for (const name of passed) {
    assert.equal(env[name], base[name], `${name} forwarded with its value`);
    assert.ok(forwarded.includes(name), `${name} named in forwarded`);
  }
  // forwarded holds names only, never values.
  for (const entry of forwarded) assert.ok(!entry.includes("proxy.invalid"), "no value in forwarded");
  assert.equal(env.SECRET_THING, undefined, "unrelated var not forwarded");
  assert.ok(!forwarded.includes("SECRET_THING"));
  for (const name of ["CW_RELEASE_VERDICT_PRIVKEY", "CW_WORKBENCH_TOKEN"]) {
    assert.equal(env[name], undefined, `${name} never forwarded`);
    assert.ok(!forwarded.includes(name));
  }
}

{
  // An explicit deny still wins over the new names.
  const { env, forwarded } = buildAgentChildEnv(policy(["HTTPS_PROXY", "CLAUDE_CONFIG_DIR"]), base);
  assert.equal(env.HTTPS_PROXY, undefined, "denied HTTPS_PROXY stripped");
  assert.ok(!forwarded.includes("HTTPS_PROXY"));
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined, "denied CLAUDE_CONFIG_DIR stripped");
  assert.equal(env.https_proxy, base.https_proxy, "deny is by exact name");
}

console.log("agent-child-env-proxy: ok");
