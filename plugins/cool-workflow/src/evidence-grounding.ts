import fs from "node:fs";
import path from "node:path";

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
//  1. DEFAULT (pure, deterministic): require evidence to be GROUNDED — a URL, a
//     path-like locator, or a `namespace:value` token. This rejects bare prose
//     ("x", "anything", "HIGH severity") while accepting every shape CW itself
//     emits. Being a pure function of the string, it is replay-safe.
//
//  2. OPT-IN (CW_REQUIRE_RESOLVABLE_EVIDENCE=1): additionally resolve path-like
//     locators against the run's base dirs and fail closed if a file locator does
//     not exist on disk. Off by default because the resolving cwd is context-
//     dependent; on for self-audit / compliance where evidence MUST be checkable.
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

/** Whether opt-in strict resolution is requested via the environment. */
export function requireResolvableEvidence(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.CW_REQUIRE_RESOLVABLE_EVIDENCE || "");
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
