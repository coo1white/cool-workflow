# Remote-Source Review (`--link`)

CW v0.1.91 lets you point a review at **any repository on the internet** instead
of only a local path: `cw -q "what are the risks?" --link <url>`. CW materializes
the remote into a local checkout and runs the **existing** review pipeline against
it — identical downstream to reviewing a folder. A URL passed to `-dir`/`--repo`
is auto-detected, so `--link <url>` and `-dir <url>` are equivalent.

```bash
cw -q "What are the risks?" --link https://github.com/owner/repo
cw -q "What are the risks?" --link git@gitlab.com:owner/repo.git --ref v1.2.0
cw -q "What are the risks?" --link https://github.com/owner/repo/archive/refs/heads/main.tar.gz
cw -q "..." --link <url> --check     # validate the URL + tooling WITHOUT fetching
```

## Sources

- **Git repositories**, any host: `https://`, `http://`, `ssh://`, `git://`, the
  scp-style `git@host:owner/repo`, and `file://`. Cloned shallow (`--depth 1
  --single-branch`); `--ref <branch|tag>` selects a ref. `commit` is the resolved
  `HEAD` SHA.
- **Downloadable archives**: `.tar.gz` / `.tgz` / `.tar` / `.zip` (e.g. a GitHub
  "Download ZIP" / codeload tarball). Fetched, extracted, and `git init`-snapshotted
  into a local repo so the git-tracked source-context reader works unchanged.
  `commit` is the **sha256 of the downloaded bytes** (a content address — there is
  no git SHA).

## The red line — materialize source, do not internalize execution

`--link` only materializes the **source** to review. CW still **DELEGATES** worker
execution to the operator's configured agent backend (`claude -p`, `codex exec`, an
HTTP endpoint) exactly as a local review does; it never executes a model itself.
Cloning is non-deterministic network I/O, so it happens in the **capability layer**
(before `plan`), never in the replay-deterministic orchestrator core — which only
ever sees the resulting local path.

## Provenance — where the code came from, tamper-evidently

The sanitized origin rides through three surfaces:

- `run.inputs` → a `- Source: <url>@<commit>` line in `report.md`.
- the `--json` result's `remote { url, commit, kind, ref, cached }`.
- a hash-chained `source.clone` / `source.download` **trust-audit event** that
  `cw audit verify <run-id>` re-proves — editing the recorded origin is detectable.

Credentials in a URL (`https://user:token@host/…`) are stripped before the URL is
used as a cache key, printed, persisted, or recorded; the raw URL reaches only a
single `git` argv element. Git/download diagnostics are credential-redacted before
they are ever surfaced.

## Fail closed

A bad URL, a blocked scheme, a network failure, or a credential-less private repo
produces an **explicit error and a non-zero exit** — never a fabricated review,
never a hang on an auth prompt (`GIT_TERMINAL_PROMPT=0`). Hardening:

- **Scheme allowlist** (https/http/ssh/git/file); `ext::`/`fd::` transport helpers
  and `-`-leading option-injection are rejected; the URL is always a separate argv
  element (never a shell string); repo hooks are disabled (`-c core.hooksPath=`).
- **Archive extraction** validates the entry listing for `..`/absolute traversal
  BEFORE extracting, **rejects symlink/non-regular entries** (walked with `lstat`),
  and bounds the decompression bomb by **declared** uncompressed size (gzip ISIZE /
  `unzip -l`) before extracting and **actual** size (1 GiB) after.
- **SSRF**: http(s) redirects are followed manually and each hop is re-validated
  (http(s) scheme + no private/loopback/link-local host) before connecting — a
  public URL cannot redirect CW into an internal service.

## Cache — `cw clones`

Checkouts are cached, content-addressed, under
`~/.local/state/cool-workflow/clones/<hash>/` (honoring `CW_HOME`/`XDG_STATE_HOME`)
and reused on the next question; `--refresh` re-fetches. Manage the cache:

```bash
cw clones list                          # origin url, kind, commit, age, bytes
cw clones gc --older-than-days 30       # reclaim checkouts older than N days
cw clones gc --all                      # reclaim everything
```

`cw clones gc` deletes only paths it has proven are inside the clones cache (fail
closed). Both verbs have MCP peers (`cw_clones_list`, `cw_clones_gc`) with
byte-identical payloads.

## Determinism note

The cache is keyed on the URL (+ref), not on content: if a URL's content changes
upstream, the cached checkout is reused until `--refresh` (mirroring how a git
clone pins its resolved `HEAD`). Use `--refresh` to re-fetch the latest.
