#!/usr/bin/env node
"use strict";

// HTTP delegate child (extracted from execution-backend.ts so it is a real,
// greppable, lint-able file instead of an embedded `node -e` template string —
// F11). Spawned via `node <this-path>` (shell:false) by runHttpDelegation.
//
// A self-contained Node child that performs the remote/CI delegation: it reads a
// JSON job on stdin, POSTs it to the endpoint, optionally polls a returned jobId,
// and prints `{ exitCode, stdout }` (or `{ error }`) on stdout. Node-only (global
// fetch, node >=18), so the driver stays portable and synchronous from CW's view.
//
// THE RED LINE: this child speaks ONLY plain HTTP to an operator-configured
// endpoint. It imports NO model SDK, holds NO API key, and constructs NO model
// API request. Behavior MUST stay byte-identical to the previous embedded string.

(async () => {
  const MAX_STDIN_BYTES = 32 * 1024 * 1024;
  const read = () => new Promise((res) => { let b = ""; process.stdin.on("data", (c) => { if (b.length < MAX_STDIN_BYTES) b += c; }); process.stdin.on("end", () => res(b)); });
  try {
    const job = JSON.parse((await read()) || "{}");
    const endpoint = process.env.CW_DELEGATE_ENDPOINT;
    if (!endpoint) throw new Error("no endpoint");
    const post = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job) });
    if (!post.ok) throw new Error("runner responded " + post.status);
    let data = await post.json();
    // Poll a returned jobId until the runner reports done.
    let guard = 0;
    while (data && data.jobId && data.done !== true && guard++ < 600) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await fetch(endpoint + (endpoint.includes("?") ? "&" : "?") + "jobId=" + encodeURIComponent(data.jobId));
      if (!poll.ok) throw new Error("poll responded " + poll.status);
      data = await poll.json();
    }
    if (typeof data.exitCode !== "number") throw new Error("runner did not report an exitCode");
    process.stdout.write(JSON.stringify({ exitCode: data.exitCode, stdout: String(data.stdout || "") }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e && e.message ? e.message : String(e) }));
  }
})();
