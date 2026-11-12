// report-view-cli opener: `cw report --open` (and the end-of-run open) must
// name a program Windows can start with no shell. Fault: on win32 the
// opener was `start`, a cmd.exe word, so the spawn failed with ENOENT and
// report.html was never opened there.

import assert from "node:assert/strict";
import { openerArgv } from "../../../dist/shell/commands/report-view-cli.js";

const file = "<path>/report.html";
assert.deepEqual(openerArgv(file, {}, "win32"), ["rundll32.exe", "url.dll,FileProtocolHandler", file]);
assert.deepEqual(openerArgv(file, {}, "darwin"), ["open", file]);
assert.deepEqual(openerArgv(file, {}, "linux"), ["xdg-open", file]);
assert.deepEqual(openerArgv(file, { CW_OPENER: "my-viewer" }, "win32"), ["my-viewer", file], "CW_OPENER wins on every OS");
console.log("report-view-cli-opener: ok");
