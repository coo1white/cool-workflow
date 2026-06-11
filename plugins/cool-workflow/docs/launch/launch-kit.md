# Launch Kit — Cool Workflow

Copy for announcing CW. The through-line is the one thing no other agent-pipeline
tool ships: **you can prove the telemetry, offline, with only a public key.**
Everything leads with the 30-second `npx cool-workflow demo tamper` proof.

---

## One-liner

> Cool Workflow is an auditable control-plane for multi-agent workflows. It
> *delegates* model execution — never embeds it — and makes every recorded agent
> telemetry verdict tamper-evident: anyone can re-verify a run offline with only a
> public key.

## Elevator (2 sentences)

> Most agent-pipeline tools log what the model reported and trust it. CW signs and
> hash-chains every telemetry verdict, so a forged or edited record fails
> verification — provably, offline — which is what "auditable" has to mean before
> you let agents touch production work.

---

## Show HN

**Title:**
`Show HN: Cool Workflow – tamper-evident telemetry for agent pipelines (npx demo)`

**Body:**

> I kept seeing agent-orchestration tools treat the model's self-reported token
> usage and results as ground truth. For anything auditable that's backwards — a
> control-plane that trusts unverified self-reports audits *claims*, not facts, and
> a forged "green" run looks identical to a real one.
>
> Cool Workflow is a small, zero-dependency CLI + MCP runtime that takes the
> opposite stance. It **delegates** model execution to whatever agent you configure
> (`claude -p`, `codex exec`, an HTTP endpoint) and never embeds a model SDK or
> holds an API key. What it *does* own is the audit trail: each agent hop's reported
> usage is signed (ed25519) and appended to a hash-chained ledger, so editing any
> record — or even recomputing its local hash to cover the edit — breaks the chain
> downstream. You can re-verify a finished run with only the public key, no network,
> no trusted server.
>
> The 30-second proof, no install:
>
> ```
> npx cool-workflow demo tamper
> ```
>
> It builds a real signed ledger, forges it two ways (flip a verdict + re-seal its
> hash; inflate reported tokens + reuse the signature), and shows both forgeries
> caught offline. On a real run, `cw telemetry verify <run>` does the same against
> what's on disk.
>
> Other things it does: concurrent `parallel()` phases with declared collapse
> semantics (collect-all + kill-on-timeout — 16 agents with a forced hang/crash/
> dirty-return finish without deadlock and replay "who passed/who failed"), per-task
> output-schema gates, token budgets enforced against attested usage, and a one-way
> executor boundary welded into the type system (a callable that could reach a model
> API fails `npm run build`).
>
> Runs anywhere Node runs; `dist/` is committed; BSD-2. It's early (v0.1.79) and I'd
> genuinely like to hear where the "delegate, prove, replay" model breaks down for
> your workflows.
>
> Repo: https://github.com/coo1white/cool-workflow
> npm: https://www.npmjs.com/package/cool-workflow

---

## Short post / tweet thread

1/ Your agent pipeline trusts what the model *says* it did. Cool Workflow proves
it instead. `npx cool-workflow demo tamper` — 30s, no install:

2/ It builds a real ed25519-signed telemetry ledger, forges it two ways, and
catches both offline with only the public key. A control-plane that delegates
model execution but can still prove the bill is real.

3/ Also: concurrent batches that don't deadlock when an agent hangs, schema-gated
outputs, token budgets vs *attested* usage, and a red line (never call a model
API) enforced at compile time. Zero deps, BSD-2.
→ https://github.com/coo1white/cool-workflow

---

## Why this matters (the wedge, for a longer post)

- **Separation of duties.** CW never runs the model, yet can verify the executor's
  reported usage. The thing that *spends the money* is not the thing that *keeps
  the books* — the property auditors require everywhere except, so far, agent
  infra.
- **Offline, public-key verification.** No telemetry service to trust or breach.
  The record proves its own integrity; the verifier needs only the public key.
- **Replayable, not just logged.** CW breaks at dispatch and writes to disk, so a
  run replays deterministically — "who passed / who failed" is reconstructable, not
  a scrollback of a fused process.
- **Fail-closed by default where it counts.** Schema mismatch parks the hop;
  unverifiable usage can be refused (opt-in); an empty-capture result can't be
  presented as a clean commit.

## Assets to capture before posting

- [ ] A terminal GIF of `npx cool-workflow demo tamper` (the ✗ DETECTED lines are
      the hook) for the README top and the HN/tweet.
- [ ] Confirm `npx cool-workflow demo tamper` works from a clean machine (no clone).
- [ ] Pin the npm version badge / release in the first comment.

## Channels

Hacker News (Show HN), the MCP / agent-tooling communities, r/LocalLLaMA &
r/MachineLearning (the offline-verification angle), and the npm listing itself
(keywords already set). Lead every one with the demo command, not the feature
list.
