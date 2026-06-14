// Pure, stateless utilities for worker isolation (error construction, type
// guards, and small collection helpers). Carved out of worker-isolation.ts
// following the established router pattern (run-registry/{format,policy}.ts,
// orchestrator/*-operations.ts).
//
// BEHAVIOR-PRESERVING — pure code movement, zero logic change. None of these
// touch run state; they take their inputs and return a value. Re-exported from
// worker-isolation.ts so the public surface is byte-unchanged.
import { StateNodeError, WorkerBoundaryViolation } from "../types";

export function structuredError(
  code: string,
  message: string,
  options: { path?: string; retryable?: boolean; details?: Record<string, unknown> } = {}
): StateNodeError {
  return {
    code,
    message,
    at: new Date().toISOString(),
    path: options.path,
    retryable: options.retryable,
    details: options.details
  };
}

export function isBoundaryViolation(value: unknown): value is WorkerBoundaryViolation {
  return Boolean(value && typeof value === "object" && "allowedPaths" in value && "message" in value);
}

export function isStateNodeError(value: unknown): value is StateNodeError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}

export function mergeScopes<T extends { id: string }>(left: T[], right: T[]): T[] {
  const merged = [...left];
  for (const scope of right) {
    const index = merged.findIndex((candidate) => candidate.id === scope.id);
    if (index >= 0) merged[index] = scope;
    else merged.push(scope);
  }
  return merged;
}

export function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function compactMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}
