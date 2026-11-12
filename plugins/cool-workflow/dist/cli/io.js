// cli/io.ts — help with a bold header, and JSON to stdout.
import { formatHelp } from "../core/format/help.js";
import { safeJsonStringify } from "../core/format/safe-json.js";
import { bold } from "../shell/term.js";
/** Bold ONLY the fixed "Cool Workflow" header line of `formatHelp()`'s
 *  plain text. */
export function styledHelp() {
    const text = formatHelp();
    return text.replace(/^Cool Workflow\n/, `${bold("Cool Workflow")}\n`);
}
/** Machine payload to stdout (stdout = data; never colored, never chrome).
 *  Byte-capped via safeJsonStringify — an aggregate result too large to be
 *  useful (or large enough to blow V8's string limit) prints a small
 *  overflow notice instead of hundreds of MB. */
export function printJson(value) {
    process.stdout.write(`${safeJsonStringify(value)}\n`);
}
