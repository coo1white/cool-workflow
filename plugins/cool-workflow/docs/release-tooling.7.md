# Release Tooling

CW v0.1.33 adds Release Tooling: the mechanical, do-it-again part of cutting a tag
becomes three deterministic scripts plus a de-duplicated release gate. Before
v0.1.33 a release meant changing the version by hand across ~17 surfaces and making
the same doc/test/CHANGELOG shapes by hand — slow, and the cause of stale-version
gate failures. This release leaves the kernel runtime untouched and moves the hard
work into tooling, so an author gives time to the feature, not the boilerplate.

The way of working is the same base-system separation used in other places: there is one
source of truth, and the mechanical surfaces are DERIVED from it, fail-closed.

## bump:version

```text
node scripts/bump-version.js <new-version>
npm run bump:version -- 0.1.33
```

One command rewrites every STRUCTURED version surface from a single source
(`package.json`): `package.json`, `src/core/version.ts`,
`manifest/plugin.manifest.json` (then `gen:manifests` sends it on to the vendor
manifests), every `apps/*/app.json` (top-level `version` only, never
`compatibility.minVersion`), and the scripts/tests that fix the current
version in code as a current-version reference. The version string is changed with a
TARGETED `old -> new` replace, so older references (a past `minVersion`, a
`pre-vX` note, a fixed demo version) are kept. It then builds `dist/` again, runs
`version:sync`, and reports the prose-doc surfaces that are left.

`version-sync-check.js` reads the looked-for version from `package.json`, so the
checker can never get out of step with the bump source.

## new:feature

```text
node scripts/new-feature.js <slug> "<Title>" ["summary"]
```

Builds the per-tag boilerplate frame: the `docs/<slug>.7.md` skeleton and a
runnable `test/<slug>-smoke.js` stub, then PRINTS the exact
gate-file edits (capability registry, `version:sync` assertions, the `docs presence`
list, the `npm test` chain). Gate files are printed, never changed on their own, so a
new frame can never quietly break a release gate.

## forward-ref

```text
node scripts/forward-ref-docs.js "<Title>" "<summary>"
```

Adds a `## <Title> (vX)` forward-reference section at the end of every doc `version:sync`
needs to carry the current version (the repo's per-release documentation
pattern). APPEND-ONLY and idempotent: it never rewrites an older version label
and running it again for the same version does nothing.

## De-duplicated release:check

`release:check` before this ran `npm test` AND then ran ~15 of those same smoke
tests again one by one (plus extra `eval:replay`/`fixture-compat` re-runs). Every
single step is already covered by `npm test`, so they were taken out — the gate
keeps full coverage while cutting the doubled wall time. The steps that stay
are the ones NOT covered by `npm test`: build, type check, `npm test`,
canonical-apps, golden-path, parity, vendor-manifest drift, and `version:sync`.

The drift gates `index:check` (`docs/project-index.md`) and `readme:check`
(`plugins/cool-workflow/README.md`) also run here. The npm package README is
GENERATED from the repo-root `README.md` by `scripts/sync-readme.js` — it changes
only the relative image/link URLs npm cannot render (`docs/assets/*` to
`raw.githubusercontent.com`, `](LICENSE)`/`](plugins/...)` to `.../blob/main/...`),
so the npm page and the GitHub page stay identical. Edit the GitHub `README.md`,
then run `npm run sync:readme`; `readme:check` fails the gate if they drift. The
teeth live in `test/readme-sync-smoke.js`.

For timing work, the smoke runner can write a JSON timing report without changing
the normal output:

```text
npm run test:ci -- --json-summary /tmp/cw-test-summary.json
```

The file lists wall time, total child time, and the slowest smokes. Use it to
pick one speed cycle at a time; it is diagnostic, not a hard release threshold.

The dogfood release smoke and the architecture-review dogfood smoke are separate
test files. The split keeps the same release and agent-drive proof, but lets
`test:ci` schedule the two long checks in parallel.

## citation:check

```text
npm run citation:check
```

This is the `doc citation freshness` step in `release:check`. It makes sure
every file name that a doc, or a line of code, points at is a real file in
the tree. It checks three things: a bare name like `<name>.ts` in a doc
must match some real file's name under `src/`, `scripts/`, `test/`, or
`apps/`;
every line of `src/**/*.ts` and `scripts/**/*.js` — code and comments alike
— must name only files that exist; and the same check runs on
`test/**/*.js`, but only on `//` comment lines, since a test's fixture
strings use made-up paths on purpose. A file name with a `:line` number
fails on its own — line numbers go stale fast, and a file name does not.
It also refuses a stale cut-over-audit marker phrase (case-insensitive,
whole-phrase) anywhere in `src/`, `scripts/`, or `test/` — the kind of
"this test is RED on purpose" comment that outlives the gap it once named.

## growth:check

```text
npm run growth:check
```

Fail-closed gate over `manifest/growth-budget.json`: a ceiling on git-tracked
`.md` file count repo-wide, and a ceiling on comment-line count under
`plugins/cool-workflow/src`. Both counts come from `git ls-files`, so tracked
files only — never untracked or ignored ones — and a run is reproducible by
hand: `git ls-files | grep -c '\.md$'` for the `.md` count, and, for the
comment count, read every tracked file under `plugins/cool-workflow/src` and
count lines whose first non-space chars are `//` or `*`.

Ceilings are the measured count at the time they were set, plus about 5%
headroom. Over budget fails closed (exit 1) with a message that asks for a
conscious choice: slim something else first (delete a stale `.md`, cut a
narrating comment) — always a valid way to pay for growth — or raise the
ceiling in `manifest/growth-budget.json` with the freshly measured number
written into the commit message, not only the new cap. Teeth live in
`test/growth-budget-check-smoke.js`.

## PR CI Merge Notes

When a PR is ready, list open PRs by creation time and merge the oldest ready
one first. After each merge, check the next PR again; a new main commit may make
it need a rebase.

If main moved after the PR branch was made, replay the PR commits on top of the
new main in a clean worktree. Keep local unrelated changes out of the rebase and
out of the PR.

Treat CI as the source of truth for what blocks the merge. Read the failed step
first, fix only that drift, then push again. A common drift is the npm README:
when `readme-sync-smoke.js` says the package README is stale, run
`npm run sync:readme`, add only `plugins/cool-workflow/README.md`, and let CI run
again.

## Boundary

Release Tooling touches only the build/release surfaces. It adds no runtime
capability, no CLI/MCP verb, and no run-state schema change; the kernel is
unchanged. Older releases cut by hand are still good — the scripts only make
the mechanical surfaces a tag must update the same each time.

## See Also

cli-mcp-parity(7), release-and-migration(7), dogfood-one-real-repo(7)

## Real Execution Backend Integrations (v0.1.34)

container/remote/ci backends really run (docker/podman run, remote/CI POST-and-poll) under the sandbox contract, with byte-stable evidence next to node and fail-closed refusal when a runtime/endpoint is not there. See real-execution-backends(7).

## Node Snapshot / Diff / Replay (v0.1.35)

per-node snapshot, structural diff, and isolated deterministic replay over StateNode, reusing the v0.1.23 eval harness; fail-closed on source drift (valid|stale|absent). See node-snapshot-diff-replay(7).

## Contract Migration Tooling (v0.1.36)

first-class declared migration registry (run-state + workflow-app) with per-edge compatibility proofs, fail-closed reachability, and a round-trip/non-destruction prover. See contract-migration-tooling(7).

## Control-Plane Scheduling (v0.1.37)

priority + concurrency limits + lease lifecycle + retry/backoff + fail-closed park over the v0.1.28 Run Registry queue; policy-as-data, deterministic. See control-plane-scheduling(7).

## Agent Delegation Drive (v0.1.38)

spawn an external agent process per worker, capture result.md + attestation, auto-drive plan->dispatch->fulfill->accept->commit

## Run Retention & Provable Reclamation (v0.1.39)

tiered, append-only, cryptographically-verifiable run reclamation: seal the audit skeleton, free the reconstructable bulk, prove it

## Durable State & Locking (v0.1.40)

atomic temp->rename writes + fsync-durability for authoritative stores; portable stale-stealing file lock serializing the cross-process read-modify-write stores

## Self-Audit Hardening & Pure-Router Decomposition (v0.1.41)

evidence grounding + durable audit append + symlink-hardened containment + deterministic worker ids + recursive redaction; BackendRegistry self-describing drivers (no per-id switches); orchestrator god-object decomposed into per-domain operation modules (pure loadRun->delegate router)

## Robust Result Ingest (v0.1.42)

capture findings/evidence from any fair agent shape (alt keys + prose), CW works out grounded evidence itself, warn on empty capture — closes the v0.1.41 live-drive 'accepted with 0 captured' failure

## No-False-Green Gate & Launch Prep (v0.1.43)

Hard gate blocking empty-capture verifier-gated commits, plus quickstart and launch-prep docs.

## Release-Gate Determinism & Agents Vendor (v0.1.44)

Release-readiness checks now check the committed blob (`git show HEAD:<path>`) and not the changeable working tree — taking away false-red/false-green from working-tree writes at the same time (iCloud/Spotlight/editor). Adds the `agents` vendor manifest target: a generated `.agents/plugins/cool-workflow/` adapter giving any non-Claude AI agent one shared way in to CW.

## P1-P2 Fixes & CI Content Surfaces (v0.1.49)

Migration DAG with reversible edges (v0.1.45), capability auto-discovery (v0.1.46), vendor-adapter registry (v0.1.47), state auto-compaction and P2 fixes (v0.1.48), plus CI content-surface determinism hardening (v0.1.49).

## Multi-platform release flow (`scripts/release-flow.js`)

The gated release ritual — deterministic gate → independent reviewer → verdict →
(tag) — is now ONE zero-dependency Node orchestrator that runs the same under any
harness. It does not lean on a host's agent-orchestration primitive; the only
LLM step (the reviewer) is **delegated** through CW's agent backend, so whichever
model you set up does the review. CW starts the agent argv-style (`shell:false`),
takes on the agent's own credentials, and pulls in no model SDK — the red line.

The control plane runs the deterministic gate once. It keeps a failed child
command's short tail on stderr for the operator, but never puts that tail in a
saved verdict. The reviewer does not run that gate again. It checks judgment
questions the gate cannot check. A reviewer rejection has exact `REJECTED`,
`kind: semantic-review`, and numbered facts with repo-relative `file:line`
places. Other rejection text is invalid reviewer output: the cut stops, no tag
is made, and it is not a verified code rejection.

```bash
# the operator's one-command release (scripts/release-oneclick.js — preflight,
# gated cut, tag-only push, CI wait, npm confirmation, verdict-record PR):
npm run release -- 0.2.4
# fast preflight first (seconds, no tests; release runs the same checks first):
npm run release:doctor -- 0.2.4
# check only (gate + independent review, no mutation):
node plugins/cool-workflow/scripts/release-flow.js --check
# the same, with the full test suite run on this machine (CI cannot be reached):
node plugins/cool-workflow/scripts/release-flow.js --check --local-tests
# cut a tag once review is green (when --push, also creates the GitHub Release):
node plugins/cool-workflow/scripts/release-flow.js --cut --version 0.1.77 [--push] [--no-release]
# run ONLY the cut's fail-fast preflight (seconds; used by release-oneclick.js):
node plugins/cool-workflow/scripts/release-flow.js --cut --version 0.1.77 --push --preflight-only
# backfill / re-create the GitHub Release for an already-pushed tag (no gate/cut):
node plugins/cool-workflow/scripts/release-flow.js --release --version 0.1.77 [--soft]
```

A `--cut` starts with a fail-fast **preflight** (added after the v0.2.3 cut,
where each of these fired only AFTER the gate/vendor/reviewer had already
spent real time and tokens): the version flag, the signing key (present AND
matching the committed `verdict-signing.pub` — once that pubkey is in the
repo, an unsigned cut is refused up front instead of failing later in CI),
no pre-existing `vX.Y.Z` tag (local or on origin), a clean tracked tree,
and — for `--push` — HEAD equal to the
`origin/main` tip (`--allow-stale-head` skips that one check for a
deliberate re-cut). The push at the end moves ONLY `refs/tags/vX.Y.Z`: the
verdict commit is a one-hop leaf on the reviewed commit, reachable through
the tag alone, so main's branch protection is never in the path and no
stray remote branch is created.

### The gate's test step: the green CI checks on the reviewed commit

(New default from 0.3.1; the operator's yes is in
`project/docs/intent/2026-10-16-release-gate-ci.md`.)

The gate (`scripts/release-gate.js`) has five steps: build, tests,
substance, test evidence, branch naming. By default `release-flow.js` (and
so `npm run release`) runs the gate as `release-gate.js --tests-from-ci`:
the tests step does NOT run `npm run test:gate` on the operator's machine.
It reads GitHub's check runs for the exact HEAD sha
(`gh api repos/<owner>/<repo>/commits/<sha>/check-runs`, owner and repo from
the `origin` remote) and passes only when every required check is there,
made by GitHub Actions for that sha, `completed`, with conclusion
`success`. The required checks are the ones `main`'s branch protection
requires, `check (18)` and `check (22)` (the ubuntu legs of `ci.yml`'s
`check` job). They are named in one place, `REQUIRED_CHECKS` in
`scripts/release-ci-checks.js`, and `test/ci-shape-gate-smoke.js` fails when
a name there is not a leg of that job. The other four steps still run
locally; they take seconds.

It fails closed. A check that is missing, queued, in progress, failed,
cancelled, skipped or timed out; two runs of one check where one is not
green; a `gh` that is not installed, not logged in, or gives an error; an
`origin` that is not on github.com; a reply that is not JSON — each one
fails the gate with the reason and its fix (wait for CI, push the commit,
fix the red check in a normal PR), and nothing falls back to a local run.
On a pass the gate writes `.cw-release/gate-ci-<sha>.json` (not tracked)
with the checks and their run URLs. `release-flow.js` takes it back, fails
closed when it is missing or does not show every required check green on
HEAD, and puts the mode and the run URLs into the reviewer input. Its last
JSON object gets a `gateTests` key: `ci`, `local`, or `override` (the gate
was replaced by `CW_RELEASE_FLOW_GATE_CMD`).

`npm run release -- X.Y.Z` first waits, in its cut stage, for the required
checks on the cut commit (deadline 45 minutes): a bump PR merged a minute
earlier has its `main` CI still running. A red check stops the release
there, before the gate.

The old way is an opt-in, for when CI cannot be reached:

```bash
node scripts/release-flow.js --cut --version X.Y.Z --push --local-tests
npm run release -- X.Y.Z --local-tests
CW_RELEASE_LOCAL_TESTS=1 npm run release -- X.Y.Z
```

With it, the gate runs the full `test:gate` suite here, as before 0.3.1,
and GitHub is not asked. `release-gate.js` run by hand, with no flag, is
also unchanged: the tag-push gate in `release.yml` runs the full suite in
CI. Test seam: `CW_RELEASE_GATE_GH_CMD` puts a stub in place of the `gh`
binary the gate runs (spawned `shell:false`).

### release:doctor

```text
npm run release:doctor [-- X.Y.Z] [--json] [--offline]
node scripts/release-doctor.js [X.Y.Z] [--json] [--offline]
```

A fast release preflight: a few seconds, no test suite, no gate, no
reviewer, no model, and no change to anything. It gives ALL the problems in
one run, each with the exact command that puts it right, so a cut does not
come to a stop late, one problem at a time, after a 10-minute gate. The
version is by default the one in `plugins/cool-workflow/package.json`.

| Check | Fails when | Fix it gives |
|---|---|---|
| `head-current` | after `git fetch origin main`, HEAD is not the `origin/main` tip (names both shas and the current branch) | `git checkout main && git pull --ff-only origin main` |
| `cut-branch` | a local `release/vX.Y.Z-cut` branch is not at `origin/main` (old code from an earlier cut) | `git branch -D release/vX.Y.Z-cut` (never deleted for you) |
| `clean-tree` | `git status --porcelain -uno` is not empty | commit or stash |
| `cw-dir` | (warning) a `.cw/` folder is at the repo root | `rm -rf <repo>/.cw` |
| `reviewer` | the reviewer config `release-flow.js` reads (`CW_AGENT_COMMAND` > `agent-config.json` > auto-detect; else `CW_AGENT_ENDPOINT`) is not set, or its first argv token is not an executable file (a full path, or on `PATH`); the reviewer is never run | `export CW_AGENT_COMMAND=...` |
| `signing-key` | `.cw-release/verdict-signing.pub` is committed and `CW_RELEASE_VERDICT_PRIVKEY` is not set, or is not a readable regular file (the key is never read or printed) | `export CW_RELEASE_VERDICT_PRIVKEY=~/.cw-keys/verdict-signing.key` |
| `git-identity` | `user.email` is not set; a warning when it is not a `@users.noreply.github.com` address (GitHub may say no to the push with GH007) | `git config user.email "<id>+<login>@users.noreply.github.com"` |
| `gh` | (warning) `gh auth status` fails — the GitHub Release then falls back to CI's auto-generated notes | `gh auth login` |
| `tag-local`, `tag-remote` | (warning for the doctor) `vX.Y.Z` is there already — `npm run release -- X.Y.Z` takes up that cut again at stage 3 | — |
| `tools` | (info) node and npm versions | — |

Diagnostics go to stderr. `--json` puts one stable object on stdout:
`{ ok, mode, version, failures, warnings, checks: [{ id, status, message, fix?, detail? }] }`,
where `status` is `ok`, `info`, `warn` or `fail`. The exit code is 0 when no
check fails (warnings are allowed) and 1 when one does. `--offline` does not
do the fetch, the `ls-remote` and the `gh` check.

`npm run release -- X.Y.Z` runs the same checks FIRST, in its stage 0 (the
code is one file, `scripts/release-preflight.js`, used by the doctor, by
`release-oneclick.js`, and by `release-flow.js --cut`'s own preflight), and
stops before anything is done when one fails, with only the problem lines on
stderr. Two differences there: a `vX.Y.Z` tag that is already there is never
seen by stage 0 (the resume goes straight to stage 3), and an old
`release/vX.Y.Z-cut` branch is only a warning, because the cut stage makes
it again from `origin/main` (`git checkout -B`). `--dry-run` keeps stage 0
offline.

After the review, and before it bumps or stages anything, the cut checks the
tracked tree again. The preflight made sure it was clean, so a change now came
from the gate or the reviewer (a vendor CLI that auto-approves its tools can
edit files). The cut stops, names the files, and signs nothing.

The per-platform difference is config, not code — set the reviewer agent here:

| Platform | Reviewer config |
|---|---|
| Claude    | `CW_AGENT_COMMAND="claude -p --permission-mode acceptEdits {{input}}"` |
| Codex     | `CW_AGENT_COMMAND="codex exec {{input}}"` |
| Gemini    | `CW_AGENT_COMMAND="gemini -p {{input}}"` |
| OpenCode  | `CW_AGENT_COMMAND="opencode run -m <provider/model> {{input}}"` |
| DeepSeek  | via OpenCode (`-m deepseek/deepseek-v4-flash`) or `CW_AGENT_ENDPOINT=<deepseek-compatible HTTP agent>` |

The reviewer's last act is to **write** the verdict file, so a headless agent
needs file-write permission. For `claude -p`, recent CLIs default to a mode that
silently denies `Write` (no prompt in headless mode), so the reviewer reaches a
verdict but cannot persist it and the flow fails closed at `[3/3] verify` with
`no verdict written`. The `--permission-mode acceptEdits` flag in the preset above
fixes this; Read/Bash (which the review itself needs) keep working. The reviewer
CLI must also be logged in (`claude auth login` / `claude auth status` →
`loggedIn: true`) — a fresh shell or CI runner is not.

When the reviewer exits non-zero, the flow stops with `reviewer agent exited
<code> — no verdict trusted.` and then prints the last 20 lines the reviewer
wrote to stdout (or says it wrote nothing). A vendor CLI such as `claude -p`
puts its own error there — not logged in, a usage limit, a bad flag — so that
line is the reason for the stop.

The reviewer prompt (`agents/release-reviewer.md`) holds POLA strictly, with
one exception: a default change the operator chose. The reviewer takes it
only when all three hold, each checked by the reviewer in the diff range:
an intent file under `project/docs/intent/` has the operator's own words and
a date for that change; the matching `docs/*.7.md` says the new default in
the same range; and the release raises the version (on 0.x a patch raise is
enough, 0.3.0 to 0.3.1; from 1.0, the major version). If one is missing, the verdict is REJECTED.

`{{input}}` is put in place of the reviewer prompt file path. Gemini and OpenCode
also get generated MCP manifests (`.gemini-plugin/`, `.opencode-plugin/`) so the
`cw_*` tools are there as MCP tools in those hosts. The verdict path
(`.cw-release/review-<sha>.verdict`) and the tag-push CI backstop are unchanged.

### GitHub Release finishing step

A `--cut --push` ends by creating the **GitHub Release** for the tag, and
`--release --version x.y.z` creates-or-skips one for an already-pushed tag
(backfill). The notes body is put together from the independent reviewer's
one-line capability and a "Provenance & audit" footer linking the reviewed
commit, the **committed** reviewer verdict, the full diff, and the
provenance-attested npm version. There is no CHANGELOG.md in the tree now, so
new tags get no CHANGELOG body. Only for an old tag, cut when that file was
still in the tree, is the `## x.y.z` CHANGELOG section, as it was at that tag,
put into the notes as well.

This step is **distribution upside, not a correctness gate**: the load-bearing
artifacts (the tag and the provenance-attested npm publish) are there already when it
runs. So `gh` is **not** part of the node/git portability floor — it runs
ONLY in the human `--cut --push` / `--release` paths (never a gate or CI path) and
is **idempotent** (skips if the Release is there already).

Failure behavior is not the same by mode: in the **`--cut --push` finishing step** an
absent/unauthenticated/erroring `gh` **skips with a stderr note and never fails the
cut** (the tag and npm publish stand) — opt out fully with `--no-release`. In the
clear **`--release` backfill** it **fails closed** (exit 1) with guidance, since
the operator asked for it straight; add `--soft` to bring `--release` down to the same
best-effort skip-not-fail behavior.

Honesty: the notes claim the gated flow ("independent release-reviewer, verdict
above") **only when a committed `APPROVED` verdict is found at the tag**; backfilling
an ungated tag gives a plain caveat instead and warns on stderr — the notes never
claim a review that is not there. Test seam: `CW_RELEASE_FLOW_GH_CMD` puts a stub in place of the `gh`
binary (spawned `shell:false`) so the smoke runs it offline.

### CI release rehearsal

The `release-rehearsal` job in `.github/workflows/ci.yml` goes through the
release flow on every PR that changes release tooling (`scripts/release-*.js`,
`scripts/verify-*.js`, `scripts/dogfood-release.js`, `scripts/bump-version.js`,
`test/run-all.js`, `package.json`, `.cw-release/`, `release.yml`,
`npm-publish.yml`, `ci.yml`, `agents/release-reviewer.md`, or its stub
reviewer), on a PR or on a push to `main`, so a break comes to light in CI, not
on the operator's machine in a real cut. It runs on Node 24 two times: with
the npm that comes with Node 24, and with the newest npm (npm 12 made a
change to `npm pack --json` that broke the release check in a real cut). The
steps, with cwd `plugins/cool-workflow`:

```bash
npm run build
npm run version:sync
CW_AGENT_COMMAND="node plugins/cool-workflow/test/fixtures/release-rehearsal-reviewer.js {{input}}" \
  node scripts/release-flow.js --check --local-tests
node scripts/dogfood-release.js --smoke
```

`--check --local-tests` runs the full deterministic gate (build, `test:gate`, substance,
test evidence, branch naming; on a PR the branch name is `GITHUB_HEAD_REF`),
then the reviewer spawn and the verdict check. The reviewer is a stub that
gives `APPROVED <HEAD>` and fails closed on a bad prompt file; it is never
a real review. The job has no signing key and does no tag, push, or
publish. It does not run the `--cut` preflight: with
`.cw-release/verdict-signing.pub` committed, that preflight needs the
operator's private key, which never goes into CI. It is not a required
check. It must pass `--local-tests`: it runs beside the `check` jobs on the
same commit, so it cannot wait for them to be green (`ci-shape-gate-smoke`
holds this).

### npm publishing trust

The `npm-publish` GitHub Action uses npm Trusted Publishing. GitHub gives the
job a short OIDC token, npm checks that the request is from this repo and
workflow, and npm adds provenance for the package. The workflow does not use a
long-lived `NPM_TOKEN`, so no publish token with two-factor bypass is kept in
GitHub secrets.

### Where CI takes the verdict verifier from

Both `release.yml` (gate job) and `npm-publish.yml` check the tag's signed
verdict with `scripts/verify-release-verdict.js` and its helpers
(`verify-verdict-signature.js`, `verify-bump-reproduction.js`,
`fake-date-for-reproduction.js`). CI never runs the tag's own copy of these
files: the checked-out tree IS the tag under judgment, and a tag whose
verifier is `process.exit(0)` would pass any check that runs it. So a step
named "Take the release verifier from origin/main, not from the tag" first
fetches `origin/main`, copies each file out with
`git show origin/main:plugins/cool-workflow/scripts/<file>` into
`$RUNNER_TEMP/cw-release-verifier/`, and the next step runs it from there,
with the tag checkout as its working directory (the repo being judged). If
`origin/main` cannot be fetched or lacks any of the files, the step fails and
nothing is published (fail closed). The public key, as before, also comes
from `origin/main`.

On a tag push, `release.yml` itself comes from the tag, so there this is
defense in depth. `npm-publish.yml` runs by `workflow_run`, which uses the
default branch's copy of the workflow, so its check is one a tag cannot
edit. This holds only while `main` stays protected (no force push, changes
by PR only).

`release-oneclick.js` resume: when the `vX.Y.Z` tag is only local (the cut's
tag push failed), the resume pushes it only after it checks that the tag
commit carries `.cw-release/review-<tag~1>.verdict` whose first line is
`APPROVED <tag~1>`, with a `.sig` that `verify-verdict-signature.js`
accepts against `origin/main`'s `.cw-release/verdict-signing.pub`. Anything
less is refused and nothing is pushed.

0.1.51

0.1.76

0.1.78

0.1.79

## Fast Architecture Review (v0.1.80)

Adds the opt-in fast architecture-review lane: scoped JSONL source contexts, diff-aware exports, reusable Map and Assess results, measurable wrapper metrics, useful background full-review handoff, and userland model policy flags for routing fast/strong workers without changing the full review contract.

_No changes to the release-flow tooling in v0.1.81; this release was cut through the existing gate->review->tag flow._
_No changes to the release-tooling contract in v0.1.82._

## Hardening and Onboarding (v0.1.83)

Loaders fail closed on corrupt state; store writes are made safe under more than one writer; a new cw doctor checks your setup; help lists every command; and the docs are put into Basic English.

## Privacy Release (v0.1.84)

`release-flow` now writes reviewer input with repo-local paths, so local user home names do not enter the saved review prompt.

0.1.85

0.1.86

## 0.1.87 (v0.1.87)

npm test parallel, 4-vendor wrappers (Claude/Codex/Gemini/OpenCode), Homebrew-style CLI UX (colors/did-you-mean/categorized help/error tips/cw info/cw search/cw man/doctor --fix), post-success summaries, agent execution timing

## 0.1.88 (v0.1.88)

The release flow now captures the reviewer's verdict from agent stdout (`release-flow.js`), so the cut records the gate decision deterministically instead of relying on a hand-entered verdict; the kernel runtime stays untouched.

## 0.1.89 (v0.1.89)

_No behavioral change in v0.1.89 (CLI-surface golden-path + help-output fixes only; this subsystem is unchanged)._

0.1.90

0.1.91

0.1.93

0.1.94

0.1.95

0.1.96

0.1.97

0.1.98

0.2.0

0.2.1

0.2.2

0.2.3

0.2.4

0.2.5

0.2.6

0.2.7

0.2.8

0.3.0

0.3.1
