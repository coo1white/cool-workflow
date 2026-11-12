# Run Registry / Control Plane

*How CW keeps an index of your runs across many repos, so you can find,
resume, queue, put away, and rerun them. To move one run to another
machine, see [Recovery And Restore](Recovery-And-Restore.md).*

Each run lives in its own repo, under `.cw/runs/<run-id>/state.json`. That
file is the **only truth** about the run. The run registry is an index
**worked out from** those files: it can be deleted and made again from them
at any time, and it never says more than the `state.json` files say.

```text
state.json is the only truth.
The registry is a cache worked out from it.
Delete it, and make it again from the source.
Never make up a run's status; work it out.
Add to history; never write over the past.
Fail closed when the source is stale or gone.
```

## Where the files are

All of them are plain JSON you can open and compare:

```text
<repo>/.cw/runs/<run-id>/state.json   the run itself: the truth
<repo>/.cw/registry/index.json        index of this repo's runs (can be made again)
<repo>/.cw/registry/archive.json      which runs are put away (a mark; nothing is deleted)
<repo>/.cw/registry/provenance.json   which run is a rerun of which

$CW_HOME/registry/repos.json          the repos CW knows about
$CW_HOME/registry/index.json          index across all of those repos
$CW_HOME/registry/queue.json          the run queue
```

`$CW_HOME` is `CW_HOME` if set, else `$XDG_STATE_HOME/cool-workflow`, else
`~/.local/state/cool-workflow`. A repo is added to `repos.json` when you
refresh its index. Reading never writes: a search works out the repo list in
memory.

## Build and check the index

```bash
cw registry refresh            # make the index again from the state.json files
cw registry show               # read it: valid, stale, or absent
cw registry show --scope home  # the index across every known repo
```

`registry show` works out each run's fingerprint again and compares it with
the saved index. If a run changed, the index is `stale` and that run is
named. If a run's files are gone, it is named as missing and is **not** shown
as a live run; the next step it gives is `registry refresh`.

## What state a run is in

A run's state is worked out from its `state.json` by fixed rules (the first
one that matches wins):

```text
1. a task is running                        -> running
2. there is open feedback (a failure)       -> blocked
3. a task failed                            -> failed
4. every task is completed                  -> completed
5. there are verifier-gated commits, and
   nothing is waiting                       -> completed
6. some tasks are completed                 -> running
7. anything else                            -> queued
```

`archived` is a mark put on top. The run shows as `archived`, but its
worked-out state is kept, so search and history still find it.

## Find, resume, put away, rerun

```bash
cw run list                                # every run CW knows about
cw run search --text "auth" --status completed
cw run show <run-id>                       # one run, found by id across repos
cw run resume <run-id>                     # read only: what is the next step?
cw run resume <run-id> --drive             # go on: give the next steps to your agent
cw run archive <run-id> --reason "done"    # put it away (add --unarchive to undo)
cw run archive --older-than-days 30 --state completed
cw run rerun <run-id> --reason "agent fixed"
cw history --limit 20                      # all repos, newest first
```

- **Search** looks by app, state, time (`--since`, `--until`), repo, and
  text. It goes across all known repos by default (`--scope home`); use
  `--scope repo` for this repo only. The order is fixed, and `--limit` and
  `--offset` page through it.
- **Resume** finds the run by id from any folder. Without `--drive` it
  changes nothing. With `--drive` (or `--once` for one step) the agent
  drive loop goes on with it; add `--incremental` to use the saved result
  of every step whose inputs did not change.
- **Archive** only puts a mark in `archive.json`. The run's files are never
  moved or deleted, and it can still be found.
- **Rerun** makes a **new** run with the same app and inputs, next to the
  old one, and records the link (`rerunOf`, `generation`). The failed run is
  kept for the audit.

## The queue

```bash
cw queue add --app architecture-review --repo . --priority 1
cw queue list
cw queue drain --limit 1
```

The queue keeps order: a lower `--priority` goes first, then the older
entry. `queue drain` marks the next entries as handed out and gives them
back. CW records the order; **your host runs the work**. Nothing in the
queue starts work by itself.

## The same from MCP

Every command here is in the capability registry one time, so
`cw <command> --json` and its MCP tool give the same JSON: `cw_registry_refresh`,
`cw_registry_show`, `cw_run_search`, `cw_run_list`, `cw_run_show`,
`cw_run_resume`, `cw_run_archive`, `cw_run_rerun`, `cw_queue_add`,
`cw_queue_list`, `cw_queue_drain`, `cw_queue_show`, and `cw_history`. See
[MCP And Manifests](MCP-And-Manifests.md).

Full rules: `cw man run-registry-control-plane`.

## Related Pages

- [Recovery And Restore](Recovery-And-Restore.md)
- [Architecture Principles](Architecture-Principles.md)
- [Commands or API](Commands-or-API.md)
