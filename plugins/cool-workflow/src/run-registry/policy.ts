// Run-registry POLICY constants (FreeBSD-audit R2 deep). Carved into their own
// leaf module so the carved stateful clusters (gc.ts, queue.ts) can depend on the
// policy default WITHOUT a circular import back to run-registry.ts. Re-exported
// from run-registry.ts to keep the public surface unchanged.
//
// SEPARATE MECHANISM FROM POLICY: retention windows, queue ordering, and archive
// thresholds are POLICY and live here / in explicit flags — never baked into the
// derived index. The v0.1.39 reclamation knobs all default to RECLAIM NOTHING
// (back-compatible, opt-in).
import { RunRegistryPolicy } from "../types";

export const RUN_REGISTRY_SCHEMA_VERSION = 1 as const;

export const DEFAULT_RUN_REGISTRY_POLICY: RunRegistryPolicy = {
  schemaVersion: 1,
  archiveOlderThanDays: 0,
  archiveStates: ["completed", "failed"],
  defaultQueuePriority: 100,
  reclaimAfterArchiveDays: 0,
  reclaimStates: ["completed", "failed"],
  keepSnapshots: false,
  keepScratch: false,
  maxReclaimRuns: 0,
  maxReclaimBytes: 0
};
