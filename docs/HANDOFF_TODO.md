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

## 1. Scope chime's environment into the shared handoff repo (operator, web UI)

**State.** `coo1white/handoff` (Private) is created and verified. The
cool-workflow (MacBook) side is proven end-to-end: `cw ledger propose` → `git
push` → `cw ledger list --dir ledger` returns `allOk: true`.

**Remaining (operator action, not doable from a scoped web session).** Add the
`chime` Claude environment's repository scope to `coo1white/handoff` and give
that environment a git token that can read/write it. A cool-workflow-scoped
session cannot create or grant access to repos outside its scope
(`create_repository`/cross-repo calls return 403) — this is a web-UI step.

**Then, on the chime side.** `cw ledger` has been on npm since v0.1.98 (now
published; latest is newer):

```bash
npm i -g cool-workflow@latest          # gets `cw ledger`
export GH_TOKEN=<token-for-handoff>
git clone https://x-access-token:$GH_TOKEN@github.com/coo1white/handoff.git ~/handoff
cd ~/handoff && mkdir -p ledger
git pull && cw ledger list --dir ledger        # verify inbox (fail-closed)
# produce entries with:  --from chime --to cool-workflow
```

## 2. Post-publish: install the released cw on both sides

Once each new version lands on npm, both environments drop the git-version
symlink and use the release:

```bash
npm i -g cool-workflow@latest          # Mac (cool-workflow) and chime
cw --version                           # -> the version just published
```
