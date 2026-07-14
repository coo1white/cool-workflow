# CW Benchmark Report

> Generated: 2026-06-28  
> CW version: 0.1.95  
> Test machine: macOS 15, Apple M-series (ARM64), 8 cores  
> Methodology: stub agent with configurable delay, `hyperfine`-style 2-run mean, k6 10s light workload

## Methodology

### Agent Stub

A configurable stub agent (`scripts/bench/agent-stub.js`) that simulates LLM latency:

| agent | delay | rationale |
|-------|-------|-----------|
| deepseek | 20s | v3-level API latency |
| codex | 25s | GPT-4o-level API latency |
| gemini | 30s | 2.5 Flash-level API latency |
| claude | 45s | Opus-level API latency |

### Application

`architecture-review-fast`: 4 phases × 6 tasks total.
- Map (2 tasks, parallel mode), Assess (2 tasks, parallel mode), Verify (1), Verdict (1)
- `autoWidth` = min(maxConcurrentAgents=4, tasks) = 2 for Map+Assess
- Effective rounds: 4 (Map 1 + Assess 1 + Verify 1 + Verdict 1)

### Metrics

| Column | Meaning |
|--------|---------|
| `plan_ms` | Time to plan (create tasks, write state) |
| `overhead_ms` | `total - plan - expected_agent_time`. CW framework overhead per run |
| `total_ms` | Wall-clock time for plan + drive |
| `k6_rps` | Workbench HTTP requests/sec under 10s light load |
| `k6_p95` | Workbench HTTP p95 latency |
| `delay_ms` | Agent stub delay per task |

## Results

| arch | node | conc | agent | plan_ms | overhead_ms | total_ms | k6_rps | k6_p95 | delay_ms |
|------|------|------|-------|---------|-------------|----------|--------|--------|----------|
| ARM64 | 22 | 1 | deepseek | 174 | 2479 | 82653 | 25.19 | 6.28ms | 20000 |
| ARM64 | 22 | 1 | claude | 191 | 2562 | 182753 | 25.19 | 3.51ms | 45000 |
| ARM64 | 22 | 4 | deepseek | 182 | 2529 | 82711 | 25.18 | 4.62ms | 20000 |
| ARM64 | 22 | 4 | codex | 216 | 2638 | 102854 | 25.17 | 6.34ms | 25000 |
| ARM64 | 22 | 4 | gemini | 202 | 2469 | 122671 | 25.17 | 4.83ms | 30000 |
| ARM64 | 22 | 4 | claude | 186 | 2488 | 182674 | 25.36 | 6.93ms | 45000 |

## Analysis

### Concurrency

`conc=1` vs `conc=4` shows **no difference** for this app because `autoWidth` = 2 (the Map+Assess phases have only 2 tasks each). The `--concurrency` flag only takes effect when it exceeds `autoWidth`. For an app with 6 Map tasks (like `architecture-review`), conc=4 would give a measurable speedup vs conc=1.

### Framework Overhead

`overhead_ms` ≈ 2500ms across all runs. This is CW's internal overhead per run: dispatch, result validation, evidence check, checkpoint writing. It's **constant** relative to agent delay — CW adds ~2.5s regardless of how long the agent takes.

## Workflow Overhead Baseline

The old rows above use long stub waits. Use the opt-in low-delay form below to
look at the Track A path without model, network, or Workbench time:

```text
node scripts/bench/run.js --arch portable --agent codex --conc 4 --runs 5 \
  --delay-ms 0 --skip-workbench --json-report /tmp/cw-workflow-overhead.json
```

`--delay-ms 0` is a real zero wait. `--skip-workbench` keeps the Workbench
test out of this run. Old calls keep their same defaults and one CSV line on
stdout. The opt-in JSON report has one plan, drive, and total time for every
run, plus the three medians.

On 2026-07-14, five clean temporary runs on Node 22 gave median plan 150ms,
median cold drive 994ms, and median total 1140ms. Every run completed six
workers. The main cold-path cost group is external agent start and result
collection; the drive also keeps worker checks, reports, and durable
checkpoints. This report is evidence, not a CI time gate.

A later profile found 39 trust-audit durable appends in one six-worker drive.
They took about 169ms. The current work joins the short dispatch and settlement
groups one at a time, before their present checkpoints. It does not cover the
agent wait. Do not take out a checkpoint, change a report time, or add a
default cache only to meet a time goal.

On the same five-run form after this change, median cold drive was 828ms and
median total was 979ms. The cold drive is faster than the 994ms baseline, but
does not meet the 630ms goal. The CI feedback cycle does not start. A later
performance cycle needs a new measured cost with enough safe room for its
goal.

### Cold Path Proof

Use `--trace-report` with the low-delay form to get per-round time and durable
write facts. It is for the benchmark runner only. It does not change CW CLI or
MCP work, CSV stdout, or the old JSON report.

```text
node scripts/bench/run.js --arch portable --agent codex --conc 4 --runs 5 \
  --delay-ms 0 --skip-workbench --json-report /tmp/cw-workflow-overhead.json \
  --trace-report /tmp/cw-cold-path.json
```

On 2026-07-14, five clean runs on Node 22 gave median plan 134ms, cold drive
783ms, and total 921ms. The trace gave 269ms for agent wait, 108ms for report,
101ms for settlement, and 91ms for checkpoint work. It saw 34 durable writes
and 1.33MB of durable bytes in a run.

No one safe part has 200ms of proved room. Agent wait has 269ms in four batch
children, but a long-lived child would need a new IPC and stop design; the
trace does not prove a 200ms saving. The durable writes hold state, telemetry,
and audit facts, so they cannot be taken out to meet a time goal. The 630ms
goal is not met under the present compatibility rules. Do not start another
performance change until a new proof gives one safe part with enough room, or
the product owner changes the execution or durable-state contract.

### Heatmap

```
                         plan_ms  overhead  total_ms  delay_ms
  deepseek 20s conc=1      174      2479      82653     20000
  deepseek 20s conc=4      182      2529      82711     20000
  codex    25s conc=4      216      2638     102854     25000
  gemini   30s conc=4      202      2469     122671     30000
  claude   45s conc=1      191      2562     182753     45000
  claude   45s conc=4      186      2488     182674     45000
```

### Workbench Performance

k6 light load: **25 rps**, p95 **3-7ms**. The workbench is not performance-optimized and uses synchronous disk I/O — under heavy load it degrades. This benchmark uses a light workload (25 rps) where the server handles all requests without error.

For a release proof, run `npm --prefix plugins/cool-workflow run build`, then
`npm --prefix plugins/cool-workflow run bench:workbench:deep -- --report /tmp/cw-workbench-load.json`.
It makes a temporary run and checks all Workbench GET routes. The fixed load is
25 RPS for 30 seconds, 100 RPS for five minutes, then 150, 200, and 250 RPS
for one minute each. There must be no error or dropped work, p95 at or under
100ms, p99 at or under 250ms, no `.cw/` write, and one good read after load.
`k6` is optional and is not a runtime part or CI gate.

## Test Coverage

| metric | value |
|--------|-------|
| smoke tests | 158 |
| line coverage (dist/) | **91.2%** |
| coverage gate floor | 80% |
| CI architectures | x86_64 + ARM64 (GitHub Actions matrix) |

## Limitations

1. **ARM64 only**: Docker x86_64 and Node 18 benchmarks could not run (Docker image pull timed out). These rows are left for future runs.
2. **Stub agents**: results measure CW's orchestration overhead, not real LLM API performance. Agent delay is synthetic.
3. **Single concurrency level**: `autoWidth` = 2 restricts the concurrency comparison. A 6-task phase would show a meaningful speedup.
4. **Light k6 workload**: 25 rps, no backpressure. Heavy-load tests would show queuing behavior.

## Reproducing

```bash
# ARM64 native
node scripts/bench/run.js --arch ARM64 --agent claude --conc 4 --runs 3

# Docker x86_64 (requires Docker daemon)
docker run --rm --platform linux/amd64 -v "$(pwd):/repo" -w /repo \
  node:22 node scripts/bench/run.js --arch x86_64 --agent deepseek --conc 4
```

## Raw Data

```csv
arch,node,conc,agent,plan_ms,overhead_ms,total_ms,k6_rps,k6_p95,delay_ms
ARM64,22,1,deepseek,174,2479,82653,25.19,6.28,20000
ARM64,22,1,claude,191,2562,182753,25.19,3.51,45000
ARM64,22,4,deepseek,182,2529,82711,25.18,4.62,20000
ARM64,22,4,codex,216,2638,102854,25.17,6.34,25000
ARM64,22,4,gemini,202,2469,122671,25.17,4.83,30000
ARM64,22,4,claude,186,2488,182674,25.36,6.93,45000
```
