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
bash scripts/bench/run.sh --arch ARM64 --agent claude --conc 4 --runs 3

# Docker x86_64 (requires Docker daemon)
docker run --rm --platform linux/amd64 -v "$(pwd):/repo" -w /repo \
  node:22 bash -c "bash scripts/bench/run.sh --arch x86_64 --agent deepseek --conc 4"
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
