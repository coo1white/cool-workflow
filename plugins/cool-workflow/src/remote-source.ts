// src/remote-source.ts — materialize a REMOTE repository (a URL) into a LOCAL checkout
// so the existing review pipeline can run against it unchanged.
//
// This lives in the CAPABILITY layer and is imported ONLY by capability-core (+ smokes),
// never by the orchestrator/drive core — cloning is non-deterministic network I/O and the
// core must stay replay-deterministic. After materialize(), the caller points `args.repo`
// at the returned local path and everything downstream is identical to a local run.
//
// Zero runtime deps: `git` via spawnSync (the gitLines/gitOne shape from onramp.ts), plus
// node:crypto for the cache key. Fail closed: a bad URL / blocked scheme / network / auth
// failure throws an explicit error (never a fabricated success). All diagnostics are in the
// thrown message (the caller routes them to stderr); this module writes nothing to stdout.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveCwHome } from "./run-registry";

export type RemoteKind = "git" | "archive" | "local";

export interface RemoteSource {
  /** The local checkout the review runs against. */
  localPath: string;
  /** The sanitized URL (credentials stripped) — safe to print, persist, and record. */
  url: string;
  /** git: resolved HEAD SHA (40-hex). archive: sha256 of the downloaded bytes. */
  commit: string;
  kind: "git" | "archive";
  /** The requested branch/tag/ref, when given. */
  ref?: string;
  /** True when an existing cache entry was reused instead of re-fetched. */
  cached: boolean;
}

export interface MaterializeOpts {
  ref?: string;
  refresh?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Override the cache root (defaults to resolveCwHome()); used by tests. */
  home?: string;
  /** git clone timeout in ms (default 120s). */
  timeoutMs?: number;
}

/** git transport schemes we will hand to `git clone`. http is permitted (some internal
 *  servers), but `ext::`/`fd::` remote-helpers and anything else are rejected. */
const ALLOWED_SCHEMES = new Set(["https", "http", "ssh", "git", "file"]);
const ARCHIVE_EXT = /\.(tar\.gz|tgz|tar|zip)$/i;
const SCP_LIKE = /^[^/@\s]+@[^/@\s:]+:/; // git@host:owner/repo (no scheme)
const HELPER_LIKE = /^[a-z][a-z0-9+.-]*::/i; // ext::, fd::, transport::address

/** Classify a flag value as a git URL, an archive URL, or a local path. Conservative:
 *  a value with NO remote marker is "local", so a real directory is never mis-fetched. */
export function classifyRemote(value: string): RemoteKind {
  if (!value) return "local";
  const v = value.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
  const isScp = SCP_LIKE.test(v) && !v.includes("://");
  const isHelper = HELPER_LIKE.test(v);
  if (!hasScheme && !isScp && !isHelper) return "local";
  // Remote-ish. Archive by path extension (helpers/scp are always git-ish).
  const pathPart = hasScheme ? safePathname(v) : v;
  if (ARCHIVE_EXT.test(pathPart)) return "archive";
  return "git";
}

/** Convenience: is this value something we should materialize (vs treat as a local path)? */
export function isRemoteUrl(value: string): boolean {
  return classifyRemote(value) !== "local";
}

/** Strip credentials (userinfo) from a URL so it is safe to print/persist/record. scp-style
 *  (`git@host:…`) and local paths pass through unchanged (the `git@` user is not a secret). */
export function sanitizeUrl(value: string): string {
  const v = value.trim();
  if (SCP_LIKE.test(v) && !v.includes("://")) return v;
  try {
    const u = new URL(v);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return v;
  }
}

/** Fail-closed validation BEFORE any subprocess: reject option-injection, blocked transport
 *  helpers, and unknown schemes. Throws with an explicit reason; never returns a verdict. */
function assertSafeUrl(value: string): void {
  const v = value.trim();
  if (v.startsWith("-")) throw new Error(`refusing a URL that begins with '-' (option injection): ${v}`);
  if (HELPER_LIKE.test(v)) throw new Error(`blocked git transport helper in URL (e.g. ext::/fd::): ${v}`);
  if (SCP_LIKE.test(v) && !v.includes("://")) return; // scp-style is ssh
  let scheme: string;
  try {
    scheme = new URL(v).protocol.replace(/:$/, "").toLowerCase();
  } catch {
    throw new Error(`unparseable remote URL: ${v}`);
  }
  if (!ALLOWED_SCHEMES.has(scheme)) {
    throw new Error(`unsupported URL scheme '${scheme}:' (allowed: https, http, ssh, git, file): ${v}`);
  }
}

export interface RemoteValidation {
  ok: boolean;
  kind: RemoteKind;
  /** Sanitized URL (credentials stripped). */
  url: string;
  reason?: string;
}

/** Validate a remote URL's shape WITHOUT any network I/O (used by `--check`): recognized,
 *  scheme-allowlisted, no option-injection or blocked transport helper. Never fetches. */
export function validateRemoteUrl(value: string): RemoteValidation {
  const kind = classifyRemote(value);
  const url = sanitizeUrl(value);
  if (kind === "local") return { ok: false, kind, url, reason: "not a recognized remote URL (expected https/ssh/git/file or git@host:repo)" };
  try {
    assertSafeUrl(value);
  } catch (error) {
    return { ok: false, kind, url, reason: (error as Error).message };
  }
  return { ok: true, kind, url };
}

/** True when `git` is on PATH (used by `--check`; materialize asserts this too). */
export function gitAvailable(env?: NodeJS.ProcessEnv): boolean {
  return spawnSync("git", ["--version"], { encoding: "utf8", env: env || process.env }).status === 0;
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function cacheRoot(opts: MaterializeOpts): string {
  return path.join(opts.home || resolveCwHome(opts.env), "clones");
}

function cacheDirFor(root: string, sanitizedUrl: string, ref?: string): string {
  const key = createHash("sha256").update(`${sanitizedUrl}\0${ref || ""}`).digest("hex").slice(0, 24);
  return path.join(root, key);
}

/** Defense in depth: strip `user[:pass]@` userinfo from ANY URL in arbitrary text. git's own
 *  diagnostics can echo a credential-bearing URL on auth failure (version/transport dependent),
 *  so we never relay git's stderr/stdout verbatim — we redact first. Exported for testing. */
export function redactCredentials(text: string): string {
  return String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1");
}

/** Run a git subprocess, returning trimmed stdout; throws with a credential-REDACTED stderr
 *  tail on failure (never relays git output verbatim). */
function git(args: string[], opts: MaterializeOpts, cwd?: string): string {
  const env = {
    ...(opts.env || process.env),
    GIT_TERMINAL_PROMPT: "0", // fail closed instead of hanging on an auth prompt
    GIT_ASKPASS: "",
    GCM_INTERACTIVE: "never"
  };
  const result = spawnSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: opts.timeoutMs || 120000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) throw new Error(`git ${args[0]} could not run: ${redactCredentials(result.error.message)}`);
  if (result.status !== 0) {
    const raw = String(result.stderr || result.stdout || "").trim();
    const tail = redactCredentials(raw).split(/\r?\n/).slice(-3).join("; ");
    throw new Error(`git ${args[0]} failed: ${tail || `exit ${result.status}`}`);
  }
  return String(result.stdout || "").trim();
}

function assertGitAvailable(opts: MaterializeOpts): void {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", env: opts.env || process.env });
  if (result.status !== 0) throw new Error("git is required to review a remote repository but was not found on PATH");
}

function writeCloneMeta(dir: string, meta: Record<string, unknown>): void {
  try {
    fs.writeFileSync(path.join(dir, ".cw-clone-meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  } catch {
    /* meta is advisory (used by `cw clones`); never fail a clone over it */
  }
}

function cloneGit(rawUrl: string, sanitizedUrl: string, opts: MaterializeOpts): RemoteSource {
  const root = cacheRoot(opts);
  const dir = cacheDirFor(root, sanitizedUrl, opts.ref);
  // Containment: the target MUST be inside clones/ (the key is hex, so this always holds —
  // assert anyway so a future change can never write or, later, gc outside the cache root).
  if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`refusing clone target outside the cache root: ${dir}`);
  }

  if (fs.existsSync(path.join(dir, ".git")) && !opts.refresh) {
    const commit = git(["-C", dir, "rev-parse", "HEAD"], opts);
    if (commit) return { localPath: dir, url: sanitizedUrl, commit, kind: "git", ref: opts.ref, cached: true };
    // Corrupt cache entry — fall through to a fresh clone.
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  // Array argv + `--` before the URL (never a shell string); shallow + single-branch; repo
  // hooks disabled. The raw URL (which may carry credentials) is passed ONLY as an argv
  // element — it never reaches a shell and never gets persisted (we store the sanitized one).
  const args = [
    "clone",
    "--depth",
    "1",
    "--single-branch",
    ...(opts.ref ? ["--branch", opts.ref] : []),
    "-c",
    "core.hooksPath=",
    "--",
    rawUrl,
    dir
  ];
  try {
    git(args, opts);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not clone ${sanitizedUrl}: ${(error as Error).message}`);
  }
  const commit = git(["-C", dir, "rev-parse", "HEAD"], opts);
  if (!commit) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`cloned ${sanitizedUrl} but could not resolve HEAD`);
  }
  writeCloneMeta(dir, { url: sanitizedUrl, kind: "git", ref: opts.ref || null, commit, fetchedAt: new Date().toISOString() });
  return { localPath: dir, url: sanitizedUrl, commit, kind: "git", ref: opts.ref, cached: false };
}

/** Materialize a remote URL into a local checkout. Throws (fail closed) on any bad URL,
 *  blocked scheme, missing git, or fetch failure. The caller must have already decided the
 *  value is remote (classifyRemote !== "local"). */
export function materializeRemote(value: string, opts: MaterializeOpts = {}): RemoteSource {
  const kind = classifyRemote(value);
  if (kind === "local") throw new Error(`not a remote URL: ${value}`);
  assertSafeUrl(value);
  assertGitAvailable(opts);
  const sanitized = sanitizeUrl(value);
  if (kind === "archive") {
    // Implemented in the archive PR (download + extract + git-init snapshot). Until then,
    // fail closed with a clear, actionable message rather than mis-handling the URL.
    throw new Error(`archive links (.tar.gz/.tgz/.tar/.zip) are not supported yet — use a git URL: ${sanitized}`);
  }
  return cloneGit(value, sanitized, opts);
}
