# Launch Kit — Cool Workflow

Copy for announcing CW. The through-line is the one thing no other agent-pipeline
tool ships: **you can prove the telemetry, offline, with only a public key.**
Everything leads with the 30-second `npx cool-workflow demo tamper` proof.

---

## ✅ FINAL — Show HN (copy-paste ready)

**Pre-flight (do these first):**
1. Record the demo GIF: `vhs plugins/cool-workflow/docs/launch/demo.tape` → add it to the README hero (insert the GIF near the badges/intro).
2. Confirm on a clean machine: `npx cool-workflow demo tamper` runs and prints `VERDICT: tamper-evidence holds ✓`.
3. Post during US morning (HN traffic peak); reply to the first comment with the npm + provenance link.

**Title** (exactly — HN strips most formatting):

```
Show HN: Cool Workflow – tamper-evident telemetry for agent pipelines (npx demo)
```

**URL field:** `https://github.com/coo1white/cool-workflow`

**First comment (paste right after posting):**

```
I kept seeing agent-orchestration tools treat the model's self-reported token
usage and results as ground truth. For anything auditable that's backwards — a
control-plane that trusts unverified self-reports audits claims, not facts, and a
forged "green" run looks identical to a real one.

Cool Workflow takes the opposite stance. It DELEGATES model execution to whatever
agent you configure (claude -p, codex exec, an HTTP endpoint) and never embeds a
model SDK or holds an API key. What it owns is the audit trail: each agent hop's
reported usage is signed (ed25519) and appended to a hash-chained ledger, so
editing any record — or even recomputing its local hash to cover the edit — breaks
the chain downstream. You re-verify a finished run offline — no telemetry service
to trust or breach.

30-second proof, no install:

  npx cool-workflow demo tamper

It builds a real signed ledger, forges it two ways (flip a verdict + re-seal its
hash; inflate reported tokens + reuse the signature), and catches both offline with
only the public key. On a real run, `cw telemetry verify <run>` re-proves the
recorded ledger on disk — recomputing the chain so any later edit to a verdict or
usage digest is caught; add `--pubkey <public.pem>` to re-run each attested hop's
signature check offline too. I keep an
honest trust-model doc (what it does and does NOT prove, incl. the single-keyholder
ceiling): https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/docs/trust-model.md

Also: concurrent parallel() phases with declared collapse semantics (collect-all +
kill-on-timeout — 16 agents with a forced hang/crash/dirty-return finish without
deadlock and replay who-passed-who-failed), per-task output-schema gates, token
budgets enforced against the host's recorded usage (opt-in gate fails closed on
unattested telemetry), and a one-way executor boundary welded
into the type system (a callable that could reach a model API fails `npm run
build`). Zero runtime deps, BSD-2, published to npm with provenance. Ships generated
plugin manifests for 5 agent platforms (claude, codex, agents, gemini, opencode);
`npm run manifest:load-check` boots all five from one source of truth.

It's early (v0.1.80) — I'd genuinely like to hear where the "delegate, prove,
replay" model breaks down for your workflows.

npm: https://www.npmjs.com/package/cool-workflow
```

---

## One-liner

> Cool Workflow is an auditable control-plane for multi-agent workflows. It
> *delegates* model execution — never embeds it — and makes every recorded agent
> telemetry verdict tamper-evident: anyone can re-verify a run's integrity offline,
> and check the ed25519 attribution with the public key alone.

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
> downstream. You can re-verify a finished run offline — no network, no trusted
> server.
>
> The 30-second proof, no install:
>
> ```
> npx cool-workflow demo tamper
> ```
>
> It builds a real signed ledger, forges it two ways (flip a verdict + re-seal its
> hash; inflate reported tokens + reuse the signature), and catches both offline with
> only the public key. On a real run, `cw telemetry verify <run>` re-proves the
> recorded ledger on disk — recomputing the chain so any later edit to a verdict or
> usage digest is caught; add `--pubkey <public.pem>` to re-run each attested hop's
> signature check offline too. I keep an
> honest [trust model & limitations](https://github.com/coo1white/cool-workflow/blob/main/plugins/cool-workflow/docs/trust-model.md)
> doc, including the single-keyholder ceiling.
>
> Other things it does: concurrent `parallel()` phases with declared collapse
> semantics (collect-all + kill-on-timeout — 16 agents with a forced hang/crash/
> dirty-return finish without deadlock and replay "who passed/who failed"), per-task
> output-schema gates, token budgets enforced against the host's recorded usage
> (an opt-in gate fails closed on unattested telemetry), and a one-way
> executor boundary welded into the type system (a callable that could reach a model
> API fails `npm run build`).
>
> Runs anywhere Node runs; `dist/` is committed; BSD-2. It's early (v0.1.80) and I'd
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
outputs, token budgets vs the host's recorded usage (attested-telemetry gate is
opt-in), and a red line (never call a model API) enforced at compile time. Zero
deps, BSD-2.
→ https://github.com/coo1white/cool-workflow

---

## Why this matters (the wedge, for a longer post)

- **Separation of duties.** CW never runs the model, yet can verify the executor's
  reported usage. The thing that *spends the money* is not the thing that *keeps
  the books* — the property auditors require everywhere except, so far, agent
  infra.
- **Offline verification.** No telemetry service to trust or breach. The record
  proves its own integrity offline — re-proving the chain needs no key at all — and
  the ed25519 attribution checks against the public key alone.
- **Replayable, not just logged.** CW breaks at dispatch and writes to disk, so a
  run replays deterministically — "who passed / who failed" is reconstructable, not
  a scrollback of a fused process. A finished run is portable and self-proving:
  `cw run inspect-archive <archive>` re-proves every file digest, the manifest, and
  the whole-archive hash without importing it; `cw run import` then
  `cw run verify-import <run-id>` restores it and re-proves the restored digests +
  telemetry chain — a tampered archive is caught before it is trusted.
- **Fail-closed by default where it counts.** Schema mismatch parks the hop;
  unverifiable usage can be refused (opt-in); an empty-capture result can't be
  presented as a clean commit.
- **Cross-vendor, and it actually boots.** One source manifest
  (`manifest/plugin.manifest.json`) generates Claude / Codex / Gemini / OpenCode /
  agents adapters, and `npm run manifest:load-check` boots all five (184 tools each)
  — the neutrality moat is executable, not aspirational.

## Assets to capture before posting

- [ ] **Demo GIF** — reproducible, no manual screen-recording: `vhs
      plugins/cool-workflow/docs/launch/demo.tape` → `docs/launch/demo-tamper.gif`,
      then add it to the README hero (insert it near the badges/intro). The
      ✗ DETECTED lines are the hook.
- [ ] Confirm `npx cool-workflow demo tamper` works from a clean machine (no clone).
- [ ] Pin the npm version badge / release + provenance link in the first comment.

## Channels

Hacker News (Show HN), the MCP / agent-tooling communities, r/LocalLLaMA &
r/MachineLearning (the offline-verification angle), and the npm listing itself
(keywords already set). Lead every one with the demo command, not the feature
list.
