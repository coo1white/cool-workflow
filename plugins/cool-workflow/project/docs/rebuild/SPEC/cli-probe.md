# CLI probe — cool-workflow v0.1.98

Ground truth for the rebuild. Everything here came from running the
built CLI at `plugins/cool-workflow/dist/cli.js` with
`node dist/cli.js <args>`. All runs were piped (no TTY on stdout,
stderr, or stdin). TTY-gated output, if any, is off in every capture
here.

## How the captures were made

- `node dist/cli.js help` — exit 0, stdout only, stderr empty.
  Exact bytes saved to `cli-help/_root.txt` (no header line added,
  so the bytes are exact).
- For every command word in the root help (top verbs + the
  "More commands" block), ran `node dist/cli.js help <cmd>` and saved
  to `cli-help/<cmd>.txt`. Each of those files starts with a comment
  line `# exit: N`, then the exact stdout bytes. If stderr had bytes,
  a `# stderr:` line and the stderr bytes would come after — no
  command needed it: stderr was empty for all 59 help runs, and all
  59 gave exit 0.

Command words probed (59): list, search, info, init, plan, status,
next, dispatch, result, state, commit, report, app, sandbox, backend,
contract, node, feedback, worker, audit, candidate, review, loop,
schedule, routine, registry, run, queue, clones, orphans, history,
quickstart, audit-run, multi-agent, topology, summary, blackboard,
coordinator, metrics, operator, sched, gc, telemetry, migration,
demo, workbench, approve, reject, comment, handoff, ledger, graph,
eval, man, doctor, version, update, fix, help.

## Other safe read-only probes

| probe | exit | note |
|---|---|---|
| `version` | 0 | stdout is `0.1.98` + newline. stderr empty. |
| `version --json` | 0 | Same bytes as `version`: plain `0.1.98`, NOT JSON. The flag changes nothing. |
| `--help` | 0 | Output is byte-for-byte the same as `help` (checked with cmp). |
| `list` | 0 | JSON array of 10 bundled workflow apps: architecture-review, architecture-review-fast, end-to-end-golden-path, legacy-architecture-review, legacy-research-synthesis, pdca-blackboard-loop, pr-review-fix-ci, release-cut, research-synthesis, workflow-app-framework-demo. Each item has id, title, summary, file (absolute path). |
| `app list` | 0 | JSON, 14904 bytes, richer view of the same apps. |
| `man` | 1 | stdout empty. stderr: `cw: Missing topic.` + `  Tip: cw man release-tooling for the release tooling manual.` Only probe seen with a non-zero exit. |
| `man release-tooling` | 0 | Prints the markdown man page from docs/ to stdout (14427 bytes). |
| `doctor --json` | 0 | Came back in under 1 second. JSON with `schemaVersion: 1`, `ok`, a `checks` array (node, agent, git, home-registry, repo-state; each with name/status/detail), and `summary: "ready — all checks passed"`. |
| `help not-a-real-command` | 0 | stdout: `Unknown command: not-a-real-command` + `  Try:  cw help   (list all commands)`. Note the exit is 0, not 1. |

Nothing that writes state or goes to the network was run
(no update, demo, init, run, dispatch, commit, gc, quickstart).

## Odd things a rebuild must copy or fix on purpose

1. `help audit-run` prints `Unknown command: audit-run` with a
   self-suggestion `Did you mean:  cw audit-run` — and exits 0. But
   `audit-run` IS a real top-level command: in
   `src/cli/command-surface.ts` (line ~212) the cases `"quickstart"`
   and `"audit-run"` fall to the same code, so `audit-run` is an
   alias of `quickstart`. The per-command help table simply has no
   row for the alias, while the suggestion word-list does — so help
   suggests the very word you gave it.
2. `help <unknown>` exits 0. Only `man` with no topic gave exit 1 in
   these probes.
3. `version --json` does not give JSON — same plain text as
   `version`.
4. `--help` is an exact byte-alias of `help`.
5. Some help tables print the same subcommand row two times with
   different one-line texts, one per get/set or read/write form:
   `backend agent config` (show + set), `run drive` (preview +
   drive), `sched policy` (show + set), `run resume` (read-only +
   opt-in --drive), and many `multi-agent` rows (fanin, fanout,
   graph, group, membership, reasoning, role, run x3). A rebuild's
   help printer must keep these doubled rows.
6. Every `help <cmd>` page starts with a blank-line-padded
   `cw <cmd>` head line, then two-space-led rows. No usage/flags
   section is printed per command — flags only appear in the root
   help.
7. Root help lists `version`, `update`, `fix` both as top verbs and
   again inside "More commands"; `doctor` only as a top verb; `help`
   in neither list, though `help help` works.

## Where each fact lives

Exact bytes: `cli-help/_root.txt` and `cli-help/<cmd>.txt` (59
files, 60 with `_root.txt`). Machine list of the surface:
`cli-probe.surface.json`.
