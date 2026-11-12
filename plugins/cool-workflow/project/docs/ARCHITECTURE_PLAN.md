# Architecture Roadmap After MCP Process Separation

## Purpose

This is the current architecture work map for Cool Workflow. It gives the
small set of architecture changes still planned, and, at its end, the
product direction ("Product Direction & Moat") and the build-memory facts
("Build memory"), moved here from `AGENTS.md`. `AGENTS.md` keeps the
binding rules and the work order ("Current Work Direction").

Keep this order true:

```text
fail closed -> take out dead paths -> make boundaries clear -> prove North Stars
```

Each code cycle has one goal, one branch, one PR, and one fail-first test.
Normal CLI and MCP output, JSON, exit codes, file layout, and replay records
stay as they are.

## Current Base

The main architecture work before this map is complete:

- `core`, `shell`, and `wiring` are separate layers.
- The capability table is split into a pure data source and wiring slices.
- CLI and MCP use the same capability registry.
- The MCP control process and serial tool process are separate.
- Core unit tests and purity, parity, manifest, and release gates are in use.
- `architecture-review-fast` has opt-in result cache use in Map, Assess,
  Verify, and Verdict.
- The manifest vendor registry is now required. The dead hard-coded build path
  was taken out in PR #507.

The old rebuild work packages are history. They are not work to do again.

## Work Map

### 1. Independent CLI Proof in the Parity Gate

Status: complete in the independent parity proof cycle.

The top-level parity gate must not use a CLI token list made from the registry
as proof that the same CLI rows are live.

- Probe every declared CLI path through the live dispatcher.
- Read help-visible commands from real `cw help` output.
- Keep live MCP `tools/list` checks.
- Keep CLI-process to MCP payload checks for `payloadIdentical` rows.
- Keep the present parity JSON keys and successful output shape.
- Keep `buildParityReport()` adversarial tests with direct test input.

Done means a fixture with a broken CLI binding fails the gate, while the
public CLI and MCP surfaces stay byte-identical.

### 2. Run Directory IO in Shell

Status: complete in the run-directory shell boundary cycle.

`core/state/run-paths.ts` must do path math only.

- Keep `createRunPaths()` in `core`.
- Move `ensureRunDirs()` to the run-store shell layer.
- Keep the shell export used by current callers.
- Take the `node:fs` entry for `core/state/run-paths.ts` out of the purity
  baseline.
- Keep every `.cw/runs/<id>/` directory and fallback path as it is.

Done means core has no file-system import for run paths, and create, export,
restore, and resume tests keep the same file layout.

### 3. One Schema Version Definition for Each Domain

Status: complete in the schema version guard cycle.

Replay domains need one version definition each. Different domains do not
need one global version.

- Add a checked inventory of schema domains and their definition files.
- Fail on a second definition in one domain.
- Fail on an unknown domain or an inventory entry which has no use.
- Keep all current schema numbers and JSON fields.
- Run the check from `release:check`.

Done means a duplicate fixture fails, while archive, restore, migration, and
replay records keep their present bytes.

## North Star Proof

After the three open code cycles, stop internal structure work and prove the
three user tracks.

### Track A

Status: passed on 2026-07-14 after the human resume drive result was made
clear.

From a clean clone and clean home, follow the README and complete:

```text
plan -> run -> inspect -> resume
```

The path has to take less than five minutes. Keep safe commands and measured
time as evidence.

### Track B

Status: passed on 2026-07-14. Restore, strict check, resume, and the
before-write tamper refusal all passed.

Use two separate temporary roots. Export a run from the first, restore and
verify it in the second, then resume it. A changed archive has to be refused
before any target state is written.

### Track C

Status: passed on 2026-07-14 with Claude Code and Codex CLI.

Load generated manifests in at least two real AI clients. For each client,
prove MCP `initialize`, `tools/list`, and one read-only `tools/call`. Keep only
safe evidence with no user or machine data.

If a proof fails, the first real blocker becomes the next one-goal cycle.
The safe proof record is in `docs/audits/north-star-proof-2026-07-14.md`.

## Work Kept Out

Keep these items in `docs/BACKLOG.md` until new evidence changes their value:

- `withFileLockAsync`: the MCP control process no longer waits on tool locks.
- Large file splits: do them only when a file blocks real work or review.
- General util and small `loadRun` copy clean-up: local small code is cheaper
  than a new shared link.
- A formatter, directory moves, a model SDK, or a runtime dependency.
- `commitMessageTemplate`: removed 2026-09-02 (it had no real reader).

## Security Work Map

This work starts from the threat model in `.github/SECURITY.md`. It keeps the
same small control plane and does not add an auth server, model SDK, or runtime
package.

### 1. Canonical Archive File Table

Status: complete in PR #513.

Archive paths and rows are checked before a write. Paths have to be portable
and unique. Unknown roles, unsafe sizes, bad sha256 values, and reserved run
files fail closed. Clean archive bytes and success output stay the same.

### 2. Atomic Restore Publish

Status: complete in the atomic restore cycle.

`run restore` will make and check state in a same-disk staging place. It will
publish the run with one directory rename only after every check passes. A bad
check or an existing final run will leave the final path as it was.

### 3. Archive Intake Limits

Status: complete in the archive intake limits cycle.

`CW_MAX_RUN_ARCHIVE_BYTES`, `CW_MAX_RUN_ARCHIVE_FILES`, and
`CW_MAX_RUN_ARCHIVE_CONTENT_BYTES` let an operator set a raw archive byte
limit, a file count limit, and a decoded content byte limit. Bad settings and
over-limit input stop before a restore write. With no setting, present behavior
stays the same.

### 4. MCP Tool Authority Policy

Status: complete in the MCP tool authority cycle.

`CW_MCP_ENABLED_TOOLS` and `CW_MCP_DISABLED_TOOLS` give the MCP server an
enabled tool list and a disabled tool list. The disabled list has the last
word. Bad names stop server start. With no setting, the present `tools/list`
bytes and tool access stay the same.

After these cycles, run the Track A, B, and C product proofs again. A proof
failure becomes the next one-goal cycle. Do not start more inside-only security
work without such evidence.

## Robustness Work Map

### 1. MCP Tool Shutdown Containment

Status: complete in the MCP tool shutdown containment cycle.

The MCP parent already answers `ping` while a tool child waits on a file lock.
On `SIGINT` or `SIGTERM`, it must also stop that child before the parent ends.
The child must not wake later and write state. Normal stdin end keeps its old
ordered queue drain rule.

The held schedule-lock proof passed for both stop signals. No late schedule
write was made after the lock was freed. A new MCP server then answered ping.

### Measured Cost

After this proof, stop robustness work. Keep `withFileLockAsync` parked unless
a real product proof finds that a tool cannot stop, takes too long to stop, or
leaves bad state. A later change must first name the exact lock and write path,
and define sync and async re-entry before it changes a call chain.

## Performance Work Map

### 1. Workflow Overhead Baseline

Status: complete in the workflow-overhead baseline cycle.

The benchmark runner now has an opt-in zero-delay mode. It
writes plan, drive, and total times for every run plus medians to a JSON report.
Old benchmark calls keep their same CSV stdout bytes and defaults.

Five low-delay runs gave a 994ms median cold drive. A later profile named one
safe cost in that path: 39 separate trust-audit durable appends took about
169ms in one six-worker drive.

### Stop Rule

### 2. Trust-Audit Round Batching

Status: complete; the measured gain did not meet the cold-drive goal.

Each concurrent round will keep its short dispatch and settlement audit groups
under the existing audit lock. Each group will make one durable append before
its present checkpoint. It will not hold that lock while an agent is running.
The event order, ids, hashes, bytes, checkpoint order, reports, and replay
records stay the same.

### Next Check

The same five-run measure gave an 828ms median cold drive. This is faster than
the 994ms baseline, but it is not the 630ms goal. Stop this performance line
here. Do not start the CI cycle. A later cycle needs a new measure and one
safe cost that can meet the goal without a change to checkpoint order, report
time, default cache use, agent count, phase order, output, or replay records.

CI feedback work starts only after a measured cold-path change. It must keep
the test set and protected checks the same.

### 3. Cold Path Proof

Status: complete; no safe next change meets the 630ms goal.

The benchmark runner now has an opt-in trace report. It gives per-round time,
self time, durable write count, and durable write bytes for dispatch, agent
wait, settlement, report, and checkpoint work. Old calls keep their CSV stdout
and JSON report bytes.

Five clean Node 22 runs gave a 783ms median cold drive. Agent wait was 269ms,
but it covers four batch children and does not prove that one safe change can
save 200ms. The trace saw 34 durable writes (1.33MB); they hold state,
telemetry, and audit facts. No single safe part has the needed room. Stop this
line here. A later cycle needs a new proof, or a clear product decision to
change the execution or durable-state contract.

## Simple UI/UX Work Map

The Workbench, the small read-only web view this map was for, was taken out
on 2026-11-12 with the other frozen surfaces (release-and-migration(7),
"Removed Surfaces"). The CLI, `report.md`, and the one offline `report.html`
are the views that stay.

## Release Rules

- Do not add a CLI command, MCP tool, flag, JSON field, or runtime dependency
  for these changes.
- Put all project text in English. Use Basic English for common words.
- Never push to `main`. Use a branch, PR, green CI, and oldest-ready-first
  merge order.
- Do not tag each cycle. A release needs one clear new user ability, the time
  rule, full gates, and independent review.

## Product Direction & Moat

(Moved from `AGENTS.md` on 2026-11-03, word for word, when `AGENTS.md`
was cut down to the binding rules; `AGENTS.md` keeps a short English
form of the decision filter and a pointer here.)

(Merged in from `DIRECTION.md` on 2026-08-04, since consolidated here as
the one memory file. The version-history section that used to close that
file is dropped — it stopped naming versions at v0.1.37, several release
generations behind current, so it no longer served as live evidence. This
project's version history now lives only in git tags and GitHub Releases
— see `npm view cool-workflow version` for the current published version.)

**一句话定位**: CW 是可审计的编排 / 控制平面层——它故意不执行模型，只让别人
（Claude/Codex/任何 agent 框架）的执行变得显式、可检查、可恢复、可复放。比喻：
模型是汽油，CW 是汽车的**仪表盘 + 行车记录仪 + 变速箱**，不是发动机。护城河 =
**中立 + 可审计 + 可复放 + 跨厂商**。一旦自己变成发动机，护城河就没了。

**做什么**:
- delegate not execute：执行永远交给外部 agent / 运行环境。这是定位，不是差距。
- 显式状态落盘：每一步可检查、可介入、可复放（replay 确定性是硬约束，不可妥协）。
- evidence-gated commit：模型说"做完了"不算数，要有 evidence + verifier 通过才提交。
- 跨厂商移植：一个内核生成所有 vendor 的 plugin（Claude/Codex/…）。
- 把已有资产用得更狠：registry、delegating backends、workbench、audit chain、
  parity、scheduling 都已经在了——深化它们，而不是重造。（Note, 2026-11-12:
  the workbench and scheduling named here were taken out with the frozen
  surfaces; the text above is kept word for word.）（blackboard 与整个
  多 agent 一族已于 2026-09-28 删除，见下方"常见误判"。）
- 两个落地场景全力投入（它们 100% 吃现有资产）：代码库风险分析工具
  （architecture-review workflow + evidence + audit trail）；给别的 agent
  框架（LangChain/CrewAI…）加可观测 / 审计层。

**不做什么**:
- 不内嵌模型 API、不变成"执行引擎"——会丢掉中立审计的护城河。
- 不做大而全的抽象层（LangChain 的坑）：坚持小内核·显式状态·可组合·隔离
  worker·可验证提交。
- 不为了"动态"牺牲 replay：只有在能保住确定性复放的前提下才碰动态化。

**决策过滤器**（任何新建议先过这三关，全过才值得做）: 它让别人的执行更可
审计，还是让 CW 自己去执行（后者直接否）？它保住 replay 确定性了吗（破坏
的默认否）？它吃现有资产，还是要从零另起一摊（优先吃现有资产）？

**常见误判**（基于实际代码事实纠偏）:

| 听到的说法 | 事实 |
|---|---|
| "CW 只能编排、执行依赖外部是个差距，应该内嵌 API" | 这是定位红线，不是差距。执行后端（`plugins/cool-workflow/src/shell/execution-backend/`）的红线不变——"CW DELEGATES"（见 `plugins/cool-workflow/src/shell/commands/pipeline-cli.ts` 的委托声明）。 |
| "CW 是个 SDK / 应该做成 SDK" | 先分清两种 SDK：① 模型执行 SDK（内嵌 Claude/OpenAI API、自己跑模型）= 红线，永远不做。② Workflow App framework / 编排运行时（给开发者写 workflow app、给别的 agent 框架当可审计编排层）= 现在就已经是了。对内对外一律先说"可审计编排 / 控制平面 (control-plane)"，只有明确指 ② 时才用 "Workflow App framework"，不用 "SDK" 自我描述。 |
| "blackboard 存在但没用起来，应该用得更狠" | 已删除（2026-09-28 运营方同意 D1，slim-and-esm 第 2 步）：blackboard 连同 coordinator、topology、candidate、eval、review gate、state-explosion 整个多 agent 一族一起去掉了。原因：它是冻结面（只修不长），核心路径（`cw -q`、resume、report、doctor）用不到它，却约 12,800 行、75 个 MCP 工具，并把 dispatch / commit / report 牵进同一个 import 环；而且 CW 的定位是让别人的执行可审计，不是自己当多 agent 编排运行时。多个 agent 要协作，用 workflow app 定形、worker 输出给事实、`cw ledger` 跨 agent 交接。旧 state 里的 `multiAgent` / `blackboard` / `candidates` 字段照样能加载（当作数据保留）。 |
| "phases 应该动态化" | 现状静态是为了可复放。要动态先解决 replay 确定性，否则削弱核心卖点。 |

## Build memory

(Moved from `AGENTS.md` "Build Memory" on 2026-11-03, word for word. Its
"Current Work Direction" list stays in `AGENTS.md`; its "Lessons" and
"Failed Attempts" are now in the root `REVIEW.md`, as what a reviewer
stops. Keep it true to fact, short, and simple to add to. Do not use it
for guesses.)

### Verified Facts

- Default context slimming has to use the `core` source profile.
- The `core` profile takes in:
  - `plugins/cool-workflow/src/**`
  - `plugins/cool-workflow/apps/**`
  - `plugins/cool-workflow/package.json`
  - `plugins/cool-workflow/tsconfig.json`
  - `plugins/cool-workflow/scripts/cw.js`
  - `plugins/cool-workflow/scripts/mcp-server.js`
  - `plugins/cool-workflow/scripts/agents/**`
- The `core` profile keeps out:
  - `plugins/cool-workflow/dist/**`
  - `plugins/cool-workflow/test/**`
  - `plugins/cool-workflow/docs/**`
  - `plugins/cool-workflow/project/docs/assets/**`
  - `.cw-release/**`
- Keeping `dist/` out of the context pack is let through; deleting committed `dist/`
  is a separate release-contract decision.
- Context slimming is opt-in and must not change the CW command output we have now.
- `core` is still the default source context profile. Narrow opt-in profiles are there
  for scoped runs: `runtime`, `mcp`, `workflow-apps`, `release`, and
  `agent-wrappers`.
- `source-context --changed-from REF` is an opt-in diff-aware mode. It cuts the
  manifest/export down to changed current-ref files before profile inclusion, leaves out
  deleted files, keeps a note of the worked-out `changedFrom` base, and uses a separate
  cache key from full exports.
- Skill trigger metadata has to be in normal YAML frontmatter. Every
  `SKILL.md` needs `name` and a `description` full of triggers; the body is loaded
  only after a skill triggers and must not be the one place the trigger text comes from.
- Plan for making the runtime quicker:
  1. Add an opt-in fast architecture-review path that runs Map and Assess work
     as parallel phases in place of serial agent calls.
  2. Keep separate `fast` and `full` review modes so users can get a useful
     first result quickly while the deep review we have now is still there to use.
  3. Make one JSONL source context per run and give that fixed context to
     agent wrappers in place of making every worker go and find the repository again.
  4. Send cheap, fast models to mapping and summarization work, and keep the
     stronger models for verification and last verdict tasks.
  5. Cache source context and middle maps by git SHA plus profile digest,
     and fail closed when the digest does not match.
  6. Move long full reviews to background runs so foreground user
     flows give back progress and a fast report in place of stopping for 40 minutes.
- `architecture-review-fast` is the opt-in fast/full split build. It
  keeps `architecture-review` the same, plans 6 workers in place of 14, runs Map
  and Assess as parallel phases, takes in possible `sourceContext` and
  `sourceContextDigest` inputs, and reads model hints from
  `CW_ARCHITECTURE_REVIEW_FAST_MODEL` and
  `CW_ARCHITECTURE_REVIEW_STRONG_MODEL`.
- For model routing in user workflows, it is better to use wrapper flags:
  `architecture-review-fast --fast-model <fast> --strong-model <strong>`. The
  flags set the same task-level hints as the env vars; the model attestation kept on record
  still comes only from the outside agent output.
- `source-context export --cache-dir DIR` caches JSONL by resolved git commit SHA
  plus source-profile digest; cache hits must be byte-identical JSONL and corrupt
  cache records fail closed.
- `scripts/architecture-review-fast.js` is the automated fast-review wrapper. It
  exports cached source context for a target repo, computes the JSONL digest,
  starts `architecture-review-fast`. Its old `--schedule-full` flag went with
  `cw schedule` on 2026-11-12 and is now refused; run the full
  `architecture-review` app yourself after the fast review.
- `scripts/architecture-review-fast.js --metrics` is opt-in. Default JSON output
  remains unchanged; the metrics payload reports elapsed milliseconds, source
  context bytes, fast-review step counts, agent-spawn counts, and result-cache
  hit counts.
- Live baseline on 2026-06-13 using the bundled Claude wrapper against this repo
  with the `core` profile: first `architecture-review-fast --once --metrics`
  completed the two Map workers in 190118ms with `agentSpawns=2` and
  `resultCacheHits=0`; the immediate second identical run completed in 703ms
  with `agentSpawns=0` and `resultCacheHits=2`.
- Continuing that same live run showed Assess at 209149ms, Verify at 133709ms,
  Verdict at 127522ms, and the final commit at 323ms. Assess is the largest
  remaining measured foreground phase.
- Task `resultCache` is explicit opt-in. `architecture-review-fast` Map workers
  cache accepted results by `sourceContextDigest` plus rendered prompt digest;
  Assess workers additionally include completed previous-phase result digests in
  the cache key. Cache hits copy the cached result into the worker-local result
  path and still pass through normal worker-output validation. Missing or
  invalid cache entries never fabricate success.

### In-flight relay

- **Scope chime's environment into the shared handoff repo (operator, web
  UI).** `coo1white/handoff` (Private) is created, guarded, and verified; the
  cool-workflow (Mac) side is proven end-to-end. `cw ledger` has been on npm
  since v0.1.98 — see `npm view cool-workflow version` for the current
  published version rather than a number pinned here, which goes stale on
  every release. The
  remaining step is a web-UI action — add the `chime` environment's
  repository scope + a git token that can read/write it. A
  cool-workflow-scoped session cannot do this itself
  (`create_repository`/cross-repo calls return 403). Then on the chime side:
  `npm i -g cool-workflow@latest`, clone the handoff repo, and verify with
  `cw ledger list --dir ledger` (fail-closed). Setup runbook:
  `plugins/cool-workflow/docs/handoff-setup.md` and
  `plugins/cool-workflow/docs/cross-agent-ledger.7.md`.
- (Done, kept for the record: the old "cut the v0.1.98 tag" blocker shipped
  on 2026-07-03; releases through v0.2.4 are live on npm.)

### Cross-agent handoff ledger (verified)

- `cw ledger propose|review|verify|list` (CLI + MCP; design #317, impl #318) lets
  two agents scoped to two separate repos hand each other a change proposal or a
  review verdict as a digest-sealed JSON entry, verified fail-closed.
- Transport is git-host-agnostic. An entry is a file under `ledger/` in a shared
  repo both agents can push/pull; the kernel holds NO git logic. Write =
  `cw ledger propose > ledger/<id>.json`; read = `cw ledger list --dir ledger`
  (fail-closed inbox — exits 1 if any entry is tampered or malformed). `git
  add/commit/push` is the operator's step, kept out of the kernel.
- Entry digest = `sha256:` over the key-sorted canonical JSON of every field
  except `id`/`digest`; `id` = `ldg-` + the first 16 hex of the digest.
- Shared-repo (T2a) setup and the GitHub-vs-self-hosted (Gitea) trade-off live in
  `plugins/cool-workflow/docs/handoff-setup.md`.
- A cool-workflow-scoped web session CANNOT create a GitHub repo outside its scope
  (`create_repository` returns 403). The operator creates the shared repo and sets
  each environment's git token; scoping both environments is a web-UI step.
- Reachability decides host choice: github.com is in the default Trusted network
  allowlist (cloud sessions reach it with no policy change); a self-hosted Gitea
  host is NOT, so it needs the environment network policy to permit that host.

### Handoff ledger — future direction

- Direction, not load: the ledger carries KB-sized JSON commits, so there is no
  throughput problem to "share". Multi-host is for REDUNDANCY and geo-
  REACHABILITY (e.g. Gitea mirrors on VPSes in several countries when one host or
  region is unreachable), never for load-balancing a non-existent load.
- Why multi-host is safe HERE where general multi-master git is not: entries are
  immutable, content-addressed (`id` = digest), and self-verifying. Two agents
  never write the same filename with different content, so union of N mirror
  directories is a conflict-free set-union of self-verifying files. Write
  consistency — not throughput — is the real constraint, and immutability +
  content-addressing resolves it with no merge step.
- Mechanism for it: `cw ledger list` takes a repeatable `--dir` and union-verifies
  the mirrors into ONE fail-closed inbox (a tampered entry in ANY mirror fails the
  whole batch). Single `--dir` stays byte-identical (POLA); 2+ dirs is the new
  union path.
- Host path: start on GitHub private (reachable out of the box), add self-hosted
  Gitea mirrors later for redundancy/reachability. Migration is zero code cost —
  the transport is git-host-agnostic, so only the git remote(s) change. Each
  added node is one more network-allowlist entry and one more thing to keep
  online; add nodes for a concrete availability/reachability driver, not by
  default (more nodes = larger failure surface).

### Next Run

- The structure roadmap and all three North Star proofs are complete. See
  `plugins/cool-workflow/project/docs/audits/north-star-proof-2026-07-14.md`.
- Keep inside-only work stopped. A later product proof has to give a real
  blocker before another structure cycle starts.
- The chime scope item in "In-flight relay" is operator work. It is separate
  from the code roadmap.
- Use `node plugins/cool-workflow/scripts/architecture-review-fast.js --repo <repo> --profile core --once --metrics`
  for the automated 1→6 path on a CW-shaped repo. Use `--profile-file` for
  non-CW repositories.
- Map, Assess, Verify, and Verdict now have opt-in result cache use. Do not add
  another context or cache mechanism without new measured need.
- Use narrow source profiles before a more complex context mechanism: `mcp`,
  `workflow-apps`, `release`, and `agent-wrappers` are much smaller than
  `core`; `runtime` carries the full `src/**` kernel on purpose.
- For incremental review, prefer `--changed-from origin/main` plus a narrow
  profile. Treat the changed JSONL as an overlay, not a replacement for a full
  audit when broad architectural context is required.
- When a repeated workflow improves, update the matching skill.
