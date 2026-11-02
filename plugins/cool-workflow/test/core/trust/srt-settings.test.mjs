#!/usr/bin/env node
// srt-settings — the pure half of CW_AGENT_SANDBOX=srt (0.3.3): the mode
// read from env, and a sandbox profile turned into srt settings.

import assert from "node:assert/strict";
import { agentSandboxMode, buildSrtSettings, SECRET_HOME_DIRS, SRT_VERSION } from "../../../dist/core/trust/srt-settings.js";

assert.equal(SRT_VERSION, "0.0.81");
assert.deepEqual(agentSandboxMode({}), { mode: "off" });
assert.deepEqual(agentSandboxMode({ CW_AGENT_SANDBOX: "" }), { mode: "off" });
assert.deepEqual(agentSandboxMode({ CW_AGENT_SANDBOX: "OFF" }), { mode: "off" });
assert.deepEqual(agentSandboxMode({ CW_AGENT_SANDBOX: " srt " }), { mode: "srt" });
assert.match(agentSandboxMode({ CW_AGENT_SANDBOX: "yes" }).error, /CW_AGENT_SANDBOX="yes" is not known; use "srt"/);

const s = buildSrtSettings({
  home: "/home/u",
  tmpDir: "/tmp",
  writePaths: ["/w/run/workers/a", "/w/run/workers/a"],
  readPaths: ["/w"],
  vendorWrite: ["~/.claude", "~/.claude.json"],
  hosts: ["api.anthropic.com", " *.anthropic.com ", "api.anthropic.com"],
});
assert.deepEqual(s.network, { allowedDomains: ["api.anthropic.com", "*.anthropic.com"], deniedDomains: [] });
assert.deepEqual(s.filesystem.allowWrite, ["/w/run/workers/a", "/tmp", "/home/u/.claude", "/home/u/.claude.json"]);
assert.deepEqual(s.filesystem.denyRead, SECRET_HOME_DIRS.map((d) => `/home/u/${d}`));
assert.ok(s.filesystem.denyRead.includes("/home/u/.cw-keys"), "CW's own signing key folder is never readable");
assert.ok(s.filesystem.denyRead.includes("/home/u/.ssh"));

// A profile that names a secret folder (or a path inside it) keeps it readable; a parent does not.
const named = buildSrtSettings({ home: "/home/u", tmpDir: "/tmp", writePaths: [], readPaths: ["~/.aws/config"], vendorWrite: [], hosts: [] });
assert.ok(!named.filesystem.denyRead.includes("/home/u/.aws"));
const parent = buildSrtSettings({ home: "/home/u", tmpDir: "/tmp", writePaths: [], readPaths: ["/home/u"], vendorWrite: [], hosts: [] });
assert.deepEqual(parent.filesystem.denyRead, SECRET_HOME_DIRS.map((d) => `/home/u/${d}`), "a broad readPath (cwd = $HOME) never opens the secret folders");
assert.deepEqual(named.network.allowedDomains, [], "no hosts means no network");

console.log("srt-settings: ok");
