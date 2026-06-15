// Single source of truth for the deterministic record id scheme shared by the
// multi-agent kernel (multi-agent/helpers.ts) and the coordinator/blackboard
// layer (coordinator/util.ts). Both previously copy-pasted byte-identical
// zero-padded-seq logic; this dedup (F10) collapses them onto one helper.
//
// Deterministic record id (FreeBSD-audit L12/L13): the record's POSITION in its
// per-run collection, threaded from the call site. No wall-clock stamp, no PRNG
// suffix — re-running the same multi-agent topology / coordination mints
// byte-identical ids, so snapshot/replay digests match. Each call site already
// asserts the minted id is unique within its collection, and these collections
// only ever append.
//
// REPLAY DETERMINISM: pure function of its arguments — no Date, no random.
// The output MUST stay byte-identical: `${prefix}-${4-digit-zero-padded-seq}`.
export function createId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}
