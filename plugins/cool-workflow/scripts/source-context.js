#!/usr/bin/env node
"use strict";

// source-context — opt-in JSONL source context exporter.
//
// Policy is data in manifest/source-context-profiles.json. This script is only
// mechanism: enumerate tracked files for a git ref, classify them through the
// selected profile, hash the committed bytes, and print JSONL to stdout.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const pluginRoot = path.resolve(__dirname, "..");
const defaultRepoRoot = path.resolve(pluginRoot, "..", "..");
let repoRoot = defaultRepoRoot;
const DEFAULT_PROFILE_FILE = path.join(pluginRoot, "manifest", "source-context-profiles.json");

const command = process.argv[2];
const args = process.argv.slice(3);

function main() {
  if (!["export", "manifest", "profiles"].includes(command)) {
    usage(1, `unknown command: ${command || "(missing)"}`);
    return;
  }

  const profileFile = valueArg("--profile-file") || DEFAULT_PROFILE_FILE;
  repoRoot = path.resolve(valueArg("--repo-root") || defaultRepoRoot);
  const profiles = readProfiles(profileFile);

  if (command === "profiles") {
    for (const [id, profile] of Object.entries(profiles.profiles)) {
      writeJsonl({
        schemaVersion: profiles.schemaVersion,
        id,
        description: profile.description || "",
        maxLines: Number(profile.maxLines) || null,
        include: profile.include || [],
        exclude: profile.exclude || []
      });
    }
    return;
  }

  // --profile-file alone (no --profile) uses that file's sole profile instead of
  // falling back to "core" (which a hand-written external-repo profile rarely
  // defines). A custom file with several profiles is ambiguous, so it fails
  // closed with the choices. Only the bundled default file defaults to "core".
  const explicitProfile = valueArg("--profile");
  const usingCustomProfileFile = valueArg("--profile-file") !== "";
  const profileId = explicitProfile || defaultProfileId(profiles, usingCustomProfileFile, profileFile);
  const profile = profiles.profiles[profileId];
  if (!profile) die(`unknown profile: ${profileId}`);

  const ref = resolveRef(valueArg("--ref") || "HEAD");
  const changedFrom = valueArg("--changed-from") ? resolveRef(valueArg("--changed-from")) : "";
  const changedPaths = changedFrom ? changedPathSet(changedFrom, ref) : null;
  // Resolved once and folded into the cache key: --max-lines is an override that
  // does not change the exported content, but a warm cache served before the
  // maxLines guard runs would let a tighter cap be silently ignored. Keying on it
  // makes a different effective cap miss the cache so the guard re-runs (fail closed).
  const maxLines = resolveMaxLines(profile);
  const cacheDir = command === "export" ? valueArg("--cache-dir") : "";
  const cachePath = cacheDir ? sourceContextCachePath(cacheDir, profileId, ref, profile, changedFrom, maxLines) : "";
  if (cachePath && fs.existsSync(cachePath)) {
    process.stdout.write(readValidCache(cachePath, profileId, ref, changedFrom));
    return;
  }

  // Enumerate tree entries WITH mode/type/oid (not just names) so a git
  // submodule (a gitlink) is recognised and recorded, not read as a blob; and
  // read blob content BY OBJECT ID, never by "<ref>:<path>", so no filename —
  // however odd — can break the cat-file request stream. `-z` also stops git
  // quoting any path byte class (non-ASCII, backslash, quote, control chars).
  const entries = treeEntries(ref).filter((entry) => !changedPaths || changedPaths.has(entry.path));
  const blobs = gitBlobsByOid(entries.filter((entry) => entry.type === "blob").map((entry) => entry.oid));
  let exportedLines = 0;
  const buffered = cachePath ? [] : null;
  const emit = (value) => {
    if (buffered) buffered.push(JSON.stringify(value));
    else writeJsonl(value);
  };

  for (const entry of entries) {
    const file = entry.path;
    const classification = classify(file, profile);

    // A non-blob tree entry (a submodule gitlink is type "commit") has no text
    // content in this repo. Record it as an omission, never a die.
    if (entry.type !== "blob") {
      const record = {
        schemaVersion: profiles.schemaVersion, profile: profileId, ref, path: file,
        bytes: null, lines: null, sha256: null,
        included: false, reason: entry.type === "commit" ? "submodule" : `non-blob:${entry.type}`,
        ...(changedFrom ? { changedFrom } : {})
      };
      if (command === "manifest") emit(record);
      continue;
    }

    const blob = blobs.get(entry.oid);
    if (!blob) die(`cannot read ${file} at ${ref}`);
    // A blob can only join a UTF-8 text pack if it round-trips through UTF-8 and
    // holds no NUL byte. A binary (NUL) or a non-UTF-8 text file (latin-1, GBK,
    // Shift-JIS, a lone 0xFF) is recorded as an omission with its reason — bytes
    // and sha256 of the raw blob kept — rather than aborting the run OR emitting
    // lossy `toString("utf8")` content whose digest would not match the record
    // (which also poisoned the export cache on re-read).
    const packReason = packableReason(blob);
    const includedInPack = classification.included && packReason === null;
    const reason = classification.included && packReason !== null ? packReason : classification.reason;
    const record = {
      schemaVersion: profiles.schemaVersion,
      profile: profileId,
      ref,
      path: file,
      bytes: blob.length,
      lines: packReason === null ? countLines(blob) : null,
      sha256: sha256(blob),
      included: includedInPack,
      reason,
      ...(changedFrom ? { changedFrom } : {})
    };

    if (command === "manifest") {
      emit(record);
      continue;
    }

    if (!includedInPack) continue;
    exportedLines += record.lines || 0;
    emit({ ...record, content: blob.toString("utf8") });
  }

  if (command === "export" && maxLines > 0 && exportedLines > maxLines) {
    die(`profile ${profileId} exported ${exportedLines} lines, above maxLines ${maxLines} (raise it with --max-lines N)`);
  }
  if (cachePath && buffered) {
    const text = buffered.map((line) => `${line}\n`).join("");
    writeCache(cachePath, text);
    process.stdout.write(text);
  }
}

// The profile to use when --profile is omitted: "core" for the bundled default
// file; for a custom --profile-file, its sole profile (fail closed with the
// choices if it defines more than one).
function defaultProfileId(profiles, usingCustomProfileFile, profileFile) {
  if (!usingCustomProfileFile) return "core";
  const ids = Object.keys(profiles.profiles || {});
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) die(`--profile-file ${rel(profileFile)} defines no profiles`);
  die(`--profile-file ${rel(profileFile)} defines ${ids.length} profiles (${ids.join(", ")}); pass --profile <name> to choose one`);
}

// --max-lines N overrides a profile's maxLines guard (0 = no cap). Without it,
// the profile's own maxLines applies, exactly as before. The raw token must be
// plain decimal digits, so a whitespace-only, hex (0x..), or exponent (1e..)
// value is refused rather than silently coerced to 0 (= cap disabled) — a safety
// flag must not fail open on a typo.
function resolveMaxLines(profile) {
  const arg = valueArg("--max-lines");
  if (arg === "") return Number(profile.maxLines) || 0;
  if (!/^\d+$/.test(arg.trim())) die(`--max-lines must be a non-negative integer, got: ${JSON.stringify(arg)}`);
  const n = Number(arg.trim());
  if (!Number.isSafeInteger(n)) die(`--max-lines is too large: ${arg}`);
  return n;
}

function usage(code, message) {
  if (message) process.stderr.write(`source-context: ${message}\n`);
  process.stderr.write(
    [
      "usage:",
      "  node scripts/source-context.js profiles",
      "  node scripts/source-context.js manifest [--profile ID] [--profile-file PATH] [--ref HEAD] [--changed-from REF] [--repo-root DIR]",
      "  node scripts/source-context.js export [--profile ID] [--profile-file PATH] [--max-lines N] [--ref HEAD] [--changed-from REF] [--repo-root DIR] [--cache-dir DIR]",
      "",
      "  --profile defaults to 'core' for the bundled profiles; with a custom",
      "  --profile-file that defines a single profile, --profile may be omitted.",
      "  --max-lines N overrides the selected profile's maxLines guard (0 = no cap)."
    ].join("\n") + "\n"
  );
  process.exitCode = code;
}

function valueArg(name) {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : "";
}

function readProfiles(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    die(`cannot read profile file ${rel(file)}: ${error.message}`);
  }
  if (!parsed || parsed.schemaVersion !== 1 || !parsed.profiles || typeof parsed.profiles !== "object") {
    die(`invalid source context profile file: ${rel(file)}`);
  }
  for (const [id, profile] of Object.entries(parsed.profiles)) {
    if (!Array.isArray(profile.include) || !Array.isArray(profile.exclude)) {
      die(`profile ${id} must define include and exclude arrays`);
    }
  }
  return parsed;
}

function resolveRef(ref) {
  return git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

function changedPathSet(base, ref) {
  // `-z` NUL-delimits and never quotes a path, so a changed file with any name
  // (non-ASCII, backslash, quote, control char) is matched, not silently missed.
  return new Set(git(["diff", "--name-only", "-z", "--diff-filter=ACMRT", `${base}..${ref}`]).split("\0").filter(Boolean));
}

function git(argv) {
  // maxBuffer matches the cat-file reader: `ls-tree -r -z` (full mode/type/oid
  // rows) is ~3x the old `--name-only` output, so the Node default 1 MiB would
  // overflow on a mid-size repo and abort. result.error is checked so an
  // overflow (ENOBUFS) or a spawn failure reports a real message, not an empty die.
  const result = spawnSync("git", argv, { cwd: repoRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 256 });
  if (result.error) die(`git ${argv.join(" ")}: ${result.error.message}`);
  if (result.status !== 0) die((result.stderr || result.stdout || `git ${argv.join(" ")} failed`).trim());
  return result.stdout;
}

function treeEntries(ref) {
  // `ls-tree -r -z` emits one record per file: "<mode> <type> <oid>\t<path>\0".
  // `-z` NUL-terminates and never quotes the path, so any filename byte class
  // survives. Non-blob rows (a submodule is type "commit") are kept so the
  // caller can record them rather than reading them as blobs.
  const out = git(["ls-tree", "-r", "-z", ref]);
  const entries = [];
  for (const rec of out.split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    if (tab < 0) die(`cannot parse tree entry: ${rec}`);
    const meta = rec.slice(0, tab).split(" ");
    if (meta.length !== 3) die(`cannot parse tree entry header: ${rec.slice(0, tab)}`);
    entries.push({ mode: meta[0], type: meta[1], oid: meta[2], path: rec.slice(tab + 1) });
  }
  return entries;
}

function gitBlobsByOid(oids) {
  const blobs = new Map();
  const unique = [...new Set(oids)];
  if (unique.length === 0) return blobs;
  // Request blobs by object id — a hex OID can never contain a newline or a
  // special byte, so the cat-file request stream is safe for any repo.
  const input = unique.map((oid) => `${oid}\n`).join("");
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: Buffer.from(input, "utf8"),
    maxBuffer: 1024 * 1024 * 256
  });
  // result.error is checked so an over-cap repo (ENOBUFS) reports a real message
  // rather than the empty/truncated dump the bare status check would produce.
  if (result.error) die(`git cat-file --batch: ${result.error.message}`);
  if (result.status !== 0) die((result.stderr || result.stdout || `git cat-file --batch failed`).toString().trim());

  let offset = 0;
  for (const oid of unique) {
    const headerEnd = result.stdout.indexOf(10, offset);
    if (headerEnd < 0) die(`cannot read ${oid}: truncated batch header`);
    const header = result.stdout.slice(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    const parts = header.split(" ");
    if (parts.length !== 3 || parts[1] !== "blob") die(`cannot read ${oid}: ${header}`);
    const size = Number(parts[2]);
    if (!Number.isSafeInteger(size) || size < 0) die(`cannot read ${oid}: invalid blob size`);
    const end = offset + size;
    if (end > result.stdout.length) die(`cannot read ${oid}: truncated blob`);
    blobs.set(oid, result.stdout.slice(offset, end));
    offset = end;
    if (result.stdout[offset] === 10) offset++;
  }
  return blobs;
}

function classify(file, profile) {
  const excludedBy = (profile.exclude || []).find((pattern) => matches(pattern, file));
  if (excludedBy) return { included: false, reason: `excluded:${excludedBy}` };
  const includedBy = (profile.include || []).find((pattern) => matches(pattern, file));
  if (includedBy) return { included: true, reason: `included:${includedBy}` };
  return { included: false, reason: "not-included" };
}

function matches(pattern, file) {
  // Fast path only for a WILDCARD-FREE prefix + trailing `/**` (e.g. `src/**`).
  // A prefix that itself holds a wildcard (`**/dist/**`, `packages/*/dist/**`)
  // must fall through to globToRegExp, or the literal prefix compare would
  // silently match nothing and the exclude would be a no-op.
  if (pattern.endsWith("/**") && !pattern.slice(0, -3).includes("*")) {
    const dir = pattern.slice(0, -3);
    return file === dir || file.startsWith(`${dir}/`);
  }
  if (!pattern.includes("*")) return file === pattern;
  return globToRegExp(pattern).test(file);
}

// Translate a glob to an anchored RegExp: `**` crosses directory separators
// while a single `*` matches within one segment. A `**/` at a boundary also
// matches zero path segments, so `**/*.test.ts` matches `x.test.ts`,
// `a/x.test.ts`, and `a/b/x.test.ts` alike. Runs of `**`/`**​/` are coalesced and
// a bounded `(?:[^/]+/)*` is used (never `.*`), so stacked globstars such as
// `src/**/**/*.ts` cannot cause catastrophic backtracking (ReDoS) — the matcher
// runs once per pattern per file over the whole tree, on untrusted profiles.
function globToRegExp(pattern) {
  let re = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i];
    if (c === "*") {
      let stars = 0;
      while (i < n && pattern[i] === "*") { stars += 1; i += 1; }
      if (stars >= 2) {
        // Globstar. Coalesce any immediately-following `/​**` runs so two
        // unbounded groups are never emitted adjacently. Track whether a slash
        // bounds it into whole segments.
        let boundedBySlash = false;
        while (i < n && pattern[i] === "/") {
          let j = i + 1;
          let following = 0;
          while (j < n && pattern[j] === "*") { following += 1; j += 1; }
          if (following >= 2) { i = j; boundedBySlash = true; continue; }
          i += 1; boundedBySlash = true; break;
        }
        // `(?:[^/]+/)*` matches zero or more whole segments and, unlike `.*`,
        // backtracks only per segment. A bare globstar (no bounding slash) still
        // crosses separators via `.*`, but coalescing keeps it non-adjacent.
        re += boundedBySlash ? "(?:[^/]+/)*" : ".*";
      } else {
        re += "[^/]*"; // a single `*` stays within one path segment
      }
    } else if (/[|\\{}()[\]^$+?.]/.test(c)) {
      re += `\\${c}`; i += 1;
    } else {
      re += c; i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

function countLines(buffer) {
  if (buffer.length === 0) return 0;
  let count = 0;
  for (const byte of buffer) if (byte === 10) count++;
  return buffer[buffer.length - 1] === 10 ? count : count + 1;
}

// Why a blob cannot join a UTF-8 text pack, or null if it can. A NUL byte marks
// binary (images, UTF-16, compiled output). A blob that does not round-trip
// through UTF-8 is non-UTF-8 text (latin-1, GBK, Shift-JIS, a lone 0xFF): its
// lossy `toString("utf8")` would not hash back to the record's raw-blob sha256,
// so it is recorded as an omission instead of corrupting the pack (and its cache).
function packableReason(buffer) {
  if (buffer.includes(0)) return "binary";
  if (!Buffer.from(buffer.toString("utf8"), "utf8").equals(buffer)) return "non-utf8";
  return null;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function profileDigest(profileId, profile) {
  return sha256(Buffer.from(stableStringify({ profileId, profile }), "utf8"));
}

function sourceContextCachePath(cacheDir, profileId, ref, profile, changedFrom, maxLines) {
  const safeProfile = String(profileId).replace(/[^A-Za-z0-9_.-]/g, "_");
  const diffPart = changedFrom ? `-changed-${changedFrom.slice(0, 12)}` : "";
  const digest = sha256(Buffer.from(stableStringify({ profileId, profile, changedFrom: changedFrom || "", maxLines: Number(maxLines) || 0 }), "utf8")).slice(0, 16);
  return path.join(path.resolve(cacheDir), `${safeProfile}-${ref.slice(0, 12)}${diffPart}-${digest}.jsonl`);
}

function readValidCache(file, profileId, ref, changedFrom) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    die(`cannot read source context cache ${rel(file)}: ${error.message}`);
  }
  if (text.length > 0 && !text.endsWith("\n")) {
    die(`invalid source context cache ${rel(file)}: missing trailing newline`);
  }
  for (const line of text.split(/\n/)) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      die(`invalid source context cache ${rel(file)}: non-JSONL record`);
    }
    if (
      !record ||
      record.profile !== profileId ||
      record.ref !== ref ||
      String(record.changedFrom || "") !== String(changedFrom || "") ||
      record.included !== true ||
      typeof record.path !== "string" ||
      typeof record.content !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(record.sha256 || ""))
    ) {
      die(`invalid source context cache ${rel(file)}: record does not match profile/ref`);
    }
    const contentBytes = Buffer.from(record.content, "utf8");
    if (
      record.sha256 !== sha256(contentBytes) ||
      record.bytes !== contentBytes.length ||
      record.lines !== countLines(contentBytes)
    ) {
      die(`invalid source context cache ${rel(file)}: content digest mismatch`);
    }
  }
  return text;
}

function writeCache(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    die(`cannot write source context cache ${rel(file)}: ${error.message}`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function writeJsonl(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function rel(file) {
  return path.relative(repoRoot, path.resolve(file));
}

function die(message) {
  process.stderr.write(`source-context: ${message}\n`);
  process.exit(1);
}

main();
