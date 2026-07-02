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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCwHome } from "./run-registry";

/** Upper bound on a downloaded archive (200 MiB) — a review target should be source, not a
 *  binary blob; a giant download fails closed rather than exhausting disk/memory. */
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
/** Upper bound on the EXTRACTED tree (1 GiB) — a small archive can decompress to terabytes
 *  (a "zip bomb"). We reject by declared size before extracting AND by actual size after. */
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;

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
  if (kind === "archive") return downloadArchive(value, sanitized, opts);
  return cloneGit(value, sanitized, opts);
}

// ---- archive download + extract (.tar.gz / .tgz / .tar / .zip) --------------------------

/** Read a cached archive checkout's content sha from its meta, or undefined to re-fetch. */
function cachedArchive(dir: string, sanitizedUrl: string, opts: MaterializeOpts): RemoteSource | undefined {
  if (opts.refresh || !fs.existsSync(path.join(dir, ".git"))) return undefined;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, ".cw-clone-meta.json"), "utf8"));
    if (meta && typeof meta.commit === "string" && meta.commit) {
      return { localPath: dir, url: sanitizedUrl, commit: meta.commit, kind: "archive", ref: opts.ref, cached: true };
    }
  } catch {
    /* corrupt/absent meta — fall through to a fresh download */
  }
  return undefined;
}

/** Fetch the archive bytes to a temp file: `file://` is read directly; http(s) is fetched in a
 *  short node subprocess (Node's built-in fetch — zero deps — run synchronously via spawnSync,
 *  since the whole CLI flow is synchronous). The URL is an argv element, never a shell string.
 *  SSRF-hardened: redirects are followed MANUALLY and each hop is re-validated (http(s) scheme
 *  only, no private/loopback/link-local host) BEFORE we connect to it — so a public URL cannot
 *  redirect us into an internal service. The operator's ORIGINAL host is their own choice. */
function fetchArchiveBytes(rawUrl: string, sanitizedUrl: string, dest: string, opts: MaterializeOpts): void {
  if (rawUrl.startsWith("file://")) {
    const src = fileURLToPath(rawUrl);
    const size = fs.statSync(src).size;
    if (size > MAX_ARCHIVE_BYTES) throw new Error(`archive ${sanitizedUrl} is too large (${size} bytes > ${MAX_ARCHIVE_BYTES})`);
    fs.copyFileSync(src, dest);
    return;
  }
  const child = [
    "const fs=require('fs');",
    "const [url,out,cap]=[process.argv[1],process.argv[2],Number(process.argv[3])];",
    "const priv=(h)=>{h=String(h).replace(/^\\[|\\]$/g,'').toLowerCase();",
    "if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local'))return true;",
    "if(h==='::1'||h==='0.0.0.0'||h==='::'||h.startsWith('fe80:')||h.startsWith('fc')||h.startsWith('fd'))return true;",
    "const m=h.match(/^(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)$/);",
    "if(m){const a=+m[1],b=+m[2];if(a===127||a===10||a===0||(a===192&&b===168)||(a===172&&b>=16&&b<=31)||(a===169&&b===254))return true;}",
    "return false;};",
    "(async()=>{let u=url;",
    "for(let i=0;i<6;i++){",
    "const r=await fetch(u,{redirect:'manual'});",
    "if(r.status>=300&&r.status<400&&r.headers.get('location')){",
    "const nx=new URL(r.headers.get('location'),u);",
    "if(!/^https?:$/.test(nx.protocol)){process.stderr.write('redirect to disallowed scheme '+nx.protocol);process.exit(5);}",
    "if(priv(nx.hostname)){process.stderr.write('redirect to a private/internal host was blocked');process.exit(5);}",
    "u=nx.href;continue;}",
    "if(!r.ok){process.stderr.write('HTTP '+r.status+' '+r.statusText);process.exit(2);}",
    "const len=Number(r.headers.get('content-length')||0);",
    "if(cap&&len>cap){process.stderr.write('archive too large');process.exit(3);}",
    "if(!r.body||!r.body.getReader){process.stderr.write('response body is not streamable');process.exit(4);}",
    "const fd=fs.openSync(out,'w');let total=0;",
    "try{const reader=r.body.getReader();for(;;){const x=await reader.read();if(x.done)break;",
    "const chunk=Buffer.from(x.value);total+=chunk.length;",
    "if(cap&&total>cap){try{await reader.cancel();}catch{};fs.closeSync(fd);fs.rmSync(out,{force:true});process.stderr.write('archive too large');process.exit(3);}",
    "fs.writeSync(fd,chunk,0,chunk.length);}fs.closeSync(fd);return;}",
    "catch(e){try{fs.closeSync(fd);}catch{};fs.rmSync(out,{force:true});throw e;}}",
    "process.stderr.write('too many redirects');process.exit(6);",
    "})().catch(e=>{process.stderr.write(String((e&&e.message)||e));process.exit(4);});"
  ].join("");
  const result = spawnSync(process.execPath, ["-e", child, rawUrl, dest, String(MAX_ARCHIVE_BYTES)], {
    encoding: "utf8",
    timeout: opts.timeoutMs || 120000,
    env: opts.env || process.env,
    stdio: ["ignore", "ignore", "pipe"]
  });
  if (result.status !== 0) {
    fs.rmSync(dest, { force: true });
    throw new Error(`could not download ${sanitizedUrl}: ${redactCredentials(String(result.stderr || "").trim()) || `exit ${result.status}`}`);
  }
}

/** List an archive's entry NAMES WITHOUT extracting (the zip-slip/tar-slip name guard runs on
 *  this). Symlinks/specials and decompression bombs are caught separately (below). */
function listArchive(file: string, isZip: boolean): string[] {
  const cmd = isZip ? ["unzip", "-Z1", "--", file] : ["tar", "-tf", file];
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (result.status !== 0) {
    // Distinguish "unzip not installed" (ENOENT) from "archive is corrupt" — never conflate the
    // two (a corrupt .tar mislabeled .zip used to surface a bogus "unzip not found").
    if (isZip && (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error("unzip is required to review a .zip link but was not found on PATH (use a .tar.gz or a git URL)");
    }
    if (!isZip && (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error("tar is required to review a .tar/.tgz link but was not found on PATH");
    }
    throw new Error(`could not read archive: ${String(result.stderr || "").trim() || `exit ${result.status}`}`);
  }
  return String(result.stdout || "").split(/\r?\n/).filter(Boolean);
}

/** Reject any entry that would escape the extraction dir (absolute path or a `..` segment). */
function assertNoTraversal(entries: string[], sanitizedUrl: string): void {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    if (path.isAbsolute(normalized) || normalized.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(normalized)) {
      throw new Error(`refusing archive ${sanitizedUrl}: unsafe path escapes the extraction dir: ${entry}`);
    }
  }
}

/** Declared uncompressed size, read WITHOUT extracting — gzip's ISIZE trailer for `.tar.gz`/
 *  `.tgz`, or `unzip -l`'s total for `.zip`. Best-effort (undefined when unknown); the
 *  post-extraction walk is authoritative. Lets us reject a bomb BEFORE it fills the disk. */
function declaredUncompressedSize(file: string, isZip: boolean): number | undefined {
  try {
    if (isZip) {
      const r = spawnSync("unzip", ["-l", "--", file], { encoding: "utf8" });
      if (r.status !== 0) return undefined;
      const lines = String(r.stdout || "").trim().split(/\r?\n/);
      const m = (lines[lines.length - 1] || "").match(/^\s*(\d+)\s+\d+\s+files?/);
      return m ? Number(m[1]) : undefined;
    }
    const fd = fs.openSync(file, "r");
    try {
      const head = Buffer.alloc(2);
      fs.readSync(fd, head, 0, 2, 0);
      if (head[0] !== 0x1f || head[1] !== 0x8b) return undefined; // not gzip (plain .tar — its file size already ≤ the download cap)
      const size = fs.fstatSync(fd).size;
      const tail = Buffer.alloc(4);
      fs.readSync(fd, tail, 0, 4, size - 4);
      return tail.readUInt32LE(0); // ISIZE (mod 2^32)
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

/** Walk the EXTRACTED tree (without following symlinks) and fail closed on anything a reviewed
 *  source archive must not contain: a symlink or other non-regular entry (defends the symlink
 *  traversal class regardless of tar/unzip version), or a total size over the bomb cap. */
function assertSafeTree(root: string, sanitizedUrl: string): void {
  let total = 0;
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p); // lstat: do NOT follow symlinks
      if (st.isSymbolicLink()) {
        throw new Error(`refusing archive ${sanitizedUrl}: contains a symlink (${path.relative(root, p)}); symlinks are not allowed in a reviewed source archive`);
      }
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (!st.isFile()) {
        throw new Error(`refusing archive ${sanitizedUrl}: contains a non-regular entry (${path.relative(root, p)})`);
      }
      total += st.size;
      if (total > MAX_EXTRACTED_BYTES) {
        throw new Error(`refusing archive ${sanitizedUrl}: extracted size exceeds ${MAX_EXTRACTED_BYTES} bytes (possible decompression bomb)`);
      }
    }
  };
  walk(root);
}

function gitSnapshot(dir: string, message: string, opts: MaterializeOpts): void {
  const base = ["-c", "user.email=cw@local", "-c", "user.name=cw", "-c", "commit.gpgsign=false", "-c", "core.hooksPath="];
  git([...base, "-C", dir, "init", "-q"], opts);
  git([...base, "-C", dir, "add", "-A"], opts);
  git([...base, "-C", dir, "commit", "-q", "--allow-empty", "-m", message], opts);
}

function downloadArchive(rawUrl: string, sanitizedUrl: string, opts: MaterializeOpts): RemoteSource {
  assertGitAvailable(opts); // we snapshot the extracted tree into a local git repo
  const root = cacheRoot(opts);
  const dir = cacheDirFor(root, sanitizedUrl, opts.ref);
  if (!path.resolve(dir).startsWith(path.resolve(root) + path.sep)) {
    throw new Error(`refusing extract target outside the cache root: ${dir}`);
  }
  const reuse = cachedArchive(dir, sanitizedUrl, opts);
  if (reuse) return reuse;

  fs.mkdirSync(root, { recursive: true });
  // Detect zip from the URL path only (consistent with classifyRemote); the staging dir is
  // mkdtemp-unique, so the temp download file can never collide with a concurrent same-URL run.
  const isZip = /\.zip$/i.test(safePathname(rawUrl));
  const staging = fs.mkdtempSync(path.join(root, ".stage-"));
  const tmpFile = path.join(staging, isZip ? "archive.zip" : "archive.tar");
  try {
    fetchArchiveBytes(rawUrl, sanitizedUrl, tmpFile, opts);
    const commit = createHash("sha256").update(fs.readFileSync(tmpFile)).digest("hex"); // content address
    // Bomb defense (BEFORE extracting, to avoid filling the disk): reject a declared
    // uncompressed size over the cap. assertSafeTree re-checks the ACTUAL size afterward.
    const declared = declaredUncompressedSize(tmpFile, isZip);
    if (declared !== undefined && declared > MAX_EXTRACTED_BYTES) {
      throw new Error(`refusing archive ${sanitizedUrl}: declared uncompressed size ${declared} exceeds ${MAX_EXTRACTED_BYTES} bytes (possible decompression bomb)`);
    }
    assertNoTraversal(listArchive(tmpFile, isZip), sanitizedUrl);
    const extractDir = fs.mkdtempSync(path.join(staging, "x-"));
    const ex = isZip
      ? spawnSync("unzip", ["-q", "-o", "-d", extractDir, "--", tmpFile], { encoding: "utf8" })
      : spawnSync("tar", ["-xf", tmpFile, "-C", extractDir], { encoding: "utf8" });
    if (ex.status !== 0) throw new Error(`could not extract archive ${sanitizedUrl}: ${String(ex.stderr || "").trim() || `exit ${ex.status}`}`);
    // Fail closed on symlinks/specials and on an over-cap actual extracted size.
    assertSafeTree(extractDir, sanitizedUrl);
    // Many archives (e.g. GitHub tarballs) wrap everything in a single top-level dir; descend
    // into it so the review sees the project root, not a one-entry wrapper. lstat (NOT stat) so
    // a top-level SYMLINK is never treated as a directory (assertSafeTree already rejected one).
    const top = fs.readdirSync(extractDir);
    const contentRoot = top.length === 1 && fs.lstatSync(path.join(extractDir, top[0])).isDirectory() ? path.join(extractDir, top[0]) : extractDir;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(contentRoot, dir); // same filesystem (both under clones/) — atomic move
    gitSnapshot(dir, `snapshot of ${sanitizedUrl}`, opts); // make it a real local repo at HEAD
    writeCloneMeta(dir, { url: sanitizedUrl, kind: "archive", ref: opts.ref || null, commit, fetchedAt: new Date().toISOString() });
    return { localPath: dir, url: sanitizedUrl, commit, kind: "archive", ref: opts.ref, cached: false };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
