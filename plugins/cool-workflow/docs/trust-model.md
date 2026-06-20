# Trust Model & Limitations

> **Read this before you trust a cool-workflow record.** This page says
> exactly what CW's cryptographic guarantees prove, and — just as important —
> what they do **not** prove. We would be happier to lose a doubting reader here than
> to have them put too much trust in a green check mark in production. If anything below
> says more than is true, it is a bug; please send it in.

CW is an **auditable control-plane**. It plans, sends out, records, and checks
agent work — it does **not** run the model itself. That one design
choice is what the guarantees below are built on, and it is also the cause of their
honest limit.

---

## TL;DR

- CW's ed25519 signature + hash-chained ledger prove **integrity and
  attribution**: a recorded usage number was signed by the keyholder and has not
  been changed since it was recorded. Both check again **offline** — the recorded
  ledger's integrity with **no key at all** (`cw telemetry verify`), and each
  `attested` signature with the **public key by itself** (`cw telemetry verify
  --pubkey <public.pem>`; also done again by `cw demo tamper`).
- They do **not** prove the first number was **true**. A signer who is not honest can
  sign a false number; the false number is then bound by cryptography to its signer, but it is
  still false.
- **CW holds no private key.** It can verify, but it can not make a fake
  signature and it can not measure usage itself (by design — see the red line below).
- The honest gap is **single-keyholder / no second party**: when the same
  operator runs CW *and* holds the only signing key, integrity is real but there
  is no separate party giving word that the source was honest. **This is exactly
  why we are looking for early integration partners** who give a separate
  second party / co-signer. See [Closing the gap](#closing-the-gap-the-second-party).

---

## What the cryptography is, precisely

There are two separate parts. Mixing them up is the most common way to
say too much or too little about the guarantee, so they are kept apart here.

### 1. The telemetry signature (ed25519) — attribution of a reported number

The agent (the **executor**) reports its own token usage. A control-plane that
records that number word for word is recording a **claim**. To make the claim into an
**attestation**, the executor signs a canonical payload with its **private key**:

```
sign({ usage, runId, taskId, promptDigest })   // ed25519, executor-side
```

The `runId` / `taskId` / `promptDigest` binding does important work: it ties the
signature to **this** hop, so a good signature from one task can not be used again
on another. `promptDigest` is the sha256 of the exact worker prompt CW gave
the agent.

CW then **verifies** that signature against an **operator-provisioned public
key**. CW holds *only* the public half. From `telemetry-attestation.ts`:

> CW VERIFIES that signature against an operator-provisioned PUBLIC key. CW holds
> ONLY the public key — it can verify, but can neither forge a signature nor (the
> red line) call a model to measure usage itself.

The result is one of three honest states, shown clearly and never quietly
moved up to "trusted":

| State | Meaning |
|---|---|
| `attested` | A good ed25519 signature over the reported usage, bound to this run/task/prompt, checked against the set public key. |
| `unattested` | Usage was reported but the signature is missing, badly formed, made with the wrong key, or does not match the payload (changed or used again). Also: no trust key set. |
| `absent` | The agent reported no usage at all. |

Defaults are honest: no signature ⇒ `unattested`; no usage ⇒ `absent`. **Usage
is never quietly recorded as trusted.** The opt-in `require-attested-telemetry`
policy fails the run closed on anything other than `attested`.

### 2. The hash-chained ledgers — tamper-evidence of the recorded log

A signature proves the agent *said* a number while running. By itself it does not
prove that **CW recorded exactly that** and that **nobody changed the record
after**. That is the job of the append-only, hash-chained ledgers:

- **Telemetry ledger** (`telemetry.json`, one entry per agent hop): each entry
  chains to the one before through `prevHash`, and `recordHash = sha256(canonical
  entry)`. Flip a recorded verdict (`unattested` → `attested`) or change a recorded
  usage digest, and the chain no longer comes out the same.
- **Trust-audit event log** (`events.jsonl`): the same care put on
  every recorded decision — sandbox path allow/deny, policy snapshots,
  verifier-gated commits, collaboration approvals.

Verification **works out every hash on its own and never trusts the stored
value**, so a changed, reordered, removed, or cut-short entry flips
`verified = false`. A ledger that is there but can not be parsed **fails closed** —
it is taken as broken, never quietly as the clean empty chain.

This is all **offline**. The chain re-proof needs **no key at all**; add
`--pubkey <public.pem>` to re-run the signature **attribution** check against the
stored raw usage for every `attested` record. There is no telemetry service to
trust or break into — the record proves its own integrity, and a third-party auditor
can re-run both checks on their own machine.

---

## What this DOES prove

For telemetry, if `cw telemetry verify <run> --pubkey <public.pem>` reports green,
you can put trust in **all** of the following, and only these:

1. **Attribution.** Each `attested` usage number was signed by the holder of the
   set private key, over a payload bound to that one run, task, and
   prompt. It is **non-repudiable**: the signer can not later say it is not theirs, and it
   could not have been used again from a different hop.
2. **Tamper-evidence of the record.** The recorded ledger — verdicts, usage
   digests, audit decisions — has not been changed, reordered, cut short, or had
   entries taken out since it was written, *as far as a self-recomputable chain
   can see* (see the threat-model note below). Light or part tampering,
   damage by chance, cutting short, and faked unchained lines are all caught.
3. **Offline, independent re-verification.** Re-proving the recorded ledger needs
   no network, no CW service, and no trust in our setup — `cw telemetry
   verify` works out the chain again on your machine (and needs no key to do it). With
   `--pubkey`, the ed25519 **attribution** is checked again on its own with the
   **public key by itself**; `cw demo tamper` does that sign-and-catch again
   end-to-end, offline. The integrity claim does not rest on trusting us.
4. **CW never faked or measured anything.** CW holds no private key and never
   calls a model. It can not make a signature, and it can not make up a usage
   number to sign. What it records, it took in and checked.

---

## What this DOES NOT prove

Just as important. None of the following are inside the guarantee, and we will
not give any other idea:

1. **It does not prove the reported number is true.** A signature proves *who*
   said it and that it *was not changed* — **not** that it was right at the
   source. To quote the code's own honest limit:

   > A dishonest keyholder can still sign a lie, but the lie is now
   > cryptographically bound to its signer.

   CW on purpose does **not** measure usage on its own (to do so would mean
   calling the model — the red line it will not cross). So the strongest honest
   claim is **attribution, not ground-truth measurement**.

2. **It does not guard against a single party who holds both roles.** If the
   same operator runs CW, holds the signing private key, *and* controls the
   machine the ledger lives on, then a green verdict gives word that **that party**
   signed and that **that party's** record agrees with itself. It does not
   bring in any *separate* party. Agreeing with itself is not third-party
   verification.

3. **A set local writer can re-chain the whole log.** The hash-chain's
   genesis is `sha256(runId)` — a value the local writer knows. So the chain
   sees changes to *part* of a log, but a writer who changes an entry and then
   **works out every later hash** with CW's own sha256 makes a log that
   verifies green again. From `trust-audit.ts`:

   > THREAT MODEL (be honest about the limit): the genesis is sha256(runId), so
   > this detects casual/partial tampering, accidental corruption, truncation,
   > removal, and forged-unchained lines — but NOT a determined local writer who
   > re-chains the WHOLE log with this module's own sha256 after an edit.

   This is **built in** to any local, self-recomputable chain. To close it needs an
   anchor the writer can not make again. CW **can not make that anchor itself** —
   because by design it holds no private key. The one cryptographic anchor that
   is there is the **agent's** telemetry signature, which covers agent-reported
   *usage* — it does **not** cover CW-only decisions (sandbox / policy /
   commit-gate), which have no outside signer.

   For those CW-only decisions, the only stronger guarantee we have today is
   **operational**, not cryptographic: commit `events.jsonl` to an outside
   append-only medium (git history, a remote append-only log) that the local
   writer can not rewrite. The chain is a **clear step up** over a bare
   append-only log — not a thing to use in place of an outside anchor.

4. **It says nothing about the quality, safety, or correctness of the work.**
   Attestation is about *where records come from and the integrity of records*, not about whether
   the agent's output is good, safe, or even working. Other CW parts
   (verifier gate, schema validation, evidence grounding) speak to that; the
   cryptography here does not.

---

## The single-keyholder limitation (stated plainly)

> **The main honest gap:** when the same operator runs CW and holds the only
> verification/signing key, tamper-evidence proves that **records were not changed
> after the fact** — it does **not** prove that the **first signer was
> honest**. Integrity, yes. A source you can trust, not for certain.

To put it plainly, in a single-party setup:

- The operator makes the keypair.
- The operator's agent process signs usage with the private key.
- CW (run by the same operator) verifies with the public key and writes the
  ledger to the operator's disk.

Every cryptographic check can pass while a single party who wants to lie makes up the
source number, or — given the genesis note above — rewrites the whole local
chain. **Cryptography can not make a second party that is not there.**
Separation of duties is the property auditors need everywhere; with one
operator wearing both hats, it is missing by design no matter how good the
math is.

We are not going to talk this point away. It is real, it is the most important
limit in this page, and it is the right point to bring up.

---

## Closing the gap: the second party

The fix is **not** more cryptography on one machine — it is a **separate
second party**, which is just the thing a single operator can not give itself.
This is why CW's near-term aim is **early integration partners**, and what we
mean by that plainly:

- **A separate co-signer / second keyholder.** A second party (a different
  team, a CI identity outside the operator's control, or a partner's signing
  service) holds a key the operator does not. When that party counter-signs runs —
  or *is* the executor that signs usage — a green verdict starts to mean
  "two parties who do not fully trust each other agree," which is the property
  single-party attestation by its nature can not give.
- **An outside append-only anchor.** Pushing `events.jsonl` to a medium the local
  operator can not rewrite (a partner-held log, a public transparency log, signed
  git history on a remote the operator does not control) closes the re-chain gap
  for CW-only decisions named above.
- **Separated execution and verification.** The party that *spends the money*
  (runs the model) and the party that *keeps the books* (CW) being truly
  different bodies turns CW's separation-of-duties design from a plan
  into an enforced fact.

If you are a possible partner who can give a separate second party — a
co-signer, an outside anchor, or separated execution — **that is the
work together we are now looking for.** We would rather ship this honestly
and earn the second party than cover over the gap with a claim that sounds stronger
than the math will back up.

---

## How to verify for yourself

- `cw telemetry verify <run>` — proves the telemetry ledger's **integrity** again:
  chain linkage + a per-record hash worked out on its own, so any change to a
  recorded verdict or usage digest since record time flips it red. It needs **no
  key** (it proves the *recording* again). Add `--pubkey <pem-or-path>` to re-run the
  ed25519 **signature** check for every `attested` record against the stored raw
  usage; keys that can not be read, missing raw usage, digest mismatches, wrong keys, and
  signature mismatches fail closed. Mirrored as `cw_telemetry_verify` on the MCP
  surface.
- `cw demo tamper` — a sealed, offline, one-command proof: it builds a real
  ed25519-signed ledger and then fakes it three ways — flips a recorded verdict and
  works out the *local* record hash again (the chain still breaks), uses a
  signature again over blown-up tokens (ed25519 turns it down), and edits a signed
  finding after signing so the re-derived sha256(result) no longer joins the
  signature (the verify turns it down). Everything is checked with the public key
  only. The `✗ DETECTED` lines are the point.
- Re-run either with **only the public key** on a machine we do not control. If it
  does not come out the same, our integrity claim is false — hold us to it.

---

## One-line summary

CW's cryptography proves **records were not changed and were signed by the
keyholder** — strong, offline, public-key-verifiable **integrity and
attribution**. It does **not** prove the **source was honest**, and a single
operator holding both roles is the honest limit we are openly looking for
integration partners to close.
