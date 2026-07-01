# Handoff ledger — shared-repo setup (T2a)

How to stand up the shared repo that carries `cw ledger` entries between two
agents scoped to two separate repos (e.g. `cool-workflow` and `chime`), each
running in its own cloud session. The verbs are documented in
[cross-agent-ledger](cross-agent-ledger.7.md); this is the operator runbook.

Examples are portable — replace `<owner>`, `<src-repo>`, and the paths with your
own, and keep tokens in environment variables, never in files or commit text.

## What only the operator can do

- A cool-workflow-scoped web session cannot create the shared repo — the GitHub
  integration returns `403 Resource not accessible by integration` for any repo
  outside its scope. Create it yourself.
- Scoping the two agent environments (or granting them git credentials) is a
  Claude Code web-UI step; it cannot be done from inside a session.

## Choosing a host: GitHub vs self-hosted (Gitea)

The transport is git-host-agnostic — the kernel has no git logic, so any git
remote works. The choice is about reachability and operations, not code.

| | GitHub (private repo) | Self-hosted Gitea (your VPS) |
|---|---|---|
| Reachability from cloud sessions | github.com is in the default **Trusted** allowlist — works with no network-policy change | Your VPS host is **not** in the default allowlist — the environment's network access must be configured to permit it |
| Scope wall | The GitHub MCP scope is per-repo; the ledger uses plain git (not MCP) so it works, but it runs against the grain of the scoping model | Not a GitHub repo at all, so the GitHub scope wall does not apply |
| Limits / quota | Disable Actions on this repo (it needs no CI) so it burns no minutes; git push/pull is not API-rate-limited; ledger traffic is tiny | Fully self-controlled, unlimited |
| Operations | Managed, backed up, zero maintenance | You run it: uptime, backups, TLS cert, patching |
| Data location | GitHub's servers (private) | Your own hardware |

**Recommendation.** Start on **GitHub private** — it is reachable out of the box
and the quota worry is practically moot for tiny ledger traffic. Move to **Gitea**
if you want full self-hosting AND have confirmed the cloud environment can reach
your VPS through its network policy (the deciding prerequisite). Migrating later
is only a change of git remote — no code change.

## GitHub private — setup

1. **Token.** GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained. Repository access: only `<owner>/handoff`. Permissions:
   Contents = Read and write. Copy the token.
2. **Repo.** Create `<owner>/handoff`, private, initialized with a README. In
   Settings → Actions → General, disable Actions (no CI needed → no minutes).
3. **Environments.** In each agent environment (both the `cool-workflow` and the
   `chime` environment), add an environment variable `GH_TOKEN=<token>` (`.env`
   format, no quotes). A new session is required for it to take effect.
4. **Optional** — put the clone in each environment's setup script so the ledger
   is present at session start:
   ```bash
   #!/bin/bash
   git clone https://oauth2:${GH_TOKEN}@github.com/<owner>/handoff.git /home/user/handoff || true
   ```

## Gitea (self-hosted) — setup

Same shape, two extra prerequisites:

1. Serve Gitea over HTTPS with a valid certificate (e.g. Let's Encrypt) so the
   cloud VM's git can verify it.
2. Configure the agent environment's **network access** to permit your VPS host —
   the default Trusted allowlist does not include it. If the loop cannot reach
   the VPS, it cannot run.
3. Create a Gitea access token, store it as an environment variable, and clone
   with an authenticated remote (`https://<user>:${GIT_TOKEN}@<vps-host>/<owner>/handoff.git`).

## Directory convention

Entries live under `ledger/` in the shared repo, one file per entry named by its
id:

```
handoff/
  ledger/
    ldg-1de7c92172af1871.json
    ldg-2315e4b33b9a812f.json
```

## The loop

Producing side (propose a change, hand it over):

```bash
entry=$(cw ledger propose --from cool-workflow --to chime \
  --title "Add retry" --rationale "flaky net" \
  --files src/net.ts --diff "$(git -C <src-repo> diff)")
id=$(printf '%s' "$entry" | jq -r .id)
printf '%s\n' "$entry" > /home/user/handoff/ledger/$id.json
git -C /home/user/handoff add ledger/$id.json
git -C /home/user/handoff commit -m "propose $id"
git -C /home/user/handoff push
```

Note the single `cw ledger propose` call captured into `$entry` — calling it
twice would mint two different entries (each carries a fresh `createdAt`).

Consuming side (verify the inbox, then act or review back):

```bash
git -C /home/user/handoff pull
cw ledger list --dir /home/user/handoff/ledger && echo "inbox verified — safe to act"

# hand a verdict back:
entry=$(cw ledger review --from chime --to cool-workflow \
  --target ldg-1de7c92172af1871 --verdict approved --findings "tests pass,scope ok")
id=$(printf '%s' "$entry" | jq -r .id)
printf '%s\n' "$entry" > /home/user/handoff/ledger/$id.json
git -C /home/user/handoff add ledger/$id.json
git -C /home/user/handoff commit -m "review $id"
git -C /home/user/handoff push
```

## Notes

- Keep private code out of a **public** handoff repo: omit `--diff` and reference
  a commit/branch in the private source repo instead, so only metadata + a
  pointer is exposed. On a private handoff repo, full diffs are fine.
- The other side may build entries without `cw` as long as they match the
  digest/id rules in [cross-agent-ledger](cross-agent-ledger.7.md); otherwise
  `cw ledger verify` refuses them with `ledger-digest-mismatch`.
