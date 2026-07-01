# Handoff TODO — in-flight work for the next agent

Live, in-flight tasks so any agent (Claude, Codex, Gemini, …) or the operator
can pick up the relay. This is NOT `docs/BACKLOG.md`: that file parks ideas that
serve no North Star track; this file tracks work that is started and must be
finished. Delete a row when it ships; keep the state line honest.

Source of truth for the ledger design/runbook:
`plugins/cool-workflow/docs/cross-agent-ledger.7.md`,
`plugins/cool-workflow/docs/handoff-setup.md`, and `PROJECT_MEMORY.md`
(sections "Cross-agent handoff ledger" and "Handoff ledger — future
direction").

---

## 1. Release v0.1.98 — cut the tag so npm publishes (BLOCKING)

**State.** PR #321 merged; `main` is at the release commit (version `0.1.98`
on every structured + content surface). But **no `v0.1.98` git tag exists**, so
nothing publishes and nothing new shows in the Actions tab. `npm view
cool-workflow version` is still `0.1.97`.

**Why merge ≠ publish.** Publishing is tag-driven, not merge-driven:

```
push tag v0.1.98  ->  release-gate.yml (deterministic gate + verify committed
                       APPROVED verdict)  ->  on success, npm-publish.yml
                       (workflow_run) publishes with provenance, and
                       github-release.yml creates the GitHub Release.
```

No tag ⇒ `release-gate`/`npm-publish` never run ⇒ npm stays at `0.1.97`.

**Do this** — from a CLEAN checkout of `origin/main`, working tree clean (the
cut runs `git add -u`, so any uncommitted edit would be swept into the immutable
tag commit — do not run it with a dirty tree):

```bash
git fetch origin main && git checkout -B release/v0.1.98 origin/main
CW_AGENT_COMMAND="claude -p {{input}}" \
  node plugins/cool-workflow/scripts/release-flow.js --cut --version 0.1.98 --push
```

Use whichever reviewer backend you have configured (`codex exec`, `gemini -p`,
`opencode run -m <model>`, or `CW_AGENT_ENDPOINT=…`). The reviewer MUST run in an
EXECUTE-capable context — a read-only / low-effort reviewer cannot re-run the
gate it is judging and will fabricate a REJECTED verdict (the v0.1.97 lesson,
see `PROJECT_MEMORY.md` → Last Session).

**What the cut does.** Runs `release-gate.sh`; delegates the independent
reviewer; the reviewer writes `.cw-release/review-<sha>.verdict` with a first
line `APPROVED <sha>`; commits that verdict; tags `v0.1.98`; atomic-pushes the
branch + tag. `bump:version` is a no-op because `main` is already at `0.1.98`,
so the only new file in the verdict commit is the verdict itself (the v0.1.97
shape).

**Verify.**

```bash
npm view cool-workflow version            # -> 0.1.98
```

Actions should show `release-gate` then `npm-publish` (and `github-release`)
green on the `v0.1.98` tag.

**Finish.** Open a PR to merge the verdict commit onto `main` (matches the
v0.1.97 history, where the verdict commit lives on `main`). Never
`git push origin main` directly — AGENTS.md hard rule.

**Non-issue.** The sandbox git-URL rewrite that injects a `127.0.0.1` proxy host
only fails `release:check`'s readme-sync/dogfood steps — those are NOT part of
`release-gate.sh` or the reviewer procedure, so they do not affect the cut or
the publish. Do NOT run `sync:readme` in the sandbox (it would bake the proxy
host into the committed README).

## 2. Scope chime's environment into the shared handoff repo (operator, web UI)

**State.** `coo1white/handoff` (Private) is created and verified. The
cool-workflow (MacBook) side is proven end-to-end: `cw ledger propose` → `git
push` → `cw ledger list --dir ledger` returns `allOk: true`.

**Remaining (operator action, not doable from a scoped web session).** Add the
`chime` Claude environment's repository scope to `coo1white/handoff` and give
that environment a git token that can read/write it. A cool-workflow-scoped
session cannot create or grant access to repos outside its scope
(`create_repository`/cross-repo calls return 403) — this is a web-UI step.

**Then, on the chime side.** After task 1 publishes 0.1.98:

```bash
npm i -g cool-workflow@latest          # gets `cw ledger`
export GH_TOKEN=<token-for-handoff>
git clone https://x-access-token:$GH_TOKEN@github.com/coo1white/handoff.git ~/handoff
cd ~/handoff && mkdir -p ledger
git pull && cw ledger list --dir ledger        # verify inbox (fail-closed)
# produce entries with:  --from chime --to cool-workflow
```

## 3. Post-publish: install the released cw on both sides

After task 1 lands `0.1.98` on npm, both environments drop the git-version
symlink and use the release:

```bash
npm i -g cool-workflow@latest          # Mac (cool-workflow) and chime
cw --version                           # -> 0.1.98, `cw ledger` present
```
