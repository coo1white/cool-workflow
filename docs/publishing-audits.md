# Publishing cited audits

How to point Cool Workflow at a repository, produce an evidence-grounded
architecture-risk report, and publish it — **responsibly**. CW's flagship use case is
"auditable code-risk analysis" ([`DIRECTION.md`](../DIRECTION.md)). This guide is the
discipline that keeps a published CW audit trustworthy: every claim resolves to a real
`file:line`, the enforcement boundary is stated honestly, and **real third-party security
findings are coordinated privately, never dropped as public 0-days.**

A committed worked example lives at
[`examples/audits/self-audit-cool-workflow-v0.1.42.md`](../examples/audits/self-audit-cool-workflow-v0.1.42.md)
— a real, line-cited self-audit of this repo. Read it alongside this guide; it is the
template every published audit should follow.

---

## RESPONSIBLE DISCLOSURE — read this first

> **Never publish a real third-party security vulnerability as a public 0-day.**

When you point CW at a repository you do not own and it surfaces an exploitable security
flaw, that finding is **not** a publishable architecture observation — it is a
vulnerability disclosure, and dropping it publicly puts every user of that software at
risk before a fix exists.

**The rule:**

1. **Do not publish.** Keep the finding out of any public report, blog post, gist, PR
   comment, or social post.
2. **Coordinate privately with the vendor/maintainer.** Use their security contact
   (`SECURITY.md`, a security advisory inbox, or a disclosure platform). Provide the cited
   evidence and a reproduction.
3. **Honor an embargo.** A 30–90 day coordinated-disclosure window is the norm; agree on a
   timeline and a credit/CVE plan before anything is public.
4. **Keep a private coordinated-disclosure log.** Track each third-party finding, the date
   reported, the vendor contact, and the embargo end date in a *private* file (e.g.
   `coordinated-disclosure-log.md`, never committed to a public repo and never shipped in
   an audit artifact). Only after the embargo lifts *and* a fix is available may any
   public write-up reference it.
5. **Architecture/quality observations are different.** Non-exploitable design risks,
   maintainability findings, durability gaps, and "this could be hardened" notes on a repo
   you own (or have permission to audit publicly) are fine to publish with cites — that is
   what the self-audit example is.

If you are unsure whether a finding is "an exploitable 0-day" or "an architecture
observation": **treat it as a vulnerability and coordinate privately.** The cost of
over-caution is a delayed blog post; the cost of under-caution is shipping an exploit.

**Do not run CW audits against third-party repositories you have no authorization to
assess**, and do not publish findings about them without the owner's consent and
coordination.

---

## What CW enforces vs. what CW attests (state this in every audit)

A CW audit record is only as trustworthy as the reader's understanding of CW's boundary.
**Every published audit MUST carry an enforcement-boundary disclaimer.** The honest
framing:

- **CW enforces:** worker result-output write acceptance (the lexical + realpath-hardened
  path boundary). That is the dimension CW actually gates in-process.
- **CW attests (does NOT enforce on the default path):** OS read/write/exec, network
  access, and env exposure are *attested to the host* on the `node`/`bun`/`shell`/`remote`/
  `ci` backends. A profile declaring `network:none` produces a record that *reads*
  contained while CW enforced only the write boundary. For real enforcement of those
  dimensions, run under the `container` backend or an OS-level sandbox.
- **CW records but does not verify:** the agent's model id is *self-reported* by the agent
  child; the review/commit separation-of-duties gate is *caller-asserted* (the OS user is
  the trust boundary — **CW is not an auth server**).
- **Evidence is presence-grounded, not proven-correct by default.** The commit gate
  requires evidence to be *machine-shaped* (a `file:line` locator, URL, or
  `namespace:value` token — not free prose). That rejects fabricated prose, but it does
  not, by default, prove the cited line says what the finding claims. Turn on
  `CW_REQUIRE_RESOLVABLE_EVIDENCE=1` to additionally fail closed when a file locator does
  not resolve on disk. **Correctness of the claim is still the human auditor's job** — see
  "Cite-verification methodology" below.

These are not gaps to hide; they are the consequence of CW's "delegate, don't execute /
not an auth server" positioning. The deliverable is an honest record, so **label the
boundary in the report** (the example's "What CW enforces vs. what CW attests" table is
the model). Pair CW with OS-level controls when a restriction must actually be enforced.

---

## Pointing CW at a repo and producing a report

1. **Get authorization.** Audit your own repo, or one you have explicit permission to
   assess. (Do not audit third-party repos without consent.)
2. **Run the architecture-review workflow.** CW dispatches the mapper/assessor lenses to
   your configured agent backend (CW delegates execution — it never runs a model itself),
   and the verifier gate requires grounded evidence before the verdict commits. The
   produced report follows the structure in
   [`examples/sample-architecture-review.md`](../examples/sample-architecture-review.md):
   Short Answer → Ranked Risks → Non-Issues → Recommended Changes → Verification Log.
3. **Curate the raw verdict into a publication.** The raw run output is a starting point,
   not a finished publication. Curate it down to focused, ranked findings, and **re-verify
   every cite by hand** (next section).
4. **Pin to a commit.** Citations drift after refactoring. Record the exact commit hash
   and package version in the report header, and re-audit after any major version.

---

## Cite-verification methodology (the part that makes it trustworthy)

A published audit's value is that **every claim resolves to a real line of code that says
what the finding says.** Verification is three layers:

1. **Existence** — every `file.ts:NNN` (or `file.ts:NNN-MMM`) locator names a file that
   exists at the pinned commit. Mechanizable; see the script below.
2. **Line-presence** — the cited line number is within the file's length, and (spot-check)
   the line's content matches the finding's description. Partly mechanizable, partly human.
3. **Claim-correctness** — the cited code actually *does* what the finding says
   (semantics, not just text). **Human-only.** This is why CW's evidence gate is honestly
   described as *presence-grounded, not proven-correct*: the gate keeps fabricated prose
   out, but a reviewer must confirm the cited line supports the claim.

**Do this before publishing:**

- Extract every cite pattern from the report and confirm existence + in-range line numbers
  with the script in [`docs/scripts/verify-audit-cites.sh`](scripts/verify-audit-cites.sh).
- Spot-check ≥5 of the highest-severity cites by hand: open the line, confirm the code
  matches the finding's words. The example's P1-1 is the model — it names
  `worker-isolation.ts:622` *and* states exactly what that line does
  (`validateSandboxWrite` only).
- Cross-reference the commit hash in the header against `git rev-parse HEAD`.
- Run the regression suite that covers any "resolved" findings you reference
  (`cd plugins/cool-workflow && npm test`) so "this was fixed" claims stay true.

---

## Citations go stale — pin and re-audit

Line numbers move with every refactor. The v0.1.38/v0.1.39 verdicts that seeded the
self-audit example had **multiple stale cites and several findings that were since fixed**
by the time the v0.1.42 example was curated (e.g. the non-atomic-write P1 and the
presence-only-evidence P1 are both resolved). That is the normal lifecycle, not a failure
— it is exactly why:

- **Pin every audit to a commit hash + package version** in the header.
- **Re-run the verification script** against the pinned commit before each republish.
- **Re-audit after any major version**, and explicitly list findings that were resolved
  since the prior audit so a reader cross-referencing the old report does not re-flag them
  (the example's "Resolved since prior verdicts" section).

---

## Template for a future audit

Reuse the structure of
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

**Cite-grounding requirements for every finding:**

- Severity P0/P1/P2 → MUST carry at least one grounded locator (`file:line`, URL, or
  `namespace:value` token). This mirrors CW's own commit gate (`evidence-grounding.ts`),
  which rejects bare prose.
- The locator MUST resolve at the pinned commit (run the verify script).
- The finding text MUST describe what the cited line *does*, not just point at it — so a
  reader can confirm claim-correctness.
- Security-relevant findings on third-party code → **do not publish; coordinate privately**
  (see the disclosure section above).
