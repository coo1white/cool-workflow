# Smoke Tests

All tests are self-contained smoke files under `test/`. The runner
(`run-all.js`) auto-discovers every `*-smoke.js` file — add a new file and it's
picked up on the next run. No test framework, no new dependency.

## Writing a Smoke

Use the template below. Every smoke must be a standalone Node script that:

- Prints exactly one `ok` line to stdout on success (e.g. `your-name-smoke: ok`)
- Uses only `node:assert/strict` for assertions
- Runs in its own sandbox (the runner sets `CW_HOME`/`HOME`/`TMPDIR`)
- Is fully hermetic — no network, no live agent binary, no shared state

```javascript
#!/usr/bin/env node
"use strict";

// <name>-smoke — <one-line description>.
// Included in `npm test`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cw-<name>-"));

try {
  // Setup, execute, assert.
  assert.ok(true, "example assertion");

  process.stdout.write("<name>-smoke: ok\n");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
```

## Conventions

| Rule | Detail |
|------|--------|
| File naming | `*-smoke.js` — required for discovery |
| Imports | `require("../dist/<module>")` for in-process; `spawnSync` for CLI |
| Tmpdir pattern | `fs.mkdtempSync(path.join(os.tmpdir(), "cw-<unique>-"))` |
| Async pattern | `(async () => { ... })().catch(...)` at top level |
| Assertions | `node:assert/strict` only |
| Cleanup | `fs.rmSync(tmp, { recursive: true, force: true })` in `finally` |

## Skipping a Smoke

Add `// CW_SKIP: <reason>` in the first 10 lines. The runner skips it and prints
the reason. Use this to temporarily disable a known-broken smoke — never delete.

```javascript
// CW_SKIP: waiting on fix for #issue
```

## Running

```bash
npm test                    # sequential (release gate)
npm run test:fast            # parallel, cores-capped
node test/run-all.js --filter "export"     # only matching smokes
CW_TEST_Bail=1 npm test     # stop after first failure
CW_TEST_RETRY=2 npm test    # retry failures up to 2 times
CW_TEST_TIMEOUT_MS=30000 npm test  # custom per-test timeout
```

## Helpers

`test/assert-diff.js` — a tiny zero-dep deep-equality diff helper:

```javascript
const diff = require("./assert-diff");
const fail = diff(expected, actual, "my check");
if (fail) { process.stderr.write(fail + "\n"); process.exit(1); }
```
