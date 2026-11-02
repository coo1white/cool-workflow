#!/usr/bin/env node
// fetch-child-proxy-smoke — CW's own fetch children go through the proxy
// the user set (new in 0.3.3; docs/sandbox-profiles.7.md, "Proxy and CA").
//
// Node's built-in fetch does not read HTTP(S)_PROXY unless
// NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24.5+). So behind a proxy, the
// CW_AGENT_ENDPOINT agent (serial and batch), the remote/ci backends and an
// archive --repo URL tried to connect straight out, and failed on a machine
// where only the proxy can reach the network. Now CW turns that on for the
// children it starts to run fetch, when a proxy is set and the user has not
// set NODE_USE_ENV_PROXY themselves.
//
// A local stand-in proxy counts the requests it relays to a local stand-in
// endpoint; the test passes only when the agent's POST went through it.
//   1. Serial endpoint agent: through the proxy, result read.
//   2. Batch endpoint agent: through the proxy.
//   3. With NODE_USE_ENV_PROXY=0 set by the user: their choice is kept
//      (no proxy use).
//   4. The helpers: fetchChildEnv / addNetworkEnv rules.
//   5. Local backend: a profile with network on passes the proxy vars to the
//      task; network "none" does not.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { fetchChildEnv, addNetworkEnv } from "../dist/core/util/cli-args.js";
import { runEndpointBatchOutcomes } from "../dist/shell/execution-backend/agent.js";

const pluginRoot = path.resolve(import.meta.dirname, "..");
const [major, minor] = process.versions.node.split(".").map(Number);
const nodeReadsEnvProxy = major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21) || major === 23 && false;

// The stand-in endpoint and proxy run in their own process: CW's calls
// below are spawnSync, which would block servers living in this process.
const SERVERS = `
const http = require("node:http");
const net = require("node:net");
let relayed = 0;
const endpoint = http.createServer((req, res) => {
  if (req.url === "/count") { res.end(String(relayed)); return; }
  if (req.url === "/reset") { relayed = 0; res.end("0"); return; }
  let body = ""; req.on("data", (c) => { body += c; });
  req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ exitCode: 0, stdout: "got " + body.length + " bytes" })); });
});
const proxy = http.createServer((req, res) => {
  relayed += 1;
  const t = new URL(req.url);
  const up = http.request({ host: t.hostname, port: t.port, path: t.pathname + t.search, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(up);
});
// Node's proxy client tunnels with CONNECT, even to a plain-http target.
proxy.on("connect", (req, sock, head) => {
  relayed += 1;
  const [host, port] = req.url.split(":");
  const up = net.connect(Number(port), host, () => { sock.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n"); up.write(head); up.pipe(sock); sock.pipe(up); });
  up.on("error", () => sock.destroy());
});
endpoint.listen(0, "127.0.0.1", () => proxy.listen(0, "127.0.0.1", () => process.stdout.write(JSON.stringify({ e: endpoint.address().port, p: proxy.address().port }) + "\\n")));
`;
const servers = spawn(process.execPath, ["-e", SERVERS], { stdio: ["ignore", "pipe", "inherit"] });
const ports = await new Promise((resolve) => servers.stdout.once("data", (d) => resolve(JSON.parse(String(d)))));
const endpointUrl = `http://127.0.0.1:${ports.e}/run`;
const proxyUrl = `http://127.0.0.1:${ports.p}`;
// Read and reset the proxy's count straight from the endpoint (not via the proxy).
const control = (what) => Number(spawnSync(process.execPath, ["-e", `fetch("http://127.0.0.1:${ports.e}/${what}").then(r=>r.text()).then(t=>process.stdout.write(t))`], { encoding: "utf8", env: { PATH: process.env.PATH } }).stdout);

// Runs the serial endpoint path in a fresh process, so its env is exactly ours.
function serial(extraEnv) {
  const script = `
    import { runBackend } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/execution-backend/registry.js"))};
    import { showBundledSandboxProfile, sandboxContextForValidation } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/sandbox-profile.js"))};
    import os from "node:os"; import fs from "node:fs"; import path from "node:path";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-fetch-proxy-"));
    const env = runBackend({ schemaVersion: 1, backendId: "agent", cwd: dir, label: "p",
      sandboxPolicy: showBundledSandboxProfile("readonly", sandboxContextForValidation(dir)),
      timeoutMs: 20000, manifest: { resultPath: path.join(dir, "result.md"), prompt: "x" }, delegation: { endpoint: ${JSON.stringify(endpointUrl)} } });
    fs.rmSync(dir, { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ status: env.status, summary: env.result.summary }));`;
  const env = { ...process.env, ...extraEnv };
  for (const key of ["NO_PROXY", "no_proxy", "NODE_OPTIONS"]) delete env[key];
  for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key];
  return new Promise((resolve) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8", timeout: 60000 });
    resolve({ out: r.stdout, err: r.stderr });
  });
}

try {
  // ===== 4. helper rules (always) =====
  assert.deepEqual(fetchChildEnv({ PATH: "/bin" }), { PATH: "/bin" }, "no proxy: env unchanged");
  assert.equal(fetchChildEnv({ HTTPS_PROXY: "http://p:1" }).NODE_USE_ENV_PROXY, "1");
  assert.equal(fetchChildEnv({ http_proxy: "http://p:1" }).NODE_USE_ENV_PROXY, "1");
  assert.equal(fetchChildEnv({ HTTPS_PROXY: "http://p:1", NODE_USE_ENV_PROXY: "0" }).NODE_USE_ENV_PROXY, "0", "the user's own value wins");
  assert.deepEqual(addNetworkEnv({ PATH: "/bin" }, { PATH: "/x", HTTPS_PROXY: "h", NODE_EXTRA_CA_CERTS: "/ca.pem", SECRET: "s" }), { PATH: "/bin", HTTPS_PROXY: "h", NODE_EXTRA_CA_CERTS: "/ca.pem" });
  assert.deepEqual(addNetworkEnv({}, { HTTPS_PROXY: "h", SSL_CERT_FILE: "f" }, ["HTTPS_PROXY"]), { SSL_CERT_FILE: "f" }, "deny wins");

  if (!nodeReadsEnvProxy) {
    console.log(`fetch-child-proxy: Node ${process.versions.node} has no NODE_USE_ENV_PROXY; proxy cases skipped (docs say Node 22.21+ / 24.5+)`);
  } else {
    // ===== 1. serial endpoint agent =====
    {
      control("reset");
      const { out, err } = await serial({ HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NODE_USE_ENV_PROXY: undefined });
      assert.ok(control("count") > 0, `the endpoint agent's POST went through the proxy (stdout ${out}; stderr ${err})`);
      assert.doesNotMatch(err, /UNDICI-EHPA|experimental/, "Node's experimental note is kept out of stderr");
    }
    // ===== 3. the user's own NODE_USE_ENV_PROXY=0 is kept =====
    {
      control("reset");
      await serial({ HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NODE_USE_ENV_PROXY: "0" });
      assert.equal(control("count"), 0, "NODE_USE_ENV_PROXY=0 from the user: CW does not turn the proxy on");
    }
    // ===== 2. batch endpoint agent =====
    {
      control("reset");
      const saved = { ...process.env };
      process.env.HTTP_PROXY = proxyUrl;
      process.env.http_proxy = proxyUrl;
      for (const key of ["NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY", "NODE_OPTIONS"]) delete process.env[key];
      try {
        const [out] = runEndpointBatchOutcomes([{ endpoint: endpointUrl, job: JSON.stringify({ prompt: "x" }), timeoutMs: 20000 }]);
        assert.ok(control("count") > 0, `the batch endpoint POST went through the proxy: ${JSON.stringify(out)}`);
      } finally {
        for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
        Object.assign(process.env, saved);
      }
    }
    console.log("fetch-child-proxy: endpoint agent (serial, batch) goes through the proxy OK");
  }

  // ===== 5. local backend env =====
  {
    const script = `
      import { executeLocal } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/execution-backend/local.js"))};
      import { showBundledSandboxProfile, sandboxContextForValidation } from ${JSON.stringify(path.join(pluginRoot, "dist/shell/sandbox-profile.js"))};
      const ctx = sandboxContextForValidation(process.cwd());
      const out = {};
      for (const id of ["default", "readonly"]) {
        const env = executeLocal({ id: "local" }, { schemaVersion: 1, backendId: "local", cwd: process.cwd(), command: process.execPath,
          args: ["-e", "process.stdout.write(String(process.env.HTTPS_PROXY))"], sandboxPolicy: showBundledSandboxProfile(id, ctx) }, id, {}, "direct");
        out[id] = env.evidence.join("\\n") + " " + JSON.stringify(env.result);
      }
      process.stdout.write(JSON.stringify(out));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, HTTPS_PROXY: "http://proxy.example:3128" }, encoding: "utf8", timeout: 60000 });
    const out = JSON.parse(r.stdout || "{}");
    // The evidence keeps a digest of the task's stdout, not the text.
    const sha = (text) => `stdoutSha256:sha256:${createHash("sha256").update(text).digest("hex")}`;
    assert.ok((out.default || "").includes(sha("http://proxy.example:3128")), `network "any" (default): the task sees HTTPS_PROXY (${r.stdout} ${r.stderr})`);
    assert.ok((out.readonly || "").includes(sha("undefined")), `network "none" (readonly): it does not (${r.stdout})`);
    console.log("fetch-child-proxy: local backend passes proxy vars only when the profile allows the network OK");
  }
} finally {
  servers.kill();
}

console.log("fetch-child-proxy-smoke: ok");
