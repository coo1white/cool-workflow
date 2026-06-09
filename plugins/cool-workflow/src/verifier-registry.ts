// Verifier Registry — open pluggability for commit-gate verifiers.
//
// BSD discipline (mechanism separate from policy):
//  - MECHANISM: a Map<string, Verifier> with register + resolve.
//  - POLICY: which verifiers exist is declared via registerVerifier() at load time.
//  - FAIL CLOSED: unknown verifier id → named refusal.
//  - COMPOSABLE: multiple verifiers can be chained; each runs in registration order.
//
// From v0.1.58: the built-in verifier (validateResultEnvelope, validateRunGates,
// hasGroundedEvidence) remains the default. Registered verifiers run BEFORE the
// default — they can block or add evidence but cannot override the default gate.

import type { WorkflowRun } from "./types";

export interface VerifierInput {
  run: WorkflowRun;
  /** Optional args passed from the commit/selection caller. */
  args?: Record<string, unknown>;
}

export interface VerifierResult {
  /** "pass" | "block" | "warn". "block" prevents the commit. */
  verdict: "pass" | "block" | "warn";
  /** Reason for the verdict — mandatory for "block". */
  reason?: string;
  /** Additional evidence discovered by the verifier. */
  evidence?: string[];
}

export interface Verifier {
  id: string;
  title: string;
  summary: string;
  /** The verification function. Called during commit gate resolution. */
  verify(input: VerifierInput): VerifierResult | Promise<VerifierResult>;
}

const _verifierRegistry = new Map<string, Verifier>();

export function registerVerifier(verifier: Verifier): void {
  _verifierRegistry.set(verifier.id, verifier);
}

export function getVerifier(id: string): Verifier | undefined {
  return _verifierRegistry.get(id);
}

export function listVerifiers(): Verifier[] {
  return [..._verifierRegistry.values()];
}

/** Run all registered verifiers against a run. Returns the aggregated verdict:
 *  "pass" if all pass, "block" if any block (first block reason wins). */
export async function runAllVerifiers(
  input: VerifierInput
): Promise<{ verdict: "pass" | "block"; reasons: string[]; evidence: string[] }> {
  const reasons: string[] = [];
  const evidence: string[] = [];
  for (const verifier of _verifierRegistry.values()) {
    const result = await verifier.verify(input);
    if (result.evidence) evidence.push(...result.evidence);
    if (result.verdict === "block") {
      reasons.push(`[${verifier.id}] ${result.reason || "blocked by verifier"}`);
    } else if (result.verdict === "warn") {
      reasons.push(`[${verifier.id}] warn: ${result.reason || "warning"}`);
    }
  }
  const blocked = reasons.some((r) => !r.includes("warn:"));
  return { verdict: blocked ? "block" : "pass", reasons, evidence };
}
