import fs from "node:fs";
import path from "node:path";
import type { EvidenceConfidence } from "./types";

// ---------------------------------------------------------------------------
// Evidence grounding (v0.1.40 self-audit P1).
//
// The flagship "evidence-gated commit" used to accept ANY non-empty string as
// evidence (`verifier.ts` checked only `.some(entry => entry.trim())`). That made
// the gate trust-on-self-report: an agent could pass it with `evidence: ["x"]`.
//
// CW's evidence is a deliberately free-form LOCATOR namespace — `file:line`,
// URLs, and machine tokens like `exitCode:0`, `stdoutSha256:<hash>`, `refused:<why>`
// are all legitimate — so we cannot require "must be a file that exists" by
// default without breaking cross-repo, URL, and runtime-token evidence. Instead:
//
//  1. DEFAULT: require evidence to be GROUNDED — a URL, a path-like locator, or
//     a `namespace:value` token. This rejects bare prose ("x", "anything",
//     "HIGH severity") while accepting every shape CW itself emits. Being a pure
//     function of the string, it is replay-safe.
//
//  2. DEFAULT (v0.1.95): file-style evidence locators MUST also exist on disk.
//     CW_REQUIRE_RESOLVABLE_EVIDENCE=0 restores the prior shape-only behavior.
//     CW_REQUIRE_RESOLVABLE_EVIDENCE=url additionally requires URL reachability.
// ---------------------------------------------------------------------------

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PATH_SEP_RE = /[\\/]/;
const FILE_EXT_RE = /\.[A-Za-z0-9]{1,12}(?::\d+(?:-\d+)?)?$/;
const NAMESPACE_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.-]*:\S/;
const LINE_SUFFIX_RE = /:(\d+(?:-\d+)?)$/;

export type EvidenceResolution = "resolved" | "unresolved" | "external" | "opaque";

/** A single evidence string is "grounded" if it is machine-shaped — a URL, a
 *  path-like locator, or a `namespace:value` token — rather than free prose. */
export function isGroundedEvidence(raw: unknown): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  if (URL_RE.test(value)) return true;
  if (PATH_SEP_RE.test(value)) return true;
  if (FILE_EXT_RE.test(value)) return true;
  if (NAMESPACE_TOKEN_RE.test(value)) return true;
  return false;
}

/** An evidence array passes the gate if at least one entry is grounded. */
export function hasGroundedEvidence(evidence: unknown): boolean {
  return Array.isArray(evidence) && evidence.some((entry) => isGroundedEvidence(entry));
}

/** Whether opt-in strict resolution is requested via the environment.
 *  Enabled by DEFAULT (v0.1.95): file-style evidence locators MUST exist on disk.
 *  Set CW_REQUIRE_RESOLVABLE_EVIDENCE=0 to restore the prior shape-only check.
 *  Set CW_REQUIRE_RESOLVABLE_EVIDENCE=url for URL reachability checks too. */
export function requireResolvableEvidence(): boolean {
  const raw = process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE;
  if (raw === undefined || raw === null || raw === "") return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return true;
}

/** Whether URL reachability checks are enabled (v0.1.63). Always opt-in. */
export function requireUrlReachability(): boolean {
  return /url/i.test(process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE || "");
}

interface LocatorShape {
  kind: "url" | "file" | "opaque";
  pathPart?: string;
}

function classify(raw: string): LocatorShape {
  const value = raw.trim();
  if (!value) return { kind: "opaque" };
  if (URL_RE.test(value)) return { kind: "url" };
  const line = value.match(LINE_SUFFIX_RE);
  const pathPart = line ? value.slice(0, value.length - line[0].length) : value;
  const looksFile = (PATH_SEP_RE.test(pathPart) || FILE_EXT_RE.test(value)) && !/\s/.test(pathPart);
  return looksFile ? { kind: "file", pathPart } : { kind: "opaque" };
}

/** Resolve one locator against base dirs (used only in strict mode). */
export function resolveEvidenceLocator(raw: string, baseDirs: string[]): EvidenceResolution {
  const shape = classify(raw);
  if (shape.kind === "url") return "external";
  if (shape.kind === "opaque" || !shape.pathPart) return "opaque";
  const candidates = path.isAbsolute(shape.pathPart)
    ? [shape.pathPart]
    : baseDirs.filter(Boolean).map((base) => path.resolve(base, shape.pathPart as string));
  for (const candidate of candidates) {
    try {
      fs.statSync(candidate);
      return "resolved";
    } catch {
      /* try next base */
    }
  }
  return "unresolved";
}

/** In strict mode, the file-style locators that could NOT be resolved on disk.
 *  Returns [] when strict mode is off or all file locators resolve. */
export function unresolvedFileEvidence(evidence: unknown, baseDirs: string[]): string[] {
  if (!requireResolvableEvidence() || !Array.isArray(evidence)) return [];
  return evidence
    .map((entry) => String(entry))
    .filter((entry) => resolveEvidenceLocator(entry, baseDirs) === "unresolved");
}

/** Compute the confidence tier for a single evidence string. Deterministic:
 *  pure function of the string and optional base dirs for resolution. */
export function computeEvidenceConfidence(raw: unknown, baseDirs?: string[]): EvidenceConfidence {
  if (!isGroundedEvidence(raw)) return "ungrounded";
  if (!baseDirs || !baseDirs.length || !requireResolvableEvidence()) return "grounded";
  const value = String(raw).trim();
  const shape = classify(value);
  if (shape.kind === "url") return "grounded"; // URLs not resolved yet
  if (shape.kind === "opaque") return "grounded"; // namespace:value tokens are grounded
  // File-style: try resolution
  const resolution = resolveEvidenceLocator(value, baseDirs);
  return resolution === "resolved" ? "resolvable" : "grounded";
}

/** Compute confidence tiers for an array of evidence entries. */
export function computeEvidenceConfidenceTiers(
  evidence: unknown,
  baseDirs?: string[]
): EvidenceConfidence[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.map((entry) => computeEvidenceConfidence(entry, baseDirs));
}

/** The highest confidence tier in an evidence array. Used for gate decisions. */
export function maxEvidenceConfidence(
  evidence: unknown,
  baseDirs?: string[]
): EvidenceConfidence {
  const tiers = computeEvidenceConfidenceTiers(evidence, baseDirs);
  if (!tiers.length) return "ungrounded";
  const order: EvidenceConfidence[] = ["ungrounded", "grounded", "resolvable", "verified"];
  let max = "ungrounded" as EvidenceConfidence;
  for (const tier of tiers) {
    if (order.indexOf(tier) > order.indexOf(max)) max = tier;
  }
  return max;
}

/** Extract actual content from a file-style evidence locator (v0.1.74).
 *  For `file.ts:42`, reads the file and returns line 42's content.
 *  Never fabricates — returns undefined when the file doesn't exist or
 *  the locator is not file-style. Lines are 1-indexed. */
export function extractEvidenceContent(locator: string, baseDirs: string[]): string | undefined {
  const shape = classify(locator);
  if (shape.kind !== "file" || !shape.pathPart) return undefined;
  const lineMatch = locator.match(/:(\d+)$/);
  const lineNum = lineMatch ? Number(lineMatch[1]) : undefined;
  const candidatePath = path.isAbsolute(shape.pathPart)
    ? shape.pathPart
    : baseDirs.filter(Boolean).map((base) => path.resolve(base, shape.pathPart as string)).find((p) => fs.existsSync(p));
  if (!candidatePath) return undefined;
  try {
    const content = fs.readFileSync(candidatePath, "utf8");
    if (lineNum && lineNum > 0) {
      const lines = content.split("\n");
      return lines[lineNum - 1] || undefined;
    }
    // No line number: return first 200 chars as preview
    return content.slice(0, 200);
  } catch {
    return undefined;
  }
}
