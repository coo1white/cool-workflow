# Backlog

Proposed changes that serve none of the North Star tracks (A/B/C in
`AGENTS.md`) are logged here instead of being implemented — per the operating
contract and reviewer Gate 4. One row per idea; delete the row when it ships
or is rejected for good.

| logged | idea | why it's parked (which track it fails) |
|--------|------|----------------------------------------|
| 2026-06-14 | Consolidate cross-module util look-alikes (`countBy`×7, `compact`×5+, `truncate`×4, `mergeById`×3, `isRecord`×4, `clone`×2) into a shared `util.ts` single source | Parked, not rejected — but DANGEROUS to do blindly and low net value, so it serves no North Star track today. Investigation (2026-06-14 refactor sweep) found the look-alikes are NOT uniformly identical: `coordinator.ts` `compact` also drops empty arrays while the others keep them; `multi-agent.ts` `compact` returns `undefined` for falsy input; the four `truncate`s use different limits (64/80/200/max) and only some normalize whitespace. A naive "dedup all" would silently change behavior — the exact false-green the project forbids. Only `clone` + the byte-identical `countBy`/`mergeById` bodies are safe, and those are trivial 2–3 line pure utilities where local duplication is cheap and a shared module only adds coupling (small-kernel ethos). Revisit only with a per-function byte-identity proof and a behavior-preserving gate; never merge by name. |
