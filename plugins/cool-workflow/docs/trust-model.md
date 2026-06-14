# Trust Model & Limitations

> **Read this before you trust a cool-workflow record.** This document states
> exactly what CW's cryptographic guarantees prove, and — just as important —
> what they do **not** prove. We would rather lose a skeptical reader here than
> have them over-trust a green checkmark in production. If anything below reads
> as an overclaim, it is a bug; please file it.

CW is an **auditable control-plane**. It plans, dispatches, records, and verifies
agent work — it does **not** run the model itself. That single architectural
choice is what the guarantees below rest on, and it is also the source of their
honest ceiling.

---

## TL;DR

- CW's ed25519 signature + hash-chained ledger prove **integrity and
  attribution**: a recorded usage figure was signed by the keyholder and has not
  been edited since it was recorded. Both re-verify **offline** — the recorded
  ledger's integrity with **no key at all** (`cw telemetry verify`), and each
  `attested` signature with the **public key alone** (`cw telemetry verify
  --pubkey <public.pem>`; also reproduced by `cw demo tamper`).
- They do **not** prove the original number was **true**. A dishonest signer can
  sign a lie; the lie is then cryptographically bound to its signer, but it is
  still a lie.
- **CW holds no private key.** It can verify, but it can neither forge a
  signature nor measure usage itself (by design — see the red line below).
- The honest gap is **single-keyholder / no second party**: when the same
  operator runs CW *and* holds the only signing key, integrity is real but there
  is no independent party attesting that the source was honest. **This is exactly
  why we are seeking early integration partners** who supply an independent
  second party / co-signer. See [Closing the gap](#closing-the-gap-the-second-party).

---

## What the cryptography is, precisely

There are two distinct mechanisms. Conflating them is the most common way to
over- or under-state the guarantee, so they are kept separate here.

### 1. The telemetry signature (ed25519) — attribution of a reported number

The agent (the **executor**) self-reports its token usage. A control-plane that
records that number verbatim is recording a **claim**. To turn the claim into an
**attestation**, the executor signs a canonical payload with its **private key**:

```
sign({ usage, runId, taskId, promptDigest })   // ed25519, executor-side
```

The `runId` / `taskId` / `promptDigest` binding is load-bearing: it ties the
signature to **this** hop, so a valid signature from one task cannot be replayed
onto another. `promptDigest` is the sha256 of the exact worker prompt CW handed
the agent.

CW then **verifies** that signature against an **operator-provisioned public
key**. CW holds *only* the public half. From `telemetry-attestation.ts`:

> CW VERIFIES that signature against an operator-provisioned PUBLIC key. CW holds
> ONLY the public key — it can verify, but can neither forge a signature nor (the
> red line) call a model to measure usage itself.

The result is one of three honest states, surfaced loudly and never silently
upgraded to "trusted":

| State | Meaning |
|---|---|
| `attested` | A valid ed25519 signature over the reported usage, bound to this run/task/prompt, verified against the configured public key. |
| `unattested` | Usage was reported but the signature is missing, malformed, made with the wrong key, or does not match the payload (tampered or replayed). Also: no trust key configured. |
| `absent` | The agent reported no usage at all. |

Defaults are honest: no signature ⇒ `unattested`; no usage ⇒ `absent`. **Usage
is never silently recorded as trusted.** The opt-in `require-attested-telemetry`
policy fails the run closed on anything other than `attested`.

### 2. The hash-chained ledgers — tamper-evidence of the recorded log

A signature proves the agent *said* a number in flight. It does not, by itself,
prove that **CW recorded exactly that** and that **nobody edited the record
afterward**. That is the job of the append-only, hash-chained ledgers:

- **Telemetry ledger** (`telemetry.json`, one entry per agent hop): each entry
  chains to the previous via `prevHash`, and `recordHash = sha256(canonical
  entry)`. Flip a recorded verdict (`unattested` → `attested`) or edit a recorded
  usage digest, and the chain no longer recomputes.
- **Trust-audit event log** (`events.jsonl`): the same discipline applied to
  every recorded decision — sandbox path allow/deny, policy snapshots,
  verifier-gated commits, collaboration approvals.

Verification **recomputes every hash independently and never trusts the stored
value**, so an edited, reordered, removed, or truncated entry flips
`verified = false`. A ledger that exists but cannot be parsed **fails closed** —
it is treated as corrupt, never silently as the clean empty chain.

This is all **offline**. The chain re-proof needs **no key at all**; add
`--pubkey <public.pem>` to re-run the signature **attribution** check against the
stored raw usage for every `attested` record. There is no telemetry service to
trust or breach — the record proves its own integrity, and a third-party auditor
can re-run both checks on their own machine.

---

## What this DOES prove

For telemetry, if `cw telemetry verify <run> --pubkey <public.pem>` reports green,
you can rely on **all** of the following, and only these:

1. **Attribution.** Each `attested` usage figure was signed by the holder of the
   configured private key, over a payload bound to that specific run, task, and
   prompt. It is **non-repudiable**: the signer cannot later disown it, and it
   could not have been replayed from a different hop.
2. **Tamper-evidence of the record.** The recorded ledger — verdicts, usage
   digests, audit decisions — has not been edited, reordered, truncated, or had
   entries removed since it was written, *to the extent a self-recomputable chain
   can detect* (see the threat-model caveat below). Casual or partial tampering,
   accidental corruption, truncation, and forged unchained lines are all caught.
3. **Offline, independent re-verification.** Re-proving the recorded ledger needs
   no network, no CW service, and no trust in our infrastructure — `cw telemetry
   verify` recomputes the chain on your machine (and needs no key to do it). With
   `--pubkey`, the ed25519 **attribution** is independently re-checked with the
   **public key alone**; `cw demo tamper` reproduces that sign-and-catch
   end-to-end, offline. The integrity claim does not depend on trusting us.
4. **CW never forged or measured anything.** CW holds no private key and never
   calls a model. It cannot mint a signature, and it cannot fabricate a usage
   number to sign. What it records, it received and verified.

---

## What this DOES NOT prove

Equally load-bearing. None of the following are within the guarantee, and we will
not imply otherwise:

1. **It does not prove the reported number is true.** A signature proves *who*
   said it and that it *wasn't altered* — **not** that it was correct at the
   source. Quoting the code's own honest ceiling:

   > A dishonest keyholder can still sign a lie, but the lie is now
   > cryptographically bound to its signer.

   CW deliberately does **not** independently measure usage (doing so would mean
   calling the model — the red line it refuses to cross). So the strongest honest
   claim is **attribution, not ground-truth measurement**.

2. **It does not defend against a single party who holds both roles.** If the
   same operator runs CW, holds the signing private key, *and* controls the
   machine the ledger lives on, then a green verdict attests that **that party**
   signed and that **that party's** record is internally consistent. It does not
   bring in any *independent* party. Self-consistency is not third-party
   verification.

3. **A determined local writer can re-chain the whole log.** The hash-chain's
   genesis is `sha256(runId)` — a value the local writer knows. So the chain
   detects edits to *part* of a log, but a writer who edits an entry and then
   **re-computes every subsequent hash** with CW's own sha256 produces a log that
   re-verifies green. From `trust-audit.ts`:

   > THREAT MODEL (be honest about the limit): the genesis is sha256(runId), so
   > this detects casual/partial tampering, accidental corruption, truncation,
   > removal, and forged-unchained lines — but NOT a determined local writer who
   > re-chains the WHOLE log with this module's own sha256 after an edit.

   This is **inherent** to any local, self-recomputable chain. Closing it needs an
   anchor the writer cannot reproduce. CW **cannot mint that anchor itself** —
   because by design it holds no private key. The one cryptographic anchor that
   exists is the **agent's** telemetry signature, which covers agent-reported
   *usage* — it does **not** cover CW-only decisions (sandbox / policy /
   commit-gate), which have no external signer.

   For those CW-only decisions, the only stronger guarantee available today is
   **operational**, not cryptographic: commit `events.jsonl` to an external
   append-only medium (git history, a remote append-only log) that the local
   writer cannot rewrite. The chain is a **strict upgrade** over a bare
   append-only log — not a substitute for an external anchor.

4. **It says nothing about the quality, safety, or correctness of the work.**
   Attestation is about *provenance and integrity of records*, not about whether
   the agent's output is good, secure, or even functional. Other CW mechanisms
   (verifier gate, schema validation, evidence grounding) speak to that; the
   cryptography here does not.

---

## The single-keyholder limitation (stated plainly)

> **The core honest gap:** when the same operator runs CW and holds the only
> verification/signing key, tamper-evidence proves that **records were not edited
> after the fact** — it does **not** prove that the **original signer was
> honest**. Integrity, yes. A trustworthy source, not necessarily.

Concretely, in a single-party setup:

- The operator provisions the keypair.
- The operator's agent process signs usage with the private key.
- CW (run by the same operator) verifies with the public key and writes the
  ledger to the operator's disk.

Every cryptographic check can pass while a motivated single party fabricates the
source number, or — given the genesis caveat above — rewrites the whole local
chain. **Cryptography cannot manufacture a second party that does not exist.**
Separation of duties is the property auditors require everywhere; with one
operator wearing both hats, it is structurally absent no matter how good the
math is.

We are not going to argue this point away. It is real, it is the most important
limitation in this document, and it is the right critique to raise.

---

## Closing the gap: the second party

The fix is **not** more cryptography on one machine — it is an **independent
second party**, which is precisely the thing a single operator cannot self-supply.
This is why CW's near-term priority is **early integration partners**, and what we
mean by that concretely:

- **An independent co-signer / second keyholder.** A second party (a different
  team, a CI identity outside the operator's control, or a partner's signing
  service) holds a key the operator does not. When that party counter-signs runs —
  or *is* the executor that signs usage — a green verdict starts to mean
  "two parties who do not fully trust each other agree," which is the property
  single-party attestation structurally cannot provide.
- **An external append-only anchor.** Pushing `events.jsonl` to a medium the local
  operator cannot rewrite (a partner-held log, a public transparency log, signed
  git history on a remote the operator doesn't control) closes the re-chain gap
  for CW-only decisions described above.
- **Separated execution and verification.** The party that *spends the money*
  (runs the model) and the party that *keeps the books* (CW) being genuinely
  different entities turns CW's separation-of-duties design from an architectural
  intent into an enforced fact.

If you are a potential partner who can supply an independent second party — a
co-signer, an external anchor, or separated execution — **that is the
collaboration we are actively looking for.** We would rather ship this honestly
and earn the second party than paper over the gap with a stronger-sounding claim
than the math supports.

---

## How to verify for yourself

- `cw telemetry verify <run>` — re-proves the telemetry ledger's **integrity**:
  chain linkage + an independent per-record hash recompute, so any edit to a
  recorded verdict or usage digest since record time flips it red. It needs **no
  key** (it re-proves the *recording*). Add `--pubkey <pem-or-path>` to re-run the
  ed25519 **signature** check for every `attested` record against the stored raw
  usage; unreadable keys, missing raw usage, digest mismatches, wrong keys, and
  signature mismatches fail closed. Mirrored as `cw_telemetry_verify` on the MCP
  surface.
- `cw demo tamper` — a hermetic, offline, one-command proof: it builds a real
  ed25519-signed ledger and then forges it two ways — flips a recorded verdict and
  re-computes the *local* record hash (the chain still breaks), and reuses a
  signature over inflated tokens (ed25519 rejects it). Everything is verified with
  the public key only. The `✗ DETECTED` lines are the point.
- Re-run either with **only the public key** on a machine we do not control. If it
  doesn't reproduce, our integrity claim is false — hold us to it.

---

## One-line summary

CW's cryptography proves **records weren't edited and were signed by the
keyholder** — strong, offline, public-key-verifiable **integrity and
attribution**. It does **not** prove the **source was honest**, and a single
operator holding both roles is the honest limit we are explicitly recruiting
integration partners to close.
