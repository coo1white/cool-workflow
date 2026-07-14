// shell/perf-trace.ts — opt-in cold-path timing evidence for the benchmark
// runner. This is not a product log: it is off unless CW_BENCH_TRACE_FILE is
// set by scripts/bench/run.js, and it writes one JSON report when the drive
// process ends. Normal CLI and MCP work do not see it.

import * as fs from "node:fs";

const TRACE_FILE = process.env.CW_BENCH_TRACE_FILE || "";

interface TraceGroup {
  durationMs: number;
  selfMs: number;
  durableWriteCount: number;
  durableWriteBytes: number;
  samples: TraceSample[];
}

interface TraceSample {
  durationMs: number;
  selfMs: number;
  durableWriteCount: number;
  durableWriteBytes: number;
}

interface TraceScope {
  name: string;
  startedAt: bigint;
  childMs: number;
  durableWriteCount: number;
  durableWriteBytes: number;
}

const groups = new Map<string, TraceGroup>();
const scopes: TraceScope[] = [];

function enabled(): boolean {
  return TRACE_FILE.length > 0;
}

function groupFor(name: string): TraceGroup {
  let group = groups.get(name);
  if (!group) {
    group = { durationMs: 0, selfMs: 0, durableWriteCount: 0, durableWriteBytes: 0, samples: [] };
    groups.set(name, group);
  }
  return group;
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

/** Run synchronous work as one named benchmark group. Nested work is kept in
 * the parent duration, but removed from its self time. That lets the report
 * show dispatch work apart from its agent wait without changing call order. */
export function withPerfTraceGroup<T>(name: string, fn: () => T): T {
  if (!enabled()) return fn();
  const scope: TraceScope = { name, startedAt: process.hrtime.bigint(), childMs: 0, durableWriteCount: 0, durableWriteBytes: 0 };
  scopes.push(scope);
  try {
    return fn();
  } finally {
    const ended = scopes.pop();
    if (ended) {
      const durationMs = elapsedMs(ended.startedAt);
      const group = groupFor(ended.name);
      group.durationMs += durationMs;
      group.selfMs += Math.max(0, durationMs - ended.childMs);
      group.durableWriteCount += ended.durableWriteCount;
      group.durableWriteBytes += ended.durableWriteBytes;
      group.samples.push({
        durationMs: rounded(durationMs),
        selfMs: rounded(Math.max(0, durationMs - ended.childMs)),
        durableWriteCount: ended.durableWriteCount,
        durableWriteBytes: ended.durableWriteBytes,
      });
      const parent = scopes[scopes.length - 1];
      if (parent) parent.childMs += durationMs;
    }
  }
}

/** Count a completed durable file write in the active benchmark group. */
export function recordPerfDurableWrite(bytes: number): void {
  if (!enabled()) return;
  const active = scopes[scopes.length - 1];
  if (!active) {
    const group = groupFor("other");
    group.durableWriteCount += 1;
    group.durableWriteBytes += bytes;
    return;
  }
  for (const scope of scopes) {
    scope.durableWriteCount += 1;
    scope.durableWriteBytes += bytes;
  }
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function writeTrace(): void {
  if (!enabled()) return;
  const value = {
    schemaVersion: 1,
    benchmark: "cw-cold-path",
    groups: [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, group]) => ({
        name,
        durationMs: rounded(group.durationMs),
        selfMs: rounded(group.selfMs),
        durableWriteCount: group.durableWriteCount,
        durableWriteBytes: group.durableWriteBytes,
        samples: group.samples,
      })),
  };
  try {
    fs.writeFileSync(TRACE_FILE, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch {
    // A benchmark trace must never change the drive result or exit status.
  }
}

if (enabled()) process.once("exit", writeTrace);
