// core/trust/evidence-grounding.ts — is a piece of evidence grounded, and
// what does it cite. Pure: disk reads come in as caller-supplied functions.

export type EvidenceConfidence = "ungrounded" | "grounded" | "resolvable" | "verified";
export type EvidenceResolution = "resolved" | "unresolved" | "external" | "opaque";

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PATH_SEP_RE = /[\\/]/;
const FILE_EXT_RE = /\.[A-Za-z0-9]{1,12}(?::\d+(?:-\d+)?)?$/;
const NAMESPACE_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_.-]*:\S/;
const LINE_SUFFIX_RE = /:(\d+(?:-\d+)?)$/;
const RECEIPT_PREFIX = "receipt:";

/** Grounded = machine-shaped (a URL, a path, a `namespace:value`), not prose. */
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

/** The file path a locator points at (without any `:line` suffix), or null when
 *  the locator is a URL, an opaque namespace token, or free text. */
export function evidenceFilePath(raw: unknown): string | null {
  const shape = classify(String(raw ?? ""));
  return shape.kind === "file" && shape.pathPart ? shape.pathPart : null;
}

/** The verdict task, whose file evidence is also checked at accept time. */
export function isVerdictTaskId(taskId: string): boolean {
  return /^verdict[:/]|^synthesis[:/]/i.test(taskId);
}

/** On by default: file locators must exist on disk.
 *  `CW_REQUIRE_RESOLVABLE_EVIDENCE=0` checks shape only. */
export function requireResolvableEvidence(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CW_REQUIRE_RESOLVABLE_EVIDENCE;
  if (raw === undefined || raw === null || raw === "") return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  return true;
}

interface LocatorShape {
  kind: "url" | "file" | "receipt" | "opaque";
  pathPart?: string;
}

function classify(raw: string): LocatorShape {
  const value = raw.trim();
  if (!value) return { kind: "opaque" };
  if (URL_RE.test(value)) return { kind: "url" };
  if (value.startsWith(RECEIPT_PREFIX)) return { kind: "receipt", pathPart: value.slice(RECEIPT_PREFIX.length) };
  const line = value.match(LINE_SUFFIX_RE);
  const pathPart = line ? value.slice(0, value.length - line[0].length) : value;
  const looksFile = (PATH_SEP_RE.test(pathPart) || FILE_EXT_RE.test(value)) && !/\s/.test(pathPart);
  return looksFile ? { kind: "file", pathPart } : { kind: "opaque" };
}

/** The receipt ids an evidence list cites as `receipt:<id>`, in order, no repeats. */
export function receiptIdsIn(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return [];
  const ids = evidence.map((entry) => classify(String(entry ?? ""))).filter((shape) => shape.kind === "receipt").map((shape) => shape.pathPart || "");
  return [...new Set(ids)];
}

/** Resolve one locator against base dirs (strict mode only). */
export function resolveEvidenceLocator(raw: string, baseDirs: string[], exists: (p: string) => boolean, isAbsolute: (p: string) => boolean, resolvePath: (base: string, rel: string) => string): EvidenceResolution {
  const shape = classify(raw);
  if (shape.kind === "url") return "external";
  if (shape.kind !== "file" || !shape.pathPart) return "opaque";
  const candidates = isAbsolute(shape.pathPart) ? [shape.pathPart] : baseDirs.filter(Boolean).map((base) => resolvePath(base, shape.pathPart as string));
  for (const candidate of candidates) {
    if (exists(candidate)) return "resolved";
  }
  return "unresolved";
}

export interface PathOps {
  exists: (p: string) => boolean;
  isAbsolute: (p: string) => boolean;
  resolve: (base: string, rel: string) => string;
}

/** In strict mode, the file locators not found on disk. */
export function unresolvedFileEvidence(evidence: unknown, baseDirs: string[], ops: PathOps, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!requireResolvableEvidence(env) || !Array.isArray(evidence)) return [];
  return evidence.map((entry) => String(entry)).filter((entry) => resolveEvidenceLocator(entry, baseDirs, ops.exists, ops.isAbsolute, ops.resolve) === "unresolved");
}

export interface LinePastEnd {
  path: string;
  line: number;
  lines: number;
}

export function lineCitedPastEnd(evidence: unknown, baseDirs: string[], ops: PathOps, readFile: (p: string) => string | undefined): LinePastEnd | null {
  if (!Array.isArray(evidence)) return null;
  for (const entry of evidence) {
    const raw = String(entry ?? "").trim();
    const shape = classify(raw);
    const lineMatch = raw.match(/:(\d+)(?:-(\d+))?$/);
    if (shape.kind !== "file" || !shape.pathPart || !lineMatch) continue;
    const line = Math.max(Number(lineMatch[1]), lineMatch[2] ? Number(lineMatch[2]) : 0);
    const candidate = ops.isAbsolute(shape.pathPart) ? shape.pathPart : baseDirs.filter(Boolean).map((base) => ops.resolve(base, shape.pathPart as string)).find((p) => ops.exists(p));
    const content = candidate && ops.exists(candidate) ? readFile(candidate) : undefined;
    if (content === undefined) continue;
    const lines = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    if (line > lines) return { path: shape.pathPart, line, lines };
  }
  return null;
}

/** The cited lines (1-indexed) of a file locator, or undefined; never
 *  made up. */
export function extractEvidenceContent(
  locator: string,
  baseDirs: string[],
  ops: PathOps,
  readFile: (p: string) => string | undefined
): string | undefined {
  const shape = classify(locator);
  if (shape.kind !== "file" || !shape.pathPart) return undefined;
  // ":<n>" and ":<n>-<m>", as LINE_SUFFIX_RE accepts; else a range would
  // fall through to the head of the file.
  const lineMatch = locator.match(/:(\d+)(?:-(\d+))?$/);
  const lineNum = lineMatch ? Number(lineMatch[1]) : undefined;
  const lineEnd = lineMatch && lineMatch[2] ? Number(lineMatch[2]) : undefined;
  const candidatePath = ops.isAbsolute(shape.pathPart)
    ? shape.pathPart
    : baseDirs.filter(Boolean).map((base) => ops.resolve(base, shape.pathPart as string)).find((p) => ops.exists(p));
  if (!candidatePath) return undefined;
  const content = readFile(candidatePath);
  if (content === undefined) return undefined;
  if (lineNum && lineNum > 0) {
    const lines = content.split("\n");
    if (lineEnd !== undefined) {
      // A backwards or out-of-range span gives undefined.
      if (lineEnd < lineNum || lineNum > lines.length) return undefined;
      return lines.slice(lineNum - 1, Math.min(lineEnd, lines.length)).join("\n") || undefined;
    }
    return lines[lineNum - 1] || undefined;
  }
  return content.slice(0, 200);
}
