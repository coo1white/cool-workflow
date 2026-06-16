# Publishing cited audits

How to point Cool Workflow at a repository, make an evidence-grounded
architecture-risk report, and put it out — **with care**. CW's chief use is
"auditable code-risk analysis" ([`DIRECTION.md`](../DIRECTION.md)). This guide is the
discipline that keeps a put-out CW audit one to be trusted: every claim comes back to a true
`file:line`, the enforcement boundary is given straight, and **true other-party security
findings are worked out in private, never let out as public 0-days.**

A committed worked example is at
[`examples/audits/self-audit-cool-workflow-v0.1.42.md`](../examples/audits/self-audit-cool-workflow-v0.1.42.md)
— a true, line-cited self-audit of this repo. Read it together with this guide; it is the
template every put-out audit is to keep to.

---

## RESPONSIBLE DISCLOSURE — read this first

> **Never put out a true third-party security weak point as a public 0-day.**

When you point CW at a repository you do not own and it makes clear a security
hole that may be used for attack, that finding is **not** an architecture note you may put out
— it is a weak-point disclosure, and letting it out in public puts every user of that software at
risk before a fix is there.

**The rule:**

1. **Do not put it out.** Keep the finding out of any public report, blog post, gist, PR
   comment, or social post.
2. **Work it out in private with the vendor/maintainer.** Use their security touch point
   (`SECURITY.md`, a security advisory inbox, or a disclosure platform). Give the cited
   evidence and a way to make it come about again.
3. **Keep to an embargo.** A 30–90 day coordinated-disclosure window is the common way; come to agreement on a
   time line and a credit/CVE plan before anything is public.
4. **Keep a private coordinated-disclosure log.** Keep track of each third-party finding, the date
   sent in, the vendor touch point, and the embargo end date in a *private* file (e.g.
   `coordinated-disclosure-log.md`, never committed to a public repo and never put into
   an audit artifact). Only after the embargo is lifted *and* a fix is there may any
   public write-up point to it.
5. **Architecture/quality notes are not the same.** Design risks that may not be used for attack,
   maintainability findings, durability gaps, and "this could be hardened" notes on a repo
   you own (or have leave to audit in public) are all right to put out with cites — that is
   what the self-audit example is.

If you are not certain a finding is "a 0-day open to attack" or "an architecture
note": **take it as a weak point and work it out in private.** The price of
over-care is a slow blog post; the price of under-care is putting out a way to attack.

**Do not run CW audits against third-party repositories you have no leave to
look over**, and do not put out findings about them without the owner's agreement and
joint work.

---

## What CW enforces vs. what CW attests (state this in every audit)

A CW audit record may be trusted only as far as the reader has a grip on CW's boundary.
**Every put-out audit MUST carry an enforcement-boundary disclaimer.** The straight
way to put it:

- **CW enforces:** worker result-output write acceptance (the lexical + realpath-hardened
  path boundary). That is the dimension CW in fact gates in-process.
- **CW attests (does NOT enforce on the default path):** OS read/write/exec, network
  access, and env exposure are *attested to the host* on the `node`/`bun`/`shell`/`remote`/
  `ci` backends. A profile that says `network:none` makes a record that *reads*
  shut in while CW enforced only the write boundary. For true enforcement of those
  dimensions, run under the `container` backend or an OS-level sandbox.
- **CW records but does not verify:** the agent's model id is *self-reported* by the agent
  child; the review/commit separation-of-duties gate is *caller-asserted* (the OS user is
  the trust boundary — **CW is not an auth server**).
- **Evidence is presence-grounded, not proven-correct by default.** The commit gate
  needs evidence to be *machine-shaped* (a `file:line` locator, URL, or
  `namespace:value` token — not free prose). That keeps out made-up prose, but it does
  not, by default, give proof that the cited line says what the finding claims. Turn on
  `CW_REQUIRE_RESOLVABLE_EVIDENCE=1` to in addition fail closed when a file locator does
  not resolve on disk. **Whether the claim is right is still the human auditor's job** — see
  "Cite-verification methodology" below.

These are not gaps to keep out of view; they come from CW's "delegate, don't execute /
not an auth server" position. What you get is a straight record, so **mark the
boundary in the report** (the example's "What CW enforces vs. what CW attests" table is
the model). Put CW together with OS-level controls when a limit has truly to be enforced.

---

## Pointing CW at a repo and producing a report

1. **Get leave.** Audit your own repo, or one you have clear leave to
   look over. (Do not audit third-party repos without agreement.)
2. **Run the architecture-review workflow.** CW sends the mapper/assessor lenses to
   your set-up agent backend (CW delegates execution — it never runs a model itself),
   and the verifier gate needs grounded evidence before the verdict commits. The
   report it makes keeps to the structure in
   [`examples/sample-architecture-review.md`](../examples/sample-architecture-review.md):
   Short Answer → Ranked Risks → Non-Issues → Recommended Changes → Verification Log.
3. **Make the raw verdict into a put-out work.** The raw run output is a starting point,
   not a finished put-out work. Cut it down to sharp, ranked findings, and **check
   every cite again by hand** (next part).
4. **Pin to a commit.** Citations move out of place after refactoring. Put down the exact commit hash
   and package version in the report header, and audit again after any major version.

---

## Cite-verification methodology (the part that makes it trustworthy)

A put-out audit's worth is that **every claim comes back to a true line of code that says
what the finding says.** Verification has three layers:

1. **Existence** — every `file.ts:NNN` (or `file.ts:NNN-MMM`) locator names a file that
   is there at the pinned commit. A machine can do it; see the script below.
2. **Line-presence** — the cited line number is inside the file's length, and (spot-check)
   what the line says is the same as the finding's account of it. In part a machine can do it, in part a human.
3. **Claim-correctness** — the cited code in fact *does* what the finding says
   (sense, not just text). **Human-only.** This is why CW's evidence gate is straight-up
   named as *presence-grounded, not proven-correct*: the gate keeps made-up prose
   out, but a reviewer has to make sure the cited line backs up the claim.

**Do this before putting it out:**

- Take out every cite pattern from the report and make sure of existence + in-range line numbers
  with the script in [`docs/scripts/verify-audit-cites.sh`](scripts/verify-audit-cites.sh).
- Spot-check ≥5 of the highest-severity cites by hand: open the line, make sure the code
  is the same as the finding's words. The example's P1-1 is the model — it names
  `worker-isolation.ts:622` *and* says just what that line does
  (`validateSandboxWrite` only).
- Cross-reference the commit hash in the header against `git rev-parse HEAD`.
- Run the regression suite that covers any "resolved" findings you point to
  (`cd plugins/cool-workflow && npm test`) so "this was fixed" claims keep being true.

---

## Citations go stale — pin and re-audit

Line numbers move with every refactor. The v0.1.38/v0.1.39 verdicts that were the seed of the
self-audit example had **a number of stale cites and several findings that had since been fixed**
by the time the v0.1.42 example was put together (e.g. the non-atomic-write P1 and the
presence-only-evidence P1 are both resolved). That is the normal way of things, not a let-down
— it is just why:

- **Pin every audit to a commit hash + package version** in the header.
- **Run the verification script again** against the pinned commit before each new put-out.
- **Audit again after any major version**, and clearly list findings that were resolved
  since the audit before so a reader cross-referencing the old report does not flag them again
  (the example's "Resolved since prior verdicts" section).

---

## Template for a future audit

Use again the structure of
[`examples/audits/self-audit-cool-workflow-v0.1.42.md`](../examples/audits/self-audit-cool-workflow-v0.1.42.md):

```
<!-- header: what produced it, repo @ <commit>, package version, agent-reported model -->
# <Subject> Audit (<version>)

> What this is / findings verified against the tree / cites pinned to <commit>.

## Scope                  (repository, subject, stated invariants under test)
## Short answer           (P0? overall verdict in 3-5 sentences)
## Ranked risks           (real P1s first; each names an exact file:line and says what it does)
## P2 / P3
## Resolved since prior   (findings now fixed — do NOT re-flag; cite the fix)
## Non-issues             (correctly classed within the threat model)
## What CW enforces vs. attests   (the enforcement-boundary disclaimer — REQUIRED)
## Recommended changes    (priority order)
## Verification log       (table: risk | classification | evidence (file:line) | notes)
## Reproduce              (checkout commit, run verify script, run npm test)
```

**What cite-grounding every finding has to have:**

- Severity P0/P1/P2 → MUST carry at least one grounded locator (`file:line`, URL, or
  `namespace:value` token). This is like CW's own commit gate (`evidence-grounding.ts`),
  which keeps out bare prose.
- The locator MUST resolve at the pinned commit (run the verify script).
- The finding text MUST give an account of what the cited line *does*, not just point at it — so a
  reader can make sure the claim is right.
- Security-related findings on third-party code → **do not put out; work out in private**
  (see the disclosure part above).
