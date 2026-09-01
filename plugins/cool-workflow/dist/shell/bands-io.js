"use strict";
// shell/bands-io.ts — the impure half of `bands`: read the config and
// input files, run core/bands.ts's pure evaluation, and (bands.record
// only) write an intent file and enqueue it through the queue that is
// already there (RunRegistry.queueAdd — no second queue is built here).
//
// No network call anywhere in this file. `now` always comes in from the
// caller (the CLI passes the wall clock); nothing here reads a clock.
//
// Evidence: docs/control-bands.7.md.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bandsCheck = bandsCheck;
exports.bandsRecord = bandsRecord;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const hash_1 = require("../core/hash");
const bands_1 = require("../core/bands");
const fs_atomic_1 = require("./fs-atomic");
const run_registry_io_1 = require("./run-registry-io");
function requireOption(value, flag) {
    if (!value || !value.trim())
        throw new Error(`bands: missing ${flag} <path>`);
    return value.trim();
}
function readJsonFile(file, label) {
    if (!fs.existsSync(file))
        throw new Error(`bands ${label}: file not found: ${file}`);
    let bytes;
    try {
        bytes = fs.readFileSync(file);
    }
    catch (error) {
        throw new Error(`bands ${label}: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        return { bytes, parsed: JSON.parse(bytes.toString("utf8")) };
    }
    catch (error) {
        throw new Error(`bands ${label}: invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** Shared read-and-evaluate step for both verbs. Fail closed (throws) on
 *  an unreadable/invalid file or a bad config/input shape; a breach is a
 *  normal, successful result, never an error. */
function runCheck(cwd, options) {
    const configPath = path.resolve(cwd, requireOption(options.config, "--config"));
    const inputPath = path.resolve(cwd, requireOption(options.input, "--input"));
    const configFile = readJsonFile(configPath, "config");
    const inputFile = readJsonFile(inputPath, "input");
    const evaluation = (0, bands_1.evaluateBands)((0, bands_1.parseBandsConfig)(configFile.parsed), (0, bands_1.parseBandsInput)(inputFile.parsed));
    return {
        ...evaluation,
        configDigest: `sha256:${(0, hash_1.sha256Bytes)(configFile.bytes)}`,
        inputDigest: `sha256:${(0, hash_1.sha256Bytes)(inputFile.bytes)}`,
    };
}
/** `cw bands check` / `cw_bands_check`: reads + evaluates only, writes
 *  nothing to disk. */
function bandsCheck(options) {
    return runCheck(path.resolve(options.cwd || process.cwd()), options);
}
/** `cw bands record` / `cw_bands_record`: runs the same evaluation, then
 *  (mechanism, not policy) writes an intent file when the tier is 2 or 3,
 *  and ALSO enqueues it when the tier is 3 AND `--queue` was given. A
 *  flag can never reach past its tier's allowance: `--queue` on a
 *  tier-1/2 reading is a plain no-op, not an error. */
function bandsRecord(options, now) {
    const cwd = path.resolve(options.cwd || process.cwd());
    const checked = runCheck(cwd, options);
    let intentPath = null;
    let queued = null;
    if (checked.tier === "2" || checked.tier === "3") {
        const fullPath = path.join(cwd, ".cw", "intents", (0, bands_1.intentFileName)(checked.metric, now));
        const markdown = (0, bands_1.buildIntentMarkdown)({ evaluation: checked, now, configDigest: checked.configDigest, inputDigest: checked.inputDigest });
        (0, fs_atomic_1.writeTextDurable)(fullPath, markdown);
        intentPath = fullPath;
        if (checked.tier === "3" && options.queue) {
            const entry = new run_registry_io_1.RunRegistry(cwd).queueAdd({ note: `bands: tier 3 breach for ${checked.metric}`, inputs: { intentPath: fullPath } });
            queued = { id: entry.id };
        }
    }
    return { ...checked, intentPath, queued };
}
