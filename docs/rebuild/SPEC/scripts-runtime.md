# scripts-runtime

## Scope

One line: the zero-dependency runtime JS that ships in the npm package — the bin bootstrap (`scripts/cw.js`), the vendor agent wrappers and their shared core (`scripts/agents/*`), the delegate children (`scripts/children/*`), the source-context exporter (`scripts/source-context.js`), the onramp library (`src/onramp.ts`), plus a short list of the release/gate scripts a rebuild must keep working.

## Public surface

### 1. Bin bootstrap — `scripts/cw.js`

- `package.json` maps two bin names to this file: `"cool-workflow": "scripts/cw.js"` and `"cw": "scripts/cw.js"` (package.json:4-7).
- The file is 4 lines: shebang `#!/usr/bin/env node`, `"use strict";`, then `require("../dist/cli.js");` (scripts/cw.js:1-4). It takes no args of its own; all CLI behavior lives in `dist/cli.js`. A rebuild must keep this exact indirection: the bin points at `scripts/cw.js`, which loads the built dist.

### 2. Source context exporter — `scripts/source-context.js`

An opt-in JSONL exporter. Policy is data in `manifest/source-context-profiles.json`; the script is only mechanism (scripts/source-context.js:4-8).

Commands (argv[2]):

- `profiles` — print one JSONL line per profile: `{schemaVersion,id,description,maxLines,include,exclude}` (scripts/source-context.js:33-45).
- `manifest` — for every tracked file at the ref, print one JSONL record (no `content`) (scripts/source-context.js:88-91).
- `export` — print records only for included files, each with `content` added (scripts/source-context.js:93-97).
- Any other command → usage on stderr with `process.exitCode = 1` (scripts/source-context.js:24-27,110-121).

Flags (all take a value, `--name value` or `--name=value`, scripts/source-context.js:123-128):

- `--profile <id>` — default `core`; unknown id → `die` (scripts/source-context.js:47-49).
- `--profile-file <path>` — default `manifest/source-context-profiles.json` under the plugin root (scripts/source-context.js:18,29).
- `--ref <ref>` — default `HEAD`; resolved with `git rev-parse --verify <ref>^{commit}` (scripts/source-context.js:51,148-150).
- `--changed-from <REF>` — diff-aware mode: only paths in `git diff --name-only --diff-filter=ACMRT <base>..<ref>` are seen (scripts/source-context.js:52-53,156-158).
- `--repo-root <DIR>` — default is the CW repo root (two dirs up from the plugin) (scripts/source-context.js:16-17,30).
- `--cache-dir <DIR>` — `export` only; read/write a JSONL cache file (scripts/source-context.js:54-59,103-107).

What comes back: JSONL on stdout only. Diagnostics go to stderr with the `source-context: ` prefix, and any hard stop is exit code 1 (scripts/source-context.js:312-315).

### 3. Shared wrapper core — `scripts/agents/agent-adapter-core.js`

Not a CLI; a `require`d module every wrapper shares. Exports (scripts/agents/agent-adapter-core.js:474-489):

- `RESULT_CONTRACT` — the exact text sent after every worker input (see Exact outputs).
- `buildPrompt(inputPath)` — file text + `"\n"` + `RESULT_CONTRACT` (scripts/agents/agent-adapter-core.js:38-40).
- `streamEnabled(env)` — true unless `CW_AGENT_STREAM === "0"` or `CW_NO_STREAM === "1"` (scripts/agents/agent-adapter-core.js:42-44).
- `traceEnabled(env, stderr)` / `trace(line, ...)` — stream on AND stderr is a TTY (scripts/agents/agent-adapter-core.js:46-53).
- `createRenderer({env, stderr, label})` — the live stderr view. Modes: interactive (stream on + TTY), plain (stream on + not a TTY + `CW_AGENT_STREAM === "1"`), else silent (scripts/agents/agent-adapter-core.js:89-97). Methods: `action(label, id)`, `fail()`, `result(summary, failed, id)`, `text(chunk)`, `note(text)`, `finishLive()`, `writeTranscript(filePath)`, `isVerbose()` (scripts/agents/agent-adapter-core.js:212-264).
- `truncate(text, max)` — must stay behavior-identical to `src/term.ts` `truncate()`: `max<=0` → `""`; text that fits comes back as the ORIGINAL string (ANSI kept); else ANSI-stripped, sliced, `…` added (scripts/agents/agent-adapter-core.js:68-77).
- `toolLabel(name, rawArg)` — `ToolName(compactArg)`; file tools (`Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead`) show the basename; other args collapse whitespace and cut at 40 chars with `…` (scripts/agents/agent-adapter-core.js:331-342).
- `summarizeToolResult(name, text, isError)` — the `⎿` line: `error` on error; `N lines` / `N files` / `N matches` by tool kind; Bash with one line shows that line; cut at 40 chars (scripts/agents/agent-adapter-core.js:357-371).
- `parseJsonLines(provider, chunk, state, onLine)` / `flushJsonLines(provider, state, onLine)` — buffer NDJSON, call `onLine` per line, render known event shapes; non-JSON lines are skipped by the renderer (the caller decides if that is fatal) (scripts/agents/agent-adapter-core.js:411-439).
- `writeResult(resultPath, resultText)` — refuses an empty/non-string result with `Error("agent produced no final result")`, else writes the file (scripts/agents/agent-adapter-core.js:441-446).
- `emitReport(model, usage, resultText)` — writes ONE JSON object to stdout: `JSON.stringify({ model, usage, result: resultText })`, no trailing newline (scripts/agents/agent-adapter-core.js:448-450).
- `persistStderr(resultPath, text)` — advisory: redacts secrets, caps at 4096 chars, writes `<dir-of-result>/logs/agent-stderr.log`; never throws (scripts/agents/agent-adapter-core.js:459-472).

Renderer env vars (scripts/agents/agent-adapter-core.js:63-67,96-102):

- `CW_AGENT_STREAM` — `0` = off; `1` = also turn on plain append-only lines when stderr is not a TTY (non-TTY default is silent).
- `CW_NO_STREAM=1` — off.
- `CW_VERBOSE=1|true` or `CW_OUTPUT=full` — model narration text shown inline.
- `NO_COLOR` / `CW_NO_COLOR` (non-empty = no color), `FORCE_COLOR` (set, not `""`/`"0"` = force color), else color iff TTY.
- `CW_LIVE_ROWS` — rolling window size, clamped 0..20, default 4.

### 4. Vendor wrapper: `scripts/agents/claude-p-agent.js`

Contract for every wrapper: `argv[2]` = worker `input.md` path (`{{input}}`), `argv[3]` = worker `result.md` path (`{{result}}`); missing either → usage on stderr + exit 2. stdout carries ONE JSON object `{model, usage, result}`; the wrapper writes `result.md` itself.

- Default (stream) mode: spawns `claude -p <prompt> --output-format stream-json --verbose --allowedTools Read,Grep,Glob,Bash` with stdio `["ignore","pipe","pipe"]` (scripts/agents/claude-p-agent.js:101-105). It parses claude NDJSON events: `assistant` message parts (`text` → narration, `tool_use` → action with `toolLabel`), `user` message `tool_result` parts (→ `⎿` summary keyed by `tool_use_id`), `system`/`post_turn_summary` (→ note), `result` (→ final text, usage, `is_error` → fail) (scripts/agents/claude-p-agent.js:142-169).
- Legacy mode (`CW_AGENT_STREAM=0` or `CW_NO_STREAM=1`): `spawnSync("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", "Read,Grep,Glob,Bash"])`, parse the whole stdout as JSON, write `parsed.result` to `result.md`, then forward claude's stdout VERBATIM (scripts/agents/claude-p-agent.js:50-83).
- On close: write `transcript.md`; non-zero exit → persist stderr + exit with the child code (null → 1); no `result` event → refuse with exit 1; else write `result.md` and emit `{model,usage,result}` (scripts/agents/claude-p-agent.js:178-198).

### 5. Vendor wrapper: `scripts/agents/codex-agent.js`

- Spawns `codex exec --json -c model_reasoning_effort=<effort> --output-last-message <finalPath> --sandbox <sandbox> --color never -` with the prompt on stdin (scripts/agents/codex-agent.js:118-138).
- `finalPath` = `<dir-of-result>/.codex-last-message-<pid>.md`, removed before and after use (scripts/agents/codex-agent.js:71-76,184-190).
- Env:
  - `CW_RELEASE_REVIEW=1` — review mode: effort default becomes `high`, sandbox default becomes `workspace-write` (scripts/agents/codex-agent.js:96-108).
  - `CW_CODEX_REASONING_EFFORT` — effort override; plain default `low` (scripts/agents/codex-agent.js:101).
  - `CW_CODEX_SANDBOX` — must be one of `read-only`, `workspace-write`, `danger-full-access`; anything else → error + exit 2 (fail closed, never silently downgraded) (scripts/agents/codex-agent.js:107-114). Plain default `read-only`.
  - `CODEX_HOME` — model fallback: read `<CODEX_HOME or ~/.codex>/config.toml` key `model` when the stream carried no model field (scripts/agents/codex-agent.js:53-62,200).
- Every stdout line is recorded; ANY non-JSON stdout line sets `state.invalidJson` and, on an otherwise clean exit, the wrapper refuses with exit 1 (scripts/agents/codex-agent.js:84-91,169-174).
- Missing final output file → refuse with exit 1 (scripts/agents/codex-agent.js:176-190).

### 6. Vendor wrapper: `scripts/agents/gemini-agent.js` (native CLI path, alias `builtin:gemini-cli`)

- Spawns `gemini -p <prompt> --output-format stream-json --approval-mode plan` (scripts/agents/gemini-agent.js:60-72).
- Result build: the last `ev.result` string wins; else all `ev.text` / `ev.delta` fragments joined with `"\n\n"` (scripts/agents/gemini-agent.js:41-56,109).
- Non-JSON stdout line → refuse; empty result text → refuse; both exit 1 (scripts/agents/gemini-agent.js:102-115).

### 7. Vendor wrapper: `scripts/agents/opencode-agent.js`

- Spawns `opencode run --format json --dangerously-skip-permissions [--model <m>] <prompt>` — the prompt is the POSITIONAL last arg (scripts/agents/opencode-agent.js:109-125).
- Variant env: `CW_OPENCODE_LABEL` (display label, default `opencode`) and `CW_OPENCODE_MODEL` (adds `--model`; also recorded as the provenance model since opencode JSON has no model field) (scripts/agents/opencode-agent.js:44-45,53-54).
- JSONL shapes (>=1.x): `{type:"text", part:{text, messageID}}` — text grouped by `messageID`; the LAST message's text is the answer. `{type:"step_finish", part:{tokens:{input,output}}}` — summed into `usage.input_tokens`/`usage.output_tokens`. Older shapes (`ev.result`, `ev.text`, `ev.delta`) still accepted (scripts/agents/opencode-agent.js:63-105).
- Result pick order: `state.finalResult || state.lastMessageText || state.textFragments.join("\n\n")` (scripts/agents/opencode-agent.js:162). Non-JSON line or empty result → refuse, exit 1.

### 8. Variant shims: `deepseek-agent.js` and `gemini-opencode-agent.js`

- `deepseek-agent.js` sets `CW_OPENCODE_LABEL="deepseek"`, `CW_OPENCODE_MODEL = CW_DEEPSEEK_MODEL || "deepseek/deepseek-chat"`, then `require("./opencode-agent.js")` (scripts/agents/deepseek-agent.js:20-23).
- `gemini-opencode-agent.js` sets `CW_OPENCODE_LABEL="gemini"`, `CW_OPENCODE_MODEL = CW_GEMINI_MODEL || "google/gemini-3.5-flash"`, same delegation (scripts/agents/gemini-opencode-agent.js:22-25).

### 9. Builtin template registry — `scripts/agents/builtin-templates.json`

Data, not code. `templates` maps vendor name → wrapper file in the same dir: `claude`→`claude-p-agent.js`, `codex`→`codex-agent.js`, `gemini`→`gemini-opencode-agent.js`, `gemini-cli`→`gemini-agent.js`, `opencode`→`opencode-agent.js`, `deepseek`→`deepseek-agent.js` (scripts/agents/builtin-templates.json:4-11). CW core expands `builtin:<name>` to `node <agentsDir>/<script> {{input}} {{result}}`; unknown name → `Error("Unknown builtin agent template \"<name>\" — available: ...")` (src/agent-config.ts:161-182). PATH auto-detect tries `claude`, `codex`, `gemini`, `opencode` in that order, skipped when `CW_NO_AUTO_AGENT=1` (src/agent-config.ts:141-158).

### 10. Attestation tools — `cw-attest-keygen.js`, `cw-attest-wrap.js`

- `cw-attest-keygen.js [--out-dir DIR] | --print` — makes an ed25519 pair. `--print` writes both PEMs to stdout and exits 0. Else writes `cw-attest.key` (mode 0600) and `cw-attest.pub` in the out dir (default cwd) and prints a next-steps block (scripts/agents/cw-attest-keygen.js:27-55).
- `cw-attest-wrap.js --manifest {{manifest}} -- <agent-cmd> [args...]` — executor-side signer. Runs the inner agent (`stdio: ["inherit","pipe","inherit"]`), parses its stdout report (whole text as JSON, else the last `{...}` line), and — when a report with `usage`, a private key (`CW_AGENT_ATTEST_PRIVKEY`, PEM text or file path) and the manifest all exist — signs `{usage, runId, taskId, promptDigest[, resultDigest]}` via `dist/telemetry-attestation.js` `signTelemetry` and re-emits the report with `usageSignature` added. Digest form is `sha256:<hex>`. Any missing piece → pass the report through UNSIGNED (never block, never forge). Exit code = the inner agent's exit code. Arg errors before the run → `cw-attest-wrap: <msg>` + exit 2 (scripts/agents/cw-attest-wrap.js:37-58,101-149).

### 11. Delegate children — `scripts/children/`

- `batch-delegate-child.js` — reads a JSON job array on stdin (cap 32MB). Spawns ALL jobs at once (`spawn(job.binary, job.args, {cwd, env, shell:false})`). Per job: SIGTERM at `timeoutMs`, SIGKILL at `timeoutMs+5000`; stdout captured with a 32MB cap; stderr drained. The INSTANT a job settles it writes ONE NDJSON line `{i, spawnError?, exitCode, stdout}\n` (`i` = the job's submit index; settle order is concurrent). A killed job → `exitCode: null`. Over-cap stdout → `spawnError: "stdout exceeded <CAP> byte cap (<N> bytes)"`, `exitCode: null`, `stdout: ""`. Empty job list → `[]`. Bad stdin JSON → a one-element JSON array `[{"spawnError":"invalid stdin JSON: ...","exitCode":null,"stdout":""}]` (scripts/children/batch-delegate-child.js:26-85).
- `http-delegate-child.js` — reads one JSON job on stdin (cap 32MB), POSTs it to `CW_DELEGATE_ENDPOINT` (JSON body), and if the response has a `jobId` with `done !== true`, polls `<endpoint>?jobId=<id>` (or `&jobId=` when the endpoint already has `?`) every 1000ms up to 600 times. Success needs a numeric `exitCode`; prints `{"exitCode":N,"stdout":"..."}`. Any error prints `{"error":"<message>"}` instead — messages: `no endpoint`, `runner responded <status>`, `poll responded <status>`, `runner did not report an exitCode`. The process itself exits 0 either way; the parent reads the JSON (scripts/children/http-delegate-child.js:17-40).
- Red line (both): no model SDK, no credential read; they only spawn/POST what the operator configured (scripts/children/batch-delegate-child.js:22-23; scripts/children/http-delegate-child.js:13-15).

### 12. Onramp library — `src/onramp.ts`

Exported functions (consumed by `cw doctor --onramp` and `scripts/onramp-check.js`):

- `optionEnabled(value)` — false for `undefined`, `false`, and the strings `""`, `"0"`, `"false"`, `"no"` (case-folded); else true (src/onramp.ts:129-133).
- `npmCommand(cwd, script)` / `nodeSmokeCommand(cwd, smoke)` — `npm run <script>` / `node test/<smoke>`, with a `cd <plugin-rel-dir> && ` front part when run from a source checkout root (src/onramp.ts:135-145).
- `detectSourceCheckout(cwd)` — looks for a `package.json` with `"name": "cool-workflow"` at `cwd` or `cwd/plugins/cool-workflow` (src/onramp.ts:147-164).
- `shellQuote(value)` — plain `[A-Za-z0-9_./:-]+` stays as is; else single-quoted with `'\\''` escapes (src/onramp.ts:166-169).
- `buildDoctorOnramp({cwd, changedFrom, env})` — returns the `DoctorOnramp` object: `schemaVersion: 1`, a fixed `summary`, 5 fixed sections (`first-run`, `no-agent`, `change-loop`, `surface-guard`, `release-gate`) with fixed action ids/commands; with `changedFrom` set it also adds `changedFiles`, `contract`, `recommendedChecks` (src/onramp.ts:171-320).
- `resolveChangedFiles({cwd, changedFrom, env})` — `{baseRef, files}`: union of `git diff --name-only <base> --` and `git ls-files --others --exclude-standard`, each path normalized, sorted (src/onramp.ts:322-330). Base ref order: `changedFrom` arg, else `CW_ONRAMP_BASE`, else merge-base of HEAD with `origin/<GITHUB_BASE_REF>` (or `origin/main`), else `HEAD` (src/onramp.ts:430-437). A ref starting with `-` → `Error("Invalid onramp base ref (must not start with '-'): <ref>")`; an unknown ref → `Error("Unknown onramp base ref: <ref>")` (src/onramp.ts:439-444).
- `evaluateOnrampContract(files, {cwd})` — the fail-closed change contract, 4 issue codes (see Invariants) (src/onramp.ts:332-387).
- `recommendSmokeTests(files, cwd)` — curated map first (src/onramp.ts:71-127), then for uncovered `src/` files: `<basename>-smoke.js` if it exists, plus every available smoke whose name contains a >=3-char token of the basename; sorted (src/onramp.ts:389-417).

### 13. Release/gate script inventory (one line each — a rebuild keeps these working against the new dist)

- `scripts/release-flow.js` — vendor-neutral release orchestrator; modes `--check` (gate + delegated review, no mutation), `--cut --version x.y.z [--push] [--no-release]`, `--release --version x.y.z [--soft]`; verdict file `.cw-release/review-<FULLSHA>.verdict` first line `APPROVED <FULLSHA>`; test seams `CW_RELEASE_FLOW_GATE_CMD`, `CW_RELEASE_FLOW_GH_CMD` (scripts/release-flow.js:1-45).
- `scripts/release-gate.js` — deterministic gate: build, `test:gate`, substance/test-evidence/cadence checks over `<prev-tag>..HEAD` (cadence bypass only via a recorded `HOTFIX:` line in `ITERATION_LOG.md`), branch-name check; pass writes UTC time to `.cw-release/gate-<HEAD-sha>.ok`; prints `RELEASE GATE: PASSED (<sha>) — next step: release-reviewer agent must record APPROVED` or `RELEASE GATE: REJECTED (<sha>)` + exit 1 (scripts/release-gate.js:1-184).
- `scripts/release-check.js` — pre-release dry run: docs presence + build + suite; `--skip-tests` or `CW_RELEASE_CHECK_SKIP_TESTS=1` skips the suite (scripts/release-check.js:10-11).
- `scripts/onramp-check.js` — CLI over `dist/onramp.js`: prints the contract report JSON (`{schemaVersion:1, baseRef, ok, changedFiles, recommendedSmokeTests, recommendedCommands, issues}`, 2-space indent + newline) to stdout; with `--check` and `ok:false` prints `onramp contract failed:` + per-issue lines to stderr and exits 1; `--changed-from` picks the base (scripts/onramp-check.js:20-41).
- `scripts/parity-check.js` — CLI↔MCP parity gate against the live capability table, dispatcher, `cw help`, and MCP server; plain run prints the JSON report, `--check` exits 1 on any drift (dispatcher/help/tool reachability + `payloadIdentical` payload parity) (scripts/parity-check.js:4-19,58-118).
- `scripts/gen-manifests.js` — generates every vendor plugin manifest from `manifest/plugin.manifest.json` (template markers `{{path}}`, `{{path|lowercase}}`, `{{pluginRootVar}}`); `--check` fails (exit 1) on drift, and a missing or bad `vendors` registry fails before any write (scripts/gen-manifests.js:4-21,111-154).
- `scripts/dist-drift-check.js` — snapshot `dist/`, rebuild, diff; fails closed when `dist/` is not the exact build of `src/` (scripts/dist-drift-check.js:4-21).
- `scripts/lang-policy-check.js` — enforces the JS/TS-only project rule (AGENTS.md, 2026-07-13): every `git ls-files` entry must be JS/TS, a recognized non-code file (docs/data/config/binary asset), or an exact-path `EXCEPT_PATHS` entry (`Formula/cool-workflow.rb`, the workbench `index.html`/`app.css`); any other extension/basename fails closed, exit 1, naming the file (scripts/lang-policy-check.js:11-70).
- `scripts/bump-version.js <x.y.z> [--content]` — bumps every structured surface; default gates (fails with a file list) when content surfaces miss the new version; `--content` auto-appends placeholders (scripts/bump-version.js:4-21).
- `scripts/version-sync-check.js` — checks version agreement across surfaces reading the blobs at `git show HEAD:<path>` (working tree only as fallback, e.g. the gitignored package-lock) (scripts/version-sync-check.js:12-41).
- `scripts/vendor-preflight.js [--vendors a,b] [--question "..."] [--timeout-ms N] [--json] [--keep]` — LIVE pre-release liveness gate: runs EACH builtin wrapper against a throwaway git repo; any vendor without a valid non-empty result FAILS the gate (hard block, no skip); seam `CW_PREFLIGHT_AGENTS_DIR` (scripts/vendor-preflight.js:4-31).
- `scripts/coverage-gate.js [--min N] [--concurrency n|auto]` — runs the smoke suite under `NODE_V8_COVERAGE`, merges per-process reports, projects onto `dist/**/*.js` lines; floor default 80, override `--min` / `CW_COVERAGE_MIN`; zero reports found fails (scripts/coverage-gate.js:4-27).
- `scripts/golden-path.js [--json] [--quiet] [--cleanup]` — end-to-end assert of the golden path (`app validate end-to-end-golden-path`, plan, run, verify) through `scripts/cw.js` (scripts/golden-path.js:10-36).

## Exact outputs

### Result contract appended to every wrapper prompt

`buildPrompt` sends the worker `input.md` text, one `\n`, then this exact block (scripts/agents/agent-adapter-core.js:7-36 — note the leading newline from the template literal):

```
=== HOW TO RETURN YOUR ANSWER (overrides any 'write to result.md' instruction above) ===
You have NO file-write access. Do NOT attempt to write, create, or edit any file -
result.md is persisted FOR YOU from your final message, so writing it yourself is
neither needed nor possible. Use ONLY read-only tools (read files, grep, list).
Respond with ONLY your FINAL answer as Markdown, and it MUST END WITH a fenced
cw:result block that EXACTLY follows this schema:

```cw:result
{
  "summary": "one-paragraph direct answer",
  "findings": [
    {
      "id": "unique-kebab-id",
      "title": "short risk title",
      "severity": "P0",
      "classification": "real",
      "evidence": ["path/to/file.ts:42"]
    }
  ],
  "evidence": ["path/to/file.ts:42", "path/to/other.ts:10"]
}
```

HARD RULES (the result is REJECTED otherwise):
- Every object in "findings" MUST have a unique "id" (non-empty string).
- "classification", if present, MUST be one of: real, conditional, non-issue, unknown.
- Any finding with "severity" P0, P1, or P2 MUST include a NON-EMPTY "evidence" array.
- The top-level "evidence" array MUST be NON-EMPTY with REAL file:line locators from this repo.
- If you have no structured findings, use "findings": [] (empty) - never omit a finding's id.
```

### Wrapper stdout (the data channel)

One JSON object, no trailing newline:

```
{"model":<string|undefined>,"usage":<object|undefined>,"result":"<final markdown>"}
```

(`JSON.stringify({ model, usage, result })` — an `undefined` model/usage key is simply absent.) Evidence: scripts/agents/agent-adapter-core.js:448-450; scripts/agents/claude-p-agent.js:197. Legacy claude mode instead forwards claude's own `--output-format json` stdout verbatim (scripts/agents/claude-p-agent.js:81).

With `cw-attest-wrap.js` signing, the same object gains one key:

```
{"model":"...","usage":{...},"result":"...","usageSignature":{...}}
```

(scripts/agents/cw-attest-wrap.js:136)

### Wrapper usage errors (stderr, exit 2)

```
usage: claude-p-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})
usage: codex-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})
usage: gemini-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})
usage: opencode-agent.js <inputPath> <resultPath>  (CW substitutes {{input}} {{result}})
```

(scripts/agents/claude-p-agent.js:42; codex-agent.js:67; gemini-agent.js:32; opencode-agent.js:37)

### Wrapper refusal / failure lines (stderr, exit 1 unless said)

```
claude spawn failed: <msg>
claude output was not JSON: <msg>
claude exited <code>
claude exited (timeout/killed)
claude produced no result event — refusing to fabricate a result
codex spawn failed: <msg>
codex exited <code>
codex --json produced a non-JSONL stdout line - refusing to trust the result
codex produced no final output file - refusing to fabricate a result
codex produced no final result: <msg>
codex-agent: invalid CW_CODEX_SANDBOX="<v>" — expected one of read-only, workspace-write, danger-full-access
gemini spawn failed: <msg>
gemini --output-format stream-json produced a non-JSONL stdout line - refusing to trust the result
gemini produced no result text - refusing to fabricate a result
gemini produced no final result: <msg>
opencode spawn failed: <msg>
opencode --format json produced a non-JSONL stdout line - refusing to trust the result
opencode produced no result text - refusing to fabricate a result
opencode produced no final result: <msg>
```

The `invalid CW_CODEX_SANDBOX` line exits 2 (scripts/agents/codex-agent.js:109-114). Non-zero child exits are passed through as the wrapper's exit code; a `null` code (kill) becomes exit 1 (e.g. scripts/agents/claude-p-agent.js:186; codex-agent.js:166; gemini-agent.js:100; opencode-agent.js:153). NOTE the byte-level mix: claude lines use the em-dash `—`; codex/gemini/opencode refusal lines use the ASCII hyphen `-`.

### Renderer stderr (plain / CI mode, `CW_AGENT_STREAM=1` + not a TTY)

```
→ <label>
✓ <label> (<elapsed>)
✗ <label> (<elapsed>)
  ⎿ <summary>
```

Elapsed format: under 60s → `4.0s` (one decimal); else `2m41s` (minutes + zero-padded seconds) (scripts/agents/agent-adapter-core.js:78-81,207,221,241). Interactive mode ends with ONE summary line:

```
  ● <label> · <N> step(s) · <elapsed>
```

— a green `●`, dim text, only when `steps > 0` (scripts/agents/agent-adapter-core.js:271-277).

### Transcript file (`transcript.md`)

```
# Agent transcript

- ✓ Read(foo.ts) (1.2s)
  ⎿ 245 lines
- ✗ Bash(npm test) (30.0s)
<model narration text>
```

Written as `# Agent transcript\n\n` + transcript lines joined by `\n` + `\n` (scripts/agents/agent-adapter-core.js:259-262,201,240).

### `logs/agent-stderr.log` (persistStderr)

Redaction: matches of `sk-…`, `ghp_…`, `xox[bprs]-…`, `Bearer <tok>`, `Authorization: <tok>`, `api_key=/api-key:`, `token=/token:` become `<first-4-chars>***[REDACTED]`. Cap 4096 chars, then `\n  [truncated from <N> bytes]`. File ends with `\n` (scripts/agents/agent-adapter-core.js:459-472).

### source-context outputs

Usage (stderr):

```
usage:
  node scripts/source-context.js profiles
  node scripts/source-context.js manifest [--profile core] [--ref HEAD] [--changed-from REF] [--repo-root DIR]
  node scripts/source-context.js export [--profile core] [--ref HEAD] [--changed-from REF] [--repo-root DIR] [--cache-dir DIR]
```

with a first line `source-context: unknown command: <cmd|(missing)>` (scripts/source-context.js:110-121). Every hard stop: `source-context: <msg>` on stderr, exit 1 (scripts/source-context.js:312-315).

`manifest` record (one JSON per line):

```
{"schemaVersion":1,"profile":"core","ref":"<full-sha>","path":"plugins/cool-workflow/src/state.ts","bytes":1234,"lines":56,"sha256":"<64-hex>","included":true,"reason":"included:plugins/cool-workflow/src/**"}
```

`lines` is `null` for a binary file; with `--changed-from` a `changedFrom` key (the resolved base sha) is added; `export` records add `"content":"<utf8 text>"` and only included files appear (scripts/source-context.js:75-97). `reason` values: `included:<pattern>`, `excluded:<pattern>`, `not-included` (scripts/source-context.js:196-202). Over-budget export: `source-context: profile <id> exported <N> lines, above maxLines <M>` (scripts/source-context.js:99-102). Binary included file: `source-context: included file is binary: <file>` (scripts/source-context.js:94).

### onramp-check report (stdout)

```
{
  "schemaVersion": 1,
  "baseRef": "<ref>",
  "ok": false,
  "changedFiles": [...],
  "recommendedSmokeTests": [...],
  "recommendedCommands": [...],
  "issues": [ { "code": "...", "detail": "...", "fix": "...", "files": [...] } ]
}
```

(`JSON.stringify(report, null, 2)` + `\n`; scripts/onramp-check.js:25-31). With `--check` and `ok:false`, stderr gets:

```

onramp contract failed:
  - <code>: <detail>
    fix: <fix>
    files: <a, b, c>
```

and `process.exitCode = 1` (scripts/onramp-check.js:32-40). Issue codes and exact `detail` strings (src/onramp.ts:346-377):

- `runtime-smoke-required` — `Runtime or app changes must include at least one smoke test change.`
- `types-without-runtime` — `Type-only source changes are not a valid cycle.`
- `surface-docs-required` — `CLI, MCP, or capability surface changes must update public docs.`
- `iteration-log-required` — `Source, app, or script changes must be recorded in ITERATION_LOG.md.`

### batch-delegate-child stdout

Per settled job, one line: `{"i":<index>,"exitCode":<n|null>,"stdout":"..."}` or `{"i":<index>,"spawnError":"...","exitCode":null,"stdout":"..."}` + `\n`. Whole-input failures: `[]` (empty jobs) or `[{"spawnError":"invalid stdin JSON: <msg>","exitCode":null,"stdout":""}]` with NO newline (scripts/children/batch-delegate-child.js:35-38,48).

### http-delegate-child stdout

`{"exitCode":<n>,"stdout":"<text>"}` or `{"error":"<msg>"}` — no newline (scripts/children/http-delegate-child.js:36-38).

### cw-attest tools

- keygen `--print` stdout: `# PRIVATE (executor / wrapper — CW_AGENT_ATTEST_PRIVKEY)\n<pem>\n# PUBLIC (CW verify — CW_AGENT_ATTEST_PUBKEY)\n<pem>\n` (scripts/agents/cw-attest-keygen.js:28).
- keygen file mode stdout starts `Wrote ed25519 keypair:` then the two paths and export hints (scripts/agents/cw-attest-keygen.js:40-55).
- wrap stderr notes: `cw-attest-wrap: no CW_AGENT_ATTEST_PRIVKEY — emitting UNSIGNED (CW will record unattested)` and `cw-attest-wrap: signing skipped (<msg>) — emitting UNSIGNED` (scripts/agents/cw-attest-wrap.js:140,143). Arg errors: `cw-attest-wrap: unexpected arg before "--": <arg>` / `cw-attest-wrap: no inner agent command after "--"`, exit 2 (scripts/agents/cw-attest-wrap.js:54-57).

### Exit codes (all of this subsystem)

- `0` — success (wrapper wrote result + report; source-context printed JSONL; children printed their JSON).
- `1` — refusal / hard stop (no result, bad JSONL, source-context `die`, child non-null failure, onramp-check `--check` fail).
- `2` — bad invocation (wrapper argv missing; invalid `CW_CODEX_SANDBOX`; cw-attest-wrap arg errors).
- `130` / `143` — renderer signal path: SIGINT / SIGTERM during a live view (scripts/agents/agent-adapter-core.js:120).
- pass-through — a wrapper exits with its vendor child's non-zero code; cw-attest-wrap exits with the inner agent's code.

## Files on disk

- `<dir-of-result>/result.md` — the agent's final markdown; written by the wrapper only after a real result exists (e.g. scripts/agents/claude-p-agent.js:195).
- `<dir-of-result>/transcript.md` — always written on close, format above (scripts/agents/claude-p-agent.js:96,180).
- `<dir-of-result>/logs/agent-stderr.log` — advisory failure diagnostics, redacted + capped (scripts/agents/agent-adapter-core.js:459-472).
- `<dir-of-result>/.codex-last-message-<pid>.md` — codex temp final-message file; removed before the run and in a `finally` after read (scripts/agents/codex-agent.js:71-76,184-190).
- `manifest/source-context-profiles.json` — profile policy data; `{schemaVersion:1, profiles:{<id>:{description, maxLines, include[], exclude[]}}}` (manifest/source-context-profiles.json:1-25; validated at scripts/source-context.js:130-146).
- source-context cache: `<cacheDir>/<safeProfile>-<ref-first-12>[-changed-<base-first-12>]-<digest-first-16>.jsonl`, where `safeProfile` replaces chars outside `[A-Za-z0-9_.-]` with `_` and the digest is sha256 of a stable stringify of `{profileId, profile, changedFrom}`; written via `<file>.<pid>.tmp` + `rename` (atomic) (scripts/source-context.js:236-241,285-294).
- `cw-attest.key` (mode 0600) and `cw-attest.pub` — keygen output (scripts/agents/cw-attest-keygen.js:33-38).
- `.cw-release/gate-<sha>.ok` — gate pass marker (UTC ISO line) (scripts/release-gate.js:183).
- `.cw-release/review-<FULLSHA>.verdict` — first line `APPROVED <FULLSHA>`; auto-made by `release-flow.js --cut`, verified by both the cut and CI (scripts/release-flow.js:26-31).
- Reads: worker `input.md` (argv[2]); `<CODEX_HOME|~/.codex>/config.toml` (codex model fallback); `builtin-templates.json`; the attest manifest JSON (`{{manifest}}` — keys used: `inputPath`, `resultPath`, `runId`, `taskId`, `prompt`) (scripts/agents/cw-attest-wrap.js:119-129).

## Invariants and error behavior

- Never fabricate: every wrapper refuses (exit 1, no `result.md` write) when the vendor gave no final result — claude: no `result` event; codex: missing `--output-last-message` file or empty text; gemini/opencode: empty assembled text. CW then records a failed hop (scripts/agents/claude-p-agent.js:188-193; codex-agent.js:176-198; gemini-agent.js:109-123; opencode-agent.js:162-176).
- stdout is data, stderr is diagnostics — the ONE report JSON is the only wrapper stdout; all traces, spinners, and errors go to stderr (docs/agent-delegation-drive.7.md "seam" diagram; scripts/agents/agent-adapter-core.js:448-450).
- Core forwards vendor streams, never parses them: all vendor NDJSON parsing lives in the wrappers; CW core only captures the wrapper's stdout and reads the one report line (scripts/agents/codex-agent.js:6-9; docs/agent-delegation-drive.7.md:20-29).
- Trust gate on stream shape: codex/gemini/opencode treat ANY non-JSON stdout line from the vendor as poison — clean exit or not, the wrapper refuses (scripts/agents/codex-agent.js:169-174; gemini-agent.js:102-107; opencode-agent.js:155-160).
- Fail closed on config: unknown `CW_CODEX_SANDBOX` exits 2 — never a silent downgrade to `read-only` (scripts/agents/codex-agent.js:107-114). Unknown source-context profile/command/ref/cache all `die` (exit 1).
- Vendor stderr is CAPTURED (cap 1MB), never inherited, so it cannot break the live render region; it is shown only on a non-zero exit and persisted to `logs/agent-stderr.log` (scripts/agents/claude-p-agent.js:111-113; codex-agent.js:147-150).
- Rule of Silence: with stderr not a TTY the renderer is silent unless `CW_AGENT_STREAM=1`; `CW_AGENT_STREAM=0`/`CW_NO_STREAM=1` turn all live output off (scripts/agents/agent-adapter-core.js:93-96).
- Cursor hygiene: the interactive renderer restores the cursor on exit and on SIGINT/SIGTERM (exit 130/143) (scripts/agents/agent-adapter-core.js:116-125).
- persistStderr is advisory only: it never throws, never changes the exit code or recorded evidence (scripts/agents/agent-adapter-core.js:469-471).
- Attestation honesty: no key or no usage → UNSIGNED pass-through (CW records `unattested`); the wrap never blocks the hop and never forges a signature; CW holds only the public key (scripts/agents/cw-attest-wrap.js:26-28,113-145; cw-attest-keygen.js:4-8).
- Atomic-ish writes: the source-context cache goes through tmp-file + rename (scripts/source-context.js:285-294). The batch child streams a job's NDJSON line the instant it settles so earlier outcomes survive a later overflow kill (scripts/children/batch-delegate-child.js:11-18).
- Onramp contract fails closed: runtime/app change without a smoke change, type-only change, surface change without docs, or any source/app/script change without an `ITERATION_LOG.md` row → `ok:false` and (via `onramp-check --check`) exit 1 (src/onramp.ts:346-377; scripts/onramp-check.js:32-40).
- source-context cache validation re-checks EVERY record (profile, ref, changedFrom, `included===true`, sha256/bytes/lines re-derived from `content`) and dies on any mismatch — a broken cache never falls back silently (scripts/source-context.js:243-283).
- `codex exec` effort/sandbox overrides are per-run (`-c model_reasoning_effort=...`), never touching the user's `~/.codex/config.toml` (scripts/agents/codex-agent.js:19-24).
- Review-mode ordering: explicit `CW_CODEX_REASONING_EFFORT` / `CW_CODEX_SANDBOX` ALWAYS win over the `CW_RELEASE_REVIEW=1` signal (scripts/agents/codex-agent.js:96-108).

## Edge cases

- Killed vendor child: `close` with `code === null` → message `<vendor> exited (timeout/killed)` and exit 1 (all four wrappers).
- Batched tool results: the renderer keys `⎿` result lines by vendor `tool_use` id so several tools sent in one assistant turn each keep their own result, even after folding out of the window (scripts/agents/agent-adapter-core.js:229-243; claude-p-agent.js:135,153-160).
- Terminal resize / long labels: every rendered line is hard-capped to the CURRENT terminal width per frame so a wrapped row can never desync the in-place erase (scripts/agents/agent-adapter-core.js:182-188). The live-line width budget grows with the elapsed string (`(4.0s)` → `(100m00s)`) (scripts/agents/agent-adapter-core.js:150-154).
- `truncate` twin: the core's `truncate` is a deliberate copy of `src/term.ts` `truncate()`; `cli-render-smoke.js` cross-checks them so they cannot drift (scripts/agents/agent-adapter-core.js:68-71,481).
- opencode message split: `text` parts are grouped by `part.messageID`; a NEW id resets the last-message text, so mid-run narration does not leak into the answer; usage is summed across `step_finish` events (scripts/agents/opencode-agent.js:80-95).
- codex model provenance: `codex exec --json` (>=0.139) sends no model field; the wrapper falls back to `model = ` the `config.toml` `model` key; a stream model still wins (scripts/agents/codex-agent.js:50-62,200).
- Legacy vendor shapes: gemini/opencode accept old `ev.result` / `ev.text` / `ev.delta` shapes as fallback so the wrapper is not pinned to one CLI version (scripts/agents/gemini-agent.js:49-55; opencode-agent.js:98-104).
- Empty diff in `--changed-from` mode: good — emits empty JSONL (scripts/source-context.js:61; docs/source-context-profiles.7.md:80).
- Deleted files in diff mode never appear (diff-filter `ACMRT` has no `D`) (scripts/source-context.js:157).
- `gitBlobs` reads all blobs in ONE `git cat-file --batch` call (256MB maxBuffer) and walks the byte stream by header size — truncated header/blob or a non-`blob` type dies with `cannot read <file> at <ref>: ...` (scripts/source-context.js:166-194).
- Glob match rules: `dir/**` matches the dir itself and everything under it; a pattern with `*` becomes a regex where `*` = `[^/]*`; no `*` = exact match (scripts/source-context.js:204-215).
- Line count rule: count `\n` bytes; a file not ending in `\n` counts one more line; empty file = 0 (scripts/source-context.js:217-222). Binary = contains a NUL byte (scripts/source-context.js:224-226).
- Onramp path normalize: a changed path starting `src/|apps/|scripts/|test/|docs/|dist/|manifest/|ui/|workflows/` gets the `plugins/cool-workflow/` prefix added; backslashes → `/`; leading `./` stripped (src/onramp.ts:470-476).
- Onramp with no git: `gitLines` returns `[]` on any git failure, so `resolveChangedFiles` degrades to empty instead of throwing (src/onramp.ts:450-454).
- attest-wrap report parse: whole stdout as JSON first, else the LAST line that starts `{` and ends `}` — mirrors CW's own `parseAgentReport` (scripts/agents/cw-attest-wrap.js:62-82). When a report exists but is not signed, it is re-emitted as ONE clean JSON object so CW's parse is never ambiguous (scripts/agents/cw-attest-wrap.js:137-141).
- resultDigest back-compat: the wrap signs WITHOUT `resultDigest` when `result.md` is absent/unreadable — a 4-field signature CW still verifies (scripts/agents/cw-attest-wrap.js:126-135).
- batch child stdin over 32MB is silently cut at the cap (append stops) — the JSON parse of a cut buffer then yields the `invalid stdin JSON` element (scripts/children/batch-delegate-child.js:27-29).
- http child polls at most 600 times (about 10 minutes) then falls through; a still-missing numeric `exitCode` becomes `{"error":"runner did not report an exitCode"}` (scripts/children/http-delegate-child.js:28-35).

## Evidence

Every claim above carries its pointer inline. Prime anchors:

- scripts/cw.js:1-4 (bin bootstrap); package.json:4-7 (bin map)
- scripts/source-context.js:23-108 (main), 110-121 (usage), 130-146 (profile validation), 148-158 (refs/diff), 166-194 (batch blobs), 196-226 (classify/lines/binary), 236-294 (cache), 312-315 (die)
- scripts/agents/agent-adapter-core.js:7-36 (contract), 42-53 (gating), 63-77 (color/truncate), 89-280 (renderer), 331-371 (labels/summaries), 411-450 (NDJSON + report), 459-489 (persistStderr + exports)
- scripts/agents/claude-p-agent.js:39-44 (argv), 50-83 (legacy), 101-105 (spawn), 142-169 (events), 171-198 (close)
- scripts/agents/codex-agent.js:53-62 (model fallback), 64-76 (argv/finalPath), 96-114 (review/effort/sandbox), 118-138 (spawn), 159-201 (close)
- scripts/agents/gemini-agent.js:29-56 (argv/parse), 60-72 (spawn), 92-126 (close)
- scripts/agents/opencode-agent.js:34-45 (argv/variant), 63-105 (parse), 109-125 (spawn), 145-179 (close)
- scripts/agents/deepseek-agent.js:20-23; scripts/agents/gemini-opencode-agent.js:22-25 (variants)
- scripts/agents/builtin-templates.json:4-11; src/agent-config.ts:141-182 (registry + expansion)
- scripts/agents/cw-attest-keygen.js:27-55; scripts/agents/cw-attest-wrap.js:42-149
- scripts/children/batch-delegate-child.js:26-85; scripts/children/http-delegate-child.js:17-40
- src/onramp.ts:71-127 (curated map), 129-169 (helpers), 171-320 (buildDoctorOnramp), 322-387 (changed files + contract), 389-417 (recommend), 430-444 (base ref), 446-508 (git/normalize/classifiers)
- scripts/onramp-check.js:20-41; scripts/release-gate.js:1-184; scripts/release-flow.js:1-45; scripts/release-check.js:10-11; scripts/parity-check.js:4-19; scripts/gen-manifests.js:4-21; scripts/dist-drift-check.js:4-21; scripts/bump-version.js:4-21; scripts/version-sync-check.js:12-41; scripts/vendor-preflight.js:4-31; scripts/coverage-gate.js:4-27; scripts/golden-path.js:10-36
- docs/agent-delegation-drive.7.md (the seam + red line); docs/source-context-profiles.7.md (profiles contract)

## Pinned by tests

- `test/claude-p-agent-wrapper-smoke.js`, `test/codex-agent-wrapper-smoke.js`, `test/gemini-agent-wrapper-smoke.js`, `test/gemini-opencode-agent-wrapper-smoke.js`, `test/opencode-agent-wrapper-smoke.js`, `test/deepseek-agent-wrapper-smoke.js` — per-vendor wrapper contracts (argv, refusals, report JSON).
- `test/agent-stream-gate-smoke.js` — stream on/off gating (`CW_AGENT_STREAM` / `CW_NO_STREAM`).
- `test/cli-render-smoke.js` — renderer behavior + `truncate` parity with `src/term.ts`.
- `test/telemetry-attest-wrap-smoke.js`, `test/telemetry-attestation-smoke.js` — attest wrap signing/unsigned pass-through.
- `test/batch-output-overflow-smoke.js`, `test/sandbox-env-batch-hardening-smoke.js`, `test/execution-backend-agent-smoke.js` — batch/agent delegate children behavior.
- `test/source-context-profile-smoke.js`, `test/source-context-batch-smoke.js` — exporter, profiles, cache, `--changed-from`.
- `test/onramp-check-smoke.js`, `test/parallel-onramp-smoke.js`, `test/doctor-smoke.js` — onramp contract + doctor onramp payload.
- `test/agent-delegation-drive-smoke.js`, `test/quickstart-no-agent-smoke.js`, `test/run-all-agent-env-hermetic-smoke.js`, `test/agent-config-atomic-write-smoke.js` — `builtin:` resolution, auto-detect, config persistence.
- `test/vendor-preflight-smoke.js` (shim-based), `test/release-flow-smoke.js`, `test/release-gate-smoke.js`, `test/release-check-skip-smoke.js`, `test/bump-version-idempotent-smoke.js`, `test/cli-mcp-parity-smoke.js`, `test/cli-jsonmode-parity-smoke.js`, `test/parity-doc-sync-smoke.js`, `test/end-to-end-golden-path-smoke.js`, `test/dogfood-release-smoke.js`, `test/release-tooling-smoke.js`, `test/release-pipeline-hygiene-smoke.js` — the release/gate script inventory.

## Rebuild risks

1. Making CW core parse vendor streams. The contract is: parsing lives in the wrappers; core only spawns them and reads the ONE stdout report JSON. Moving the parse into core breaks the seam and every `CW_AGENT_COMMAND` user (docs/agent-delegation-drive.7.md; scripts/agents/codex-agent.js:6-9).
2. Fabricating results. On no-result the wrapper must exit 1 and NOT write `result.md`. A rebuild that writes an empty file or a stub "no answer" turns a failed hop into a fake success (all four wrappers' close handlers).
3. Byte drift in the exact strings: the `RESULT_CONTRACT` block, the refusal messages (mind the em-dash vs ASCII hyphen split between claude and the others), the usage lines, and the `{model,usage,result}` report with NO trailing newline.
4. Renderer gating flips: non-TTY must stay SILENT by default (`CW_AGENT_STREAM=1` opts in to plain lines); `CW_AGENT_STREAM=0` and `CW_NO_STREAM=1` kill all live output; stderr of the vendor is captured, never inherited. Getting this wrong corrupts CI logs or the live region.
5. The `truncate` twin: the wrapper copy must stay behavior-identical to `src/term.ts` (`max<=0` → `""`, fit → ORIGINAL with ANSI, else stripped + `…`) — `cli-render-smoke.js` will catch drift, but only if the rebuild keeps the smoke.
6. codex fail-closed details: unknown `CW_CODEX_SANDBOX` must exit 2, not downgrade; `CW_RELEASE_REVIEW=1` lifts effort to `high` and sandbox to `workspace-write` but explicit env still wins; the `-c model_reasoning_effort=...` per-run override must not touch the user's config.toml.
7. Stream-shape trust: one non-JSON stdout line from codex/gemini/opencode must poison the whole run even when the exit code is 0. A rebuild that "just skips bad lines" silently accepts corrupt output.
8. batch child ordering/caps: NDJSON must stream per-settle with the `i` index (settle order ≠ submit order), stdout cap 32MB → `spawnError` + `exitCode:null`, SIGTERM at `timeoutMs` + SIGKILL at `+5000` — the parent's crash-tolerance depends on the incremental flush.
