// core/types/observability.ts — the one type shell/observability.ts's
// executor-boundary weld (core/types/boundary.ts) needs, moved here since
// it is plain data with no dependency on that (impure) file's logic.
// shell/observability.ts re-exports it so its own existing exports stay
// unchanged.

export interface UsageRecord {
  schemaVersion?: 1;
  source?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  attestedAt?: string;
  attestation?: "attested" | "unattested" | "absent";
  attestationReason?: string;
  note?: string;
}
