// shell/bands-io.ts — the impure half of `bands`: read the config and
// input files, run core/bands.ts's pure evaluation, and (bands.record
// only) write an intent file and enqueue it through the queue that is
// already there (RunRegistry.queueAdd — no second queue is built here).
//
// No network call anywhere in this file. `now` always comes in from the
// caller (the CLI passes the wall clock); nothing here reads a clock.
//
// Evidence: docs/control-bands.7.md.

import * as fs from "node:fs";
import * as path from "node:path";
import { sha256Bytes } from "../core/hash";
import { BandsEvaluation, buildIntentMarkdown, evaluateBands, intentFileName, parseBandsConfig, parseBandsInput } from "../core/bands";
import { writeTextDurable } from "./fs-atomic";
import { RunRegistry } from "./run-registry-io";

export interface BandsOptions {
  config?: string;
  input?: string;
  cwd?: string;
}

function requireOption(value: string | undefined, flag: string): string {
  if (!value || !value.trim()) throw new Error(`bands: missing ${flag} <path>`);
  return value.trim();
}

function readJsonFile(file: string, label: string): { bytes: Buffer; parsed: unknown } {
  if (!fs.existsSync(file)) throw new Error(`bands ${label}: file not found: ${file}`);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    throw new Error(`bands ${label}: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { bytes, parsed: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(`bands ${label}: invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface BandsCheckResult extends BandsEvaluation {
  configDigest: string;
  inputDigest: string;
}

/** Shared read-and-evaluate step for both verbs. Fail closed (throws) on
 *  an unreadable/invalid file or a bad config/input shape; a breach is a
 *  normal, successful result, never an error. */
function runCheck(cwd: string, options: BandsOptions): BandsCheckResult {
  const configPath = path.resolve(cwd, requireOption(options.config, "--config"));
  const inputPath = path.resolve(cwd, requireOption(options.input, "--input"));
  const configFile = readJsonFile(configPath, "config");
  const inputFile = readJsonFile(inputPath, "input");
  const evaluation = evaluateBands(parseBandsConfig(configFile.parsed), parseBandsInput(inputFile.parsed));
  return {
    ...evaluation,
    configDigest: `sha256:${sha256Bytes(configFile.bytes)}`,
    inputDigest: `sha256:${sha256Bytes(inputFile.bytes)}`,
  };
}

/** `cw bands check` / `cw_bands_check`: reads + evaluates only, writes
 *  nothing to disk. */
export function bandsCheck(options: BandsOptions): BandsCheckResult {
  return runCheck(path.resolve(options.cwd || process.cwd()), options);
}

export interface BandsRecordResult extends BandsCheckResult {
  intentPath: string | null;
  queued: { id: string } | null;
}

/** `cw bands record` / `cw_bands_record`: runs the same evaluation, then
 *  (mechanism, not policy) writes an intent file when the tier is 2 or 3,
 *  and ALSO enqueues it when the tier is 3 AND `--queue` was given. A
 *  flag can never reach past its tier's allowance: `--queue` on a
 *  tier-1/2 reading is a plain no-op, not an error. */
export function bandsRecord(options: BandsOptions & { queue?: boolean }, now: string): BandsRecordResult {
  const cwd = path.resolve(options.cwd || process.cwd());
  const checked = runCheck(cwd, options);
  let intentPath: string | null = null;
  let queued: { id: string } | null = null;
  if (checked.tier === "2" || checked.tier === "3") {
    const fullPath = path.join(cwd, ".cw", "intents", intentFileName(checked.metric, now));
    const markdown = buildIntentMarkdown({ evaluation: checked, now, configDigest: checked.configDigest, inputDigest: checked.inputDigest });
    writeTextDurable(fullPath, markdown);
    intentPath = fullPath;
    if (checked.tier === "3" && options.queue) {
      const entry = new RunRegistry(cwd).queueAdd({ note: `bands: tier 3 breach for ${checked.metric}`, inputs: { intentPath: fullPath } });
      queued = { id: entry.id };
    }
  }
  return { ...checked, intentPath, queued };
}
