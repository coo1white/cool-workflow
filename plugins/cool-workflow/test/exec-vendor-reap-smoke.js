#!/usr/bin/env node
"use strict";

// exec-vendor-reap-smoke — finding #9 follow-up (the exec-timeout orphan).
// Proves the two halves of the vendor-reap safety net, with NO real vendor CLI:
//   1. the shared wrapper helper `recordVendorPid` writes its vendor child's
//      PID to CW_AGENT_VENDOR_PIDFILE and removes it when the vendor exits;
//   2. execution-backend/agent.ts `reapRecordedVendor` SIGKILLs a still-live
//      recorded vendor and removes the sidecar — and is a safe no-op on a
//      missing file or a stale/dead PID (never throws).
// Fails against pre-fix code: neither helper exists, so the requires below
// return undefined and the first call throws.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const { recordVendorPid } = require(path.join(pluginRoot, "scripts/agents/agent-adapter-core.js"));
const { reapRecordedVendor } = require(path.join(pluginRoot, "dist/shell/execution-backend/agent.js"));

function tmpPidFile() {
  return path.join(os.tmpdir(), `cw-test-vendorpid-${process.pid}-${Math.random().toString(36).slice(2)}.pid`);
}
// A stand-in "vendor": a node process that stays alive until it is killed.
function sleeper() {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { stdio: "ignore" });
}
function waitExit(child) {
  return new Promise((res) => child.once("exit", (code, signal) => res({ code, signal })));
}
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // 1. recordVendorPid writes the PID, then clears the file when the vendor exits.
  {
    const pidfile = tmpPidFile();
    const child = sleeper();
    recordVendorPid(child, { CW_AGENT_VENDOR_PIDFILE: pidfile });
    assert.equal(fs.readFileSync(pidfile, "utf8"), String(child.pid), "pidfile holds the vendor pid");
    child.kill("SIGKILL");
    await waitExit(child);
    await tick(); // let the 'exit' cleanup handler flush
    assert.equal(fs.existsSync(pidfile), false, "pidfile is removed when the vendor exits");
  }

  // 2. reapRecordedVendor SIGKILLs a live recorded vendor and removes the sidecar.
  {
    const pidfile = tmpPidFile();
    const child = sleeper();
    fs.writeFileSync(pidfile, String(child.pid), "utf8");
    const signalled = reapRecordedVendor(pidfile);
    assert.equal(signalled, true, "reap reports it signalled the recorded vendor");
    const { signal } = await waitExit(child);
    assert.equal(signal, "SIGKILL", "the recorded vendor was SIGKILLed");
    assert.equal(fs.existsSync(pidfile), false, "sidecar removed after reap");
  }

  // 3. no-ops: a missing file and a stale/dead PID never throw, and still tidy up.
  {
    assert.equal(reapRecordedVendor(tmpPidFile()), false, "missing sidecar is a no-op");
    const stale = tmpPidFile();
    fs.writeFileSync(stale, "2147483646", "utf8"); // a PID that is not running
    assert.equal(reapRecordedVendor(stale), false, "stale/dead pid is a no-op");
    assert.equal(fs.existsSync(stale), false, "stale sidecar is still removed");
    const garbage = tmpPidFile();
    fs.writeFileSync(garbage, "not-a-number", "utf8");
    assert.equal(reapRecordedVendor(garbage), false, "unparseable sidecar is a no-op");
  }

  // 4. recordVendorPid is inert when cw did not ask for a pidfile (no env var).
  {
    const child = sleeper();
    assert.doesNotThrow(() => recordVendorPid(child, {}), "no CW_AGENT_VENDOR_PIDFILE => inert");
    child.kill("SIGKILL");
    await waitExit(child);
  }

  // 5. EVERY shipped vendor wrapper must wire the reaper — guards against a new
  //    vendor being added without it (the exact gap that leaked opencode once).
  //    The wrapper list is READ FROM builtin-templates.json, the same manifest
  //    the runtime resolves builtin:<name> from — a hand-kept list here went
  //    stale once (it missed gemini-opencode-agent.js) and cannot see a future
  //    vendor at all. A wrapper passes when it calls recordVendorPid(child)
  //    itself, or when it re-exports (requires) another manifest wrapper that
  //    does — one hop, the shape deepseek and the opencode-routed gemini use.
  {
    const agentsDir = path.join(pluginRoot, "scripts/agents");
    const manifest = JSON.parse(fs.readFileSync(path.join(agentsDir, "builtin-templates.json"), "utf8"));
    const wrappers = Array.from(new Set(Object.values(manifest.templates)));
    assert.ok(wrappers.length >= 5, `builtin-templates.json must list the shipped vendor wrappers (got ${wrappers.length})`);
    const callsReaper = (name) => /recordVendorPid\(child\)/.test(fs.readFileSync(path.join(agentsDir, name), "utf8"));
    for (const wrapper of wrappers) {
      if (callsReaper(wrapper)) continue;
      const src = fs.readFileSync(path.join(agentsDir, wrapper), "utf8");
      const hop = /require\(["']\.\/([\w-]+\.js)["']\)/.exec(src);
      assert.ok(
        hop && wrappers.includes(hop[1]) && callsReaper(hop[1]),
        `${wrapper} must call recordVendorPid(child) after spawning its vendor, or re-export a manifest wrapper that does`
      );
    }
  }

  console.log("exec-vendor-reap-smoke: ok");
})().catch((err) => { console.error(err); process.exit(1); });
