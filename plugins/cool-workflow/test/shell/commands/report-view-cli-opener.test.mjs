// report-view-cli opener: `cw report --open` (and the end-of-run open)
// names a program it can start with no shell: open on macOS, xdg-open
// elsewhere (Linux and WSL), CW_OPENER over both.

import assert from "node:assert/strict";
import { openerArgv } from "../../../dist/shell/commands/report-view-cli.js";

const file = "<path>/report.html";
assert.deepEqual(openerArgv(file, {}, "darwin"), ["open", file]);
assert.deepEqual(openerArgv(file, {}, "linux"), ["xdg-open", file]);
assert.deepEqual(openerArgv(file, {}, "win32"), ["xdg-open", file], "no native Windows opener");
assert.deepEqual(openerArgv(file, { CW_OPENER: "my-viewer" }, "linux"), ["my-viewer", file], "CW_OPENER wins on every OS");
console.log("report-view-cli-opener: ok");
