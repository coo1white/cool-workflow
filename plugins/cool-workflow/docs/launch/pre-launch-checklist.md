# Pre-Launch Checklist — Cool Workflow Show HN

Tick top to bottom; when it's done, post. The one non-negotiable gate is ③.
Copy for the post itself lives in [launch-kit.md](launch-kit.md) (the **✅ FINAL**
block).

## ① Fix the machine (prerequisite)

- [ ] **Reboot the Mac** — clears the leaked ptys (`kern.tty.ptmx_max` was 511 with
      527 allocated), so Terminal / VS Code can spawn shells again. Required before
      the verification below.

## ② Prepare assets (optional, recommended)

- [ ] Install [vhs](https://github.com/charmbracelet/vhs) (`brew install vhs`).
- [ ] Record the GIF: `vhs plugins/cool-workflow/docs/launch/demo.tape` →
      `docs/launch/demo-tamper.gif`.
- [ ] Swap it into the README hero (replace the fenced demo output block with
      `![demo](plugins/cool-workflow/docs/launch/demo-tamper.gif)`), commit + push.
  > Shippable without the GIF — the README's text `✗ DETECTED` hook already stands;
  > the GIF is upside, not a blocker.

## ③ Verify — the make-or-break gate (do not skip)

- [ ] On a **clean machine / fresh terminal**: `npx cool-workflow demo tamper`
      prints `VERDICT: tamper-evidence holds ✓`.
  > Every click from HN runs this. One crash wastes that traffic. This is the only
  > non-negotiable check.
- [ ] Sanity: `npx cool-workflow quickstart architecture-review --repo . --question "risks?"`
      → `status: blocked` with no agent configured (fails closed, no crash).

## ④ Post (US morning, ~9–11am ET is peak)

- [ ] Open the **✅ FINAL** block in [launch-kit.md](launch-kit.md).
- [ ] HN title: `Show HN: Cool Workflow – tamper-evident telemetry for agent pipelines (npx demo)`
- [ ] URL field: `https://github.com/coo1white/cool-workflow`
- [ ] Immediately after posting, paste the FINAL "first comment" as the first reply.

## ⑤ First hour (decides the outcome)

- [ ] Watch and reply fast — early engagement weighs most on HN.
- [ ] On the "single key holder / no second party" critique (the audit flagged it
      too): concede it honestly and frame it as exactly why you're looking for early
      integration partners. **Turn the critique into an invitation; don't argue.**
  > The canned, linkable answer is already written: [docs/trust-model.md](../trust-model.md)
  > states the ceiling plainly (integrity ≠ source honesty; one party holding both
  > roles; full local re-chain) and frames the partner ask. Link it; don't re-argue it.
- [ ] No vote-rigging, no asking friends to upvote, no deleting critical comments —
      HN's anti-abuse will sink the post.

---

### Go / no-go

> If **③ — `npx cool-workflow demo tamper` prints `✓` on a clean machine** — passes,
> you can post. Everything else is upside.
