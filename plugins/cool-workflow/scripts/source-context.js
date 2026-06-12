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

  const profileId = valueArg("--profile") || "core";
  const profile = profiles.profiles[profileId];
  if (!profile) die(`unknown profile: ${profileId}`);

  const ref = resolveRef(valueArg("--ref") || "HEAD");
  const cacheDir = command === "export" ? valueArg("--cache-dir") : "";
  const cachePath = cacheDir ? sourceContextCachePath(cacheDir, profileId, ref, profile) : "";
  if (cachePath && fs.existsSync(cachePath)) {
    process.stdout.write(readValidCache(cachePath, profileId, ref));
    return;
  }

  const files = gitLines(["ls-tree", "-r", "--name-only", ref]);
  let exportedLines = 0;
  const buffered = cachePath ? [] : null;
  const emit = (value) => {
    if (buffered) buffered.push(JSON.stringify(value));
    else writeJsonl(value);
  };

  for (const file of files) {
    const classification = classify(file, profile);
    const blob = gitBlob(ref, file);
    const binary = isBinary(blob);
    const record = {
      schemaVersion: profiles.schemaVersion,
      profile: profileId,
      ref,
      path: file,
      bytes: blob.length,
      lines: binary ? null : countLines(blob),
      sha256: sha256(blob),
      included: classification.included,
      reason: classification.reason
    };

    if (command === "manifest") {
      emit(record);
      continue;
    }

    if (!classification.included) continue;
    if (binary) die(`included file is binary: ${file}`);
    exportedLines += record.lines || 0;
    emit({ ...record, content: blob.toString("utf8") });
  }

  const maxLines = Number(profile.maxLines) || 0;
  if (command === "export" && maxLines > 0 && exportedLines > maxLines) {
    die(`profile ${profileId} exported ${exportedLines} lines, above maxLines ${maxLines}`);
  }
  if (cachePath && buffered) {
    const text = buffered.map((line) => `${line}\n`).join("");
    writeCache(cachePath, text);
    process.stdout.write(text);
  }
}

function usage(code, message) {
  if (message) process.stderr.write(`source-context: ${message}\n`);
  process.stderr.write(
    [
      "usage:",
      "  node scripts/source-context.js profiles",
      "  node scripts/source-context.js manifest [--profile core] [--ref HEAD] [--repo-root DIR]",
      "  node scripts/source-context.js export [--profile core] [--ref HEAD] [--repo-root DIR] [--cache-dir DIR]"
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

function gitLines(argv) {
  return git(argv).split(/\r?\n/).filter(Boolean);
}

function git(argv) {
  const result = spawnSync("git", argv, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) die((result.stderr || result.stdout || `git ${argv.join(" ")} failed`).trim());
  return result.stdout;
}

function gitBlob(ref, file) {
  const result = spawnSync("git", ["show", `${ref}:${file}`], { cwd: repoRoot, encoding: "buffer", maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0) die((result.stderr || result.stdout || `cannot read ${file} at ${ref}`).toString().trim());
  return result.stdout;
}

function classify(file, profile) {
  const excludedBy = (profile.exclude || []).find((pattern) => matches(pattern, file));
  if (excludedBy) return { included: false, reason: `excluded:${excludedBy}` };
  const includedBy = (profile.include || []).find((pattern) => matches(pattern, file));
  if (includedBy) return { included: true, reason: `included:${includedBy}` };
  return { included: false, reason: "not-included" };
}

function matches(pattern, file) {
  if (pattern.endsWith("/**")) {
    const dir = pattern.slice(0, -3);
    return file === dir || file.startsWith(`${dir}/`);
  }
  if (!pattern.includes("*")) return file === pattern;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`).test(file);
}

function countLines(buffer) {
  if (buffer.length === 0) return 0;
  let count = 0;
  for (const byte of buffer) if (byte === 10) count++;
  return buffer[buffer.length - 1] === 10 ? count : count + 1;
}

function isBinary(buffer) {
  return buffer.includes(0);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function profileDigest(profileId, profile) {
  return sha256(Buffer.from(stableStringify({ profileId, profile }), "utf8"));
}

function sourceContextCachePath(cacheDir, profileId, ref, profile) {
  const safeProfile = String(profileId).replace(/[^A-Za-z0-9_.-]/g, "_");
  const digest = profileDigest(profileId, profile).slice(0, 16);
  return path.join(path.resolve(cacheDir), `${safeProfile}-${ref.slice(0, 12)}-${digest}.jsonl`);
}

function readValidCache(file, profileId, ref) {
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
      record.included !== true ||
      typeof record.path !== "string" ||
      typeof record.content !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(record.sha256 || ""))
    ) {
      die(`invalid source context cache ${rel(file)}: record does not match profile/ref`);
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
