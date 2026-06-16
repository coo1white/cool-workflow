# Cool Workflow — Story & Talking Points

A guide you can use again and again for talking about this project: résumé
points, the README story, and a Show HN post. The numbers below are true (taken
from the repo): ~22,324 LOC across 34 TypeScript modules, 26 smoke tests, 6
bundled workflow apps, 27 tagged releases, MCP-native, BSD-2.

---

## 1. What it is (one paragraph)

Cool Workflow is a long-lasting runtime you can look into that takes open agent
tasks and makes them into workflow runs you can check. In place of running a task
as one long prompt, it runs one loop at every layer — plan → dispatch → record
evidence → verify → verifier-gated commit → report — and keeps every step as
plain JSON you can read, take up again, and play back. The runtime never takes
success for granted: when evidence, dependencies, or reasons are not there, these
are states you can see, not quiet passes.

---

## 2. Résumé bullets

```
Cool Workflow — agent workflow control-plane (TypeScript/Node, BSD-2)        Solo author
github.com/coo1white/cool-workflow

Designed and built a durable, inspectable runtime that turns open-ended agent
tasks into auditable workflow runs: plan → dispatch → record evidence → verify →
verifier-gated commit → report. ~22k LOC across 34 modules, 26 smoke tests, 27
tagged releases.

• Built an explicit state machine with plain-JSON durable run state (.cw/runs/);
  every step is resumable, replayable, and audit-traceable — no hidden DB.
• Designed a multi-agent layer: process table, shared blackboard coordinator, and
  reusable topologies (map-reduce, debate, judge-panel) with role policy + audit.
• Implemented an Evidence Adoption reasoning chain that records *why* each result
  was adopted/rejected (basis, authority, rationale, counterfactual), fail-closed
  to an explicit `unexplained` state instead of guessing.
• Shipped a verifier-gated commit model and a deterministic eval/replay harness
  with regression gates, so releases are dry-run verified, not hand-checked.
• Made it cross-vendor: one source-of-truth manifest generates Claude/Codex plugin
  adapters over a shared CLI + MCP (JSON-RPC 2.0) runtime — no forked logic, with
  a fail-closed drift check in CI.
• Enforced release discipline in code: version-sync, build/type/test gates,
  golden-path, fixture-compat, and self-dogfooding on the project's own repo.
```

### 中文精简版

```
Cool Workflow — 独立开发的 Agent 工作流运行时(TypeScript/Node,BSD-2 开源)
• 设计并实现可审计、可复现的 agent 运行时:plan→dispatch→记录证据→验证→门控提交→报告;
  显式状态机 + 纯 JSON 持久化(.cw/runs/),全程可断点续跑、可回放。约 2.2 万行 / 34 模块 / 26 smoke 测试 / 27 个版本。
• 自研多 agent 协作层(进程表 + 黑板协调器 + map-reduce/辩论/评审团拓扑)、证据采纳推理链(可解释"为何采纳",缺据则 fail-closed)、
  确定性 eval/replay 回归门、跨厂商分发(单一真相源生成 Claude/Codex 清单,共享 CLI + MCP),并把发版纪律写成 CI 门禁。
```

---

## 3. README narrative ("What I actually built")

> Copied into the project README. Kept here so it can be used again word for word.

Most "agent frameworks" take a task as one long prompt and have hope for the
best. Cool Workflow takes it as a runtime question: make the work long-lasting,
open to looking into, and open to being checked, in the same way an OS makes
processes long-lasting and open to looking into.

The full system is one idea done again at every layer:

```text
plan → dispatch → record evidence → verify → verifier-gated commit → report
```

- **Open state, no secrets.** Every run is plain JSON under `.cw/runs/<id>/` —
  open to reading, comparing, taking up again, and playing back. No secret
  dashboard DB; the runtime never takes success for granted — when a thing is not
  clear, that is a state you can see.
- **Evidence over feelings.** Results come with a record of where they came from.
  The Evidence Adoption reasoning chain keeps a note of *why* a thing was taken up
  or turned down — basis, authority, rationale, and the other option it won
  against — and when it is not sure it stops at `unexplained` in place of making
  up a reason.
- **Multi-agent as a process table.** Roles, group ties, a shared blackboard,
  and topologies you can use again (map-reduce, debate, judge-panel) with policy
  + audit.
- **Checked, not gone over by hand.** A deterministic eval/replay harness and a
  verifier-gated commit model put a gate on every release; `release:check` builds,
  type-checks, tests, replays, and self-dogfoods on this repo.
- **One kernel, many front doors.** A shared CLI + MCP (JSON-RPC 2.0) runtime;
  vendor plugin manifests (Claude, Codex, …) are made from a single source
  of truth, with a fail-closed drift check so no adapter makes its own copy of the
  logic.

The design idea is Unix/BSD on purpose: small kernel, open state, pipes you can
put together, workers kept apart, verifier-gated commits, docs as man pages.

---

## 4. Show HN post

**Title options**

- `Show HN: Cool Workflow – a durable, inspectable runtime for agent workflows`
- `Show HN: I built an agent workflow runtime that records *why* it adopted each result`

**Body**

```
Hi HN. I built Cool Workflow, a small TypeScript/Node runtime that turns
open-ended agent tasks into durable, inspectable workflow runs.

The premise: most agent tooling runs the whole task as one long prompt, so when
it goes wrong you can't tell what happened or trust the result. I wanted the
opposite — treat it like a runtime, with explicit state you can read, resume,
and replay.

The model is one loop, repeated everywhere:

  plan → dispatch → record evidence → verify → verifier-gated commit → report

Every run is plain JSON on disk (.cw/runs/<id>/). No hidden database. The
runtime never infers success: if evidence, dependencies, or rationale are
missing, that's a visible "unexplained"/"blocked" state, not a silent pass.

A few things I'm happy with:

- Evidence Adoption reasoning chain: it records *why* a result was adopted or
  rejected (basis, authority, rationale, and the alternative it beat), and fails
  closed instead of inventing a reason. "Why adopted" beats "just adopted."
- Multi-agent as a process table: roles, a shared blackboard, and reusable
  topologies (map-reduce, debate, judge-panel) with policy + audit.
- A deterministic eval/replay harness so releases are gated by regression checks,
  not vibes. `release:check` builds, type-checks, tests, replays, and dogfoods
  the runtime on its own repo.
- One kernel, many front doors: a shared CLI + MCP server; the Claude/Codex
  plugin manifests are generated from a single source of truth with a
  fail-closed drift check, so no vendor adapter forks the core.

It's ~22k LOC across 34 modules, 26 smoke tests, 6 bundled workflow apps, BSD-2.

I'm a self-taught dev and this is the most ambitious thing I've built. Design is
deliberately Unix/BSD: small kernel, explicit state, composable pipes, isolated
workers, verifier-gated commits, docs written as man pages.

Repo: https://github.com/coo1white/cool-workflow
Happy to answer anything about the state model, the evidence/verification design,
or the cross-vendor plugin approach.
```
